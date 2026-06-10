"""Platform form configuration and dynamic record APIs.

These endpoints are the first database-backed layer for application-owned
low-code forms. Creating fields updates metadata only; it does not execute
DDL against business tables.
"""
from __future__ import annotations

import json
import copy
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db, require_admin
from app.config import settings
from app.core.audit import write_audit_log
from app.core.permissions import allowed_form_fields, evaluate_form_permission, get_user_role_ids, has_form_permission
from app.services.tenant_onboarding import assert_tenant_quota

router = APIRouter()

PHYSICAL_FORM_STORAGE_MODES = {"physical_table", "business_table"}
ANALYTICS_FORM_KINDS = {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}
INITIAL_FORM_VERSION = 1
INITIAL_WORKFLOW_VERSION = "v1"


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
    config: dict = Field(default_factory=dict)


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
    config: Optional[dict] = None


MENU_NODE_PERMISSION_PREFIX = "menu_node:"


def _menu_node_permission_key(node_id: int) -> str:
    return f"{MENU_NODE_PERMISSION_PREFIX}{node_id}"


def _entry_role_ids_from_config(config: Optional[dict]) -> list[int]:
    if not isinstance(config, dict) or config.get("permission_mode") != "custom":
        return []
    role_ids = config.get("role_ids")
    if not isinstance(role_ids, list):
        return []
    normalized: list[int] = []
    for role_id in role_ids:
        try:
            value = int(role_id)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in normalized:
            normalized.append(value)
    return normalized


def _normalized_menu_node_config(config: Optional[dict]) -> dict:
    normalized = dict(config or {})
    if "permission_mode" in normalized or "role_ids" in normalized:
        normalized["permission_synced"] = True
    normalized.pop("permission_rules", None)
    return normalized


async def _sync_menu_node_entry_permissions(db: AsyncSession, node) -> None:
    """Persist menu entry role shortcuts into the unified role permission table."""
    from app.models.relational import RolePermission

    permission_key = _menu_node_permission_key(node.id)
    await db.execute(
        RolePermission.__table__.delete().where(
            RolePermission.tenant_id == node.tenant_id,
            RolePermission.resource_type == "menu",
            RolePermission.resource_key == permission_key,
        )
    )
    for role_id in _entry_role_ids_from_config(node.config):
        db.add(RolePermission(
            tenant_id=node.tenant_id,
            role_id=role_id,
            resource_type="menu",
            resource_key=permission_key,
            action="view",
            effect="allow",
            data_scope="all",
            condition_json={"managed_by": "application_menu_node", "node_id": node.id},
            priority=100,
            enabled=bool(node.visible),
        ))


async def _delete_menu_node_entry_permissions(db: AsyncSession, node) -> None:
    from app.models.relational import RolePermission

    await db.execute(
        RolePermission.__table__.delete().where(
            RolePermission.tenant_id == node.tenant_id,
            RolePermission.resource_type == "menu",
            RolePermission.resource_key == _menu_node_permission_key(node.id),
        )
    )


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


def _is_demo_anonymous_reader(user: dict) -> bool:
    return bool(user.get("_anonymous") and not settings.IS_PRODUCTION)


async def _ensure_form_permission(
    db: AsyncSession,
    user: dict,
    form_id: int,
    action: str,
) -> None:
    if action == "view" and _is_demo_anonymous_reader(user):
        return
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
    "code": "string",
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

    explicit_type = normalized.get("field_type")
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
    if business_type is not None:
        ui_config["businessType"] = business_type
        ui_config_touched = True

    ui_config_adds_encoding = isinstance(ui_config_input, dict) and "encodingRule" in ui_config_input
    uses_encoding = (
        business_type == "code"
        or control_type == "code"
        or ui_config.get("businessType") == "code"
        or ui_config.get("controlType") == "code"
        or encoding_rule is not None
        or ui_config_adds_encoding
    )
    if uses_encoding:
        ui_config["businessType"] = "code"
        ui_config["controlType"] = ui_config.get("controlType") or "code"
        if encoding_rule is not None:
            ui_config["encodingRule"] = encoding_rule
            ui_config_touched = True
        elif ui_config.get("autoNumber") and not ui_config.get("encodingRule"):
            ui_config["encodingRule"] = {"enabled": True, "template": ui_config["autoNumber"]}
            ui_config_touched = True
        ui_config_touched = True
    elif business_type is not None or control_type is not None:
        ui_config.pop("encodingRule", None)
        ui_config.pop("autoNumber", None)
        ui_config_touched = True

    if ui_config_touched:
        normalized["ui_config"] = ui_config or None
    return normalized


def _form_payload(form, *, fields: Optional[list] = None, applications: Optional[list] = None) -> dict:
    config = form.config or {}
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
        "config": config,
        "permission_design": _permission_design_from_config(config),
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
    legacy_code_field = field.field_type == "code"
    storage_type = "string" if legacy_code_field else field.field_type
    business_type = ui_config.get("businessType") or ("code" if legacy_code_field or ui_config.get("encodingRule") else storage_type)
    control_type = ui_config.get("controlType") or ("code" if business_type == "code" else None)
    return {
        "id": field.id,
        "form_id": field.form_id,
        "meta_field_id": field.meta_field_id,
        "field_name": field.field_name,
        "label": field.label,
        "field_type": storage_type,
        "business_type": business_type,
        "control_type": control_type,
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


def _permission_design_from_config(config: Optional[dict]) -> dict:
    permission_design = (config or {}).get("permissionDesign")
    return permission_design if isinstance(permission_design, dict) else {}


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


def _is_analysis_form_config(config: Optional[dict]) -> bool:
    config = config or {}
    kind = str(config.get("assemblyKind") or config.get("kind") or config.get("type") or "").lower()
    return kind in ANALYTICS_FORM_KINDS or bool(config.get("analyticsDesign") or config.get("analyticsDesignDraft"))


def _business_table_name_for_code(code: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", code.lower()).strip("_")
    if not normalized:
        raise HTTPException(400, "Form code cannot produce a business table name")
    table_name = f"business_{normalized}"
    assert_safe_identifier(table_name)
    return table_name


def _physical_table_name_for_form(code: str, config: Optional[dict]) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", str(code).lower()).strip("_")
    if not normalized:
        raise HTTPException(400, "Form code cannot produce a table name")
    prefix = "analysis" if _is_analysis_form_config(config) else "business"
    table_name = f"{prefix}_{normalized}"
    assert_safe_identifier(table_name)
    return table_name


def _physical_column_name(field_name: str) -> str:
    field_name = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", str(field_name))
    normalized = re.sub(r"[^a-z0-9_]+", "_", field_name.lower()).strip("_")
    if not normalized:
        raise HTTPException(400, f"Invalid field name for physical storage: {field_name!r}")
    assert_safe_identifier(normalized)
    return normalized


def _uses_physical_form_table(form) -> bool:
    return bool(form.table_name and str(form.storage_mode or "").lower() in PHYSICAL_FORM_STORAGE_MODES)


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
        "deleted_at": mapping.get("deleted_at").isoformat() if mapping.get("deleted_at") else None,
        "created_at": mapping.get("created_at").isoformat() if mapping.get("created_at") else None,
        "updated_at": mapping.get("updated_at").isoformat() if mapping.get("updated_at") else None,
    }


async def _physical_table_columns(db: AsyncSession, table_name: str) -> set[str]:
    assert_safe_identifier(table_name)
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


async def _runtime_visible_field_names(user: dict, form_id: int, fields: list, db: AsyncSession) -> set[str]:
    if _is_demo_anonymous_reader(user):
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
    config = form_snapshot.get("config") or form.config or {}
    live_config = form.config or {}
    snapshot_view = config.get("viewConfig") if isinstance(config, dict) else None
    live_view = live_config.get("viewConfig") if isinstance(live_config, dict) else None
    if (
        isinstance(live_view, dict)
        and (
            not isinstance(snapshot_view, dict)
            or not (snapshot_view.get("table") or {}).get("columns")
            or (not (snapshot_view.get("filters") or []) and (live_view.get("filters") or []))
        )
    ):
        config = {**config, "viewConfig": live_view}
        if live_config.get("formLayout") and not config.get("formLayout"):
            config["formLayout"] = live_config.get("formLayout")
        if live_config.get("viewConfigMeta"):
            config["viewConfigMeta"] = live_config.get("viewConfigMeta")
    payload = {
        **_form_payload(form),
        **{key: value for key, value in form_snapshot.items() if key in {"name", "code", "description", "model_id", "table_name", "storage_mode", "status", "owner_id", "config"}},
        "schema_mode": "published",
        "published_version": version.version,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "fields": [field for field in snapshot.get("fields", []) if _field_cfg_is_active(field)],
        "permission_design": _permission_design_from_config(config),
    }
    payload["config"] = config
    if applications is not None:
        payload["applications"] = applications
    return payload


async def _runtime_permission_summary(user: dict, form_id: int, db: AsyncSession) -> dict:
    actions = ["view", "create", "edit", "delete", "import", "export", "configure", "approve"]
    cache: dict = {}
    summary = {}
    for action in actions:
        decision = await evaluate_form_permission(user, form_id, action, db, cache=cache)
        summary[action] = bool(decision["allowed"])
    return summary


def _runtime_field_name(field) -> str:
    if isinstance(field, dict):
        return str(field.get("field_name") or "")
    return str(getattr(field, "field_name", "") or "")


async def _runtime_field_permission_summary(user: dict, form, fields: list, db: AsyncSession) -> dict:
    cache: dict = {}
    field_names = [name for name in (_runtime_field_name(field) for field in fields) if name]
    if user.get("is_admin"):
        return {
            name: {"visible": True, "editable": True, "exportable": True, "required": False}
            for name in field_names
        }

    summary: dict[str, dict] = {}
    for name in field_names:
        view = await evaluate_form_permission(user, form.id, "view", db, field_name=name, cache=cache)
        edit = await evaluate_form_permission(user, form.id, "edit", db, field_name=name, cache=cache)
        export = await evaluate_form_permission(user, form.id, "export", db, field_name=name, cache=cache)
        summary[name] = {
            "visible": bool(view["allowed"]),
            "editable": bool(edit["allowed"]),
            "exportable": bool(export["allowed"]),
            "required": False,
        }

    permission_design = _permission_design_from_config(form.config)
    role_configs = permission_design.get("roles") if isinstance(permission_design, dict) else None
    if isinstance(role_configs, dict):
        role_ids = await get_user_role_ids(user, db)
        if role_ids:
            from app.models.relational import Role

            tenant_id = current_tenant_id(user)
            roles = (await db.execute(
                select(Role).where(Role.tenant_id == tenant_id, Role.id.in_(role_ids))
            )).scalars().all()
            role_keys = {role.name for role in roles} | {role.label for role in roles}
            for role_key in role_keys:
                role_config = role_configs.get(role_key)
                fields_config = role_config.get("fields") if isinstance(role_config, dict) else None
                if not isinstance(fields_config, dict):
                    continue
                for name, field_config in fields_config.items():
                    if name in summary and isinstance(field_config, dict):
                        summary[name]["required"] = summary[name]["required"] or bool(field_config.get("required"))
    return summary


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
    from app.models.relational import DynamicRecord, FormField

    latest = await _latest_form_version(db, tenant_id, form.id)
    next_version = (latest.version + 1) if latest else INITIAL_FORM_VERSION
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


async def _menu_node_payload(db: AsyncSession, node) -> dict:
    from app.models.relational import RolePermission

    config = dict(node.config or {})
    permission_key = _menu_node_permission_key(node.id)
    role_rows = (await db.execute(
        select(RolePermission.role_id).where(
            RolePermission.tenant_id == node.tenant_id,
            RolePermission.resource_type == "menu",
            RolePermission.resource_key == permission_key,
            RolePermission.effect == "allow",
            RolePermission.enabled.is_(True),
        )
    )).fetchall()
    synced_role_ids = sorted({int(row[0]) for row in role_rows})
    if config.get("permission_synced"):
        config["role_ids"] = synced_role_ids
        config["permission_mode"] = "custom" if synced_role_ids else config.get("permission_mode", "inherit")
    elif synced_role_ids:
        config["role_ids"] = synced_role_ids
        config["permission_mode"] = "custom"
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
        "config": config,
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
SNAKE_WORKFLOW_FIELDS = [
    {**field, "field_name": _physical_column_name(field["field_name"])}
    for field in STANDARD_WORKFLOW_FIELDS
]


def _workflow_fields_for_form(form_code: str) -> list[dict]:
    if form_code in {"alert-center", "risk-review"}:
        return SNAKE_WORKFLOW_FIELDS
    return STANDARD_WORKFLOW_FIELDS


def _default_fields_for_form(form_cfg: dict) -> list[dict]:
    fields = copy.deepcopy(form_cfg["fields"])
    if form_cfg["code"] == "alert-center":
        for field in fields:
            field["field_name"] = _physical_column_name(field["field_name"])
    return fields

DEFAULT_FORM_DESIGNER_META = {
    "controlTypeOptions": [
        {"value": "code", "label": "编码"},
        {"value": "text", "label": "文本输入"},
        {"value": "textarea", "label": "多行文本"},
        {"value": "number", "label": "数值输入"},
        {"value": "select", "label": "下拉选择"},
        {"value": "relation", "label": "对象/人员选择"},
        {"value": "datetime", "label": "日期时间"},
        {"value": "upload", "label": "附件上传"},
        {"value": "switch", "label": "开关切换"},
        {"value": "readonly-text", "label": "只读展示"},
    ],
    "typeSettingOptions": {
        "textFormats": [
            {"value": "plain", "label": "普通文本"},
            {"value": "email", "label": "邮箱"},
            {"value": "phone", "label": "手机号"},
            {"value": "url", "label": "链接"},
            {"value": "idNo", "label": "证件号"},
            {"value": "custom", "label": "自定义正则"},
        ],
        "textTrimModes": [
            {"value": "none", "label": "不处理"},
            {"value": "trim", "label": "去首尾空格"},
            {"value": "trimAll", "label": "去全部空格"},
        ],
        "textCaseModes": [
            {"value": "original", "label": "保持原样"},
            {"value": "upper", "label": "自动大写"},
            {"value": "lower", "label": "自动小写"},
        ],
        "selectionModes": [
            {"value": "single", "label": "单选"},
            {"value": "multiple", "label": "多选"},
        ],
        "selectionDisplays": [
            {"value": "dropdown", "label": "下拉"},
            {"value": "search", "label": "搜索选择"},
            {"value": "radio", "label": "平铺单选"},
            {"value": "tags", "label": "标签多选"},
        ],
        "dateModes": [
            {"value": "date", "label": "日期"},
            {"value": "datetime", "label": "日期时间"},
            {"value": "range", "label": "日期范围"},
        ],
        "defaultDates": [
            {"value": "none", "label": "无默认值"},
            {"value": "today", "label": "当天"},
            {"value": "now", "label": "当前时间"},
        ],
        "encodingResetCycles": [
            {"value": "none", "label": "不重置"},
            {"value": "day", "label": "按天重置"},
            {"value": "month", "label": "按月重置"},
            {"value": "year", "label": "按年重置"},
            {"value": "dependency", "label": "按依赖字段重置"},
        ],
    },
    "componentLibrary": [
        {
            "category": "基础输入",
            "items": [
                {"key": "text", "name": "文本控件", "desc": "单行文本输入", "iconKey": "text", "controlType": "text"},
                {"key": "textarea", "name": "多行文本", "desc": "长文本、备注、说明录入", "iconKey": "textarea", "controlType": "textarea", "defaultWidth": "full"},
                {"key": "number", "name": "数值控件", "desc": "数量、金额、百分比", "iconKey": "number", "controlType": "number"},
                {"key": "code", "name": "编码控件", "desc": "自动编号、业务编号、流水号", "iconKey": "code", "controlType": "code"},
            ],
        },
        {
            "category": "选择控件",
            "items": [
                {"key": "select", "name": "下拉选择", "desc": "固定选项、枚举字典", "iconKey": "select", "controlType": "select"},
                {"key": "relation", "name": "关联对象", "desc": "人员、设备、供应商、物料", "iconKey": "relation", "controlType": "relation"},
                {"key": "datetime", "name": "日期选择", "desc": "日期、时间、时间范围", "iconKey": "datetime", "controlType": "datetime"},
                {"key": "switch", "name": "布尔选择", "desc": "是/否、启用/停用", "iconKey": "switch", "controlType": "switch"},
                {"key": "upload", "name": "附件上传", "desc": "图片、文件、凭证上传", "iconKey": "upload", "controlType": "upload", "defaultWidth": "full"},
            ],
        },
        {
            "category": "布局容器",
            "items": [
                {"key": "container", "name": "容器", "desc": "分组面板、基础信息区", "iconKey": "layout", "controlType": "container", "defaultWidth": "full"},
                {"key": "two-columns", "name": "多列布局", "desc": "两列、三列、高密度字段排版", "iconKey": "layout", "controlType": "two-columns", "defaultWidth": "full"},
                {"key": "tabs", "name": "Tab 页", "desc": "切换页签、次要信息收起", "iconKey": "layout", "controlType": "tabs", "defaultWidth": "full"},
                {"key": "divider", "name": "分割符", "desc": "分割线、区块说明", "iconKey": "divider", "controlType": "divider", "defaultWidth": "full"},
            ],
        },
        {
            "category": "数据展示",
            "items": [
                {"key": "editable-table", "name": "表格", "desc": "可编辑子表、明细行", "iconKey": "table", "controlType": "editable-table", "defaultWidth": "full"},
                {"key": "readonly-table", "name": "关联表格", "desc": "只读关联表、分页详情", "iconKey": "table", "controlType": "readonly-table", "defaultWidth": "full"},
                {"key": "summary-card", "name": "数据摘要", "desc": "摘要卡、统计值、关联对象概览", "iconKey": "database", "controlType": "summary-card", "defaultWidth": "full"},
                {"key": "status-tag", "name": "状态标签", "desc": "状态、等级、结果标识", "iconKey": "tag", "controlType": "status-tag"},
                {"key": "file-preview", "name": "媒体预览", "desc": "图片、附件、凭证预览", "iconKey": "media", "controlType": "file-preview", "defaultWidth": "full"},
            ],
        },
    ],
    "commonControlKeys": ["text", "number", "code", "select", "relation", "datetime"],
}

ALERT_CENTER_DESIGNER_SECTIONS = [
    {"key": "basic", "title": "基础信息", "desc": "识别告警、说明主题和来源", "fieldKeys": ["alertId", "title", "source", "occurredAt"]},
    {"key": "device", "title": "设备信息", "desc": "定位设备、等级和影响范围", "fieldKeys": ["device", "level"]},
    {"key": "handle", "title": "告警处理", "desc": "明确责任人、时限、状态和结论", "fieldKeys": ["owner", "dueAt", "status", "resolution"]},
    {"key": "evidence", "title": "附件证据", "desc": "上传现场图片、日志和处理凭证", "fieldKeys": ["evidence"]},
    {"key": "approval", "title": "审批/流转信息", "desc": "展示流程状态、操作记录和关闭轨迹", "fieldKeys": []},
]


def _designer_meta_for_form(form_cfg: dict) -> dict:
    meta = copy.deepcopy(DEFAULT_FORM_DESIGNER_META)
    if form_cfg["code"] == "alert-center":
        meta["businessSections"] = copy.deepcopy(ALERT_CENTER_DESIGNER_SECTIONS)
    else:
        meta["businessSections"] = [
            {
                "key": "default",
                "title": "基础信息",
                "desc": "当前表单的主要录入字段",
                "fieldKeys": [field["field_name"] for field in form_cfg["fields"]],
            }
        ]
    return meta


DEFAULT_BUSINESS_FORMS = [
    {
        "code": "alert-center",
        "name": "告警中心",
        "description": "设备告警登记、确认、派工、处理和关闭的业务表单。",
        "table_name": "business_alert_center",
        "app_codes": ["maintenance-analysis", "production-dashboard"],
        "fields": [
            {"field_name": "alertId", "label": "告警编号", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "sortable": True, "ui_config": {"businessType": "code", "controlType": "code", "encodingRule": {"enabled": True, "template": "AL-{yyyyMMdd}-{seq:3}", "prefix": "AL", "datePattern": "YYYYMMDD", "sequenceLength": 3, "fixedLength": 15, "dependencies": [], "resetCycle": "day", "regenerateOnDependencyChange": True, "allowManualOverride": False, "unique": True}}},
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
            {"field_name": "risk_no", "label": "风险单号", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "sortable": True, "ui_config": {"businessType": "code", "controlType": "code", "encodingRule": {"enabled": True, "template": "SR-{yyyyMMdd}-{seq:3}", "prefix": "SR", "datePattern": "YYYYMMDD", "sequenceLength": 3, "fixedLength": 15, "dependencies": [], "resetCycle": "day", "regenerateOnDependencyChange": True, "allowManualOverride": False, "unique": True}}},
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
            {"status": "active", "data": {"risk_no": "SR-20260524-001", "subject": "供应商北辰材料批次波动", "level": "高", "owner": "刘洋", "reason": "过去 30 天同类物料已出现 2 次质量波动，影响 SMT 焊接稳定性。", "status": "处理中", "process_status": "处理中", "current_node": "责任分派", "current_handler": "刘洋", "completed_at": "", "interaction_log": [{"time": "09:30", "actor": "王敏", "action": "提交复核"}, {"time": "09:50", "actor": "李明", "action": "定级为高风险"}]}},
            {"status": "active", "data": {"risk_no": "SR-20260523-006", "subject": "华东客户交付窗口压缩", "level": "中", "owner": "李明", "reason": "SO-8821 交付日期提前，需评估替代批次和排产调整。", "status": "已关闭", "process_status": "已完成", "current_node": "处理关闭", "current_handler": "", "completed_at": "2026-05-23T17:30:00+08:00", "interaction_log": [{"time": "13:10", "actor": "系统", "action": "创建风险"}, {"time": "17:30", "actor": "李明", "action": "关闭"}]}},
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
            "risk_no": f"SR-202605{1 + index % 27:02d}-{index + 1:04d}",
            "subject": subjects[index % len(subjects)],
            "level": levels[index % len(levels)],
            "owner": owners[index % len(owners)],
            "reason": "\u6839\u636e\u4ea4\u4ed8\u3001\u8d28\u91cf\u548c\u5e93\u5b58\u6eda\u52a8\u6570\u636e\u81ea\u52a8\u751f\u6210\u98ce\u9669\u590d\u6838\u4efb\u52a1\u3002",
            "status": statuses[index % len(statuses)],
            "process_status": "\u5df2\u5b8c\u6210" if index % len(statuses) == 3 else "\u5904\u7406\u4e2d",
            "current_node": "\u5904\u7406\u5173\u95ed" if index % len(statuses) == 3 else "\u8d23\u4efb\u5206\u6d3e",
            "current_handler": "" if index % len(statuses) == 3 else owners[index % len(owners)],
            "completed_at": _iso_day(1 + index % 27, 18) if index % len(statuses) == 3 else "",
            "interaction_log": [{"time": "09:00", "actor": "\u7cfb\u7edf", "action": "\u521b\u5efa\u98ce\u9669"}],
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
    if not searchable_fields:
        searchable_fields = [
            field
            for index, field in enumerate(visible_fields)
            if index < 4 and field.get("field_type") in {"string", "text", "enum", "date", "datetime", "relation", "code"}
        ][:4]
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


def _runtime_design_field_payload(field) -> dict:
    if isinstance(field, dict):
        return field
    return _field_payload(field)


def _default_form_layout(fields: list[dict]) -> dict:
    return {
        "sections": [
            {
                "id": "section-business-info",
                "title": "业务信息",
                "fields": [
                    {
                        "fieldName": field["field_name"],
                        "label": field.get("label") or field["field_name"],
                        "colSpan": 2 if field.get("field_type") in {"text", "json"} else 1,
                    }
                    for field in fields
                    if field.get("visible_in_form", True)
                ],
            }
        ],
    }


def _is_analysis_form_config(config: Optional[dict]) -> bool:
    kind = str((config or {}).get("assemblyKind") or (config or {}).get("kind") or (config or {}).get("type") or "").lower()
    return kind in {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}


async def _ensure_agent_business_runtime_design(db: AsyncSession, tenant_id: int, form, fields: list) -> bool:
    from app.models.relational import FormLayout

    config = dict(form.config or {})
    if _is_analysis_form_config(config):
        return False
    if form.storage_mode != "dynamic":
        return False
    if not (config.get("createdByAgent") or str(config.get("source") or "").startswith("agent-low-code")):
        return False

    field_payloads = [_runtime_design_field_payload(field) for field in fields]
    if not field_payloads:
        return False

    changed = False
    has_searchable_field = any(bool(field.get("searchable")) for field in field_payloads)
    if not has_searchable_field:
        for index, field in enumerate(fields):
            payload = field_payloads[index]
            if index < 4 and payload.get("visible_in_list", True) and payload.get("field_type") in {"string", "text", "enum", "date", "datetime", "relation", "code"}:
                payload["searchable"] = True
                if not isinstance(field, dict) and hasattr(field, "searchable"):
                    field.searchable = True
                    changed = True

    view_config = config.get("viewConfig")
    if not isinstance(view_config, dict) or not (view_config.get("table") or {}).get("columns"):
        view_config = _default_view_config(field_payloads)
        config["viewConfig"] = view_config
        config["viewConfigDraft"] = config.get("viewConfigDraft") or view_config
        changed = True
    elif not (view_config.get("filters") or []) and not has_searchable_field:
        next_view_config = _default_view_config(field_payloads)
        if next_view_config.get("filters"):
            view_config = {**view_config, "filters": next_view_config["filters"]}
            config["viewConfig"] = view_config
            config["viewConfigDraft"] = view_config
            changed = True

    if not isinstance(config.get("formLayout"), dict):
        config["formLayout"] = _default_form_layout(field_payloads)
        changed = True

    if "assemblyKind" not in config:
        config["assemblyKind"] = "business"
        changed = True

    meta = dict(config.get("viewConfigMeta") or {})
    if not meta:
        now = datetime.now().isoformat()
        config["viewConfigMeta"] = {
            "draftVersion": 1,
            "publishedVersion": 1,
            "draftSavedAt": now,
            "publishedAt": now,
            "status": "published",
        }
        changed = True

    if changed:
        form.config = config

    layout_configs = {
        "list": {"viewConfig": view_config},
        "view": {"draft": view_config, "published": view_config, "meta": config.get("viewConfigMeta")},
        "form": config["formLayout"],
    }
    for layout_type, layout_config in layout_configs.items():
        existing_layout = await db.scalar(
            select(FormLayout).where(
                FormLayout.form_id == form.id,
                FormLayout.tenant_id == tenant_id,
                FormLayout.layout_type == layout_type,
            )
        )
        if existing_layout is None:
            db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type=layout_type, config=layout_config))
            changed = True
        elif not existing_layout.config:
            existing_layout.config = layout_config
            changed = True

    return changed


def _legacy_default_workflow_config_unused(form_code: str, form_id: int, workflow_name: str, field_names: list[str]) -> dict:
    process_status_field = "process_status" if "process_status" in field_names else "processStatus"
    current_node_field = "current_node" if "current_node" in field_names else "currentNode"
    current_handler_field = "current_handler" if "current_handler" in field_names else "currentHandler"
    completed_at_field = "completed_at" if "completed_at" in field_names else "completedAt"
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
            "processStatus": process_status_field,
            "currentNode": current_node_field,
            "currentHandler": current_handler_field,
            "completedAt": completed_at_field,
        },
        "fieldPermissions": {
            "task-1": {name: {"visible": True, "editable": False, "required": False} for name in field_names},
            "task-2": {name: {"visible": True, "editable": name not in {process_status_field, current_node_field, current_handler_field, completed_at_field}, "required": False} for name in field_names},
        },
        "advancedModeConfig": {"enabled": False},
    }
    default_positions = {
        "start-1": 140,
        "task-1": 260,
        "task-2": 380,
        "end-1": 500,
    }
    for node in workflow["nodes"]:
        node_id = node.get("id")
        if node_id in default_positions:
            node["y"] = default_positions[node_id]
        if node_id == "task-2":
            node["type"] = "userTask"
            node["bpmnType"] = "bpmn:UserTask"
            node["approvalMode"] = node.get("approvalMode") or "single"
    return workflow


def _default_workflow_config(form_code: str, form_id: int, workflow_name: str, field_names: list[str]) -> dict:
    process_status_field = "process_status" if "process_status" in field_names else "processStatus"
    current_node_field = "current_node" if "current_node" in field_names else "currentNode"
    current_handler_field = "current_handler" if "current_handler" in field_names else "currentHandler"
    completed_at_field = "completed_at" if "completed_at" in field_names else "completedAt"
    locked_state_fields = {process_status_field, current_node_field, current_handler_field, completed_at_field}
    return {
        "name": workflow_name,
        "version": INITIAL_WORKFLOW_VERSION,
        "formCode": form_code,
        "formId": form_id,
        "nodes": [
            {"id": "start-1", "type": "startEvent", "label": "开始事件", "x": 420, "y": 140},
            {
                "id": "task-1",
                "type": "userTask",
                "label": "业务确认",
                "title": "业务确认",
                "x": 420,
                "y": 260,
                "assigneeType": "role",
                "assigneeValue": "业务负责人",
                "assigneeRules": [{"id": "rule-1", "type": "role", "label": "角色", "value": "业务负责人"}],
                "approvalMode": "single",
            },
            {
                "id": "task-2",
                "type": "userTask",
                "bpmnType": "bpmn:UserTask",
                "label": "处理审批",
                "title": "处理审批",
                "x": 420,
                "y": 380,
                "assigneeType": "role",
                "assigneeValue": "处理工程师",
                "assigneeRules": [{"id": "rule-1", "type": "role", "label": "角色", "value": "处理工程师"}],
                "approvalMode": "single",
            },
            {"id": "end-1", "type": "endEvent", "label": "关闭归档", "x": 420, "y": 500},
        ],
        "edges": [
            {"id": "edge-1", "source": "start-1", "target": "task-1", "label": "提交", "priority": 1, "isDefault": True},
            {"id": "edge-2", "source": "task-1", "target": "task-2", "label": "通过", "priority": 1, "isDefault": True},
            {"id": "edge-3", "source": "task-2", "target": "end-1", "label": "完成", "priority": 1, "isDefault": True},
        ],
        "triggerBindings": [
            {"action": "submit", "label": "提交触发", "enabled": True},
            {"action": "approve", "label": "按钮动作触发", "enabled": True},
        ],
        "stateMapping": {
            "processStatus": process_status_field,
            "currentNode": current_node_field,
            "currentHandler": current_handler_field,
            "completedAt": completed_at_field,
        },
        "fieldPermissions": {
            "task-1": {name: {"visible": True, "editable": False, "required": False} for name in field_names},
            "task-2": {name: {"visible": True, "editable": name not in locked_state_fields, "required": False} for name in field_names},
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
        business_fields = _default_fields_for_form(form_cfg)
        runtime_form_cfg = {**form_cfg, "fields": business_fields}
        workflow_fields = _workflow_fields_for_form(form_cfg["code"])
        fields = [*business_fields, *workflow_fields]
        designer_meta = _designer_meta_for_form(runtime_form_cfg)
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
                config={
                    "source": "default-business-seed",
                    "viewConfig": _default_view_config(fields),
                    "workflowDesigner": {},
                    "designerMeta": designer_meta,
                },
            )
            db.add(form)
            await db.flush()
        else:
            current_config = form.config or {}
            form.name = form_cfg["name"]
            form.description = form.description or form_cfg["description"]
            form.table_name = form.table_name or form_cfg["table_name"]
            if form.status in {"draft", "active"}:
                form.status = "published"
            form.config = {
                **current_config,
                "source": current_config.get("source", "default-business-seed"),
                "viewConfig": current_config.get("viewConfig") or _default_view_config(fields),
                "designerMeta": current_config.get("designerMeta") or designer_meta,
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
            "form": {"sections": [{"title": "业务信息", "fields": [field["field_name"] for field in business_fields]}, {"title": "流程状态", "fields": [field["field_name"] for field in workflow_fields]}]},
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
    from app.models.relational import ApplicationForm, Form, FormField

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
    if not user.get("is_admin") and not _is_demo_anonymous_reader(user):
        visible_forms = []
        for form in forms:
            if await has_form_permission(user, form.id, "view", db):
                visible_forms.append(form)
        forms = visible_forms
    form_ids = [form.id for form in forms]
    fields_by_form: dict[int, list] = {form_id: [] for form_id in form_ids}
    if form_ids:
        field_rows = (await db.execute(
            select(FormField)
            .where(FormField.tenant_id == tenant_id, FormField.form_id.in_(form_ids))
            .order_by(FormField.form_id, FormField.sort_order, FormField.id)
        )).scalars().all()
        for field in field_rows:
            fields_by_form.setdefault(field.form_id, []).append(field)
    return {"data": [_form_payload(form, fields=fields_by_form.get(form.id, [])) for form in forms]}


@router.post("")
async def create_form(
    body: FormCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Application, ApplicationForm, Form, FormAction, FormLayout

    tenant_id = current_tenant_id(user)
    _validate_form_code(body.code)
    storage_mode = body.storage_mode
    table_name = body.table_name
    if storage_mode == "dynamic" and not table_name:
        storage_mode = "physical_table"
        table_name = _physical_table_name_for_form(body.code, body.config)
    if table_name:
        assert_safe_identifier(table_name)

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
        table_name=table_name,
        storage_mode=storage_mode,
        status=body.status,
        owner_id=_uid(user),
        config=body.config,
    )
    db.add(form)
    await db.flush()
    await _ensure_physical_form_table(db, form, [])

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
    return {"data": [await _menu_node_payload(db, node) for node in nodes]}


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
    values["config"] = _normalized_menu_node_config(values.get("config"))
    if values.get("form_id") and not values.get("route_path"):
        form_config = form.config or {}
        form_kind = str(form_config.get("assemblyKind") or form_config.get("kind") or form_config.get("type") or "").lower()
        values["route_path"] = (
            f"/program/{form.code}"
            if form_kind in {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}
            else f"/dynamic/{form.code}"
        )
    node = ApplicationMenuNode(tenant_id=tenant_id, application_id=application_id, **values)
    db.add(node)
    await db.flush()
    await _sync_menu_node_entry_permissions(db, node)
    if body.form_id is not None:
        await _ensure_application_form_binding(db, application_id, body.form_id)
    await db.commit()
    await db.refresh(node)
    return {"data": await _menu_node_payload(db, node)}


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
        form_config = form.config or {}
        form_kind = str(form_config.get("assemblyKind") or form_config.get("kind") or form_config.get("type") or "").lower()
        updates["route_path"] = (
            f"/program/{form.code}"
            if form_kind in {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}
            else f"/dynamic/{form.code}"
        )
    if "config" in updates:
        updates["config"] = _normalized_menu_node_config(updates.get("config"))
    for key, value in updates.items():
        setattr(node, key, value)
    await _sync_menu_node_entry_permissions(db, node)
    if node.form_id is not None:
        await _ensure_application_form_binding(db, application_id, node.form_id)
    await db.commit()
    await db.refresh(node)
    return {"data": await _menu_node_payload(db, node)}


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
    await _delete_menu_node_entry_permissions(db, node)
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


@router.get("/code/{form_code}")
async def get_form_by_code(
    form_code: str,
    schema: str = Query(default="draft", pattern="^(draft|published)$"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form

    tenant_id = current_tenant_id(user)
    await _ensure_default_business_forms(db, tenant_id)
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == form_code))
    if not form:
        raise HTTPException(404, "Form not found")
    return await get_form(form.id, schema=schema, db=db, user=user)


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
    draft_fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    if await _ensure_agent_business_runtime_design(db, tenant_id, form, draft_fields):
        await db.commit()
        await db.refresh(form)
    fields = await _runtime_form_fields(db, tenant_id, form_id) if schema == "published" else draft_fields
    if not user.get("is_admin") and not _is_demo_anonymous_reader(user):
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
            if not user.get("is_admin") and not _is_demo_anonymous_reader(user):
                visible_names = await allowed_form_fields(user, form_id, "view", fields, db)
                payload["fields"] = [field for field in payload["fields"] if field.get("field_name") in visible_names]
            payload["runtime_permissions"] = await _runtime_permission_summary(user, form_id, db)
            payload["runtime_field_permissions"] = await _runtime_field_permission_summary(user, form, payload.get("fields") or [], db)
            return {"data": payload}
    payload = _form_payload(form, fields=fields, applications=applications)
    payload["runtime_permissions"] = await _runtime_permission_summary(user, form_id, db)
    payload["runtime_field_permissions"] = await _runtime_field_permission_summary(user, form, fields, db)
    return {"data": payload}


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


@router.delete("/{form_id}")
async def delete_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import ApplicationForm, ApplicationMenuNode, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    if form.status not in {"draft"}:
        raise HTTPException(409, "Only draft forms can be deleted")

    binding_count = await db.scalar(
        select(func.count(ApplicationForm.id)).where(
            ApplicationForm.form_id == form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    ) or 0
    menu_binding_count = await db.scalar(
        select(func.count(ApplicationMenuNode.id)).where(
            ApplicationMenuNode.form_id == form_id,
            ApplicationMenuNode.tenant_id == tenant_id,
        )
    ) or 0
    if binding_count or menu_binding_count:
        raise HTTPException(409, "Form is bound to an application menu")

    old_values = _form_payload(form)
    await db.delete(form)
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="delete",
        resource_type="form",
        resource_id=form_id,
        old_values=old_values,
        new_values={"deleted": True},
    )
    return {"data": {"id": form_id, "deleted": True}}


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
    await db.flush()
    await _ensure_physical_form_table(db, form, [field])
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
    visible_fields = await _runtime_visible_field_names(user, form_id, fields, db)
    if _uses_physical_form_table(form):
        if cursor_after_id is not None or cursor_before_id is not None:
            raise HTTPException(400, "Cursor pagination is not supported for physical form tables")
        return await _list_physical_records(
            db,
            form,
            fields,
            visible_fields,
            include_deleted=include_deleted,
            search=search,
            filters_json=filters_json,
            sort_field=sort_field,
            sort_order=sort_order,
            include_total=include_total,
            page=page,
            page_size=page_size,
        )
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
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    visible_fields = await _runtime_visible_field_names(user, form_id, fields, db)
    if _uses_physical_form_table(form):
        return await _get_physical_record(db, form, fields, visible_fields, record_id, include_deleted=include_deleted)
    record = await db.get(DynamicRecord, record_id)
    if (
        not record
        or record.form_id != form_id
        or record.tenant_id != tenant_id
        or (record.deleted_at is not None and not include_deleted)
    ):
        raise HTTPException(404, "Record not found")
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
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    editable_fields = await allowed_form_fields(user, form_id, "create", fields, db)
    _validate_record_data(fields, body.data)
    if _uses_physical_form_table(form):
        await _ensure_physical_form_table(db, form, fields)
        payload = _physical_write_payload(fields, body.data, editable_fields)
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        physical_values = {_physical_column_name(key): value for key, value in payload.items()}
        columns = ["tenant_id", "record_status", "created_by", "updated_by", *physical_values.keys()]
        for column in columns:
            assert_safe_identifier(column)
        params = {
            "tenant_id": tenant_id,
            "record_status": body.status,
            "created_by": _uid(user),
            "updated_by": _uid(user),
            **physical_values,
        }
        column_sql = ", ".join(columns)
        value_sql = ", ".join(f":{column}" for column in columns)
        row = (await db.execute(
            text(f"INSERT INTO {table_name} ({column_sql}) VALUES ({value_sql}) RETURNING *"),
            params,
        )).first()
        await db.commit()
        result = _physical_record_payload(row, form, fields)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="physical_record",
            resource_id=result["id"],
            new_values=result,
        )
        return {"data": result}

    await assert_tenant_quota(db, tenant_id, "dynamicRecords")
    denied_fields = sorted(set(body.data.keys()) - editable_fields)
    if denied_fields:
        raise HTTPException(403, f"Field permission denied: {', '.join(denied_fields)}")
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
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "edit")
    if _uses_physical_form_table(form):
        fields = await _runtime_form_fields(db, tenant_id, form_id)
        await _ensure_physical_form_table(db, form, fields)
        editable_fields = await allowed_form_fields(user, form_id, "edit", fields, db)
        updates = body.dict(exclude_unset=True)
        data_updates = updates.get("data") or {}
        all_field_names = {field.field_name for field in fields if not field.archived}
        existing = await _get_physical_record(db, form, fields, all_field_names, record_id, include_deleted=False)
        merged = _merged_record_data(existing["data"]["data"], data_updates)
        _validate_record_data(fields, merged)
        payload = _physical_write_payload(fields, data_updates, editable_fields)
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        assignments = []
        params = {"id": record_id, "tenant_id": tenant_id, "updated_by": _uid(user)}
        if "status" in updates and updates["status"] is not None:
            assignments.append("record_status = :record_status")
            params["record_status"] = updates["status"]
        for key, value in payload.items():
            column_name = _physical_column_name(key)
            param_name = f"field_{column_name}"
            assignments.append(f"{column_name} = :{param_name}")
            params[param_name] = value
        assignments.extend(["updated_by = :updated_by", "updated_at = now()"])
        row = (await db.execute(
            text(f"UPDATE {table_name} SET {', '.join(assignments)} WHERE id = :id AND tenant_id = :tenant_id AND deleted_at IS NULL RETURNING *"),
            params,
        )).first()
        if not row:
            raise HTTPException(404, "Record not found")
        await db.commit()
        result = _physical_record_payload(row, form, fields)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="update",
            resource_type="physical_record",
            resource_id=record_id,
            new_values=updates,
        )
        return {"data": result}

    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.tenant_id != tenant_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
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
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "delete")
    if _uses_physical_form_table(form):
        fields = await _runtime_form_fields(db, tenant_id, form_id)
        await _ensure_physical_form_table(db, form, fields)
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        row = (await db.execute(
            text(f"UPDATE {table_name} SET deleted_at = now(), updated_by = :updated_by, updated_at = now() WHERE id = :id AND tenant_id = :tenant_id AND deleted_at IS NULL RETURNING id"),
            {"id": record_id, "tenant_id": tenant_id, "updated_by": _uid(user)},
        )).first()
        if not row:
            raise HTTPException(404, "Record not found")
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="delete",
            resource_type="physical_record",
            resource_id=record_id,
        )
        return {"ok": True}

    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.tenant_id != tenant_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
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
