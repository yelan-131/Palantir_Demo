from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.mark.asyncio
async def test_get_current_user_accepts_bearer_token():
    from app.api import deps
    from app.core.security import create_access_token

    token = create_access_token(
        "auth-hardening-user",
        extra={"uid": 321, "tenant_id": 1, "is_admin": False},
    )

    payload = await deps.get_current_user(authorization=f"Bearer {token}", access_token=None)

    assert payload["sub"] == "auth-hardening-user"
    assert payload["tenant_id"] == 1


def test_query_string_token_is_not_accepted_for_current_user():
    from app.core.security import create_access_token
    from app.main import app

    token = create_access_token(
        "auth-hardening-user",
        extra={"uid": 321, "tenant_id": 1, "is_admin": False},
    )

    with TestClient(app) as client:
        response = client.get(f"/api/v1/auth/me?token={token}")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_oidc_login_url_requires_tenant_identity():
    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/oidc/login-url",
            json={"redirect_uri": "http://localhost/login"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Tenant identity required for OIDC login"


def test_username_login_requires_disambiguation_for_shared_username():
    from app.core.db import db_session
    from app.core.security import hash_password
    from app.main import app
    from app.models.relational import Tenant, TenantDomain, User

    suffix = uuid.uuid4().hex[:8]
    username = f"shared_{suffix}"
    password = "SharedTenant123!"

    async def seed_users() -> tuple[int, int]:
        async with db_session() as session:
            tenant_a = Tenant(name=f"Shared A {suffix}", slug=f"shared-a-{suffix}", status="active", config={}, limits={})
            tenant_b = Tenant(name=f"Shared B {suffix}", slug=f"shared-b-{suffix}", status="active", config={}, limits={})
            session.add_all([tenant_a, tenant_b])
            await session.flush()
            tenant_a_id = tenant_a.id
            tenant_b_id = tenant_b.id
            session.add_all(
                [
                    TenantDomain(tenant_id=tenant_a_id, domain=f"shared-a-{suffix}.example.com"),
                    TenantDomain(tenant_id=tenant_b_id, domain=f"shared-b-{suffix}.example.com"),
                    User(
                        tenant_id=tenant_a_id,
                        username=username,
                        email=f"{username}@shared-a-{suffix}.example.com",
                        display_name="Shared A",
                        hashed_password=hash_password(password),
                        is_active=True,
                    ),
                    User(
                        tenant_id=tenant_b_id,
                        username=username,
                        email=f"{username}@shared-b-{suffix}.example.com",
                        display_name="Shared B",
                        hashed_password=hash_password(password),
                        is_active=True,
                    ),
                ]
            )
            await session.commit()
            return tenant_a_id, tenant_b_id

    with TestClient(app) as client:
        _tenant_a_id, tenant_b_id = asyncio.run(seed_users())
        ambiguous = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
        )
        disambiguated = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password, "tenant_id": tenant_b_id},
        )

    assert ambiguous.status_code == 400
    assert ambiguous.json()["detail"] == "Username login is ambiguous; use email address or tenant_id"
    assert disambiguated.status_code == 200
    assert disambiguated.json()["user"]["tenant_id"] == tenant_b_id
