"""
database.py — SQLite persistence layer for tracked jobs.
Uses a single 'tracked_jobs' table with JSON columns for flexible data.
"""

import json
import re
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "data" / "jobhunt.db"

_ROUND_RE = re.compile(r"^Interview Round (\d+)$")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they don't exist, and migrate in any newly-added columns."""
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tracked_jobs (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                company     TEXT,
                location    TEXT,
                url         TEXT,
                source      TEXT,
                cv_profile  TEXT,
                role_searched TEXT,
                salary_raw  TEXT,
                salary_min  REAL,
                salary_max  REAL,
                description TEXT,
                status      TEXT DEFAULT 'none',
                applied_date TEXT,
                stages      TEXT DEFAULT '{}',
                notes       TEXT DEFAULT '[]',
                tasks       TEXT DEFAULT '[]',
                research    TEXT DEFAULT '',
                extra_dates TEXT DEFAULT '{}',
                custom_stages TEXT DEFAULT '[]',
                stage_details TEXT DEFAULT '{}',
                created_at  TEXT,
                updated_at  TEXT
            )
        """)
        existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(tracked_jobs)")}
        if "custom_stages" not in existing_cols:
            conn.execute("ALTER TABLE tracked_jobs ADD COLUMN custom_stages TEXT DEFAULT '[]'")
        if "stage_details" not in existing_cols:
            conn.execute("ALTER TABLE tracked_jobs ADD COLUMN stage_details TEXT DEFAULT '{}'")
        conn.commit()
    _migrate_final_round()
    log.info(f"DB ready at {DB_PATH}")


def _latest_interview_round(custom_stages: list) -> str:
    """The furthest interview round a job has: its highest-numbered extra round,
    else the base "Interview" (round 1)."""
    rounds = [s for s in custom_stages if _ROUND_RE.match(str(s))]
    if not rounds:
        return "Interview"
    return max(rounds, key=lambda s: int(_ROUND_RE.match(s).group(1)))


def _migrate_final_round():
    """One-off: "Final Round" is no longer a stage — round count is user-driven.
    Any job carrying a Final Round stamp is remapped onto its latest interview
    round (keeping that round's own date if it already has one)."""
    migrated = 0
    with _connect() as conn:
        rows = conn.execute("SELECT id, stages, custom_stages FROM tracked_jobs").fetchall()
        for row in rows:
            try:
                stages = json.loads(row["stages"] or "{}")
                custom = json.loads(row["custom_stages"] or "[]")
            except (json.JSONDecodeError, TypeError):
                continue
            if "Final Round" not in stages:
                continue
            stamp = stages.pop("Final Round")
            target = _latest_interview_round(custom)
            stages.setdefault(target, stamp)
            conn.execute(
                "UPDATE tracked_jobs SET stages=? WHERE id=?",
                (json.dumps(stages), row["id"]),
            )
            migrated += 1
        if migrated:
            conn.commit()
    if migrated:
        log.info(f"Migrated {migrated} job(s) off the retired 'Final Round' stage")


def upsert_job(job: dict) -> dict:
    """Insert or update a tracked job. Returns the saved record."""
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        existing = conn.execute("SELECT * FROM tracked_jobs WHERE id = ?", (job["id"],)).fetchone()

        if existing:
            # Merge: keep existing tracking data, update job info
            data = dict(existing)
            data["title"] = job.get("title", data["title"])
            data["company"] = job.get("company", data["company"])
            data["location"] = job.get("location", data["location"])
            data["url"] = job.get("url", data["url"])
            data["salary_raw"] = job.get("salary", {}).get("raw", data["salary_raw"])
            data["salary_min"] = job.get("salary", {}).get("min", data["salary_min"])
            data["salary_max"] = job.get("salary", {}).get("max", data["salary_max"])
            data["description"] = job.get("description", data["description"])
            data["updated_at"] = now

            conn.execute("""
                UPDATE tracked_jobs SET
                    title=:title, company=:company, location=:location, url=:url,
                    salary_raw=:salary_raw, salary_min=:salary_min, salary_max=:salary_max,
                    description=:description, updated_at=:updated_at
                WHERE id=:id
            """, data)
        else:
            salary = job.get("salary", {})
            data = {
                "id": job["id"],
                "title": job.get("title", ""),
                "company": job.get("company"),
                "location": job.get("location"),
                "url": job.get("url"),
                "source": job.get("source"),
                "cv_profile": job.get("cv_profile"),
                "role_searched": job.get("role_searched"),
                "salary_raw": salary.get("raw"),
                "salary_min": salary.get("min"),
                "salary_max": salary.get("max"),
                "description": job.get("description"),
                "status": "none",
                "applied_date": None,
                "stages": "{}",
                "notes": "[]",
                "tasks": "[]",
                "research": "",
                "extra_dates": "{}",
                "custom_stages": "[]",
                "stage_details": "{}",
                "created_at": now,
                "updated_at": now,
            }
            conn.execute("""
                INSERT INTO tracked_jobs (
                    id, title, company, location, url, source,
                    cv_profile, role_searched, salary_raw, salary_min, salary_max,
                    description, status, applied_date, stages, notes, tasks,
                    research, extra_dates, custom_stages, stage_details, created_at, updated_at
                ) VALUES (
                    :id, :title, :company, :location, :url, :source,
                    :cv_profile, :role_searched, :salary_raw, :salary_min, :salary_max,
                    :description, :status, :applied_date, :stages, :notes, :tasks,
                    :research, :extra_dates, :custom_stages, :stage_details, :created_at, :updated_at
                )
            """, data)
        conn.commit()

    return get_job(job["id"])


def get_job(job_id: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM tracked_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        return _deserialise(dict(row))


def get_all_jobs(status_filter: Optional[str] = None) -> list[dict]:
    with _connect() as conn:
        if status_filter and status_filter != "all":
            rows = conn.execute(
                "SELECT * FROM tracked_jobs WHERE status = ? ORDER BY updated_at DESC", (status_filter,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tracked_jobs ORDER BY updated_at DESC"
            ).fetchall()
    return [_deserialise(dict(r)) for r in rows]


def update_job(job_id: str, updates: dict) -> Optional[dict]:
    """Update mutable tracking fields."""
    allowed = {
        "status", "applied_date", "stages", "notes", "tasks",
        "research", "extra_dates", "company", "location", "salary_raw",
        "description", "url", "custom_stages", "stage_details",
    }
    fields = {k: v for k, v in updates.items() if k in allowed}
    if not fields:
        return get_job(job_id)

    fields["updated_at"] = datetime.utcnow().isoformat()

    # Serialise JSON fields
    for json_field in ("stages", "notes", "tasks", "extra_dates", "custom_stages", "stage_details"):
        if json_field in fields and not isinstance(fields[json_field], str):
            fields[json_field] = json.dumps(fields[json_field])

    set_clause = ", ".join(f"{k}=:{k}" for k in fields)
    fields["id"] = job_id

    with _connect() as conn:
        conn.execute(f"UPDATE tracked_jobs SET {set_clause} WHERE id=:id", fields)
        conn.commit()

    return get_job(job_id)


def delete_job(job_id: str) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM tracked_jobs WHERE id = ?", (job_id,))
        conn.commit()
        return cur.rowcount > 0


def get_stats() -> dict:
    with _connect() as conn:
        total = conn.execute("SELECT COUNT(*) FROM tracked_jobs").fetchone()[0]
        by_status = conn.execute(
            "SELECT status, COUNT(*) as cnt FROM tracked_jobs GROUP BY status"
        ).fetchall()
    return {
        "total": total,
        "by_status": {r["status"]: r["cnt"] for r in by_status},
    }


def _deserialise(row: dict) -> dict:
    """Parse JSON string fields back to Python objects."""
    for field in ("stages", "notes", "tasks", "extra_dates", "custom_stages", "stage_details"):
        if isinstance(row.get(field), str):
            try:
                row[field] = json.loads(row[field])
            except (json.JSONDecodeError, TypeError):
                row[field] = {} if field in ("stages", "extra_dates", "stage_details") else []
    return row
