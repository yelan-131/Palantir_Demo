"""Tests for document-to-ontology extraction workflow."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


TEST_TENANT_ID = 11
TEST_USER = {"uid": 101, "tenant_id": TEST_TENANT_ID, "role": "admin", "is_admin": True}
DETERMINISTIC_MODEL = "rules-ontology-extractor"


@pytest.fixture(autouse=True)
def clear_extraction_stores():
    from app.services.ai import knowledge_ingestion, ontology_extraction

    for store in (
        knowledge_ingestion.ASSETS,
        knowledge_ingestion.DOCUMENTS,
        knowledge_ingestion.CHUNKS,
        knowledge_ingestion.JOBS,
        ontology_extraction.EXTRACTION_JOBS,
    ):
        store.clear()
    yield
    for store in (
        knowledge_ingestion.ASSETS,
        knowledge_ingestion.DOCUMENTS,
        knowledge_ingestion.CHUNKS,
        knowledge_ingestion.JOBS,
        ontology_extraction.EXTRACTION_JOBS,
    ):
        store.clear()


@pytest.fixture()
def client():
    from app.api.deps import get_current_user
    from app.api.graph import router as graph_router
    from app.api.knowledge import router as knowledge_router

    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: TEST_USER
    app.include_router(graph_router, prefix="/api/v1/graph")
    app.include_router(knowledge_router, prefix="/api/v1/knowledge")
    return TestClient(app)


def test_extraction_job_lifecycle_and_exports(client):
    response = client.post(
        "/api/v1/knowledge/extraction-jobs",
        data={
            "domain": "quality",
            "prompt_name": "quality_event_v1",
            "model_name": DETERMINISTIC_MODEL,
        },
        files={
            "file": (
                "supplier-8d.md",
                (
                    b"# Supplier 8D\n\n"
                    b"Supplier: Beichen electronics material\n"
                    b"Material batch: MB-7781\n"
                    b"Equipment: SMT-03 reflow oven\n"
                    b"Defect: BGA solder void\n"
                    b"Required action: freeze affected batch and create CAPA review.\n"
                ),
                "text/markdown",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    job = payload["job"]
    assert job["status"] == "completed"
    assert job["model_name"] == DETERMINISTIC_MODEL
    assert job["tenant_id"] == TEST_TENANT_ID
    assert job["result"]["entities"]
    assert job["result"]["generic_entities"]
    assert job["result"]["domain_mappings"]
    assert job["result"]["properties"]
    assert job["result"]["relations"]
    assert job["quality_report"]["counts"]["FATAL"] == 0

    job_id = job["job_id"]
    read_response = client.get(f"/api/v1/knowledge/extraction-jobs/{job_id}")
    assert read_response.status_code == 200
    assert read_response.json()["data"]["job_id"] == job_id

    approve_response = client.post(f"/api/v1/knowledge/extraction-jobs/{job_id}/approve", json={})
    assert approve_response.status_code == 200
    assert approve_response.json()["data"]["status"] == "approved"

    csv_response = client.get(f"/api/v1/knowledge/extraction-jobs/{job_id}/export", params={"format": "csv"})
    assert csv_response.status_code == 200
    assert "entity" in csv_response.text
    assert "relation" in csv_response.text

    commit_response = client.post(f"/api/v1/knowledge/extraction-jobs/{job_id}/commit-to-graph")
    assert commit_response.status_code == 200
    assert commit_response.json()["data"]["commit"]["entities"] >= 1
    assert commit_response.json()["data"]["commit"]["relations"] >= 1

    node_assets = client.get("/api/v1/graph/assets/nodes")
    assert node_assets.status_code == 200
    assert node_assets.json()["total"] >= 1

    relationship_assets = client.get("/api/v1/graph/assets/relationships")
    assert relationship_assets.status_code == 200
    assert relationship_assets.json()["total"] >= 1

    evidence_assets = client.get("/api/v1/graph/assets/evidence")
    assert evidence_assets.status_code == 200
    assert evidence_assets.json()["total"] >= 1

    quality_assets = client.get("/api/v1/graph/assets/quality")
    assert quality_assets.status_code == 200
    assert quality_assets.json()["data"]["summary"]["nodes"] >= 1


def test_extraction_quality_report_blocks_empty_source(client):
    response = client.post(
        "/api/v1/knowledge/extraction-jobs",
        files={"file": ("empty.md", b"#\n\n", "text/markdown")},
    )

    assert response.status_code == 200
    job = response.json()["data"]["job"]
    assert job["quality_report"]["blocking"] is True
    assert job["quality_report"]["counts"]["FATAL"] >= 1

    commit_response = client.post(f"/api/v1/knowledge/extraction-jobs/{job['job_id']}/commit-to-graph")
    assert commit_response.status_code == 409


def test_uploaded_document_returns_intake_and_extracts_without_reupload(client):
    upload = client.post(
        "/api/v1/knowledge/assets/upload",
        files={
            "file": (
                "process-note.md",
                (
                    b"# Process note\n\n"
                    b"Supplier: Northwind material\n"
                    b"Material batch: MB-900\n"
                    b"Equipment: SMT-08 placement line\n"
                    b"Quality event: QE-771 dimension drift\n"
                ),
                "text/markdown",
            )
        },
    )
    assert upload.status_code == 200
    payload = upload.json()["data"]
    document_id = payload["document"]["document_id"]
    assert payload["document"]["tenant_id"] == TEST_TENANT_ID
    assert payload["intake_recommendation"]["document_id"] == document_id
    assert "extract_ontology_candidates" in payload["intake_recommendation"]["capabilities"]

    intake = client.post(
        f"/api/v1/knowledge/documents/{document_id}/ontology-intake",
        json={"domain_hint": "manufacturing", "mode": "recommend"},
    )
    assert intake.status_code == 200
    assert intake.json()["data"]["confirmation"]["skill"] == "knowledge.intake_document_ontology"

    extraction = client.post(
        f"/api/v1/knowledge/documents/{document_id}/extraction-jobs",
        json={
            "domain": "manufacturing",
            "prompt_name": "manufacturing_ontology_v1",
            "model_name": DETERMINISTIC_MODEL,
        },
    )
    assert extraction.status_code == 200
    job = extraction.json()["data"]["job"]
    assert job["document_id"] == document_id
    assert job["model_name"] == DETERMINISTIC_MODEL
    assert job["tenant_id"] == TEST_TENANT_ID
    assert job["result"]["generic_entities"]
    assert job["result"]["domain_mappings"]
    assert job["status"] == "completed"


def test_llm_json_parser_reports_missing_fields():
    from app.services.ai.ontology_extraction import parse_llm_extraction_json

    with pytest.raises(ValueError, match="missing fields"):
        parse_llm_extraction_json('{"entities": []}')

    parsed = parse_llm_extraction_json(
        '{"entities": [], "relations": [], "logic_rules": [], "actions": []}'
    )
    assert parsed["entities"] == []
