"""Confirmed AI operations for the application workspace."""
import hashlib
import json
from typing import Annotated

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.api.applications import (
    ApplicationCreate,
    ApplicationUpdate,
    _application_to_dict,
    create_application,
    delete_application,
    ensure_application_code_available,
    get_tenant_application,
    update_application,
)
from app.api.deps import require_admin
from app.models.relational import ApplicationForm, ApplicationMenuNode
from app.services.field_uniqueness import lock
from app.services.tenant_onboarding import assert_tenant_quota

from .tenant_context import require_tenant_id


Name = Annotated[str, Field(min_length=1, max_length=200)]
Code = Annotated[str, Field(min_length=1, max_length=100)]
Icon = Annotated[str, Field(max_length=100)]
Route = Annotated[str, Field(max_length=200, pattern=r"^/([^/\\\s][^\\\s]*)?$")]
SortOrder = Annotated[int, Field(ge=-(2**31), le=2**31 - 1)]


class ApplicationToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CreateApplication(ApplicationToolRequest):
    name: Name
    code: Code
    description: str | None = None
    icon: Icon | None = None
    default_route: Route = "/"
    sort_order: SortOrder = 0
    is_pinned: bool = False


class ApplicationTarget(ApplicationToolRequest):
    application_id: int = Field(gt=0, le=2**31 - 1)


class UpdateApplication(ApplicationTarget):
    name: Name | None = None
    code: Code | None = None
    description: str | None = None
    icon: Icon | None = None
    default_route: Route | None = None
    sort_order: SortOrder | None = None
    is_pinned: bool | None = None

    @model_validator(mode="after")
    def validate_changes(self):
        changes = self.model_dump(exclude_unset=True, exclude={"application_id"})
        if not changes:
            raise ValueError("请填写要修改的应用属性")
        if any(value is None and key not in {"description", "icon"} for key, value in changes.items()):
            raise ValueError("只有应用说明和图标可以清空")
        return self


APPLICATION_TOOL_DETAILS = {
    "applications.create": ("新建草稿应用", "按名称和编码新建草稿应用。可选设置说明、图标、启动页面、排序和置顶。"),
    "applications.update": ("修改应用属性", "按应用 ID 修改名称、编码、说明、图标、启动页面、排序或置顶。只传需要修改的字段。"),
    "applications.publish": ("发布草稿应用", "按应用 ID 发布草稿应用，使有权限的成员可以访问。"),
    "applications.disable": ("停用应用", "按应用 ID 停用已发布应用。停用后可重新启用。"),
    "applications.enable": ("重新启用应用", "按应用 ID 重新启用已停用的应用。"),
    "applications.delete": ("删除草稿应用", "按应用 ID 删除草稿应用及其菜单和表单绑定。"),
}

APPLICATION_REQUESTS = dict.fromkeys(APPLICATION_TOOL_DETAILS, ApplicationTarget)
APPLICATION_REQUESTS.update({"applications.create": CreateApplication, "applications.update": UpdateApplication})

STATUS_TRANSITIONS = {
    "applications.publish": ({"draft"}, "published"),
    "applications.disable": ({"published", "active"}, "disabled"),
    "applications.enable": ({"disabled"}, "published"),
}
STATUS_LABELS = {"draft": "草稿", "published": "已发布", "active": "已发布", "disabled": "已停用"}
FIELD_LABELS = {
    "name": "应用名称", "code": "应用编码", "description": "应用说明", "icon": "图标",
    "default_route": "启动页面", "sort_order": "排序", "is_pinned": "置顶", "status": "状态",
}


def _preview_value(field, value):
    if field == "status":
        return STATUS_LABELS.get(value, value)
    if isinstance(value, bool):
        return "是" if value else "否"
    return value if value not in {None, ""} else "空"


def _changes_preview(changes, before):
    fields = {}
    for field, value in changes.items():
        after = _preview_value(field, value)
        if before is None:
            fields[FIELD_LABELS[field]] = after
        elif before[field] != value:
            fields[FIELD_LABELS[field]] = f"{_preview_value(field, before[field])} → {after}"
    return fields


async def _delete_impact(session, tenant_id, application_id):
    references = {}
    for model, label in ((ApplicationMenuNode, "菜单节点"), (ApplicationForm, "表单绑定")):
        rows = (await session.execute(select(model.id, model.updated_at).where(
            model.tenant_id == tenant_id, model.application_id == application_id,
        ).order_by(model.id))).all()
        references[label] = [[row.id, row.updated_at.isoformat() if row.updated_at else None] for row in rows]
    return references


def _snapshot_digest(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def execute_application_tool(operation, session, *, user, payload, prepare=False):
    await require_admin(user)
    tenant_id = require_tenant_id(user)
    arguments = payload if prepare else {
        key: value for key, value in payload.items() if key not in {"_preview", "_application_snapshot"}
    }
    request = APPLICATION_REQUESTS[operation].model_validate(arguments)
    values = request.model_dump(exclude_unset=operation != "applications.create")
    snapshot = {"operation": operation, "arguments": values}
    if not prepare:
        await lock(session, tenant_id)

    if operation == "applications.create":
        body = ApplicationCreate(**values, status="draft")
        if not prepare:
            if _snapshot_digest(snapshot) != payload.get("_application_snapshot"):
                raise HTTPException(409, "新建应用参数已变化，请重新确认")
            return await create_application(session, body, user)
        await assert_tenant_quota(session, tenant_id, "applications")
        await ensure_application_code_available(session, tenant_id, body.code)
        preview = _changes_preview({key: value for key, value in values.items() if value is not None}, None)
        return {
            **values,
            "_application_snapshot": _snapshot_digest(snapshot),
            "_preview": {"target": body.name, "fields": {**preview, "状态": "草稿"}},
        }

    app = await get_tenant_application(session, tenant_id, request.application_id, for_update=not prepare)
    before = await _application_to_dict(session, app)
    snapshot.update(application=before, updated_at=app.updated_at.isoformat() if app.updated_at else None)
    changes = {key: value for key, value in values.items() if key != "application_id"}
    fields = {}
    if operation == "applications.delete":
        if app.status != "draft":
            raise HTTPException(409, "只能删除草稿应用")
        snapshot["references"] = await _delete_impact(session, tenant_id, app.id)
        fields = {label: len(references) for label, references in snapshot["references"].items()}
    elif operation in STATUS_TRANSITIONS:
        allowed, new_status = STATUS_TRANSITIONS[operation]
        if app.status not in allowed:
            raise HTTPException(409, "当前应用状态不支持该操作")
        changes["status"] = new_status

    if prepare:
        if "code" in changes:
            await ensure_application_code_available(session, tenant_id, changes["code"], application_id=app.id)
        return {
            **values,
            "_application_snapshot": _snapshot_digest(snapshot),
            "_preview": {"target": app.name, "fields": fields or _changes_preview(changes, before)},
        }

    if _snapshot_digest(snapshot) != payload.get("_application_snapshot"):
        raise HTTPException(409, "应用或菜单配置已变化，请重新确认")
    if operation == "applications.delete":
        return await delete_application(session, app, user)
    return await update_application(session, app, ApplicationUpdate(**changes), user)
