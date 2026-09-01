import pytest

# Reuse the app/client fixture wiring
from tests.test_stories_crud import client, make_story  # noqa: F401


def seed(client):
    s_question = client.post("/api/stories", json={
        "title": "Boot rework", "body": "Narrowed the feature to what was testable.",
        "mappings": [
            {"question": "Tell me about a time you had to push back on scope.", "score": 5},
        ],
    }).json()["story"]["id"]
    s_body = client.post("/api/stories", json={
        "title": "Deployment diary",
        "body": "The customer pushed back on the delivery date, so we re-planned the rollout.",
    }).json()["story"]["id"]
    s_low = client.post("/api/stories", json={
        "title": "Weak fit", "body": "Another story.",
        "mappings": [{"question": "Describe pushing back on a decision.", "score": 2}],
    }).json()["story"]["id"]
    s_none = client.post("/api/stories", json={
        "title": "Power budget", "body": "Fusing and battery bus design.",
        "mappings": [{"question": "Walk me through a power design.", "score": 4}],
    }).json()["story"]["id"]
    return s_question, s_body, s_low, s_none


class TestSearch:
    def test_stemmed_match_pushed_back_finds_push_back_on_scope(self, client):
        s_question, *_ = seed(client)
        res = client.get("/api/stories/search", params={"q": "pushed back"}).json()
        assert res, "stemmed search returned nothing"
        top = res[0]
        assert top["id"] == s_question
        assert top["match"]["type"] == "question"
        assert top["match"]["question"] == "Tell me about a time you had to push back on scope."
        assert top["match"]["score"] == 5

    def test_question_matches_rank_above_body_only(self, client):
        s_question, s_body, s_low, s_none = seed(client)
        res = client.get("/api/stories/search", params={"q": "pushed back"}).json()
        ids = [r["id"] for r in res]
        assert s_body in ids and s_none not in ids
        # both question-matching stories come before the body-only match
        assert ids.index(s_question) < ids.index(s_body)
        assert ids.index(s_low) < ids.index(s_body)
        body_hit = next(r for r in res if r["id"] == s_body)
        assert body_hit["match"]["type"] == "content"
        assert "pushed back" in body_hit["match"]["snippet"]

    def test_tie_between_questions_broken_by_score_desc(self, client):
        s_question, _, s_low, _ = seed(client)
        res = client.get("/api/stories/search", params={"q": "pushed back"}).json()
        qs = [r["id"] for r in res if r["match"]["type"] == "question"]
        assert qs.index(s_question) < qs.index(s_low)  # 5/5 before 2/5

    def test_prefix_match_while_typing(self, client):
        s_question, *_ = seed(client)
        res = client.get("/api/stories/search", params={"q": "sco"}).json()
        assert s_question in [r["id"] for r in res]  # 'sco*' hits scope

    def test_no_results_and_junk_queries(self, client):
        seed(client)
        assert client.get("/api/stories/search", params={"q": "zzzunfindable"}).json() == []
        assert client.get("/api/stories/search", params={"q": "   "}).json() == []
        assert client.get("/api/stories/search", params={"q": '"(*&^"'}).json() == []

    def test_index_stays_in_sync_through_crud(self, client):
        sid = client.post("/api/stories", json={
            "title": "Sync check", "body": "original text about odometry",
        }).json()["story"]["id"]
        assert [r["id"] for r in client.get("/api/stories/search", params={"q": "odometry"}).json()] == [sid]
        client.patch(f"/api/stories/{sid}", json={"body": "now about localisation instead"})
        assert client.get("/api/stories/search", params={"q": "odometry"}).json() == []
        assert [r["id"] for r in client.get("/api/stories/search", params={"q": "localisation"}).json()] == [sid]
        client.patch(f"/api/stories/{sid}", json={"mappings": [{"question": "Mapping about gyroscopes?", "score": 3}]})
        hit = client.get("/api/stories/search", params={"q": "gyroscope"}).json()[0]
        assert hit["match"]["type"] == "question"
        client.delete(f"/api/stories/{sid}")
        assert client.get("/api/stories/search", params={"q": "localisation"}).json() == []
        assert client.get("/api/stories/search", params={"q": "gyroscope"}).json() == []

    def test_import_commit_is_indexed(self, client):
        recs = [{"action": "create", "title": "Imported one", "kind": "story",
                 "body": "Contains the word flibbertigibbet.",
                 "mappings": [{"question": "About thermal budgets?", "score": 4}]}]
        client.post("/api/stories/import/commit", json={"records": recs})
        assert client.get("/api/stories/search", params={"q": "flibbertigibbet"}).json()
        assert client.get("/api/stories/search", params={"q": "thermal budget"}).json()


class TestQuestionList:
    def test_distinct_questions_with_usage_and_best_score(self, client):
        for title, score in (("A", 5), ("B", 3)):
            client.post("/api/stories", json={
                "title": title, "body": "b",
                "mappings": [{"question": "Tell me about ownership.", "score": score}],
            })
        client.post("/api/stories", json={
            "title": "C", "body": "b",
            "mappings": [{"question": "TELL ME ABOUT OWNERSHIP.", "score": 1},
                          {"question": "Unique question?", "score": None}],
        })
        qs = client.get("/api/stories/questions").json()
        own = next(q for q in qs if "ownership" in q["question"].lower())
        assert own["uses"] == 3 and own["best_score"] == 5  # case-insensitive grouping
        assert qs[0] == own  # most-used first
        uniq = next(q for q in qs if q["question"] == "Unique question?")
        assert uniq["uses"] == 1 and uniq["best_score"] is None

    def test_filter_stories_by_question(self, client):
        a = client.post("/api/stories", json={
            "title": "A", "body": "b",
            "mappings": [{"question": "Tell me about ownership.", "score": 5}],
        }).json()["story"]["id"]
        b = client.post("/api/stories", json={
            "title": "B", "body": "b",
            "mappings": [{"question": "tell me about OWNERSHIP.", "score": 2}],
        }).json()["story"]["id"]
        client.post("/api/stories", json={"title": "C", "body": "b",
                                          "mappings": [{"question": "Other?", "score": 1}]})
        got = client.get("/api/stories", params={"question": "Tell me about ownership."}).json()
        assert sorted(s["id"] for s in got) == sorted([a, b])  # case-insensitive, both users of it


class TestMigrationBackfill:
    def test_backfill_on_upgrade(self, client, tmp_path):
        """A DB created before search gets its FTS table populated by up()."""
        import database
        from stories import migrate
        seed(client)
        with migrate.sqlite3.connect(str(database.DB_PATH)) as conn:
            conn.execute("DROP TABLE story_search")
            conn.commit()
            migrate.up(conn)
            n = conn.execute("SELECT COUNT(*) FROM story_search").fetchone()[0]
            stories = conn.execute("SELECT COUNT(*) FROM stories").fetchone()[0]
            maps = conn.execute("SELECT COUNT(*) FROM question_mappings").fetchone()[0]
        assert n == stories + maps
        res = client.get("/api/stories/search", params={"q": "pushed back"}).json()
        assert res and res[0]["match"]["type"] == "question"
