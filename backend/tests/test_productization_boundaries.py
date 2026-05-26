from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


def test_productization_readiness_exposes_ready_path():
    from app.main import app

    client = TestClient(app)
    response = client.get("/api/v1/productization/readiness")

    assert response.status_code == 200
    data = response.json()
    assert data["ready_path"] == [
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
    modules = {item["module"]: item for item in data["modules"]}
    assert modules["low_code_core"]["status"] == "ready_foundation"
    assert modules["rules_engine"]["status"] == "ready_foundation"
    assert modules["quality"]["status"] == "beta_demo"
    assert modules["knowledge_base"]["status"] == "demo"
    assert modules["data_integration_connectors"]["status"] == "roadmap"


@pytest.mark.asyncio
async def test_rules_do_not_fallback_to_mock_in_production(monkeypatch):
    from app.api import rules as rules_mod
    from app.config import settings

    monkeypatch.setattr(settings, "APP_MODE", "production")
    with patch.object(rules_mod, "_try_db", new_callable=AsyncMock, return_value=None):
        with pytest.raises(HTTPException) as exc_info:
            await rules_mod.validate_data(
                rules_mod.ValidateRequest(
                    model_name="equipment",
                    data={"name": "CNC-01", "health_score": 90},
                )
            )

    assert exc_info.value.status_code == 503
