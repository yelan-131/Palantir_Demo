from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _platform_headers() -> dict[str, str]:
    from app.core.security import create_access_token

    token = create_access_token(
        "platform-admin",
        extra={
            "uid": 1,
            "tenant_id": 1,
            "is_admin": True,
            "roles": [{"id": 1, "name": "admin", "label": "Administrator"}],
        },
    )
    return _headers(token)


def _ok(response, context: str) -> dict:
    assert response.status_code < 400, f"{context}: {response.status_code} {response.text}"
    return response.json()


def test_tenant_onboarding_invite_email_login_reset_and_cross_tenant_guard():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        platform_headers = _platform_headers()

        tenant_a = _ok(
            client.post(
                "/api/v1/platform/tenants",
                headers=platform_headers,
                json={
                    "name": f"Tenant A {suffix}",
                    "slug": f"tenant-a-{suffix}",
                    "domains": [f"a-{suffix}.example.com"],
                    "admin_email": f"admin@a-{suffix}.example.com",
                    "limits": {"users": 5, "applications": 5, "dynamicRecords": 5},
                },
            ),
            "create tenant a",
        )["data"]
        tenant_b = _ok(
            client.post(
                "/api/v1/platform/tenants",
                headers=platform_headers,
                json={
                    "name": f"Tenant B {suffix}",
                    "slug": f"tenant-b-{suffix}",
                    "domains": [f"b-{suffix}.example.com"],
                    "admin_email": f"admin@b-{suffix}.example.com",
                },
            ),
            "create tenant b",
        )["data"]

        accept_a = _ok(
            client.post(
                "/api/v1/auth/invite/accept",
                json={
                    "token": tenant_a["adminInvite"]["inviteUrl"].split("token=", 1)[1],
                    "password": "TenantA123!",
                    "display_name": "Tenant A Admin",
                },
            ),
            "accept tenant a invite",
        )
        accept_b = _ok(
            client.post(
                "/api/v1/auth/invite/accept",
                json={
                    "token": tenant_b["adminInvite"]["inviteUrl"].split("token=", 1)[1],
                    "password": "TenantB123!",
                    "display_name": "Tenant B Admin",
                },
            ),
            "accept tenant b invite",
        )

        login_a = _ok(
            client.post(
                "/api/v1/auth/login",
                json={"username": f"admin@a-{suffix}.example.com", "password": "TenantA123!"},
            ),
            "tenant a email login",
        )
        assert login_a["user"]["tenant_id"] == tenant_a["id"]
        me_a = _ok(client.get("/api/v1/auth/me", headers=_headers(login_a["token"])), "tenant a me")
        assert me_a["tenant_id"] == tenant_a["id"]
        assert me_a["tenant_status"] == "active"

        form = _ok(
            client.post(
                "/api/v1/forms",
                headers=_headers(accept_a["token"]),
                json={"name": f"Cross Tenant {suffix}", "code": f"cross_{suffix}", "status": "published"},
            ),
            "create tenant a form",
        )["data"]
        denied = client.get(f"/api/v1/forms/{form['id']}", headers=_headers(accept_b["token"]))
        assert denied.status_code == 404

        reset = _ok(
            client.post("/api/v1/auth/password-reset/request", json={"email": f"admin@a-{suffix}.example.com"}),
            "request reset",
        )
        assert reset["data"]["resetUrl"]
        _ok(
            client.post(
                "/api/v1/auth/password-reset/confirm",
                json={"token": reset["data"]["resetUrl"].split("token=", 1)[1], "new_password": "TenantA456!"},
            ),
            "confirm reset",
        )
        _ok(
            client.post(
                "/api/v1/auth/login",
                json={"username": f"admin@a-{suffix}.example.com", "password": "TenantA456!"},
            ),
            "login with reset password",
        )


def test_tenant_domain_status_and_quota_guards():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _platform_headers()
        tenant = _ok(
            client.post(
                "/api/v1/platform/tenants",
                headers=headers,
                json={
                    "name": f"Quota Tenant {suffix}",
                    "slug": f"quota-{suffix}",
                    "domains": [f"quota-{suffix}.example.com"],
                    "admin_email": f"owner@quota-{suffix}.example.com",
                    "limits": {"users": 1, "applications": 1, "dynamicRecords": 1},
                },
            ),
            "create quota tenant",
        )["data"]
        owner = _ok(
            client.post(
                "/api/v1/auth/invite/accept",
                json={
                    "token": tenant["adminInvite"]["inviteUrl"].split("token=", 1)[1],
                    "password": "Quota123!!",
                },
            ),
            "accept quota tenant invite",
        )
        first_app = _ok(
            client.post(
                "/api/v1/admin/applications",
                headers=_headers(owner["token"]),
                json={"name": f"App {suffix}", "code": f"app_{suffix}", "status": "published"},
            ),
            "create first app",
        )
        assert first_app["data"]["id"]
        second_app = client.post(
            "/api/v1/admin/applications",
            headers=_headers(owner["token"]),
            json={"name": f"App 2 {suffix}", "code": f"app2_{suffix}", "status": "published"},
        )
        assert second_app.status_code == 403

        _ok(
            client.put(
                f"/api/v1/platform/tenants/{tenant['id']}",
                headers=headers,
                json={"status": "suspended", "suspended_reason": "test"},
            ),
            "suspend tenant",
        )
        suspended_login = client.post(
            "/api/v1/auth/login",
            json={"username": f"owner@quota-{suffix}.example.com", "password": "Quota123!!"},
        )
        assert suspended_login.status_code == 403


def test_platform_tenant_operations_invite_history_resend_revoke_and_reset():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _platform_headers()
        tenant = _ok(
            client.post(
                "/api/v1/platform/tenants",
                headers=headers,
                json={
                    "name": f"Ops Tenant {suffix}",
                    "slug": f"ops-{suffix}",
                    "domains": [f"ops-{suffix}.example.com"],
                    "admin_email": f"owner@ops-{suffix}.example.com",
                },
            ),
            "create ops tenant",
        )["data"]
        old_token = tenant["adminInvite"]["inviteUrl"].split("token=", 1)[1]

        invites = _ok(
            client.get(f"/api/v1/platform/tenants/{tenant['id']}/invites", headers=headers),
            "list invites",
        )["data"]
        assert len([item for item in invites if item["tenantId"] == tenant["id"]]) == len(invites)
        invite = next(item for item in invites if item["email"] == f"owner@ops-{suffix}.example.com")
        assert invite["status"] == "pending"

        resent = _ok(
            client.post(f"/api/v1/platform/tenants/{tenant['id']}/invites/{invite['id']}/resend", headers=headers),
            "resend invite",
        )["data"]
        replaced = client.post(
            "/api/v1/auth/invite/accept",
            json={"token": old_token, "password": "OpsTenant123!"},
        )
        assert replaced.status_code == 400

        accepted = _ok(
            client.post(
                "/api/v1/auth/invite/accept",
                json={"token": resent["inviteUrl"].split("token=", 1)[1], "password": "OpsTenant123!"},
            ),
            "accept resent invite",
        )
        user_id = accepted["user"]["id"]

        extra = _ok(
            client.post(
                f"/api/v1/platform/tenants/{tenant['id']}/invites",
                headers=headers,
                json={"email": f"member@ops-{suffix}.example.com", "role": "member"},
            ),
            "create member invite",
        )["data"]
        revoked = _ok(
            client.post(f"/api/v1/platform/tenants/{tenant['id']}/invites/{extra['id']}/revoke", headers=headers),
            "revoke invite",
        )["data"]
        assert revoked["status"] == "revoked"
        revoked_accept = client.post(
            "/api/v1/auth/invite/accept",
            json={"token": extra["inviteUrl"].split("token=", 1)[1], "password": "Member123!"},
        )
        assert revoked_accept.status_code == 400

        detail = _ok(client.get(f"/api/v1/platform/tenants/{tenant['id']}", headers=headers), "tenant detail")["data"]
        assert detail["usage"]["forms"] >= 0
        assert detail["pendingInvitesCount"] >= 0
        assert any(item["email"] == f"owner@ops-{suffix}.example.com" for item in detail["recentInvites"])

        reset = _ok(
            client.post(f"/api/v1/platform/tenants/{tenant['id']}/users/{user_id}/password-reset", headers=headers),
            "platform reset",
        )["data"]
        assert "resetUrl" in reset
        _ok(
            client.post(
                "/api/v1/auth/password-reset/confirm",
                json={"token": reset["resetUrl"].split("token=", 1)[1], "new_password": "OpsTenant456!"},
            ),
            "confirm platform reset",
        )

        tenant_admin_headers = _headers(accepted["token"])
        forbidden = client.get("/api/v1/platform/tenants", headers=tenant_admin_headers)
        assert forbidden.status_code == 403

        _ok(
            client.put(
                f"/api/v1/platform/tenants/{tenant['id']}",
                headers=headers,
                json={"status": "suspended", "suspended_reason": "ops test"},
            ),
            "suspend ops tenant",
        )
        blocked_invite = client.post(
            f"/api/v1/platform/tenants/{tenant['id']}/invites",
            headers=headers,
            json={"email": f"blocked@ops-{suffix}.example.com", "role": "member"},
        )
        assert blocked_invite.status_code == 403
        blocked_reset = client.post(f"/api/v1/platform/tenants/{tenant['id']}/users/{user_id}/password-reset", headers=headers)
        assert blocked_reset.status_code == 403

        _ok(
            client.put(
                f"/api/v1/platform/tenants/{tenant['id']}",
                headers=headers,
                json={"status": "archived", "limits": {"users": None}, "domains": []},
            ),
            "archive ops tenant",
        )
        direct_restore = client.put(
            f"/api/v1/platform/tenants/{tenant['id']}",
            headers=headers,
            json={"status": "active"},
        )
        assert direct_restore.status_code == 422

        audit_detail = _ok(client.get(f"/api/v1/platform/tenants/{tenant['id']}", headers=headers), "tenant detail audit")["data"]
        serialized = "\n".join(str(item) for item in audit_detail["recentAuditLogs"])
        assert "revoke_invite" in serialized
        assert "resend_invite" in serialized
        assert "token=" not in serialized
