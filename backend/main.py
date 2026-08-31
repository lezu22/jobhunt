"""
main.py — FastAPI backend for Job Hunt Command Centre.
"""

import asyncio
import json
import logging
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent))

import database
from stories import migrate as stories_migrate
from stories.router import router as stories_router
from scraper.base import job_id
from scraper.filters import job_matches_exclusions, listing_keys
from scraper.runner import run_search

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

CONFIG_DIR = Path(__file__).parent / "config"
CONFIG_DIR.mkdir(exist_ok=True)

SEARCH_CONFIG_PATH = CONFIG_DIR / "search_config.json"
URLS_PATH          = CONFIG_DIR / "urls.json"
RESULTS_PATH       = CONFIG_DIR / "last_results.json"
CHECKPOINT_PATH    = CONFIG_DIR / "scrape_checkpoint.json"  # partial results during scrape
EXCLUDES_PATH      = CONFIG_DIR / "exclude_keywords.json"   # keywords that reject a job

# In-memory scrape job store  {job_id: {...}}
scrape_jobs: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    stories_migrate.migrate()
    if not SEARCH_CONFIG_PATH.exists():
        SEARCH_CONFIG_PATH.write_text(json.dumps({
            "hybrid": ["Systems Integration Engineer", "Autonomous Systems Engineer"],
            "robotics": ["Robotics Software Engineer", "ROS2 Engineer"],
            "software": ["Python Software Engineer", "Backend Engineer Python"],
        }, indent=2))
    if not URLS_PATH.exists():
        URLS_PATH.write_text(json.dumps([
            "https://www.linkedin.com/jobs",
            "https://uk.indeed.com",
            "https://www.glassdoor.co.uk/Jobs/",
            "https://wellfound.com/jobs",
            "https://uk.welcometothejungle.com/",
            "https://technation.io/",
            "https://uk-ras.org.uk/jobs",
        ], indent=2))
    if not EXCLUDES_PATH.exists():
        EXCLUDES_PATH.write_text(json.dumps([], indent=2))
    yield


app = FastAPI(title="Job Hunt API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(stories_router)


# ─── Config ──────────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return json.loads(SEARCH_CONFIG_PATH.read_text()) if SEARCH_CONFIG_PATH.exists() else {}


@app.post("/api/config")
async def save_config(request: Request):
    SEARCH_CONFIG_PATH.write_text(json.dumps(await request.json(), indent=2))
    return {"ok": True}


@app.get("/api/urls")
def get_urls():
    return json.loads(URLS_PATH.read_text()) if URLS_PATH.exists() else []


@app.post("/api/urls")
async def save_urls(request: Request):
    URLS_PATH.write_text(json.dumps(await request.json(), indent=2))
    return {"ok": True}


def _load_excludes() -> list[str]:
    if not EXCLUDES_PATH.exists():
        return []
    try:
        data = json.loads(EXCLUDES_PATH.read_text())
        return [k for k in data if isinstance(k, str) and k.strip()]
    except Exception:
        return []


@app.get("/api/excludes")
def get_excludes():
    return _load_excludes()


@app.post("/api/excludes")
async def save_excludes(request: Request):
    data = await request.json()
    if not isinstance(data, list) or not all(isinstance(k, str) for k in data):
        raise HTTPException(400, "Expected a JSON array of strings")
    keywords = sorted({k.strip() for k in data if k.strip()}, key=str.lower)
    EXCLUDES_PATH.write_text(json.dumps(keywords, indent=2))
    return {"ok": True, "keywords": keywords}


# ─── Scraper ─────────────────────────────────────────────────────────────────

class ScrapeRequest(BaseModel):
    min_salary: Optional[float] = None
    max_salary: Optional[float] = None
    resume: bool = False   # if True, continue from checkpoint


def _run_scrape_sync(job_id: str, config: dict, urls: list,
                     min_salary, max_salary, resume: bool,
                     exclude_keywords: list[str], skip_ids: set):
    job = scrape_jobs[job_id]
    job["status"] = "running"

    # Use checkpoint path; clear it unless resuming
    if not resume and CHECKPOINT_PATH.exists():
        CHECKPOINT_PATH.unlink()

    def on_progress(p):
        scrape_jobs[job_id]["progress"] = p
        # Also persist progress so frontend can poll even after restart
        try:
            if CHECKPOINT_PATH.exists():
                chk = json.loads(CHECKPOINT_PATH.read_text())
                chk["_progress"] = p
                CHECKPOINT_PATH.write_text(json.dumps(chk, indent=2))
        except Exception:
            pass

    try:
        results = run_search(
            config, urls, min_salary, max_salary,
            progress_callback=on_progress,
            checkpoint_path=CHECKPOINT_PATH,
            exclude_keywords=exclude_keywords,
            skip_ids=skip_ids,
        )
        # On completion, promote checkpoint to final results
        RESULTS_PATH.write_text(json.dumps(results, indent=2))
        if CHECKPOINT_PATH.exists():
            CHECKPOINT_PATH.unlink()

        job["status"] = "done"
        job["result_summary"] = {
            cv: {role: len(jobs) if jobs else 0 for role, jobs in (roles or {}).items()}
            for cv, roles in results["results"].items()
        }
    except Exception as e:
        log.exception("Scrape failed")
        job["status"] = "error"
        job["error"] = str(e)


@app.post("/api/scrape")
async def start_scrape(req: ScrapeRequest, background_tasks: BackgroundTasks):
    if not SEARCH_CONFIG_PATH.exists() or not URLS_PATH.exists():
        raise HTTPException(400, "Config or URLs not saved yet")

    config = json.loads(SEARCH_CONFIG_PATH.read_text())
    urls   = json.loads(URLS_PATH.read_text())

    if not config: raise HTTPException(400, "Search config is empty")
    if not urls:   raise HTTPException(400, "URL list is empty")

    job_id = str(uuid.uuid4())
    scrape_jobs[job_id] = {
        "status": "queued",
        "progress": {"completed": 0, "total": 1, "percent": 0},
        "resume": req.resume,
    }

    loop = asyncio.get_event_loop()
    background_tasks.add_task(
        loop.run_in_executor, None,
        _run_scrape_sync,
        job_id, config, urls, req.min_salary, req.max_salary, req.resume,
        _load_excludes(),
        {j["id"] for j in database.get_all_jobs()},  # never re-scrape tracked jobs
    )
    return {"job_id": job_id}


@app.get("/api/scrape/status/{job_id}/poll")
def scrape_status_poll(job_id: str):
    if job_id not in scrape_jobs:
        raise HTTPException(404, "Job not found")
    return scrape_jobs[job_id]


@app.get("/api/scrape/checkpoint")
def get_checkpoint_status():
    """
    Returns info about any available checkpoint so the frontend can offer 'Resume'.
    """
    if not CHECKPOINT_PATH.exists():
        return {"has_checkpoint": False}
    try:
        chk = json.loads(CHECKPOINT_PATH.read_text())
        cvs = list(chk.get("results", {}).keys())
        total_found = sum(
            len(jobs) for roles in chk.get("results", {}).values()
            for jobs in (roles or {}).values() if jobs
        )
        roles_done = sum(
            len(roles) for roles in chk.get("results", {}).values()
        )
        return {
            "has_checkpoint": True,
            "generated_at": chk.get("generated_at"),
            "cvs_started": cvs,
            "roles_completed": roles_done,
            "jobs_found_so_far": total_found,
        }
    except Exception:
        return {"has_checkpoint": False}


@app.delete("/api/scrape/checkpoint")
def clear_checkpoint():
    if CHECKPOINT_PATH.exists():
        CHECKPOINT_PATH.unlink()
    return {"ok": True}


# ─── Results ─────────────────────────────────────────────────────────────────

def _filter_results_payload(data: dict) -> dict:
    """Hide unwanted jobs from a results payload before serving it:
    exclusion-keyword matches, jobs already in the tracker, and duplicate
    listings (first occurrence wins). Applies retroactively to results
    scraped before these rules existed; the underlying files are not
    modified, so relaxing a rule un-hides jobs."""
    keywords = _load_excludes()
    tracked_ids = {j["id"] for j in database.get_all_jobs()}
    excluded = tracked = duplicates = 0
    seen: set[str] = set()
    for roles in (data.get("results") or {}).values():
        for role, jobs in (roles or {}).items():
            if not jobs:
                continue
            kept = []
            for job in jobs:
                if job_matches_exclusions(job, keywords):
                    excluded += 1
                    continue
                if job.get("id") in tracked_ids:
                    tracked += 1
                    continue
                keys = listing_keys(job)
                if keys and keys & seen:
                    duplicates += 1
                    continue
                seen |= keys
                kept.append(job)
            roles[role] = kept if kept else None
    data["_excluded_count"] = excluded
    data["_tracked_hidden"] = tracked
    data["_duplicates_hidden"] = duplicates
    return data


@app.get("/api/results")
def get_results():
    # Return final results, or partial checkpoint if scrape was interrupted
    if RESULTS_PATH.exists():
        return _filter_results_payload(json.loads(RESULTS_PATH.read_text()))
    if CHECKPOINT_PATH.exists():
        try:
            data = json.loads(CHECKPOINT_PATH.read_text())
            data["_partial"] = True
            return _filter_results_payload(data)
        except Exception:
            pass
    return {"results": {}, "generated_at": None}


@app.post("/api/results/refilter")
def refilter_results():
    """Permanently re-apply the current filters to the stored scrape results —
    exclusion keywords, duplicate collapse, and tracked-job removal — so results
    that newly match the filters are pruned without a fresh scrape. (Serving
    already hides them dynamically; this makes the pruning permanent.)"""
    removed = {"excluded": 0, "tracked": 0, "duplicates": 0}
    touched = False
    for path in [RESULTS_PATH, CHECKPOINT_PATH]:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        data = _filter_results_payload(data)
        removed["excluded"]   += data.pop("_excluded_count", 0)
        removed["tracked"]    += data.pop("_tracked_hidden", 0)
        removed["duplicates"] += data.pop("_duplicates_hidden", 0)
        path.write_text(json.dumps(data, indent=2))
        touched = True
    removed["total"] = sum(removed.values())
    return {"ok": True, "had_results": touched, **removed}


@app.delete("/api/results/untracked")
def purge_untracked_results():
    """Permanently drop every scraped result that hasn't been added to the tracker."""
    if not RESULTS_PATH.exists():
        return {"ok": True, "removed": 0}

    data = json.loads(RESULTS_PATH.read_text())
    tracked_ids = {j["id"] for j in database.get_all_jobs()}

    removed = 0
    for roles in (data.get("results") or {}).values():
        for role, jobs in (roles or {}).items():
            kept = [j for j in (jobs or []) if j.get("id") in tracked_ids]
            removed += len(jobs or []) - len(kept)
            roles[role] = kept

    RESULTS_PATH.write_text(json.dumps(data, indent=2))
    return {"ok": True, "removed": removed}


@app.delete("/api/results/{job_id}")
def delete_single_result(job_id: str):
    """Permanently remove one job everywhere: from scraped results and, if tracked, from the tracker too."""
    removed_from_results = False
    if RESULTS_PATH.exists():
        data = json.loads(RESULTS_PATH.read_text())
        for roles in (data.get("results") or {}).values():
            for role, jobs in (roles or {}).items():
                kept = [j for j in (jobs or []) if j.get("id") != job_id]
                if len(kept) != len(jobs or []):
                    removed_from_results = True
                roles[role] = kept
        if removed_from_results:
            RESULTS_PATH.write_text(json.dumps(data, indent=2))

    removed_from_tracker = database.delete_job(job_id)

    if not removed_from_results and not removed_from_tracker:
        raise HTTPException(404, "Job not found in results or tracker")
    return {"ok": True, "removed_from_results": removed_from_results, "removed_from_tracker": removed_from_tracker}


# ─── Tracker ─────────────────────────────────────────────────────────────────

@app.get("/api/tracker")
def get_tracker(status: Optional[str] = None):
    return database.get_all_jobs(status)


@app.post("/api/tracker")
async def add_to_tracker(request: Request):
    job = await request.json()
    if not job.get("title", "").strip():
        raise HTTPException(400, "Title is required")
    if not job.get("id"):
        job["id"] = job_id(job.get("url", ""), job["title"])
    return database.upsert_job(job)


@app.patch("/api/tracker/{job_id}")
async def update_tracker(job_id: str, request: Request):
    result = database.update_job(job_id, await request.json())
    if not result:
        raise HTTPException(404, "Job not found")
    return result


@app.delete("/api/tracker/{job_id}")
def remove_from_tracker(job_id: str):
    if not database.delete_job(job_id):
        raise HTTPException(404, "Job not found")
    return {"ok": True}


@app.get("/api/tracker/ids")
def get_tracker_ids():
    """Return just the IDs of all tracked jobs (lightweight for Results page)."""
    jobs = database.get_all_jobs()
    return [j["id"] for j in jobs]


@app.get("/api/tracker/{job_id}")
def get_tracker_job(job_id: str):
    job = database.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


# ─── Stats ───────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats():
    stats = database.get_stats()
    results_count = 0
    has_results = False

    for path in [RESULTS_PATH, CHECKPOINT_PATH]:
        if path.exists():
            try:
                data = _filter_results_payload(json.loads(path.read_text()))
                for cv_roles in data.get("results", {}).values():
                    for jobs in (cv_roles or {}).values():
                        if jobs:
                            results_count += len(jobs)
                has_results = True
                break
            except Exception:
                pass

    stats["results_count"] = results_count
    stats["has_results"] = has_results
    stats["has_checkpoint"] = CHECKPOINT_PATH.exists()
    return stats
