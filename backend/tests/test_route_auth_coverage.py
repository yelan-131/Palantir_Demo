from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.api.deps import get_current_user, require_platform_admin, require_platform_admin_for_writes
from app.main import app

# Routes reachable without a user token. The harness MCP bridge validates its
# own short-lived bridge token inside the handler.
PUBLIC_ROUTES = {
    ("GET", "/"),
    ("GET", "/health"),
    ("GET", "/api/v1/system/readiness"),
    ("GET", "/api/v1/release/current"),
    ("GET", "/api/v1/productization/readiness"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/invite/accept"),
    ("GET", "/api/v1/auth/oidc/config"),
    ("POST", "/api/v1/auth/oidc/login-url"),
    ("POST", "/api/v1/auth/oidc/callback"),
    ("POST", "/api/v1/auth/password-reset/request"),
    ("POST", "/api/v1/auth/password-reset/confirm"),
    ("POST", "/api/v1/ai/harness/mcp"),
}


def _dependency_calls(dependant) -> set:
    calls = set()
    for dep in dependant.dependencies:
        if dep.call is not None:
            calls.add(dep.call)
        calls |= _dependency_calls(dep)
    return calls


def test_every_non_public_route_requires_a_user_token():
    unprotected = sorted(
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute) and get_current_user not in _dependency_calls(route.dependant)
        for method in route.methods
        if (method, route.path) not in PUBLIC_ROUTES
    )
    assert unprotected == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/v1/model-driven/models"),
        ("POST", "/api/v1/model-driven/models"),
        ("DELETE", "/api/v1/model-driven/menus/1"),
        ("GET", "/api/v1/config/export"),
        ("POST", "/api/v1/config/import"),
        ("GET", "/api/v1/system/metrics"),
        ("GET", "/api/v1/maintenance/equipment-health"),
        ("GET", "/api/v1/search?q=a"),
        ("GET", "/api/v1/knowledge/cards"),
    ],
)
def test_anonymous_requests_are_rejected(method, path):
    response = TestClient(app).request(method, path, json={})
    assert response.status_code == 401


def _request(method: str) -> Request:
    return Request({"type": "http", "method": method, "headers": []})


@pytest.mark.asyncio
async def test_model_driven_writes_require_platform_admin():
    member = {"uid": 2, "tenant_id": 1, "is_admin": False}
    tenant_admin = {"uid": 3, "tenant_id": 2, "is_admin": True}
    platform_admin = {"uid": 1, "tenant_id": 1, "is_admin": True}

    assert await require_platform_admin_for_writes(_request("GET"), member) is member
    for user in (member, tenant_admin):
        with pytest.raises(HTTPException) as exc_info:
            await require_platform_admin_for_writes(_request("POST"), user)
        assert exc_info.value.status_code == 403
    assert await require_platform_admin_for_writes(_request("DELETE"), platform_admin) is platform_admin


def test_platform_config_routes_require_platform_admin():
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/v1/config/"):
            assert require_platform_admin in _dependency_calls(route.dependant), route.path
