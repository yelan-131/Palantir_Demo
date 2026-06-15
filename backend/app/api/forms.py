"""Platform form configuration and dynamic record APIs.

These endpoints are the first database-backed layer for application-owned
low-code forms. Creating fields updates metadata only; it does not execute
DDL against business tables.
"""
from __future__ import annotations

import json
import copy
import logging
import re
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db, require_admin
from app.config import settings
from app.database import DB_TYPE
from app.core.audit import write_audit_log
from app.core.permissions import allowed_form_fields, evaluate_form_permission, get_user_role_ids, has_form_permission
from app.core.production_errors import seed_data_required
from app.services.tenant_onboarding import assert_tenant_quota

# Storage-agnostic form engine (naming/validation/encoding/query/physical/
# sequences) extracted from this module; names are re-imported so existing
# call sites and tests (`from app.api.forms import ...`) keep working.
from app.api.form_engine import (  # noqa: F401  (re-exported names)
    ALLOWED_RECORD_STATUSES,
    ANALYTICS_FORM_KINDS,
    PHYSICAL_FORM_STORAGE_MODES,
    _CODE_ALLOCATION_MAX_ATTEMPTS,
    _allocate_code_sequence,
    _apply_record_encoding_rules,
    _apply_record_filters_query,
    _apply_record_search_query,
    _apply_record_sort_query,
    _assert_unique_code_values,
    _code_sequence_from_value,
    _code_value_exists,
    _coerce_physical_value,
    _date_token_for_rule,
    _dynamic_record_field_impact,
    _encoding_rule_for_field,
    _ensure_filter_fields_visible,
    _ensure_physical_code_indexes,
    _ensure_physical_form_table,
    _ensure_production_record_query_supported,
    _ensure_sort_field_allowed,
    _field_allowed_values,
    _field_value_is_compatible,
    _get_physical_record,
    _is_analysis_form_config,
    _is_anonymous_reader,
    _is_encoding_field,
    _isoformat_value,
    _json_text_expr,
    _list_physical_records,
    _max_dynamic_code_sequence,
    _max_physical_code_sequence,
    _merged_record_data,
    _normalize_sql_type,
    _parse_record_filters,
    _physical_column_name,
    _physical_column_type,
    _physical_filter_clause,
    _physical_record_field_impact,
    _physical_record_payload,
    _physical_table_column_types,
    _physical_table_columns,
    _physical_table_name_for_form,
    _physical_write_payload,
    _queryable_field_names,
    _record_matches_filters,
    _record_matches_search,
    _render_code_template,
    _rule_code_embeds_date,
    _runtime_visible_field_names,
    _sequence_period_key,
    _sortable_field_names,
    _sql_current_timestamp,
    _uses_physical_form_table,
    _validate_physical_table_name,
    _validate_record_data,
    _validate_record_status,
    _visible_field_subset,
)

router = APIRouter()

logger = logging.getLogger(__name__)

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


async def _ensure_form_permission(
    db: AsyncSession,
    user: dict,
    form_id: int,
    action: str,
) -> None:
    if action == "view" and _is_anonymous_reader(user):
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


def _form_layout_field_names(config: Optional[dict]) -> list[str]:
    if not isinstance(config, dict):
        return []
    layout = config.get("formLayout")
    if not isinstance(layout, dict):
        designer_layout = config.get("formDesignerLayout")
        if isinstance(designer_layout, dict) and isinstance(designer_layout.get("runtime"), dict):
            layout = designer_layout.get("runtime")
    sections = layout.get("sections") if isinstance(layout, dict) else None
    if not isinstance(sections, list):
        return []
    names: list[str] = []
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("fields"), list):
            continue
        for item in section["fields"]:
            if isinstance(item, str):
                field_name = item
            elif isinstance(item, dict):
                field_name = item.get("fieldName") or item.get("field_name")
            else:
                field_name = None
            if field_name:
                names.append(str(field_name))
    return list(dict.fromkeys(names))


def _scoped_form_payload(payload: dict, scope: str) -> dict:
    scope = scope or "designer"
    if scope == "designer":
        return payload
    scoped = copy.deepcopy(payload)
    fields = [field for field in (scoped.get("fields") or []) if not field.get("archived")]
    config = scoped.get("config") if isinstance(scoped.get("config"), dict) else {}
    if scope == "list":
        scoped["fields"] = [
            field for field in fields
            if field.get("visible_in_list") or field.get("searchable") or field.get("sortable")
        ]
        scoped["config"] = {
            "viewConfig": config.get("viewConfig"),
            "viewConfigMeta": config.get("viewConfigMeta"),
            "publishedSchemaVersion": config.get("publishedSchemaVersion"),
            "publishedAt": config.get("publishedAt"),
        }
        scoped.pop("permission_design", None)
        scoped.pop("runtime_field_permissions", None)
        return scoped
    if scope in {"create", "edit"}:
        layout_names = _form_layout_field_names(config)
        field_by_name = {field.get("field_name"): field for field in fields}
        if layout_names:
            scoped["fields"] = [
                field_by_name[name]
                for name in layout_names
                if name in field_by_name
            ]
        else:
            scoped["fields"] = [field for field in fields if field.get("visible_in_form", True)]
        scoped["config"] = {
            "formLayout": config.get("formLayout"),
            "formDesignerLayout": config.get("formDesignerLayout"),
            "publishedSchemaVersion": config.get("publishedSchemaVersion"),
            "publishedAt": config.get("publishedAt"),
        }
        allowed_names = {field.get("field_name") for field in scoped["fields"]}
        field_permissions = scoped.get("runtime_field_permissions")
        if isinstance(field_permissions, dict):
            scoped["runtime_field_permissions"] = {
                name: value for name, value in field_permissions.items() if name in allowed_names
            }
        scoped.pop("permission_design", None)
        return scoped
    return scoped


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


def _workflow_instance_title(form, record_payload: dict, binding_config: Optional[dict]) -> str:
    binding_config = binding_config or {}
    data = record_payload.get("data") if isinstance(record_payload, dict) else {}
    title_field = binding_config.get("title_field") or binding_config.get("titleField")
    if title_field and isinstance(data, dict) and data.get(str(title_field)):
        return str(data[str(title_field)])
    for key in ("title", "name", "material_code", "material_no", "code", "alertId", "risk_no"):
        if isinstance(data, dict) and data.get(key):
            return f"{form.name} - {data[key]}"
    return f"{form.name} #{record_payload.get('id')}"


async def _start_form_workflows(
    db: AsyncSession,
    *,
    tenant_id: int,
    form,
    record_payload: dict,
    user: dict,
    trigger_action: str = "submit",
) -> list[dict]:
    from app.api.workflow import (
        _add_approval_notifications,
        _find_first_approval_step,
        _resolve_step_approver_ids,
        _set_current_assignees,
        _workflow_config_steps,
    )
    from app.models.relational import WorkflowApproval, WorkflowBinding, WorkflowDef, WorkflowInstance

    bindings = (await db.execute(
        select(WorkflowBinding)
        .where(
            WorkflowBinding.tenant_id == tenant_id,
            WorkflowBinding.form_id == form.id,
            WorkflowBinding.trigger_action == trigger_action,
            WorkflowBinding.enabled == True,
        )
        .order_by(WorkflowBinding.id)
    )).scalars().all()
    if not bindings:
        return []

    started: list[dict] = []
    initiator_id = current_user_id(user)
    form_data = record_payload.get("data") if isinstance(record_payload.get("data"), dict) else {}
    for binding in bindings:
        workflow_def = await db.get(WorkflowDef, binding.workflow_id)
        if not workflow_def or workflow_def.tenant_id != tenant_id or workflow_def.status not in {"published", "active"}:
            continue
        # At creation time the live config equals the latest snapshot; the
        # instance pins workflow_version below so later edits cannot reshape it.
        config = json.loads(workflow_def.config) if isinstance(workflow_def.config, str) else workflow_def.config
        steps = _workflow_config_steps(config if isinstance(config, dict) else {})
        first_step_index = _find_first_approval_step(steps) if steps else 0
        current_step = steps[first_step_index] if steps and first_step_index < len(steps) else None
        variables = {
            "form_id": form.id,
            "form_code": form.code,
            "record_id": record_payload.get("id"),
            "trigger_action": trigger_action,
        }
        approver_ids = await _resolve_step_approver_ids(
            db,
            tenant_id,
            current_step or {},
            form_data,
            variables,
            initiator_id,
            initiator_id,
        ) if current_step and current_step.get("type") == "approval" else []
        state = {
            "current_node": current_step.get("node_id", current_step.get("name", "start")) if current_step else "end",
            "current_step": first_step_index,
            "resource_type": "dynamic_record",
            "resource_id": record_payload.get("id"),
            "variables": variables,
        }
        _set_current_assignees(state, approver_ids)
        title = _workflow_instance_title(form, record_payload, binding.config)
        instance = WorkflowInstance(
            tenant_id=tenant_id,
            workflow_id=workflow_def.id,
            workflow_version=int(workflow_def.version or 1),
            title=title,
            initiator_id=initiator_id,
            form_data=json.dumps(form_data, ensure_ascii=False, default=str),
            workflow_state=json.dumps(state, ensure_ascii=False, default=str),
            status="pending",
        )
        db.add(instance)
        await db.flush()
        if current_step and current_step.get("type") == "approval":
            for approver_id in approver_ids:
                db.add(WorkflowApproval(
                    instance_id=instance.id,
                    approver_id=approver_id,
                    node_id=current_step.get("node_id", current_step.get("name", "")),
                ))
            _add_approval_notifications(db, tenant_id, approver_ids, title, instance.id)
        started.append({
            "instance_id": instance.id,
            "workflow_id": workflow_def.id,
            "status": instance.status,
            "current_step": first_step_index,
            "current_step_name": current_step.get("name") if current_step else None,
            "approver_ids": approver_ids,
        })
    return started


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
        "business_type": None,
        "control_type": None,
        "encoding_rule": None,
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


@router.get("")
async def list_forms(
    application_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import ApplicationForm, Form, FormField

    tenant_id = current_tenant_id(user)
    query = select(Form).where(Form.tenant_id == tenant_id).order_by(Form.created_at.desc(), Form.id.desc())
    if application_id is not None:
        query = query.join(ApplicationForm, ApplicationForm.form_id == Form.id).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.tenant_id == tenant_id,
            ApplicationForm.enabled.is_(True),
        )
    forms = (await db.execute(query)).scalars().all()
    if not user.get("is_admin") and not _is_anonymous_reader(user):
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
    if not forms:
        raise seed_data_required("No forms found. Run the business form seed before opening forms.")
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
        table_name = _physical_table_name_for_form(tenant_id, body.code, body.config)
    if table_name:
        _validate_physical_table_name(tenant_id, table_name)

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
    scope: str = Query(default="designer", pattern="^(list|create|edit|designer)$"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form

    tenant_id = current_tenant_id(user)
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == form_code))
    if not form:
        raise HTTPException(404, "Form not found")
    return await get_form(form.id, schema=schema, scope=scope, db=db, user=user)


@router.get("/{form_id}")
async def get_form(
    form_id: int,
    schema: str = Query(default="draft", pattern="^(draft|published)$"),
    scope: str = Query(default="designer", pattern="^(list|create|edit|designer)$"),
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
    if not user.get("is_admin") and not _is_anonymous_reader(user):
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
            if not user.get("is_admin") and not _is_anonymous_reader(user):
                visible_names = await allowed_form_fields(user, form_id, "view", fields, db)
                payload["fields"] = [field for field in payload["fields"] if field.get("field_name") in visible_names]
            payload["runtime_permissions"] = await _runtime_permission_summary(user, form_id, db)
            payload["runtime_field_permissions"] = await _runtime_field_permission_summary(user, form, payload.get("fields") or [], db)
            return {"data": _scoped_form_payload(payload, scope)}
    payload = _form_payload(form, fields=fields, applications=applications)
    payload["runtime_permissions"] = await _runtime_permission_summary(user, form_id, db)
    payload["runtime_field_permissions"] = await _runtime_field_permission_summary(user, form, fields, db)
    return {"data": _scoped_form_payload(payload, scope)}


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
        _validate_physical_table_name(tenant_id, updates["table_name"])
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
    _validate_record_status(body.status)
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    editable_fields = await allowed_form_fields(user, form_id, "create", fields, db)
    input_data = dict(body.data or {})
    if _uses_physical_form_table(form):
        await _ensure_physical_form_table(db, form, fields)
    record_data = await _apply_record_encoding_rules(db, tenant_id, form, fields, input_data)
    generated_fields: set[str] = set()
    generated_fields = {key for key, value in record_data.items() if input_data.get(key) != value}
    _validate_record_data(fields, record_data)
    if _uses_physical_form_table(form):
        payload = _physical_write_payload(fields, record_data, editable_fields | generated_fields)
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        # Physical records share the dynamicRecords quota; count this form's
        # live rows so the physical path cannot bypass tenant limits.
        physical_count = int(await db.scalar(
            text(f"SELECT COUNT(*) FROM {table_name} WHERE tenant_id = :tenant_id AND deleted_at IS NULL"),
            {"tenant_id": tenant_id},
        ) or 0)
        await assert_tenant_quota(db, tenant_id, "dynamicRecords", extra_count=physical_count)
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
        result = _physical_record_payload(row, form, fields)
        workflow_instances = await _start_form_workflows(
            db,
            tenant_id=tenant_id,
            form=form,
            record_payload=result,
            user=user,
            trigger_action="submit",
        )
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="physical_record",
            resource_id=result["id"],
            new_values={**result, "workflow_instances": workflow_instances},
        )
        return {"data": {**result, "workflow_instances": workflow_instances}}

    await assert_tenant_quota(db, tenant_id, "dynamicRecords")
    denied_fields = sorted(set(record_data.keys()) - editable_fields - generated_fields)
    if denied_fields:
        raise HTTPException(403, f"Field permission denied: {', '.join(denied_fields)}")
    latest_version = await _latest_form_version(db, tenant_id, form_id)
    record = DynamicRecord(
        tenant_id=tenant_id,
        form_id=form_id,
        model_id=form.model_id,
        data=record_data,
        schema_version=latest_version.version if latest_version else 1,
        status=body.status,
        created_by=_uid(user),
        updated_by=_uid(user),
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    record_result = _record_payload(record)
    workflow_instances = await _start_form_workflows(
        db,
        tenant_id=tenant_id,
        form=form,
        record_payload=record_result,
        user=user,
        trigger_action="submit",
    )
    await db.commit()
    await db.refresh(record)
    record_result = _record_payload(record)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create",
        resource_type="dynamic_record",
        resource_id=record.id,
        new_values={**record_result, "workflow_instances": workflow_instances},
    )
    return {"data": {**record_result, "workflow_instances": workflow_instances}}


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
    _validate_record_status(body.status)
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
        await _assert_unique_code_values(db, tenant_id, form, fields, data_updates, exclude_record_id=record_id)
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
        assignments.extend(["updated_by = :updated_by", f"updated_at = {_sql_current_timestamp()}"])
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
        await _assert_unique_code_values(db, tenant_id, form, fields, updates["data"], exclude_record_id=record_id)
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
            text(f"UPDATE {table_name} SET deleted_at = {_sql_current_timestamp()}, updated_by = :updated_by, updated_at = {_sql_current_timestamp()} WHERE id = :id AND tenant_id = :tenant_id AND deleted_at IS NULL RETURNING id"),
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
