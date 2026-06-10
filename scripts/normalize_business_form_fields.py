"""Normalize physical business form column names and matching config fields."""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import select, text

from app.database import AsyncSessionLocal
from app.models.relational import Form, FormField, FormLayout, FormVersion


FIELD_RENAMES: dict[str, dict[str, str]] = {
    "alert-center": {
        "alertId": "alert_id",
        "occurredAt": "occurred_at",
        "dueAt": "due_at",
        "processStatus": "process_status",
        "currentNode": "current_node",
        "currentHandler": "current_handler",
        "completedAt": "completed_at",
        "interactionLog": "interaction_log",
    },
    "production-plan-entry": {
        "planNo": "plan_no",
    },
    "maintenance-order": {
        "orderNo": "order_no",
    },
    "equipment-inspection": {
        "planNo": "inspection_no",
    },
    "inspection-batch": {
        "type": "inspection_type",
        "result": "inspection_result",
    },
    "quality-event": {
        "eventNo": "event_no",
    },
    "capa-tracking": {
        "capaNo": "capa_no",
        "dueAt": "due_at",
    },
    "risk-review": {
        "riskNo": "risk_no",
        "processStatus": "process_status",
        "currentNode": "current_node",
        "currentHandler": "current_handler",
        "completedAt": "completed_at",
        "interactionLog": "interaction_log",
    },
    "ai_material_master_form_5": {
        "field_1": "material_code",
        "field_2": "material_name",
        "field_3": "material_type",
        "field_4": "spec_model",
        "field_5": "unit",
        "field_6": "safety_stock",
        "field_7": "status",
    },
}


def physical_column_name(field_name: str) -> str:
    field_name = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", str(field_name))
    normalized = re.sub(r"[^a-z0-9_]+", "_", field_name.lower()).strip("_")
    if not normalized or not re.match(r"^[a-z][a-z0-9_]*$", normalized):
        raise ValueError(f"Unsafe field name: {field_name!r}")
    return normalized


def legacy_column_name(field_name: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", str(field_name).lower()).strip("_")
    if not normalized or not re.match(r"^[a-z][a-z0-9_]*$", normalized):
        raise ValueError(f"Unsafe legacy field name: {field_name!r}")
    return normalized


def replace_field_refs(value: Any, renames: dict[str, str]) -> tuple[Any, bool]:
    if isinstance(value, str):
        next_value = renames.get(value, value)
        for old_name, new_name in renames.items():
            if old_name in {"type", "result", "status"}:
                continue
            if old_name.startswith("field_") or any(char.isupper() for char in old_name):
                next_value = next_value.replace(old_name, new_name)
        return next_value, next_value != value
    if isinstance(value, list):
        changed = False
        items = []
        for item in value:
            next_item, item_changed = replace_field_refs(item, renames)
            changed = changed or item_changed
            items.append(next_item)
        return items, changed
    if isinstance(value, dict):
        changed = False
        next_dict = {}
        for key, item in value.items():
            next_item, item_changed = replace_field_refs(item, renames)
            changed = changed or item_changed
            next_dict[key] = next_item
        return next_dict, changed
    return value, False


async def existing_columns(db, table_name: str) -> set[str]:
    rows = await db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    )
    return {str(row[0]) for row in rows.all()}


async def rename_physical_columns(db, table_name: str, renames: dict[str, str]) -> int:
    table_name = physical_column_name(table_name)
    changed = 0
    columns = await existing_columns(db, table_name)
    for old_field, new_field in renames.items():
        old_columns = [physical_column_name(old_field), legacy_column_name(old_field)]
        new_column = physical_column_name(new_field)
        old_column = next((candidate for candidate in old_columns if candidate != new_column and candidate in columns), None)
        if not old_column:
            continue
        if new_column in columns:
            await db.execute(text(f"UPDATE {table_name} SET {new_column} = COALESCE({new_column}, {old_column})"))
            await db.execute(text(f"ALTER TABLE {table_name} DROP COLUMN {old_column}"))
            columns.remove(old_column)
            changed += 1
            continue
        await db.execute(text(f"ALTER TABLE {table_name} RENAME COLUMN {old_column} TO {new_column}"))
        columns.remove(old_column)
        columns.add(new_column)
        changed += 1
    return changed


async def normalize_form(db, form: Form, renames: dict[str, str]) -> dict[str, int]:
    if not form.table_name:
        return {"columns": 0, "fields": 0, "configs": 0, "layouts": 0, "versions": 0}

    column_changes = await rename_physical_columns(db, form.table_name, renames)
    field_changes = 0
    fields = (
        await db.execute(
            select(FormField)
            .where(FormField.form_id == form.id, FormField.tenant_id == form.tenant_id)
            .order_by(FormField.sort_order, FormField.id)
        )
    ).scalars().all()
    existing_names = {field.field_name for field in fields}
    for field in fields:
        next_name = renames.get(field.field_name)
        if not next_name or next_name == field.field_name:
            continue
        if next_name in existing_names:
            field.archived = True
            field.visible_in_list = False
            field.visible_in_form = False
            field.searchable = False
            field.sortable = False
            field_changes += 1
            continue
        old_name = field.field_name
        field.field_name = next_name
        existing_names.remove(old_name)
        existing_names.add(next_name)
        field_changes += 1

    config_changes = 0
    if isinstance(form.config, dict):
        next_config, changed = replace_field_refs(form.config, renames)
        if changed:
            form.config = next_config
            config_changes += 1

    layout_changes = 0
    layouts = (
        await db.execute(
            select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.tenant_id == form.tenant_id)
        )
    ).scalars().all()
    for layout in layouts:
        if not isinstance(layout.config, dict):
            continue
        next_config, changed = replace_field_refs(layout.config, renames)
        if form.code == "ai_material_master_form_5":
            sections = next_config.get("sections") if isinstance(next_config, dict) else None
            if isinstance(sections, list):
                for section in sections:
                    if isinstance(section, dict) and section.get("title") in {"Basic", "基础"}:
                        section["title"] = "业务信息"
                        changed = True
        if changed:
            layout.config = next_config
            layout_changes += 1

    version_changes = 0
    versions = (
        await db.execute(
            select(FormVersion).where(FormVersion.form_id == form.id, FormVersion.tenant_id == form.tenant_id)
        )
    ).scalars().all()
    for version in versions:
        changed = False
        if isinstance(version.snapshot, dict):
            next_snapshot, snapshot_changed = replace_field_refs(version.snapshot, renames)
            if snapshot_changed:
                version.snapshot = next_snapshot
                changed = True
        if isinstance(version.impact_report, dict):
            next_report, report_changed = replace_field_refs(version.impact_report, renames)
            if report_changed:
                version.impact_report = next_report
                changed = True
        if changed:
            version_changes += 1

    return {
        "columns": column_changes,
        "fields": field_changes,
        "configs": config_changes,
        "layouts": layout_changes,
        "versions": version_changes,
    }


async def main() -> None:
    async with AsyncSessionLocal() as db:
        for code, renames in FIELD_RENAMES.items():
            form = await db.scalar(select(Form).where(Form.code == code))
            if not form:
                print(f"{code}: missing")
                continue
            result = await normalize_form(db, form, renames)
            print(f"{code}: {result}")
        await db.commit()


if __name__ == "__main__":
    asyncio.run(main())
