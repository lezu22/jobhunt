"""
stories/db.py — data access for the Work Stories feature.

Raw sqlite3 in the same style as database.py. Every connection enables
foreign_keys so the schema's ON DELETE rules actually fire.
"""

import sqlite3
import uuid
from datetime import datetime
from typing import Optional

import database


class NotFound(LookupError):
    pass


class DuplicateName(ValueError):
    pass


class InvalidInput(ValueError):
    pass


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(database.DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _now() -> str:
    return datetime.utcnow().isoformat()


# ─── Categories ──────────────────────────────────────────────────────────────

def list_categories() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("""
            SELECT c.id, c.name, c.position, c.created_at, COUNT(s.id) AS story_count
            FROM story_categories c LEFT JOIN stories s ON s.category_id = c.id
            GROUP BY c.id ORDER BY c.position, c.id
        """).fetchall()
    return [dict(r) for r in rows]


def create_category(name: str) -> dict:
    name = name.strip()
    if not name:
        raise InvalidInput("category name cannot be empty")
    with _connect() as conn:
        pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM story_categories"
        ).fetchone()[0]
        try:
            cur = conn.execute(
                "INSERT INTO story_categories (name, position, created_at) VALUES (?, ?, ?)",
                (name, pos, _now()),
            )
        except sqlite3.IntegrityError:
            raise DuplicateName(f"a category named '{name}' already exists")
        conn.commit()
        cid = cur.lastrowid
    return {"id": cid, "name": name, "position": pos, "story_count": 0}


def rename_category(cid: int, name: str) -> dict:
    name = name.strip()
    if not name:
        raise InvalidInput("category name cannot be empty")
    with _connect() as conn:
        if not conn.execute("SELECT 1 FROM story_categories WHERE id=?", (cid,)).fetchone():
            raise NotFound(f"category {cid} not found")
        try:
            conn.execute("UPDATE story_categories SET name=? WHERE id=?", (name, cid))
        except sqlite3.IntegrityError:
            raise DuplicateName(f"a category named '{name}' already exists")
        conn.commit()
    return next(c for c in list_categories() if c["id"] == cid)


def delete_category(cid: int) -> int:
    """Delete a category; its stories move to the end of uncategorised.
    Returns how many stories moved."""
    with _connect() as conn:
        if not conn.execute("SELECT 1 FROM story_categories WHERE id=?", (cid,)).fetchone():
            raise NotFound(f"category {cid} not found")
        moving = [r["id"] for r in conn.execute(
            "SELECT id FROM stories WHERE category_id=? ORDER BY position, id", (cid,)
        )]
        base = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM stories WHERE category_id IS NULL"
        ).fetchone()[0]
        for offset, sid in enumerate(moving):
            conn.execute(
                "UPDATE stories SET category_id=NULL, position=? WHERE id=?",
                (base + offset, sid),
            )
        conn.execute("DELETE FROM story_categories WHERE id=?", (cid,))
        conn.commit()
    return len(moving)


def reorder_categories(ids: list[int]) -> None:
    with _connect() as conn:
        existing = {r["id"] for r in conn.execute("SELECT id FROM story_categories")}
        if set(ids) != existing or len(ids) != len(existing):
            raise InvalidInput("order must list every category id exactly once")
        for pos, cid in enumerate(ids):
            conn.execute("UPDATE story_categories SET position=? WHERE id=?", (pos, cid))
        conn.commit()


# ─── Labels ──────────────────────────────────────────────────────────────────

def list_labels() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("""
            SELECT l.id, l.name, COUNT(sl.story_id) AS story_count
            FROM labels l LEFT JOIN story_label_links sl ON sl.label_id = l.id
            GROUP BY l.id ORDER BY l.name COLLATE NOCASE
        """).fetchall()
    return [dict(r) for r in rows]


def _set_labels(conn: sqlite3.Connection, sid: str, names: list[str]) -> None:
    cleaned = []
    for n in names:
        n = n.strip()
        if n and n.lower() not in [c.lower() for c in cleaned]:
            cleaned.append(n)
    conn.execute("DELETE FROM story_label_links WHERE story_id=?", (sid,))
    for n in cleaned:
        row = conn.execute("SELECT id FROM labels WHERE name=?", (n,)).fetchone()
        lid = row["id"] if row else conn.execute(
            "INSERT INTO labels (name) VALUES (?)", (n,)
        ).lastrowid
        conn.execute(
            "INSERT INTO story_label_links (story_id, label_id) VALUES (?, ?)", (sid, lid)
        )


def _prune_orphan_labels(conn: sqlite3.Connection) -> None:
    conn.execute(
        "DELETE FROM labels WHERE id NOT IN (SELECT DISTINCT label_id FROM story_label_links)"
    )


# ─── Stories ─────────────────────────────────────────────────────────────────

def _set_job_links(conn: sqlite3.Connection, sid: str, job_ids: list[str]) -> None:
    job_ids = list(dict.fromkeys(job_ids))
    missing = [
        j for j in job_ids
        if not conn.execute("SELECT 1 FROM tracked_jobs WHERE id=?", (j,)).fetchone()
    ]
    if missing:
        raise InvalidInput(f"unknown job id(s): {missing}")
    conn.execute("DELETE FROM story_job_links WHERE story_id=?", (sid,))
    for j in job_ids:
        conn.execute("INSERT INTO story_job_links (story_id, job_id) VALUES (?, ?)", (sid, j))


def _set_mappings(conn: sqlite3.Connection, sid: str, mappings: list[dict]) -> None:
    conn.execute("DELETE FROM question_mappings WHERE story_id=?", (sid,))
    for pos, m in enumerate(mappings):
        q = m["question"].strip()
        if not q:
            raise InvalidInput("question text cannot be empty")
        conn.execute(
            "INSERT INTO question_mappings (story_id, question, score, note, position)"
            " VALUES (?, ?, ?, ?, ?)",
            (sid, q, m.get("score"), m.get("note"), pos),
        )


def _title_dup(conn: sqlite3.Connection, sid: str, title: str, category_id) -> bool:
    """Soft warning: another story with the exact (case-insensitive) title in
    the same category bucket."""
    row = conn.execute(
        "SELECT 1 FROM stories WHERE id != ? AND title = ? COLLATE NOCASE"
        " AND category_id IS ?",
        (sid, title, category_id),
    ).fetchone()
    return row is not None


def _full_story(conn: sqlite3.Connection, sid: str) -> dict:
    row = conn.execute("SELECT * FROM stories WHERE id=?", (sid,)).fetchone()
    if not row:
        raise NotFound(f"story {sid} not found")
    story = dict(row)
    story["nda_sensitive"] = bool(story["nda_sensitive"])
    story["labels"] = [r["name"] for r in conn.execute(
        "SELECT l.name FROM labels l JOIN story_label_links sl ON sl.label_id=l.id"
        " WHERE sl.story_id=? ORDER BY l.name COLLATE NOCASE", (sid,)
    )]
    story["job_ids"] = [r["job_id"] for r in conn.execute(
        "SELECT job_id FROM story_job_links WHERE story_id=? ORDER BY job_id", (sid,)
    )]
    story["mappings"] = [dict(r) for r in conn.execute(
        "SELECT id, question, score, note, position FROM question_mappings"
        " WHERE story_id=? ORDER BY position, id", (sid,)
    )]
    scores = [m["score"] for m in story["mappings"] if m["score"] is not None]
    story["score_min"] = min(scores) if scores else None
    story["score_max"] = max(scores) if scores else None
    story["has_previous"] = story.pop("previous_body") is not None
    return story


def _validate_category(conn: sqlite3.Connection, category_id) -> None:
    if category_id is not None and not conn.execute(
        "SELECT 1 FROM story_categories WHERE id=?", (category_id,)
    ).fetchone():
        raise InvalidInput(f"unknown category id {category_id}")


def create_story(p: dict) -> tuple[dict, bool]:
    title = p["title"].strip()
    if not title:
        raise InvalidInput("title cannot be empty")
    if not p["body"].strip():
        raise InvalidInput("body cannot be empty or whitespace-only")
    if p["kind"] == "note" and p["mappings"]:
        raise InvalidInput("notes cannot have question mappings")
    sid = uuid.uuid4().hex
    now = _now()
    with _connect() as conn:
        _validate_category(conn, p["category_id"])
        pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM stories WHERE category_id IS ?",
            (p["category_id"],),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO stories (id, title, body, kind, category_id, status,"
            " nda_sensitive, position, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, title, p["body"], p["kind"], p["category_id"], p["status"],
             int(p["nda_sensitive"]), pos, now, now),
        )
        _set_mappings(conn, sid, p["mappings"])
        _set_labels(conn, sid, p["labels"])
        _set_job_links(conn, sid, p["job_ids"])
        dup = _title_dup(conn, sid, title, p["category_id"])
        conn.commit()
        return _full_story(conn, sid), dup


def get_story(sid: str) -> dict:
    with _connect() as conn:
        return _full_story(conn, sid)


def update_story(sid: str, fields: dict) -> tuple[dict, bool]:
    """Apply a partial update. `fields` holds only the keys actually sent.
    Body updates copy the old body into previous_body first (one-level revert).
    Switching kind to note requires mappings to be gone (or cleared in the
    same call)."""
    with _connect() as conn:
        row = conn.execute("SELECT * FROM stories WHERE id=?", (sid,)).fetchone()
        if not row:
            raise NotFound(f"story {sid} not found")
        current = dict(row)

        new_kind = fields.get("kind", current["kind"])
        if new_kind == "note":
            if fields.get("mappings"):
                raise InvalidInput("notes cannot have question mappings")
            if "mappings" not in fields and current["kind"] != "note":
                n = conn.execute(
                    "SELECT COUNT(*) FROM question_mappings WHERE story_id=?", (sid,)
                ).fetchone()[0]
                if n:
                    raise InvalidInput(
                        f"cannot change to note while {n} question mapping(s) exist;"
                        " remove them first (send mappings: [])"
                    )

        sets, params = [], []
        if "title" in fields:
            title = fields["title"].strip()
            if not title:
                raise InvalidInput("title cannot be empty")
            sets.append("title=?"); params.append(title)
        if "body" in fields:
            if not fields["body"].strip():
                raise InvalidInput("body cannot be empty or whitespace-only")
            sets.append("previous_body=?"); params.append(current["body"])
            sets.append("body=?"); params.append(fields["body"])
        if "kind" in fields:
            sets.append("kind=?"); params.append(fields["kind"])
        if "category_id" in fields and fields["category_id"] != current["category_id"]:
            _validate_category(conn, fields["category_id"])
            pos = conn.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM stories WHERE category_id IS ?",
                (fields["category_id"],),
            ).fetchone()[0]
            sets.append("category_id=?"); params.append(fields["category_id"])
            sets.append("position=?"); params.append(pos)
        if "status" in fields:
            sets.append("status=?"); params.append(fields["status"])
        if "nda_sensitive" in fields:
            sets.append("nda_sensitive=?"); params.append(int(fields["nda_sensitive"]))

        if sets:
            sets.append("updated_at=?"); params.append(_now())
            conn.execute(f"UPDATE stories SET {', '.join(sets)} WHERE id=?", (*params, sid))
        if "mappings" in fields:
            _set_mappings(conn, sid, fields["mappings"])
        if "labels" in fields:
            _set_labels(conn, sid, fields["labels"])
            _prune_orphan_labels(conn)
        if "job_ids" in fields:
            _set_job_links(conn, sid, fields["job_ids"])
        if not sets and any(k in fields for k in ("mappings", "labels", "job_ids")):
            conn.execute("UPDATE stories SET updated_at=? WHERE id=?", (_now(), sid))

        story = _full_story(conn, sid)
        dup = _title_dup(conn, sid, story["title"], story["category_id"])
        conn.commit()
        return story, dup


def revert_story(sid: str) -> dict:
    """Swap body and previous_body (so a revert can itself be undone)."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT body, previous_body FROM stories WHERE id=?", (sid,)
        ).fetchone()
        if not row:
            raise NotFound(f"story {sid} not found")
        if row["previous_body"] is None:
            raise InvalidInput("no previous save to revert to")
        conn.execute(
            "UPDATE stories SET body=?, previous_body=?, updated_at=? WHERE id=?",
            (row["previous_body"], row["body"], _now(), sid),
        )
        story = _full_story(conn, sid)
        conn.commit()
        return story


def list_stories(category=None, label: Optional[str] = None, job: Optional[str] = None,
                 status: Optional[str] = None, kind: Optional[str] = None,
                 sort: str = "position") -> list[dict]:
    """category: None = all, 'none' = uncategorised bucket, or a category id."""
    where, params = [], []
    joins = ""
    if category == "none":
        where.append("s.category_id IS NULL")
    elif category is not None:
        where.append("s.category_id = ?"); params.append(int(category))
    if label is not None:
        joins += (" JOIN story_label_links fl ON fl.story_id = s.id"
                  " JOIN labels flb ON flb.id = fl.label_id")
        where.append("flb.name = ? COLLATE NOCASE"); params.append(label)
    if job is not None:
        joins += " JOIN story_job_links fj ON fj.story_id = s.id"
        where.append("fj.job_id = ?"); params.append(job)
    if status is not None:
        where.append("s.status = ?"); params.append(status)
    if kind is not None:
        where.append("s.kind = ?"); params.append(kind)

    order = {
        "position": "s.position, s.id",
        "updated": "s.updated_at DESC",
        "title": "s.title COLLATE NOCASE",
    }.get(sort)
    if order is None:
        raise InvalidInput(f"unknown sort '{sort}'")

    sql = f"SELECT DISTINCT s.id FROM stories s{joins}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" ORDER BY {order}"
    with _connect() as conn:
        ids = [r["id"] for r in conn.execute(sql, params)]
        return [_full_story(conn, sid) for sid in ids]


def delete_story(sid: str) -> dict:
    """Hard delete. Returns counts of what went with it."""
    with _connect() as conn:
        if not conn.execute("SELECT 1 FROM stories WHERE id=?", (sid,)).fetchone():
            raise NotFound(f"story {sid} not found")
        counts = {
            "mappings": conn.execute(
                "SELECT COUNT(*) FROM question_mappings WHERE story_id=?", (sid,)).fetchone()[0],
            "label_links": conn.execute(
                "SELECT COUNT(*) FROM story_label_links WHERE story_id=?", (sid,)).fetchone()[0],
            "job_links": conn.execute(
                "SELECT COUNT(*) FROM story_job_links WHERE story_id=?", (sid,)).fetchone()[0],
        }
        conn.execute("DELETE FROM stories WHERE id=?", (sid,))
        _prune_orphan_labels(conn)
        conn.commit()
    return counts


def bulk_delete(ids: list[str]) -> int:
    """Delete every listed story in one transaction; any failure rolls the
    whole thing back and reports the offending id."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise InvalidInput("no story ids given")
    conn = _connect()
    try:
        conn.execute("BEGIN")
        for sid in ids:
            cur = conn.execute("DELETE FROM stories WHERE id=?", (sid,))
            if cur.rowcount != 1:
                raise NotFound(f"story {sid} not found")
        _prune_orphan_labels(conn)
        conn.commit()
        return len(ids)
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def bulk_move(ids: list[str], category_id) -> int:
    """Move every listed story into one category bucket (None = uncategorised)
    in a single transaction, appended after the bucket's existing stories in
    the given order. Any missing story rolls the whole thing back."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise InvalidInput("no story ids given")
    conn = _connect()
    try:
        conn.execute("BEGIN")
        _validate_category(conn, category_id)
        base = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM stories WHERE category_id IS ?",
            (category_id,),
        ).fetchone()[0]
        now = _now()
        moved = 0
        for sid in ids:
            row = conn.execute("SELECT category_id FROM stories WHERE id=?", (sid,)).fetchone()
            if row is None:
                raise NotFound(f"story {sid} not found")
            if row["category_id"] == category_id:
                continue  # already there; leave its position alone
            conn.execute(
                "UPDATE stories SET category_id=?, position=?, updated_at=? WHERE id=?",
                (category_id, base + moved, now, sid),
            )
            moved += 1
        conn.commit()
        return moved
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─── Import ──────────────────────────────────────────────────────────────────

BODY_SIM_THRESHOLD = 0.80  # only surface near-duplicates (user-set floor; edited copies land 80-95%)
BODY_SIM_TOP = 3


def stage_import(parsed: dict) -> dict:
    """Enrich parser output with read-only duplicate/category matches from the
    DB — exact-id matches, normalised-title matches (all categories, the UI
    scopes the strong flag), and body-text similarity. Commits nothing."""
    from .parser import normalise_title, shingles, similarity
    with _connect() as conn:
        cat_info = []
        for name in parsed["categories"]:
            row = conn.execute(
                "SELECT id, name FROM story_categories WHERE name = ?", (name,)
            ).fetchone()  # column is COLLATE NOCASE
            cat_info.append({
                "name": name,
                "match": dict(row) if row else None,
                "record_count": sum(1 for r in parsed["records"] if r["category"] == name),
            })
        parsed["categories"] = cat_info

        existing = conn.execute("SELECT id, title, category_id, body FROM stories").fetchall()
        by_norm: dict[str, list] = {}
        by_id = {r["id"]: r for r in existing}
        body_sh = {r["id"]: shingles(r["body"]) for r in existing}
        for r in existing:
            by_norm.setdefault(normalise_title(r["title"]), []).append(r)
        for rec in parsed["records"]:
            rec_sh = shingles(rec["body"])
            sim = lambda sid: round(similarity(rec_sh, body_sh[sid]), 2)
            meta_id = (rec.get("meta") or {}).get("id")
            hit = by_id.get(meta_id)
            rec["dup_id_match"] = (
                {"story_id": hit["id"], "title": hit["title"],
                 "category_id": hit["category_id"], "similarity": sim(hit["id"])}
                if hit else None
            )
            rec["dup_title_matches"] = [
                {"story_id": r["id"], "title": r["title"],
                 "category_id": r["category_id"], "similarity": sim(r["id"])}
                for r in by_norm.get(normalise_title(rec["title"]), [])
            ]
            titled = {m["story_id"] for m in rec["dup_title_matches"]}
            scored = sorted(
                ((similarity(rec_sh, sh), sid) for sid, sh in body_sh.items() if sid not in titled),
                reverse=True,
            )
            rec["body_matches"] = [
                {"story_id": sid, "title": by_id[sid]["title"],
                 "category_id": by_id[sid]["category_id"], "similarity": round(s, 2)}
                for s, sid in scored[:BODY_SIM_TOP] if s >= BODY_SIM_THRESHOLD
            ]
    return parsed


def _import_job_links(conn, sid: str, job_ids: list[str]) -> int:
    """Like _set_job_links but silently drops unknown jobs (a job named in an
    old export may have been deleted since). Returns how many were dropped."""
    conn.execute("DELETE FROM story_job_links WHERE story_id=?", (sid,))
    dropped = 0
    for j in dict.fromkeys(job_ids):
        if conn.execute("SELECT 1 FROM tracked_jobs WHERE id=?", (j,)).fetchone():
            conn.execute("INSERT INTO story_job_links (story_id, job_id) VALUES (?, ?)", (sid, j))
        else:
            dropped += 1
    return dropped


def import_commit(records: list[dict]) -> dict:
    """Apply reviewed import decisions in ONE transaction. Any failure rolls
    back the entire import and names the offending record."""
    if not records:
        raise InvalidInput("nothing to import")
    conn = _connect()
    try:
        conn.execute("BEGIN")
        created = updated = skipped = dropped_links = 0
        cats_created: list[str] = []
        cat_cache: dict[str, int] = {}  # casefolded name -> id

        def resolve_category(rec) -> int | None:
            if rec.get("category_id") is not None:
                if not conn.execute(
                    "SELECT 1 FROM story_categories WHERE id=?", (rec["category_id"],)
                ).fetchone():
                    raise InvalidInput(f"record '{rec['title']}': unknown category id {rec['category_id']}")
                return rec["category_id"]
            name = (rec.get("new_category_name") or "").strip()
            if not name:
                return None
            key = name.casefold()
            if key in cat_cache:
                return cat_cache[key]
            row = conn.execute("SELECT id FROM story_categories WHERE name = ?", (name,)).fetchone()
            if row:
                cat_cache[key] = row["id"]
                return row["id"]
            pos = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM story_categories").fetchone()[0]
            cid = conn.execute(
                "INSERT INTO story_categories (name, position, created_at) VALUES (?, ?, ?)",
                (name, pos, _now()),
            ).lastrowid
            cat_cache[key] = cid
            cats_created.append(name)
            return cid

        for rec in records:
            action = rec["action"]
            if action == "skip":
                skipped += 1
                continue
            title = rec["title"].strip()
            if not title:
                raise InvalidInput("a record has an empty title")
            if not rec["body"].strip():
                raise InvalidInput(f"record '{title}': body is empty or whitespace-only")
            if rec["kind"] == "note" and rec["mappings"]:
                raise InvalidInput(f"record '{title}': notes cannot have question mappings")
            cid = resolve_category(rec)
            now = _now()

            if action == "update":
                sid = rec.get("target_story_id")
                old = conn.execute("SELECT body FROM stories WHERE id=?", (sid,)).fetchone()
                if old is None:
                    raise NotFound(f"record '{title}': target story {sid} not found")
                # keep position unless the category changes
                cur_cat = conn.execute("SELECT category_id FROM stories WHERE id=?", (sid,)).fetchone()[0]
                if cur_cat != cid:
                    newpos = conn.execute(
                        "SELECT COALESCE(MAX(position), -1) + 1 FROM stories WHERE category_id IS ?", (cid,)
                    ).fetchone()[0]
                    conn.execute("UPDATE stories SET position=? WHERE id=?", (newpos, sid))
                conn.execute(
                    "UPDATE stories SET title=?, previous_body=body, body=?, kind=?,"
                    " category_id=?, status=?, nda_sensitive=?, updated_at=? WHERE id=?",
                    (title, rec["body"], rec["kind"], cid, rec["status"],
                     int(rec["nda_sensitive"]), now, sid),
                )
                updated += 1
            else:  # create
                sid = uuid.uuid4().hex
                pos = conn.execute(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM stories WHERE category_id IS ?", (cid,)
                ).fetchone()[0]
                conn.execute(
                    "INSERT INTO stories (id, title, body, kind, category_id, status,"
                    " nda_sensitive, position, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (sid, title, rec["body"], rec["kind"], cid, rec["status"],
                     int(rec["nda_sensitive"]), pos, now, now),
                )
                created += 1

            _set_mappings(conn, sid, rec["mappings"])
            _set_labels(conn, sid, rec["labels"])
            dropped_links += _import_job_links(conn, sid, rec["job_ids"])

        _prune_orphan_labels(conn)
        conn.commit()
        return {
            "created": created, "updated": updated, "skipped": skipped,
            "categories_created": cats_created, "dropped_job_links": dropped_links,
        }
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def reorder_stories(category_id, ids: list[str]) -> None:
    """Set the order of one category bucket (category_id None = uncategorised).
    Must list every story in that bucket exactly once."""
    with _connect() as conn:
        _validate_category(conn, category_id)
        bucket = {r["id"] for r in conn.execute(
            "SELECT id FROM stories WHERE category_id IS ?", (category_id,)
        )}
        if set(ids) != bucket or len(ids) != len(bucket):
            raise InvalidInput("order must list every story in the bucket exactly once")
        for pos, sid in enumerate(ids):
            conn.execute("UPDATE stories SET position=? WHERE id=?", (pos, sid))
        conn.commit()
