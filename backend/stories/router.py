"""
stories/router.py — /api/stories endpoints.

Static paths (categories, labels, order, bulk-delete) are declared before the
/{story_id} routes so they can't be swallowed by the dynamic segment.
"""

from fastapi import APIRouter, HTTPException

from . import db
from .models import (
    BulkDeleteIn, BulkMoveIn, CategoryIn, OrderIds, StoryCreate, StoryOrder, StoryUpdate,
)

router = APIRouter(prefix="/api/stories", tags=["stories"])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except db.NotFound as e:
        raise HTTPException(404, str(e))
    except db.DuplicateName as e:
        raise HTTPException(409, str(e))
    except db.InvalidInput as e:
        raise HTTPException(400, str(e))


# ─── Categories ──────────────────────────────────────────────────────────────

@router.get("/categories")
def get_categories():
    return db.list_categories()


@router.post("/categories", status_code=201)
def post_category(payload: CategoryIn):
    return _guard(db.create_category, payload.name)


@router.put("/categories/order")
def put_category_order(payload: OrderIds):
    _guard(db.reorder_categories, payload.ids)
    return {"ok": True}


@router.patch("/categories/{cid}")
def patch_category(cid: int, payload: CategoryIn):
    return _guard(db.rename_category, cid, payload.name)


@router.delete("/categories/{cid}")
def delete_category(cid: int):
    moved = _guard(db.delete_category, cid)
    return {"deleted": cid, "stories_moved_to_uncategorised": moved}


# ─── Labels ──────────────────────────────────────────────────────────────────

@router.get("/labels")
def get_labels():
    return db.list_labels()


# ─── Stories: static paths ───────────────────────────────────────────────────

@router.put("/order")
def put_story_order(payload: StoryOrder):
    _guard(db.reorder_stories, payload.category_id, payload.ids)
    return {"ok": True}


@router.post("/bulk-delete")
def post_bulk_delete(payload: BulkDeleteIn):
    deleted = _guard(db.bulk_delete, payload.ids)
    return {"deleted": deleted}


@router.post("/bulk-move")
def post_bulk_move(payload: BulkMoveIn):
    moved = _guard(db.bulk_move, payload.ids, payload.category_id)
    return {"moved": moved}


# ─── Stories: collection + record ────────────────────────────────────────────

@router.get("")
def get_stories(category: str | None = None, label: str | None = None,
                job: str | None = None, status: str | None = None,
                kind: str | None = None, sort: str = "position"):
    if category is not None and category != "none":
        try:
            category = int(category)
        except ValueError:
            raise HTTPException(400, "category must be an id or 'none'")
    return _guard(db.list_stories, category=category, label=label, job=job,
                  status=status, kind=kind, sort=sort)


@router.post("", status_code=201)
def post_story(payload: StoryCreate):
    story, dup = _guard(db.create_story, payload.model_dump())
    return {"story": story, "title_dup": dup}


@router.get("/{story_id}")
def get_story(story_id: str):
    return _guard(db.get_story, story_id)


@router.patch("/{story_id}")
def patch_story(story_id: str, payload: StoryUpdate):
    fields = payload.model_dump(include=payload.model_fields_set)
    if fields.get("mappings") is not None:
        fields["mappings"] = [m if isinstance(m, dict) else m.model_dump()
                              for m in fields["mappings"]]
    story, dup = _guard(db.update_story, story_id, fields)
    return {"story": story, "title_dup": dup}


@router.post("/{story_id}/revert")
def post_revert(story_id: str):
    return _guard(db.revert_story, story_id)


@router.delete("/{story_id}")
def delete_story(story_id: str):
    counts = _guard(db.delete_story, story_id)
    return {"deleted": story_id, "removed_with_it": counts}
