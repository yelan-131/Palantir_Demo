import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api import workflow
from app.models.relational import Notification, User, WorkflowApproval, WorkflowBinding, WorkflowInstance
from app.services.workflow_cc import notify_reached
from app.services.workflow_definitions import WorkflowDefCreate, stage_workflow_definition
from app.services.workflow_routing import route_node_ids, validate_graph
from tests.test_record_service import environment


def cc_node(name):
    return {"id": name, "type": "ccTask", "label": name, "ccRecipients": [
        {"type": "user", "value": "2"},
        {"type": "role", "value": "reader"},
        {"type": "user", "value": "3"},
        {"type": "user", "value": "4"},
    ]}


def connected(*nodes):
    nodes = [{"id": "start", "type": "startEvent"}, *nodes, {"id": "end", "type": "endEvent"}]
    edges = [
        {"source": source["id"], "target": target["id"]}
        for source, target in zip(nodes, nodes[1:])
    ]
    return {"nodes": nodes, "edges": edges}


def test_new_publications_require_cc_recipients_without_breaking_old_snapshots():
    config = connected({"id": "cc", "type": "ccTask"})
    with pytest.raises(HTTPException, match="至少需要配置"):
        validate_graph(config, require_cc_recipients=True)
    assert route_node_ids(config, {}) == ["start", "cc", "end"]
    config["nodes"][1] = cc_node("cc")
    validate_graph(config, require_cc_recipients=True)


async def cc_messages(db, instance_id):
    return (await db.scalars(select(Notification).where(
        Notification.type == "workflow_cc", Notification.resource_id == instance_id,
    ).order_by(Notification.id))).all()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["approve", "reject"])
async def test_standalone_cc_follows_executed_stages_and_never_stalls_approval(environment, monkeypatch, action):
    db, _, _, user, _ = environment
    db.add_all([
        User(id=3, tenant_id=1, username="inactive", hashed_password="test", is_active=False),
        User(id=4, tenant_id=2, username="foreign", hashed_password="test", is_active=True),
    ])
    config = connected(cc_node("first"), {
        "id": "review", "type": "userTask", "assigneeRules": [{"type": "user", "value": "1"}],
    }, cc_node("last"))
    definition = await stage_workflow_definition(db, WorkflowDefCreate(name="CC", config=config, status="published"), user)
    await db.commit()

    async def query(callback):
        return await callback(db)

    async def audit(**_):
        pass

    monkeypatch.setattr(workflow, "_try_db", query)
    monkeypatch.setattr(workflow, "write_audit_log", audit)
    result = await workflow.start_instance(definition.id, workflow.WorkflowStartRequest(title="Private record title"), user)
    instance = await db.get(WorkflowInstance, result["instance_id"])
    notifications = await cc_messages(db, instance.id)
    assert [(notice.user_id, notice.content.endswith("「first」。")) for notice in notifications] == [(1, True), (2, True)]
    assert all("Private record title" not in notice.title + notice.content for notice in notifications)
    assert instance.status == "pending"
    await workflow._act_on_step(instance.id, workflow.StepApprovalRequest(comment="Test"), action, user, db)
    notifications = await cc_messages(db, instance.id)
    assert [notice.user_id for notice in notifications] == ([1, 2, 1, 2] if action == "approve" else [1, 2])
    assert instance.status == ("approved" if action == "approve" else "rejected")
    if action == "approve":
        state = json.loads(instance.workflow_state)
        await notify_reached(db, instance, state, [{
            "node_id": "last", "name": "last", "type": "notification",
            "cc_recipients": cc_node("last")["ccRecipients"],
        }])
        assert len(await cc_messages(db, instance.id)) == 4


@pytest.mark.asyncio
async def test_form_with_only_cc_completes_and_notifies_without_approval(environment):
    db, _, form, user, client = environment
    definition = await stage_workflow_definition(
        db, WorkflowDefCreate(name="CC only", config=connected(cc_node("cc")), status="published"), user,
    )
    db.add(WorkflowBinding(tenant_id=1, form_id=form.id, workflow_id=definition.id, enabled=True, trigger_action="submit"))
    await db.commit()

    created = await client.post(f"/forms/{form.id}/records", json={"data": {"title": "Request"}})
    assert created.status_code == 200, created.text
    record_id = created.json()["data"]["id"]
    submitted = await client.post(f"/forms/{form.id}/records/{record_id}/submit", json={"expected_status": "draft"})
    assert submitted.status_code == 200, submitted.text
    record = submitted.json()["data"]
    instance_id = record["workflow_instances"][0]["instance_id"]
    assert record["status"] == "approved"
    assert [notice.user_id for notice in await cc_messages(db, instance_id)] == [1, 2]
    assert await db.scalar(select(WorkflowApproval.id).where(WorkflowApproval.instance_id == instance_id)) is None
