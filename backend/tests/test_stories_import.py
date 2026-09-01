import io
from pathlib import Path

import pytest

from stories.parser import parse_markdown, normalise_title

# Reuse the app/client fixture wiring from the CRUD tests
from tests.test_stories_crud import client, make_story  # noqa: F401

FIXTURE = """# Interview Prep — Story Bank

Intro prose that belongs to no section.

## REQUIREMENTS CAPTURE STORIES

### 1. Tracer AGV second platform
Leading a project to give QA a second testing platform.

| Aspect | Detail |
|--------|--------|
| Platform | Tracer AGV |

Best for:
- "Tell me about a time you owned requirements capture end to end." — Score: 5/5 (full ownership)
- “Describe a project you inherited from another team.” — Score: 4/5
- Caution: do not mention the customer name.

```bash
## not a heading, inside a fence
echo "x — Score: 3/5"
```

### 2. Boot rework scope pullback
Pushed to narrow requirements.

- "Tell me about a time you had to push back on scope." — Score: 5/5

## SELF INTRO

### Opening framing
Prose only, no score lines here.
"""


class TestParser:
    def test_structure(self):
        p = parse_markdown(FIXTURE)
        assert p["categories"] == ["REQUIREMENTS CAPTURE STORIES", "SELF INTRO"]
        assert [r["title"] for r in p["records"]] == [
            "1. Tracer AGV second platform", "2. Boot rework scope pullback", "Opening framing",
        ]
        assert p["counts"] == {"records": 3, "mappings": 3, "notes_defaulted": 1,
                               "section_prose_records": 0, "preamble_lines": 3}

    def test_h2_with_prose_but_no_h3_becomes_note_candidate(self):
        text = ("## Real Cat\n### A story\nBody.\n\n"
                "## OPENING SELF-INTRODUCTION\nPitch paragraph one.\n\nPitch two.\n\n"
                "## Empty Heading\n\n"
                "## With Both\nintro prose under a heading that has children\n### Child\nc-body\n")
        p = parse_markdown(text)
        titles = [r["title"] for r in p["records"]]
        assert "OPENING SELF-INTRODUCTION" in titles
        synth = next(r for r in p["records"] if r["title"] == "OPENING SELF-INTRODUCTION")
        assert synth["kind"] == "note" and synth["category"] == "OPENING SELF-INTRODUCTION"
        assert synth["body"] == "Pitch paragraph one.\n\nPitch two."
        assert "Empty Heading" not in titles          # nothing to import there
        assert "With Both" not in titles              # has ### children → no synthesis
        assert "(under ## With Both)" in p["preamble"]  # its loose prose is reported
        assert p["counts"]["section_prose_records"] == 1

    def test_only_score_lines_lifted(self):
        p = parse_markdown(FIXTURE)
        tracer = p["records"][0]
        assert [m["score"] for m in tracer["mappings"]] == [5, 4]
        assert tracer["mappings"][0]["question"] == "Tell me about a time you owned requirements capture end to end."
        assert tracer["mappings"][0]["note"] == "full ownership"
        assert tracer["mappings"][1]["question"] == "Describe a project you inherited from another team."  # curly quotes stripped
        # everything else is body, verbatim
        assert "- Caution: do not mention the customer name." in tracer["body"]
        assert "Best for:" in tracer["body"]
        assert "| Platform | Tracer AGV |" in tracer["body"]
        assert "Score" not in tracer["body"].split("```")[0]  # lifted lines gone from prose

    def test_fenced_code_is_opaque(self):
        p = parse_markdown(FIXTURE)
        body = p["records"][0]["body"]
        assert "## not a heading, inside a fence" in body
        assert 'echo "x — Score: 3/5"' in body
        assert p["counts"]["records"] == 3  # fence heading created no category/record

    def test_note_default_when_no_mappings(self):
        p = parse_markdown(FIXTURE)
        assert p["records"][2]["kind"] == "note"
        assert p["records"][2]["kind_source"] == "default-note"
        assert p["records"][0]["kind"] == "story"

    def test_metadata_comment_parsed_and_stripped(self):
        text = ('## Cat\n### T\n'
                '<!-- ws: {"id": "abc123", "kind": "note", "status": "ready",'
                ' "nda": true, "labels": ["x"], "jobs": ["j1"]} -->\n'
                'Body line.\n')
        p = parse_markdown(text)
        rec = p["records"][0]
        assert rec["meta"] == {"id": "abc123", "kind": "note", "status": "ready",
                               "nda": True, "labels": ["x"], "jobs": ["j1"]}
        assert "ws:" not in rec["body"] and rec["body"] == "Body line."
        assert rec["kind"] == "note" and rec["kind_source"] == "meta"

    def test_malformed_meta_comment_stays_in_body(self):
        p = parse_markdown("## C\n### T\n<!-- ws: {broken json -->\nBody.\n")
        assert "<!-- ws: {broken json -->" in p["records"][0]["body"]

    def test_normalise_title(self):
        assert normalise_title("1. Tracer  AGV") == normalise_title("TRACER agv")
        assert normalise_title("2) Boot rework") == "boot rework"


class TestImportEndpoints:
    def upload(self, client, content=FIXTURE, name="bank.md"):
        data = content.encode() if isinstance(content, str) else content
        return client.post("/api/stories/import/parse",
                           files={"file": (name, io.BytesIO(data), "text/markdown")})

    def test_wrong_extension_rejected(self, client):
        assert self.upload(client, name="bank.pdf").status_code == 400

    def test_renamed_binary_rejected(self, client):
        r = self.upload(client, content=b"\x89PNG\r\n\x1a\n\xff\xfe\x00binary", name="sneaky.md")
        assert r.status_code == 400
        assert "UTF-8" in r.json()["detail"]

    def test_oversized_rejected(self, client):
        r = self.upload(client, content=b"a" * (2 * 1024 * 1024 + 1))
        assert r.status_code == 400

    def test_parse_flags_category_and_dup_matches(self, client):
        client.post("/api/stories/categories", json={"name": "requirements capture stories"})
        cid = client.get("/api/stories/categories").json()[0]["id"]
        existing = make_story(client, title="Tracer AGV second platform", category_id=cid)["story"]["id"]
        p = self.upload(client).json()
        cats = {c["name"]: c for c in p["categories"]}
        assert cats["REQUIREMENTS CAPTURE STORIES"]["match"]["id"] == cid  # case-insensitive
        assert cats["SELF INTRO"]["match"] is None
        tracer = p["records"][0]
        assert tracer["dup_title_matches"][0]["story_id"] == existing  # "1. " numbering ignored
        assert tracer["dup_id_match"] is None

    def test_stage_reports_cross_category_title_and_body_similarity(self, client):
        cid = client.post("/api/stories/categories", json={"name": "Elsewhere"}).json()["id"]
        # same normalised title but in a DIFFERENT category than the file's H2
        other = client.post("/api/stories", json={
            "title": "Tracer AGV second platform", "category_id": cid,
            "body": "Leading a project to give QA a second testing platform.",
        }).json()["story"]["id"]
        # no title overlap, but body text heavily shared with the fixture's first record
        similar = client.post("/api/stories", json={
            "title": "Completely different name",
            "body": "Leading a project to give QA a second testing platform.",
        }).json()["story"]["id"]
        p = self.upload(client).json()
        tracer = p["records"][0]
        # cross-category title match is reported with its category and a similarity score
        assert [m["story_id"] for m in tracer["dup_title_matches"]] == [other]
        assert tracer["dup_title_matches"][0]["category_id"] == cid
        assert tracer["dup_title_matches"][0]["similarity"] > 0
        # body similarity surfaces the same-text record even with a different title
        assert similar in [m["story_id"] for m in tracer["body_matches"]]
        top = next(m for m in tracer["body_matches"] if m["story_id"] == similar)
        assert top["similarity"] >= 0.35
        # an unrelated record reports no body matches
        intro = next(r for r in p["records"] if r["title"] == "Opening framing")
        assert intro["body_matches"] == []

    def test_shingle_similarity_bounds(self):
        from stories.parser import shingles, similarity
        a = shingles("Led the Tracer AGV project end to end with QA")
        assert similarity(a, a) == 1.0
        assert similarity(a, shingles("Completely unrelated body about power budgets")) == 0.0
        assert similarity(a, shingles("")) == 0.0

    def test_commit_create_update_skip_in_one_transaction(self, client):
        target = make_story(client, title="Old title")["story"]["id"]
        recs = [
            {"action": "create", "title": "New story", "body": "B", "kind": "story",
             "new_category_name": "Fresh Cat", "mappings": [{"question": "Q?", "score": 5}]},
            {"action": "update", "target_story_id": target, "title": "Updated title",
             "body": "New body", "kind": "story", "status": "ready", "labels": ["imp"]},
            {"action": "skip", "title": "Ignored", "body": "x"},
            {"action": "create", "title": "Second in same new cat", "body": "B2",
             "kind": "note", "new_category_name": "fresh cat"},  # dedupe by case
        ]
        r = client.post("/api/stories/import/commit", json={"records": recs})
        assert r.status_code == 200
        out = r.json()
        assert (out["created"], out["updated"], out["skipped"]) == (2, 1, 1)
        assert out["categories_created"] == ["Fresh Cat"]
        upd = client.get(f"/api/stories/{target}").json()
        assert upd["title"] == "Updated title" and upd["has_previous"] and upd["labels"] == ["imp"]

    def test_commit_rolls_back_entirely_on_bad_record(self, client):
        recs = [
            {"action": "create", "title": "Good", "body": "B", "new_category_name": "C1"},
            {"action": "create", "title": "Bad", "body": "   "},
        ]
        r = client.post("/api/stories/import/commit", json={"records": recs})
        assert r.status_code == 400 and "Bad" in r.json()["detail"]
        assert client.get("/api/stories").json() == []
        assert client.get("/api/stories/categories").json() == []

    def test_commit_drops_unknown_job_links_and_counts(self, client):
        recs = [{"action": "create", "title": "T", "body": "B",
                 "job_ids": ["job-1", "ghost-job"]}]
        out = client.post("/api/stories/import/commit", json={"records": recs}).json()
        assert out["dropped_job_links"] == 1
        s = client.get("/api/stories").json()[0]
        assert s["job_ids"] == ["job-1"]


REAL_DOC = Path(__file__).resolve().parents[4] / "docs" / "story-bank.md"  # ~/myCode/docs


@pytest.mark.skipif(not REAL_DOC.exists(), reason="real story-bank.md not present")
class TestRealDocument:
    def test_parses_without_loss(self):
        text = REAL_DOC.read_text(encoding="utf-8")
        p = parse_markdown(text)
        assert p["counts"]["records"] > 5
        assert p["counts"]["mappings"] > 10
        # every Caution line in the source survives inside some body
        cautions = [l for l in text.splitlines() if l.strip().startswith("- Caution:")]
        bodies = "\n".join(r["body"] for r in p["records"])
        for c in cautions:
            assert c.strip() in bodies
        # no score line leaked into any body
        assert "— Score:" not in bodies
