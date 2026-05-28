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


def test_static_app_programs_have_database_loaders():
    from app.main import app

    program_ids = [
        "oee-trend-report",
        "line-load-analysis",
        "maintenance-order",
        "defect-analysis",
        "process-capability-dashboard",
        "supplier-risk",
        "material-impact",
    ]
    with TestClient(app) as client:
        for program_id in program_ids:
            response = client.get(f"/api/v1/dashboard/programs/{program_id}?limit=2")
            assert response.status_code == 200
            data = response.json()
            assert data["program_id"] == program_id
            assert data["source"] != "unsupported"
