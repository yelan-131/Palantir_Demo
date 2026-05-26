"""Configuration Import/Export — export all platform config as JSON and import it.

Supports:
- Full export (models with fields, pages, menus, rules)
- Single model export
- Import with merge (skip existing by name) or replace (delete-all then import) modes
Falls back to mock data when DB is unavailable.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.api._model_driven_shared import (
    MOCK_MENUS,
    MOCK_MODELS,
    MOCK_PAGES,
    try_db,
)
from app.api.rules import MOCK_RULES
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()

EXPORT_VERSION = "1.0"

# ── Pydantic schemas ──────────────────────────────────────


class ImportRequest(BaseModel):
    config: dict
    mode: str = "merge"  # "merge" | "replace"


# ── Helpers ───────────────────────────────────────────────


def _strip_ids(item: dict) -> dict:
    """Remove internal 'id' fields for a clean export payload."""
    out = {k: v for k, v in item.items() if k != "id"}
    if "fields" in out and isinstance(out["fields"], list):
        out["fields"] = [
            {k: v for k, v in f.items() if k != "id"}
            for f in out["fields"]
        ]
    return out


def _build_export(models: list[dict], pages: list[dict],
                  menus: list[dict], rules: list[dict]) -> dict:
    """Build a standard export envelope."""
    return {
        "version": EXPORT_VERSION,
        "export_time": datetime.now(timezone.utc).isoformat(),
        "models": [_strip_ids(m) for m in models],
        "pages": [_strip_ids(p) for p in pages],
        "menus": [_strip_ids(m) for m in menus],
        "rules": [_strip_ids(r) for r in rules],
    }


# ── Export endpoints ─────────────────────────────────────


@router.get("/export")
async def export_all_config():
    """Export all platform configuration as JSON.

    Returns the full config envelope: {version, export_time, models, pages, menus, rules}.
    Each model includes its fields. Uses DB when available, mock fallback otherwise.
    """

    # --- Models + Fields ---
    async def _query_models(db):
        from app.models.relational import MetaField, MetaModel
        from sqlalchemy import select
        result = await db.execute(select(MetaModel).order_by(MetaModel.id))
        db_models = result.scalars().all()
        models_out = []
        for m in db_models:
            f_result = await db.execute(
                select(MetaField).where(MetaField.model_id == m.id).order_by(MetaField.sort_order)
            )
            db_fields = f_result.scalars().all()
            models_out.append({
                "id": m.id, "name": m.name, "label": m.label, "icon": m.icon,
                "table_name": m.table_name, "description": m.description,
                "is_system": m.is_system,
                "fields": [
                    {"field_name": f.field_name, "label": f.label, "field_type": f.field_type,
                     "required": f.required, "searchable": f.searchable, "sortable": f.sortable,
                     "visible_in_list": f.visible_in_list, "visible_in_form": f.visible_in_form,
                     "enum_values": f.enum_values, "relation_config": f.relation_config,
                     "default_value": f.default_value, "sort_order": f.sort_order}
                    for f in db_fields
                ],
            })
        return models_out

    models = await try_db(_query_models) or MOCK_MODELS

    # --- Pages ---
    async def _query_pages(db):
        from app.models.relational import PageConfig
        from sqlalchemy import select
        result = await db.execute(select(PageConfig).order_by(PageConfig.id))
        pages = result.scalars().all()
        return [
            {"id": p.id, "name": p.name, "title": p.title, "paradigm": p.paradigm,
             "model_id": p.model_id, "model_name": p.model_name,
             "config": p.config, "route_path": p.route_path, "is_published": p.is_published}
            for p in pages
        ]

    pages = await try_db(_query_pages) or MOCK_PAGES

    # --- Menus ---
    async def _query_menus(db):
        from app.models.relational import MenuItem
        from sqlalchemy import select
        result = await db.execute(select(MenuItem).order_by(MenuItem.sort_order))
        items = result.scalars().all()
        return [
            {"id": i.id, "parent_id": i.parent_id, "title": i.title, "icon": i.icon,
             "route_path": i.route_path, "sort_order": i.sort_order, "is_visible": i.is_visible}
            for i in items
        ]

    menus = await try_db(_query_menus) or MOCK_MENUS

    # --- Rules ---
    async def _query_rules(db):
        from app.models.relational import Rule
        from sqlalchemy import select
        result = await db.execute(select(Rule).order_by(Rule.id))
        rules = result.scalars().all()
        return [
            {"id": r.id, "model_id": r.model_id, "name": r.name, "rule_type": r.rule_type,
             "field_name": r.field_name, "condition": r.condition, "action": r.action,
             "message": r.message, "is_active": r.is_active, "priority": r.priority}
            for r in rules
        ]

    rules = await try_db(_query_rules) or MOCK_RULES

    return _build_export(models, pages, menus, rules)


@router.get("/export/{model_name}")
async def export_single_model_config(model_name: str):
    """Export a single model's configuration (model + fields + related pages).

    Returns the standard export envelope but only for the requested model.
    """
    # --- Find the model ---
    async def _query_model(db):
        from app.models.relational import MetaField, MetaModel
        from sqlalchemy import select
        m = await db.scalar(select(MetaModel).where(MetaModel.name == model_name))
        if not m:
            return None
        f_result = await db.execute(
            select(MetaField).where(MetaField.model_id == m.id).order_by(MetaField.sort_order)
        )
        db_fields = f_result.scalars().all()
        model_dict = {
            "id": m.id, "name": m.name, "label": m.label, "icon": m.icon,
            "table_name": m.table_name, "description": m.description,
            "is_system": m.is_system,
            "fields": [
                {"field_name": f.field_name, "label": f.label, "field_type": f.field_type,
                 "required": f.required, "searchable": f.searchable, "sortable": f.sortable,
                 "visible_in_list": f.visible_in_list, "visible_in_form": f.visible_in_form,
                 "enum_values": f.enum_values, "sort_order": f.sort_order}
                for f in db_fields
            ],
        }
        # Related pages
        from app.models.relational import PageConfig
        p_result = await db.execute(
            select(PageConfig).where(PageConfig.model_name == model_name)
        )
        db_pages = p_result.scalars().all()
        pages = [
            {"id": p.id, "name": p.name, "title": p.title, "paradigm": p.paradigm,
             "model_id": p.model_id, "model_name": p.model_name,
             "config": p.config, "route_path": p.route_path, "is_published": p.is_published}
            for p in db_pages
        ]
        return model_dict, pages

    result = await try_db(_query_model)

    if result is not None:
        model_dict, pages = result
    else:
        # Mock fallback
        model_dict = None
        for m in MOCK_MODELS:
            if m["name"] == model_name:
                model_dict = m
                break
        if model_dict is None:
            raise HTTPException(404, f"Model '{model_name}' not found")
        pages = [p for p in MOCK_PAGES if p.get("model_name") == model_name]

    return _build_export([model_dict], pages, [], [])


# ── Import endpoint ──────────────────────────────────────


@router.post("/import")
async def import_config(body: ImportRequest):
    """Import configuration from a JSON payload.

    Modes:
    - merge (default): adds new items, skips existing items by name.
    - replace: deletes all existing items, then imports the payload.

    Returns: {imported: {models: N, pages: N, menus: N, rules: N},
              skipped: {models: N, pages: N, menus: N, rules: N}}
    """
    config = body.config
    mode = body.mode

    if mode not in ("merge", "replace"):
        raise HTTPException(400, f"Invalid mode '{mode}'. Use 'merge' or 'replace'.")

    imported = {"models": 0, "pages": 0, "menus": 0, "rules": 0}
    skipped = {"models": 0, "pages": 0, "menus": 0, "rules": 0}

    # Try DB import first
    db_result = await _try_db_import(config, mode)
    if db_result is not None:
        return {"imported": db_result[0], "skipped": db_result[1]}

    # Mock fallback import
    return _mock_import(config, mode, imported, skipped)


async def _try_db_import(config: dict, mode: str):
    """Attempt DB-based import. Returns (imported, skipped) or None for fallback."""
    if not settings.IS_PRODUCTION:
        return None

    async def _do_import(db):
        from app.models.relational import MetaField, MetaModel, MenuItem, PageConfig, Rule
        from sqlalchemy import delete, select

        imported = {"models": 0, "pages": 0, "menus": 0, "rules": 0}
        skipped = {"models": 0, "pages": 0, "menus": 0, "rules": 0}

        if mode == "replace":
            await db.execute(delete(Rule))
            await db.execute(delete(MetaField))
            await db.execute(delete(PageConfig))
            await db.execute(delete(MenuItem))
            await db.execute(delete(MetaModel))
            await db.flush()

        # --- Models + Fields ---
        for m_cfg in config.get("models", []):
            existing = await db.scalar(
                select(MetaModel).where(MetaModel.name == m_cfg.get("name"))
            )
            if existing and mode == "merge":
                skipped["models"] += 1
                continue
            m = MetaModel(
                name=m_cfg["name"], label=m_cfg.get("label", ""),
                icon=m_cfg.get("icon"), table_name=m_cfg.get("table_name", ""),
                description=m_cfg.get("description"), is_system=m_cfg.get("is_system", False),
            )
            db.add(m)
            await db.flush()
            for f_cfg in m_cfg.get("fields", []):
                f = MetaField(
                    model_id=m.id, field_name=f_cfg["field_name"],
                    label=f_cfg.get("label", ""), field_type=f_cfg.get("field_type", "string"),
                    required=f_cfg.get("required", False), searchable=f_cfg.get("searchable", False),
                    sortable=f_cfg.get("sortable", False),
                    visible_in_list=f_cfg.get("visible_in_list", True),
                    visible_in_form=f_cfg.get("visible_in_form", True),
                    enum_values=f_cfg.get("enum_values"),
                    relation_config=f_cfg.get("relation_config"),
                    default_value=f_cfg.get("default_value"),
                    sort_order=f_cfg.get("sort_order", 0),
                )
                db.add(f)
            imported["models"] += 1

        # --- Pages ---
        for p_cfg in config.get("pages", []):
            existing = await db.scalar(
                select(PageConfig).where(PageConfig.name == p_cfg.get("name"))
            )
            if existing and mode == "merge":
                skipped["pages"] += 1
                continue
            p = PageConfig(
                name=p_cfg["name"], title=p_cfg.get("title", ""),
                paradigm=p_cfg.get("paradigm", "master-detail"),
                model_id=p_cfg.get("model_id"),
                model_name=p_cfg.get("model_name", ""),
                config=p_cfg.get("config"),
                route_path=p_cfg.get("route_path"),
                is_published=p_cfg.get("is_published", False),
            )
            db.add(p)
            imported["pages"] += 1

        # --- Menus ---
        for mi_cfg in config.get("menus", []):
            existing = await db.scalar(
                select(MenuItem).where(MenuItem.title == mi_cfg.get("title"))
            )
            if existing and mode == "merge":
                skipped["menus"] += 1
                continue
            mi = MenuItem(
                parent_id=mi_cfg.get("parent_id"),
                title=mi_cfg.get("title", ""),
                icon=mi_cfg.get("icon"),
                route_path=mi_cfg.get("route_path"),
                sort_order=mi_cfg.get("sort_order", 0),
                is_visible=mi_cfg.get("is_visible", True),
            )
            db.add(mi)
            imported["menus"] += 1

        # --- Rules ---
        for r_cfg in config.get("rules", []):
            existing = await db.scalar(
                select(Rule).where(Rule.name == r_cfg.get("name"))
            )
            if existing and mode == "merge":
                skipped["rules"] += 1
                continue
            r = Rule(
                model_id=r_cfg.get("model_id", 0),
                name=r_cfg.get("name", ""),
                rule_type=r_cfg.get("rule_type", "validation"),
                field_name=r_cfg.get("field_name"),
                condition=r_cfg.get("condition"),
                action=r_cfg.get("action"),
                message=r_cfg.get("message"),
                is_active=r_cfg.get("is_active", True),
                priority=r_cfg.get("priority", 0),
            )
            db.add(r)
            imported["rules"] += 1

        await db.commit()
        return imported, skipped

    return await try_db(_do_import)


def _mock_import(config: dict, mode: str,
                 imported: dict, skipped: dict) -> dict:
    """Mock fallback for config import. Mutates shared MOCK_* lists in-place."""

    if mode == "replace":
        MOCK_MODELS.clear()
        MOCK_PAGES.clear()
        MOCK_MENUS.clear()
        MOCK_RULES.clear()

    # --- Models + Fields ---
    existing_model_names = {m["name"] for m in MOCK_MODELS}
    next_model_id = max((m["id"] for m in MOCK_MODELS), default=0) + 1
    next_field_id = 1
    for m in MOCK_MODELS:
        for f in m.get("fields", []):
            next_field_id = max(next_field_id, f["id"] + 1)

    for m_cfg in config.get("models", []):
        name = m_cfg.get("name", "")
        if name in existing_model_names and mode == "merge":
            skipped["models"] += 1
            continue
        fields = []
        for f_cfg in m_cfg.get("fields", []):
            fields.append({
                "id": next_field_id,
                "field_name": f_cfg.get("field_name", ""),
                "label": f_cfg.get("label", ""),
                "field_type": f_cfg.get("field_type", "string"),
                "required": f_cfg.get("required", False),
                "searchable": f_cfg.get("searchable", False),
                "sortable": f_cfg.get("sortable", False),
                "visible_in_list": f_cfg.get("visible_in_list", True),
                "visible_in_form": f_cfg.get("visible_in_form", True),
                "enum_values": f_cfg.get("enum_values"),
                "sort_order": f_cfg.get("sort_order", 0),
            })
            next_field_id += 1
        MOCK_MODELS.append({
            "id": next_model_id,
            "name": name,
            "label": m_cfg.get("label", ""),
            "icon": m_cfg.get("icon"),
            "table_name": m_cfg.get("table_name", ""),
            "description": m_cfg.get("description"),
            "is_system": m_cfg.get("is_system", False),
            "fields": fields,
        })
        next_model_id += 1
        imported["models"] += 1

    # --- Pages ---
    existing_page_names = {p["name"] for p in MOCK_PAGES}
    next_page_id = max((p["id"] for p in MOCK_PAGES), default=0) + 1
    for p_cfg in config.get("pages", []):
        name = p_cfg.get("name", "")
        if name in existing_page_names and mode == "merge":
            skipped["pages"] += 1
            continue
        MOCK_PAGES.append({
            "id": next_page_id,
            "name": name,
            "title": p_cfg.get("title", ""),
            "paradigm": p_cfg.get("paradigm", "master-detail"),
            "model_id": p_cfg.get("model_id"),
            "model_name": p_cfg.get("model_name", ""),
            "config": p_cfg.get("config"),
            "route_path": p_cfg.get("route_path"),
            "is_published": p_cfg.get("is_published", False),
        })
        next_page_id += 1
        imported["pages"] += 1

    # --- Menus ---
    existing_menu_titles = {(m["title"], m.get("parent_id")) for m in MOCK_MENUS}
    next_menu_id = max((m["id"] for m in MOCK_MENUS), default=0) + 1
    for mi_cfg in config.get("menus", []):
        title = mi_cfg.get("title", "")
        parent_id = mi_cfg.get("parent_id")
        key = (title, parent_id)
        if key in existing_menu_titles and mode == "merge":
            skipped["menus"] += 1
            continue
        MOCK_MENUS.append({
            "id": next_menu_id,
            "parent_id": parent_id,
            "title": title,
            "icon": mi_cfg.get("icon"),
            "route_path": mi_cfg.get("route_path"),
            "sort_order": mi_cfg.get("sort_order", 0),
            "is_visible": mi_cfg.get("is_visible", True),
        })
        next_menu_id += 1
        imported["menus"] += 1

    # --- Rules ---
    existing_rule_names = {r["name"] for r in MOCK_RULES}
    next_rule_id = max((r["id"] for r in MOCK_RULES), default=0) + 1
    for r_cfg in config.get("rules", []):
        name = r_cfg.get("name", "")
        if name in existing_rule_names and mode == "merge":
            skipped["rules"] += 1
            continue
        MOCK_RULES.append({
            "id": next_rule_id,
            "model_id": r_cfg.get("model_id", 0),
            "name": name,
            "rule_type": r_cfg.get("rule_type", "validation"),
            "field_name": r_cfg.get("field_name"),
            "condition": r_cfg.get("condition"),
            "action": r_cfg.get("action"),
            "message": r_cfg.get("message"),
            "is_active": r_cfg.get("is_active", True),
            "priority": r_cfg.get("priority", 0),
        })
        next_rule_id += 1
        imported["rules"] += 1

    return {"imported": imported, "skipped": skipped}
