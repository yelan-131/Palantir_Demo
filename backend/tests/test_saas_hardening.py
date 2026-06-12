from __future__ import annotations

import asyncio
import zipfile
from pathlib import Path

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


def _ok(response, context: str) -> dict:
    assert response.status_code < 400, f"{context}: {response.status_code} {response.text}"
    return response.json()


def test_readiness_metrics_and_tenant_export_redaction():
    from app.main import app

    suffix = "hardening"
    with TestClient(app) as client:
        readiness = _ok(client.get("/api/v1/system/readiness"), "readiness")
        assert readiness["status"] in {"ready", "degraded"}
        assert "database" in readiness["checks"]

        headers = _admin_headers()
        tenant = _ok(
            client.post(
                "/api/v1/platform/tenants",
                headers=headers,
                json={
                    "name": f"Export Tenant {suffix}",
                    "slug": f"export-tenant-{suffix}",
                    "domains": [f"export-{suffix}.example.com"],
                    "admin_email": f"owner@export-{suffix}.example.com",
                },
            ),
            "create tenant",
        )["data"]

        created = _ok(client.post(f"/api/v1/platform/tenants/{tenant['id']}/exports", headers=headers), "create export")
        assert created["ok"] is True
        export_path = Path(created["data"]["filePath"])
        assert export_path.exists()
        with zipfile.ZipFile(export_path) as zf:
            payload_text = zf.read("tenant-data.json").decode("utf-8")
        assert "pending-invite" not in payload_text
        assert "token_hash" not in payload_text or "[REDACTED]" in payload_text

        listed = _ok(client.get(f"/api/v1/platform/tenants/{tenant['id']}/exports", headers=headers), "list exports")
        assert any(item["id"] == created["data"]["id"] for item in listed["data"])

        metrics = _ok(client.get("/api/v1/system/metrics"), "metrics")
        assert metrics["data"]["requests_total"] >= 1


def test_ai_notifications_scheduler_are_tenant_scoped():
    from app.core.db import db_session
    from app.main import app
    from app.models.relational import Notification

    suffix = "saas-scope"

    async def seed_cross_tenant_notification(tenant_id: int, user_id: int) -> int:
        async with db_session() as session:
            row = Notification(tenant_id=tenant_id, user_id=user_id, title="Tenant B only", content="secret")
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row.id

    with TestClient(app) as client:
        platform_headers = _admin_headers()
        tenant_a = _ok(client.post("/api/v1/platform/tenants", headers=platform_headers, json={"name": f"SaaS A {suffix}", "slug": f"saas-a-{suffix}", "domains": [f"saas-a-{suffix}.example.com"], "admin_email": f"owner@saas-a-{suffix}.example.com"}), "create a")["data"]
        tenant_b = _ok(client.post("/api/v1/platform/tenants", headers=platform_headers, json={"name": f"SaaS B {suffix}", "slug": f"saas-b-{suffix}", "domains": [f"saas-b-{suffix}.example.com"], "admin_email": f"owner@saas-b-{suffix}.example.com"}), "create b")["data"]
        token_a = _ok(client.post("/api/v1/auth/invite/accept", json={"token": tenant_a["adminInvite"]["inviteUrl"].split("token=", 1)[1], "password": "TenantA123!"}), "accept a")["token"]
        token_b = _ok(client.post("/api/v1/auth/invite/accept", json={"token": tenant_b["adminInvite"]["inviteUrl"].split("token=", 1)[1], "password": "TenantB123!"}), "accept b")["token"]
        me_b = _ok(client.get("/api/v1/auth/me", headers=_headers(token_b)), "me b")
        asyncio.run(seed_cross_tenant_notification(tenant_b["id"], me_b["id"]))

        conv_a = _ok(client.post("/api/v1/ai/agent/conversations", headers=_headers(token_a), json={"title": "A only"}), "conv a")["data"]
        convs_b = _ok(client.get("/api/v1/ai/agent/conversations", headers=_headers(token_b)), "convs b")
        assert all(item["conversation_id"] != conv_a["conversation_id"] for item in convs_b["data"])
        assert client.get(f"/api/v1/ai/agent/conversations/{conv_a['conversation_id']}/messages", headers=_headers(token_b)).status_code == 404

        notifications_a = _ok(client.get("/api/v1/notifications", headers=_headers(token_a)), "notifications a")
        assert all(item.get("title") != "Tenant B only" for item in notifications_a["data"])

        job_a = _ok(client.post("/api/v1/scheduler/jobs", headers=_headers(token_a), json={"name": "A job", "cron": "0 1 * * *", "job_type": "report"}), "job a")
        jobs_b = _ok(client.get("/api/v1/scheduler/jobs", headers=_headers(token_b)), "jobs b")
        assert all(item["id"] != job_a["id"] for item in jobs_b["data"])
        assert client.post(f"/api/v1/scheduler/jobs/{job_a['id']}/trigger", headers=_headers(token_b)).status_code == 404
