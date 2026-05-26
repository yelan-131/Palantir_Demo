"""API contract tests for AI provider, Agent, and knowledge ingestion routes."""

from __future__ import annotations

import io
import asyncio

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def clear_ingested_knowledge():
    from app.services.ai import knowledge_ingestion
    from app.services.ai.agent_runs import AGENT_RUNS
    from app.services.ai.audit import AI_AUDIT_LOGS
    from app.services.ai.confirmations import CONFIRMATIONS

    for store in (
        knowledge_ingestion.ASSETS,
        knowledge_ingestion.DOCUMENTS,
        knowledge_ingestion.CHUNKS,
        knowledge_ingestion.JOBS,
        AGENT_RUNS,
        CONFIRMATIONS,
    ):
        store.clear()
    AI_AUDIT_LOGS.clear()
    yield
    for store in (
        knowledge_ingestion.ASSETS,
        knowledge_ingestion.DOCUMENTS,
        knowledge_ingestion.CHUNKS,
        knowledge_ingestion.JOBS,
        AGENT_RUNS,
        CONFIRMATIONS,
    ):
        store.clear()
    AI_AUDIT_LOGS.clear()


@pytest.fixture()
def client():
    from app.api.ai_assistant import router as ai_router
    from app.api.knowledge import router as knowledge_router

    app = FastAPI()
    app.include_router(ai_router, prefix="/api/v1/ai")
    app.include_router(knowledge_router, prefix="/api/v1/knowledge")
    return TestClient(app)


@pytest.fixture()
def ai_user_client():
    from app.api.ai_assistant import router as ai_router
    from app.api.deps import get_current_user
    from app.api.knowledge import router as knowledge_router

    async def _current_user():
        return {
            "sub": "qe_wang",
            "uid": 5,
            "is_admin": False,
            "roles": [{"id": 4, "name": "quality_engineer", "label": "Quality engineer"}],
        }

    app = FastAPI()
    app.dependency_overrides[get_current_user] = _current_user
    app.include_router(ai_router, prefix="/api/v1/ai")
    app.include_router(knowledge_router, prefix="/api/v1/knowledge")
    return TestClient(app)


def test_ai_provider_test_accepts_mock_config(client):
    response = client.post(
        "/api/v1/ai/provider/test",
        json={
            "provider_config": {
                "provider": "mock",
                "chat_model": "mock-chat",
                "embedding_model": "mock-embedding",
            }
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data == {
        "ok": True,
        "provider": "mock",
        "model": "mock-chat",
        "message": "Provider configuration accepted",
    }


def test_ai_provider_test_reports_glm_missing_key_without_crashing(client):
    response = client.post(
        "/api/v1/ai/provider/test",
        json={
            "provider_config": {
                "provider": "glm",
                "chat_model": "glm-4-flash",
                "api_key": "",
            }
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["provider"] == "glm"
    assert "glm API key is not configured" in data["message"]


def test_ai_provider_test_accepts_glm_when_key_is_present(client):
    response = client.post(
        "/api/v1/ai/provider/test",
        json={
            "provider_config": {
                "provider": "glm",
                "chat_model": "glm-4-flash",
                "embedding_model": "embedding-3",
                "api_key": "test-key",
            }
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["provider"] == "glm"
    assert data["model"] == "glm-4-flash"


def test_saved_ai_settings_default_to_glm_and_report_missing_key(client):
    settings = client.get("/api/v1/ai/settings")
    assert settings.status_code == 200
    data = settings.json()["data"]
    assert data["provider"] == "glm"
    assert data["baseUrl"] == "https://open.bigmodel.cn/api/paas/v4"
    assert data["chatModel"] == "glm-4-flash"
    assert data["embeddingModel"] == "embedding-3"
    assert data["apiKey"] == ""

    response = client.post("/api/v1/ai/settings/test")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["provider"] == "glm"
    assert "glm API key is not configured" in payload["message"]


def test_agent_endpoint_rejects_guest_by_default(client):
    response = client.post("/api/v1/ai/agent", json={"message": "draft a CAPA"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Guest access to AI is disabled"


def test_agent_endpoint_returns_draft_action_with_uploaded_evidence(ai_user_client):
    upload = ai_user_client.post(
        "/api/v1/knowledge/assets/upload",
        params={"permission_scope": "enterprise", "owner_user_id": "api-tester"},
        files={
            "file": (
                    "quality-process.md",
                    b"# CAPA Rule\n\nQuality CAPA drafts require category, containment, and owner approval.",
                "text/markdown",
            )
        },
    )
    assert upload.status_code == 200
    assert upload.json()["ok"] is True

    response = ai_user_client.post(
        "/api/v1/ai/agent",
            json={"message": "draft a quality CAPA using the category rule"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "assisted"
    assert data["requires_confirmation"] is True
    assert data["actions"][0]["skill"] == "quality.create_capa_draft"
    assert data["actions"][0]["requires_confirmation"] is True
    assert data["run_id"].startswith("run-")
    assert data["confirmation_payload"]["confirmation_token"].startswith("confirm-")
    assert data["steps"]
    assert data["evidence"]
    assert data["evidence"][0]["source_file_name"] == "quality-process.md"


def test_skill_tool_and_agent_run_lifecycle(ai_user_client):
    skills = ai_user_client.get("/api/v1/ai/skills")
    assert skills.status_code == 200
    assert any(item["name"] == "quality.create_capa_draft" for item in skills.json()["data"])

    tools = ai_user_client.get("/api/v1/ai/tools")
    assert tools.status_code == 200
    assert any(item["name"] == "knowledge.search" for item in tools.json()["data"])

    created = ai_user_client.post("/api/v1/ai/agent-runs", json={"message": "draft a quality CAPA"})
    assert created.status_code == 200
    run_payload = created.json()
    token = run_payload["confirmation_payload"]["confirmation_token"]
    run_id = run_payload["run_id"]

    fetched = ai_user_client.get(f"/api/v1/ai/agent-runs/{run_id}")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["status"] == "waiting_confirmation"

    confirmed = ai_user_client.post(
        f"/api/v1/ai/agent-runs/{run_id}/confirm",
        json={"confirmation_token": token, "confirmed": True},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["data"]["status"] == "confirmed"

    cancelled_run = ai_user_client.post("/api/v1/ai/agent-runs", json={"message": "draft a quality CAPA"})
    cancel_response = ai_user_client.post(f"/api/v1/ai/agent-runs/{cancelled_run.json()['run_id']}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["data"]["status"] == "cancelled"


def test_confirmed_ai_draft_can_be_saved_by_allowed_role(ai_user_client):
    response = ai_user_client.post(
        "/api/v1/ai/drafts/save",
        json={
            "skill": "quality.create_capa_draft",
            "payload": {"problem": "defect rate rising"},
            "evidence": [{"document_id": "doc-demo"}],
            "confirmation": {"confirmed": True},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["data"]["status"] == "draft"
    assert data["data"]["skill"] == "quality.create_capa_draft"


def test_ai_draft_save_requires_confirmation(ai_user_client):
    response = ai_user_client.post(
        "/api/v1/ai/drafts/save",
        json={
            "skill": "quality.create_capa_draft",
            "payload": {"problem": "defect rate rising"},
            "confirmation": {"confirmed": False},
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "User confirmation is required before saving AI draft"


def test_markdown_upload_job_markdown_and_chunk_endpoints(client):
    upload = client.post(
        "/api/v1/knowledge/assets/upload",
        params={"permission_scope": "team-quality", "owner_user_id": "qa-user"},
        files={
            "file": (
                "quality-sop.md",
                b"# Quality SOP\n\n## Containment\n\nFreeze affected batches before CAPA draft.",
                "text/markdown",
            )
        },
    )

    assert upload.status_code == 200
    payload = upload.json()
    assert payload["ok"] is True
    result = payload["data"]
    assert result["job"]["status"] == "completed"
    assert result["asset"]["permission_scope"] == "team-quality"
    assert result["document"]["markdown_content"].startswith("# Quality SOP")
    assert result["chunks"][0]["source_location"] == "section:1"

    job = client.get(f"/api/v1/knowledge/ingestion-jobs/{result['job']['job_id']}")
    assert job.status_code == 200
    assert job.json()["data"]["status"] == "completed"

    markdown = client.get(f"/api/v1/knowledge/documents/{result['document']['document_id']}/markdown")
    assert markdown.status_code == 200
    assert "Freeze affected batches" in markdown.json()["data"]["markdown_content"]

    chunks = client.get(f"/api/v1/knowledge/documents/{result['document']['document_id']}/chunks")
    assert chunks.status_code == 200
    assert chunks.json()["data"][0]["permission_scope"] == "team-quality"


def test_excel_upload_is_converted_to_markdown_and_searchable(client):
    buffer = io.BytesIO()
    frame = pd.DataFrame({"material": ["M-001", "M-002"], "rule": ["standard", "critical"]})
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name="Rules", index=False)

    upload = client.post(
        "/api/v1/knowledge/assets/upload",
        files={
            "file": (
                "rules.xlsx",
                buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert upload.status_code == 200
    result = upload.json()["data"]
    assert result["job"]["status"] == "completed"
    assert result["document"]["source_type"] == "excel"
    assert "## Sheet: Rules" in result["document"]["markdown_content"]

    response = client.post("/api/v1/knowledge/search", json={"query": "M-002 critical rule", "limit": 3})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["query"] == "M-002 critical rule"
    assert any(item["document_id"] == result["document"]["document_id"] for item in data["results"])
    assert all("source_location" in item for item in data["results"])


def test_knowledge_search_rejects_blank_query(client):
    response = client.post("/api/v1/knowledge/search", json={"query": "   "})

    assert response.status_code == 400
    assert response.json()["detail"] == "Search query cannot be empty"


def test_knowledge_directories_can_be_created_updated_and_moved(client):
    initial = client.get("/api/v1/knowledge/directories")
    assert initial.status_code == 200
    assert initial.json()["data"]["tree"]

    created = client.post(
        "/api/v1/knowledge/directories",
        json={"name": "APS project", "parent_id": "dir-enterprise", "scope": "project", "sort_order": 42},
    )
    assert created.status_code == 200
    directory_id = created.json()["data"]["id"]

    updated = client.put(f"/api/v1/knowledge/directories/{directory_id}", json={"name": "APS planning project"})
    assert updated.status_code == 200
    assert updated.json()["data"]["name"] == "APS planning project"

    moved = client.post(f"/api/v1/knowledge/directories/{directory_id}/move", json={"parent_id": "dir-quality", "sort_order": 5})
    assert moved.status_code == 200
    assert moved.json()["data"]["parent_id"] == "dir-quality"


async def _reset_ai_runtime_tables():
    from sqlalchemy import delete

    from app.core.db import db_session
    from app.models.relational import AIAgentRun, AIConversation, AIMemoryEntry, AIMessage, AIToolCall, AuditLog

    async with db_session() as session:
        for model in (AIMemoryEntry, AIToolCall, AIAgentRun, AIMessage, AIConversation):
            await session.execute(delete(model))
        await session.execute(delete(AuditLog).where(AuditLog.resource_type == "ai_agent_run"))
        await session.commit()


def _ensure_ai_runtime_schema():
    from app.database import DB_TYPE, _engine, init_db
    from app.models.relational import AIAgentRun, AIConversation, AIMemoryEntry, AIMessage, AIToolCall

    asyncio.run(init_db())
    if DB_TYPE != "sqlite":
        async def _create_agent_tables():
            async with _engine.begin() as conn:
                await conn.run_sync(
                    lambda sync_conn: AIToolCall.metadata.create_all(
                        sync_conn,
                        tables=[
                            AIConversation.__table__,
                            AIMessage.__table__,
                            AIAgentRun.__table__,
                            AIToolCall.__table__,
                            AIMemoryEntry.__table__,
                        ],
                    )
                )

        asyncio.run(_create_agent_tables())
    asyncio.run(_reset_ai_runtime_tables())


def test_knowledge_agent_conversation_resume_and_message_persistence(ai_user_client):
    _ensure_ai_runtime_schema()

    created = ai_user_client.post(
        "/api/v1/knowledge/agent/conversations",
        json={"document_id": "doc-welding-sop", "document_title": "焊点虚焊异常处置 SOP"},
    )
    assert created.status_code == 200
    conversation_id = created.json()["data"]["conversation_id"]

    resumed = ai_user_client.post(
        "/api/v1/knowledge/agent/conversations",
        json={"document_id": "doc-welding-sop", "document_title": "焊点虚焊异常处置 SOP"},
    )
    assert resumed.status_code == 200
    assert resumed.json()["data"]["conversation_id"] == conversation_id

    sent = ai_user_client.post(
        f"/api/v1/knowledge/agent/conversations/{conversation_id}/messages",
        json={"content": "继续分析上下游风险"},
    )
    assert sent.status_code == 200
    payload = sent.json()["data"]
    assert payload["user_message"]["role"] == "user"
    assert payload["assistant_message"]["role"] == "assistant"
    assert payload["run"]["run_id"].startswith("run-")
    assert payload["run"]["steps"][2]["tool"] == "knowledge.search"
    assert payload["evidence"]

    messages = ai_user_client.get(f"/api/v1/knowledge/agent/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assert [item["role"] for item in messages.json()["data"]] == ["user", "assistant"]

    async def _counts():
        from sqlalchemy import func, select

        from app.core.db import db_session
        from app.models.relational import AIAgentRun, AIMessage, AIToolCall, AuditLog

        async with db_session() as session:
            return {
                "messages": await session.scalar(select(func.count(AIMessage.id))),
                "runs": await session.scalar(select(func.count(AIAgentRun.id))),
                "tool_calls": await session.scalar(select(func.count(AIToolCall.id))),
                "audit": await session.scalar(select(func.count(AuditLog.id)).where(AuditLog.resource_type == "ai_agent_run")),
            }

    counts = asyncio.run(_counts())
    assert counts == {"messages": 2, "runs": 1, "tool_calls": 1, "audit": 1}


def test_knowledge_agent_rejects_blank_and_unknown_conversation(ai_user_client):
    _ensure_ai_runtime_schema()

    blank = ai_user_client.post("/api/v1/knowledge/agent/conversations/missing/messages", json={"content": "   "})
    assert blank.status_code == 400
    assert blank.json()["detail"] == "Message content cannot be empty"

    missing = ai_user_client.get("/api/v1/knowledge/agent/conversations/missing/messages")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Agent conversation not found"
