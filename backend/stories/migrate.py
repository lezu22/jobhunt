"""
stories/migrate.py — schema migration for the Work Stories feature.

All-new tables; tracked_jobs is never touched. `up` is idempotent and is also
run at app startup. `down` drops every stories table (clean rollback).

CLI (from backend/):
    python3 -m stories.migrate up   [--db PATH]
    python3 -m stories.migrate down [--db PATH]
    python3 -m stories.migrate status [--db PATH]
"""

import argparse
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[1] / "data" / "jobhunt.db"

# Drop order: children before parents.
STORY_TABLES = [
    "story_job_links",
    "story_label_links",
    "labels",
    "question_mappings",
    "stories",
    "story_categories",
]

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS story_categories (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS stories (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        body          TEXT NOT NULL,
        kind          TEXT NOT NULL DEFAULT 'story'
                      CHECK (kind IN ('story', 'note')),
        category_id   INTEGER REFERENCES story_categories(id) ON DELETE SET NULL,
        status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'gap', 'ready')),
        nda_sensitive INTEGER NOT NULL DEFAULT 0,
        position      INTEGER NOT NULL DEFAULT 0,
        previous_body TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category_id)",
    """
    CREATE TABLE IF NOT EXISTS question_mappings (
        id        INTEGER PRIMARY KEY,
        story_id  TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        question  TEXT NOT NULL,
        score     INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 5),
        note      TEXT,
        position  INTEGER NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_question_mappings_story ON question_mappings(story_id)",
    """
    CREATE TABLE IF NOT EXISTS labels (
        id    INTEGER PRIMARY KEY,
        name  TEXT NOT NULL COLLATE NOCASE UNIQUE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS story_label_links (
        story_id  TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        label_id  INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (story_id, label_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_story_label_links_label ON story_label_links(label_id)",
    """
    CREATE TABLE IF NOT EXISTS story_job_links (
        story_id  TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        job_id    TEXT NOT NULL REFERENCES tracked_jobs(id) ON DELETE CASCADE,
        PRIMARY KEY (story_id, job_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_story_job_links_job ON story_job_links(job_id)",
]


def up(conn: sqlite3.Connection) -> None:
    for stmt in SCHEMA:
        conn.execute(stmt)
    conn.commit()


def down(conn: sqlite3.Connection) -> None:
    for table in STORY_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.commit()


def applied_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ({})".format(
            ",".join("?" * len(STORY_TABLES))
        ),
        STORY_TABLES,
    ).fetchall()
    return sorted(r[0] for r in rows)


def migrate(db_path: Path | str = DEFAULT_DB) -> None:
    """Idempotent apply, used by app startup."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        up(conn)
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["up", "down", "status"])
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()

    conn = sqlite3.connect(str(args.db))
    try:
        if args.action == "up":
            up(conn)
            print(f"up OK: {args.db}")
        elif args.action == "down":
            down(conn)
            print(f"down OK: {args.db}")
        present = applied_tables(conn)
        missing = sorted(set(STORY_TABLES) - set(present))
        print(f"stories tables present: {present or 'none'}")
        if missing and args.action != "down":
            print(f"missing: {missing}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
