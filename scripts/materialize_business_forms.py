"""Materialize formal forms into physical tables.

Configuration stays in forms/form_fields/form_layouts. Business facts move out
of dynamic_records.data JSON and into one table per formal form.
Existing dynamic_records are kept as migration source records.
"""

from __future__ import annotations

import asyncio
import json
import re

from datetime import datetime
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import select, text

from app.database import AsyncSessionLocal
from app.models.relational import DynamicRecord, Form, FormField


FORM_TABLE_OVERRIDES = {
    "alert-center": "business_alert_center",
    "production-plan-entry": "business_production_plans",
    "maintenance-order": "business_maintenance_orders",
    "equipment-inspection": "business_equipment_inspections",
    "inspection-batch": "business_inspection_batches",
    "quality-event": "business_quality_events",
    "capa-tracking": "business_capa_tracking",
    "risk-review": "business_risk_reviews",
    "ai_material_master_form_5": "business_material_master",
    "ai_material_master_form_6": "business_special_parts",
}

LEGACY_FIELD_KEYS = {
    "alert-center": {
        "alert_id": "alertId",
        "occurred_at": "occurredAt",
        "due_at": "dueAt",
        "process_status": "processStatus",
        "current_node": "currentNode",
        "current_handler": "currentHandler",
        "completed_at": "completedAt",
        "interaction_log": "interactionLog",
    },
    "production-plan-entry": {"plan_no": "planNo"},
    "maintenance-order": {"order_no": "orderNo"},
    "equipment-inspection": {"inspection_no": "planNo"},
    "inspection-batch": {"inspection_type": "type", "inspection_result": "result"},
    "quality-event": {"event_no": "eventNo"},
    "capa-tracking": {"capa_no": "capaNo", "due_at": "dueAt"},
    "risk-review": {
        "risk_no": "riskNo",
        "process_status": "processStatus",
        "current_node": "currentNode",
        "current_handler": "currentHandler",
        "completed_at": "completedAt",
        "interaction_log": "interactionLog",
    },
    "ai_material_master_form_5": {
        "material_code": "field_1",
        "material_name": "field_2",
        "material_type": "field_3",
        "spec_model": "field_4",
        "unit": "field_5",
        "safety_stock": "field_6",
        "status": "field_7",
    },
}


def safe_identifier(name: str) -> str:
    name = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", str(name))
    normalized = re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_")
    if not normalized or not re.match(r"^[a-z][a-z0-9_]*$", normalized):
        raise ValueError(f"Unsafe identifier: {name!r}")
    return normalized


def form_kind(form: Form) -> str:
    config = form.config or {}
    return str(config.get("assemblyKind") or config.get("kind") or config.get("type") or "").lower()


def table_name_for_form(form: Form) -> str:
    if form.code in FORM_TABLE_OVERRIDES:
        return FORM_TABLE_OVERRIDES[form.code]
    prefix = "analysis" if form_kind(form) == "analysis" else "business"
    return f"{prefix}_{safe_identifier(form.code)}"


def sql_type(field_type: str) -> str:
    kind = (field_type or "string").lower()
    if kind in {"integer", "int"}:
        return "INTEGER"
    if kind in {"number", "decimal", "float"}:
        return "DOUBLE PRECISION"
    if kind == "boolean":
        return "BOOLEAN"
    if kind == "date":
        return "DATE"
    if kind == "datetime":
        return "TIMESTAMP"
    return "TEXT"


def coerce_value(field: FormField, value):
    if value in (None, ""):
        return None
    kind = (field.field_type or "string").lower()
    if kind == "date" and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    if kind == "datetime" and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def record_value(form_code: str, field: FormField, data: dict):
    if field.field_name in data:
        return data.get(field.field_name)
    legacy_key = LEGACY_FIELD_KEYS.get(form_code, {}).get(field.field_name)
    if legacy_key and legacy_key in data:
        return data.get(legacy_key)
    return None


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
    return {row[0] for row in rows.all()}


async def ensure_table(db, table_name: str, fields: list[FormField]) -> None:
    table_name = safe_identifier(table_name)
    await db.execute(text(f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
            record_status VARCHAR(50) NOT NULL DEFAULT 'active',
            created_by INTEGER NULL REFERENCES users(id),
            updated_by INTEGER NULL REFERENCES users(id),
            source_dynamic_record_id INTEGER NULL UNIQUE,
            deleted_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    await db.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table_name}_tenant_deleted_id ON {table_name} (tenant_id, deleted_at, id)"))
    columns = await existing_columns(db, table_name)
    for field in fields:
        if field.archived:
            continue
        column_name = safe_identifier(field.field_name)
        if column_name not in columns:
            await db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {sql_type(field.field_type)} NULL"))
            columns.add(column_name)


async def migrate_form(db, form: Form) -> tuple[str, int]:
    table_name = table_name_for_form(form)
    fields = (
        await db.execute(
            select(FormField)
            .where(FormField.form_id == form.id, FormField.tenant_id == form.tenant_id)
            .order_by(FormField.sort_order, FormField.id)
        )
    ).scalars().all()
    await ensure_table(db, table_name, fields)
    field_pairs = [(field, safe_identifier(field.field_name)) for field in fields if not field.archived]
    records = (
        await db.execute(
            select(DynamicRecord)
            .where(DynamicRecord.form_id == form.id, DynamicRecord.tenant_id == form.tenant_id, DynamicRecord.deleted_at.is_(None))
            .order_by(DynamicRecord.id)
        )
    ).scalars().all()

    inserted = 0
    for record in records:
        exists = await db.scalar(
            text(f"SELECT id FROM {table_name} WHERE source_dynamic_record_id = :record_id"),
            {"record_id": record.id},
        )
        data = record.data or {}
        if exists:
            assignments = []
            params = {"record_id": record.id}
            for field, column_name in field_pairs:
                assignments.append(f"{column_name} = :{column_name}")
                params[column_name] = coerce_value(field, record_value(form.code, field, data))
            assignments.append("updated_at = :updated_at")
            params["updated_at"] = record.updated_at
            await db.execute(
                text(f"UPDATE {table_name} SET {', '.join(assignments)} WHERE source_dynamic_record_id = :record_id"),
                params,
            )
            continue
        columns = [
            "tenant_id",
            "record_status",
            "created_by",
            "updated_by",
            "source_dynamic_record_id",
            "created_at",
            "updated_at",
            *[column_name for _, column_name in field_pairs],
        ]
        params = {
            "tenant_id": record.tenant_id,
            "record_status": record.status,
            "created_by": record.created_by,
            "updated_by": record.updated_by,
            "source_dynamic_record_id": record.id,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
        }
        for field, column_name in field_pairs:
            params[column_name] = coerce_value(field, record_value(form.code, field, data))
        await db.execute(
            text(
                f"INSERT INTO {table_name} ({', '.join(columns)}) "
                f"VALUES ({', '.join(':' + column for column in columns)})"
            ),
            params,
        )
        inserted += 1

    form.storage_mode = "physical_table"
    form.table_name = table_name
    config = dict(form.config or {})
    config["storageMode"] = "physical_table"
    config["businessTable"] = table_name
    config["dynamicRecordsArchived"] = True
    form.config = config
    return table_name, inserted


async def main() -> None:
    async with AsyncSessionLocal() as db:
        forms = (
            await db.execute(select(Form).order_by(Form.code))
        ).scalars().all()
        targets = []
        for form in forms:
            record_count = await db.scalar(
                text("SELECT count(*) FROM dynamic_records WHERE form_id = :form_id AND deleted_at IS NULL"),
                {"form_id": form.id},
            )
            if form.status == "draft" and not record_count:
                continue
            if form_kind(form) in {"business", "analysis"} or form.code in FORM_TABLE_OVERRIDES or record_count:
                targets.append(form)

        results = []
        for form in targets:
            table_name, inserted = await migrate_form(db, form)
            results.append((form.code, table_name, inserted))
        await db.commit()

    for code, table_name, inserted in results:
        print(f"{code}: {table_name}, inserted={inserted}")


if __name__ == "__main__":
    asyncio.run(main())
