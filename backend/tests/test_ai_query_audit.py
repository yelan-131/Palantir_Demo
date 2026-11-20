"""AI business query audit through the tool boundary and platform API."""

import json
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import FastAPI, Header, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import admin, ai_assistant
from app.api.deps import get_current_user
from app.core import db
from app.models.relational import AuditLog
from app.services.ai.settings import DEFAULT_ROLE_POLICIES, settings_snapshot
from app.services.ai.tool_envelope import ToolExecutionEnvelope


ADMIN = {"uid": 10, "sub": "admin", "tenant_id": 1, "is_admin": True, "roles": ["admin"]}
VIEWER = {"uid": 11, "sub": "viewer", "tenant_id": 1, "is_admin": False, "roles": ["viewer"]}
OTHER_ADMIN = {**ADMIN, "uid": 20, "tenant_id": 2}
QUERY_TOOL = "forms.get_record"
TOOL_ARGS = {"form_code": "fixture_work_order", "record_id": 1}


@pytest_asyncio.fixture
async def audit_client(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(AuditLog.__table__.create)
    monkeypatch.setattr(db, "AsyncSessionLocal", async_sessionmaker(engine))
    ai_settings = {
        **settings_snapshot(),
        "aiEnabled": True,
        "qaEnabled": True,
        "auditEnabled": True,
        "agentMode": "readonly",
        "rolePolicies": DEFAULT_ROLE_POLICIES,
    }
    monkeypatch.setattr(ai_assistant, "AI_SYSTEM_SETTINGS", ai_settings)
    monkeypatch.setattr(ai_assistant, "_load_effective_ai_settings", AsyncMock())
    monkeypatch.setattr(ai_assistant, "_normalize_user", AsyncMock(side_effect=dict))
    application = FastAPI()
    application.include_router(ai_assistant.router, prefix="/ai")
    application.include_router(admin.router, prefix="/admin")

    async def test_identity(x_test_actor: str = Header(default="admin")):
        return dict({"admin": ADMIN, "viewer": VIEWER, "other": OTHER_ADMIN}[x_test_actor])

    application.dependency_overrides[get_current_user] = test_identity
    try:
        async with AsyncClient(transport=ASGITransport(app=application), base_url="http://test") as client:
            yield client, ai_settings
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_query_success_and_pre_model_denial_persist_in_tenant_audit(audit_client, monkeypatch):
    client, ai_settings = audit_client
    envelope = ToolExecutionEnvelope()
    handler = AsyncMock(return_value={
        "form": {"id": 7, "code": "fixture_work_order"},
        "record": {"id": 1, "data": {"assignee": "SECRET_RECORD_VALUE"}},
    })
    monkeypatch.setattr(envelope, "_dispatch", handler)
    run_model = AsyncMock(side_effect=AssertionError("Unauthorized query must not call the model"))
    monkeypatch.setattr(ai_assistant, "run_agent", run_model)

    tool_result = await envelope.execute_tool(
        tool_name=QUERY_TOOL, payload=TOOL_ARGS, settings=ai_settings, current_user=ADMIN,
        run_id="run-0123456789ab",
    )
    assert tool_result["status"] == "completed"
    denied = await client.post("/ai/agent/stream", headers={"X-Test-Actor": "viewer"}, json={
        "message": "只读查询工单 AI-TEST-WO-000000 的状态和处理人。SECRET_VIEWER_PROMPT",
    })
    assert denied.status_code == 200
    assert "event: run.failed" in denied.text
    assert '"status_code": 403' in denied.text
    run_model.assert_not_awaited()

    response = await client.get("/admin/audit-logs", params={"resource_type": "ai_assistant"})
    assert response.status_code == 200
    assert response.json()["total"] == 2
    audit_entries = {entry["action"]: entry for entry in response.json()["data"]}
    success = audit_entries["ai_query_succeeded"]
    blocked = audit_entries["ai_query_denied"]
    assert success["user_id"] == ADMIN["uid"]
    assert blocked["user_id"] == VIEWER["uid"]
    assert all(entry["tenant_id"] == 1 for entry in audit_entries.values())
    success_details = json.loads(success["new_values"])
    blocked_details = json.loads(blocked["new_values"])
    assert success_details["tool"] == QUERY_TOOL
    assert success_details["reason"]
    assert blocked_details["capability"] == "business_query"
    assert blocked_details["reason_code"] == "AI_QUERY_POLICY_DENIED"
    assert blocked_details["reason"]
    assert "SECRET_RECORD_VALUE" not in response.text
    assert "SECRET_VIEWER_PROMPT" not in response.text

    compatibility_response = await client.get("/ai/audit")
    assert compatibility_response.status_code == 200
    assert {entry["id"] for entry in compatibility_response.json()["data"]} == {
        success["id"], blocked["id"],
    }
    for path in ("/admin/audit-logs", "/ai/audit"):
        other_response = await client.get(path, headers={"X-Test-Actor": "other"})
        assert other_response.status_code == 200
        assert other_response.json()["data"] == []
        viewer_response = await client.get(path, headers={"X-Test-Actor": "viewer"})
        assert viewer_response.status_code == 403


@pytest.mark.asyncio
async def test_query_audit_reports_data_permission_failure_only_when_enabled(audit_client, monkeypatch):
    client, ai_settings = audit_client
    envelope = ToolExecutionEnvelope()
    handler = AsyncMock(side_effect=[
        HTTPException(403, "SECRET_DATA_PERMISSION_DETAIL"),
        HTTPException(404, "Form not found"),
        HTTPException(403, "Audit disabled"),
    ])
    monkeypatch.setattr(envelope, "_dispatch", handler)
    for audit_enabled in (True, True, False):
        result = await envelope.execute_tool(
            tool_name=QUERY_TOOL, payload=TOOL_ARGS, settings={**ai_settings, "auditEnabled": audit_enabled},
            current_user=ADMIN,
        )
        assert result["status"] == "failed"

    response = await client.get("/admin/audit-logs", params={"action": "ai_query_denied"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    details = json.loads(response.json()["data"][0]["new_values"])
    assert details["reason_code"] == "AI_QUERY_ACCESS_DENIED"
    assert details["tool"] == QUERY_TOOL
    assert "SECRET_DATA_PERMISSION_DETAIL" not in response.text
