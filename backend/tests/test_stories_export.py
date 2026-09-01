import pytest

from stories import exporter
from stories.parser import parse_markdown

# Reuse the app/client fixture wiring
from tests.test_stories_crud import client, make_story  # noqa: F401


def seed_bank(client):
    """Two ordered categories + an uncategorised note, with ordered stories."""
    a = client.post("/api/stories/categories", json={"name": "Requirements"}).json()["id"]
    b = client.post("/api/stories/categories", json={"name": "Architecture"}).json()["id"]
    s1 = client.post("/api/stories", json={
        "title": "Tracer AGV", "category_id": a, "status": "ready",
        "nda_sensitive": True, "labels": ["hardware", "qa"], "job_ids": ["job-1"],
        "body": "Body one.\n\n| K | V |\n|---|---|\n| a | b |\n\n- Caution: keep quiet.",
        "mappings": [
            {"question": "Owned a project end to end?", "score": 5, "note": "best fit"},
            {"question": "Unscored future question", "score": None},
        ],
    }).json()["story"]["id"]
    s2 = client.post("/api/stories", json={
        "title": "Boot rework", "category_id": a, "body": "Body two.",
        "mappings": [{"question": "Pushed back on scope?", "score": 4}],
    }).json()["story"]["id"]
    s3 = client.post("/api/stories", json={
        "title": "Compute split", "category_id": b, "body": "Body three.",
        "mappings": [{"question": "Architecture decision?", "score": 5}],
    }).json()["story"]["id"]
    n1 = client.post("/api/stories", json={
        "title": "Opening intro", "kind": "note", "body": "Pitch prose.",
    }).json()["story"]["id"]
    return {"cats": (a, b), "ids": [s1, s2, s3, n1]}


class TestExporter:
    def test_structure_order_and_mapping_format(self, client):
        seed = seed_bank(client)
        out = client.post("/api/stories/export", json={"include_metadata": False}).json()
        md = out["markdown"]
        # category order by position, uncategorised last
        assert md.index("## Requirements") < md.index("## Architecture") < md.index("## Uncategorised")
        assert md.index("### Tracer AGV") < md.index("### Boot rework")
        # mapping lines in the parser's format, ?/5 for unscored
        assert "- Owned a project end to end? — Score: 5/5 (best fit)" in md
        assert "- Unscored future question — Score: ?/5" in md
        # body content verbatim
        assert "- Caution: keep quiet." in md and "| a | b |" in md
        assert "<!-- ws:" not in md
        assert out["filename"].startswith("work-stories-")

    def test_selection_skips_empty_categories(self, client):
        seed = seed_bank(client)
        only_arch = [seed["ids"][2]]
        md = client.post("/api/stories/export", json={"ids": only_arch}).json()["markdown"]
        assert "## Architecture" in md
        assert "## Requirements" not in md and "## Uncategorised" not in md

    def test_single_export_filename_is_slug(self, client):
        seed = seed_bank(client)
        out = client.post("/api/stories/export", json={"ids": [seed["ids"][0]]}).json()
        assert out["filename"] == "tracer-agv.md"
        out2 = client.post("/api/stories/export",
                           json={"ids": [seed["ids"][0]], "filename": "custom.md"}).json()
        assert out2["filename"] == "custom.md"

    def test_metadata_comment_single_line_under_heading(self, client):
        seed = seed_bank(client)
        md = client.post("/api/stories/export", json={"include_metadata": True}).json()["markdown"]
        lines = md.splitlines()
        i = lines.index("### Tracer AGV")
        assert lines[i + 1].startswith("<!-- ws: {") and lines[i + 1].endswith("} -->")
        assert lines[i + 1].count("\n") == 0
        assert '"nda": true' in lines[i + 1] and '"labels": ["hardware", "qa"]' in lines[i + 1]
        assert '"jobs": ["job-1"]' in lines[i + 1]

    def test_unknown_id_404(self, client):
        assert client.post("/api/stories/export", json={"ids": ["nope"]}).status_code == 404


class TestRoundTrip:
    def full_state(self, client):
        stories = client.get("/api/stories").json()
        return {
            s["title"]: {
                "body": s["body"], "kind": s["kind"], "status": s["status"],
                "nda": s["nda_sensitive"], "labels": s["labels"], "jobs": s["job_ids"],
                "maps": [(m["question"], m["score"], m["note"]) for m in s["mappings"]],
                "cat": s["category_id"],
            } for s in stories
        }

    def reimport(self, client, md, update_on_id=True):
        """Parse exported markdown and commit it the way the review screen
        would with default choices (id match → update)."""
        import io
        r = client.post("/api/stories/import/parse",
                        files={"file": ("x.md", io.BytesIO(md.encode()), "text/markdown")})
        assert r.status_code == 200, r.text
        parsed = r.json()
        cat_ids = {c["name"]: (c["match"] or {}).get("id") for c in parsed["categories"]}
        recs = []
        for rec in parsed["records"]:
            meta = rec.get("meta") or {}
            heading = rec["category"]
            cat_id = None if (heading is None or heading.casefold() == "uncategorised") \
                else cat_ids.get(heading)
            recs.append({
                "action": "update" if (update_on_id and rec["dup_id_match"]) else "create",
                "target_story_id": (rec["dup_id_match"] or {}).get("story_id"),
                "title": rec["title"], "body": rec["body"], "kind": rec["kind"],
                "status": meta.get("status", "draft"),
                "nda_sensitive": meta.get("nda", False),
                "category_id": cat_id,
                "new_category_name": None if cat_id or heading is None
                    or heading.casefold() == "uncategorised" else heading,
                "labels": meta.get("labels", []), "job_ids": meta.get("jobs", []),
                "mappings": rec["mappings"] if rec["kind"] == "story" else [],
            })
        r = client.post("/api/stories/import/commit", json={"records": recs})
        assert r.status_code == 200, r.text
        return r.json(), parsed

    def test_metadata_on_round_trip_is_stable(self, client):
        seed_bank(client)
        before = self.full_state(client)
        md1 = client.post("/api/stories/export", json={"include_metadata": True}).json()["markdown"]
        out, parsed = self.reimport(client, md1)
        # every record matched by id and updated in place — nothing new created
        assert (out["created"], out["updated"]) == (0, 4)
        after = self.full_state(client)
        assert after == before
        # metadata comment stripped from bodies, so a second export is identical
        assert all("ws:" not in s["body"] for s in client.get("/api/stories").json())
        md2 = client.post("/api/stories/export", json={"include_metadata": True}).json()["markdown"]
        assert md2 == md1

    def test_metadata_off_round_trip_loses_only_meta_fields(self, client):
        seed_bank(client)
        md = client.post("/api/stories/export", json={"include_metadata": False}).json()["markdown"]
        parsed = parse_markdown(md)
        # no ids → no id matches; kind still inferred; meta fields absent
        assert all(r["meta"] is None for r in parsed["records"])
        kinds = {r["title"]: r["kind"] for r in parsed["records"]}
        assert kinds["Tracer AGV"] == "story" and kinds["Opening intro"] == "note"
        bodies = {r["title"]: r["body"] for r in parsed["records"]}
        assert bodies["Tracer AGV"].startswith("Body one.")
        # committing as create-new must not crash (it duplicates, by design)
        out, _ = self.reimport(client, md, update_on_id=True)  # no ids → all create
        assert out["created"] == 4 and out["updated"] == 0

    def test_body_with_markdown_headings_survives_round_trip(self, client):
        sid = client.post("/api/stories", json={
            "title": "Heading body", "body": "Intro.\n\n## Key facts\n\ndetail\n\n### Sub\nmore",
            "mappings": [{"question": "Q?", "score": 3}],
        }).json()["story"]["id"]
        md = client.post("/api/stories/export", json={"include_metadata": True}).json()["markdown"]
        assert "\\## Key facts" in md and "\\### Sub" in md  # escaped in the file
        out, parsed = TestRoundTrip().reimport(client, md)
        assert (out["created"], out["updated"]) == (0, 1)  # no record split off
        body = client.get(f"/api/stories/{sid}").json()["body"]
        assert "## Key facts" in body and "\\##" not in body  # byte-identical again

    def test_unscored_mapping_survives_round_trip(self, client):
        seed_bank(client)
        md = client.post("/api/stories/export", json={"include_metadata": True}).json()["markdown"]
        parsed = parse_markdown(md)
        tracer = next(r for r in parsed["records"] if r["title"] == "Tracer AGV")
        assert ("Unscored future question", None) in [(m["question"], m["score"]) for m in tracer["mappings"]]
