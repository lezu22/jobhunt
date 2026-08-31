"""
runner.py — Orchestrates the scraper across all configured URLs and roles.
- Dispatches to site-specific scrapers
- Deduplicates results
- Saves partial results after each role (so progress survives crashes)
- Supports resuming from a checkpoint
"""

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable
from urllib.parse import urlparse

from scraper.filters import dedupe_jobs, filter_excluded, listing_keys
from scraper.salary import salary_in_band
from scraper.sites.linkedin import LinkedInScraper
from scraper.sites.indeed import IndeedScraper
from scraper.sites.glassdoor import GlassdoorScraper
from scraper.sites.wellfound import WellfoundScraper
from scraper.sites.welcometothejungle import WelcomeToTheJungleScraper
from scraper.sites.technation import TechNationScraper
from scraper.sites.ukras import UKRASScraper
from scraper.sites.generic import GenericScraper

log = logging.getLogger(__name__)

SCRAPER_MAP = {
    "linkedin.com":               LinkedInScraper,
    "www.linkedin.com":           LinkedInScraper,
    "indeed.co.uk":               IndeedScraper,
    "www.indeed.co.uk":           IndeedScraper,
    "uk.indeed.com":              IndeedScraper,
    "indeed.com":                 IndeedScraper,
    "www.indeed.com":             IndeedScraper,
    "glassdoor.co.uk":            GlassdoorScraper,
    "www.glassdoor.co.uk":        GlassdoorScraper,
    "glassdoor.com":              GlassdoorScraper,
    "wellfound.com":              WellfoundScraper,
    "www.wellfound.com":          WellfoundScraper,
    "uk.welcometothejungle.com":  WelcomeToTheJungleScraper,
    "welcometothejungle.com":     WelcomeToTheJungleScraper,
    "www.welcometothejungle.com": WelcomeToTheJungleScraper,
    "technation.io":              TechNationScraper,
    "www.technation.io":          TechNationScraper,
    "uk-ras.org.uk":              UKRASScraper,
    "www.uk-ras.org.uk":          UKRASScraper,
}


def _get_scraper(url: str):
    domain = urlparse(url).netloc.lower()
    scraper_cls = SCRAPER_MAP.get(domain, GenericScraper)
    return scraper_cls(url)


def scrape_url_for_role(url: str, role: str) -> list[dict]:
    scraper = _get_scraper(url)
    log.info(f"  [{scraper.name}] Searching: {role}")
    try:
        results = scraper.search(role)
        log.info(f"  [{scraper.name}] Found {len(results)} for: {role}")
        return results
    except Exception as e:
        log.warning(f"  Error on {url} for '{role}': {e}")
        return []


def run_search(
    config: dict,
    urls: list[str],
    min_salary: Optional[float] = None,
    max_salary: Optional[float] = None,
    progress_callback: Optional[Callable] = None,
    checkpoint_path: Optional[Path] = None,
    exclude_keywords: Optional[list[str]] = None,
    skip_ids: Optional[set[str]] = None,
) -> dict:
    """
    config:           {"cv_name": ["role1", "role2"], ...}
    urls:             list of base URLs to search
    checkpoint_path:  if set, save partial results here after each role
                      and resume from it if it exists
    exclude_keywords: drop any job whose title/company/description
                      contains one of these (case-insensitive)
    skip_ids:         job ids to drop on sight (e.g. already-tracked jobs)
    """
    total_roles = sum(len(roles) for roles in config.values())
    total_tasks = total_roles * len(urls)
    completed = 0

    output = {
        "generated_at": datetime.utcnow().isoformat(),
        "salary_filter": {"min": min_salary, "max": max_salary},
        "results": {},
        "completed": False,
    }

    # Resume from checkpoint if it exists
    if checkpoint_path and checkpoint_path.exists():
        try:
            saved = json.loads(checkpoint_path.read_text())
            if saved.get("results"):
                output["results"] = saved["results"]
                log.info(f"Resuming from checkpoint: {list(saved['results'].keys())}")
        except Exception:
            pass

    # Run-wide duplicate detection: seed with tracked/skipped ids and
    # everything already in the checkpoint, so a listing discovered once
    # (in any role or CV profile) is never added again.
    seen_keys: set[str] = set(skip_ids or [])
    for roles in output["results"].values():
        for jobs in (roles or {}).values():
            for j in (jobs or []):
                seen_keys |= listing_keys(j)

    for cv_name, roles in config.items():
        if cv_name not in output["results"]:
            output["results"][cv_name] = {}

        for role in roles:
            # Skip already-completed roles (resume support)
            if role in output["results"][cv_name]:
                log.info(f"[{cv_name}] Skipping already-scraped role: {role}")
                completed += len(urls)
                if progress_callback:
                    progress_callback({
                        "completed": completed,
                        "total": total_tasks,
                        "current_cv": cv_name,
                        "current_role": role,
                        "current_url": "(cached)",
                        "percent": int((completed / total_tasks) * 100),
                        "skipped": True,
                    })
                continue

            log.info(f"[{cv_name}] Searching for: {role}")
            all_found = []

            for url in urls:
                found = scrape_url_for_role(url, role)
                all_found.extend(found)
                completed += 1

                if progress_callback:
                    progress_callback({
                        "completed": completed,
                        "total": total_tasks,
                        "current_cv": cv_name,
                        "current_role": role,
                        "current_url": url,
                        "percent": int((completed / total_tasks) * 100),
                    })

                time.sleep(0.3)

            # Deduplicate against everything discovered so far this run
            # (all roles/CVs, checkpoint, and skip_ids) — first find wins
            unique, dropped_dupes = dedupe_jobs(all_found, seen_keys)
            if dropped_dupes:
                log.info(f"  Dropped {dropped_dupes} duplicate/already-tracked job(s)")

            # Salary filter
            filtered = [j for j in unique if salary_in_band(j["salary"], min_salary, max_salary)]

            # Exclusion keyword filter
            if exclude_keywords:
                filtered, dropped = filter_excluded(filtered, exclude_keywords)
                if dropped:
                    log.info(f"  Excluded {dropped} job(s) matching exclusion keywords")

            output["results"][cv_name][role] = filtered if filtered else None

            # Save checkpoint after every role so we can resume
            if checkpoint_path:
                try:
                    checkpoint_path.write_text(json.dumps(output, indent=2))
                    log.info(f"  Checkpoint saved ({cv_name}/{role})")
                except Exception as e:
                    log.warning(f"  Checkpoint save failed: {e}")

    output["completed"] = True
    output["generated_at"] = datetime.utcnow().isoformat()
    return output
