"""Workflow Engine API — definition CRUD, instance lifecycle, step-based execution, notifications."""

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

router = APIRouter()

from app.api.deps import current_tenant_id, current_user_id, get_current_user
from app.config import settings
from app.core.audit import write_audit_log
from app.core.permissions import allowed_form_fields, has_form_permission


# ── Schemas ───────────────────────────────────────────────

class WorkflowDefCreate(BaseModel):
    name: str
    description: Optional[str] = None
    config: Optional[dict] = None
    form_config: Optional[dict] = None
    status: Optional[str] = None
    steps: Optional[list] = None  # [{name, type, assignee_role, condition_config}]


class WorkflowStartRequest(BaseModel):
    title: str
    form_data: Optional[dict] = None
    resource_type: Optional[str] = None
    resource_id: Optional[int] = None
    variables: Optional[dict] = None


class ApprovalAction(BaseModel):
    action: str  # approve / reject
    comment: Optional[str] = None


class StepApprovalRequest(BaseModel):
    """Request body for approve/reject current step."""
    comment: Optional[str] = None
    user_id: int = 1


# ── Mock data ─────────────────────────────────────────────

_MOCK_WORKFLOWS = [
    {
        "id": 1, "name": "设备维修审批", "description": "设备故障维修工单审批流程",
        "config": {
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 100, "y": 50}, "data": {"label": "发起申请"}},
                {"id": "review", "type": "approval", "position": {"x": 300, "y": 50}, "data": {"label": "生产主管审批", "approver_role": "production_manager"}},
                {"id": "end-approve", "type": "end", "position": {"x": 500, "y": 0}, "data": {"label": "通过"}},
                {"id": "end-reject", "type": "end", "position": {"x": 500, "y": 100}, "data": {"label": "驳回"}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "review"},
                {"id": "e2", "source": "review", "target": "end-approve", "label": "通过"},
                {"id": "e3", "source": "review", "target": "end-reject", "label": "驳回"},
            ],
        },
        "steps": [
            {"name": "提交维修单", "type": "start"},
            {"name": "主管审批", "type": "approval", "assignee_role": "production_manager"},
            {"name": "执行维修", "type": "notification"},
            {"name": "完成", "type": "end"},
        ],
        "form_config": {
            "fields": [
                {"name": "equipment_name", "label": "设备名称", "type": "string", "required": True},
                {"name": "fault_desc", "label": "故障描述", "type": "text", "required": True},
                {"name": "urgency", "label": "紧急程度", "type": "enum", "options": ["低", "中", "高"]},
            ],
        },
        "status": "published", "version": 1,
    },
    {
        "id": 2, "name": "质量异常处理", "description": "质量异常上报与处理审批",
        "config": {
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 100, "y": 50}, "data": {"label": "上报异常"}},
                {"id": "qc-review", "type": "approval", "position": {"x": 300, "y": 50}, "data": {"label": "质检主管审批", "approver_role": "quality_inspector"}},
                {"id": "end", "type": "end", "position": {"x": 500, "y": 50}, "data": {"label": "结束"}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "qc-review"},
                {"id": "e2", "source": "qc-review", "target": "end"},
            ],
        },
        "steps": [
            {"name": "上报异常", "type": "start"},
            {"name": "质检主管审批", "type": "approval", "assignee_role": "quality_inspector"},
            {"name": "结束", "type": "end"},
        ],
        "form_config": {
            "fields": [
                {"name": "defect_type", "label": "缺陷类型", "type": "string", "required": True},
                {"name": "severity", "label": "严重程度", "type": "enum", "options": ["轻微", "一般", "严重"]},
            ],
        },
        "status": "published", "version": 1,
    },
    {
        "id": 3, "name": "物料采购审批", "description": "物料采购申请审批流程",
        "config": {
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 100, "y": 50}, "data": {"label": "提交采购申请"}},
                {"id": "mgr-review", "type": "approval", "position": {"x": 300, "y": 0}, "data": {"label": "部门经理审批", "approver_role": "dept_manager"}},
                {"id": "fin-review", "type": "approval", "position": {"x": 500, "y": 0}, "data": {"label": "财务审批", "approver_role": "finance"}},
                {"id": "end", "type": "end", "position": {"x": 700, "y": 50}, "data": {"label": "完成"}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "mgr-review"},
                {"id": "e2", "source": "mgr-review", "target": "fin-review", "label": "通过"},
                {"id": "e3", "source": "fin-review", "target": "end", "label": "通过"},
            ],
        },
        "steps": [
            {"name": "提交采购申请", "type": "start"},
            {"name": "部门经理审批", "type": "approval", "assignee_role": "dept_manager"},
            {"name": "财务审批", "type": "approval", "assignee_role": "finance"},
            {"name": "完成", "type": "end"},
        ],
        "form_config": {
            "fields": [
                {"name": "material_name", "label": "物料名称", "type": "string", "required": True},
                {"name": "quantity", "label": "数量", "type": "number", "required": True},
                {"name": "budget", "label": "预算金额", "type": "number"},
            ],
        },
        "status": "published", "version": 1,
    },
]

_MOCK_INSTANCES = [
    {
        "id": 1, "workflow_id": 1, "title": "CNC加工中心主轴异响维修",
        "initiator_id": 2, "initiator_name": "张三",
        "status": "pending", "current_step": 1,
        "resource_type": "work_orders", "resource_id": 5,
        "variables": json.dumps({"equipment": "CNC-001", "reason": "健康分过低"}),
        "form_data": json.dumps({"equipment_name": "CNC加工中心-01", "fault_desc": "主轴运行时异响", "urgency": "高"}),
        "workflow_state": json.dumps({"current_node": "review", "current_step": 1}),
        "created_at": "2026-05-13T10:00:00",
        "updated_at": "2026-05-13T10:00:00",
        "approvals": [
            {"id": 1, "node_id": "review", "approver_id": 2, "action": None, "comment": None, "acted_at": None, "step_index": 1},
        ],
    },
    {
        "id": 2, "workflow_id": 2, "title": "焊接工序气孔缺陷处理",
        "initiator_id": 3, "initiator_name": "李四",
        "status": "approved", "current_step": 2,
        "resource_type": "inspections", "resource_id": 10,
        "variables": json.dumps({"defect_type": "气孔", "severity": "一般"}),
        "form_data": json.dumps({"defect_type": "气孔", "severity": "一般"}),
        "workflow_state": json.dumps({"current_node": "end", "current_step": 2}),
        "created_at": "2026-04-21T14:00:00",
        "updated_at": "2026-04-21T15:30:00",
        "approvals": [
            {"id": 2, "node_id": "qc-review", "approver_id": 3, "action": "approve", "comment": "已确认处理", "acted_at": "2026-04-21T15:30:00", "step_index": 1},
        ],
    },
    {
        "id": 3, "workflow_id": 3, "title": "Q3钢材采购申请",
        "initiator_id": 4, "initiator_name": "王五",
        "status": "pending", "current_step": 2,
        "resource_type": "materials", "resource_id": 7,
        "variables": json.dumps({"material": "45号钢", "quantity": 500}),
        "form_data": json.dumps({"material_name": "45号钢", "quantity": 500, "budget": 25000}),
        "workflow_state": json.dumps({"current_node": "fin-review", "current_step": 2}),
        "created_at": "2026-05-12T09:00:00",
        "updated_at": "2026-05-12T11:00:00",
        "approvals": [
            {"id": 3, "node_id": "mgr-review", "approver_id": 4, "action": "approve", "comment": "同意采购", "acted_at": "2026-05-12T11:00:00", "step_index": 1},
            {"id": 4, "node_id": "fin-review", "approver_id": 5, "action": None, "comment": None, "acted_at": None, "step_index": 2},
        ],
    },
]

_MOCK_NOTIFICATIONS = [
    {"id": 1, "user_id": 2, "title": "待审批：CNC加工中心主轴异响维修",
     "content": "张三提交了设备维修审批，请尽快处理", "type": "approval",
     "is_read": False, "link": "/workflow/my-approvals",
     "created_at": "2026-05-13T10:00:00"},
    {"id": 2, "user_id": 3, "title": "您的申请已通过",
     "content": "质量异常处理申请「焊接工序气孔缺陷处理」已审批通过", "type": "info",
     "is_read": True, "link": "/workflow/my-applications",
     "created_at": "2026-04-21T15:30:00"},
    {"id": 3, "user_id": 5, "title": "待审批：Q3钢材采购申请",
     "content": "王五提交了物料采购申请，请尽快审批", "type": "approval",
     "is_read": False, "link": "/workflow/my-approvals",
     "created_at": "2026-05-12T11:00:00"},
]

_wf_id_counter = 20
_inst_id_counter = 20
_notif_id_counter = 20
_approval_id_counter = 20


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── Helper: resolve steps from a workflow definition ──────

def _get_steps_from_workflow(wf_def: dict) -> list[dict]:
    """Extract ordered step list from a workflow definition.

    Steps can come from:
    1. The top-level ``steps`` key (simple linear flow), or
    2. The ``config.nodes`` key (visual flow designer format).
    """
    # Prefer top-level steps
    if wf_def.get("steps"):
        return wf_def["steps"]

    # Fall back to extracting from config.nodes (skip start/end)
    config = wf_def.get("config", {})
    nodes = config.get("nodes", [])
    edges = config.get("edges", [])

    node_by_id = {node.get("id"): node for node in nodes if node.get("id")}

    def _node_type(node: dict) -> str:
        raw_type = node.get("type") or node.get("data", {}).get("type") or ""
        mapping = {
            "startEvent": "start",
            "endEvent": "end",
            "userTask": "approval",
            "manualTask": "approval",
            "serviceTask": "notification",
            "ccTask": "notification",
            "exclusiveGateway": "condition",
            "parallelGateway": "condition",
            "joinGateway": "condition",
        }
        return mapping.get(raw_type, raw_type)

    def _node_label(node: dict) -> str:
        return node.get("label") or node.get("data", {}).get("label") or node.get("id", "节点")

    def _node_assignee(node: dict) -> Optional[str]:
        return (
            node.get("assigneeValue")
            or node.get("assignee_role")
            or node.get("data", {}).get("approver_role")
            or node.get("data", {}).get("assignee_role")
        )

    def _node_assignee_rules(node: dict) -> list[dict]:
        rules = node.get("assigneeRules") or node.get("assignee_rules") or node.get("data", {}).get("assigneeRules")
        if isinstance(rules, list) and rules:
            return [rule for rule in rules if isinstance(rule, dict)]
        assignee = _node_assignee(node)
        if assignee:
            source = node.get("assigneeSource") or node.get("assigneeType") or "role"
            rule_type = "user" if source == "fixed" else source
            return [{"id": f"{node.get('id', 'node')}-assignee", "type": rule_type, "value": assignee}]
        return []

    def _edge_source(edge: dict) -> Optional[str]:
        return edge.get("source") or edge.get("fromId")

    def _edge_target(edge: dict) -> Optional[str]:
        return edge.get("target") or edge.get("toId")

    # Build adjacency from edges. Multiple outgoing edges are sorted so graph
    # execution has deterministic behavior before expression evaluation exists.
    edge_map: dict[str, list[dict]] = {}
    for edge in edges:
        source = _edge_source(edge)
        target = _edge_target(edge)
        if not source or not target:
            continue
        edge_map.setdefault(source, []).append(edge)
    for outgoing in edge_map.values():
        outgoing.sort(key=lambda edge: (not bool(edge.get("isDefault")), edge.get("priority", 999), edge.get("id", "")))

    # Find the start node and walk the chain
    start_id = None
    for node in nodes:
        if _node_type(node) == "start":
            start_id = node["id"]
            break

    if not start_id:
        # No start node; return nodes in order
        return [
            {"name": _node_label(n), "type": _node_type(n),
             "assignee_role": _node_assignee(n)}
            for n in nodes
        ]

    ordered = []
    visited = set()
    queue = [start_id]
    while queue:
        current = queue.pop(0)
        if not current or current in visited:
            continue
        visited.add(current)
        node = node_by_id.get(current)
        if not node:
            continue
        step = {
            "name": _node_label(node),
            "type": _node_type(node),
            "node_id": node["id"],
        }
        assignee = _node_assignee(node)
        if assignee:
            step["assignee_role"] = assignee
        assignee_rules = _node_assignee_rules(node)
        if assignee_rules:
            step["assignee_rules"] = assignee_rules
        if node.get("fieldPermissions"):
            step["field_permissions"] = node["fieldPermissions"]
        if node.get("approvalMode"):
            step["approval_mode"] = node["approvalMode"]
        ordered.append(step)
        for edge in edge_map.get(current, []):
            target = _edge_target(edge)
            if target and target not in visited:
                queue.append(target)

    return ordered


def _find_first_approval_step(steps: list[dict]) -> int:
    """Return the index of the first approval-type step, or 0 if none."""
    for i, step in enumerate(steps):
        if step.get("type") == "approval":
            return i
    return 0


def _find_next_actionable_step(steps: list[dict], current_step: int) -> Optional[int]:
    """Return the index of the next actionable step (approval) after current_step.

    Non-actionable steps (notification, condition) are auto-advanced past.
    Returns None if no more actionable steps remain.
    """
    for i in range(current_step + 1, len(steps)):
        step_type = steps[i].get("type")
        if step_type == "approval":
            return i
        # notification and condition steps are auto-advanced — skip them
        # but we still record them as visited for state tracking
    return None


def _workflow_config_steps(config: dict) -> list[dict]:
    """Resolve runtime steps from either simple steps or visual designer config."""
    return _get_steps_from_workflow({"steps": config.get("steps") or [], "config": config})


def _append_unique_ids(target: list[int], values: list[int]) -> None:
    seen = set(target)
    for value in values:
        if value and value not in seen:
            target.append(value)
            seen.add(value)


async def _resolve_users_by_token(db, tenant_id: int, token: Any) -> list[int]:
    """Resolve a user token from id / username / display name / email."""
    from app.models.relational import User

    if token is None or token == "":
        return []
    if isinstance(token, list):
        result: list[int] = []
        for item in token:
            _append_unique_ids(result, await _resolve_users_by_token(db, tenant_id, item))
        return result
    token_text = str(token).strip()
    if not token_text:
        return []
    filters = [User.tenant_id == tenant_id, User.is_active == True]
    if token_text.isdigit():
        user = await db.scalar(select(User).where(*filters, User.id == int(token_text)))
        return [user.id] if user else []
    rows = (await db.execute(
        select(User.id).where(
            *filters,
            (User.username == token_text) | (User.display_name == token_text) | (User.email == token_text),
        )
    )).scalars().all()
    return [int(row) for row in rows]


async def _resolve_users_by_role(db, tenant_id: int, role_value: Any) -> list[int]:
    from app.models.relational import Role, User, UserRole

    if not role_value:
        return []
    role_text = str(role_value).strip()
    rows = (await db.execute(
        select(User.id)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            User.tenant_id == tenant_id,
            User.is_active == True,
            UserRole.tenant_id == tenant_id,
            Role.tenant_id == tenant_id,
            (Role.name == role_text) | (Role.label == role_text),
        )
        .order_by(User.id)
    )).scalars().all()
    return [int(row) for row in rows]


async def _resolve_users_by_org(db, tenant_id: int, org_value: Any, include_children: bool = False) -> list[int]:
    from app.models.relational import OrgUnit, User, UserOrgMembership

    if not org_value:
        return []
    org_text = str(org_value).strip()
    org_filters = [OrgUnit.tenant_id == tenant_id]
    if org_text.isdigit():
        org_filter = OrgUnit.id == int(org_text)
    else:
        org_filter = (OrgUnit.code == org_text) | (OrgUnit.name == org_text)
    orgs = (await db.execute(select(OrgUnit).where(*org_filters, org_filter))).scalars().all()
    org_ids = [org.id for org in orgs]
    if include_children and org_ids:
        children = (await db.execute(select(OrgUnit.id).where(OrgUnit.tenant_id == tenant_id, OrgUnit.parent_id.in_(org_ids)))).scalars().all()
        org_ids.extend(int(child) for child in children)
    if not org_ids:
        return []
    rows = (await db.execute(
        select(User.id)
        .join(UserOrgMembership, UserOrgMembership.user_id == User.id)
        .where(
            User.tenant_id == tenant_id,
            User.is_active == True,
            UserOrgMembership.tenant_id == tenant_id,
            UserOrgMembership.org_unit_id.in_(org_ids),
        )
        .order_by(User.id)
    )).scalars().all()
    return [int(row) for row in rows]


async def _resolve_initiator_org_users(db, tenant_id: int, initiator_id: int | None) -> list[int]:
    from app.models.relational import OrgUnit, UserOrgMembership

    if not initiator_id:
        return []
    membership = await db.scalar(
        select(UserOrgMembership).where(
            UserOrgMembership.tenant_id == tenant_id,
            UserOrgMembership.user_id == initiator_id,
        ).order_by(UserOrgMembership.is_primary.desc(), UserOrgMembership.id)
    )
    if not membership:
        return []
    org = await db.get(OrgUnit, membership.org_unit_id)
    if not org:
        return []
    return await _resolve_users_by_org(db, tenant_id, org.code or org.id)


async def _resolve_step_approver_ids(
    db,
    tenant_id: int,
    step: dict,
    form_data: dict,
    variables: dict,
    initiator_id: int | None,
    fallback_user_id: int | None,
) -> list[int]:
    rules = step.get("assignee_rules")
    if not isinstance(rules, list) or not rules:
        assignee_role = step.get("assignee_role")
        rules = [{"type": "role", "value": assignee_role}] if assignee_role else []

    approver_ids: list[int] = []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        rule_type = str(rule.get("type") or "role")
        value = rule.get("value")
        if rule_type == "role":
            _append_unique_ids(approver_ids, await _resolve_users_by_role(db, tenant_id, value))
        elif rule_type in {"user", "fixed"}:
            _append_unique_ids(approver_ids, await _resolve_users_by_token(db, tenant_id, value))
        elif rule_type == "organization":
            _append_unique_ids(approver_ids, await _resolve_users_by_org(db, tenant_id, value, rule.get("scope") == "children"))
        elif rule_type == "field":
            field_value = form_data.get(str(value)) if value else None
            if field_value is None and value:
                field_value = variables.get(str(value))
            _append_unique_ids(approver_ids, await _resolve_users_by_token(db, tenant_id, field_value))
        elif rule_type == "departmentOwner":
            _append_unique_ids(approver_ids, await _resolve_initiator_org_users(db, tenant_id, initiator_id))
        elif rule_type == "initiatorManager":
            # No manager hierarchy exists yet; keep the workflow actionable by routing to initiator.
            if initiator_id:
                _append_unique_ids(approver_ids, [initiator_id])

    if not approver_ids and fallback_user_id:
        _append_unique_ids(approver_ids, [fallback_user_id])
    if not approver_ids and initiator_id:
        _append_unique_ids(approver_ids, [initiator_id])
    return approver_ids


def _set_current_assignees(state: dict, approver_ids: list[int]) -> None:
    state["current_assignee_ids"] = approver_ids
    state["current_assignee_id"] = approver_ids[0] if approver_ids else None


def _add_approval_notifications(db, tenant_id: int, approver_ids: list[int], title: str, instance_id: int) -> None:
    from app.models.relational import Notification

    for approver_id in approver_ids:
        db.add(Notification(
            tenant_id=tenant_id,
            user_id=approver_id,
            title=f"待审批：{title}",
            content="您有一条新的工作流审批待处理",
            type="approval",
            is_read=False,
            resource_type="workflow_instance",
            resource_id=instance_id,
            link="/workflow/my-approvals",
        ))


def _is_last_step(steps: list[dict], current_step: int) -> bool:
    """Check if current_step is the last actionable step (before end)."""
    for i in range(current_step + 1, len(steps)):
        if steps[i].get("type") not in ("end",):
            return False
    return True


def _get_mock_workflow_by_id(wf_id: int) -> Optional[dict]:
    for wf in _MOCK_WORKFLOWS:
        if wf["id"] == wf_id:
            return wf
    return None


def _get_mock_instance_by_id(inst_id: int) -> Optional[dict]:
    for inst in _MOCK_INSTANCES:
        if inst["id"] == inst_id:
            return inst
    return None


WORKFLOW_VIEW_STATUSES = {"draft", "pending", "running", "done", "returned"}
RECORD_STATUS_TO_VIEW_TAB = {
    "draft": "draft",
    "pending": "pending",
    "submitted": "pending",
    "reviewing": "pending",
    "running": "running",
    "in_progress": "running",
    "processing": "running",
    "approved": "done",
    "done": "done",
    "completed": "done",
    "closed": "done",
    "returned": "returned",
    "rejected": "returned",
}


def _safe_json(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default


def _workflow_view_status(raw_status: Optional[str]) -> Optional[str]:
    if not raw_status:
        return None
    return RECORD_STATUS_TO_VIEW_TAB.get(str(raw_status).lower())


def _is_business_form(form) -> bool:
    config = form.config or {}
    assembly_kind = str(config.get("assemblyKind") or config.get("assembly_kind") or "").lower()
    if assembly_kind in {"analysis", "dashboard", "bi"}:
        return False
    return True


def _field_summary(fields: list, data: dict, *, limit: int = 4) -> list[dict]:
    values: list[dict] = []
    ordered_fields = sorted(
        [field for field in fields if not getattr(field, "archived", False)],
        key=lambda field: (getattr(field, "sort_order", 0), getattr(field, "id", 0)),
    )
    for field in ordered_fields:
        field_name = getattr(field, "field_name", "")
        if not field_name:
            continue
        value = data.get(field_name)
        if value in (None, "") and len(values) >= limit:
            continue
        values.append({
            "field_name": field_name,
            "label": getattr(field, "label", None) or field_name,
            "value": value,
            "field_type": getattr(field, "field_type", "string"),
        })
        if len(values) >= limit:
            break
    return values


def _record_title(form, fields: list, data: dict, record_id: int) -> str:
    for field in sorted(fields, key=lambda item: (getattr(item, "sort_order", 0), getattr(item, "id", 0))):
        field_name = getattr(field, "field_name", "")
        if not field_name:
            continue
        value = data.get(field_name)
        if value not in (None, ""):
            return f"{form.name} - {value}"
    return f"{form.name} - #{record_id}"


def _record_summary(fields: list, data: dict) -> str:
    parts = []
    for item in _field_summary(fields, data, limit=5):
        value = item.get("value")
        if value in (None, ""):
            continue
        parts.append(f"{item['label']}：{value}")
    return "；".join(parts) if parts else "暂无已填写字段"


async def _workflow_business_dataset(db, user: dict) -> dict:
    from app.models.relational import (
        Application,
        ApplicationForm,
        DynamicRecord,
        Form,
        FormField,
        WorkflowApproval,
        WorkflowDef,
        WorkflowInstance,
    )

    tenant_id = current_tenant_id(user)
    form_rows = (await db.execute(
        select(Form, Application)
        .outerjoin(
            ApplicationForm,
            (ApplicationForm.form_id == Form.id)
            & (ApplicationForm.tenant_id == tenant_id)
            & (ApplicationForm.enabled.is_(True)),
        )
        .outerjoin(
            Application,
            (Application.id == ApplicationForm.application_id)
            & (Application.tenant_id == tenant_id),
        )
        .where(Form.tenant_id == tenant_id)
        .order_by(Form.created_at.desc(), Form.id.desc())
    )).all()

    forms_by_id: dict[int, Any] = {}
    applications_by_form: dict[int, list[dict]] = {}
    for form, app in form_rows:
        if not _is_business_form(form):
            continue
        if not user.get("is_admin") and not await has_form_permission(user, form.id, "view", db):
            continue
        forms_by_id[form.id] = form
        if app:
            applications_by_form.setdefault(form.id, [])
            if not any(existing["id"] == app.id for existing in applications_by_form[form.id]):
                applications_by_form[form.id].append({
                    "id": app.id,
                    "name": app.name,
                    "code": app.code,
                    "default_route": app.default_route,
                })

    if not forms_by_id:
        return {"applications": [], "forms": [], "items": []}

    field_rows = (await db.execute(
        select(FormField)
        .where(FormField.tenant_id == tenant_id, FormField.form_id.in_(forms_by_id.keys()))
        .order_by(FormField.form_id, FormField.sort_order, FormField.id)
    )).scalars().all()
    fields_by_form: dict[int, list] = {}
    for field in field_rows:
        fields_by_form.setdefault(field.form_id, []).append(field)

    visible_fields_by_form: dict[int, list] = {}
    for form_id, fields in fields_by_form.items():
        visible_names = await allowed_form_fields(user, form_id, "view", fields, db)
        visible_fields_by_form[form_id] = [field for field in fields if field.field_name in visible_names]

    applications: dict[int, dict] = {}
    for apps in applications_by_form.values():
        for app in apps:
            applications[app["id"]] = app

    form_payloads = []
    for form in forms_by_id.values():
        form_payloads.append({
            "id": form.id,
            "name": form.name,
            "code": form.code,
            "status": form.status,
            "applications": applications_by_form.get(form.id, []),
            "record_count": 0,
        })

    records = (await db.execute(
        select(DynamicRecord)
        .where(
            DynamicRecord.tenant_id == tenant_id,
            DynamicRecord.form_id.in_(forms_by_id.keys()),
            DynamicRecord.deleted_at.is_(None),
        )
        .order_by(DynamicRecord.updated_at.desc(), DynamicRecord.id.desc())
    )).scalars().all()

    records_by_id = {record.id: record for record in records}
    items_by_key: dict[str, dict] = {}
    record_count_by_form: dict[int, int] = {}
    for record in records:
        record_count_by_form[record.form_id] = record_count_by_form.get(record.form_id, 0) + 1
        view_status = _workflow_view_status(record.status)
        if view_status is None:
            continue
        form = forms_by_id.get(record.form_id)
        if not form:
            continue
        fields = visible_fields_by_form.get(record.form_id, [])
        data = record.data or {}
        apps = applications_by_form.get(record.form_id, [])
        primary_app = apps[0] if apps else None
        key = f"record:{record.id}"
        items_by_key[key] = {
            "id": key,
            "source": "dynamic_record",
            "status": view_status,
            "raw_status": record.status,
            "title": _record_title(form, fields, data, record.id),
            "summary": _record_summary(fields, data),
            "application": primary_app,
            "applications": apps,
            "form": {"id": form.id, "name": form.name, "code": form.code},
            "record": {
                "id": record.id,
                "status": record.status,
                "created_at": record.created_at.isoformat() if record.created_at else None,
                "updated_at": record.updated_at.isoformat() if record.updated_at else None,
            },
            "fields": _field_summary(fields, data, limit=12),
            "current_node": "未提交" if view_status == "draft" else "表单记录",
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "route_path": f"/dynamic/{form.id}?recordId={record.id}",
        }

    workflow_instances = (await db.execute(
        select(WorkflowInstance).where(WorkflowInstance.tenant_id == tenant_id).order_by(WorkflowInstance.updated_at.desc(), WorkflowInstance.id.desc())
    )).scalars().all()
    workflow_defs: dict[int, Any] = {}
    approvals_by_instance: dict[int, list] = {}
    for inst in workflow_instances:
        if inst.workflow_id not in workflow_defs:
            workflow_defs[inst.workflow_id] = await db.get(WorkflowDef, inst.workflow_id)
        approvals_by_instance[inst.id] = (await db.execute(
            select(WorkflowApproval).where(WorkflowApproval.instance_id == inst.id).order_by(WorkflowApproval.id)
        )).scalars().all()

    for inst in workflow_instances:
        view_status = _workflow_view_status(inst.status)
        if view_status is None:
            continue
        state = _safe_json(inst.workflow_state, {})
        form_data = _safe_json(inst.form_data, {})
        resource_id = state.get("resource_id")
        linked_record = records_by_id.get(resource_id) if isinstance(resource_id, int) else None
        if linked_record and linked_record.form_id in forms_by_id:
            form = forms_by_id[linked_record.form_id]
            fields = visible_fields_by_form.get(linked_record.form_id, [])
            data = linked_record.data or form_data or {}
            apps = applications_by_form.get(form.id, [])
            primary_app = apps[0] if apps else None
            key = f"record:{linked_record.id}"
        else:
            form = None
            fields = []
            data = form_data if isinstance(form_data, dict) else {}
            apps = []
            primary_app = None
            key = f"workflow:{inst.id}"
        wf_def = workflow_defs.get(inst.workflow_id)
        config = _safe_json(wf_def.config, {}) if wf_def else {}
        steps = config.get("steps") if isinstance(config, dict) else []
        current_step = state.get("current_step", 0) if isinstance(state, dict) else 0
        current_node = state.get("current_node") if isinstance(state, dict) else None
        if isinstance(steps, list) and isinstance(current_step, int) and 0 <= current_step < len(steps):
            current_node = steps[current_step].get("name") or current_node
        item = {
            "id": key,
            "source": "workflow_instance",
            "status": view_status,
            "raw_status": inst.status,
            "title": inst.title,
            "summary": _record_summary(fields, data) if fields else (wf_def.description if wf_def else "工作流实例"),
            "application": primary_app,
            "applications": apps,
            "form": {"id": form.id, "name": form.name, "code": form.code} if form else None,
            "record": {"id": linked_record.id, "status": linked_record.status} if linked_record else None,
            "workflow": {
                "id": inst.id,
                "workflow_id": inst.workflow_id,
                "initiator_id": inst.initiator_id,
                "approvals": [
                    {"id": approval.id, "node_id": approval.node_id, "approver_id": approval.approver_id,
                     "action": approval.action, "comment": approval.comment,
                     "acted_at": approval.acted_at.isoformat() if approval.acted_at else None}
                    for approval in approvals_by_instance.get(inst.id, [])
                ],
            },
            "fields": _field_summary(fields, data, limit=12) if fields else [
                {"field_name": key, "label": key, "value": value, "field_type": "string"}
                for key, value in list(data.items())[:12]
            ],
            "current_node": current_node or ("已完成" if view_status == "done" else "流程中"),
            "updated_at": inst.updated_at.isoformat() if inst.updated_at else None,
            "created_at": inst.created_at.isoformat() if inst.created_at else None,
            "route_path": f"/dynamic/{form.id}?recordId={linked_record.id}" if form and linked_record else None,
        }
        items_by_key[key] = item

    for form_payload in form_payloads:
        form_payload["record_count"] = record_count_by_form.get(form_payload["id"], 0)

    return {
        "applications": sorted(applications.values(), key=lambda app: (app.get("name") or "", app.get("id") or 0)),
        "forms": sorted(form_payloads, key=lambda item: (item.get("name") or "", item.get("id") or 0)),
        "items": sorted(items_by_key.values(), key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True),
    }


# ── Workflow Definition CRUD ─────────────────────────────

@router.get("/definitions")
async def list_definitions(user: dict = Depends(get_current_user)):
    """工作流定义列表."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        tenant_id = current_tenant_id(user)
        result = await db.execute(select(WorkflowDef).where(WorkflowDef.tenant_id == tenant_id).order_by(WorkflowDef.id))
        defs = result.scalars().all()
        return {"data": [
            {"id": d.id, "name": d.name, "description": d.description,
             "config": json.loads(d.config) if isinstance(d.config, str) else d.config,
             "form_config": json.loads(d.form_config) if isinstance(d.form_config, str) else d.form_config,
             "status": d.status, "version": d.version}
            for d in defs
        ]}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Workflow database unavailable")
    return {"data": _MOCK_WORKFLOWS}


@router.get("/definitions/{def_id}")
async def get_definition(def_id: int, user: dict = Depends(get_current_user)):
    """获取工作流定义详情."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        tenant_id = current_tenant_id(user)
        d = await db.get(WorkflowDef, def_id)
        if not d or d.tenant_id != tenant_id:
            return None
        return {
            "id": d.id, "name": d.name, "description": d.description,
            "config": json.loads(d.config) if isinstance(d.config, str) else d.config,
            "form_config": json.loads(d.form_config) if isinstance(d.form_config, str) else d.form_config,
            "status": d.status, "version": d.version,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Workflow not found")
    for d in _MOCK_WORKFLOWS:
        if d["id"] == def_id:
            return d
    raise HTTPException(404, "Workflow not found")


@router.post("/definitions")
async def create_definition(body: WorkflowDefCreate, user: dict = Depends(get_current_user)):
    """创建工作流定义."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        tenant_id = current_tenant_id(user)
        config_data = body.config or {"nodes": [], "edges": []}
        config_data["version"] = "v1"
        # If body.steps is provided, embed steps into config for execution
        if body.steps:
            config_data["steps"] = body.steps

        d = WorkflowDef(
            tenant_id=tenant_id,
            name=body.name, description=body.description,
            config=json.dumps(config_data, ensure_ascii=False),
            form_config=json.dumps(body.form_config or {"fields": []}, ensure_ascii=False),
            status=body.status or "draft",
            version=1,
        )
        db.add(d)
        await db.commit()
        await db.refresh(d)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="workflow_def",
            resource_id=d.id,
            new_values=body.dict(),
        )
        return {"id": d.id, "name": d.name, "status": d.status, "version": d.version}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Workflow database unavailable")
    global _wf_id_counter
    _wf_id_counter += 1
    config_data = body.config or {"nodes": [], "edges": []}
    config_data["version"] = "v1"
    if body.steps:
        config_data["steps"] = body.steps
    _MOCK_WORKFLOWS.append({
        "id": _wf_id_counter, "name": body.name, "description": body.description,
        "config": config_data,
        "steps": body.steps,
        "form_config": body.form_config or {"fields": []},
        "status": body.status or "draft", "version": 1,
    })
    return {"id": _wf_id_counter, "name": body.name, "status": body.status or "draft", "version": 1}


@router.put("/definitions/{def_id}")
async def update_definition(def_id: int, body: WorkflowDefCreate, user: dict = Depends(get_current_user)):
    """更新工作流定义."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        tenant_id = current_tenant_id(user)
        d = await db.get(WorkflowDef, def_id)
        if not d or d.tenant_id != tenant_id:
            return None
        next_version = int(d.version or 1) + 1
        d.name = body.name
        if body.description is not None:
            d.description = body.description
        if body.config is not None:
            config_data = body.config
            config_data["version"] = f"v{next_version}"
            if body.steps:
                config_data["steps"] = body.steps
            d.config = json.dumps(config_data, ensure_ascii=False)
        if body.form_config is not None:
            d.form_config = json.dumps(body.form_config, ensure_ascii=False)
        if body.status is not None:
            d.status = body.status
        d.version = next_version
        await db.commit()
        return {"id": d.id, "version": d.version, "status": d.status}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Workflow not found")
    for d in _MOCK_WORKFLOWS:
        if d["id"] == def_id:
            d["name"] = body.name
            if body.config:
                d["config"] = body.config
                d["config"]["version"] = f"v{int(d.get('version', 1)) + 1}"
            if body.steps:
                d["steps"] = body.steps
            if body.status is not None:
                d["status"] = body.status
            d["version"] = int(d.get("version", 1)) + 1
            return {"id": def_id, "version": d["version"], "status": d.get("status", "draft")}
    raise HTTPException(404, "Workflow not found")


@router.delete("/definitions/{def_id}")
async def delete_definition(def_id: int, user: dict = Depends(get_current_user)):
    """删除工作流定义."""
    async def _query(db):
        from app.models.relational import WorkflowDef
        tenant_id = current_tenant_id(user)
        d = await db.get(WorkflowDef, def_id)
        if not d or d.tenant_id != tenant_id:
            return None
        await db.delete(d)
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Workflow not found")
    return {"ok": True}


# ── Instance Lifecycle ───────────────────────────────────

@router.get("/business-items")
async def list_business_workflow_items(
    status: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    """Return workflow center items backed by real forms and dynamic records."""
    async def _query(db):
        dataset = await _workflow_business_dataset(db, user)
        if status and status != "all":
            if status not in WORKFLOW_VIEW_STATUSES:
                raise HTTPException(400, "Invalid workflow tab status")
            dataset["items"] = [item for item in dataset["items"] if item.get("status") == status]
        counts = {"all": len(dataset["items"])}
        for key in WORKFLOW_VIEW_STATUSES:
            counts[key] = sum(1 for item in dataset["items"] if item.get("status") == key)
        dataset["counts"] = counts
        return {"data": dataset}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Workflow business items database unavailable")
    return {"data": {"applications": [], "forms": [], "items": [], "counts": {"all": 0}}}


@router.get("/instances")
async def list_instances(
    status: Optional[str] = None,
    initiator_id: Optional[int] = None,
    workflow_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """工作流实例列表 (supports filtering by status, initiator, workflow, resource_type)."""
    async def _query(db):
        from app.models.relational import WorkflowInstance, WorkflowApproval
        tenant_id = current_tenant_id(user)
        query = select(WorkflowInstance).where(WorkflowInstance.tenant_id == tenant_id).order_by(WorkflowInstance.created_at.desc())
        if status:
            query = query.where(WorkflowInstance.status == status)
        if initiator_id:
            query = query.where(WorkflowInstance.initiator_id == initiator_id)
        if workflow_id:
            query = query.where(WorkflowInstance.workflow_id == workflow_id)
        result = await db.execute(query)
        instances = result.scalars().all()

        out = []
        for inst in instances:
            # Parse workflow_state to extract resource_type
            ws = json.loads(inst.workflow_state) if isinstance(inst.workflow_state, str) else inst.workflow_state
            if resource_type and ws.get("resource_type") != resource_type:
                continue

            approvals_res = await db.execute(
                select(WorkflowApproval).where(WorkflowApproval.instance_id == inst.id).order_by(WorkflowApproval.id)
            )
            approvals = approvals_res.scalars().all()

            # Get steps from workflow definition
            wf_def = await db.get(__import__("app.models.relational", fromlist=["WorkflowDef"]).WorkflowDef, inst.workflow_id)
            steps = []
            if wf_def:
                wf_config = json.loads(wf_def.config) if isinstance(wf_def.config, str) else wf_def.config
                steps = wf_config.get("steps", [])

            out.append({
                "id": inst.id, "workflow_id": inst.workflow_id, "title": inst.title,
                "initiator_id": inst.initiator_id, "status": inst.status,
                "current_step": ws.get("current_step", 0),
                "resource_type": ws.get("resource_type"),
                "resource_id": ws.get("resource_id"),
                "variables": ws.get("variables"),
                "form_data": json.loads(inst.form_data) if isinstance(inst.form_data, str) else inst.form_data,
                "workflow_state": ws,
                "steps": steps,
                "created_at": inst.created_at.isoformat() if inst.created_at else None,
                "updated_at": inst.updated_at.isoformat() if inst.updated_at else None,
                "approvals": [
                    {"id": a.id, "node_id": a.node_id, "approver_id": a.approver_id,
                     "action": a.action, "comment": a.comment,
                     "acted_at": a.acted_at.isoformat() if a.acted_at else None}
                    for a in approvals
                ],
            })
        return {"data": out}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Workflow instances database unavailable")

    # Mock fallback with filtering
    filtered = _MOCK_INSTANCES
    if status:
        filtered = [i for i in filtered if i["status"] == status]
    if initiator_id:
        filtered = [i for i in filtered if i.get("initiator_id") == initiator_id]
    if workflow_id:
        filtered = [i for i in filtered if i["workflow_id"] == workflow_id]
    if resource_type:
        filtered = [i for i in filtered if i.get("resource_type") == resource_type]

    # Enrich mock instances with step info from their workflow definitions
    out = []
    for inst in filtered:
        wf = _get_mock_workflow_by_id(inst["workflow_id"])
        steps = wf.get("steps", []) if wf else []
        ws = json.loads(inst["workflow_state"]) if isinstance(inst.get("workflow_state"), str) else inst.get("workflow_state", {})
        enriched = {
            **inst,
            "steps": steps,
            "current_step": ws.get("current_step", inst.get("current_step", 0)),
            "variables": inst.get("variables"),
            "resource_type": inst.get("resource_type"),
            "resource_id": inst.get("resource_id"),
        }
        out.append(enriched)
    return {"data": out}


@router.get("/instances/{inst_id}")
async def get_instance(inst_id: int, user: dict = Depends(get_current_user)):
    """获取工作流实例详情 (with full step history)."""
    async def _query(db):
        from app.models.relational import WorkflowInstance, WorkflowApproval, WorkflowDef
        tenant_id = current_tenant_id(user)
        inst = await db.get(WorkflowInstance, inst_id)
        if not inst or inst.tenant_id != tenant_id:
            return None

        approvals_res = await db.execute(
            select(WorkflowApproval).where(WorkflowApproval.instance_id == inst_id).order_by(WorkflowApproval.id)
        )
        approvals = approvals_res.scalars().all()

        wf_def = await db.get(WorkflowDef, inst.workflow_id)
        steps = []
        if wf_def:
            wf_config = json.loads(wf_def.config) if isinstance(wf_def.config, str) else wf_def.config
            steps = wf_config.get("steps", [])

        ws = json.loads(inst.workflow_state) if isinstance(inst.workflow_state, str) else inst.workflow_state

        return {
            "id": inst.id, "workflow_id": inst.workflow_id, "title": inst.title,
            "initiator_id": inst.initiator_id, "status": inst.status,
            "current_step": ws.get("current_step", 0),
            "resource_type": ws.get("resource_type"),
            "resource_id": ws.get("resource_id"),
            "variables": ws.get("variables"),
            "form_data": json.loads(inst.form_data) if isinstance(inst.form_data, str) else inst.form_data,
            "workflow_state": ws,
            "steps": steps,
            "created_at": inst.created_at.isoformat() if inst.created_at else None,
            "updated_at": inst.updated_at.isoformat() if inst.updated_at else None,
            "approvals": [
                {"id": a.id, "node_id": a.node_id, "approver_id": a.approver_id,
                 "action": a.action, "comment": a.comment,
                 "step_index": ws.get("current_step", 0),
                 "acted_at": a.acted_at.isoformat() if a.acted_at else None}
                for a in approvals
            ],
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Instance not found")

    # Mock fallback
    inst = _get_mock_instance_by_id(inst_id)
    if not inst:
        raise HTTPException(404, "Instance not found")

    wf = _get_mock_workflow_by_id(inst["workflow_id"])
    steps = wf.get("steps", []) if wf else []
    ws = json.loads(inst["workflow_state"]) if isinstance(inst.get("workflow_state"), str) else inst.get("workflow_state", {})

    return {
        **inst,
        "workflow_state": ws,
        "form_data": json.loads(inst["form_data"]) if isinstance(inst.get("form_data"), str) else inst.get("form_data"),
        "steps": steps,
        "current_step": ws.get("current_step", inst.get("current_step", 0)),
    }


@router.post("/definitions/{def_id}/start")
async def start_instance(def_id: int, body: WorkflowStartRequest, user: dict = Depends(get_current_user)):
    """发起工作流实例 (creates WorkflowInstance + first WorkflowApproval)."""
    async def _query(db):
        from app.models.relational import WorkflowDef, WorkflowInstance, WorkflowApproval
        tenant_id = current_tenant_id(user)
        d = await db.get(WorkflowDef, def_id)
        if not d or d.tenant_id != tenant_id:
            return None
        config = json.loads(d.config) if isinstance(d.config, str) else d.config
        steps = _workflow_config_steps(config if isinstance(config, dict) else {})

        # Determine the first step
        first_step_index = _find_first_approval_step(steps) if steps else 0
        current_step = steps[first_step_index] if steps and first_step_index < len(steps) else None
        initiator_id = current_user_id(user)
        form_data = body.form_data or {}
        variables = body.variables or {}
        approver_ids = await _resolve_step_approver_ids(
            db,
            tenant_id,
            current_step or {},
            form_data,
            variables,
            initiator_id,
            initiator_id,
        ) if current_step and current_step.get("type") == "approval" else []

        # Build workflow state
        state = {
            "current_node": current_step.get("node_id", current_step.get("name", "start")) if current_step else "end",
            "current_step": first_step_index,
            "resource_type": body.resource_type,
            "resource_id": body.resource_id,
            "variables": variables,
        }
        _set_current_assignees(state, approver_ids)

        inst = WorkflowInstance(
            tenant_id=tenant_id,
            workflow_id=def_id, title=body.title,
            initiator_id=initiator_id,
            form_data=json.dumps(form_data, ensure_ascii=False),
            workflow_state=json.dumps(state, ensure_ascii=False),
            status="pending",
        )
        db.add(inst)
        await db.flush()

        if current_step and current_step.get("type") == "approval":
            for approver_id in approver_ids:
                db.add(WorkflowApproval(
                    instance_id=inst.id,
                    approver_id=approver_id,
                    node_id=current_step.get("node_id", current_step.get("name", "")),
                ))
            _add_approval_notifications(db, tenant_id, approver_ids, body.title, inst.id)
        await db.commit()
        await db.refresh(inst)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="start",
            resource_type="workflow_instance",
            resource_id=inst.id,
            new_values={"workflow_id": def_id, "title": body.title, "resource_type": body.resource_type, "resource_id": body.resource_id},
        )
        return {
            "instance_id": inst.id,
            "status": inst.status,
            "current_step": first_step_index,
            "current_step_name": current_step.get("name") if current_step else None,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Workflow definition not found")

    # Mock fallback
    wf = _get_mock_workflow_by_id(def_id)
    if not wf:
        raise HTTPException(404, "Workflow definition not found")

    steps = wf.get("steps", [])
    first_step_index = _find_first_approval_step(steps) if steps else 0
    current_step = steps[first_step_index] if steps and first_step_index < len(steps) else None

    global _inst_id_counter, _approval_id_counter
    _inst_id_counter += 1
    _approval_id_counter += 1

    state = {
        "current_node": current_step.get("node_id", current_step.get("name", "start")) if current_step else "end",
        "current_step": first_step_index,
        "resource_type": body.resource_type,
        "resource_id": body.resource_id,
        "variables": body.variables or {},
    }

    inst = {
        "id": _inst_id_counter, "workflow_id": def_id, "title": body.title,
        "initiator_id": 1, "initiator_name": "当前用户", "status": "pending",
        "current_step": first_step_index,
        "resource_type": body.resource_type,
        "resource_id": body.resource_id,
        "variables": json.dumps(body.variables or {}),
        "form_data": json.dumps(body.form_data or {}),
        "workflow_state": json.dumps(state),
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "approvals": [
            {"id": _approval_id_counter,
             "node_id": current_step.get("node_id", current_step.get("name", "")) if current_step else "start",
             "approver_id": 2, "action": None, "comment": None, "acted_at": None,
             "step_index": first_step_index}
        ] if current_step and current_step.get("type") == "approval" else [],
    }
    _MOCK_INSTANCES.append(inst)

    # Create notification for the approver
    global _notif_id_counter
    _notif_id_counter += 1
    _MOCK_NOTIFICATIONS.append({
        "id": _notif_id_counter,
        "user_id": 2,
        "title": f"待审批：{body.title}",
        "content": f"您有一条新的工作流审批待处理",
        "type": "approval",
        "is_read": False,
        "link": "/workflow/my-approvals",
        "created_at": datetime.now().isoformat(),
    })

    return {
        "instance_id": _inst_id_counter,
        "status": "pending",
        "current_step": first_step_index,
        "current_step_name": current_step.get("name") if current_step else None,
    }


@router.post("/instances/{inst_id}/approve")
async def approve_step(inst_id: int, body: StepApprovalRequest, user: dict = Depends(get_current_user)):
    """审批通过当前步骤 (moves to next step or completes workflow)."""
    return await _act_on_step(inst_id, body, action="approve", user=user)


@router.post("/instances/{inst_id}/reject")
async def reject_step(inst_id: int, body: StepApprovalRequest, user: dict = Depends(get_current_user)):
    """驳回当前步骤 (marks instance as rejected)."""
    return await _act_on_step(inst_id, body, action="reject", user=user)


async def _act_on_step(inst_id: int, body: StepApprovalRequest, action: str, user: dict | None = None):
    """Core step action logic — approve moves forward, reject terminates."""
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action must be 'approve' or 'reject'")

    async def _query(db):
        from app.models.relational import WorkflowInstance, WorkflowApproval, WorkflowDef
        tenant_id = current_tenant_id(user or {})
        inst = await db.get(WorkflowInstance, inst_id)
        if not inst or inst.tenant_id != tenant_id:
            return None

        wf_def = await db.get(WorkflowDef, inst.workflow_id)
        if not wf_def or wf_def.tenant_id != tenant_id:
            return None

        config = json.loads(wf_def.config) if isinstance(wf_def.config, str) else wf_def.config
        steps = _workflow_config_steps(config if isinstance(config, dict) else {})
        state = json.loads(inst.workflow_state) if isinstance(inst.workflow_state, str) else inst.workflow_state
        current_step_idx = state.get("current_step", 0)
        form_data = json.loads(inst.form_data) if isinstance(inst.form_data, str) and inst.form_data else (inst.form_data or {})
        variables = state.get("variables") if isinstance(state.get("variables"), dict) else {}
        current_step = steps[current_step_idx] if steps and isinstance(current_step_idx, int) and 0 <= current_step_idx < len(steps) else {}
        current_node_id = current_step.get("node_id", current_step.get("name", state.get("current_node", "")))
        approval_mode = current_step.get("approval_mode") or "single"
        acting_user_id = current_user_id(user or {}) or body.user_id

        # Mark pending approvals for this node. Countersign waits for all users;
        # single/or-sign closes sibling pending approvals once one user acts.
        pending_approvals = (await db.execute(
            select(WorkflowApproval)
            .where(
                WorkflowApproval.instance_id == inst_id,
                WorkflowApproval.action == None,
                WorkflowApproval.node_id == current_node_id,
            )
            .order_by(WorkflowApproval.id)
        )).scalars().all()
        acting_approval = next((approval for approval in pending_approvals if approval.approver_id == acting_user_id), None) or (pending_approvals[0] if pending_approvals else None)
        if acting_approval:
            acting_approval.action = action
            acting_approval.comment = body.comment
            acting_approval.acted_at = datetime.now()
            acting_approval.approver_id = acting_user_id
        if approval_mode != "countersign":
            for approval in pending_approvals:
                if acting_approval and approval.id == acting_approval.id:
                    continue
                approval.action = "skipped"
                approval.comment = "同节点其他待办已由他人处理"
                approval.acted_at = datetime.now()

        if action == "reject":
            inst.status = "rejected"
            state["current_node"] = "end"
            _set_current_assignees(state, [])
            inst.workflow_state = json.dumps(state, ensure_ascii=False)
            await db.commit()
            return {"id": inst.id, "status": "rejected", "current_step": current_step_idx}

        if approval_mode == "countersign":
            remaining = [approval for approval in pending_approvals if not acting_approval or approval.id != acting_approval.id]
            if remaining:
                inst.status = "pending"
                inst.workflow_state = json.dumps(state, ensure_ascii=False)
                await db.commit()
                return {"id": inst.id, "status": inst.status, "current_step": current_step_idx, "message": "已通过，等待其他会签人"}

        # Approve: move to next step
        next_step_idx = _find_next_actionable_step(steps, current_step_idx)
        if next_step_idx is not None:
            next_step = steps[next_step_idx]
            state["current_step"] = next_step_idx
            state["current_node"] = next_step.get("node_id", next_step.get("name", ""))
            inst.status = "pending"

            # Create new approval record for next step
            if next_step.get("type") == "approval":
                approver_ids = await _resolve_step_approver_ids(
                    db,
                    tenant_id,
                    next_step,
                    form_data if isinstance(form_data, dict) else {},
                    variables,
                    inst.initiator_id,
                    current_user_id(user or {}) or body.user_id,
                )
                _set_current_assignees(state, approver_ids)
                for approver_id in approver_ids:
                    db.add(WorkflowApproval(
                        instance_id=inst.id,
                        approver_id=approver_id,
                        node_id=next_step.get("node_id", next_step.get("name", "")),
                    ))
                _add_approval_notifications(db, tenant_id, approver_ids, inst.title, inst.id)
            inst.workflow_state = json.dumps(state, ensure_ascii=False)
        else:
            # No more steps — workflow completed
            inst.status = "approved"
            state["current_node"] = "end"
            state["current_step"] = len(steps) - 1 if steps else current_step_idx
            _set_current_assignees(state, [])
            inst.workflow_state = json.dumps(state, ensure_ascii=False)

        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user or {}),
            action=action,
            resource_type="workflow_instance",
            resource_id=inst.id,
        )
        return {
            "id": inst.id, "status": inst.status,
            "current_step": state.get("current_step", current_step_idx),
            "message": "已通过" if inst.status == "approved" else "已进入下一步",
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Instance not found")

    # Mock fallback
    inst = _get_mock_instance_by_id(inst_id)
    if not inst:
        raise HTTPException(404, "Instance not found")

    wf = _get_mock_workflow_by_id(inst["workflow_id"])
    steps = wf.get("steps", []) if wf else []
    ws = json.loads(inst["workflow_state"]) if isinstance(inst.get("workflow_state"), str) else inst.get("workflow_state", {})
    current_step_idx = ws.get("current_step", inst.get("current_step", 0))

    # Update the pending approval in mock
    for a in inst.get("approvals", []):
        if a.get("action") is None:
            a["action"] = action
            a["comment"] = body.comment
            a["acted_at"] = datetime.now().isoformat()
            a["approver_id"] = body.user_id

    if action == "reject":
        inst["status"] = "rejected"
        ws["current_node"] = "end"
        inst["workflow_state"] = json.dumps(ws)
        inst["updated_at"] = datetime.now().isoformat()
        return {"id": inst_id, "status": "rejected", "current_step": current_step_idx}

    # Approve: advance step
    next_step_idx = _find_next_actionable_step(steps, current_step_idx)
    if next_step_idx is not None:
        next_step = steps[next_step_idx]
        ws["current_step"] = next_step_idx
        ws["current_node"] = next_step.get("node_id", next_step.get("name", ""))
        inst["status"] = "pending"
        inst["current_step"] = next_step_idx
        inst["workflow_state"] = json.dumps(ws)
        inst["updated_at"] = datetime.now().isoformat()

        # Create new mock approval for next step
        if next_step.get("type") == "approval":
            global _approval_id_counter
            _approval_id_counter += 1
            inst.setdefault("approvals", []).append({
                "id": _approval_id_counter,
                "node_id": next_step.get("node_id", next_step.get("name", "")),
                "approver_id": body.user_id,
                "action": None, "comment": None, "acted_at": None,
                "step_index": next_step_idx,
            })

        return {
            "id": inst_id, "status": "pending",
            "current_step": next_step_idx,
            "message": f"已进入步骤：{next_step.get('name', '')}",
        }
    else:
        # Workflow completed
        inst["status"] = "approved"
        ws["current_node"] = "end"
        ws["current_step"] = len(steps) - 1 if steps else current_step_idx
        inst["workflow_state"] = json.dumps(ws)
        inst["current_step"] = ws["current_step"]
        inst["updated_at"] = datetime.now().isoformat()
        return {
            "id": inst_id, "status": "approved",
            "current_step": ws["current_step"],
            "message": "工作流已完成",
        }


# Legacy act endpoint kept for backward compatibility
@router.post("/instances/{inst_id}/act")
async def approve_or_reject(inst_id: int, body: ApprovalAction, user: dict = Depends(get_current_user)):
    """审批/驳回工作流实例 (legacy endpoint)."""
    if body.action not in ("approve", "reject"):
        raise HTTPException(400, "action must be 'approve' or 'reject'")

    step_body = StepApprovalRequest(comment=body.comment, user_id=1)
    return await _act_on_step(inst_id, step_body, action=body.action, user=user)


@router.post("/instances/{inst_id}/cancel")
async def cancel_instance(inst_id: int, user: dict = Depends(get_current_user)):
    """撤销工作流实例."""
    async def _query(db):
        from app.models.relational import WorkflowInstance
        tenant_id = current_tenant_id(user)
        inst = await db.get(WorkflowInstance, inst_id)
        if not inst or inst.tenant_id != tenant_id:
            return None
        inst.status = "cancelled"
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="cancel",
            resource_type="workflow_instance",
            resource_id=inst.id,
        )
        return {"id": inst.id, "status": "cancelled"}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Instance not found")
    for inst in _MOCK_INSTANCES:
        if inst["id"] == inst_id:
            inst["status"] = "cancelled"
            return {"id": inst_id, "status": "cancelled"}
    raise HTTPException(404, "Instance not found")


# ── Notifications ────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(user_id: int = Query(1)):
    """通知列表."""
    async def _query(db):
        from app.models.relational import Notification
        result = await db.execute(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        items = result.scalars().all()
        return {"data": [
            {"id": n.id, "user_id": n.user_id, "title": n.title, "content": n.content,
             "type": n.type, "is_read": n.is_read, "link": n.link,
             "created_at": n.created_at.isoformat() if n.created_at else None}
            for n in items
        ]}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"data": [n for n in _MOCK_NOTIFICATIONS if n["user_id"] == user_id]}


@router.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: int):
    """标记通知已读."""
    async def _query(db):
        from app.models.relational import Notification
        n = await db.get(Notification, notif_id)
        if not n:
            return None
        n.is_read = True
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_read(user_id: int = Query(1)):
    """全部标记已读."""
    async def _query(db):
        from app.models.relational import Notification
        from sqlalchemy import update
        await db.execute(
            update(Notification).where(Notification.user_id == user_id).values(is_read=True)
        )
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


# ── Stats / Summary ──────────────────────────────────────

@router.get("/stats")
async def workflow_stats(user: dict = Depends(get_current_user)):
    """工作流统计概览."""
    # Count from mock data (DB mode would aggregate from tables)
    async def _query(db):
        from app.models.relational import Notification, User, WorkflowDef, WorkflowInstance
        tenant_id = current_tenant_id(user)
        total_definitions = await db.scalar(
            select(func.count(WorkflowDef.id)).where(WorkflowDef.tenant_id == tenant_id)
        )
        total_instances = await db.scalar(
            select(func.count(WorkflowInstance.id)).where(WorkflowInstance.tenant_id == tenant_id)
        )
        status_rows = await db.execute(
            select(WorkflowInstance.status, func.count(WorkflowInstance.id))
            .where(WorkflowInstance.tenant_id == tenant_id)
            .group_by(WorkflowInstance.status)
        )
        by_status = {status: count for status, count in status_rows.all()}
        unread_notifications = await db.scalar(
            select(func.count(Notification.id))
            .join(User, User.id == Notification.user_id)
            .where(User.tenant_id == tenant_id, Notification.is_read.is_(False))
        )
        return {
            "total_definitions": int(total_definitions or 0),
            "total_instances": int(total_instances or 0),
            "instances_by_status": {
                "pending": int(by_status.get("pending", 0)),
                "approved": int(by_status.get("approved", 0)),
                "rejected": int(by_status.get("rejected", 0)),
                "cancelled": int(by_status.get("cancelled", 0)),
            },
            "unread_notifications": int(unread_notifications or 0),
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Workflow database unavailable")

    total_instances = len(_MOCK_INSTANCES)
    pending = sum(1 for i in _MOCK_INSTANCES if i["status"] == "pending")
    approved = sum(1 for i in _MOCK_INSTANCES if i["status"] == "approved")
    rejected = sum(1 for i in _MOCK_INSTANCES if i["status"] == "rejected")
    cancelled = sum(1 for i in _MOCK_INSTANCES if i["status"] == "cancelled")

    return {
        "total_definitions": len(_MOCK_WORKFLOWS),
        "total_instances": total_instances,
        "instances_by_status": {
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "cancelled": cancelled,
        },
        "unread_notifications": sum(1 for n in _MOCK_NOTIFICATIONS if not n["is_read"]),
    }
