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
from app.core.permissions import has_form_permission

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
    return {
        "id": field.id,
        "form_id": field.form_id,
        "meta_field_id": field.meta_field_id,
        "field_name": field.field_name,
        "label": field.label,
        "field_type": field.field_type,
        "required": field.required,
        "visible_in_list": field.visible_in_list,
        "visible_in_form": field.visible_in_form,
        "searchable": field.searchable,
        "sortable": field.sortable,
        "archived": field.archived,
        "default_value": field.default_value,
        "enum_values": field.enum_values,
        "validation": field.validation,
        "ui_config": field.ui_config,
        "sort_order": field.sort_order,
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


def _record_payload(record) -> dict:
    return {
        "id": record.id,
        "form_id": record.form_id,
        "model_id": record.model_id,
        "data": record.data or {},
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
            {"field_name": "alertId", "label": "告警编号", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "sortable": True, "ui_config": {"autoNumber": "AL-{yyyyMMdd}-{seq:3}"}},
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
            {"field_name": "riskNo", "label": "风险单号", "field_type": "string", "required": True, "visible_in_list": True, "visible_in_form": True, "searchable": True, "sortable": True, "ui_config": {"autoNumber": "SR-{yyyyMMdd}-{seq:3}"}},
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
                "operator": "contains" if field.get("field_type") == "string" else "equals",
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

        if await db.scalar(select(func.count(DynamicRecord.id)).where(DynamicRecord.form_id == form.id, DynamicRecord.tenant_id == tenant_id)) == 0:
            for record_cfg in form_cfg["records"]:
                db.add(DynamicRecord(tenant_id=tenant_id, form_id=form.id, model_id=form.model_id, created_by=None, updated_by=None, **record_cfg))

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


@router.get("/{form_id}")
async def get_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Application, ApplicationForm, Form, FormField

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
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

    field = FormField(tenant_id=tenant_id, form_id=form_id, **body.dict())
    db.add(field)
    await db.commit()
    await db.refresh(field)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create_field",
        resource_type="form",
        resource_id=form_id,
        new_values=body.dict(),
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
    for key, value in body.dict(exclude_unset=True).items():
        setattr(field, key, value)
    await db.commit()
    await db.refresh(field)
    return {"data": _field_payload(field)}


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
    field.archived = True
    await db.commit()
    return {"ok": True}


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
    cursor_after_id: Optional[int] = Query(default=None, ge=1),
    cursor_before_id: Optional[int] = Query(default=None, ge=1),
    include_total: bool = True,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, Form, FormField

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    db_filters = [DynamicRecord.form_id == form_id, DynamicRecord.tenant_id == tenant_id]
    if not include_deleted:
        db_filters.append(DynamicRecord.deleted_at.is_(None))

    parsed_filters = _parse_record_filters(filters_json)
    query = select(DynamicRecord).where(*db_filters)
    query, search_pushed = _apply_record_search_query(query, DynamicRecord, fields, search)
    query, filters_pushed = _apply_record_filters_query(query, DynamicRecord, fields, parsed_filters)
    if settings.IS_PRODUCTION and ((search and not search_pushed) or (parsed_filters and not filters_pushed)):
        raise HTTPException(400, "Query is not indexed for production dynamic records")
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

    query = query.order_by(DynamicRecord.id.desc())
    if not search and not parsed_filters and not cursor_mode:
        total = await db.scalar(select(func.count(DynamicRecord.id)).where(*db_filters))
        result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
        return {
            "data": [_record_payload(record) for record in result.scalars().all()],
            "total": int(total or 0),
            "page": page,
            "page_size": page_size,
            "has_more": False,
            "next_cursor": None,
        }

    if cursor_mode or ((search or parsed_filters) and search_pushed and filters_pushed):
        total = None
        if include_total and not cursor_mode:
            count_query = select(func.count(DynamicRecord.id)).where(*db_filters)
            count_query, _ = _apply_record_search_query(count_query, DynamicRecord, fields, search)
            count_query, _ = _apply_record_filters_query(count_query, DynamicRecord, fields, parsed_filters)
            total = await db.scalar(count_query)
        result = await db.execute(query.limit(page_size + 1))
        rows = result.scalars().all()
        page_rows = rows[:page_size]
        next_cursor = page_rows[-1].id if len(rows) > page_size and page_rows else None
        return {
            "data": [_record_payload(record) for record in page_rows],
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
        if _record_matches_search(record, fields, search)
        and _record_matches_filters(record, fields, parsed_filters)
    ]
    total = len(matched)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "data": [_record_payload(record) for record in matched[start:end]],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/{form_id}/records")
async def create_dynamic_record(
    form_id: int,
    body: DynamicRecordCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, Form, FormField

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "create")
    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    _validate_record_data(fields, body.data)
    record = DynamicRecord(
        tenant_id=tenant_id,
        form_id=form_id,
        model_id=form.model_id,
        data=body.data,
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
    from app.models.relational import DynamicRecord, FormField

    tenant_id = current_tenant_id(user)
    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.tenant_id != tenant_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
    await _ensure_form_permission(db, user, form_id, "edit")
    updates = body.dict(exclude_unset=True)
    if "data" in updates and updates["data"] is not None:
        fields = (await db.execute(
            select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
        )).scalars().all()
        merged = {**(record.data or {}), **updates["data"]}
        _validate_record_data(fields, merged)
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
