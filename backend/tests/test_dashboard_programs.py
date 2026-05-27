from fastapi.testclient import TestClient


def test_app_program_endpoint_returns_database_backed_contract():
    from app.main import app

    with TestClient(app) as client:
        response = client.get("/api/v1/dashboard/programs/line-status")

    assert response.status_code == 200
    data = response.json()
    assert data["program_id"] == "line-status"
    assert data["source"] in {"database", "fallback"}
    if data["source"] == "database":
        assert isinstance(data["metrics"], list)
        assert isinstance(data["rows"], list)
        assert "total" in data
