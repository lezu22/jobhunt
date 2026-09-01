"""
stories/exporter.py — stories/notes → markdown the parser reads back.

Layout (round-trip stable with parser.py):
- categories as `## name` in user-defined position order, Uncategorised
  always last as `## Uncategorised` (the import review auto-maps that
  heading back to the synthetic uncategorised bucket);
- records as `### title` in position order within their category;
- optional single-line `<!-- ws: {...} -->` metadata comment directly under
  each ### (id, kind, status, nda, labels, jobs) — invisible in rendered
  markdown, stripped and honoured on re-import;
- the body verbatim;
- question mappings rendered as `- question — Score: N/5 (note)` after the
  body (`?/5` for an unscored mapping). Empty categories are skipped.
"""

import json
import re
from datetime import date

from . import db

UNCAT_HEADING = "Uncategorised"

# A body line starting with ## or ### would be parsed as structure on
# re-import and split the record. Export escapes it (\## renders as literal
# text in the standalone file); the parser strips the escape back on import,
# so the body is byte-identical after a round trip.
STRUCT_LINE_RE = re.compile(r"^(#{2,3}\s)")


def _protect_body(body: str) -> str:
    return "\n".join(STRUCT_LINE_RE.sub(r"\\\1", line) for line in body.splitlines())


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60]
    return slug or "story"


def default_filename(single_title: str | None = None) -> str:
    if single_title is not None:
        return f"{slugify(single_title)}.md"
    return f"work-stories-{date.today().isoformat()}.md"


def _meta_comment(story: dict) -> str:
    payload = {
        "id": story["id"],
        "kind": story["kind"],
        "status": story["status"],
        "nda": story["nda_sensitive"],
        "labels": story["labels"],
        "jobs": story["job_ids"],
    }
    return f"<!-- ws: {json.dumps(payload, ensure_ascii=False)} -->"


def _mapping_line(m: dict) -> str:
    score = "?" if m["score"] is None else str(m["score"])
    note = f" ({m['note']})" if m.get("note") else ""
    return f"- {m['question']} — Score: {score}/5{note}"


def export_markdown(ids: list[str] | None, include_metadata: bool) -> dict:
    """Build the combined markdown for the given story ids (None = all).
    Returns {"markdown": ..., "count": n}. Order: category position, then
    story position; uncategorised last; empty categories skipped."""
    categories = db.list_categories()
    stories = db.list_stories()  # position-ordered
    if ids is not None:
        wanted = set(ids)
        missing = wanted - {s["id"] for s in stories}
        if missing:
            raise db.NotFound(f"story id(s) not found: {sorted(missing)}")
        stories = [s for s in stories if s["id"] in wanted]

    buckets: dict = {c["id"]: [] for c in categories}
    buckets[None] = []
    for s in stories:
        buckets[s["category_id"]].append(s)

    out: list[str] = []
    sections = [(c["name"], buckets[c["id"]]) for c in categories]
    sections.append((UNCAT_HEADING, buckets[None]))
    for name, bucket in sections:
        if not bucket:
            continue  # a category with nothing selected is skipped entirely
        out.append(f"## {name}")
        out.append("")
        for s in bucket:
            out.append(f"### {s['title']}")
            if include_metadata:
                out.append(_meta_comment(s))
            out.append("")
            if s["body"]:
                out.append(_protect_body(s["body"]))
                out.append("")
            if s["mappings"]:
                out.extend(_mapping_line(m) for m in s["mappings"])
                out.append("")
    return {"markdown": "\n".join(out).rstrip() + "\n", "count": len(stories)}
