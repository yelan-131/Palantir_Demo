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

    _reset_ai_settings_to_defaults()
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
    _reset_ai_settings_to_defaults()
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


def _reset_ai_settings_to_defaults():
    from app.services.ai.settings import (
        DEFAULT_COMPACTION_POLICY,
        DEFAULT_CONTEXT_POLICY,
        DEFAULT_MEMORY_POLICY,
        DEFAULT_RAG_POLICY,
        DEFAULT_ROLE_POLICIES,
        DEFAULT_SAFETY_POLICY,
        save_persisted_ai_settings,
    )

    asyncio.run(
        save_persisted_ai_settings(
            {
                "aiEnabled": True,
                "provider": "glm",
                "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                "apiKey": "",
                "chatModel": "glm-5.1",
                "reasoningModel": "glm-5.1",
                "embeddingModel": "embedding-3",
                "visionModel": "glm-4v-plus",
                "agentMode": "draft",
                "ragEnabled": True,
                "guestAccess": "disabled",
                "rolePolicies": DEFAULT_ROLE_POLICIES,
                "riskPolicy": {
                    "low": "allow",
                    "medium": "confirm",
                    "high": "confirm_and_audit",
                    "critical": "blocked",
                },
                "forbiddenActions": ["auto_order", "delete_data", "change_permission"],
                "contextPolicy": DEFAULT_CONTEXT_POLICY,
                "ragPolicy": DEFAULT_RAG_POLICY,
                "memoryPolicy": DEFAULT_MEMORY_POLICY,
                "compactionPolicy": DEFAULT_COMPACTION_POLICY,
                "safetyPolicy": DEFAULT_SAFETY_POLICY,
            },
            updated_by="test",
        )
    )


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
            "tenant_id": 1,
            "is_admin": False,
            "roles": [{"id": 4, "name": "quality_engineer", "label": "Quality engineer"}],
        }

    app = FastAPI()
    app.dependency_overrides[get_current_user] = _current_user
    app.include_router(ai_router, prefix="/api/v1/ai")
    app.include_router(knowledge_router, prefix="/api/v1/knowledge")
    return TestClient(app)


@pytest.fixture()
def admin_client():
    from app.api.ai_assistant import router as ai_router
    from app.api.deps import get_current_user
    from app.api.knowledge import router as knowledge_router

    async def _current_user():
        return {
            "sub": "admin",
            "uid": 1,
            "tenant_id": 1,
            "is_admin": True,
            "roles": [{"id": 1, "name": "admin", "label": "Administrator"}],
        }

    app = FastAPI()
    app.dependency_overrides[get_current_user] = _current_user
    app.include_router(ai_router, prefix="/api/v1/ai")
    app.include_router(knowledge_router, prefix="/api/v1/knowledge")
    return TestClient(app)


def _knowledge_client_for_tenant(tenant_id: int) -> TestClient:
    from app.api.deps import get_current_user
    from app.api.knowledge import router as knowledge_router

    async def _current_user():
        return {
            "sub": f"tenant-{tenant_id}-user",
            "uid": tenant_id,
            "tenant_id": tenant_id,
            "is_admin": False,
            "roles": [{"id": 4, "name": "quality_engineer", "label": "Quality engineer"}],
        }

    app = FastAPI()
    app.dependency_overrides[get_current_user] = _current_user
    app.include_router(knowledge_router, prefix="/api/v1/knowledge")
    return TestClient(app)


def _upload_markdown_knowledge(client, file_name: str = "knowledge-sop.md") -> str:
    upload = client.post(
        "/api/v1/knowledge/assets/upload",
        files={
            "file": (
                file_name,
                b"# Solder void SOP\n\nRisk analysis uses CAPA, supplier evidence, and containment steps.",
                "text/markdown",
            )
        },
    )
    assert upload.status_code == 200
    payload = upload.json()
    assert payload["ok"] is True
    return payload["data"]["document"]["document_id"]


def test_ai_provider_test_rejects_mock_config(admin_client):
    response = admin_client.post(
        "/api/v1/ai/provider/test",
        json={
            "provider_config": {
                "provider": "mock",
                "chat_model": "mock-chat",
                "embedding_model": "mock-embedding",
            }
        },
    )

    assert response.status_code == 422


def test_ai_provider_test_reports_glm_missing_key_without_crashing(admin_client):
    response = admin_client.post(
        "/api/v1/ai/provider/test",
        json={
            "provider_config": {
                "provider": "glm",
                "chat_model": "glm-5.1",
                "api_key": "",
            }
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["provider"] == "glm"
    assert "glm API key is not configured" in data["message"]


def test_ai_provider_test_reports_glm_request_failure_without_test_key_bypass(admin_client):
    response = admin_client.post(
        "/api/v1/ai/provider/test",
        json={
            "provider_config": {
                "provider": "glm",
                "base_url": "http://127.0.0.1:9/v1",
                "chat_model": "glm-5.1",
                "embedding_model": "embedding-3",
                "api_key": "test-key",
                "timeout_seconds": 1,
            }
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["provider"] == "glm"
    assert "request failed" in data["message"]


def test_saved_ai_settings_default_to_glm_and_can_test_provider(admin_client):
    settings = admin_client.get("/api/v1/ai/settings")
    assert settings.status_code == 200
    data = settings.json()["data"]
    assert data["provider"] == "glm"
    assert data["baseUrl"] == "https://open.bigmodel.cn/api/paas/v4"
    assert data["chatModel"] == "glm-5.1"
    assert data["embeddingModel"] == "embedding-3"
    assert data["apiKey"] in {"", "********"}
    assert data["contextPolicy"]["recentMessageLimit"] == 10
    assert data["memoryPolicy"]["enabled"] is False
    assert data["compactionPolicy"]["enabled"] is True
    assert data["ragPolicy"]["topK"] == 5
    assert data["safetyPolicy"]["blockSecretMemory"] is True

    response = admin_client.post("/api/v1/ai/settings/test")
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "glm"
    assert isinstance(payload["ok"], bool)
    assert payload["message"]


def test_ai_settings_persist_lifecycle_hooks_and_rules(admin_client):
    settings = {
        "safetyPolicy": {
            "enabledHooks": ["enforce_permissions", "validate_before_tool", "validate_after_tool"],
            "permissionRules": [{"action": "deny", "tool": "data.delete_*", "reason": "No destructive data operations"}],
            "validationRules": [
                {
                    "phase": "pre_tool",
                    "tool": "forms.create_form_definition",
                    "severity": "error",
                    "ruleType": "field_required",
                    "field": "form.name",
                    "message": "Form name is required",
                }
            ],
        }
    }

    saved = admin_client.put("/api/v1/ai/settings", json={"settings": settings})
    assert saved.status_code == 200
    loaded = admin_client.get("/api/v1/ai/settings")
    assert loaded.status_code == 200
    safety_policy = loaded.json()["data"]["safetyPolicy"]
    assert safety_policy["enabledHooks"] == settings["safetyPolicy"]["enabledHooks"]
    assert safety_policy["permissionRules"][0]["action"] == "deny"
    assert safety_policy["validationRules"][0]["field"] == "form.name"


def test_deepseek_settings_normalize_incompatible_base_url(admin_client):
    response = admin_client.put(
        "/api/v1/ai/settings",
        json={
            "settings": {
                "provider": "deepseek",
                "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                "chatModel": "deepseek-chat",
                "reasoningModel": "deepseek-reasoner",
                "apiKey": "test-key",
            }
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["provider"] == "deepseek"
    assert data["baseUrl"] == "https://api.deepseek.com"
    assert data["chatModel"] == "deepseek-chat"


def test_agent_endpoint_rejects_guest_by_default(client):
    response = client.post("/api/v1/ai/agent", json={"message": "draft a CAPA"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


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
    confirmation = next(
        item["payload"]
        for item in data["items"]
        if item.get("type") == "confirmation" and (item.get("payload") or {}).get("confirmation_token")
    )
    actions = confirmation["actions"]
    assert actions[0]["skill"] == "quality.create_capa_draft"
    assert actions[0]["requires_confirmation"] is True
    assert data["run_id"].startswith("run-")
    assert confirmation["confirmation_token"].startswith("confirm-")
    assert data["items"]
    assert data["evidence"]
    assert data["evidence"][0]["source_file_name"] == "quality-process.md"


def test_agent_endpoint_routes_knowledge_surface_to_rag(ai_user_client):
    _ensure_ai_runtime_schema()
    document_id = _upload_markdown_knowledge(ai_user_client)

    response = ai_user_client.post(
        "/api/v1/ai/agent",
        json={
            "message": "这篇 SOP 讲什么",
            "context": {
                "surface": "knowledge",
                "document_id": document_id,
                "document_title": "焊点虚焊异常处置 SOP",
            },
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "qa"
    assert data["evidence"]
    assert any(item["document_id"] == document_id for item in data["evidence"])
    assert any(item["id"] == "step-identity" for item in data["items"])
    assert any(item["id"] == "step-knowledge-context" for item in data["items"])
    assert any(item["id"] == "step-knowledge-search" and item["result_count"] >= 1 for item in data["items"])


def test_agent_context_builder_uses_recent_messages_only(ai_user_client, admin_client):
    _ensure_ai_runtime_schema()

    settings = admin_client.put("/api/v1/ai/settings", json={"settings": {"contextPolicy": {"recentMessageLimit": 3}}})
    assert settings.status_code == 200
    created = ai_user_client.post(
        "/api/v1/ai/agent/conversations",
        json={"title": "Context budget", "page": "/account-center", "context": {"surface": "global"}},
    )
    conversation_id = created.json()["data"]["conversation_id"]
    for index in range(5):
        response = ai_user_client.post(
            "/api/v1/ai/agent",
            json={"message": f"hello {index}", "context": {"conversation_id": conversation_id}},
        )
        assert response.status_code == 200
    final_response = ai_user_client.post(
        "/api/v1/ai/agent",
        json={"message": "check context", "context": {"conversation_id": conversation_id}},
    )
    assert final_response.status_code == 200
    context_item = next(item for item in final_response.json()["items"] if item["id"] == "step-context-builder")
    assert context_item["payload"]["sources"]["recent_messages"] == 3


def test_agent_plain_chat_does_not_force_page_or_knowledge_context(ai_user_client):
    _ensure_ai_runtime_schema()

    created = ai_user_client.post(
        "/api/v1/ai/agent/conversations",
        json={"title": "General chat", "page": "ai-workbench", "context": {"surface": "global"}},
    )
    conversation_id = created.json()["data"]["conversation_id"]
    response = ai_user_client.post(
        "/api/v1/ai/agent",
        json={"message": "你好，先随便聊聊", "page": "ai-workbench", "context": {"conversation_id": conversation_id}},
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert any(item["id"] == "step-context-intent" and item["intent"] == "none" for item in items)
    assert not any(item.get("tool") == "knowledge.search" for item in items)


def test_agent_business_question_routes_to_semantic_context(ai_user_client):
    _ensure_ai_runtime_schema()

    created = ai_user_client.post(
        "/api/v1/ai/agent/conversations",
        json={"title": "Data chat", "page": "ai-workbench", "context": {"surface": "global"}},
    )
    conversation_id = created.json()["data"]["conversation_id"]
    response = ai_user_client.post(
        "/api/v1/ai/agent",
        json={
            "message": "分析一下供应商和物料风险数据",
            "page": "ai-workbench",
            "context": {"conversation_id": conversation_id, "route": "/supply-chain"},
        },
    )

    assert response.status_code == 200
    items = response.json()["items"]
    intent_item = next(item for item in items if item["id"] == "step-context-intent")
    assert intent_item["intent"] == "business_query"
    assert "semantic_objects" in intent_item
    context_item = next(item for item in items if item["id"] == "step-context-builder")
    semantic_context = context_item["payload"]["semantic_context"]
    assert semantic_context["status"] == "semantic_context_unavailable"
    assert semantic_context["record_count"] == 0


def test_memory_compaction_and_user_delete(ai_user_client, admin_client):
    _ensure_ai_runtime_schema()

    settings = admin_client.put(
        "/api/v1/ai/settings",
        json={
            "settings": {
                "memoryPolicy": {"enabled": True, "recallLimit": 5},
                "compactionPolicy": {"enabled": True, "triggerMessageCount": 2, "compactOnClose": True},
            }
        },
    )
    assert settings.status_code == 200
    created = ai_user_client.post(
        "/api/v1/ai/agent/conversations",
        json={"title": "Memory test", "page": "/account-center", "context": {"surface": "global"}},
    )
    conversation_id = created.json()["data"]["conversation_id"]
    response = ai_user_client.post(
        "/api/v1/ai/agent",
        json={"message": "remember this manufacturing preference", "context": {"conversation_id": conversation_id}},
    )
    assert response.status_code == 200

    memories = ai_user_client.get("/api/v1/ai/memories")
    assert memories.status_code == 200
    payload = memories.json()["data"]
    assert payload
    assert payload[0]["status"] == "active"

    deleted = ai_user_client.delete(f"/api/v1/ai/memories/{payload[0]['memory_id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"]["status"] == "deleted"


def test_unified_agent_conversation_persists_messages_and_close(ai_user_client):
    _ensure_ai_runtime_schema()
    document_id = _upload_markdown_knowledge(ai_user_client, file_name="unified-agent-sop.md")

    created = ai_user_client.post(
        "/api/v1/ai/agent/conversations",
        json={
            "title": "当前窗口",
            "page": "/account-center",
            "document_id": document_id,
            "document_title": "焊点虚焊异常处置 SOP",
            "context": {"surface": "knowledge", "route": "/account-center"},
        },
    )
    assert created.status_code == 200
    conversation_id = created.json()["data"]["conversation_id"]

    answered = ai_user_client.post(
        "/api/v1/ai/agent",
        json={
            "message": "这篇 SOP 讲什么",
            "context": {
                "surface": "knowledge",
                "document_id": document_id,
                "document_title": "焊点虚焊异常处置 SOP",
                "conversation_id": conversation_id,
            },
        },
    )
    assert answered.status_code == 200
    payload = answered.json()
    assert payload["conversation"]["conversation_id"] == conversation_id
    assert payload["user_message"]["role"] == "user"
    assert payload["assistant_message"]["role"] == "assistant"
    assert payload["run"]["conversation_id"] == conversation_id
    assert payload["run"]["run_id"] == payload["run_id"]

    messages = ai_user_client.get(f"/api/v1/ai/agent/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assert [item["role"] for item in messages.json()["data"]] == ["user", "assistant"]

    closed = ai_user_client.delete(f"/api/v1/ai/agent/conversations/{conversation_id}")
    assert closed.status_code == 200
    assert closed.json()["data"]["status"] == "closed"


def test_skill_tool_and_agent_run_lifecycle(ai_user_client):
    skills = ai_user_client.get("/api/v1/ai/skills")
    assert skills.status_code == 200
    assert any(item["name"] == "quality.create_capa_draft" for item in skills.json()["data"])

    tools = ai_user_client.get("/api/v1/ai/tools")
    assert tools.status_code == 200
    assert any(item["name"] == "knowledge.search" for item in tools.json()["data"])

    created = ai_user_client.post(
        "/api/v1/ai/agent-runs",
        json={"message": "draft a quality CAPA for defect issue, containment isolate affected batch, owner due today"},
    )
    assert created.status_code == 200
    run_payload = created.json()
    confirmation = next(
        item["payload"]
        for item in run_payload["items"]
        if item.get("type") == "confirmation" and (item.get("payload") or {}).get("confirmation_token")
    )
    token = confirmation["confirmation_token"]
    run_id = run_payload["run_id"]

    fetched = ai_user_client.get(f"/api/v1/ai/agent-runs/{run_id}")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["status"] == "waiting_confirmation"

    confirmed = ai_user_client.post(
        f"/api/v1/ai/agent-runs/{run_id}/confirm",
        json={"confirmation_token": token, "confirmed": True},
    )
    assert confirmed.status_code == 200
    confirmed_data = confirmed.json()["data"]
    assert confirmed_data["status"] == "completed"
    assert confirmed_data["tool_results"][0]["status"] == "completed"
    result = confirmed_data["tool_results"][0]["result"]
    if "record_id" in result:
        assert result["record_id"]
        assert result["form_code"]
    else:
        assert result["draft_id"].startswith("draft-")

    cancelled_run = ai_user_client.post(
        "/api/v1/ai/agent-runs",
        json={"message": "draft a quality CAPA for defect issue, containment isolate affected batch, owner due today"},
    )
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


def test_markdown_upload_job_markdown_and_chunk_endpoints(ai_user_client):
    upload = ai_user_client.post(
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

    job = ai_user_client.get(f"/api/v1/knowledge/ingestion-jobs/{result['job']['job_id']}")
    assert job.status_code == 200
    assert job.json()["data"]["status"] == "completed"

    markdown = ai_user_client.get(f"/api/v1/knowledge/documents/{result['document']['document_id']}/markdown")
    assert markdown.status_code == 200
    assert "Freeze affected batches" in markdown.json()["data"]["markdown_content"]

    chunks = ai_user_client.get(f"/api/v1/knowledge/documents/{result['document']['document_id']}/chunks")
    assert chunks.status_code == 200
    assert chunks.json()["data"][0]["permission_scope"] == "team-quality"


def test_excel_upload_is_converted_to_markdown_and_searchable(ai_user_client):
    buffer = io.BytesIO()
    frame = pd.DataFrame({"material": ["M-001", "M-002"], "rule": ["standard", "critical"]})
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name="Rules", index=False)

    upload = ai_user_client.post(
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

    response = ai_user_client.post("/api/v1/knowledge/search", json={"query": "M-002 critical rule", "limit": 3})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["query"] == "M-002 critical rule"
    assert any(item["document_id"] == result["document"]["document_id"] for item in data["results"])
    assert all("source_location" in item for item in data["results"])


def test_uploaded_knowledge_search_is_tenant_scoped(monkeypatch, tmp_path):
    from app.services.ai import knowledge_ingestion

    monkeypatch.setattr(knowledge_ingestion, "save_original_asset", lambda file_name, content: str(tmp_path / file_name))
    tenant_one = _knowledge_client_for_tenant(1)
    tenant_two = _knowledge_client_for_tenant(2)
    upload = tenant_one.post(
        "/api/v1/knowledge/assets/upload",
        files={
            "file": (
                "tenant-one-secret.md",
                b"# Tenant One SOP\n\nOnly tenant one can search TENANT-ONE-ONLY-CAPA.",
                "text/markdown",
            )
        },
    )
    assert upload.status_code == 200
    document_id = upload.json()["data"]["document"]["document_id"]
    assert upload.json()["data"]["document"]["tenant_id"] == 1

    tenant_one_search = tenant_one.post("/api/v1/knowledge/search", json={"query": "TENANT-ONE-ONLY-CAPA", "limit": 5})
    assert any(item["document_id"] == document_id for item in tenant_one_search.json()["data"]["results"])

    tenant_two_search = tenant_two.post("/api/v1/knowledge/search", json={"query": "TENANT-ONE-ONLY-CAPA", "limit": 5})
    assert tenant_two_search.status_code == 200
    assert not any(item.get("document_id") == document_id for item in tenant_two_search.json()["data"]["results"])

    tenant_two_documents = tenant_two.get("/api/v1/knowledge/documents")
    assert not any(item.get("id") == document_id for item in tenant_two_documents.json()["data"])


def test_demo_knowledge_seed_creates_word_excel_pdf_and_searches_database(ai_user_client):
    from app.database import init_db
    from app.services.ai.demo_knowledge_seed import seed_demo_knowledge_assets

    asyncio.run(init_db())
    result = asyncio.run(seed_demo_knowledge_assets())
    assert result["chunks"] >= 30

    documents = ai_user_client.get("/api/v1/knowledge/documents", params={"source_id": "database"})
    assert documents.status_code == 200
    payload = documents.json()["data"]
    source_types = {item["source_type"] for item in payload}
    assert {"word", "excel", "pdf"}.issubset(source_types)

    markdown = ai_user_client.get("/api/v1/knowledge/documents/kb-doc-quality-sop-docx/markdown")
    assert markdown.status_code == 200
    quality_markdown = markdown.json()["data"]["markdown_content"]
    assert "QE-20260521-001" in quality_markdown
    assert "## 5. 标准处置流程" in quality_markdown
    assert "| 步骤 | 操作 | 时限 | 系统记录 |" in quality_markdown

    search = ai_user_client.post("/api/v1/knowledge/search", json={"query": "SMT-03 Zone 5 temperature drift WO-260521-017", "limit": 5})
    assert search.status_code == 200
    results = search.json()["data"]["results"]
    assert any(item["document_id"] == "kb-doc-maintenance-log-pdf" for item in results)

    related = ai_user_client.get("/api/v1/knowledge/related", params={"object_type": "MaterialBatch", "object_id": "MB-7781"})
    assert related.status_code == 200
    assert any(item["id"] == "kb-doc-supplier-8d-xlsx" for item in related.json()["data"])


def test_image_upload_ocr_result_and_correction_api(ai_user_client, monkeypatch, tmp_path):
    from app.services.ai import knowledge_ingestion

    monkeypatch.setattr(knowledge_ingestion, "save_original_asset", lambda file_name, content: str(tmp_path / file_name))
    monkeypatch.setattr(
        knowledge_ingestion,
        "ocr_extract",
        lambda file_name, content: {
            "markdown_content": f"# {file_name}\n\nBad serial",
            "blocks": [{"id": "ocr-1-1", "page_number": 1, "text": "Bad serial", "confidence": 0.6, "status": "low_confidence"}],
            "average_confidence": 0.6,
            "low_confidence_count": 1,
            "provider": "rapidocr",
            "enhanced_by_vision": False,
        },
    )

    upload = ai_user_client.post(
        "/api/v1/knowledge/assets/upload",
        files={"file": ("label.png", b"fake image", "image/png")},
    )

    assert upload.status_code == 200
    result = upload.json()["data"]
    document_id = result["document"]["document_id"]
    assert result["document"]["ocr_result"]["blocks"]

    ocr = ai_user_client.get(f"/api/v1/knowledge/documents/{document_id}/ocr")
    assert ocr.status_code == 200
    assert ocr.json()["data"]["average_confidence"] == 0.6

    correction = ai_user_client.put(
        f"/api/v1/knowledge/documents/{document_id}/ocr/corrections",
        json={"blocks": [{"id": "ocr-1-1", "page_number": 1, "text": "Bad serial", "corrected_text": "Good serial SN-7781", "confidence": 0.6}]},
    )
    assert correction.status_code == 200
    assert "Good serial SN-7781" in correction.json()["data"]["markdown_content"]

    markdown = ai_user_client.get(f"/api/v1/knowledge/documents/{document_id}/markdown")
    assert "Good serial SN-7781" in markdown.json()["data"]["markdown_content"]


def test_knowledge_search_rejects_blank_query(ai_user_client):
    response = ai_user_client.post("/api/v1/knowledge/search", json={"query": "   "})

    assert response.status_code == 400
    assert response.json()["detail"] == "Search query cannot be empty"


def test_knowledge_directories_can_be_created_updated_and_moved(ai_user_client):
    initial = ai_user_client.get("/api/v1/knowledge/directories")
    assert initial.status_code == 200
    assert initial.json()["data"]["tree"]

    created = ai_user_client.post(
        "/api/v1/knowledge/directories",
        json={"name": "APS project", "parent_id": "dir-enterprise", "scope": "project", "sort_order": 42},
    )
    assert created.status_code == 200
    directory_id = created.json()["data"]["id"]

    updated = ai_user_client.put(f"/api/v1/knowledge/directories/{directory_id}", json={"name": "APS planning project"})
    assert updated.status_code == 200
    assert updated.json()["data"]["name"] == "APS planning project"

    moved = ai_user_client.post(f"/api/v1/knowledge/directories/{directory_id}/move", json={"parent_id": "dir-quality", "sort_order": 5})
    assert moved.status_code == 200
    assert moved.json()["data"]["parent_id"] == "dir-quality"


async def _reset_ai_runtime_tables():
    from sqlalchemy import delete

    from app.core.db import db_session
    from app.models.relational import AIAgentRun, AIConversation, AIDraft, AIMemoryEntry, AIMessage, AIToolCall, AuditLog

    async with db_session() as session:
        for model in (AIDraft, AIMemoryEntry, AIToolCall, AIAgentRun, AIMessage, AIConversation):
            await session.execute(delete(model))
        await session.execute(delete(AuditLog).where(AuditLog.resource_type == "ai_agent_run"))
        await session.commit()


def _ensure_ai_runtime_schema():
    from app.database import DB_TYPE, _engine, init_db
    from app.models.relational import AIAgentRun, AIConversation, AIDraft, AIMemoryEntry, AIMessage, AIToolCall

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
                            AIDraft.__table__,
                        ],
                    )
                )

        asyncio.run(_create_agent_tables())
    asyncio.run(_reset_ai_runtime_tables())


def test_knowledge_agent_conversation_resume_and_message_persistence(ai_user_client):
    _ensure_ai_runtime_schema()
    document_id = _upload_markdown_knowledge(ai_user_client, file_name="agent-knowledge-sop.md")

    created = ai_user_client.post(
        "/api/v1/knowledge/agent/conversations",
        json={"document_id": document_id, "document_title": "焊点虚焊异常处置 SOP"},
    )
    assert created.status_code == 200
    conversation_id = created.json()["data"]["conversation_id"]

    resumed = ai_user_client.post(
        "/api/v1/knowledge/agent/conversations",
        json={"document_id": document_id, "document_title": "焊点虚焊异常处置 SOP"},
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
    assert payload["run"]["items"][2]["tool"] == "knowledge.search"
    assert payload["evidence"]
    assert any(item["document_id"] == document_id for item in payload["evidence"])

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
