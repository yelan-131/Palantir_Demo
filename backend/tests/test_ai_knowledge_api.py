"""API contract tests for AI provider, Agent, and knowledge ingestion routes."""

from __future__ import annotations

import io

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def clear_ingested_knowledge():
    from app.services.ai import knowledge_ingestion

    for store in (
        knowledge_ingestion.ASSETS,
        knowledge_ingestion.DOCUMENTS,
        knowledge_ingestion.CHUNKS,
        knowledge_ingestion.JOBS,
    ):
        store.clear()
    yield
    for store in (
        knowledge_ingestion.ASSETS,
        knowledge_ingestion.DOCUMENTS,
        knowledge_ingestion.CHUNKS,
        knowledge_ingestion.JOBS,
    ):
        store.clear()


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
    assert data["evidence"]
    assert data["evidence"][0]["source_file_name"] == "quality-process.md"


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
