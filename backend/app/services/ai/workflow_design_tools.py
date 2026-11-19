"""Form workflow design tools using the same definition and publication services as the editor."""

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, ValidationError
from sqlalchemy import select

from app.core.principal import current_tenant_id, ensure_admin
from app.models.relational import Form, FormField, WorkflowBinding, WorkflowDef
from app.services.field_uniqueness import lock
from app.services.form_versions import preview_form_publish, publish_form
from app.services.workflow_approvals import _resolve_step_approver_ids
from app.services.workflow_definitions import WorkflowDefCreate, stage_workflow_definition, update_workflow_definition
from app.services.workflow_routing import _condition, validate_graph
from app.services.workflow_views import STARTABLE_DEFINITION_STATUSES, _definition_config, _workflow_config_steps

from .application_admin_tools import _snapshot_digest


Key = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Port = Literal["top", "bottom", "left", "right"]
GET = "forms.get_workflow_design"
VALIDATE = "forms.validate_workflow_design"
SAVE = "forms.save_workflow_draft"
PUBLISH = "forms.publish_workflow_draft"
WRITE_TOOLS = {SAVE, PUBLISH}
SNAPSHOT_FIELD = "_workflow_design_snapshot"
SKILL = "low_code.manage_workflow_design"


class FormRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    form_id: int = Field(gt=0)


class DefinitionRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(gt=0)
    version: int = Field(gt=0)


class AssigneeRule(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Key
    type: Literal["user", "role", "organization", "field", "departmentOwner", "initiatorManager"]
    value: Key | None = None
    scope: Literal["self", "children"] | None = None
    approvalMode: Literal["single", "orSign", "countersign"] | None = None


class CcRecipient(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Key
    type: Literal["user", "role"]
    value: Key


class FieldMapping(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Key
    sourceField: Key | None = None
    targetField: Key | None = None


class ExternalAction(BaseModel):
    model_config = ConfigDict(extra="allow")
    enabled: bool
    action: Literal["form", "api", "webhook", "message"] | None = None
    targetFormId: int | None = Field(default=None, gt=0)
    endpoint: str | None = None
    system: str | None = None
    fieldMappings: list[FieldMapping] | None = Field(default=None, max_length=100)


class WorkflowNode(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Key
    type: Literal["startEvent", "endEvent", "userTask", "serviceTask", "ccTask", "exclusiveGateway"]
    label: Key
    x: FiniteFloat = Field(ge=0)
    y: FiniteFloat = Field(ge=0)
    assigneeSource: Literal["fixed", "role", "departmentOwner", "initiatorManager", "field"] | None = None
    assigneeValue: str | None = None
    assigneeRules: list[AssigneeRule] | None = None
    rejectionTargetId: Key | None = None
    ccRecipients: list[CcRecipient] | None = None
    fieldPermissions: dict[str, dict] | None = None
    externalAction: ExternalAction | None = None


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: FiniteFloat
    y: FiniteFloat


class WorkflowEdge(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Key
    source: Key
    target: Key
    sourceSide: Port = "bottom"
    targetSide: Port = "top"
    label: str = ""
    approvalOutcome: Literal["approve", "reject"] | None = None
    priority: int = 999
    isDefault: bool = False
    conditionField: Key | None = None
    conditionOperator: Key | None = None
    conditionValue: str | int | FiniteFloat | bool | None = None
    waypoints: list[Point] | None = None
    routeY: FiniteFloat | None = None


class AnnotationSize(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width: FiniteFloat = Field(gt=0)
    height: FiniteFloat = Field(gt=0)


class WorkflowAnnotation(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Key
    nodeIds: list[Key] = Field(min_length=1, max_length=1000)
    title: str = Field(max_length=80)
    color: str = Field(default="#527d9b", pattern=r"^#[0-9a-fA-F]{6}$")
    titleStyle: dict | None = None
    frameStyle: dict | None = None
    size: AnnotationSize | None = None


class WorkflowTrigger(BaseModel):
    model_config = ConfigDict(extra="allow")
    action: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
    label: str = Field(default="", max_length=200)
    enabled: bool
    startNodeId: Key | None = None


class WorkflowDesign(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: Key
    nodes: list[WorkflowNode] = Field(max_length=1000)
    edges: list[WorkflowEdge] = Field(max_length=4000)
    triggerBindings: list[WorkflowTrigger]
    annotations: list[WorkflowAnnotation] | None = None


class DesignRequest(FormRequest):
    design: WorkflowDesign


class SaveRequest(DesignRequest):
    expected_definition: DefinitionRevision | None = Field(description="填写读取工具返回的 revision。表单当前无流程时传 null。")


class PublishRequest(FormRequest):
    expected_definition: DefinitionRevision


REQUESTS = {GET: FormRequest, VALIDATE: DesignRequest, SAVE: SaveRequest, PUBLISH: PublishRequest}
DETAILS = {
    GET: ("读取表单流程设计", "读取表单流程草稿、已发布流程或当前绑定的流程，以及可用触发动作和版本。"),
    VALIDATE: ("校验表单流程设计", "只读校验流程结构、触发入口、审批处理对象可用性、抄送配置及注释引用。"),
    SAVE: ("保存表单流程草稿", "用完整设计保存流程草稿，保留节点坐标、拐点、注释和入口配置。需要当前流程版本及用户确认。"),
    PUBLISH: ("发布表单流程草稿", "按已复核的草稿 ID 和版本发布表单配置及流程入口。需要单独确认。"),
}


def registry_definitions():
    return {
        name: {
            "name": name, "title": DETAILS[name][0], "description": DETAILS[name][1], "handler_key": name,
            "side_effect": "configuration_write" if name in WRITE_TOOLS else "read",
            "risk_level": "high" if name in WRITE_TOOLS else "low",
            "input_schema": request.model_json_schema(), "permission_check": "config", "domain": "low-code",
            "dry_run_supported": False, "audit_required": name in WRITE_TOOLS,
        }
        for name, request in REQUESTS.items()
    }


def _trigger_action(form):
    return "manual_submit" if form.code == "material-application" else "submit"


async def _get_form_and_definition(db, tenant_id, form_id, *, for_update=False):
    form_query = select(Form).where(Form.tenant_id == tenant_id, Form.id == form_id)
    form = await db.scalar(form_query.with_for_update() if for_update else form_query)
    if form is None:
        raise HTTPException(404, "未找到目标表单")
    config = form.config or {}
    if config.get("kind") == "analysis":
        raise HTTPException(422, "请选择支持流程的业务表单")
    meta = config.get("workflowDesigner") or {}
    if not isinstance(meta, dict):
        raise HTTPException(409, "表单流程元数据无效，请在设计器中检查")
    definition_id = meta.get("draftWorkflowId") or meta.get("publishedWorkflowId")
    if definition_id is None:
        definition_id = await db.scalar(select(WorkflowBinding.workflow_id).where(
            WorkflowBinding.tenant_id == tenant_id, WorkflowBinding.form_id == form_id,
            WorkflowBinding.enabled.is_(True), WorkflowBinding.trigger_action == _trigger_action(form),
        ).order_by(WorkflowBinding.id).limit(1))
    definition = None
    if definition_id is not None:
        query = select(WorkflowDef).where(WorkflowDef.id == definition_id, WorkflowDef.tenant_id == tenant_id)
        definition = await db.scalar(query.with_for_update() if for_update else query)
        if definition is None:
            raise HTTPException(409, "当前表单引用的流程定义不存在，请核对流程配置")
    return form, meta, definition


def _revision(definition):
    return {"id": definition.id, "version": int(definition.version or 1)} if definition is not None else None


def _require_revision(definition, expected):
    if _revision(definition) != (expected.model_dump() if expected is not None else None):
        raise HTTPException(409, "流程已更新，请重新读取设计后再操作")


def _check_design(config, form):
    if config.get("steps"):
        raise HTTPException(422, "请用 nodes 和 edges 表达流程设计")
    validate_graph(config, require_cc_recipients=True)
    for collection, label in (("edges", "连线"), ("annotations", "注释")):
        ids = [item["id"] for item in config.get(collection) or []]
        if len(ids) != len(set(ids)):
            raise HTTPException(422, f"{label}标识必须唯一")
    nodes = {node["id"]: node for node in config["nodes"]}
    for annotation in config.get("annotations") or []:
        ids = set(annotation["nodeIds"])
        if len(ids) != len(annotation["nodeIds"]) or ids - nodes.keys():
            raise HTTPException(422, f"注释「{annotation['title']}」包含无效的成员节点")
    actions = [trigger["action"] for trigger in config["triggerBindings"]]
    if len(actions) != len(set(actions)):
        raise HTTPException(422, "表单触发动作必须唯一")
    enabled = [trigger for trigger in config["triggerBindings"] if trigger["enabled"]]
    if {trigger["action"] for trigger in enabled} != {_trigger_action(form)}:
        raise HTTPException(422, f"请在开始节点启用 {_trigger_action(form)} 触发动作")
    for trigger in enabled:
        start = trigger.get("startNodeId")
        if start is not None and nodes.get(start, {}).get("type") != "startEvent":
            raise HTTPException(422, "触发动作必须绑定开始事件")
    outgoing = {}
    connected = set()
    for edge in config["edges"]:
        _condition(edge)
        outgoing.setdefault(edge["source"], []).append(edge)
        connected.update((edge["source"], edge["target"]))
    for node_id, node in nodes.items():
        label = node["label"]
        kind = node["type"]
        for rows in (node.get("assigneeRules"), node.get("ccRecipients"), (node.get("externalAction") or {}).get("fieldMappings")):
            if rows and len({row["id"] for row in rows}) != len(rows):
                raise HTTPException(422, f"节点「{label}」的处理人、抄送或映射标识重复")
        if kind not in ("startEvent", "endEvent") and node_id not in connected:
            raise HTTPException(422, f"节点「{label}」尚未连入流程")
        if kind == "userTask":
            rules = node.get("assigneeRules") or []
            incomplete = any(rule.get("type") not in ("departmentOwner", "initiatorManager")
                             and not str(rule.get("value") or "").strip() for rule in rules)
            if incomplete or (not rules and not (node.get("assigneeSource") and node.get("assigneeValue"))):
                raise HTTPException(422, f"审批节点「{label}」缺少处理人")
        if kind == "exclusiveGateway":
            routes = outgoing.get(node_id, [])
            if len(routes) < 2 or any(not edge.get("isDefault") and not _condition(edge) for edge in routes):
                raise HTTPException(422, f"条件网关「{label}」需要至少两条分支，并为非默认分支配置条件")


async def _check_approvers(db, tenant_id, config):
    for step in _workflow_config_steps(config):
        if step["type"] != "approval":
            continue
        rules = step.get("assignee_rules") or []
        fixed = [(index, rule) for index, rule in enumerate(rules, 1)
                 if rule.get("type") in {"role", "user", "fixed", "organization"}]
        if not fixed:
            continue

        # Approval groups require an approver in every group. Older node-wide rules
        # can resolve an approver from any rule, including a record-dependent rule.
        grouped = any("approvalMode" in rule or "approval_mode" in rule for rule in rules)
        if not grouped and len(fixed) != len(rules):
            continue
        if grouped:
            checks = [(f"第 {index} 个处理对象「{rule.get('value') or ''}」", [rule]) for index, rule in fixed]
        else:
            names = "、".join(str(rule.get("value") or "") for _, rule in fixed)
            checks = [(f"处理对象「{names}」", rules)]
        for label, candidates in checks:
            try:
                members = await _resolve_step_approver_ids(
                    db, tenant_id, {"assignee_rules": candidates, "approval_mode": step.get("approval_mode")},
                    {}, {}, None, None, allow_fallback=False,
                )
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise
                members = []
            if not members:
                raise HTTPException(422, f"审批节点「{step['name']}」的{label}没有有效审批人")


async def _validate_design(db, form, config):
    _check_design(config, form)
    await _check_approvers(db, form.tenant_id, config)


async def _validation(db, config, form):
    try:
        await _validate_design(db, form, config)
    except HTTPException as exc:
        return {"valid": False, "issues": [str(exc.detail)]}
    return {"valid": True, "issues": []}


def _design_payload(design):
    try:
        return WorkflowDesign.model_validate(design).model_dump(exclude_unset=True)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc


async def _save(db, form, meta, definition, config, user):
    fields = (await db.scalars(select(FormField).where(
        FormField.tenant_id == form.tenant_id, FormField.form_id == form.id,
    ).order_by(FormField.sort_order, FormField.id))).all()
    body = WorkflowDefCreate(
        name=config["name"], status="draft",
        config={**config, "formId": form.id, "formCode": form.code, "formName": form.name,
                "savedAt": datetime.now(timezone.utc).isoformat()},
        form_config={"formCode": form.code, "formName": form.name, "fields": [
            {"name": field.field_name, "label": field.label, "type": field.field_type, "required": field.required,
             "sortOrder": field.sort_order} for field in fields if not field.archived
        ]},
    )
    if (definition is not None and definition.status == "draft" and meta.get("draftWorkflowId") == definition.id
            and _definition_config(definition).get("formId") == form.id):
        update_workflow_definition(db, definition, body, user)
    else:
        definition = await stage_workflow_definition(db, body, user)
    form.config = {**(form.config or {}), "workflowDesigner": {**meta, "draftWorkflowId": definition.id}}
    result = {"form_id": form.id, "status": "draft", "revision": _revision(definition)}
    await db.commit()
    return {"data": result}


async def execute_workflow_design_tool(operation, db, *, user, payload, prepare=False):
    ensure_admin(user)
    try:
        arguments = payload if prepare or operation not in WRITE_TOOLS else {
            key: value for key, value in payload.items() if key not in {SNAPSHOT_FIELD, "_preview"}
        }
        request = REQUESTS[operation].model_validate(arguments)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    tenant_id = current_tenant_id(user)
    writing = not prepare and operation in WRITE_TOOLS
    if writing:
        await lock(db, tenant_id)
    form, meta, definition = await _get_form_and_definition(db, tenant_id, request.form_id, for_update=writing)
    if operation == GET:
        published_id = meta.get("publishedWorkflowId")
        if published_id is None and definition and definition.status in STARTABLE_DEFINITION_STATUSES:
            published_id = definition.id
        return {"data": {"form_id": form.id, "form_code": form.code, "form_name": form.name,
                         "revision": _revision(definition), "status": definition.status if definition else None,
                         "published_definition_id": published_id,
                         "trigger_action": _trigger_action(form), "design": _definition_config(definition)}}
    if operation == VALIDATE:
        return {"data": await _validation(db, request.design.model_dump(exclude_unset=True), form)}
    _require_revision(definition, request.expected_definition)
    arguments = request.model_dump(exclude_unset=True)
    snapshot = {"operation": operation, "tenant_id": tenant_id, "form": form.name, "arguments": arguments}
    if operation == PUBLISH:
        snapshot["form_config"] = form.config
    digest = _snapshot_digest(snapshot)
    if writing and payload.get(SNAPSHOT_FIELD) != digest:
        raise HTTPException(409, "流程或表单配置已变化，请重新确认")

    if operation == SAVE:
        config = request.design.model_dump(exclude_unset=True)
        await _validate_design(db, form, config)
        if writing:
            return await _save(db, form, meta, definition, config, user)
    else:
        if definition is None or definition.status != "draft" or meta.get("draftWorkflowId") != definition.id:
            raise HTTPException(409, "请先保存并复核此表单的流程草稿")
        config = _design_payload(_definition_config(definition))
        await _validate_design(db, form, config)
        if writing:
            published = await publish_form(form.id, db, user, workflow_draft_id=request.expected_definition.id,
                                           workflow_draft_version=request.expected_definition.version)
            return {"data": {**published["data"], "workflow_status": "published", "workflow_revision": {
                "id": request.expected_definition.id, "version": request.expected_definition.version + 1,
            }}}
        report = (await preview_form_publish(form.id, db, user))["data"]
        if report["blocking_count"]:
            raise HTTPException(409, {"message": "表单发布检查未通过", "report": report})

    return {**arguments, SNAPSHOT_FIELD: digest, "_preview": {"target": form.name, "fields": {
        "流程": config["name"],
        "设计": f"{len(config['nodes'])} 个节点、{len(config['edges'])} 条连线、{len(config.get('annotations') or [])} 个注释",
        "触发入口": _trigger_action(form),
        "操作": "保存流程草稿" if operation == SAVE else "发布流程及当前表单配置",
    }}}
