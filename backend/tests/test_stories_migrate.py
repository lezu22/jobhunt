import sqlite3

import pytest

import database
from stories import migrate


@pytest.fixture
def db(tmp_path):
    """A temp DB carrying the existing app schema (tracked_jobs), like a copy
    of the live DB would."""
    path = tmp_path / "jobhunt.db"
    orig = database.DB_PATH
    database.DB_PATH = path
    try:
        database.init_db()
        database.upsert_job({"id": "job-abc123", "title": "Robotics Engineer"})
        yield path
    finally:
        database.DB_PATH = orig


def connect(path):
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def schema_snapshot(path):
    with connect(path) as conn:
        return sorted(
            (r[0], r[1])
            for r in conn.execute(
                "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL"
            )
        )


class TestUpDown:
    def test_up_creates_all_tables(self, db):
        with connect(db) as conn:
            migrate.up(conn)
            assert migrate.applied_tables(conn) == sorted(migrate.STORY_TABLES)

    def test_up_is_idempotent(self, db):
        with connect(db) as conn:
            migrate.up(conn)
        first = schema_snapshot(db)
        with connect(db) as conn:
            migrate.up(conn)
        assert schema_snapshot(db) == first

    def test_down_removes_only_stories_tables(self, db):
        with connect(db) as conn:
            migrate.up(conn)
            migrate.down(conn)
            assert migrate.applied_tables(conn) == []
            jobs = conn.execute("SELECT id, title FROM tracked_jobs").fetchall()
        assert jobs == [("job-abc123", "Robotics Engineer")]

    def test_up_down_up_round_trip_is_stable(self, db):
        with connect(db) as conn:
            migrate.up(conn)
        first = schema_snapshot(db)
        with connect(db) as conn:
            migrate.down(conn)
            migrate.up(conn)
        assert schema_snapshot(db) == first

    def test_down_on_unmigrated_db_is_a_noop(self, db):
        before = schema_snapshot(db)
        with connect(db) as conn:
            migrate.down(conn)
        assert schema_snapshot(db) == before


class TestConstraints:
    @pytest.fixture
    def conn(self, db):
        conn = connect(db)
        migrate.up(conn)
        yield conn
        conn.close()

    def seed_story(self, conn, story_id="s1"):
        conn.execute(
            "INSERT INTO stories (id, title, body, created_at, updated_at)"
            " VALUES (?, 'T', 'B', 'now', 'now')",
            (story_id,),
        )

    def test_category_name_unique_case_insensitive(self, conn):
        conn.execute(
            "INSERT INTO story_categories (name, created_at) VALUES ('Architecture', 'now')"
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO story_categories (name, created_at) VALUES ('ARCHITECTURE', 'now')"
            )

    def test_label_name_unique_case_insensitive(self, conn):
        conn.execute("INSERT INTO labels (name) VALUES ('ros2')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO labels (name) VALUES ('ROS2')")

    def test_kind_and_status_checked(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO stories (id, title, body, kind, created_at, updated_at)"
                " VALUES ('s1', 'T', 'B', 'essay', 'now', 'now')"
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO stories (id, title, body, status, created_at, updated_at)"
                " VALUES ('s1', 'T', 'B', 'polished', 'now', 'now')"
            )

    def test_score_range_checked_and_nullable(self, conn):
        self.seed_story(conn)
        conn.execute(
            "INSERT INTO question_mappings (story_id, question, score) VALUES ('s1', 'Q', NULL)"
        )
        conn.execute(
            "INSERT INTO question_mappings (story_id, question, score) VALUES ('s1', 'Q', 5)"
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO question_mappings (story_id, question, score) VALUES ('s1', 'Q', 6)"
            )

    def test_delete_story_cascades_mappings_and_links(self, conn):
        self.seed_story(conn)
        conn.execute("INSERT INTO question_mappings (story_id, question) VALUES ('s1', 'Q')")
        conn.execute("INSERT INTO labels (name) VALUES ('ros2')")
        conn.execute("INSERT INTO story_label_links (story_id, label_id) VALUES ('s1', 1)")
        conn.execute(
            "INSERT INTO story_job_links (story_id, job_id) VALUES ('s1', 'job-abc123')"
        )
        conn.execute("DELETE FROM stories WHERE id = 's1'")
        for table in ("question_mappings", "story_label_links", "story_job_links"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
        # the label itself and the job survive
        assert conn.execute("SELECT COUNT(*) FROM labels").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM tracked_jobs").fetchone()[0] == 1

    def test_delete_job_cascades_link_not_story(self, conn):
        self.seed_story(conn)
        conn.execute(
            "INSERT INTO story_job_links (story_id, job_id) VALUES ('s1', 'job-abc123')"
        )
        conn.execute("DELETE FROM tracked_jobs WHERE id = 'job-abc123'")
        assert conn.execute("SELECT COUNT(*) FROM story_job_links").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM stories").fetchone()[0] == 1

    def test_delete_category_sets_story_uncategorised(self, conn):
        conn.execute(
            "INSERT INTO story_categories (name, created_at) VALUES ('Architecture', 'now')"
        )
        conn.execute(
            "INSERT INTO stories (id, title, body, category_id, created_at, updated_at)"
            " VALUES ('s1', 'T', 'B', 1, 'now', 'now')"
        )
        conn.execute("DELETE FROM story_categories WHERE id = 1")
        assert conn.execute("SELECT category_id FROM stories WHERE id='s1'").fetchone()[0] is None
