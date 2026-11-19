import logging
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.api import applications, component_pages
from app.api.deps import get_current_user, get_db, require_admin
from app.core import db as db_helpers
from app.core.production_errors import coded_error, database_unavailable
from app.core.request_diagnostics import install_request_diagnostics
from app.main import app


@pytest.fixture
def platform_client(monkeypatch):
    user = {"uid": 1, "tenant_id": 1, "is_admin": True}
    monkeypatch.setitem(app.dependency_overrides, require_admin, lambda: user)
    monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: user)
    monkeypatch.setitem(app.dependency_overrides, get_db, lambda: object())
    return TestClient(app)


@pytest.mark.parametrize(("method", "path", "target", "code"), [
    ("GET", "/api/v1/pages/page-demo", "get_page", "COMPONENT_PAGE_LOAD_FAILED"),
    ("POST", "/api/v1/pages/page-demo/data", "page_data", "COMPONENT_DATA_LOAD_FAILED"),
])
def test_component_route_reports_operation_failure(platform_client, monkeypatch, caplog, method, path, target, code):
    monkeypatch.setattr(
        component_pages.component_page_editor_service, target, AsyncMock(side_effect=TypeError("test component"))
    )
    response = platform_client.request(method, path, json={}, headers={"X-Request-ID": "component-test"})
    assert response.status_code == 500
    assert response.headers["X-Error-Code"] == response.json()["error_code"] == code
    assert f"error_code={code} request_id=component-test" in caplog.text
    assert "exception_type=TypeError" in caplog.text


def test_successful_component_call_has_no_error_code(platform_client, monkeypatch):
    monkeypatch.setattr(
        component_pages.component_page_editor_service, "page_data",
        AsyncMock(return_value={"analyticsData": {"errors": [], "widgetErrors": {"one": []}}}),
    )
    response = platform_client.post("/api/v1/pages/page-demo/data", json={})
    assert response.status_code == 200
    assert "X-Error-Code" not in response.headers
    assert response.headers["X-Request-ID"]


@pytest.mark.parametrize(("failure", "status", "code"), [
    (TypeError("test application"), 500, "APPLICATION_CREATE_FAILED"),
    (OperationalError(None, None, RuntimeError("test database")), 503, "DATABASE_UNAVAILABLE"),
])
def test_application_creation_distinguishes_program_and_database_errors(
    platform_client, monkeypatch, caplog, failure, status, code
):
    session = AsyncMock()
    monkeypatch.setattr(db_helpers, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(applications, "lock_tenant_writes", AsyncMock())
    monkeypatch.setattr(applications, "create_application", AsyncMock(side_effect=failure))
    response = platform_client.post(
        "/api/v1/admin/applications", json={"name": "测试应用", "code": "diagnostic-test"},
        headers={"X-Request-ID": "application-test"},
    )
    assert response.status_code == status
    assert response.headers["X-Error-Code"] == code
    assert f"error_code={code} request_id=application-test" in caplog.text
    session.rollback.assert_awaited_once()


@pytest.fixture
def client():
    test_app = FastAPI()
    install_request_diagnostics(test_app)

    @test_app.get("/authenticate")
    def denied():
        raise HTTPException(401, "Please sign in", headers={"WWW-Authenticate": "Bearer"})

    @test_app.get("/records/{record_id}")
    def records(record_id: int):
        raise database_unavailable()

    @test_app.get("/harness-update")
    def harness_update():
        raise coded_error(502, "AI_HARNESS_UPDATE_FAILED", "Update failed")

    @test_app.get("/unexpected")
    def fails():
        raise RuntimeError("sensitive exception data")

    return TestClient(test_app)


@pytest.mark.parametrize(("path", "status", "code"), [
    ("/missing", 404, "HTTP_404"),
    ("/authenticate", 401, "HTTP_401"),
    ("/records/non-numeric", 422, "HTTP_422"),
    ("/records/42", 503, "DATABASE_UNAVAILABLE"),
    ("/harness-update", 502, "AI_HARNESS_UPDATE_FAILED"),
    ("/unexpected", 500, "HTTP_500"),
])
def test_failure_lookup_happens_during_request(client, caplog, path, status, code):
    with caplog.at_level(logging.INFO, logger="app.core.request_diagnostics"):
        response = client.get(path, headers={"X-Request-ID": "diagnostic-test"})
    assert response.status_code == status
    assert response.headers["X-Error-Code"] == code
    assert response.headers["X-Request-ID"] == "diagnostic-test"
    assert f"request_diagnosis error_code={code} request_id=diagnostic-test" in caplog.text
    assert "action=" in caplog.text
    if status == 401:
        assert response.headers["WWW-Authenticate"] == "Bearer"
    if status == 422:
        assert response.json()["detail"][0]["loc"] == ["path", "record_id"]
    if code == "DATABASE_UNAVAILABLE":
        assert response.json()["detail"]["code"] == code
        assert "route=/records/{record_id}" in caplog.text
    if status == 500:
        assert response.json() == {
            "detail": "Internal server error", "type": "RuntimeError",
            "error_code": code, "request_id": "diagnostic-test",
        }
        assert "sensitive exception data" not in caplog.text
        assert "exception_type=RuntimeError" in caplog.text


def test_real_application_installs_diagnostics_and_exposes_headers():
    client = TestClient(app)
    healthy = client.get("/health", headers={"X-Request-ID": "invalid value"})
    assert healthy.json() == {"status": "healthy"}
    assert len(healthy.headers["X-Request-ID"]) == 32
    assert "X-Error-Code" not in healthy.headers

    origin = app.user_middleware[0].kwargs["allow_origins"][0]
    missing = client.get("/missing", headers={"Origin": origin})
    assert missing.headers["X-Error-Code"] == "HTTP_404"
    exposed = {header.strip().lower() for header in missing.headers["Access-Control-Expose-Headers"].split(",")}
    assert {"x-error-code", "x-request-id"} <= exposed


def test_stream_failure_is_logged_after_headers_are_sent(caplog):
    test_app = FastAPI()
    install_request_diagnostics(test_app)

    @test_app.get("/stream")
    async def stream():
        async def body():
            yield b"first frame"
            raise RuntimeError("stream failure")

        return StreamingResponse(body())

    client = TestClient(test_app, raise_server_exceptions=False)
    response = client.get("/stream", headers={"X-Request-ID": "stream-test"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "stream-test"
    assert "X-Error-Code" not in response.headers
    assert "error_code=RESPONSE_INTERRUPTED request_id=stream-test" in caplog.text
