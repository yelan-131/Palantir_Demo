"""Smoke tests for the first production-ready SaaS path."""
from __future__ import annotations

import os
import subprocess
import sys
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_token() -> str:
    from app.core.security import create_access_token

    return create_access_token(
        "admin",
        extra={
            "uid": 1,
            "tenant_id": 1,
            "is_admin": True,
            "roles": [{"id": 1, "name": "admin", "label": "Administrator"}],
        },
    )


def _admin_headers() -> dict[str, str]:
    return _headers(_admin_token())


def _assert_ok(response, *, context: str) -> dict:
    assert response.status_code < 400, f"{context}: {response.status_code} {response.text}"
    return response.json()


def test_ready_path_api_smoke_and_audit_contract():
    from app.main import app

    suffix = uuid.uuid4().hex[:10]
    with TestClient(app) as client:
        headers = _admin_headers()

        app_payload = _assert_ok(
            client.post(
                "/api/v1/admin/applications",
                headers=headers,
                json={
                    "name": f"Ready Path {suffix}",
                    "code": f"ready_path_{suffix}",
                    "description": "Production ready path smoke application",
                    "default_route": "/",
                    "status": "published",
                },
            ),
            context="create application",
        )["data"]
        app_id = app_payload["id"]

        role = _assert_ok(
            client.post(
                "/api/v1/admin/roles",
                headers=headers,
                json={"name": f"ready_role_{suffix}", "label": "Ready Path Role"},
            ),
            context="create role",
        )

        form_payload = _assert_ok(
            client.post(
                "/api/v1/forms",
                headers=headers,
                json={
                    "name": f"Ready Path Form {suffix}",
                    "code": f"ready_form_{suffix}",
                    "description": "Low-code core smoke form",
                    "application_id": app_id,
                    "status": "published",
                },
            ),
            context="create form",
        )["data"]
        form_id = form_payload["id"]

        title_field = _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/fields",
                headers=headers,
                json={
                    "field_name": "title",
                    "label": "Title",
                    "field_type": "string",
                    "required": True,
                    "searchable": True,
                    "visible_in_list": True,
                    "visible_in_form": True,
                },
            ),
            context="create title field",
        )["data"]
        _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/fields",
                headers=headers,
                json={
                    "field_name": "internal_note",
                    "label": "Internal Note",
                    "field_type": "string",
                    "required": False,
                    "searchable": False,
                    "visible_in_list": False,
                    "visible_in_form": True,
                },
            ),
            context="create non-searchable field",
        )

        _assert_ok(
            client.put(
                f"/api/v1/forms/applications/{app_id}/forms",
                headers=headers,
                json={"form_id": form_id, "alias": "Ready Form", "allow_export": True},
            ),
            context="bind form to application",
        )
        menu_node = _assert_ok(
            client.post(
                f"/api/v1/forms/applications/{app_id}/menu-nodes",
                headers=headers,
                json={"title": "Ready Form", "form_id": form_id, "default_entry": True},
            ),
            context="create application menu node",
        )["data"]
        assert menu_node["route_path"] == f"/dynamic/{form_payload['code']}"

        permission = _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/permissions",
                headers=headers,
                json={"role_id": role["id"], "action": "read", "effect": "allow", "field_name": "title"},
            ),
            context="create form permission",
        )["data"]
        assert permission["field_name"] == title_field["field_name"]

        record = _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/records",
                headers=headers,
                json={"data": {"title": f"Smoke ticket {suffix}", "internal_note": "not indexed"}},
            ),
            context="create dynamic record",
        )["data"]
        record_id = record["id"]

        workflow = _assert_ok(
            client.post(
                "/api/v1/workflow/definitions",
                headers=headers,
                json={
                    "name": f"Ready Path Workflow {suffix}",
                    "status": "published",
                    "steps": [
                        {"name": "Submit", "type": "start"},
                        {"name": "Approve", "type": "approval", "assignee_role": "ready_role"},
                        {"name": "Done", "type": "end"},
                    ],
                },
            ),
            context="create workflow definition",
        )
        workflow_id = workflow["id"]

        binding = _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/workflow-bindings",
                headers=headers,
                json={"workflow_id": workflow_id, "trigger_action": "submit", "enabled": True},
            ),
            context="create workflow binding",
        )["data"]
        assert binding["workflow_id"] == workflow_id

        started = _assert_ok(
            client.post(
                f"/api/v1/workflow/definitions/{workflow_id}/start",
                headers=headers,
                json={
                    "title": f"Approve record {record_id}",
                    "resource_type": "dynamic_record",
                    "resource_id": record_id,
                    "form_data": record["data"],
                },
            ),
            context="start workflow instance",
        )
        instance_id = started["instance_id"]
        approved = _assert_ok(
            client.post(
                f"/api/v1/workflow/instances/{instance_id}/approve",
                headers=headers,
                json={"comment": "approved by smoke test", "user_id": 1},
            ),
            context="approve workflow instance",
        )
        assert approved["status"] == "approved"

        report = _assert_ok(
            client.post(
                "/api/v1/reports/",
                headers=headers,
                json={
                    "name": f"Ready Path Report {suffix}",
                    "category": "ready-path",
                    "is_published": True,
                    "config": {
                        "dataSource": {"type": "form", "form_id": form_id},
                        "widgets": [{"type": "table", "field": "title"}],
                    },
                },
            ),
            context="create report",
        )
        snapshot = _assert_ok(
            client.post(f"/api/v1/reports/{report['id']}/snapshot", headers=headers),
            context="create report snapshot",
        )
        assert snapshot["version"] >= 1

        audit = _assert_ok(
            client.get("/api/v1/admin/audit-logs?page_size=100", headers=headers),
            context="query audit logs",
        )
        assert audit["total"] >= 1
        assert {"application", "form", "dynamic_record", "workflow_instance", "report"}.intersection(
            audit["summary"]["resource_counts"].keys()
        )

        readiness = _assert_ok(
            client.get("/api/v1/productization/readiness", headers=headers),
            context="readiness contract",
        )
        assert readiness["ready_path"] == [
            "tenant",
            "user",
            "role",
            "application",
            "form",
            "dynamic_record",
            "permission",
            "workflow",
            "report",
            "audit",
        ]


def test_dynamic_record_submit_generates_code_and_starts_bound_workflow():
    from app.main import app

    suffix = uuid.uuid4().hex[:10]
    with TestClient(app) as client:
        headers = _admin_headers()

        form = _assert_ok(
            client.post(
                "/api/v1/forms",
                headers=headers,
                json={
                    "name": f"Auto Submit Form {suffix}",
                    "code": f"auto_submit_{suffix}",
                    "status": "published",
                },
            ),
            context="create auto submit form",
        )["data"]
        form_id = form["id"]

        _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/fields",
                headers=headers,
                json={
                    "field_name": "material_code",
                    "label": "物料编码",
                    "field_type": "string",
                    "required": True,
                    "ui_config": {
                        "businessType": "code",
                        "controlType": "code",
                        "encodingRule": {
                            "enabled": True,
                            "template": "MAT-{yyyyMMdd}-{seq:3}",
                            "prefix": "MAT",
                            "datePattern": "YYYYMMDD",
                            "sequenceLength": 3,
                            "allowManualOverride": False,
                        },
                    },
                },
            ),
            context="create material code field",
        )
        _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/fields",
                headers=headers,
                json={"field_name": "material_name", "label": "物料名称", "field_type": "string", "required": True},
            ),
            context="create material name field",
        )
        _assert_ok(client.post(f"/api/v1/forms/{form_id}/publish", headers=headers), context="publish auto submit form")

        workflow = _assert_ok(
            client.post(
                "/api/v1/workflow/definitions",
                headers=headers,
                json={
                    "name": f"Auto Submit Workflow {suffix}",
                    "status": "published",
                    "steps": [
                        {"name": "提交", "type": "start"},
                        {"name": "审批", "type": "approval", "assignee_role": "missing_role_falls_back_to_initiator"},
                        {"name": "归档", "type": "end"},
                    ],
                },
            ),
            context="create auto submit workflow",
        )
        _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/workflow-bindings",
                headers=headers,
                json={"workflow_id": workflow["id"], "trigger_action": "submit", "enabled": True},
            ),
            context="bind submit workflow",
        )

        first = _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/records",
                headers=headers,
                json={"data": {"material_name": "轴承"}},
            ),
            context="create first submitted record",
        )["data"]
        second = _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/records",
                headers=headers,
                json={"data": {"material_name": "密封件"}},
            ),
            context="create second submitted record",
        )["data"]

        assert first["data"]["material_code"].endswith("-001")
        assert second["data"]["material_code"].endswith("-002")
        assert first["workflow_instances"][0]["workflow_id"] == workflow["id"]
        assert first["workflow_instances"][0]["approver_ids"]


@pytest.mark.asyncio
async def test_production_mode_rejects_missing_auth(monkeypatch):
    from app.api import deps

    monkeypatch.setattr(deps, "DEMO_AUTH_OPTIONAL", False)
    with pytest.raises(HTTPException) as exc_info:
        await deps.get_current_user(authorization=None, access_token=None)
    assert exc_info.value.status_code == 401


def test_production_mode_rejects_sqlite_backend_on_import():
    backend_dir = os.path.dirname(os.path.dirname(__file__))
    env = {
        **os.environ,
        "PYTHONPATH": backend_dir,
        "APP_MODE": "production",
        "DEMO_AUTH_OPTIONAL": "false",
        "SECRET_KEY": "test-production-secret-key-at-least-32-chars",
        "DATABASE_BACKEND": "sqlite",
    }

    result = subprocess.run(
        [sys.executable, "-c", "import app.database"],
        cwd=backend_dir,
        env=env,
        text=True,
        capture_output=True,
        timeout=15,
    )

    assert result.returncode != 0
    assert "SQLite fallback is disabled when APP_MODE=production" in (result.stderr + result.stdout)


def test_production_admin_db_fallback_returns_503(monkeypatch):
    from fastapi import HTTPException

    from app.api import admin
    from app.config import settings

    monkeypatch.setattr(settings, "APP_MODE", "production")

    with pytest.raises(HTTPException) as exc_info:
        admin._admin_db_fallback({"data": admin._MOCK_USERS_ADMIN})

    assert exc_info.value.status_code == 503


def test_production_mode_rejects_unindexed_dynamic_record_search(monkeypatch):
    from app.config import settings
    from app.main import app

    suffix = uuid.uuid4().hex[:10]
    with TestClient(app) as client:
        headers = _admin_headers()
        form = _assert_ok(
            client.post(
                "/api/v1/forms",
                headers=headers,
                json={
                    "name": f"Guard Form {suffix}",
                    "code": f"guard_form_{suffix}",
                    "status": "published",
                },
            ),
            context="create guard form",
        )["data"]
        form_id = form["id"]
        _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/fields",
                headers=headers,
                json={
                    "field_name": "internal_note",
                    "label": "Internal Note",
                    "field_type": "string",
                    "searchable": False,
                },
            ),
            context="create unindexed field",
        )
        _assert_ok(
            client.post(
                f"/api/v1/forms/{form_id}/records",
                headers=headers,
                json={"data": {"internal_note": "secret"}},
            ),
            context="create guard record",
        )

        monkeypatch.setattr(settings, "APP_MODE", "production")
        response = client.get(f"/api/v1/forms/{form_id}/records?search=secret", headers=headers)

    assert response.status_code == 400
    assert response.json()["detail"] == "Query is not indexed for production dynamic records"
