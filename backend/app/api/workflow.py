"""Workflow Engine API — definition CRUD, instance lifecycle, step-based execution, notifications."""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

router = APIRouter()

from app.api.deps import current_tenant_id, current_user_id, get_current_user
from app.config import settings
from app.core.audit import write_audit_log


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
        # If body.steps is provided, embed steps into config for execution
        if body.steps:
            config_data["steps"] = body.steps

        d = WorkflowDef(
            tenant_id=tenant_id,
            name=body.name, description=body.description,
            config=json.dumps(config_data, ensure_ascii=False),
            form_config=json.dumps(body.form_config or {"fields": []}, ensure_ascii=False),
            status=body.status or "draft",
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
        d.name = body.name
        if body.description is not None:
            d.description = body.description
        if body.config is not None:
            config_data = body.config
            if body.steps:
                config_data["steps"] = body.steps
            d.config = json.dumps(config_data, ensure_ascii=False)
        if body.form_config is not None:
            d.form_config = json.dumps(body.form_config, ensure_ascii=False)
        if body.status is not None:
            d.status = body.status
        d.version += 1
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
        steps = config.get("steps", [])

        # Determine the first step
        first_step_index = _find_first_approval_step(steps) if steps else 0
        current_step = steps[first_step_index] if steps and first_step_index < len(steps) else None

        # Build workflow state
        state = {
            "current_node": current_step.get("node_id", current_step.get("name", "start")) if current_step else "end",
            "current_step": first_step_index,
            "resource_type": body.resource_type,
            "resource_id": body.resource_id,
            "variables": body.variables or {},
        }

        inst = WorkflowInstance(
            tenant_id=tenant_id,
            workflow_id=def_id, title=body.title,
            initiator_id=current_user_id(user),
            form_data=json.dumps(body.form_data or {}, ensure_ascii=False),
            workflow_state=json.dumps(state, ensure_ascii=False),
            status="pending",
        )
        db.add(inst)
        await db.flush()

        if current_step and current_step.get("type") == "approval":
            approval = WorkflowApproval(
                instance_id=inst.id, approver_id=body.user_id if hasattr(body, "user_id") else 2,
                node_id=current_step.get("node_id", current_step.get("name", "")),
            )
            db.add(approval)
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
        steps = config.get("steps", [])
        state = json.loads(inst.workflow_state) if isinstance(inst.workflow_state, str) else inst.workflow_state
        current_step_idx = state.get("current_step", 0)

        # Mark the pending approval
        pending_approval = await db.scalar(
            select(WorkflowApproval)
            .where(WorkflowApproval.instance_id == inst_id, WorkflowApproval.action == None)
        )
        if pending_approval:
            pending_approval.action = action
            pending_approval.comment = body.comment
            pending_approval.acted_at = datetime.now()
            pending_approval.approver_id = current_user_id(user or {}) or body.user_id

        if action == "reject":
            inst.status = "rejected"
            state["current_node"] = "end"
            inst.workflow_state = json.dumps(state, ensure_ascii=False)
            await db.commit()
            return {"id": inst.id, "status": "rejected", "current_step": current_step_idx}

        # Approve: move to next step
        next_step_idx = _find_next_actionable_step(steps, current_step_idx)
        if next_step_idx is not None:
            next_step = steps[next_step_idx]
            state["current_step"] = next_step_idx
            state["current_node"] = next_step.get("node_id", next_step.get("name", ""))
            inst.status = "pending"
            inst.workflow_state = json.dumps(state, ensure_ascii=False)

            # Create new approval record for next step
            if next_step.get("type") == "approval":
                new_approval = WorkflowApproval(
                    instance_id=inst.id, approver_id=body.user_id,
                    node_id=next_step.get("node_id", next_step.get("name", "")),
                )
                db.add(new_approval)
        else:
            # No more steps — workflow completed
            inst.status = "approved"
            state["current_node"] = "end"
            state["current_step"] = len(steps) - 1 if steps else current_step_idx
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
