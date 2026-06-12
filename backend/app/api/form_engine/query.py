"""Search/filter/sort helpers shared by dynamic-JSON and physical record queries."""
from __future__ import annotations

import json
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.permissions import allowed_form_fields


def _is_anonymous_reader(user: dict) -> bool:
    return False


def _record_matches_search(record, fields: list, search: Optional[str]) -> bool:
    if not search:
        return True
    needle = search.lower()
    searchable_names = [field.field_name for field in fields if field.searchable and not field.archived]
    names = searchable_names or [field.field_name for field in fields if not field.archived]
    values = record.data or {}
    return any(needle in str(values.get(name, "")).lower() for name in names)


def _visible_field_subset(fields: list, visible_fields: set[str]) -> list:
    return [
        field
        for field in fields
        if not field.archived and field.field_name in visible_fields
    ]


async def _runtime_visible_field_names(user: dict, form_id: int, fields: list, db: AsyncSession) -> set[str]:
    if _is_anonymous_reader(user):
        return {field.field_name for field in fields if not field.archived}
    return await allowed_form_fields(user, form_id, "view", fields, db)


def _parse_record_filters(filters_json: Optional[str]) -> list[dict]:
    if not filters_json:
        return []
    try:
        parsed = json.loads(filters_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid filters JSON: {exc}") from exc
    if not isinstance(parsed, list):
        raise HTTPException(400, "filters must be a JSON array")
    return [item for item in parsed if isinstance(item, dict)]


def _record_matches_filters(record, fields: list, filters: list[dict]) -> bool:
    if not filters:
        return True
    allowed_fields = {field.field_name for field in fields if not field.archived}
    values = record.data or {}
    for filter_item in filters:
        field = str(filter_item.get("field") or "")
        op = str(filter_item.get("op") or "equals")
        expected = filter_item.get("value")
        if field not in allowed_fields:
            raise HTTPException(400, f"Invalid filter field: {field}")
        actual = values.get(field)
        if expected in (None, ""):
            continue
        if op == "contains":
            if str(expected).lower() not in str(actual or "").lower():
                return False
        elif op == "equals":
            if str(actual) != str(expected):
                return False
        elif op == "between":
            if not isinstance(expected, list) or len(expected) != 2:
                raise HTTPException(400, f"Invalid between filter for field: {field}")
            start, end = expected
            actual_text = str(actual or "")
            if start and actual_text < str(start):
                return False
            if end and actual_text > str(end):
                return False
        elif op == "gte":
            if str(actual or "") < str(expected):
                return False
        elif op == "lte":
            if str(actual or "") > str(expected):
                return False
        else:
            raise HTTPException(400, f"Invalid filter operator: {op}")
    return True


def _queryable_field_names(fields: list) -> set[str]:
    return {
        field.field_name
        for field in fields
        if not field.archived and (getattr(field, "searchable", False) or getattr(field, "sortable", False))
    }


def _sortable_field_names(fields: list) -> set[str]:
    return {
        field.field_name
        for field in fields
        if not field.archived and getattr(field, "sortable", False)
    }


def _ensure_filter_fields_visible(filters: list[dict], visible_fields: set[str]) -> None:
    for filter_item in filters:
        field = str(filter_item.get("field") or "")
        expected = filter_item.get("value")
        if expected in (None, ""):
            continue
        if field not in visible_fields:
            raise HTTPException(403, f"Field permission denied for filtering: {field}")


def _ensure_sort_field_allowed(sort_field: Optional[str], fields: list, visible_fields: set[str]) -> None:
    if not sort_field:
        return
    known_fields = {field.field_name for field in fields if not field.archived}
    if sort_field not in known_fields:
        raise HTTPException(400, f"Invalid sort field: {sort_field}")
    if sort_field not in visible_fields:
        raise HTTPException(403, f"Field permission denied for sorting: {sort_field}")
    if sort_field not in _sortable_field_names(fields):
        raise HTTPException(400, f"Field is not indexed for sorting: {sort_field}")


def _apply_record_sort_query(query, record_model, sort_field: Optional[str], sort_order: str):
    if not sort_field:
        return query.order_by(record_model.id.desc())
    expr = _json_text_expr(record_model.data, sort_field)
    if sort_order.lower() == "asc":
        return query.order_by(expr.asc(), record_model.id.desc())
    return query.order_by(expr.desc(), record_model.id.desc())


def _json_text_expr(json_column, field_name: str):
    return json_column[field_name].as_string()


def _apply_record_search_query(query, record_model, fields: list, search: Optional[str]):
    if not search:
        return query, True
    searchable_names = [field.field_name for field in fields if field.searchable and not field.archived]
    if not searchable_names:
        return query, False
    pattern = f"%{search.lower()}%"
    conditions = [
        func.lower(_json_text_expr(record_model.data, field_name)).like(pattern)
        for field_name in searchable_names
    ]
    return query.where(or_(*conditions)), True


def _apply_record_filters_query(query, record_model, fields: list, filters: list[dict]):
    if not filters:
        return query, True
    allowed_fields = _queryable_field_names(fields)
    for filter_item in filters:
        field = str(filter_item.get("field") or "")
        op = str(filter_item.get("op") or "equals")
        expected = filter_item.get("value")
        if expected in (None, ""):
            continue
        if field not in allowed_fields:
            raise HTTPException(400, f"Field is not indexed for filtering: {field}")
        expr = _json_text_expr(record_model.data, field)
        if op == "contains":
            query = query.where(func.lower(expr).like(f"%{str(expected).lower()}%"))
        elif op == "equals":
            query = query.where(expr == str(expected))
        elif op == "between":
            if not isinstance(expected, list) or len(expected) != 2:
                raise HTTPException(400, f"Invalid between filter for field: {field}")
            start, end = expected
            if start not in (None, ""):
                query = query.where(expr >= str(start))
            if end not in (None, ""):
                query = query.where(expr <= str(end))
        elif op == "gte":
            query = query.where(expr >= str(expected))
        elif op == "lte":
            query = query.where(expr <= str(expected))
        else:
            raise HTTPException(400, f"Invalid filter operator: {op}")
    return query, True


def _ensure_production_record_query_supported(
    search: Optional[str],
    filters: list[dict],
    search_pushed: bool,
    filters_pushed: bool,
) -> None:
    if settings.IS_PRODUCTION and ((search and not search_pushed) or (filters and not filters_pushed)):
        raise HTTPException(400, "Query is not indexed for production dynamic records")
