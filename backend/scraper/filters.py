"""
filters.py — keyword-based job exclusion.
A job is excluded when any keyword appears (case-insensitive) in its
title, company, or description.
"""


def job_matches_exclusions(job: dict, keywords: list[str]) -> bool:
    if not keywords:
        return False
    haystack = " ".join(
        str(job.get(field) or "") for field in ("title", "company", "description")
    ).lower()
    return any(k.strip().lower() in haystack for k in keywords if k and k.strip())


def filter_excluded(jobs: list[dict], keywords: list[str]) -> tuple[list[dict], int]:
    """Return (kept_jobs, excluded_count)."""
    kept = [j for j in jobs if not job_matches_exclusions(j, keywords)]
    return kept, len(jobs) - len(kept)


def listing_keys(job: dict) -> set[str]:
    """Identity keys for duplicate detection: the url+title hash id, plus a
    title|company|location key so the same listing found on two boards
    (different URLs) still collides. Company must be known for the second
    key — title alone is far too collision-prone."""
    keys = {job["id"]} if job.get("id") else set()
    if job.get("title") and job.get("company"):
        keys.add("|".join([
            job["title"].strip().lower(),
            job["company"].strip().lower(),
            (job.get("location") or "").strip().lower(),
        ]))
    return keys


def dedupe_jobs(jobs: list[dict], seen: set[str]) -> tuple[list[dict], int]:
    """Drop jobs whose identity keys collide with `seen` (mutated in place),
    keeping the first occurrence. Return (kept_jobs, dropped_count)."""
    kept = []
    for job in jobs:
        keys = listing_keys(job)
        if keys and keys & seen:
            continue
        seen |= keys
        kept.append(job)
    return kept, len(jobs) - len(kept)
