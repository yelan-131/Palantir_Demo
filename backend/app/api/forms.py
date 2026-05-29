"""Platform form configuration and dynamic record APIs.

These endpoints are the first database-backed layer for application-owned
low-code forms. Creating fields updates metadata only; it does not execute
DDL against business tables.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db, require_admin
from app.config import settings
from app.core.audit import write_audit_log
from app.core.permissions import allowed_form_fields, has_form_permission
from app.services.tenant_onboarding import assert_tenant_quota

router = APIRouter()


class FormCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    application_id: Optional[int] = None
    model_id: Optional[int] = None
    table_name: Optional[str] = None
    storage_mode: str = "dynamic"
    status: str = "draft"
    config: dict = Field(default_factory=dict)


class FormUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[int] = None
    table_name: Optional[str] = None
    storage_mode: Optional[str] = None
    status: Optional[str] = None
    config: Optional[dict] = None


class ApplicationFormUpsert(BaseModel):
    form_id: int
    alias: Optional[str] = None
    enabled: bool = True
    default_view: str = "list"
    data_scope: Optional[str] = None
    allow_create: bool = True
    allow_edit: bool = True
    allow_delete: bool = True
    allow_export: bool = False
    sort_order: int = 0


class FormFieldCreate(BaseModel):
    field_name: str
    label: str
    field_type: str = "string"
    business_type: Optional[str] = None
    control_type: Optional[str] = None
    data_source: Optional[str] = None
    encoding_rule: Optional[dict] = None
    required: bool = False
    visible_in_list: bool = True
    visible_in_form: bool = True
    searchable: bool = False
    sortable: bool = False
    default_value: Optional[str] = None
    enum_values: Optional[dict] = None
    validation: Optional[dict] = None
    ui_config: Optional[dict] = None
    sort_order: int = 0


class FormFieldUpdate(BaseModel):
    label: Optional[str] = None
    field_type: Optional[str] = None
    business_type: Optional[str] = None
    control_type: Optional[str] = None
    data_source: Optional[str] = None
    encoding_rule: Optional[dict] = None
    required: Optional[bool] = None
    visible_in_list: Optional[bool] = None
    visible_in_form: Optional[bool] = None
    searchable: Optional[bool] = None
    sortable: Optional[bool] = None
    archived: Optional[bool] = None
    default_value: Optional[str] = None
    enum_values: Optional[dict] = None
    validation: Optional[dict] = None
    ui_config: Optional[dict] = None
    sort_order: Optional[int] = None


class DynamicRecordCreate(BaseModel):
    data: dict
    status: str = "active"


class DynamicRecordUpdate(BaseModel):
    data: Optional[dict] = None
    status: Optional[str] = None


class MenuNodeCreate(BaseModel):
    parent_id: Optional[int] = None
    node_type: str = "form"
    title: str
    icon: Optional[str] = None
    form_id: Optional[int] = None
    route_path: Optional[str] = None
    visible: bool = True
    default_entry: bool = False
    sort_order: int = 0


class MenuNodeUpdate(BaseModel):
    parent_id: Optional[int] = None
    node_type: Optional[str] = None
    title: Optional[str] = None
    icon: Optional[str] = None
    form_id: Optional[int] = None
    route_path: Optional[str] = None
    visible: Optional[bool] = None
    default_entry: Optional[bool] = None
    sort_order: Optional[int] = None


class FormLayoutUpsert(BaseModel):
    layout_type: str = "list"
    config: dict = Field(default_factory=dict)


class FormActionCreate(BaseModel):
    action_key: str
    label: str
    action_type: str = "builtin"
    config: dict = Field(default_factory=dict)
    enabled: bool = True
    sort_order: int = 0


class FormActionUpdate(BaseModel):
    label: Optional[str] = None
    action_type: Optional[str] = None
    config: Optional[dict] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class FormPermissionCreate(BaseModel):
    role_id: int
    action: str
    effect: str = "allow"
    field_name: Optional[str] = None


class FormPermissionUpdate(BaseModel):
    action: Optional[str] = None
    effect: Optional[str] = None
    field_name: Optional[str] = None


class WorkflowBindingCreate(BaseModel):
    workflow_id: int
    trigger_action: str = "submit"
    enabled: bool = True
    config: dict = Field(default_factory=dict)


class WorkflowBindingUpdate(BaseModel):
    workflow_id: Optional[int] = None
    trigger_action: Optional[str] = None
    enabled: Optional[bool] = None
    config: Optional[dict] = None


def _uid(user: dict) -> Optional[int]:
    uid = user.get("uid")
    return int(uid) if isinstance(uid, int) and uid > 0 else None


async def _ensure_form_permission(
    db: AsyncSession,
    user: dict,
    form_id: int,
    action: str,
) -> None:
    if not await has_form_permission(user, form_id, action, db):
        raise HTTPException(403, "Form permission denied")


def _validate_form_code(code: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", code):
        raise HTTPException(400, f"Invalid form code: {code!r}")


def _validate_field_name(field_name: str) -> None:
    assert_safe_identifier(field_name)


FIELD_TYPE_ALIASES = {
    "string": "string",
    "text": "text",
    "longText": "text",
    "long_text": "text",
    "number": "number",
    "integer": "integer",
    "int": "integer",
    "decimal": "decimal",
    "float": "float",
    "boolean": "boolean",
    "bool": "boolean",
    "date": "date",
    "datetime": "datetime",
    "enum": "enum",
    "select": "enum",
    "person": "string",
    "relation": "relation",
    "attachment": "json",
    "json": "json",
    "code": "code",
}


def _normalize_field_type(field_type: Optional[str]) -> str:
    raw = (field_type or "string").strip()
    normalized = FIELD_TYPE_ALIASES.get(raw, FIELD_TYPE_ALIASES.get(raw.lower()))
    if normalized:
        return normalized
    raise HTTPException(422, f"Unsupported field_type: {field_type}")


def _normalize_form_field_data(
    data: dict,
    *,
    current_field_type: Optional[str] = None,
    current_ui_config: Optional[dict] = None,
) -> dict:
    normalized = dict(data)
    business_type = normalized.pop("business_type", None)
    control_type = normalized.pop("control_type", None)
    data_source = normalized.pop("data_source", None)
    encoding_rule = normalized.pop("encoding_rule", None)
    ui_config_input = normalized.pop("ui_config", None)

    explicit_type = business_type or normalized.get("field_type")
    effective_type = _normalize_field_type(explicit_type or current_field_type)
    if explicit_type is not None or current_field_type is None:
        normalized["field_type"] = effective_type

    ui_config = dict(current_ui_config or {})
    ui_config_touched = False
    if ui_config_input is not None:
        ui_config.update(ui_config_input or {})
        ui_config_touched = True
    if control_type is not None:
        ui_config["controlType"] = control_type
        ui_config_touched = True
    if data_source is not None:
        ui_config["dataSource"] = data_source
        ui_config_touched = True

    ui_config_adds_encoding = isinstance(ui_config_input, dict) and "encodingRule" in ui_config_input
    if (encoding_rule is not None or ui_config_adds_encoding) and effective_type != "code":
        raise HTTPException(422, "encoding_rule requires field_type=code")
    if effective_type == "code":
        if encoding_rule is not None:
            ui_config["encodingRule"] = encoding_rule
            ui_config_touched = True
        elif ui_config.get("autoNumber") and not ui_config.get("encodingRule"):
            ui_config["encodingRule"] = {"enabled": True, "template": ui_config["autoNumber"]}
            ui_config_touched = True
    elif explicit_type is not None:
        ui_config.pop("encodingRule", None)
        ui_config.pop("autoNumber", None)
        ui_config_touched = True

    if ui_config_touched:
        normalized["ui_config"] = ui_config or None
    return normalized


def _form_payload(form, *, fields: Optional[list] = None, applications: Optional[list] = None) -> dict:
    payload = {
        "id": form.id,
        "tenant_id": getattr(form, "tenant_id", None),
        "name": form.name,
        "code": form.code,
        "description": form.description,
        "model_id": form.model_id,
        "table_name": form.table_name,
        "storage_mode": form.storage_mode,
        "status": form.status,
        "owner_id": form.owner_id,
        "config": form.config or {},
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
    }
    if fields is not None:
        payload["fields"] = [_field_payload(field) for field in fields]
    if applications is not None:
        payload["applications"] = applications
    return payload


def _field_payload(field) -> dict:
    ui_config = field.ui_config or {}
    return {
        "id": field.id,
        "form_id": field.form_id,
        "meta_field_id": field.meta_field_id,
        "field_name": field.field_name,
        "label": field.label,
        "field_type": field.field_type,
        "business_type": field.field_type,
        "control_type": ui_config.get("controlType"),
        "data_source": ui_config.get("dataSource") or ui_config.get("relation"),
        "encoding_rule": ui_config.get("encodingRule"),
        "required": field.required,
        "visible_in_list": field.visible_in_list,
        "visible_in_form": field.visible_in_form,
        "searchable": field.searchable,
        "sortable": field.sortable,
        "archived": field.archived,
        "default_value": field.default_value,
        "enum_values": field.enum_values,
        "validation": field.validation,
        "ui_config": ui_config,
        "sort_order": field.sort_order,
    }


def _form_version_payload(version) -> dict:
    return {
        "id": version.id,
        "tenant_id": getattr(version, "tenant_id", None),
        "form_id": version.form_id,
        "version": version.version,
        "status": version.status,
        "snapshot": version.snapshot or {},
        "impact_report": version.impact_report or {},
        "published_by": version.published_by,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "updated_at": version.updated_at.isoformat() if version.updated_at else None,
    }


def _application_form_payload(binding) -> dict:
    return {
        "id": binding.id,
        "application_id": binding.application_id,
        "form_id": binding.form_id,
        "alias": binding.alias,
        "enabled": binding.enabled,
        "default_view": binding.default_view,
        "data_scope": binding.data_scope,
        "allow_create": binding.allow_create,
        "allow_edit": binding.allow_edit,
        "allow_delete": binding.allow_delete,
        "allow_export": binding.allow_export,
        "sort_order": binding.sort_order,
        "form": _form_payload(binding.form) if getattr(binding, "form", None) else None,
    }


def _record_payload(record, *, visible_fields: Optional[set[str]] = None) -> dict:
    data = record.data or {}
    if visible_fields is not None:
        data = {key: value for key, value in data.items() if key in visible_fields}
    return {
        "id": record.id,
        "form_id": record.form_id,
        "model_id": record.model_id,
        "schema_version": getattr(record, "schema_version", 1),
        "data": data,
        "status": record.status,
        "created_by": record.created_by,
        "updated_by": record.updated_by,
        "deleted_at": record.deleted_at.isoformat() if record.deleted_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


def _field_allowed_values(field) -> Optional[set[str]]:
    values = field.enum_values
    if not values:
        return None
    if isinstance(values, list):
        return {str(value) for value in values}
    if isinstance(values, dict):
        raw = values.get("values") if "values" in values else values
        if isinstance(raw, list):
            return {str(value.get("value", value)) if isinstance(value, dict) else str(value) for value in raw}
        return {str(key) for key in raw.keys()} if isinstance(raw, dict) else None
    return None


def _validate_record_data(fields: list, data: dict, *, partial: bool = False) -> None:
    if not fields:
        return
    active_fields = [field for field in fields if not field.archived]
    by_name = {field.field_name: field for field in active_fields}
    unknown = sorted(set(data.keys()) - set(by_name.keys()))
    if unknown:
        raise HTTPException(422, f"Unknown field(s): {', '.join(unknown)}")

    if not partial:
        missing = [
            field.label or field.field_name
            for field in active_fields
            if field.required and data.get(field.field_name) in (None, "")
        ]
        if missing:
            raise HTTPException(422, f"Missing required field(s): {', '.join(missing)}")

    for name, value in data.items():
        if value in (None, ""):
            continue
        field = by_name[name]
        field_type = (field.field_type or "string").lower()
        if field_type in {"number", "decimal", "float"} and not isinstance(value, (int, float)):
            raise HTTPException(422, f"Field {name} must be a number")
        if field_type in {"integer", "int"} and not isinstance(value, int):
            raise HTTPException(422, f"Field {name} must be an integer")
        if field_type == "boolean" and not isinstance(value, bool):
            raise HTTPException(422, f"Field {name} must be a boolean")
        if field_type in {"date", "datetime"} and not isinstance(value, str):
            raise HTTPException(422, f"Field {name} must be an ISO date string")
        if field_type == "code" and not isinstance(value, str):
            raise HTTPException(422, f"Field {name} must be a code string")
        if field_type == "enum":
            allowed = _field_allowed_values(field)
            if allowed and str(value) not in allowed:
                raise HTTPException(422, f"Field {name} must be one of: {', '.join(sorted(allowed))}")


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


def _merged_record_data(existing: Optional[dict], patch: Optional[dict]) -> dict:
    return {**(existing or {}), **(patch or {})}


def _field_value_is_compatible(field, value) -> bool:
    if value in (None, ""):
        return True
    field_type = (field.field_type or "string").lower()
    if field_type in {"number", "decimal", "float"}:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field_type in {"integer", "int"}:
        return isinstance(value, int) and not isinstance(value, bool)
    if field_type == "boolean":
        return isinstance(value, bool)
    if field_type in {"date", "datetime"}:
        return isinstance(value, str)
    if field_type == "code":
        return isinstance(value, str)
    if field_type == "enum":
        allowed = _field_allowed_values(field)
        return not allowed or str(value) in allowed
    return True


async def _dynamic_record_field_impact(db: AsyncSession, tenant_id: int, form_id: int, field) -> dict:
    from app.models.relational import DynamicRecord

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


def _field_cfg_value(field, key: str, default=None):
    return field.get(key, default) if isinstance(field, dict) else getattr(field, key, default)


def _field_cfg_name(field) -> str:
    return str(_field_cfg_value(field, "field_name") or "")


def _field_cfg_label(field) -> str:
    return str(_field_cfg_value(field, "label") or _field_cfg_name(field))


def _field_cfg_is_active(field) -> bool:
    return not bool(_field_cfg_value(field, "archived", False))


def _field_cfg_allowed_values(field) -> Optional[set[str]]:
    proxy = type("FieldProxy", (), {})()
    proxy.enum_values = _field_cfg_value(field, "enum_values")
    return _field_allowed_values(proxy)


def _field_cfg_value_is_compatible(field, value) -> bool:
    proxy = type("FieldProxy", (), {})()
    proxy.field_type = _field_cfg_value(field, "field_type", "string")
    proxy.enum_values = _field_cfg_value(field, "enum_values")
    return _field_value_is_compatible(proxy, value)


def _record_field_impact(rows: list[dict], field) -> dict:
    field_name = _field_cfg_name(field)
    required = bool(_field_cfg_value(field, "required", False))
    total = len(rows)
    filled = 0
    missing_required = 0
    incompatible = 0
    for row in rows:
        values = row or {}
        value = values.get(field_name)
        if value not in (None, ""):
            filled += 1
        if required and value in (None, ""):
            missing_required += 1
        if not _field_cfg_value_is_compatible(field, value):
            incompatible += 1
    return {
        "record_count": total,
        "filled_count": filled,
        "missing_required_count": missing_required,
        "incompatible_count": incompatible,
    }


async def _latest_form_version(db: AsyncSession, tenant_id: int, form_id: int):
    from app.models.relational import FormVersion

    return await db.scalar(
        select(FormVersion)
        .where(FormVersion.form_id == form_id, FormVersion.tenant_id == tenant_id)
        .order_by(FormVersion.version.desc(), FormVersion.id.desc())
        .limit(1)
    )


def _field_proxy_from_payload(payload: dict):
    proxy = type("PublishedField", (), {})()
    for key, default in {
        "id": None,
        "form_id": None,
        "meta_field_id": None,
        "field_name": "",
        "label": "",
        "field_type": "string",
        "required": False,
        "visible_in_list": True,
        "visible_in_form": True,
        "searchable": False,
        "sortable": False,
        "archived": False,
        "default_value": None,
        "enum_values": None,
        "validation": None,
        "ui_config": None,
        "sort_order": 0,
    }.items():
        setattr(proxy, key, payload.get(key, default))
    return proxy


async def _runtime_form_fields(db: AsyncSession, tenant_id: int, form_id: int) -> list:
    from app.models.relational import FormField

    version = await _latest_form_version(db, tenant_id, form_id)
    if version:
        return [
            _field_proxy_from_payload(field)
            for field in (version.snapshot or {}).get("fields", [])
            if isinstance(field, dict)
        ]
    return (await db.execute(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()


async def _form_snapshot(db: AsyncSession, tenant_id: int, form) -> dict:
    from app.models.relational import FormAction, FormField, FormLayout, FormPermission, WorkflowBinding

    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form.id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    layouts = (await db.execute(
        select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.tenant_id == tenant_id).order_by(FormLayout.layout_type)
    )).scalars().all()
    actions = (await db.execute(
        select(FormAction).where(FormAction.form_id == form.id, FormAction.tenant_id == tenant_id).order_by(FormAction.sort_order, FormAction.id)
    )).scalars().all()
    permissions = (await db.execute(
        select(FormPermission).where(FormPermission.form_id == form.id, FormPermission.tenant_id == tenant_id).order_by(FormPermission.id)
    )).scalars().all()
    bindings = (await db.execute(
        select(WorkflowBinding).where(WorkflowBinding.form_id == form.id, WorkflowBinding.tenant_id == tenant_id).order_by(WorkflowBinding.id)
    )).scalars().all()
    return {
        "form": _form_payload(form),
        "fields": [_field_payload(field) for field in fields],
        "layouts": [_layout_payload(layout) for layout in layouts],
        "actions": [_action_payload(action) for action in actions],
        "permissions": [_permission_payload(permission) for permission in permissions],
        "workflow_bindings": [_workflow_binding_payload(binding) for binding in bindings],
    }


def _published_form_payload(form, version, *, applications: Optional[list] = None) -> dict:
    snapshot = version.snapshot or {}
    form_snapshot = snapshot.get("form") or {}
    payload = {
        **_form_payload(form),
        **{key: value for key, value in form_snapshot.items() if key in {"name", "code", "description", "model_id", "table_name", "storage_mode", "status", "owner_id", "config"}},
        "schema_mode": "published",
        "published_version": version.version,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "fields": [field for field in snapshot.get("fields", []) if _field_cfg_is_active(field)],
    }
    if applications is not None:
        payload["applications"] = applications
    return payload


def _promote_snapshot_config(snapshot: dict, published_at: str, version: int) -> dict:
    promoted = {**snapshot}
    form_payload = {**(promoted.get("form") or {})}
    config = {**(form_payload.get("config") or {})}
    draft_view = config.get("viewConfigDraft")
    if draft_view is not None:
        config["viewConfig"] = draft_view
    view_meta = {**(config.get("viewConfigMeta") or {})}
    if view_meta:
        view_meta["publishedVersion"] = version
        view_meta["publishedAt"] = published_at
        view_meta["status"] = "published"
        config["viewConfigMeta"] = view_meta
    config["publishedSchemaVersion"] = version
    config["publishedAt"] = published_at
    form_payload["status"] = "published"
    form_payload["config"] = config
    promoted["form"] = form_payload
    return promoted


def _publish_impact_report(latest_version, next_version: int, draft_snapshot: dict, record_rows: list[dict]) -> dict:
    previous_fields = {
        _field_cfg_name(field): field
        for field in ((latest_version.snapshot or {}).get("fields", []) if latest_version else [])
        if _field_cfg_name(field)
    }
    draft_fields = {
        _field_cfg_name(field): field
        for field in draft_snapshot.get("fields", [])
        if _field_cfg_name(field)
    }
    items: list[dict] = []

    for field_name, field in draft_fields.items():
        if not _field_cfg_is_active(field):
            continue
        previous = previous_fields.get(field_name)
        impact = _record_field_impact(record_rows, field)
        if previous is None:
            if _field_cfg_value(field, "required", False) and impact["missing_required_count"] > 0:
                items.append({
                    "level": "blocking",
                    "type": "new_required_field_missing",
                    "field_name": field_name,
                    "label": _field_cfg_label(field),
                    "detail": "New required field would make existing records invalid",
                    "affected_count": impact["missing_required_count"],
                })
            else:
                items.append({
                    "level": "info",
                    "type": "field_added",
                    "field_name": field_name,
                    "label": _field_cfg_label(field),
                    "detail": "Field will be available in the next published schema",
                    "affected_count": 0,
                })
            continue

        if _field_cfg_value(previous, "field_type") != _field_cfg_value(field, "field_type") and impact["incompatible_count"] > 0:
            items.append({
                "level": "blocking",
                "type": "field_type_incompatible",
                "field_name": field_name,
                "label": _field_cfg_label(field),
                "detail": "Type change is incompatible with existing record values",
                "affected_count": impact["incompatible_count"],
            })
        if not _field_cfg_value(previous, "required", False) and _field_cfg_value(field, "required", False) and impact["missing_required_count"] > 0:
            items.append({
                "level": "blocking",
                "type": "required_field_missing",
                "field_name": field_name,
                "label": _field_cfg_label(field),
                "detail": "Required change would make existing records invalid",
                "affected_count": impact["missing_required_count"],
            })

        old_allowed = _field_cfg_allowed_values(previous)
        new_allowed = _field_cfg_allowed_values(field)
        if old_allowed and new_allowed and not old_allowed.issubset(new_allowed):
            invalid = sum(1 for row in record_rows if row.get(field_name) not in (None, "") and str(row.get(field_name)) not in new_allowed)
            if invalid:
                items.append({
                    "level": "blocking",
                    "type": "enum_values_narrowed",
                    "field_name": field_name,
                    "label": _field_cfg_label(field),
                    "detail": "Enum choices no longer include values already used by records",
                    "affected_count": invalid,
                })

    for field_name, previous in previous_fields.items():
        draft = draft_fields.get(field_name)
        if draft is None or not _field_cfg_is_active(draft):
            filled = _record_field_impact(record_rows, previous)["filled_count"]
            if filled:
                items.append({
                    "level": "warning",
                    "type": "field_archived_with_data",
                    "field_name": field_name,
                    "label": _field_cfg_label(previous),
                    "detail": "Archived or removed field has historical values; data will be retained but hidden from new forms",
                    "affected_count": filled,
                })

    blocking_count = sum(1 for item in items if item["level"] == "blocking")
    warning_count = sum(1 for item in items if item["level"] == "warning")
    return {
        "next_version": next_version,
        "latest_version": latest_version.version if latest_version else None,
        "record_count": len(record_rows),
        "blocking_count": blocking_count,
        "warning_count": warning_count,
        "items": items,
    }


async def _build_publish_preview(db: AsyncSession, tenant_id: int, form) -> tuple[dict, dict]:
    from app.models.relational import DynamicRecord

    latest = await _latest_form_version(db, tenant_id, form.id)
    next_version = (latest.version + 1) if latest else 1
    snapshot = await _form_snapshot(db, tenant_id, form)
    rows = (await db.execute(
        select(DynamicRecord.data).where(
            DynamicRecord.form_id == form.id,
            DynamicRecord.tenant_id == tenant_id,
            DynamicRecord.deleted_at.is_(None),
        )
    )).scalars().all()
    report = _publish_impact_report(latest, next_version, snapshot, [row or {} for row in rows])
    return report, snapshot


async def _ensure_application_form_binding(db: AsyncSession, application_id: int, form_id: int) -> None:
    from app.models.relational import ApplicationForm
    from app.models.relational import Form

    form = await db.get(Form, form_id)
    tenant_id = getattr(form, "tenant_id", None)
    existing = await db.scalar(
        select(ApplicationForm).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    )
    if existing:
        if not existing.enabled:
            existing.enabled = True
        return
    db.add(ApplicationForm(tenant_id=tenant_id, application_id=application_id, form_id=form_id))


def _menu_node_payload(node) -> dict:
    return {
        "id": node.id,
        "application_id": node.application_id,
        "parent_id": node.parent_id,
        "node_type": node.node_type,
        "title": node.title,
        "icon": node.icon,
        "form_id": node.form_id,
        "route_path": node.route_path,
        "visible": node.visible,
        "default_entry": node.default_entry,
        "sort_order": node.sort_order,
    }


def _layout_payload(layout) -> dict:
    return {
        "id": layout.id,
        "form_id": layout.form_id,
        "layout_type": layout.layout_type,
        "config": layout.config or {},
        "created_at": layout.created_at.isoformat() if layout.created_at else None,
        "updated_at": layout.updated_at.isoformat() if layout.updated_at else None,
    }


def _action_payload(action) -> dict:
    return {
        "id": action.id,
        "form_id": action.form_id,
        "action_key": action.action_key,
        "label": action.label,
        "action_type": action.action_type,
        "config": action.config or {},
        "enabled": action.enabled,
        "sort_order": action.sort_order,
    }


def _permission_payload(permission) -> dict:
    return {
        "id": permission.id,
        "form_id": permission.form_id,
        "role_id": permission.role_id,
        "action": permission.action,
        "effect": permission.effect,
        "field_name": permission.field_name,
    }


def _workflow_binding_payload(binding) -> dict:
    return {
        "id": binding.id,
        "form_id": binding.form_id,
        "workflow_id": binding.workflow_id,
        "trigger_action": binding.trigger_action,
        "enabled": binding.enabled,
        "config": binding.config or {},
    }


STANDARD_WORKFLOW_FIELDS = [
    {"field_name": "processStatus", "label": "流程状态", "field_type": "enum", "visible_in_list": True, "visible_in_form": False, "searchable": True, "sortable": True, "enum_values": {"values": ["未启动", "处理中", "已完成", "已驳回", "已取消"]}},
    {"field_name": "currentNode", "label": "当前节点", "field_type": "string", "visible_in_list": True, "visible_in_form": False, "searchable": True, "sortable": False},
    {"field_name": "currentHandler", "label": "当前处理人", "field_type": "string", "visible_in_list": True, "visible_in_form": False, "searchable": True, "sortable": False},
    {"field_name": "completedAt", "label": "完成时间", "field_type": "datetime", "visible_in_list": False, "visible_in_form": False, "searchable": False, "sortable": True},
    {"field_name": "interactionLog", "label": "处理记录", "field_type": "json", "visible_in_list": False, "visible_in_form": False, "searchable": False, "sortable": False},
]


DEFAULT_BUSINESS_FORMS = [
    {
        "code": "alert-center",
        "name": "告警中心",
        "description": "设备告警登记、确认、派工、处理和关闭的业务表单。",
        "table_name": "equipment_alerts",
        "app_codes": ["maintenance-analysis", "production-dashboard"],
        "fields": [
            {"field_name": "alertId", "label": "告警编号", "field_type": "code", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "sortable": True, "ui_config": {"controlType": "readonly-text", "encodingRule": {"enabled": True, "template": "AL-{yyyyMMdd}-{seq:3}", "prefix": "AL", "datePattern": "YYYYMMDD", "sequenceLength": 3, "fixedLength": 15, "dependencies": [], "resetCycle": "day", "regenerateOnDependencyChange": True, "allowManualOverride": False, "unique": True}}},
            {"field_name": "title", "label": "告警标题", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True},
            {"field_name": "device", "label": "关联设备", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "ui_config": {"relation": "equipment"}},
            {"field_name": "level", "label": "告警等级", "field_type": "enum", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "enum_values": {"values": ["严重", "一般", "提醒"]}},
            {"field_name": "source", "label": "告警来源", "field_type": "enum", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "enum_values": {"values": ["系统监测", "人工上报", "外部接口"]}},
            {"field_name": "occurredAt", "label": "发生时间", "field_type": "datetime", "required": True, "visible_in_list": True, "visible_in_form": True, "sortable": True},
            {"field_name": "owner", "label": "处理人", "field_type": "string", "visible_in_list": True, "visible_in_form": True, "searchable": True, "ui_config": {"relation": "users"}},
            {"field_name": "dueAt", "label": "处理时限", "field_type": "datetime", "visible_in_list": True, "visible_in_form": True, "sortable": True},
            {"field_name": "status", "label": "告警状态", "field_type": "enum", "visible_in_list": True, "visible_in_form": True, "searchable": True, "enum_values": {"values": ["待处理", "处理中", "已关闭", "已驳回"]}},
            {"field_name": "resolution", "label": "处理结论", "field_type": "text", "visible_in_list": False, "visible_in_form": True},
            {"field_name": "evidence", "label": "附件证据", "field_type": "json", "visible_in_list": False, "visible_in_form": True, "ui_config": {"widget": "upload"}},
        ],
        "actions": [
            {"action_key": "acknowledge", "label": "确认告警", "action_type": "workflow", "config": {"trigger_action": "approve", "nextStatus": "处理中", "requiresComment": True}},
            {"action_key": "dispatch", "label": "派工处理", "action_type": "workflow", "config": {"trigger_action": "dispatch", "requiresAssignee": True}},
            {"action_key": "resolve", "label": "提交处理结果", "action_type": "workflow", "config": {"trigger_action": "resolve", "requiresFields": ["resolution", "evidence"]}},
            {"action_key": "close", "label": "关闭归档", "action_type": "workflow", "config": {"trigger_action": "close", "nextStatus": "已关闭"}},
            {"action_key": "export", "label": "导出告警", "action_type": "builtin", "config": {"format": "xlsx"}},
        ],
        "records": [
            {"status": "active", "data": {"alertId": "AL-20260524-001", "title": "SMT-03 回流焊温区 5 持续偏高", "device": "SMT-03 回流焊", "level": "严重", "source": "系统监测", "occurredAt": "2026-05-24T09:18:00+08:00", "owner": "孙浩", "dueAt": "2026-05-24T11:18:00+08:00", "status": "处理中", "resolution": "", "evidence": [{"name": "温度曲线.png", "type": "image"}], "processStatus": "处理中", "currentNode": "维修处理", "currentHandler": "孙浩", "completedAt": "", "interactionLog": [{"time": "09:18", "actor": "系统", "action": "创建告警"}, {"time": "09:25", "actor": "李明", "action": "确认并派工"}]}},
            {"status": "active", "data": {"alertId": "AL-20260524-002", "title": "A 线节拍偏慢超过阈值", "device": "Assembly-A 主线", "level": "一般", "source": "系统监测", "occurredAt": "2026-05-24T10:05:00+08:00", "owner": "李明", "dueAt": "2026-05-24T14:00:00+08:00", "status": "待处理", "resolution": "", "evidence": [], "processStatus": "处理中", "currentNode": "维护确认", "currentHandler": "李明", "completedAt": "", "interactionLog": [{"time": "10:05", "actor": "系统", "action": "创建告警"}]}},
            {"status": "active", "data": {"alertId": "AL-20260523-014", "title": "空压站压力低告警", "device": "AIR-COMP-02", "level": "严重", "source": "外部接口", "occurredAt": "2026-05-23T16:42:00+08:00", "owner": "周强", "dueAt": "2026-05-23T18:42:00+08:00", "status": "已关闭", "resolution": "更换压力传感器并复位空压机，压力恢复稳定。", "evidence": [{"name": "维修记录.pdf", "type": "pdf"}], "processStatus": "已完成", "currentNode": "关闭归档", "currentHandler": "", "completedAt": "2026-05-23T18:10:00+08:00", "interactionLog": [{"time": "16:42", "actor": "系统", "action": "创建告警"}, {"time": "17:02", "actor": "周强", "action": "提交处理结果"}, {"time": "18:10", "actor": "李明", "action": "关闭归档"}]}},
        ],
    },
    {
        "code": "risk-review",
        "name": "风险复核",
        "description": "供应链风险复核、定级、责任分派和闭环跟踪表单。",
        "table_name": "risk_reviews",
        "app_codes": ["supply-risk"],
        "fields": [
            {"field_name": "riskNo", "label": "风险单号", "field_type": "code", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "sortable": True, "ui_config": {"controlType": "readonly-text", "encodingRule": {"enabled": True, "template": "SR-{yyyyMMdd}-{seq:3}", "prefix": "SR", "datePattern": "YYYYMMDD", "sequenceLength": 3, "fixedLength": 15, "dependencies": [], "resetCycle": "day", "regenerateOnDependencyChange": True, "allowManualOverride": False, "unique": True}}},
            {"field_name": "subject", "label": "风险主题", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True},
            {"field_name": "level", "label": "风险等级", "field_type": "enum", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "enum_values": {"values": ["高", "中", "低"]}},
            {"field_name": "owner", "label": "处理人", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "ui_config": {"relation": "users"}},
            {"field_name": "reason", "label": "风险原因", "field_type": "text", "visible_in_list": False, "visible_in_form": True},
            {"field_name": "status", "label": "复核状态", "field_type": "enum", "visible_in_list": True, "visible_in_form": True, "searchable": True, "enum_values": {"values": ["待复核", "定级中", "处理中", "已关闭"]}},
        ],
        "actions": [
            {"action_key": "submit", "label": "提交复核", "action_type": "workflow", "config": {"trigger_action": "submit"}},
            {"action_key": "grade", "label": "风险定级", "action_type": "workflow", "config": {"trigger_action": "approve", "requiresFields": ["level"]}},
            {"action_key": "assign", "label": "责任分派", "action_type": "workflow", "config": {"trigger_action": "assign", "requiresAssignee": True}},
            {"action_key": "close", "label": "处理关闭", "action_type": "workflow", "config": {"trigger_action": "close"}},
        ],
        "records": [
            {"status": "active", "data": {"riskNo": "SR-20260524-001", "subject": "供应商北辰材料批次波动", "level": "高", "owner": "刘洋", "reason": "过去 30 天同类物料已出现 2 次质量波动，影响 SMT 焊接稳定性。", "status": "处理中", "processStatus": "处理中", "currentNode": "责任分派", "currentHandler": "刘洋", "completedAt": "", "interactionLog": [{"time": "09:30", "actor": "王敏", "action": "提交复核"}, {"time": "09:50", "actor": "李明", "action": "定级为高风险"}]}},
            {"status": "active", "data": {"riskNo": "SR-20260523-006", "subject": "华东客户交付窗口压缩", "level": "中", "owner": "李明", "reason": "SO-8821 交付日期提前，需评估替代批次和排产调整。", "status": "已关闭", "processStatus": "已完成", "currentNode": "处理关闭", "currentHandler": "", "completedAt": "2026-05-23T17:30:00+08:00", "interactionLog": [{"time": "13:10", "actor": "系统", "action": "创建风险"}, {"time": "17:30", "actor": "李明", "action": "关闭"}]}},
        ],
    },
]

BUSINESS_FORM_RECORD_TARGETS = {
    "alert-center": 360,
    "risk-review": 260,
}


def _iso_day(day: int, hour: int, minute: int = 0) -> str:
    return f"2026-05-{day:02d}T{hour:02d}:{minute:02d}:00+08:00"


def _generated_alert_record(index: int) -> dict:
    devices = [
        "\u603b\u88c5 A \u7ebf",
        "\u603b\u88c5 B \u7ebf",
        "SMT-01 \u8d34\u7247\u673a",
        "SMT-03 \u56de\u6d41\u710a",
        "\u7a7a\u538b\u7ad9 2#",
        "\u7535\u63a7\u88c5\u914d\u7ebf",
        "\u7ec8\u68c0 E \u7ebf",
        "\u5305\u88c5 F \u7ebf",
    ]
    titles = [
        "\u8282\u62cd\u4f4e\u4e8e\u76ee\u6807",
        "\u6e29\u533a\u6ce2\u52a8\u8d85\u9608\u503c",
        "\u8bbe\u5907\u5065\u5eb7\u5206\u4e0b\u964d",
        "\u5b89\u5168\u5e93\u5b58\u4f4e\u4e8e\u9608\u503c",
        "\u8d28\u68c0\u8fde\u7eed\u68c0\u51fa\u5f02\u5e38",
        "\u5de5\u5355\u5b8c\u5de5\u8fdb\u5ea6\u6ede\u540e",
    ]
    owners = ["\u674e\u660e", "\u738b\u78ca", "\u5468\u5f3a", "\u9648\u6668", "\u5b59\u6d69", "\u8d75\u654f"]
    statuses = ["\u5f85\u5904\u7406", "\u786e\u8ba4\u4e2d", "\u5904\u7406\u4e2d", "\u5df2\u5173\u95ed"]
    device = devices[index % len(devices)]
    level = "\u4e25\u91cd" if index % 11 == 0 else "\u4e00\u822c" if index % 3 else "\u63d0\u9192"
    status = statuses[index % len(statuses)]
    day = 1 + index % 27
    hour = 7 + index % 12
    return {
        "status": "active",
        "data": {
            "alertId": f"AL-202605{day:02d}-{index + 1:04d}",
            "title": f"{device} {titles[index % len(titles)]}",
            "device": device,
            "level": level,
            "source": "\u7cfb\u7edf\u76d1\u6d4b" if index % 4 else "\u5916\u90e8\u63a5\u53e3",
            "occurredAt": _iso_day(day, hour, index % 60),
            "owner": owners[index % len(owners)],
            "dueAt": _iso_day(day, min(hour + (2 if level == "\u4e25\u91cd" else 6), 23), index % 60),
            "status": status,
            "resolution": "\u5df2\u590d\u4f4d\u5e76\u9a8c\u8bc1\u8d8b\u52bf\u6062\u590d\u7a33\u5b9a\u3002" if status == "\u5df2\u5173\u95ed" else "",
            "evidence": [],
            "processStatus": "\u5df2\u5b8c\u6210" if status == "\u5df2\u5173\u95ed" else "\u5904\u7406\u4e2d",
            "currentNode": "\u5173\u95ed\u5f52\u6863" if status == "\u5df2\u5173\u95ed" else "\u7ef4\u4fee\u5904\u7406",
            "currentHandler": "" if status == "\u5df2\u5173\u95ed" else owners[index % len(owners)],
            "completedAt": _iso_day(day, min(hour + 3, 23), index % 60) if status == "\u5df2\u5173\u95ed" else "",
            "interactionLog": [
                {"time": f"{hour:02d}:{index % 60:02d}", "actor": "\u7cfb\u7edf", "action": "\u521b\u5efa\u544a\u8b66"},
            ],
        },
    }


def _generated_risk_review_record(index: int) -> dict:
    subjects = [
        "\u5173\u952e\u7269\u6599\u5230\u6599\u5ef6\u8fdf",
        "\u4f9b\u5e94\u5546\u8d28\u91cf\u6ce2\u52a8",
        "\u5ba2\u6237\u4ea4\u4ed8\u7a97\u53e3\u538b\u7f29",
        "\u66ff\u4ee3\u6599\u8ba4\u8bc1\u672a\u5b8c\u6210",
        "\u8fd0\u8f93\u5e72\u7ebf\u65f6\u6548\u6ce2\u52a8",
    ]
    owners = ["\u5218\u6d0b", "\u674e\u660e", "\u8d75\u654f", "\u5468\u5f3a", "\u738b\u78ca"]
    levels = ["\u9ad8", "\u4e2d", "\u4f4e"]
    statuses = ["\u5f85\u590d\u6838", "\u5b9a\u7ea7\u4e2d", "\u5904\u7406\u4e2d", "\u5df2\u5173\u95ed"]
    return {
        "status": "active",
        "data": {
            "riskNo": f"SR-202605{1 + index % 27:02d}-{index + 1:04d}",
            "subject": subjects[index % len(subjects)],
            "level": levels[index % len(levels)],
            "owner": owners[index % len(owners)],
            "reason": "\u6839\u636e\u4ea4\u4ed8\u3001\u8d28\u91cf\u548c\u5e93\u5b58\u6eda\u52a8\u6570\u636e\u81ea\u52a8\u751f\u6210\u98ce\u9669\u590d\u6838\u4efb\u52a1\u3002",
            "status": statuses[index % len(statuses)],
            "processStatus": "\u5df2\u5b8c\u6210" if index % len(statuses) == 3 else "\u5904\u7406\u4e2d",
            "currentNode": "\u5904\u7406\u5173\u95ed" if index % len(statuses) == 3 else "\u8d23\u4efb\u5206\u6d3e",
            "currentHandler": "" if index % len(statuses) == 3 else owners[index % len(owners)],
            "completedAt": _iso_day(1 + index % 27, 18) if index % len(statuses) == 3 else "",
            "interactionLog": [{"time": "09:00", "actor": "\u7cfb\u7edf", "action": "\u521b\u5efa\u98ce\u9669"}],
        },
    }


def _generated_business_record(form_code: str, index: int) -> Optional[dict]:
    if form_code == "alert-center":
        return _generated_alert_record(index)
    if form_code == "risk-review":
        return _generated_risk_review_record(index)
    return None


def _default_view_config(fields: list[dict]) -> dict:
    visible_fields = [field for field in fields if field.get("visible_in_list", True)]
    searchable_fields = [field for field in fields if field.get("searchable")]
    return {
        "table": {
            "pageSize": 20,
            "density": "middle",
            "columns": [
                {
                    "id": field["field_name"],
                    "fieldName": field["field_name"],
                    "label": field["label"],
                    "enabled": True,
                    "sortable": bool(field.get("sortable")),
                    "renderType": "tag" if field.get("field_type") == "enum" else "text",
                    "sortOrder": index,
                }
                for index, field in enumerate(visible_fields)
            ],
        },
        "filters": [
            {
                "id": field["field_name"],
                "fieldName": field["field_name"],
                "label": field["label"],
                "enabled": True,
                "operator": "contains" if field.get("field_type") in {"string", "text", "code"} else "equals",
                "advanced": index > 2,
                "sortOrder": index,
            }
            for index, field in enumerate(searchable_fields)
        ],
    }


def _default_workflow_config(form_code: str, form_id: int, workflow_name: str, field_names: list[str]) -> dict:
    return {
        "name": workflow_name,
        "version": "v1",
        "formCode": form_code,
        "formId": form_id,
        "nodes": [
            {"id": "start-1", "type": "startEvent", "label": "开始事件", "x": 420, "y": 80},
            {"id": "task-1", "type": "userTask", "label": "业务确认", "x": 420, "y": 200, "assigneeType": "role", "assigneeValue": "业务负责人", "approvalMode": "single"},
            {"id": "task-2", "type": "manualTask", "label": "处理执行", "x": 420, "y": 320, "assigneeType": "role", "assigneeValue": "处理工程师"},
            {"id": "end-1", "type": "endEvent", "label": "关闭归档", "x": 420, "y": 440},
        ],
        "edges": [
            {"id": "edge-1", "source": "start-1", "target": "task-1", "label": "提交", "priority": 1},
            {"id": "edge-2", "source": "task-1", "target": "task-2", "label": "通过", "priority": 1},
            {"id": "edge-3", "source": "task-2", "target": "end-1", "label": "完成", "priority": 1},
        ],
        "triggerBindings": [
            {"action": "submit", "label": "提交触发", "enabled": True},
            {"action": "approve", "label": "按钮动作触发", "enabled": True},
        ],
        "stateMapping": {
            "processStatus": "processStatus",
            "currentNode": "currentNode",
            "currentHandler": "currentHandler",
            "completedAt": "completedAt",
        },
        "fieldPermissions": {
            "task-1": {name: {"visible": True, "editable": False, "required": False} for name in field_names},
            "task-2": {name: {"visible": True, "editable": name not in {"processStatus", "currentNode", "currentHandler", "completedAt"}, "required": False} for name in field_names},
        },
        "advancedModeConfig": {"enabled": False},
    }


async def _ensure_default_business_forms(db: AsyncSession, tenant_id: int) -> None:
    from app.models.relational import (
        Application,
        ApplicationForm,
        DynamicRecord,
        Form,
        FormAction,
        FormField,
        FormLayout,
        FormPermission,
        Role,
        WorkflowBinding,
        WorkflowDef,
    )

    for form_cfg in DEFAULT_BUSINESS_FORMS:
        fields = [*form_cfg["fields"], *STANDARD_WORKFLOW_FIELDS]
        form = await db.scalar(select(Form).where(Form.code == form_cfg["code"], Form.tenant_id == tenant_id))
        if form is None:
            form = Form(
                tenant_id=tenant_id,
                name=form_cfg["name"],
                code=form_cfg["code"],
                description=form_cfg["description"],
                table_name=form_cfg["table_name"],
                storage_mode="dynamic",
                status="published",
                config={"source": "default-business-seed", "viewConfig": _default_view_config(fields), "workflowDesigner": {}},
            )
            db.add(form)
            await db.flush()
        else:
            form.name = form_cfg["name"]
            form.description = form.description or form_cfg["description"]
            form.table_name = form.table_name or form_cfg["table_name"]
            if form.status in {"draft", "active"}:
                form.status = "published"
            form.config = {
                **(form.config or {}),
                "source": (form.config or {}).get("source", "default-business-seed"),
                "viewConfig": (form.config or {}).get("viewConfig") or _default_view_config(fields),
            }

        existing_fields = {
            field.field_name
            for field in (await db.execute(select(FormField).where(FormField.form_id == form.id, FormField.tenant_id == tenant_id))).scalars().all()
        }
        for index, field_cfg in enumerate(fields):
            if field_cfg["field_name"] in existing_fields:
                continue
            db.add(FormField(tenant_id=tenant_id, form_id=form.id, sort_order=index, **field_cfg))

        for layout_type, layout_config in {
            "list": {"viewConfig": _default_view_config(fields)},
            "form": {"sections": [{"title": "业务信息", "fields": [field["field_name"] for field in form_cfg["fields"]]}, {"title": "流程状态", "fields": [field["field_name"] for field in STANDARD_WORKFLOW_FIELDS]}]},
        }.items():
            existing_layout = await db.scalar(select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.tenant_id == tenant_id, FormLayout.layout_type == layout_type))
            if existing_layout is None:
                db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type=layout_type, config=layout_config))

        existing_actions = {
            action.action_key
            for action in (await db.execute(select(FormAction).where(FormAction.form_id == form.id, FormAction.tenant_id == tenant_id))).scalars().all()
        }
        for index, action_cfg in enumerate(form_cfg["actions"]):
            if action_cfg["action_key"] not in existing_actions:
                db.add(FormAction(tenant_id=tenant_id, form_id=form.id, sort_order=index, **action_cfg))

        record_count = await db.scalar(select(func.count(DynamicRecord.id)).where(DynamicRecord.form_id == form.id, DynamicRecord.tenant_id == tenant_id)) or 0
        if record_count == 0:
            for record_cfg in form_cfg["records"]:
                db.add(DynamicRecord(tenant_id=tenant_id, form_id=form.id, model_id=form.model_id, created_by=None, updated_by=None, **record_cfg))
            record_count = len(form_cfg["records"])

        target_count = BUSINESS_FORM_RECORD_TARGETS.get(form_cfg["code"], 0)
        if record_count < target_count:
            for seed_index in range(record_count, target_count):
                generated = _generated_business_record(form_cfg["code"], seed_index)
                if generated is not None:
                    db.add(DynamicRecord(tenant_id=tenant_id, form_id=form.id, model_id=form.model_id, created_by=None, updated_by=None, **generated))

        roles = (await db.execute(select(Role).where(Role.tenant_id == tenant_id))).scalars().all()
        for role in roles:
            for action in ["view", "create", "edit", "delete", "export"]:
                exists = await db.scalar(select(FormPermission.id).where(
                    FormPermission.form_id == form.id,
                    FormPermission.tenant_id == tenant_id,
                    FormPermission.role_id == role.id,
                    FormPermission.action == action,
                    FormPermission.field_name.is_(None),
                ).limit(1))
                if exists is None:
                    db.add(FormPermission(tenant_id=tenant_id, form_id=form.id, role_id=role.id, action=action, effect="allow"))

        workflow = await db.scalar(select(WorkflowDef).where(WorkflowDef.tenant_id == tenant_id, WorkflowDef.name == f"{form_cfg['name']}默认流程"))
        workflow_config = _default_workflow_config(form_cfg["code"], form.id, f"{form_cfg['name']}默认流程", [field["field_name"] for field in fields])
        if workflow is None:
            workflow = WorkflowDef(
                tenant_id=tenant_id,
                name=f"{form_cfg['name']}默认流程",
                description=f"{form_cfg['name']}表单默认业务闭环流程",
                config=json.dumps(workflow_config, ensure_ascii=False),
                form_config=json.dumps({"fields": fields}, ensure_ascii=False),
                status="published",
                version=1,
            )
            db.add(workflow)
            await db.flush()
        workflow_meta = {
            **((form.config or {}).get("workflowDesigner") or {}),
            "publishedWorkflowId": workflow.id,
            "publishedVersion": workflow.version,
        }
        form.config = {**(form.config or {}), "workflowDesigner": workflow_meta}

        for binding in workflow_config["triggerBindings"]:
            exists = await db.scalar(select(WorkflowBinding.id).where(
                WorkflowBinding.form_id == form.id,
                WorkflowBinding.workflow_id == workflow.id,
                WorkflowBinding.trigger_action == binding["action"],
                WorkflowBinding.tenant_id == tenant_id,
            ).limit(1))
            if exists is None:
                db.add(WorkflowBinding(
                    tenant_id=tenant_id,
                    form_id=form.id,
                    workflow_id=workflow.id,
                    trigger_action=binding["action"],
                    enabled=binding["enabled"],
                    config={"label": binding["label"], "stateMapping": workflow_config["stateMapping"], "source": "default-business-seed"},
                ))

        for app_code in form_cfg["app_codes"]:
            app = await db.scalar(select(Application).where(Application.code == app_code, Application.tenant_id == tenant_id))
            if app is None:
                continue
            exists = await db.scalar(select(ApplicationForm.id).where(ApplicationForm.application_id == app.id, ApplicationForm.form_id == form.id, ApplicationForm.tenant_id == tenant_id).limit(1))
            if exists is None:
                db.add(ApplicationForm(tenant_id=tenant_id, application_id=app.id, form_id=form.id, alias=form_cfg["name"], default_view="list", allow_export=True))

    await db.commit()


@router.get("")
async def list_forms(
    application_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import ApplicationForm, Form

    tenant_id = current_tenant_id(user)
    await _ensure_default_business_forms(db, tenant_id)
    query = select(Form).where(Form.tenant_id == tenant_id).order_by(Form.created_at.desc(), Form.id.desc())
    if application_id is not None:
        query = query.join(ApplicationForm, ApplicationForm.form_id == Form.id).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.tenant_id == tenant_id,
            ApplicationForm.enabled.is_(True),
        )
    forms = (await db.execute(query)).scalars().all()
    if not user.get("is_admin"):
        visible_forms = []
        for form in forms:
            if await has_form_permission(user, form.id, "view", db):
                visible_forms.append(form)
        forms = visible_forms
    return {"data": [_form_payload(form) for form in forms]}


@router.post("")
async def create_form(
    body: FormCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Application, ApplicationForm, Form, FormAction, FormLayout

    tenant_id = current_tenant_id(user)
    _validate_form_code(body.code)
    if body.table_name:
        assert_safe_identifier(body.table_name)

    existing = await db.scalar(select(Form).where(Form.code == body.code, Form.tenant_id == tenant_id))
    if existing:
        raise HTTPException(409, "Form code already exists")

    if body.application_id is not None:
        app = await db.get(Application, body.application_id)
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(404, "Application not found")

    form = Form(
        tenant_id=tenant_id,
        name=body.name,
        code=body.code,
        description=body.description,
        model_id=body.model_id,
        table_name=body.table_name,
        storage_mode=body.storage_mode,
        status=body.status,
        owner_id=_uid(user),
        config=body.config,
    )
    db.add(form)
    await db.flush()

    if body.application_id is not None:
        db.add(ApplicationForm(tenant_id=tenant_id, application_id=body.application_id, form_id=form.id))

    db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="list", config={"columns": []}))
    db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="form", config={"sections": []}))
    for idx, (key, label) in enumerate([("create", "Create"), ("edit", "Edit"), ("delete", "Delete"), ("export", "Export")]):
        db.add(FormAction(tenant_id=tenant_id, form_id=form.id, action_key=key, label=label, sort_order=idx))

    await db.commit()
    await db.refresh(form)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create",
        resource_type="form",
        resource_id=form.id,
        new_values=body.dict(),
    )
    return {"data": _form_payload(form)}


@router.get("/applications/{application_id}/forms")
async def list_application_form_bindings(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from sqlalchemy.orm import selectinload
    from app.models.relational import Application, ApplicationForm

    tenant_id = current_tenant_id(user)
    app = await db.get(Application, application_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    bindings = (await db.execute(
        select(ApplicationForm)
        .options(selectinload(ApplicationForm.form))
        .where(ApplicationForm.application_id == application_id, ApplicationForm.tenant_id == tenant_id)
        .order_by(ApplicationForm.sort_order, ApplicationForm.id)
    )).scalars().all()
    return {"data": [_application_form_payload(binding) for binding in bindings]}


@router.put("/applications/{application_id}/forms")
async def upsert_application_form_binding(
    application_id: int,
    body: ApplicationFormUpsert,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from sqlalchemy.orm import selectinload
    from app.models.relational import Application, ApplicationForm, Form

    tenant_id = current_tenant_id(user)
    app = await db.get(Application, application_id)
    form = await db.get(Form, body.form_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    binding = await db.scalar(
        select(ApplicationForm)
        .options(selectinload(ApplicationForm.form))
        .where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == body.form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    )
    values = body.dict()
    if binding is None:
        binding = ApplicationForm(tenant_id=tenant_id, application_id=application_id, **values)
        db.add(binding)
    else:
        for key, value in values.items():
            setattr(binding, key, value)
    await db.commit()
    await db.refresh(binding)
    return {"data": _application_form_payload(binding)}


@router.delete("/applications/{application_id}/forms/{form_id}")
async def delete_application_form_binding(
    application_id: int,
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import ApplicationForm

    tenant_id = current_tenant_id(user)
    await db.execute(
        delete(ApplicationForm).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    )
    await db.commit()
    return {"ok": True}


@router.get("/applications/{application_id}/menu-nodes")
async def list_application_menu_nodes(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Application, ApplicationMenuNode

    tenant_id = current_tenant_id(user)
    app = await db.get(Application, application_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    nodes = (await db.execute(
        select(ApplicationMenuNode)
        .where(ApplicationMenuNode.application_id == application_id, ApplicationMenuNode.tenant_id == tenant_id)
        .order_by(ApplicationMenuNode.sort_order, ApplicationMenuNode.id)
    )).scalars().all()
    return {"data": [_menu_node_payload(node) for node in nodes]}


@router.post("/applications/{application_id}/menu-nodes")
async def create_application_menu_node(
    application_id: int,
    body: MenuNodeCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Application, ApplicationMenuNode, Form

    tenant_id = current_tenant_id(user)
    app = await db.get(Application, application_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    form = await db.get(Form, body.form_id) if body.form_id is not None else None
    if body.form_id is not None and (not form or form.tenant_id != tenant_id):
        raise HTTPException(404, "Form not found")
    parent = await db.get(ApplicationMenuNode, body.parent_id) if body.parent_id is not None else None
    if body.parent_id is not None and (not parent or parent.tenant_id != tenant_id):
        raise HTTPException(404, "Parent menu node not found")

    values = body.dict()
    if values.get("form_id") and not values.get("route_path"):
        values["route_path"] = f"/dynamic/{values['form_id']}"
    node = ApplicationMenuNode(tenant_id=tenant_id, application_id=application_id, **values)
    db.add(node)
    if body.form_id is not None:
        await _ensure_application_form_binding(db, application_id, body.form_id)
    await db.commit()
    await db.refresh(node)
    return {"data": _menu_node_payload(node)}


@router.put("/applications/{application_id}/menu-nodes/{node_id}")
async def update_application_menu_node(
    application_id: int,
    node_id: int,
    body: MenuNodeUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import ApplicationMenuNode, Form

    tenant_id = current_tenant_id(user)
    node = await db.get(ApplicationMenuNode, node_id)
    if not node or node.application_id != application_id or node.tenant_id != tenant_id:
        raise HTTPException(404, "Menu node not found")
    updates = body.dict(exclude_unset=True)
    form = await db.get(Form, updates["form_id"]) if "form_id" in updates and updates["form_id"] is not None else None
    if "form_id" in updates and updates["form_id"] is not None and (not form or form.tenant_id != tenant_id):
        raise HTTPException(404, "Form not found")
    parent = await db.get(ApplicationMenuNode, updates["parent_id"]) if "parent_id" in updates and updates["parent_id"] is not None else None
    if "parent_id" in updates and updates["parent_id"] is not None and (not parent or parent.tenant_id != tenant_id):
        raise HTTPException(404, "Parent menu node not found")
    if updates.get("form_id") and not updates.get("route_path"):
        updates["route_path"] = f"/dynamic/{updates['form_id']}"
    for key, value in updates.items():
        setattr(node, key, value)
    if node.form_id is not None:
        await _ensure_application_form_binding(db, application_id, node.form_id)
    await db.commit()
    await db.refresh(node)
    return {"data": _menu_node_payload(node)}


@router.delete("/applications/{application_id}/menu-nodes/{node_id}")
async def delete_application_menu_node(
    application_id: int,
    node_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import ApplicationMenuNode

    tenant_id = current_tenant_id(user)
    node = await db.get(ApplicationMenuNode, node_id)
    if not node or node.application_id != application_id or node.tenant_id != tenant_id:
        raise HTTPException(404, "Menu node not found")
    await db.delete(node)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/publish/preview")
async def preview_form_publish(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    report, _snapshot = await _build_publish_preview(db, tenant_id, form)
    return {"data": {"form_id": form_id, **report}}


@router.post("/{form_id}/publish")
async def publish_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, FormVersion

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    report, snapshot = await _build_publish_preview(db, tenant_id, form)
    if report["blocking_count"] > 0:
        raise HTTPException(409, {"message": "Publish blocked by incompatible form changes", "report": report})
    now = datetime.now()
    published_at = now.isoformat()
    snapshot = _promote_snapshot_config(snapshot, published_at, report["next_version"])
    version = FormVersion(
        tenant_id=tenant_id,
        form_id=form.id,
        version=report["next_version"],
        status="published",
        snapshot=snapshot,
        impact_report=report,
        published_by=_uid(user),
        published_at=now,
    )
    form.status = "published"
    form.config = (snapshot.get("form") or {}).get("config") or form.config
    db.add(version)
    await db.commit()
    await db.refresh(version)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="publish",
        resource_type="form",
        resource_id=form.id,
        new_values={"version": version.version, "impact_report": report},
    )
    return {"data": _form_version_payload(version)}


@router.get("/{form_id}/versions")
async def list_form_versions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormVersion

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    versions = (await db.execute(
        select(FormVersion)
        .where(FormVersion.form_id == form_id, FormVersion.tenant_id == tenant_id)
        .order_by(FormVersion.version.desc(), FormVersion.id.desc())
    )).scalars().all()
    return {"data": [_form_version_payload(version) for version in versions]}


@router.get("/{form_id}/versions/{version_number}")
async def get_form_version(
    form_id: int,
    version_number: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormVersion

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    version = await db.scalar(
        select(FormVersion).where(
            FormVersion.form_id == form_id,
            FormVersion.tenant_id == tenant_id,
            FormVersion.version == version_number,
        )
    )
    if not version:
        raise HTTPException(404, "Form version not found")
    return {"data": _form_version_payload(version)}


@router.get("/{form_id}")
async def get_form(
    form_id: int,
    schema: str = Query(default="draft", pattern="^(draft|published)$"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Application, ApplicationForm, Form, FormField

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    if not user.get("is_admin"):
        visible_names = await allowed_form_fields(user, form_id, "view", fields, db)
        fields = [field for field in fields if field.field_name in visible_names]
    app_rows = await db.execute(
        select(Application, ApplicationForm)
        .join(ApplicationForm, ApplicationForm.application_id == Application.id)
        .where(ApplicationForm.form_id == form_id, ApplicationForm.tenant_id == tenant_id, Application.tenant_id == tenant_id)
        .order_by(ApplicationForm.sort_order)
    )
    applications = [
        {
            "id": app.id,
            "name": app.name,
            "code": app.code,
            "alias": binding.alias,
            "enabled": binding.enabled,
            "sort_order": binding.sort_order,
        }
        for app, binding in app_rows.fetchall()
    ]
    if schema == "published":
        version = await _latest_form_version(db, tenant_id, form_id)
        if version:
            payload = _published_form_payload(form, version, applications=applications)
            if not user.get("is_admin"):
                visible_names = await allowed_form_fields(user, form_id, "view", fields, db)
                payload["fields"] = [field for field in payload["fields"] if field.get("field_name") in visible_names]
            return {"data": payload}
    return {"data": _form_payload(form, fields=fields, applications=applications)}


@router.put("/{form_id}")
async def update_form(
    form_id: int,
    body: FormUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    old_values = _form_payload(form)
    updates = body.dict(exclude_unset=True)
    if updates.get("table_name"):
        assert_safe_identifier(updates["table_name"])
    for key, value in updates.items():
        setattr(form, key, value)
    await db.commit()
    await db.refresh(form)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="update",
        resource_type="form",
        resource_id=form.id,
        old_values=old_values,
        new_values=updates,
    )
    return {"data": _form_payload(form)}


@router.post("/{form_id}/fields")
async def create_form_field(
    form_id: int,
    body: FormFieldCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, FormField

    tenant_id = current_tenant_id(user)
    _validate_field_name(body.field_name)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    existing = await db.scalar(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id, FormField.field_name == body.field_name)
    )
    if existing:
        raise HTTPException(409, "Field already exists on this form")

    field_data = _normalize_form_field_data(body.dict())
    field = FormField(tenant_id=tenant_id, form_id=form_id, **field_data)
    db.add(field)
    await db.commit()
    await db.refresh(field)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create_field",
        resource_type="form",
        resource_id=form_id,
        new_values=field_data,
    )
    return {"data": _field_payload(field)}


@router.put("/{form_id}/fields/{field_id}")
async def update_form_field(
    form_id: int,
    field_id: int,
    body: FormFieldUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import FormField

    tenant_id = current_tenant_id(user)
    field = await db.get(FormField, field_id)
    if not field or field.form_id != form_id or field.tenant_id != tenant_id:
        raise HTTPException(404, "Field not found")
    updates = _normalize_form_field_data(
        body.dict(exclude_unset=True),
        current_field_type=field.field_type,
        current_ui_config=field.ui_config,
    )
    old_values = _field_payload(field)
    changed = False
    for key, value in updates.items():
        if getattr(field, key) != value:
            changed = True
        setattr(field, key, value)
    impact = await _dynamic_record_field_impact(db, tenant_id, form_id, field) if changed else None
    if updates.get("required") is True and impact and impact["missing_required_count"]:
        raise HTTPException(
            409,
            f"Cannot require field with {impact['missing_required_count']} existing record(s) missing a value",
        )
    if "field_type" in updates and impact and impact["incompatible_count"]:
        raise HTTPException(
            409,
            f"Cannot change field type with {impact['incompatible_count']} incompatible existing record value(s)",
        )
    await db.commit()
    await db.refresh(field)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="update_field",
        resource_type="form",
        resource_id=form_id,
        old_values=old_values,
        new_values=updates,
    )
    payload = {"data": _field_payload(field)}
    if impact:
        payload["impact"] = impact
    return payload


@router.delete("/{form_id}/fields/{field_id}")
async def archive_form_field(
    form_id: int,
    field_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import FormField

    tenant_id = current_tenant_id(user)
    field = await db.get(FormField, field_id)
    if not field or field.form_id != form_id or field.tenant_id != tenant_id:
        raise HTTPException(404, "Field not found")
    impact = await _dynamic_record_field_impact(db, tenant_id, form_id, field)
    field.archived = True
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="archive_field",
        resource_type="form",
        resource_id=form_id,
        old_values={"field_name": field.field_name, "archived": False},
        new_values={"field_name": field.field_name, "archived": True, "impact": impact},
    )
    return {"ok": True, "impact": impact}


@router.get("/{form_id}/layouts")
async def list_form_layouts(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormLayout

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    layouts = (await db.execute(
        select(FormLayout).where(FormLayout.form_id == form_id, FormLayout.tenant_id == tenant_id).order_by(FormLayout.layout_type)
    )).scalars().all()
    return {"data": [_layout_payload(layout) for layout in layouts]}


@router.put("/{form_id}/layouts/{layout_type}")
async def upsert_form_layout(
    form_id: int,
    layout_type: str,
    body: FormLayoutUpsert,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, FormLayout

    tenant_id = current_tenant_id(user)
    assert_safe_identifier(layout_type)
    if body.layout_type != layout_type:
        raise HTTPException(400, "layout_type path and body must match")
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    layout = await db.scalar(
        select(FormLayout).where(FormLayout.form_id == form_id, FormLayout.tenant_id == tenant_id, FormLayout.layout_type == layout_type)
    )
    if layout is None:
        layout = FormLayout(tenant_id=tenant_id, form_id=form_id, layout_type=layout_type, config=body.config)
        db.add(layout)
    else:
        layout.config = body.config
    await db.commit()
    await db.refresh(layout)
    return {"data": _layout_payload(layout)}


@router.get("/{form_id}/actions")
async def list_form_actions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormAction

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    actions = (await db.execute(
        select(FormAction)
        .where(FormAction.form_id == form_id, FormAction.tenant_id == tenant_id)
        .order_by(FormAction.sort_order, FormAction.id)
    )).scalars().all()
    return {"data": [_action_payload(action) for action in actions]}


@router.post("/{form_id}/actions")
async def create_form_action(
    form_id: int,
    body: FormActionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, FormAction

    tenant_id = current_tenant_id(user)
    assert_safe_identifier(body.action_key)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    action = FormAction(tenant_id=tenant_id, form_id=form_id, **body.dict())
    db.add(action)
    await db.commit()
    await db.refresh(action)
    return {"data": _action_payload(action)}


@router.put("/{form_id}/actions/{action_id}")
async def update_form_action(
    form_id: int,
    action_id: int,
    body: FormActionUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import FormAction

    tenant_id = current_tenant_id(user)
    action = await db.get(FormAction, action_id)
    if not action or action.form_id != form_id or action.tenant_id != tenant_id:
        raise HTTPException(404, "Action not found")
    for key, value in body.dict(exclude_unset=True).items():
        setattr(action, key, value)
    await db.commit()
    await db.refresh(action)
    return {"data": _action_payload(action)}


@router.delete("/{form_id}/actions/{action_id}")
async def delete_form_action(
    form_id: int,
    action_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import FormAction

    tenant_id = current_tenant_id(user)
    action = await db.get(FormAction, action_id)
    if not action or action.form_id != form_id or action.tenant_id != tenant_id:
        raise HTTPException(404, "Action not found")
    await db.delete(action)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/permissions")
async def list_form_permissions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, FormPermission

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    permissions = (await db.execute(
        select(FormPermission).where(FormPermission.form_id == form_id, FormPermission.tenant_id == tenant_id).order_by(FormPermission.id)
    )).scalars().all()
    return {"data": [_permission_payload(permission) for permission in permissions]}


@router.post("/{form_id}/permissions")
async def create_form_permission(
    form_id: int,
    body: FormPermissionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, FormField, FormPermission, Role

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    role = await db.get(Role, body.role_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    if not role or role.tenant_id != tenant_id:
        raise HTTPException(404, "Role not found")
    if body.field_name:
        _validate_field_name(body.field_name)
        existing_field = await db.scalar(
            select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id, FormField.field_name == body.field_name)
        )
        if not existing_field:
            raise HTTPException(404, "Field not found")
    permission = FormPermission(tenant_id=tenant_id, form_id=form_id, **body.dict())
    db.add(permission)
    await db.commit()
    await db.refresh(permission)
    return {"data": _permission_payload(permission)}


@router.put("/{form_id}/permissions/{permission_id}")
async def update_form_permission(
    form_id: int,
    permission_id: int,
    body: FormPermissionUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import FormField, FormPermission

    tenant_id = current_tenant_id(user)
    permission = await db.get(FormPermission, permission_id)
    if not permission or permission.form_id != form_id or permission.tenant_id != tenant_id:
        raise HTTPException(404, "Permission not found")
    updates = body.dict(exclude_unset=True)
    if updates.get("field_name"):
        _validate_field_name(updates["field_name"])
        existing_field = await db.scalar(
            select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id, FormField.field_name == updates["field_name"])
        )
        if not existing_field:
            raise HTTPException(404, "Field not found")
    for key, value in updates.items():
        setattr(permission, key, value)
    await db.commit()
    await db.refresh(permission)
    return {"data": _permission_payload(permission)}


@router.delete("/{form_id}/permissions/{permission_id}")
async def delete_form_permission(
    form_id: int,
    permission_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import FormPermission

    tenant_id = current_tenant_id(user)
    permission = await db.get(FormPermission, permission_id)
    if not permission or permission.form_id != form_id or permission.tenant_id != tenant_id:
        raise HTTPException(404, "Permission not found")
    await db.delete(permission)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/workflow-bindings")
async def list_workflow_bindings(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, WorkflowBinding

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    bindings = (await db.execute(
        select(WorkflowBinding).where(WorkflowBinding.form_id == form_id, WorkflowBinding.tenant_id == tenant_id).order_by(WorkflowBinding.id)
    )).scalars().all()
    return {"data": [_workflow_binding_payload(binding) for binding in bindings]}


@router.post("/{form_id}/workflow-bindings")
async def create_workflow_binding(
    form_id: int,
    body: WorkflowBindingCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Form, WorkflowBinding, WorkflowDef

    tenant_id = current_tenant_id(user)
    assert_safe_identifier(body.trigger_action)
    form = await db.get(Form, form_id)
    wf = await db.get(WorkflowDef, body.workflow_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    if not wf or wf.tenant_id != tenant_id:
        raise HTTPException(404, "Workflow definition not found")
    binding = WorkflowBinding(tenant_id=tenant_id, form_id=form_id, **body.dict())
    db.add(binding)
    await db.commit()
    await db.refresh(binding)
    return {"data": _workflow_binding_payload(binding)}


@router.put("/{form_id}/workflow-bindings/{binding_id}")
async def update_workflow_binding(
    form_id: int,
    binding_id: int,
    body: WorkflowBindingUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import WorkflowBinding, WorkflowDef

    tenant_id = current_tenant_id(user)
    binding = await db.get(WorkflowBinding, binding_id)
    if not binding or binding.form_id != form_id or binding.tenant_id != tenant_id:
        raise HTTPException(404, "Workflow binding not found")
    updates = body.dict(exclude_unset=True)
    if updates.get("workflow_id") is not None:
        wf = await db.get(WorkflowDef, updates["workflow_id"])
        if not wf or wf.tenant_id != tenant_id:
            raise HTTPException(404, "Workflow definition not found")
    if updates.get("trigger_action"):
        assert_safe_identifier(updates["trigger_action"])
    for key, value in updates.items():
        setattr(binding, key, value)
    await db.commit()
    await db.refresh(binding)
    return {"data": _workflow_binding_payload(binding)}


@router.delete("/{form_id}/workflow-bindings/{binding_id}")
async def delete_workflow_binding(
    form_id: int,
    binding_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import WorkflowBinding

    tenant_id = current_tenant_id(user)
    binding = await db.get(WorkflowBinding, binding_id)
    if not binding or binding.form_id != form_id or binding.tenant_id != tenant_id:
        raise HTTPException(404, "Workflow binding not found")
    await db.delete(binding)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/records")
async def list_dynamic_records(
    form_id: int,
    include_deleted: bool = False,
    search: Optional[str] = Query(default=None),
    filters_json: Optional[str] = Query(default=None, alias="filters"),
    sort_field: Optional[str] = Query(default=None),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    cursor_after_id: Optional[int] = Query(default=None, ge=1),
    cursor_before_id: Optional[int] = Query(default=None, ge=1),
    include_total: bool = True,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    visible_fields = await allowed_form_fields(user, form_id, "view", fields, db)
    query_fields = _visible_field_subset(fields, visible_fields)
    db_filters = [DynamicRecord.form_id == form_id, DynamicRecord.tenant_id == tenant_id]
    if not include_deleted:
        db_filters.append(DynamicRecord.deleted_at.is_(None))

    parsed_filters = _parse_record_filters(filters_json)
    _ensure_filter_fields_visible(parsed_filters, visible_fields)
    _ensure_sort_field_allowed(sort_field, fields, visible_fields)
    query = select(DynamicRecord).where(*db_filters)
    query, search_pushed = _apply_record_search_query(query, DynamicRecord, query_fields, search)
    query, filters_pushed = _apply_record_filters_query(query, DynamicRecord, query_fields, parsed_filters)
    _ensure_production_record_query_supported(search, parsed_filters, search_pushed, filters_pushed)
    if cursor_mode := (cursor_after_id is not None or cursor_before_id is not None):
        if (search and not search_pushed) or (parsed_filters and not filters_pushed):
            raise HTTPException(400, "Cursor pagination requires indexed search and filters")
    if search and not search_pushed:
        query = select(DynamicRecord).where(*db_filters)
    if parsed_filters and not filters_pushed:
        query = select(DynamicRecord).where(*db_filters)

    if cursor_after_id is not None and cursor_before_id is not None:
        raise HTTPException(400, "Use only one cursor direction")
    if cursor_after_id is not None:
        query = query.where(DynamicRecord.id < cursor_after_id)
    if cursor_before_id is not None:
        query = query.where(DynamicRecord.id > cursor_before_id)

    query = _apply_record_sort_query(query, DynamicRecord, sort_field, sort_order)
    if not search and not parsed_filters and not cursor_mode:
        total = None
        if include_total:
            total = await db.scalar(select(func.count(DynamicRecord.id)).where(*db_filters))
        result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
        return {
            "data": [_record_payload(record, visible_fields=visible_fields) for record in result.scalars().all()],
            "total": int(total or 0) if total is not None else None,
            "page": page,
            "page_size": page_size,
            "has_more": False,
            "next_cursor": None,
        }

    if cursor_mode or ((search or parsed_filters) and search_pushed and filters_pushed):
        total = None
        if include_total and not cursor_mode:
            count_query = select(func.count(DynamicRecord.id)).where(*db_filters)
            count_query, _ = _apply_record_search_query(count_query, DynamicRecord, query_fields, search)
            count_query, _ = _apply_record_filters_query(count_query, DynamicRecord, query_fields, parsed_filters)
            total = await db.scalar(count_query)
        result = await db.execute(query.limit(page_size + 1))
        rows = result.scalars().all()
        page_rows = rows[:page_size]
        next_cursor = page_rows[-1].id if len(rows) > page_size and page_rows else None
        return {
            "data": [_record_payload(record, visible_fields=visible_fields) for record in page_rows],
            "total": int(total) if total is not None else None,
            "page": page,
            "page_size": page_size,
            "has_more": len(rows) > page_size,
            "next_cursor": next_cursor,
        }

    records = (await db.execute(query)).scalars().all()
    matched = [
        record
        for record in records
        if _record_matches_search(record, query_fields, search)
        and _record_matches_filters(record, query_fields, parsed_filters)
    ]
    total = len(matched)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "data": [_record_payload(record, visible_fields=visible_fields) for record in matched[start:end]],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{form_id}/records/{record_id}")
async def get_dynamic_record(
    form_id: int,
    record_id: int,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    record = await db.get(DynamicRecord, record_id)
    if (
        not record
        or record.form_id != form_id
        or record.tenant_id != tenant_id
        or (record.deleted_at is not None and not include_deleted)
    ):
        raise HTTPException(404, "Record not found")
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    visible_fields = await allowed_form_fields(user, form_id, "view", fields, db)
    return {"data": _record_payload(record, visible_fields=visible_fields)}


@router.post("/{form_id}/records")
async def create_dynamic_record(
    form_id: int,
    body: DynamicRecordCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "create")
    await assert_tenant_quota(db, tenant_id, "dynamicRecords")
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    editable_fields = await allowed_form_fields(user, form_id, "create", fields, db)
    denied_fields = sorted(set(body.data.keys()) - editable_fields)
    if denied_fields:
        raise HTTPException(403, f"Field permission denied: {', '.join(denied_fields)}")
    _validate_record_data(fields, body.data)
    latest_version = await _latest_form_version(db, tenant_id, form_id)
    record = DynamicRecord(
        tenant_id=tenant_id,
        form_id=form_id,
        model_id=form.model_id,
        data=body.data,
        schema_version=latest_version.version if latest_version else 1,
        status=body.status,
        created_by=_uid(user),
        updated_by=_uid(user),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create",
        resource_type="dynamic_record",
        resource_id=record.id,
        new_values=_record_payload(record),
    )
    return {"data": _record_payload(record)}


@router.put("/{form_id}/records/{record_id}")
async def update_dynamic_record(
    form_id: int,
    record_id: int,
    body: DynamicRecordUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord

    tenant_id = current_tenant_id(user)
    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.tenant_id != tenant_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
    await _ensure_form_permission(db, user, form_id, "edit")
    updates = body.dict(exclude_unset=True)
    if "data" in updates and updates["data"] is not None:
        fields = await _runtime_form_fields(db, tenant_id, form_id)
        editable_fields = await allowed_form_fields(user, form_id, "edit", fields, db)
        denied_fields = sorted(set(updates["data"].keys()) - editable_fields)
        if denied_fields:
            raise HTTPException(403, f"Field permission denied: {', '.join(denied_fields)}")
        merged = _merged_record_data(record.data, updates["data"])
        _validate_record_data(fields, merged)
        updates["data"] = merged
    for key, value in updates.items():
        setattr(record, key, value)
    record.updated_by = _uid(user)
    await db.commit()
    await db.refresh(record)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="update",
        resource_type="dynamic_record",
        resource_id=record.id,
        new_values=updates,
    )
    return {"data": _record_payload(record)}


@router.delete("/{form_id}/records/{record_id}")
async def delete_dynamic_record(
    form_id: int,
    record_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord

    tenant_id = current_tenant_id(user)
    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.tenant_id != tenant_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
    await _ensure_form_permission(db, user, form_id, "delete")
    record.deleted_at = datetime.now()
    record.updated_by = _uid(user)
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="delete",
        resource_type="dynamic_record",
        resource_id=record.id,
    )
    return {"ok": True}
