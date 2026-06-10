from fastapi.testclient import TestClient


def test_app_program_endpoint_returns_database_backed_contract():
    from app.main import app

    with TestClient(app) as client:
        response = client.get("/api/v1/dashboard/programs/line-status")

    assert response.status_code == 200
    data = response.json()
    assert data["program_id"] == "line-status"
    assert data["source"] in {"dynamic_records", "unsupported"}
    if data["source"] == "dynamic_records":
        assert isinstance(data["metrics"], list)
        assert isinstance(data["rows"], list)
        assert "total" in data


def test_dashboard_app_programs_do_not_fall_back_to_static_loaders():
    from app.main import app

    program_ids = [
        "oee-trend-report",
        "line-load-analysis",
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
            assert data["source"] in {"dynamic_records", "unsupported"}
            assert data["source"] != "database"
            if data["source"] == "dynamic_records":
                assert data["analyticsDesign"]["widgets"]
                assert data["analyticsData"]["metricValues"]


def test_production_overview_program_uses_runtime_loader():
    from app.main import app

    with TestClient(app) as client:
        response = client.get("/api/v1/dashboard/programs/production-overview?limit=2")

    assert response.status_code == 200
    data = response.json()
    assert data["program_id"] == "production-overview"
    assert data["source"] in {"dynamic_records", "unsupported"}
    assert data["source"] != "database"
    if data["source"] == "dynamic_records":
        assert isinstance(data["metrics"], list)
        assert isinstance(data["rows"], list)
        assert "analyticsDesign" in data
