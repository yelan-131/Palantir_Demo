"""Atomic auto-encoding (料号) sequence allocation and uniqueness backstops."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.form_engine.encoding import (
    _code_sequence_from_value,
    _encoding_rule_for_field,
    _is_encoding_field,
    _render_code_template,
    _sequence_period_key,
)
from app.api.form_engine.naming import _physical_column_name, _uses_physical_form_table
from app.api.form_engine.physical import _sql_current_timestamp


async def _max_dynamic_code_sequence(db: AsyncSession, tenant_id: int, form_id: int, field_name: str, rule: dict) -> int:
    """Legacy max() scan over JSON records; only used to seed new counters."""
    from app.models.relational import DynamicRecord

    rows = (await db.execute(
        select(DynamicRecord.data)
        .where(
            DynamicRecord.tenant_id == tenant_id,
            DynamicRecord.form_id == form_id,
        )
    )).scalars().all()
    prefix = str(rule.get("prefix") or "").strip()
    date_token = _sequence_period_key(rule)
    max_sequence = 0
    for data in rows:
        if not isinstance(data, dict):
            continue
        value = str(data.get(field_name) or "")
        if prefix and not value.startswith(prefix):
            continue
        if date_token and date_token not in value:
            continue
        max_sequence = max(max_sequence, _code_sequence_from_value(value, rule))
    return max_sequence


async def _max_physical_code_sequence(db: AsyncSession, tenant_id: int, form, field_name: str, rule: dict) -> int:
    """Legacy max() scan over a physical table; only used to seed new counters."""
    table_name = str(form.table_name)
    column_name = _physical_column_name(field_name)
    assert_safe_identifier(table_name)
    assert_safe_identifier(column_name)
    rows = (await db.execute(
        text(f"SELECT {column_name} FROM {table_name} WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )).all()
    prefix = str(rule.get("prefix") or "").strip()
    date_token = _sequence_period_key(rule)
    max_sequence = 0
    for row in rows:
        value = str(row[0] or "")
        if prefix and not value.startswith(prefix):
            continue
        if date_token and date_token not in value:
            continue
        max_sequence = max(max_sequence, _code_sequence_from_value(value, rule))
    return max_sequence


_CODE_SEQUENCE_INCREMENT_SQL = """
    UPDATE form_code_sequences
    SET next_value = next_value + 1, updated_at = {now}
    WHERE tenant_id = :tenant_id AND form_id = :form_id
      AND field_name = :field_name AND period_key = :period_key
    RETURNING next_value
"""

_CODE_SEQUENCE_SEED_SQL = """
    INSERT INTO form_code_sequences (tenant_id, form_id, field_name, period_key, next_value)
    VALUES (:tenant_id, :form_id, :field_name, :period_key, :next_value)
    ON CONFLICT (tenant_id, form_id, field_name, period_key) DO NOTHING
"""


async def _allocate_code_sequence(db: AsyncSession, tenant_id: int, form, field_name: str, rule: dict) -> int:
    """Atomically allocate the next sequence number for an encoding field.

    Counters live in ``form_code_sequences``, one row per (tenant, form, field,
    period). The hot path is a single ``UPDATE ... RETURNING`` so concurrent
    record creation serializes on the row lock instead of racing a max() scan.
    The first allocation for a scope seeds the counter from existing records so
    historical numbering continues unchanged.
    """
    params = {
        "tenant_id": tenant_id,
        "form_id": form.id,
        "field_name": field_name,
        "period_key": _sequence_period_key(rule),
    }
    increment_sql = text(_CODE_SEQUENCE_INCREMENT_SQL.format(now=_sql_current_timestamp()))
    row = (await db.execute(increment_sql, params)).first()
    if row:
        return int(row[0])
    # First allocation for this scope: seed from existing data, then increment.
    # ON CONFLICT DO NOTHING makes the seed race-safe without savepoints.
    if _uses_physical_form_table(form):
        seed = await _max_physical_code_sequence(db, tenant_id, form, field_name, rule)
    else:
        seed = await _max_dynamic_code_sequence(db, tenant_id, form.id, field_name, rule)
    await db.execute(text(_CODE_SEQUENCE_SEED_SQL), {**params, "next_value": seed})
    row = (await db.execute(increment_sql, params)).first()
    if not row:
        raise HTTPException(500, f"Failed to allocate code sequence for field {field_name}")
    return int(row[0])


async def _code_value_exists(
    db: AsyncSession,
    tenant_id: int,
    form,
    field_name: str,
    value: Any,
    *,
    exclude_record_id: Optional[int] = None,
) -> bool:
    """Uniqueness backstop: is this encoding value already taken on the form?"""
    if _uses_physical_form_table(form):
        table_name = str(form.table_name)
        column_name = _physical_column_name(field_name)
        assert_safe_identifier(table_name)
        assert_safe_identifier(column_name)
        clause = f"SELECT 1 FROM {table_name} WHERE tenant_id = :tenant_id AND {column_name} = :value"
        params: dict[str, Any] = {"tenant_id": tenant_id, "value": str(value)}
        if exclude_record_id is not None:
            clause += " AND id != :exclude_id"
            params["exclude_id"] = exclude_record_id
        return (await db.execute(text(f"{clause} LIMIT 1"), params)).first() is not None

    from app.models.relational import DynamicRecord

    query = select(DynamicRecord.id).where(
        DynamicRecord.tenant_id == tenant_id,
        DynamicRecord.form_id == form.id,
        DynamicRecord.data[field_name].as_string() == str(value),
    )
    if exclude_record_id is not None:
        query = query.where(DynamicRecord.id != exclude_record_id)
    return (await db.execute(query.limit(1))).first() is not None


_CODE_ALLOCATION_MAX_ATTEMPTS = 5


async def _apply_record_encoding_rules(db: AsyncSession, tenant_id: int, form, fields: list, data: dict) -> dict:
    payload = dict(data or {})
    for field in fields:
        if getattr(field, "archived", False) or not _is_encoding_field(field):
            continue
        rule = _encoding_rule_for_field(field)
        if rule.get("enabled") is False:
            continue
        field_name = field.field_name
        current_value = payload.get(field_name)
        allow_manual = bool(rule.get("allowManualOverride") or rule.get("allow_manual_override"))
        if current_value not in (None, "") and allow_manual:
            if await _code_value_exists(db, tenant_id, form, field_name, current_value):
                raise HTTPException(409, f"Duplicate code for field {field_name}: {current_value}")
            continue
        for _ in range(_CODE_ALLOCATION_MAX_ATTEMPTS):
            sequence = await _allocate_code_sequence(db, tenant_id, form, field_name, rule)
            candidate = _render_code_template(rule, sequence)
            # Manual overrides may have squatted on a generated value; skip past them.
            if not await _code_value_exists(db, tenant_id, form, field_name, candidate):
                payload[field_name] = candidate
                break
        else:
            raise HTTPException(409, f"Unable to allocate a unique code for field {field_name}")
    return payload


async def _assert_unique_code_values(
    db: AsyncSession,
    tenant_id: int,
    form,
    fields: list,
    data_updates: dict,
    *,
    exclude_record_id: Optional[int] = None,
) -> None:
    """Reject manual edits that would duplicate another record's encoding value."""
    for field in fields:
        if getattr(field, "archived", False) or not _is_encoding_field(field):
            continue
        value = (data_updates or {}).get(field.field_name)
        if value in (None, ""):
            continue
        if await _code_value_exists(db, tenant_id, form, field.field_name, value, exclude_record_id=exclude_record_id):
            raise HTTPException(409, f"Duplicate code for field {field.field_name}: {value}")
