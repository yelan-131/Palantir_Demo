"""Physical-table form storage: DDL, record queries, and impact analysis."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.form_engine.encoding import _encoding_rule_for_field, _is_encoding_field
from app.api.form_engine.naming import _physical_column_name, _uses_physical_form_table
from app.api.form_engine.query import (
    _ensure_filter_fields_visible,
    _ensure_sort_field_allowed,
    _parse_record_filters,
    _queryable_field_names,
    _visible_field_subset,
)
from app.api.form_engine.validation import _field_allowed_values, _field_value_is_compatible
from app.config import settings
from app.database import DB_TYPE

logger = logging.getLogger(__name__)


def _physical_column_type(field) -> str:
    field_type = str(field.field_type or "string").lower()
    if field_type in {"integer", "int"}:
        return "INTEGER"
    if field_type in {"number", "decimal", "float"}:
        return "DOUBLE PRECISION"
    if field_type == "boolean":
        return "BOOLEAN"
    if field_type == "date":
        return "DATE"
    if field_type == "datetime":
        return "TIMESTAMP"
    return "TEXT"


def _sql_current_timestamp() -> str:
    return "CURRENT_TIMESTAMP" if DB_TYPE == "sqlite" else "now()"


def _isoformat_value(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _physical_record_payload(row, form, fields: list, *, visible_fields: Optional[set[str]] = None) -> dict:
    mapping = dict(row._mapping if hasattr(row, "_mapping") else row)
    field_names = [
        field.field_name
        for field in fields
        if not field.archived and (visible_fields is None or field.field_name in visible_fields)
    ]
    data = {name: mapping.get(_physical_column_name(name)) for name in field_names}
    workflow = {
        "id": mapping.get("id"),
        "form_id": form.id,
        "model_id": form.model_id,
        "schema_version": 1,
        "data": data,
        "status": mapping.get("record_status", mapping.get("status")),
        "created_by": mapping.get("created_by"),
        "updated_by": mapping.get("updated_by"),
        "deleted_at": _isoformat_value(mapping.get("deleted_at")),
        "created_at": _isoformat_value(mapping.get("created_at")),
        "updated_at": _isoformat_value(mapping.get("updated_at")),
    }
    return workflow


async def _physical_table_columns(db: AsyncSession, table_name: str) -> set[str]:
    assert_safe_identifier(table_name)
    if DB_TYPE == "sqlite":
        rows = await db.execute(text(f"PRAGMA table_info({table_name})"))
        return {str(row[1]) for row in rows.all()}
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


async def _ensure_physical_form_table(db: AsyncSession, form, fields: Optional[list] = None) -> None:
    if not _uses_physical_form_table(form):
        return
    table_name = str(form.table_name)
    assert_safe_identifier(table_name)
    if DB_TYPE == "sqlite":
        await db.execute(text(f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
                record_status VARCHAR(50) NOT NULL DEFAULT 'active',
                created_by INTEGER NULL REFERENCES users(id),
                updated_by INTEGER NULL REFERENCES users(id),
                source_dynamic_record_id INTEGER NULL UNIQUE,
                deleted_at TIMESTAMP NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
    else:
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
    existing_columns = await _physical_table_columns(db, table_name)
    for field in fields or []:
        if field.archived:
            continue
        column_name = _physical_column_name(field.field_name)
        if column_name not in existing_columns:
            await db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {_physical_column_type(field)} NULL"))
            existing_columns.add(column_name)
    await _ensure_physical_code_indexes(db, table_name, fields or [], existing_columns)


async def _ensure_physical_code_indexes(db: AsyncSession, table_name: str, fields: list, existing_columns: set[str]) -> None:
    """Hard uniqueness backstop for auto-encoding (料号) columns.

    Index creation is wrapped in a savepoint so legacy tables that already
    contain duplicate codes (from the old racy max() scan) keep working; the
    failure is logged instead of breaking record writes.
    """
    for field in fields:
        if getattr(field, "archived", False) or not _is_encoding_field(field):
            continue
        if _encoding_rule_for_field(field).get("enabled") is False:
            continue
        column_name = _physical_column_name(field.field_name)
        if column_name not in existing_columns:
            continue
        index_name = f"uq_{table_name}_{column_name}_code"
        assert_safe_identifier(index_name)
        try:
            async with db.begin_nested():
                await db.execute(
                    text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table_name} (tenant_id, {column_name})")
                )
        except Exception:
            logger.warning(
                "Could not create unique code index %s on %s (legacy duplicate values?)",
                index_name,
                table_name,
            )


def _physical_filter_clause(fields: list, visible_fields: set[str], filters: list[dict]) -> tuple[list[str], dict]:
    clauses: list[str] = []
    params: dict = {}
    allowed = _queryable_field_names(fields) & visible_fields
    for index, filter_item in enumerate(filters):
        field = str(filter_item.get("field") or "")
        op = str(filter_item.get("op") or "equals")
        expected = filter_item.get("value")
        if expected in (None, ""):
            continue
        if field not in allowed:
            raise HTTPException(400, f"Field is not indexed for filtering: {field}")
        column_name = _physical_column_name(field)
        key = f"filter_{index}"
        if op == "contains":
            clauses.append(f"LOWER(CAST({column_name} AS TEXT)) LIKE :{key}")
            params[key] = f"%{str(expected).lower()}%"
        elif op == "equals":
            clauses.append(f"CAST({column_name} AS TEXT) = :{key}")
            params[key] = str(expected)
        elif op == "between":
            if not isinstance(expected, list) or len(expected) != 2:
                raise HTTPException(400, f"Invalid between filter for field: {field}")
            start, end = expected
            if start not in (None, ""):
                clauses.append(f"CAST({column_name} AS TEXT) >= :{key}_start")
                params[f"{key}_start"] = str(start)
            if end not in (None, ""):
                clauses.append(f"CAST({column_name} AS TEXT) <= :{key}_end")
                params[f"{key}_end"] = str(end)
        elif op == "gte":
            clauses.append(f"CAST({column_name} AS TEXT) >= :{key}")
            params[key] = str(expected)
        elif op == "lte":
            clauses.append(f"CAST({column_name} AS TEXT) <= :{key}")
            params[key] = str(expected)
        else:
            raise HTTPException(400, f"Invalid filter operator: {op}")
    return clauses, params


async def _list_physical_records(
    db: AsyncSession,
    form,
    fields: list,
    visible_fields: set[str],
    *,
    include_deleted: bool,
    search: Optional[str],
    filters_json: Optional[str],
    sort_field: Optional[str],
    sort_order: str,
    include_total: bool,
    page: int,
    page_size: int,
) -> dict:
    table_name = str(form.table_name)
    assert_safe_identifier(table_name)
    query_fields = _visible_field_subset(fields, visible_fields)
    await _ensure_physical_form_table(db, form, fields)
    parsed_filters = _parse_record_filters(filters_json)
    _ensure_filter_fields_visible(parsed_filters, visible_fields)
    _ensure_sort_field_allowed(sort_field, fields, visible_fields)

    columns = ["id", "tenant_id", "record_status", "created_by", "updated_by", "deleted_at", "created_at", "updated_at"]
    for field in query_fields:
        columns.append(_physical_column_name(field.field_name))

    clauses = ["tenant_id = :tenant_id"]
    params: dict = {"tenant_id": form.tenant_id, "limit": page_size, "offset": (page - 1) * page_size}
    if not include_deleted:
        clauses.append("deleted_at IS NULL")
    if search:
        searchable_names = [field.field_name for field in query_fields if field.searchable]
        if settings.IS_PRODUCTION and not searchable_names:
            raise HTTPException(400, "Query is not indexed for production dynamic records")
        if not searchable_names:
            searchable_names = [field.field_name for field in query_fields]
        if searchable_names:
            search_clauses = []
            for index, field_name in enumerate(searchable_names):
                column_name = _physical_column_name(field_name)
                key = f"search_{index}"
                search_clauses.append(f"LOWER(CAST({column_name} AS TEXT)) LIKE :{key}")
                params[key] = f"%{search.lower()}%"
            clauses.append(f"({' OR '.join(search_clauses)})")
    filter_clauses, filter_params = _physical_filter_clause(fields, visible_fields, parsed_filters)
    clauses.extend(filter_clauses)
    params.update(filter_params)

    where_sql = " AND ".join(clauses)
    if sort_field:
        sort_column = _physical_column_name(sort_field)
        direction = "ASC" if sort_order.lower() == "asc" else "DESC"
        order_sql = f"{sort_column} {direction}, id DESC"
    else:
        order_sql = "id DESC"
    selected_columns = ", ".join(columns)
    rows = (await db.execute(
        text(f"SELECT {selected_columns} FROM {table_name} WHERE {where_sql} ORDER BY {order_sql} LIMIT :limit OFFSET :offset"),
        params,
    )).all()
    total = None
    if include_total:
        count_params = {key: value for key, value in params.items() if key not in {"limit", "offset"}}
        total = await db.scalar(text(f"SELECT count(*) FROM {table_name} WHERE {where_sql}"), count_params)
    return {
        "data": [_physical_record_payload(row, form, fields, visible_fields=visible_fields) for row in rows],
        "total": int(total or 0) if total is not None else None,
        "page": page,
        "page_size": page_size,
        "has_more": False,
        "next_cursor": None,
    }


async def _get_physical_record(db: AsyncSession, form, fields: list, visible_fields: set[str], record_id: int, *, include_deleted: bool) -> dict:
    table_name = str(form.table_name)
    assert_safe_identifier(table_name)
    await _ensure_physical_form_table(db, form, fields)
    query_fields = _visible_field_subset(fields, visible_fields)
    columns = ["id", "tenant_id", "record_status", "created_by", "updated_by", "deleted_at", "created_at", "updated_at"]
    for field in query_fields:
        columns.append(_physical_column_name(field.field_name))
    clauses = ["id = :id", "tenant_id = :tenant_id"]
    if not include_deleted:
        clauses.append("deleted_at IS NULL")
    row = (await db.execute(
        text(f"SELECT {', '.join(columns)} FROM {table_name} WHERE {' AND '.join(clauses)}"),
        {"id": record_id, "tenant_id": form.tenant_id},
    )).first()
    if not row:
        raise HTTPException(404, "Record not found")
    return {"data": _physical_record_payload(row, form, fields, visible_fields=visible_fields)}


def _physical_write_payload(fields: list, data: dict, editable_fields: set[str]) -> dict:
    field_by_name = {field.field_name: field for field in fields if not field.archived}
    payload = {
        key: _coerce_physical_value(field_by_name[key], value)
        for key, value in data.items()
        if key in field_by_name and key in editable_fields
    }
    denied_fields = sorted(set(data.keys()) - editable_fields)
    if denied_fields:
        raise HTTPException(403, f"Field permission denied: {', '.join(denied_fields)}")
    return payload


def _coerce_physical_value(field, value):
    if value in (None, ""):
        return None
    field_type = str(field.field_type or "string").lower()
    if field_type == "date" and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    if field_type == "datetime" and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _normalize_sql_type(raw: str) -> str:
    value = str(raw or "").strip().lower()
    if value.startswith("timestamp"):
        return "timestamp"
    if value in {"double precision", "double", "float", "real"}:
        return "double precision"
    if value.startswith("varchar") or value.startswith("character varying") or value in {"text", "clob", "string"}:
        return "text"
    if value.startswith("int"):
        return "integer"
    return value


async def _physical_table_column_types(db: AsyncSession, table_name: str) -> dict[str, str]:
    assert_safe_identifier(table_name)
    if DB_TYPE == "sqlite":
        rows = await db.execute(text(f"PRAGMA table_info({table_name})"))
        return {str(row[1]): _normalize_sql_type(row[2]) for row in rows.all()}
    rows = await db.execute(
        text(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    )
    return {str(row[0]): _normalize_sql_type(row[1]) for row in rows.all()}


async def _physical_record_field_impact(db: AsyncSession, tenant_id: int, form, field) -> dict:
    """Field change impact for physical-table forms, via SQL aggregation.

    Mirrors the JSON-record scan semantics: how many live rows have a value,
    how many would violate a new required flag, and how many values a type or
    enum change would strand. The DDL layer only ever ADDs columns, so a type
    change on a populated column counts every filled value as incompatible.
    """
    table_name = str(form.table_name)
    assert_safe_identifier(table_name)
    column_name = _physical_column_name(field.field_name)
    column_types = await _physical_table_column_types(db, table_name)
    if not column_types:  # table not materialized yet
        return {"record_count": 0, "filled_count": 0, "missing_required_count": 0, "incompatible_count": 0}
    base_where = "tenant_id = :tenant_id AND deleted_at IS NULL"
    params: dict[str, Any] = {"tenant_id": tenant_id}
    total = int(await db.scalar(text(f"SELECT COUNT(*) FROM {table_name} WHERE {base_where}"), params) or 0)
    filled = 0
    incompatible = 0
    if column_name in column_types:
        filled_where = f"{base_where} AND {column_name} IS NOT NULL AND CAST({column_name} AS TEXT) != ''"
        filled = int(await db.scalar(text(f"SELECT COUNT(*) FROM {table_name} WHERE {filled_where}"), params) or 0)
        allowed = _field_allowed_values(field) if str(field.field_type or "").lower() == "enum" else None
        if allowed:
            enum_params = {f"enum_{index}": value for index, value in enumerate(sorted(allowed))}
            in_clause = ", ".join(f":{key}" for key in enum_params)
            incompatible = int(await db.scalar(
                text(f"SELECT COUNT(*) FROM {table_name} WHERE {filled_where} AND CAST({column_name} AS TEXT) NOT IN ({in_clause})"),
                {**params, **enum_params},
            ) or 0)
        elif _normalize_sql_type(_physical_column_type(field)) != column_types[column_name]:
            incompatible = filled
    missing_required = (total - filled) if field.required else 0
    return {
        "record_count": total,
        "filled_count": filled,
        "missing_required_count": missing_required,
        "incompatible_count": incompatible,
    }


async def _dynamic_record_field_impact(db: AsyncSession, tenant_id: int, form_id: int, field) -> dict:
    from app.models.relational import DynamicRecord, Form

    form = await db.get(Form, form_id)
    if form is not None and _uses_physical_form_table(form):
        return await _physical_record_field_impact(db, tenant_id, form, field)

    rows = (await db.execute(
        select(DynamicRecord.data).where(
            DynamicRecord.form_id == form_id,
            DynamicRecord.tenant_id == tenant_id,
            DynamicRecord.deleted_at.is_(None),
        )
    )).scalars().all()
    total = len(rows)
    filled = 0
    missing_required = 0
    incompatible = 0
    for data in rows:
        values = data or {}
        value = values.get(field.field_name)
        if value not in (None, ""):
            filled += 1
        if field.required and value in (None, ""):
            missing_required += 1
        if not _field_value_is_compatible(field, value):
            incompatible += 1
    return {
        "record_count": total,
        "filled_count": filled,
        "missing_required_count": missing_required,
        "incompatible_count": incompatible,
    }
