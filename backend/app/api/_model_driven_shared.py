"""Shared internals for model-driven router modules.

This module intentionally keeps platform defaults domain-neutral. Business
objects should come from configured meta models, forms, and physical
`business_...` / `analysis_...` tables instead of hard-coded industry demos.
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel

from app.core.db import safe_db_call as try_db
from app.core.logging import get_logger

logger = get_logger(__name__)


class MetaModelCreate(BaseModel):
    name: str
    label: str
    icon: Optional[str] = None
    table_name: str
    description: Optional[str] = None
    is_system: bool = False


class MetaModelUpdate(BaseModel):
    label: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None


class MetaFieldCreate(BaseModel):
    field_name: str
    label: str
    field_type: str = "string"
    required: bool = False
    searchable: bool = False
    sortable: bool = False
    visible_in_list: bool = True
    visible_in_form: bool = True
    enum_values: Optional[str] = None
    relation_config: Optional[str] = None
    default_value: Optional[str] = None
    sort_order: int = 0


class PageConfigCreate(BaseModel):
    name: str
    title: str
    paradigm: str = "master-detail"
    model_name: str
    config: Optional[dict] = None
    route_path: Optional[str] = None
    is_published: bool = False


class MenuItemCreate(BaseModel):
    parent_id: Optional[int] = None
    title: str
    icon: Optional[str] = None
    route_path: Optional[str] = None
    sort_order: int = 0
    is_visible: bool = True


class MenuItemUpdate(BaseModel):
    parent_id: Optional[int] = None
    title: Optional[str] = None
    icon: Optional[str] = None
    route_path: Optional[str] = None
    sort_order: Optional[int] = None
    is_visible: Optional[bool] = None


_IDENT_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def assert_safe_identifier(name: str) -> None:
    """Defense-in-depth check on dynamic table/column names."""
    if not _IDENT_RE.match(name):
        raise HTTPException(400, f"Invalid identifier: {name!r}")


# Domain-neutral defaults. These used to expose manufacturing demo objects as
# built-in platform models; they now start empty and are populated by
# configuration/meta-model flows instead.
SAFE_COLUMNS: dict[str, set[str]] = {}
ENTITY_TABLE_MAP: dict[str, str] = {}
MOCK_MODELS: list[dict] = []
MOCK_PAGES: list[dict] = []
MOCK_MENUS: list[dict] = []
MOCK_DATA: dict[str, list[dict]] = {}
