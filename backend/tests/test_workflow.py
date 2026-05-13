"""Tests for the Workflow Engine — instance lifecycle, step execution, filtering."""

import copy
import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest


# ── Fixtures ──────────────────────────────────────────────

# Seed data that every test starts from (deep-copied to prevent cross-test mutation)
_SEED_WORKFLOWS = [
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
        "form_config": {"fields": [
            {"name": "equipment_name", "label": "设备名称", "type": "string", "required": True},
        ]},
        "status": "published", "version": 1,
    },
    {
        "id": 2, "name": "质量异常处理", "description": "质量异常上报与处理审批",
        "config": {
            "nodes": [
                {"id": "start", "type": "start", "data": {"label": "上报异常"}},
                {"id": "qc-review", "type": "approval", "data": {"label": "质检主管审批", "approver_role": "quality_inspector"}},
                {"id": "end", "type": "end", "data": {"label": "结束"}},
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
        "form_config": {"fields": []},
        "status": "published", "version": 1,
    },
    {
        "id": 3, "name": "物料采购审批", "description": "物料采购申请审批流程",
        "config": {
            "nodes": [
                {"id": "start", "type": "start", "data": {"label": "提交采购申请"}},
                {"id": "mgr-review", "type": "approval", "data": {"label": "部门经理审批", "approver_role": "dept_manager"}},
                {"id": "fin-review", "type": "approval", "data": {"label": "财务审批", "approver_role": "finance"}},
                {"id": "end", "type": "end", "data": {"label": "完成"}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "mgr-review"},
                {"id": "e2", "source": "mgr-review", "target": "fin-review"},
                {"id": "e3", "source": "fin-review", "target": "end"},
            ],
        },
        "steps": [
            {"name": "提交采购申请", "type": "start"},
            {"name": "部门经理审批", "type": "approval", "assignee_role": "dept_manager"},
            {"name": "财务审批", "type": "approval", "assignee_role": "finance"},
            {"name": "完成", "type": "end"},
        ],
        "form_config": {"fields": []},
        "status": "published", "version": 1,
    },
]

_SEED_INSTANCES = [
    {
        "id": 1, "workflow_id": 1, "title": "CNC加工中心主轴异响维修",
        "initiator_id": 2, "initiator_name": "张三",
        "status": "pending", "current_step": 1,
        "resource_type": "work_orders", "resource_id": 5,
        "variables": json.dumps({"equipment": "CNC-001", "reason": "健康分过低"}),
        "form_data": json.dumps({"equipment_name": "CNC加工中心-01", "fault_desc": "主轴运行时异响", "urgency": "高"}),
        "workflow_state": json.dumps({"current_node": "review", "current_step": 1}),
        "created_at": "2026-05-13T10:00:00", "updated_at": "2026-05-13T10:00:00",
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
        "created_at": "2026-04-21T14:00:00", "updated_at": "2026-04-21T15:30:00",
        "approvals": [
            {"id": 2, "node_id": "qc-review", "approver_id": 3, "action": "approve", "comment": "已确认处理", "acted_at": "2026-04-21T15:30:00", "step_index": 1},
        ],
    },
]

_SEED_NOTIFICATIONS = [
    {"id": 1, "user_id": 2, "title": "待审批：CNC加工中心主轴异响维修",
     "content": "张三提交了设备维修审批", "type": "approval",
     "is_read": False, "link": "/workflow/my-approvals", "created_at": "2026-05-13T10:00:00"},
]


@pytest.fixture(autouse=True)
def _reset_mock_state():
    """Reset mock data between tests using deep copies of seed data."""
    from app.api import workflow as wf_mod

    # Force DB calls to return None (fallback to mock) by patching safe_db_call
    with patch.object(wf_mod, "_try_db", new_callable=AsyncMock, return_value=None):
        # Deep-copy seed data into module-level lists
        wf_mod._MOCK_WORKFLOWS = copy.deepcopy(_SEED_WORKFLOWS)
        wf_mod._MOCK_INSTANCES = copy.deepcopy(_SEED_INSTANCES)
        wf_mod._MOCK_NOTIFICATIONS = copy.deepcopy(_SEED_NOTIFICATIONS)
        wf_mod._wf_id_counter = 20
        wf_mod._inst_id_counter = 20
        wf_mod._notif_id_counter = 20
        wf_mod._approval_id_counter = 20

        yield

        # No cleanup needed; next test gets fresh deep copies


# ── Helper tests ─────────────────────────────────────────

def test_get_steps_from_workflow_with_top_level_steps():
    """Steps extracted from top-level 'steps' key."""
    from app.api.workflow import _get_steps_from_workflow
    wf = {"steps": [{"name": "审批", "type": "approval"}]}
    assert _get_steps_from_workflow(wf) == [{"name": "审批", "type": "approval"}]


def test_get_steps_from_workflow_from_config_nodes():
    """Steps extracted from config.nodes when no top-level steps."""
    from app.api.workflow import _get_steps_from_workflow
    wf = {
        "config": {
            "nodes": [
                {"id": "start", "type": "start", "data": {"label": "开始"}},
                {"id": "review", "type": "approval", "data": {"label": "审批", "approver_role": "mgr"}},
                {"id": "end", "type": "end", "data": {"label": "结束"}},
            ],
            "edges": [
                {"source": "start", "target": "review"},
                {"source": "review", "target": "end"},
            ],
        }
    }
    steps = _get_steps_from_workflow(wf)
    assert len(steps) == 3
    assert steps[0]["name"] == "开始"
    assert steps[1]["type"] == "approval"
    assert steps[1]["assignee_role"] == "mgr"
    assert steps[2]["name"] == "结束"


def test_find_first_approval_step():
    from app.api.workflow import _find_first_approval_step
    steps = [
        {"name": "start", "type": "start"},
        {"name": "审批", "type": "approval"},
        {"name": "end", "type": "end"},
    ]
    assert _find_first_approval_step(steps) == 1


def test_find_first_approval_step_no_approval():
    from app.api.workflow import _find_first_approval_step
    steps = [{"name": "start", "type": "start"}]
    assert _find_first_approval_step(steps) == 0


def test_find_next_actionable_step():
    from app.api.workflow import _find_next_actionable_step
    steps = [
        {"name": "start", "type": "start"},
        {"name": "审批1", "type": "approval"},
        {"name": "审批2", "type": "approval"},
        {"name": "end", "type": "end"},
    ]
    assert _find_next_actionable_step(steps, 1) == 2


def test_find_next_actionable_step_none():
    from app.api.workflow import _find_next_actionable_step
    steps = [
        {"name": "start", "type": "start"},
        {"name": "审批", "type": "approval"},
        {"name": "end", "type": "end"},
    ]
    assert _find_next_actionable_step(steps, 1) is None


def test_find_next_actionable_step_skips_notification():
    """Notification steps should be skipped — only approval steps are actionable."""
    from app.api.workflow import _find_next_actionable_step
    steps = [
        {"name": "start", "type": "start"},
        {"name": "审批", "type": "approval"},
        {"name": "通知", "type": "notification"},
        {"name": "end", "type": "end"},
    ]
    assert _find_next_actionable_step(steps, 1) is None


def test_is_last_step_true():
    from app.api.workflow import _is_last_step
    steps = [
        {"name": "审批", "type": "approval"},
        {"name": "end", "type": "end"},
    ]
    assert _is_last_step(steps, 0) is True


def test_is_last_step_false():
    from app.api.workflow import _is_last_step
    steps = [
        {"name": "审批1", "type": "approval"},
        {"name": "审批2", "type": "approval"},
        {"name": "end", "type": "end"},
    ]
    assert _is_last_step(steps, 0) is False


# ── Workflow Definition CRUD tests ───────────────────────

@pytest.mark.asyncio
async def test_list_definitions():
    """GET /workflow/definitions returns list."""
    from app.api.workflow import list_definitions
    result = await list_definitions()
    assert "data" in result
    assert len(result["data"]) >= 2


@pytest.mark.asyncio
async def test_get_definition_by_id():
    """GET /workflow/definitions/{id} returns single definition."""
    from app.api.workflow import get_definition
    result = await get_definition(def_id=1)
    assert result["name"] == "设备维修审批"
    assert "steps" in result or "config" in result


@pytest.mark.asyncio
async def test_get_definition_not_found():
    """GET /workflow/definitions/{id} returns 404 for missing."""
    from fastapi import HTTPException
    from app.api.workflow import get_definition
    with pytest.raises(HTTPException) as exc_info:
        await get_definition(def_id=9999)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_create_definition():
    """POST /workflow/definitions creates new workflow."""
    from app.api.workflow import WorkflowDefCreate, create_definition
    body = WorkflowDefCreate(
        name="新流程", description="测试流程",
        steps=[{"name": "审批", "type": "approval"}],
    )
    result = await create_definition(body)
    assert result["name"] == "新流程"
    assert result["id"] is not None


@pytest.mark.asyncio
async def test_update_definition():
    """PUT /workflow/definitions/{id} updates existing."""
    from app.api.workflow import WorkflowDefCreate, update_definition
    body = WorkflowDefCreate(name="更新名称")
    result = await update_definition(def_id=1, body=body)
    assert result["id"] == 1


@pytest.mark.asyncio
async def test_update_definition_not_found():
    """PUT /workflow/definitions/{id} returns 404 for missing."""
    from fastapi import HTTPException
    from app.api.workflow import WorkflowDefCreate, update_definition
    body = WorkflowDefCreate(name="X")
    with pytest.raises(HTTPException) as exc_info:
        await update_definition(def_id=9999, body=body)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_definition():
    """DELETE /workflow/definitions/{id} returns ok."""
    from app.api.workflow import delete_definition
    result = await delete_definition(def_id=1)
    assert result["ok"] is True


# ── Instance lifecycle: Start ────────────────────────────

@pytest.mark.asyncio
async def test_start_workflow_creates_instance():
    """POST /workflow/definitions/{id}/start creates a new instance."""
    from app.api.workflow import start_instance, list_instances
    before = await list_instances()
    count_before = len(before["data"])

    body = _make_start_request("测试维修单")
    result = await start_instance(def_id=1, body=body)

    assert result["instance_id"] is not None
    assert result["status"] == "pending"
    assert result["current_step"] is not None

    after = await list_instances()
    assert len(after["data"]) == count_before + 1


@pytest.mark.asyncio
async def test_start_workflow_with_resource():
    """Start workflow with resource_type and resource_id."""
    from app.api.workflow import start_instance, get_instance
    body = _make_start_request("资源关联测试", resource_type="work_orders", resource_id=5)
    result = await start_instance(def_id=1, body=body)

    inst = await get_instance(result["instance_id"])
    assert inst["resource_type"] == "work_orders"
    assert inst["resource_id"] == 5


@pytest.mark.asyncio
async def test_start_workflow_with_variables():
    """Start workflow with variables."""
    from app.api.workflow import start_instance, get_instance
    body = _make_start_request("变量测试", variables={"equipment": "CNC-001", "reason": "测试"})
    result = await start_instance(def_id=1, body=body)

    inst = await get_instance(result["instance_id"])
    ws = inst["workflow_state"]
    if isinstance(ws, str):
        ws = json.loads(ws)
    assert ws["variables"]["equipment"] == "CNC-001"


@pytest.mark.asyncio
async def test_start_workflow_not_found():
    """Start a nonexistent workflow definition returns 404."""
    from fastapi import HTTPException
    from app.api.workflow import start_instance
    body = _make_start_request("不存在的流程")
    with pytest.raises(HTTPException) as exc_info:
        await start_instance(def_id=9999, body=body)
    assert exc_info.value.status_code == 404


# ── Instance lifecycle: Approve ──────────────────────────

@pytest.mark.asyncio
async def test_approve_single_step_workflow():
    """Approve on a single-approval workflow completes it."""
    from app.api.workflow import start_instance, approve_step
    body = _make_start_request("单步审批")
    result = await start_instance(def_id=1, body=body)
    inst_id = result["instance_id"]

    approval_body = _make_approval_request("同意", user_id=2)
    action_result = await approve_step(inst_id, approval_body)

    assert action_result["status"] == "approved"
    assert "已完成" in action_result.get("message", "")


@pytest.mark.asyncio
async def test_approve_multi_step_workflow_advances():
    """Approve on a multi-step workflow advances to the next step."""
    from app.api.workflow import start_instance, approve_step, get_instance
    # Workflow 3 has 3 approvals: dept_manager -> finance -> end
    body = _make_start_request("多步采购")
    result = await start_instance(def_id=3, body=body)
    inst_id = result["instance_id"]

    # First approval (dept_manager -> finance)
    approval_body = _make_approval_request("同意采购", user_id=4)
    action_result = await approve_step(inst_id, approval_body)

    assert action_result["status"] == "pending"
    assert action_result["current_step"] > result["current_step"]

    # Verify instance is at second step
    inst = await get_instance(inst_id)
    assert inst["status"] == "pending"
    # Should have 2 approval records: first acted, second pending
    acted = [a for a in inst["approvals"] if a["action"] == "approve"]
    pending = [a for a in inst["approvals"] if a["action"] is None]
    assert len(acted) == 1
    assert len(pending) == 1


@pytest.mark.asyncio
async def test_approve_all_steps_completes_workflow():
    """Approve all steps in multi-step workflow marks it approved."""
    from app.api.workflow import start_instance, approve_step, get_instance
    body = _make_start_request("完整采购流程")
    result = await start_instance(def_id=3, body=body)
    inst_id = result["instance_id"]

    # Approve step 1
    await approve_step(inst_id, _make_approval_request("同意", user_id=4))
    # Approve step 2
    final = await approve_step(inst_id, _make_approval_request("通过", user_id=5))

    assert final["status"] == "approved"
    assert "已完成" in final.get("message", "")

    # Verify all approvals are acted on
    inst = await get_instance(inst_id)
    acted = [a for a in inst["approvals"] if a["action"] == "approve"]
    assert len(acted) == 2


# ── Instance lifecycle: Reject ───────────────────────────

@pytest.mark.asyncio
async def test_reject_terminates_workflow():
    """Reject marks the instance as rejected."""
    from app.api.workflow import start_instance, reject_step, get_instance
    body = _make_start_request("待驳回")
    result = await start_instance(def_id=1, body=body)
    inst_id = result["instance_id"]

    rejection = _make_approval_request("理由不充分", user_id=2)
    action_result = await reject_step(inst_id, rejection)

    assert action_result["status"] == "rejected"

    # Verify instance state
    inst = await get_instance(inst_id)
    assert inst["status"] == "rejected"


@pytest.mark.asyncio
async def test_reject_multi_step_workflow_terminates():
    """Reject in the middle of a multi-step workflow stops it."""
    from app.api.workflow import start_instance, reject_step, get_instance
    body = _make_start_request("中途驳回测试")
    result = await start_instance(def_id=3, body=body)
    inst_id = result["instance_id"]

    rejection = _make_approval_request("预算不足", user_id=4)
    action_result = await reject_step(inst_id, rejection)

    assert action_result["status"] == "rejected"

    inst = await get_instance(inst_id)
    assert inst["status"] == "rejected"
    # Should have exactly 1 approval record (the rejection)
    acted = [a for a in inst["approvals"] if a["action"] == "reject"]
    assert len(acted) == 1


# ── Instance listing / filtering ─────────────────────────

@pytest.mark.asyncio
async def test_list_instances_all():
    """GET /workflow/instances returns all instances."""
    from app.api.workflow import list_instances
    result = await list_instances()
    assert "data" in result
    assert len(result["data"]) >= 2  # pre-seeded mock data


@pytest.mark.asyncio
async def test_list_instances_filter_by_status():
    """Filter instances by status."""
    from app.api.workflow import list_instances
    result = await list_instances(status="pending")
    for inst in result["data"]:
        assert inst["status"] == "pending"


@pytest.mark.asyncio
async def test_list_instances_filter_by_workflow_id():
    """Filter instances by workflow_id."""
    from app.api.workflow import list_instances
    result = await list_instances(workflow_id=1)
    for inst in result["data"]:
        assert inst["workflow_id"] == 1


@pytest.mark.asyncio
async def test_list_instances_filter_by_resource_type():
    """Filter instances by resource_type."""
    from app.api.workflow import list_instances
    result = await list_instances(resource_type="work_orders")
    for inst in result["data"]:
        assert inst.get("resource_type") == "work_orders"


@pytest.mark.asyncio
async def test_list_instances_includes_steps():
    """Instance list items include steps from workflow definition."""
    from app.api.workflow import list_instances
    result = await list_instances()
    if result["data"]:
        inst = result["data"][0]
        assert "steps" in inst
        assert isinstance(inst["steps"], list)


# ── Instance detail ──────────────────────────────────────

@pytest.mark.asyncio
async def test_get_instance_detail():
    """GET /workflow/instances/{id} returns full detail with steps."""
    from app.api.workflow import get_instance
    result = await get_instance(inst_id=1)
    assert result["id"] == 1
    assert result["title"] == "CNC加工中心主轴异响维修"
    assert "steps" in result
    assert "approvals" in result
    assert isinstance(result["steps"], list)
    assert len(result["steps"]) > 0


@pytest.mark.asyncio
async def test_get_instance_not_found():
    """GET /workflow/instances/{id} returns 404 for missing."""
    from fastapi import HTTPException
    from app.api.workflow import get_instance
    with pytest.raises(HTTPException) as exc_info:
        await get_instance(inst_id=9999)
    assert exc_info.value.status_code == 404


# ── Cancel instance ──────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_instance():
    """POST cancel marks instance as cancelled."""
    from app.api.workflow import start_instance, cancel_instance, get_instance
    body = _make_start_request("待取消")
    result = await start_instance(def_id=1, body=body)
    inst_id = result["instance_id"]

    cancel_result = await cancel_instance(inst_id)
    assert cancel_result["status"] == "cancelled"

    inst = await get_instance(inst_id)
    assert inst["status"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_instance_not_found():
    """Cancel nonexistent instance returns 404."""
    from fastapi import HTTPException
    from app.api.workflow import cancel_instance
    with pytest.raises(HTTPException) as exc_info:
        await cancel_instance(inst_id=9999)
    assert exc_info.value.status_code == 404


# ── Legacy act endpoint ──────────────────────────────────

@pytest.mark.asyncio
async def test_legacy_act_approve():
    """Legacy /act endpoint works with action=approve."""
    from app.api.workflow import start_instance, approve_or_reject
    body = _make_start_request("Legacy审批")
    result = await start_instance(def_id=1, body=body)
    inst_id = result["instance_id"]

    action_result = await approve_or_reject(inst_id, _make_legacy_action("approve"))
    assert action_result["status"] == "approved"


@pytest.mark.asyncio
async def test_legacy_act_reject():
    """Legacy /act endpoint works with action=reject."""
    from app.api.workflow import start_instance, approve_or_reject
    body = _make_start_request("Legacy驳回")
    result = await start_instance(def_id=1, body=body)
    inst_id = result["instance_id"]

    action_result = await approve_or_reject(inst_id, _make_legacy_action("reject"))
    assert action_result["status"] == "rejected"


@pytest.mark.asyncio
async def test_legacy_act_invalid_action():
    """Legacy /act endpoint rejects invalid action."""
    from fastapi import HTTPException
    from app.api.workflow import approve_or_reject
    with pytest.raises(HTTPException) as exc_info:
        await approve_or_reject(inst_id=1, body=_make_legacy_action("invalid"))
    assert exc_info.value.status_code == 400


# ── Notifications ────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_notifications():
    """GET /workflow/notifications returns user notifications."""
    from app.api.workflow import list_notifications
    result = await list_notifications(user_id=2)
    assert "data" in result
    assert len(result["data"]) >= 1


@pytest.mark.asyncio
async def test_mark_notification_read():
    """POST /workflow/notifications/{id}/read marks as read."""
    from app.api.workflow import mark_read
    result = await mark_read(notif_id=1)
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_mark_all_read():
    """POST /workflow/notifications/read-all marks all as read."""
    from app.api.workflow import mark_all_read
    result = await mark_all_read(user_id=2)
    assert result["ok"] is True


# ── Stats ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_workflow_stats():
    """GET /workflow/stats returns summary counts."""
    from app.api.workflow import workflow_stats
    result = await workflow_stats()
    assert result["total_definitions"] >= 2
    assert result["total_instances"] >= 2
    assert "instances_by_status" in result
    assert "pending" in result["instances_by_status"]


# ── End-to-end flow test ─────────────────────────────────

@pytest.mark.asyncio
async def test_full_workflow_lifecycle():
    """End-to-end: create -> start -> approve (multi-step) -> complete."""
    from app.api.workflow import (
        create_definition,
        start_instance,
        list_instances,
        approve_step,
        get_instance,
    )

    # 1. Create a new workflow definition
    wf_body = _make_wf_create("E2E测试流程", steps=[
        {"name": "提交", "type": "start"},
        {"name": "组长审批", "type": "approval", "assignee_role": "team_lead"},
        {"name": "经理审批", "type": "approval", "assignee_role": "manager"},
        {"name": "结束", "type": "end"},
    ])
    wf_result = await create_definition(wf_body)
    wf_id = wf_result["id"]

    # 2. Start instance
    start_body = _make_start_request(
        "E2E测试申请",
        resource_type="orders",
        resource_id=99,
        variables={"priority": "high"},
    )
    start_result = await start_instance(def_id=wf_id, body=start_body)
    inst_id = start_result["instance_id"]
    assert start_result["status"] == "pending"

    # 3. Verify instance appears in listing
    listing = await list_instances(workflow_id=wf_id)
    assert len(listing["data"]) >= 1

    # 4. Approve first step
    approve1 = await approve_step(inst_id, _make_approval_request("组长同意", user_id=10))
    assert approve1["status"] == "pending"
    assert approve1["current_step"] > start_result["current_step"]

    # 5. Approve second step — completes the workflow
    approve2 = await approve_step(inst_id, _make_approval_request("经理同意", user_id=11))
    assert approve2["status"] == "approved"

    # 6. Verify final state
    inst = await get_instance(inst_id)
    assert inst["status"] == "approved"
    acted_approvals = [a for a in inst["approvals"] if a["action"] == "approve"]
    assert len(acted_approvals) == 2


@pytest.mark.asyncio
async def test_full_workflow_with_rejection():
    """End-to-end: create -> start -> reject at intermediate step."""
    from app.api.workflow import (
        create_definition,
        start_instance,
        approve_step,
        reject_step,
        get_instance,
    )

    wf_body = _make_wf_create("拒绝测试流程", steps=[
        {"name": "提交", "type": "start"},
        {"name": "步骤A", "type": "approval", "assignee_role": "role_a"},
        {"name": "步骤B", "type": "approval", "assignee_role": "role_b"},
        {"name": "结束", "type": "end"},
    ])
    wf_result = await create_definition(wf_body)
    wf_id = wf_result["id"]

    start_body = _make_start_request("拒绝测试")
    start_result = await start_instance(def_id=wf_id, body=start_body)
    inst_id = start_result["instance_id"]

    # Approve step A
    await approve_step(inst_id, _make_approval_request("通过A", user_id=10))

    # Reject at step B
    reject_result = await reject_step(inst_id, _make_approval_request("不通过B", user_id=11))
    assert reject_result["status"] == "rejected"

    # Verify final state
    inst = await get_instance(inst_id)
    assert inst["status"] == "rejected"


# ── Test helpers ─────────────────────────────────────────

def _make_start_request(title, **kwargs):
    from app.api.workflow import WorkflowStartRequest
    return WorkflowStartRequest(
        title=title,
        form_data=kwargs.get("form_data"),
        resource_type=kwargs.get("resource_type"),
        resource_id=kwargs.get("resource_id"),
        variables=kwargs.get("variables"),
    )


def _make_approval_request(comment, user_id=1):
    from app.api.workflow import StepApprovalRequest
    return StepApprovalRequest(comment=comment, user_id=user_id)


def _make_legacy_action(action, comment=None):
    from app.api.workflow import ApprovalAction
    return ApprovalAction(action=action, comment=comment)


def _make_wf_create(name, steps=None):
    from app.api.workflow import WorkflowDefCreate
    return WorkflowDefCreate(
        name=name,
        description="test workflow",
        steps=steps,
    )
