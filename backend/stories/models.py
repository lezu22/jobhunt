"""Pydantic request models for the Work Stories API."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

Kind = Literal["story", "note"]
Status = Literal["draft", "gap", "ready"]


class CategoryIn(BaseModel):
    name: str


class OrderIds(BaseModel):
    ids: list[int]


class MappingIn(BaseModel):
    question: str
    score: Optional[int] = Field(None, ge=0, le=5)
    note: Optional[str] = None


class StoryCreate(BaseModel):
    title: str
    body: str
    kind: Kind = "story"
    category_id: Optional[int] = None
    status: Status = "draft"
    nda_sensitive: bool = False
    labels: list[str] = []
    job_ids: list[str] = []
    mappings: list[MappingIn] = []


class StoryUpdate(BaseModel):
    """PATCH payload. Absent fields stay unchanged; category_id: null is a
    real value (uncategorised), distinguished via model_fields_set."""

    title: Optional[str] = None
    body: Optional[str] = None
    kind: Optional[Kind] = None
    category_id: Optional[int] = None
    status: Optional[Status] = None
    nda_sensitive: Optional[bool] = None
    labels: Optional[list[str]] = None
    job_ids: Optional[list[str]] = None
    mappings: Optional[list[MappingIn]] = None


class StoryOrder(BaseModel):
    category_id: Optional[int] = None  # null = the uncategorised bucket
    ids: list[str]


class BulkDeleteIn(BaseModel):
    ids: list[str]


class BulkMoveIn(BaseModel):
    ids: list[str]
    category_id: Optional[int] = None  # null = move to uncategorised


class ImportRecordIn(BaseModel):
    """One reviewed record from the staged import screen."""
    action: Literal["create", "update", "skip"]
    target_story_id: Optional[str] = None  # required for update
    title: str = ""
    body: str = ""
    kind: Kind = "note"
    status: Status = "draft"
    nda_sensitive: bool = False
    category_id: Optional[int] = None       # resolved existing category…
    new_category_name: Optional[str] = None  # …or a category to create (get-or-create by name)
    labels: list[str] = []
    job_ids: list[str] = []
    mappings: list[MappingIn] = []


class ImportCommitIn(BaseModel):
    records: list[ImportRecordIn]
