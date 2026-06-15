"""Tests for the Workflow Engine — DB-backed.

Covers definition CRUD + version snapshots, instance lifecycle, step
authorization (approver-only actions, admin override), terminal-state
protection, countersign, version pinning for in-flight instances, and
notification scoping. All tests exercise the real SQLite branch — the old
in-module mock store is gone.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from types import SimpleNamespace

TENANT_ID = 1


# ── Auth/test helpers ─────────────────────────────────────

def _token(uid: int, *, is_admin: bool = False) -> str:
    from app.core.security import create_access_token

    return create_access_token(
        f"wf-user-{uid}",
        extra={
            "uid": uid,
            "tenant_id": TENANT_ID,
            "is_admin": is_admin,
            "roles": [{"id": 1, "name": "admin" if is_admin else "member"}],
        },
    )


def _headers(uid: int, *, is_admin: bool = False) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(uid, is_admin=is_admin)}"}


def _uid() -> int:
    return 1_000_000 + (uuid.uuid4().int % 8_000_000)


def _seed_users(uids: list[int]) -> None:
    from app.core.db import db_session
    from app.models.relational import User

    async def _run():
        async with db_session() as session:
            for uid in uids:
                session.add(User(
                    id=uid,
                    tenant_id=TENANT_ID,
                    username=f"wf-user-{uid}",
                    display_name=f"WF User {uid}",
                    email=f"wf-{uid}@test.local",
                    hashed_password="not-a-real-hash",
                    is_active=True,
                ))
            await session.commit()

    asyncio.run(_run())


def _definition_payload(
    name: str,
    approver_steps: list[list[int]],
    *,
    status: str = "published",
    approval_mode: str | None = None,
) -> dict:
    steps: list[dict] = [{"name": "开始", "type": "start"}]
    for index, approvers in enumerate(approver_steps):
        step = {
            "name": f"审批{index + 1}",
            "type": "approval",
            "node_id": f"approval-{index + 1}",
            "assignee_rules": [{"type": "user", "value": [str(uid) for uid in approvers]}],
        }
        if approval_mode:
            step["approval_mode"] = approval_mode
        steps.append(step)
    steps.append({"name": "结束", "type": "end"})
    return {
        "name": name,
        "description": "workflow engine test",
        "config": {"nodes": [], "edges": []},
        "form_config": {"fields": []},
        "steps": steps,
        "status": status,
    }


def _ok(response, context: str) -> dict:
    assert response.status_code < 400, f"{context}: {response.status_code} {response.text}"
    return response.json()


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


# ── Pure helper tests (no DB) ────────────────────────────

def test_workflow_view_status_is_user_scoped():
    from app.api.workflow import _workflow_view_status_for_user

    user = {"uid": 2, "is_admin": False}
    pending_instance = SimpleNamespace(status="pending", initiator_id=9)
    assert _workflow_view_status_for_user(
        pending_instance, [SimpleNamespace(approver_id=2, action=None)], user
    ) == "pending"
    assert _workflow_view_status_for_user(
        pending_instance, [SimpleNamespace(approver_id=2, action="approve")], user
    ) == "running"
    assert _workflow_view_status_for_user(
        SimpleNamespace(status="rejected", initiator_id=2),
        [SimpleNamespace(approver_id=3, action="reject")],
        user,
    ) == "rejected"
    assert _workflow_view_status_for_user(
        pending_instance, [SimpleNamespace(approver_id=3, action=None)], user
    ) is None


def test_get_steps_from_workflow_with_top_level_steps():
    from app.api.workflow import _get_steps_from_workflow

    wf = {"steps": [{"name": "审批", "type": "approval"}]}
    assert _get_steps_from_workflow(wf) == [{"name": "审批", "type": "approval"}]


def test_get_steps_from_workflow_from_config_nodes():
    from app.api.workflow import _get_steps_from_workflow

    wf = {
        "config": {
            "nodes": [
                {"id": "start", "type": "start", "data": {"label": "发起"}},
                {"id": "review", "type": "approval", "data": {"label": "审批", "approver_role": "manager"}},
                {"id": "end", "type": "end", "data": {"label": "结束"}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "review"},
                {"id": "e2", "source": "review", "target": "end"},
            ],
        }
    }
    steps = _get_steps_from_workflow(wf)
    assert [step["type"] for step in steps] == ["start", "approval", "end"]
    assert steps[1]["assignee_role"] == "manager"


def test_find_first_and_next_actionable_step():
    from app.api.workflow import _find_first_approval_step, _find_next_actionable_step

    steps = [
        {"type": "start"},
        {"type": "approval"},
        {"type": "notification"},
        {"type": "approval"},
        {"type": "end"},
    ]
    assert _find_first_approval_step(steps) == 1
    assert _find_next_actionable_step(steps, 1) == 3
    assert _find_next_actionable_step(steps, 3) is None


def test_is_last_step():
    from app.api.workflow import _is_last_step

    steps = [{"type": "start"}, {"type": "approval"}, {"type": "end"}]
    assert _is_last_step(steps, 1) is True
    assert _is_last_step(steps, 0) is False


# ── Definition CRUD + snapshots ──────────────────────────

def test_create_definition_requires_admin(client):
    uid = _uid()
    _seed_users([uid])
    response = client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(uid),
        json=_definition_payload(f"wf-{uid}", [[uid]]),
    )
    assert response.status_code == 403


def test_definition_update_bumps_version_and_snapshots(client):
    admin = _uid()
    _seed_users([admin])
    payload = _definition_payload(f"wf-snap-{admin}", [[admin]])
    created = _ok(client.post("/api/v1/workflow/definitions", headers=_headers(admin, is_admin=True), json=payload), "create")
    assert created["version"] == 1

    updated = _ok(client.put(
        f"/api/v1/workflow/definitions/{created['id']}",
        headers=_headers(admin, is_admin=True),
        json=payload,
    ), "update")
    assert updated["version"] == 2

    from app.core.db import db_session
    from app.models.relational import WorkflowDefVersion
    from sqlalchemy import select

    async def _versions():
        async with db_session() as session:
            rows = (await session.execute(
                select(WorkflowDefVersion.version).where(WorkflowDefVersion.workflow_id == created["id"])
            )).scalars().all()
            return sorted(rows)

    assert asyncio.run(_versions()) == [1, 2]


def test_get_definition_not_found_is_404(client):
    admin = _uid()
    _seed_users([admin])
    response = client.get("/api/v1/workflow/definitions/99999999", headers=_headers(admin, is_admin=True))
    assert response.status_code == 404


def test_delete_definition_with_instances_is_409(client):
    admin = _uid()
    approver = _uid()
    _seed_users([admin, approver])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-del-{admin}", [[approver]]),
    ), "create")
    _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "del-guard"},
    ), "start")
    response = client.delete(f"/api/v1/workflow/definitions/{created['id']}", headers=_headers(admin, is_admin=True))
    assert response.status_code == 409


# ── Start: published gate + version pin ──────────────────

def test_start_requires_published_definition(client):
    admin = _uid()
    _seed_users([admin])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-draft-{admin}", [[admin]], status="draft"),
    ), "create draft")
    response = client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "should not start"},
    )
    assert response.status_code == 409


def test_start_pins_version_and_creates_first_approval(client):
    admin = _uid()
    initiator = _uid()
    approver = _uid()
    _seed_users([admin, initiator, approver])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-pin-{admin}", [[approver]]),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(initiator),
        json={"title": "pin-test"},
    ), "start")
    detail = _ok(client.get(f"/api/v1/workflow/instances/{started['instance_id']}", headers=_headers(initiator)), "detail")
    assert detail["workflow_version"] == 1
    assert detail["status"] == "pending"
    pending = [a for a in detail["approvals"] if a["action"] is None]
    assert [a["approver_id"] for a in pending] == [approver]


# ── Step authorization ───────────────────────────────────

def test_only_assigned_approver_can_act(client):
    admin = _uid()
    initiator = _uid()
    approver = _uid()
    outsider = _uid()
    _seed_users([admin, initiator, approver, outsider])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-auth-{admin}", [[approver]]),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(initiator),
        json={"title": "auth-test"},
    ), "start")

    denied = client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(outsider),
        json={"comment": "not mine"},
    )
    assert denied.status_code == 403

    approved = _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(approver),
        json={"comment": "ok"},
    ), "approve")
    assert approved["status"] == "approved"


def test_act_on_finalized_instance_is_409(client):
    admin = _uid()
    approver = _uid()
    _seed_users([admin, approver])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-final-{admin}", [[approver]]),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "final-test"},
    ), "start")
    _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(approver),
        json={},
    ), "approve")

    again = client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(approver),
        json={},
    )
    assert again.status_code == 409


def test_admin_override_records_own_approval_row(client):
    admin = _uid()
    approver = _uid()
    _seed_users([admin, approver])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-admin-{admin}", [[approver]]),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "admin-override"},
    ), "start")
    _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(admin, is_admin=True),
        json={"comment": "override"},
    ), "admin approve")

    detail = _ok(client.get(f"/api/v1/workflow/instances/{started['instance_id']}", headers=_headers(admin, is_admin=True)), "detail")
    actions = {a["approver_id"]: a["action"] for a in detail["approvals"]}
    assert actions[admin] == "approve"  # recorded under the admin's own identity
    assert actions[approver] == "skipped"  # original approver row untouched except skip


def test_countersign_waits_for_all_approvers(client):
    admin = _uid()
    first = _uid()
    second = _uid()
    _seed_users([admin, first, second])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-cs-{admin}", [[first, second]], approval_mode="countersign"),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "countersign"},
    ), "start")

    partial = _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(first),
        json={},
    ), "first approve")
    assert partial["status"] == "pending"

    duplicate = client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(first),
        json={},
    )
    assert duplicate.status_code == 409  # already acted on this node

    final = _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(second),
        json={},
    ), "second approve")
    assert final["status"] == "approved"


def test_reject_terminates_and_blocks_followups(client):
    admin = _uid()
    approver = _uid()
    _seed_users([admin, approver])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-rej-{admin}", [[approver]]),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "reject-test"},
    ), "start")
    rejected = _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/reject",
        headers=_headers(approver),
        json={"comment": "no"},
    ), "reject")
    assert rejected["status"] == "rejected"

    cancel = client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/cancel",
        headers=_headers(admin, is_admin=True),
    )
    assert cancel.status_code == 409


def test_cancel_limited_to_initiator_or_admin(client):
    admin = _uid()
    initiator = _uid()
    approver = _uid()
    outsider = _uid()
    _seed_users([admin, initiator, approver, outsider])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-cancel-{admin}", [[approver]]),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(initiator),
        json={"title": "cancel-test"},
    ), "start")

    denied = client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/cancel",
        headers=_headers(outsider),
    )
    assert denied.status_code == 403

    cancelled = _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/cancel",
        headers=_headers(initiator),
    ), "cancel")
    assert cancelled["status"] == "cancelled"


# ── Version pinning protects in-flight instances ─────────

def test_definition_edit_does_not_reshape_inflight_instance(client):
    admin = _uid()
    first = _uid()
    second = _uid()
    _seed_users([admin, first, second])
    two_step = _definition_payload(f"wf-vpin-{admin}", [[first], [second]])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=two_step,
    ), "create v1")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "v1-instance"},
    ), "start on v1")

    # Shrink the definition to a single approval step (becomes version 2).
    one_step = _definition_payload(f"wf-vpin-{admin}", [[first]])
    updated = _ok(client.put(
        f"/api/v1/workflow/definitions/{created['id']}",
        headers=_headers(admin, is_admin=True),
        json=one_step,
    ), "update to v2")
    assert updated["version"] == 2

    # The in-flight instance still follows the two-step v1 snapshot:
    # first approval must advance to step 2, not complete the workflow.
    moved = _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/approve",
        headers=_headers(first),
        json={},
    ), "approve step1 on v1 instance")
    assert moved["status"] == "pending"

    detail = _ok(client.get(f"/api/v1/workflow/instances/{started['instance_id']}", headers=_headers(admin, is_admin=True)), "detail")
    pending = [a for a in detail["approvals"] if a["action"] is None]
    assert [a["approver_id"] for a in pending] == [second]

    # A new instance follows v2 (single step): one approval completes it.
    started_v2 = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "v2-instance"},
    ), "start on v2")
    detail_v2 = _ok(client.get(f"/api/v1/workflow/instances/{started_v2['instance_id']}", headers=_headers(admin, is_admin=True)), "v2 detail")
    assert detail_v2["workflow_version"] == 2
    done = _ok(client.post(
        f"/api/v1/workflow/instances/{started_v2['instance_id']}/approve",
        headers=_headers(first),
        json={},
    ), "approve v2 instance")
    assert done["status"] == "approved"


# ── Notifications scoping ────────────────────────────────

def test_workflow_notifications_are_owner_scoped(client):
    admin = _uid()
    approver = _uid()
    outsider = _uid()
    _seed_users([admin, approver, outsider])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-notif-{admin}", [[approver]]),
    ), "create")
    _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": f"notif-{admin}"},
    ), "start")

    own = _ok(client.get("/api/v1/workflow/notifications", headers=_headers(approver)), "own feed")
    own_items = [n for n in own["data"] if n["title"] == f"待审批：notif-{admin}"]
    assert own_items, "approver should have received an approval notification"

    foreign = client.get(
        "/api/v1/workflow/notifications",
        params={"user_id": approver},
        headers=_headers(outsider),
    )
    assert foreign.status_code == 403

    steal_read = client.post(
        f"/api/v1/workflow/notifications/{own_items[0]['id']}/read",
        headers=_headers(outsider),
    )
    assert steal_read.status_code == 404

    marked = _ok(client.post(
        f"/api/v1/workflow/notifications/{own_items[0]['id']}/read",
        headers=_headers(approver),
    ), "mark own read")
    assert marked["ok"] is True

    _ok(client.post("/api/v1/workflow/notifications/read-all", headers=_headers(approver)), "read all own")


# ── Legacy /act endpoint uses token identity ─────────────

def test_legacy_act_endpoint_uses_token_identity(client):
    admin = _uid()
    approver = _uid()
    _seed_users([admin, approver])
    created = _ok(client.post(
        "/api/v1/workflow/definitions",
        headers=_headers(admin, is_admin=True),
        json=_definition_payload(f"wf-legacy-{admin}", [[approver]]),
    ), "create")
    started = _ok(client.post(
        f"/api/v1/workflow/definitions/{created['id']}/start",
        headers=_headers(admin, is_admin=True),
        json={"title": "legacy-act"},
    ), "start")
    acted = _ok(client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/act",
        headers=_headers(approver),
        json={"action": "approve", "comment": "via legacy"},
    ), "legacy act")
    assert acted["status"] == "approved"

    invalid = client.post(
        f"/api/v1/workflow/instances/{started['instance_id']}/act",
        headers=_headers(approver),
        json={"action": "noop"},
    )
    assert invalid.status_code == 400
