import pytest
from fastapi.testclient import TestClient

import database
from stories import migrate


@pytest.fixture
def client(tmp_path):
    """App backed by a temp DB seeded with two tracked jobs."""
    path = tmp_path / "jobhunt.db"
    orig = database.DB_PATH
    database.DB_PATH = path
    try:
        database.init_db()
        migrate.migrate(path)
        database.upsert_job({"id": "job-1", "title": "Robotics Engineer"})
        database.upsert_job({"id": "job-2", "title": "Systems Engineer"})
        import main
        with TestClient(main.app, raise_server_exceptions=True) as c:
            yield c
    finally:
        database.DB_PATH = orig


def make_story(client, title="Tracer AGV", category_id=None, **over):
    payload = {
        "title": title,
        "body": "Led the second testing platform project.",
        "category_id": category_id,
        "mappings": [
            {"question": "Tell me about a time you owned a project end to end.",
             "score": 5, "note": "full ownership"},
            {"question": "Describe a project you inherited.", "score": 4},
        ],
        "labels": ["ownership", "qa"],
        "job_ids": ["job-1"],
        **over,
    }
    r = client.post("/api/stories", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


class TestCategories:
    def test_create_list_rename(self, client):
        r = client.post("/api/stories/categories", json={"name": "Requirements Capture"})
        assert r.status_code == 201
        cid = r.json()["id"]
        assert client.post("/api/stories/categories", json={"name": "requirements capture"}).status_code == 409
        r = client.patch(f"/api/stories/categories/{cid}", json={"name": "Requirements"})
        assert r.status_code == 200 and r.json()["name"] == "Requirements"
        assert client.get("/api/stories/categories").json()[0]["story_count"] == 0

    def test_rename_keeps_story_links(self, client):
        cid = client.post("/api/stories/categories", json={"name": "Arch"}).json()["id"]
        sid = make_story(client, category_id=cid)["story"]["id"]
        client.patch(f"/api/stories/categories/{cid}", json={"name": "Architecture"})
        assert client.get(f"/api/stories/{sid}").json()["category_id"] == cid

    def test_rename_to_duplicate_blocked(self, client):
        client.post("/api/stories/categories", json={"name": "One"})
        cid = client.post("/api/stories/categories", json={"name": "Two"}).json()["id"]
        assert client.patch(f"/api/stories/categories/{cid}", json={"name": "ONE"}).status_code == 409

    def test_delete_category_moves_stories_to_uncategorised(self, client):
        cid = client.post("/api/stories/categories", json={"name": "Doomed"}).json()["id"]
        sid = make_story(client, category_id=cid)["story"]["id"]
        loose = make_story(client, title="Already loose")["story"]["id"]
        r = client.delete(f"/api/stories/categories/{cid}")
        assert r.status_code == 200
        assert r.json()["stories_moved_to_uncategorised"] == 1
        moved = client.get(f"/api/stories/{sid}").json()
        assert moved["category_id"] is None
        # moved story lands after existing uncategorised ones
        assert moved["position"] > client.get(f"/api/stories/{loose}").json()["position"]

    def test_reorder_categories(self, client):
        a = client.post("/api/stories/categories", json={"name": "A"}).json()["id"]
        b = client.post("/api/stories/categories", json={"name": "B"}).json()["id"]
        assert client.put("/api/stories/categories/order", json={"ids": [b, a]}).status_code == 200
        assert [c["id"] for c in client.get("/api/stories/categories").json()] == [b, a]
        assert client.put("/api/stories/categories/order", json={"ids": [b]}).status_code == 400


class TestStoryCrud:
    def test_create_and_get_full_record(self, client):
        s = make_story(client)["story"]
        got = client.get(f"/api/stories/{s['id']}").json()
        assert got["labels"] == ["ownership", "qa"]
        assert got["job_ids"] == ["job-1"]
        assert [m["score"] for m in got["mappings"]] == [5, 4]
        assert (got["score_min"], got["score_max"]) == (4, 5)
        assert got["has_previous"] is False

    def test_empty_and_whitespace_body_rejected(self, client):
        for body in ("", "   \n\t "):
            r = client.post("/api/stories", json={"title": "X", "body": body})
            assert r.status_code == 400
            assert "body" in r.json()["detail"]

    def test_note_cannot_carry_mappings(self, client):
        r = client.post("/api/stories", json={
            "title": "Intro", "body": "Opening framing.", "kind": "note",
            "mappings": [{"question": "Q?"}],
        })
        assert r.status_code == 400
        sid = make_story(client)["story"]["id"]
        assert client.patch(f"/api/stories/{sid}", json={"kind": "note"}).status_code == 400
        r = client.patch(f"/api/stories/{sid}", json={"kind": "note", "mappings": []})
        assert r.status_code == 200
        assert r.json()["story"]["mappings"] == []

    def test_title_dup_soft_warning_same_category_only(self, client):
        cid = client.post("/api/stories/categories", json={"name": "C"}).json()["id"]
        assert make_story(client, category_id=cid)["title_dup"] is False
        assert make_story(client, category_id=cid)["title_dup"] is True   # same title, same category
        assert make_story(client, category_id=None)["title_dup"] is False  # same title, other bucket

    def test_body_save_sets_previous_and_revert_swaps(self, client):
        sid = make_story(client)["story"]["id"]
        r = client.patch(f"/api/stories/{sid}", json={"body": "v2"})
        assert r.json()["story"]["has_previous"] is True
        r = client.post(f"/api/stories/{sid}/revert")
        assert r.json()["body"] == "Led the second testing platform project."
        r = client.post(f"/api/stories/{sid}/revert")  # revert is itself revertible
        assert r.json()["body"] == "v2"

    def test_revert_without_previous_400(self, client):
        sid = make_story(client)["story"]["id"]
        assert client.post(f"/api/stories/{sid}/revert").status_code == 400

    def test_metadata_patch_does_not_touch_body_history(self, client):
        sid = make_story(client)["story"]["id"]
        r = client.patch(f"/api/stories/{sid}", json={"status": "ready", "nda_sensitive": True})
        s = r.json()["story"]
        assert (s["status"], s["nda_sensitive"], s["has_previous"]) == ("ready", True, False)

    def test_patch_unknown_story_404(self, client):
        assert client.patch("/api/stories/nope", json={"status": "ready"}).status_code == 404

    def test_link_unknown_job_rejected(self, client):
        r = client.post("/api/stories", json={"title": "X", "body": "B", "job_ids": ["ghost"]})
        assert r.status_code == 400 and "ghost" in r.json()["detail"]


class TestDeletion:
    def test_delete_story_removes_mappings_and_links(self, client):
        sid = make_story(client)["story"]["id"]
        r = client.delete(f"/api/stories/{sid}")
        assert r.json()["removed_with_it"] == {"mappings": 2, "label_links": 2, "job_links": 1}
        assert client.get(f"/api/stories/{sid}").status_code == 404
        # orphan labels pruned, job untouched
        assert client.get("/api/stories/labels").json() == []
        assert client.get("/api/tracker/job-1").status_code == 200

    def test_delete_job_unlinks_stories(self, client):
        sid = make_story(client)["story"]["id"]
        assert client.delete("/api/tracker/job-1").status_code == 200
        s = client.get(f"/api/stories/{sid}").json()
        assert s["job_ids"] == []

    def test_bulk_delete_all_or_nothing(self, client):
        ids = [make_story(client, title=f"S{i}")["story"]["id"] for i in range(3)]
        r = client.post("/api/stories/bulk-delete", json={"ids": ids[:2] + ["missing"]})
        assert r.status_code == 404
        assert len(client.get("/api/stories").json()) == 3  # rollback: nothing deleted
        r = client.post("/api/stories/bulk-delete", json={"ids": ids[:2]})
        assert r.json()["deleted"] == 2
        assert [s["id"] for s in client.get("/api/stories").json()] == [ids[2]]


class TestListing:
    def seed(self, client):
        cid = client.post("/api/stories/categories", json={"name": "Cat"}).json()["id"]
        a = make_story(client, title="Alpha", category_id=cid,
                       labels=["ownership"], status="ready")["story"]["id"]
        b = make_story(client, title="Beta", category_id=cid,
                       labels=["field"], job_ids=["job-2"])["story"]["id"]
        n = client.post("/api/stories", json={
            "title": "Intro note", "body": "Talking points.", "kind": "note",
        }).json()["story"]["id"]
        return cid, a, b, n

    def test_filters(self, client):
        cid, a, b, n = self.seed(client)
        get = lambda **q: [s["id"] for s in client.get("/api/stories", params=q).json()]
        assert get(category=cid) == [a, b]
        assert get(category="none") == [n]
        assert get(label="ownership") == [a]
        assert get(job="job-2") == [b]
        assert get(status="ready") == [a]
        assert get(kind="note") == [n]

    def test_sorts_and_reorder(self, client):
        cid, a, b, n = self.seed(client)
        get = lambda **q: [s["id"] for s in client.get("/api/stories", params=q).json()]
        assert client.put("/api/stories/order",
                          json={"category_id": cid, "ids": [b, a]}).status_code == 200
        assert get(category=cid) == [b, a]
        assert get(category=cid, sort="title") == [a, b]
        client.patch(f"/api/stories/{a}", json={"status": "draft"})
        assert get(category=cid, sort="updated") == [a, b]
        # bucket must be listed in full
        assert client.put("/api/stories/order",
                          json={"category_id": cid, "ids": [a]}).status_code == 400
