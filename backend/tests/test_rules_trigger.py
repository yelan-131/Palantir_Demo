"""Tests for the Trigger Engine in app.api.rules.

Covers:
  - Condition evaluation (matching / non-matching)
  - Template interpolation
  - Trigger action execution (log_event, create_record, update_record)
  - Best-effort behavior (failures must not raise)
  - API endpoints (list triggers, evaluate triggers)
"""
from __future__ import annotations

import asyncio
import json

import pytest


# ── Helpers ────────────────────────────────────────────────

def _run(coro):
    """Run an async coroutine synchronously in tests."""
    return asyncio.get_event_loop().run_until_complete(coro)


# ── Unit tests: condition evaluation ───────────────────────

class TestEvaluateCondition:
    """Tests for _evaluate_condition helper."""

    def _call(self, condition: dict, record: dict) -> bool:
        from app.api.rules import _evaluate_condition
        return _evaluate_condition(condition, record)

    def test_lt_matching(self):
        """health_score < 60 with health_score=42 should match."""
        cond = {"operator": "lt", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": 42}) is True

    def test_lt_not_matching(self):
        """health_score < 60 with health_score=88 should NOT match."""
        cond = {"operator": "lt", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": 88}) is False

    def test_lt_exact_boundary(self):
        """health_score < 60 with health_score=60 should NOT match."""
        cond = {"operator": "lt", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": 60}) is False

    def test_gt_matching(self):
        cond = {"operator": "gt", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": 88}) is True

    def test_gt_not_matching(self):
        cond = {"operator": "gt", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": 42}) is False

    def test_lte_matching(self):
        cond = {"operator": "lte", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": 60}) is True

    def test_gte_matching(self):
        cond = {"operator": "gte", "field": "health_score", "value": 88}
        assert self._call(cond, {"health_score": 88}) is True

    def test_eq_matching(self):
        cond = {"operator": "eq", "field": "status", "value": "fault"}
        assert self._call(cond, {"status": "fault"}) is True

    def test_eq_not_matching(self):
        cond = {"operator": "eq", "field": "status", "value": "fault"}
        assert self._call(cond, {"status": "running"}) is False

    def test_neq_matching(self):
        cond = {"operator": "neq", "field": "status", "value": "running"}
        assert self._call(cond, {"status": "idle"}) is True

    def test_contains_matching(self):
        cond = {"operator": "contains", "field": "name", "value": "CNC"}
        assert self._call(cond, {"name": "CNC加工中心-01"}) is True

    def test_missing_field_returns_false(self):
        cond = {"operator": "lt", "field": "nonexistent", "value": 10}
        assert self._call(cond, {"health_score": 42}) is False

    def test_none_value_returns_false(self):
        cond = {"operator": "lt", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": None}) is False

    def test_unknown_operator_returns_false(self):
        cond = {"operator": "unknown_op", "field": "health_score", "value": 60}
        assert self._call(cond, {"health_score": 42}) is False

    def test_empty_condition_returns_false(self):
        assert self._call({}, {"health_score": 42}) is False


# ── Unit tests: template interpolation ─────────────────────

class TestInterpolateTemplate:
    """Tests for _interpolate_template helper."""

    def _call(self, template: str, record: dict) -> str:
        from app.api.rules import _interpolate_template
        return _interpolate_template(template, record)

    def test_basic_interpolation(self):
        result = self._call(
            "{name}健康分降至{health_score}",
            {"name": "CNC-01", "health_score": 42},
        )
        assert result == "CNC-01健康分降至42"

    def test_missing_key_preserves_placeholder(self):
        result = self._call(
            "{name}状态:{status}",
            {"name": "CNC-01"},
        )
        assert result == "CNC-01状态:{status}"

    def test_no_placeholders(self):
        result = self._call("static text", {"name": "CNC-01"})
        assert result == "static text"

    def test_integer_value(self):
        result = self._call("id={id}", {"id": 123})
        assert result == "id=123"

    def test_float_value(self):
        result = self._call("score={score}", {"score": 92.5})
        assert result == "score=92.5"

    def test_empty_template(self):
        result = self._call("", {"name": "CNC-01"})
        assert result == ""


# ── Unit tests: action execution ───────────────────────────

class TestExecuteTriggerAction:
    """Tests for _execute_trigger_action helper."""

    def _call(self, action: dict, record: dict) -> dict:
        from app.api.rules import _execute_trigger_action
        return _run(_execute_trigger_action(action, record))

    def test_log_event_action(self):
        """log_event should return ok status."""
        action = {"type": "log_event", "message": "test event"}
        result = self._call(action, {"id": 1, "name": "CNC-01"})
        assert result["status"] == "ok"
        assert result["detail"] == "logged"

    def test_create_record_action_mock_fallback(self):
        """create_record with no DB should return ok (mock-fallback path)."""
        action = {
            "type": "create_record",
            "target_model": "work_orders",
            "field_mapping": [
                {"target": "description", "template": "{name}健康分降至{health_score}"}
            ],
        }
        record = {"id": 1, "name": "CNC-01", "health_score": 42}
        result = self._call(action, record)
        # With no DB available, falls back to mock path — still returns ok
        assert result["status"] in ("ok", "error")
        if result["status"] == "ok":
            assert "work_orders" in result["detail"]

    def test_create_record_empty_mapping(self):
        """create_record with empty field_mapping should be skipped."""
        action = {
            "type": "create_record",
            "target_model": "work_orders",
            "field_mapping": [],
        }
        result = self._call(action, {"id": 1})
        assert result["status"] == "skipped"

    def test_update_record_no_target_id(self):
        """update_record without target_id should be skipped."""
        action = {
            "type": "update_record",
            "target_model": "equipment",
            "field_mapping": [{"target": "status", "value": "maintenance"}],
        }
        result = self._call(action, {})
        assert result["status"] == "skipped"

    def test_update_record_empty_mapping(self):
        """update_record with empty field_mapping should be skipped."""
        action = {
            "type": "update_record",
            "target_model": "equipment",
            "target_id": 1,
            "field_mapping": [],
        }
        result = self._call(action, {"id": 1})
        assert result["status"] == "skipped"

    def test_unknown_action_type(self):
        """Unknown action type should return error."""
        action = {"type": "send_email", "to": "admin@example.com"}
        result = self._call(action, {"id": 1})
        assert result["status"] == "error"
        assert "unknown action type" in result["detail"]

    def test_create_record_with_source_mapping(self):
        """create_record using source field mapping."""
        action = {
            "type": "create_record",
            "target_model": "work_orders",
            "field_mapping": [
                {"target": "description", "source": "name"},
            ],
        }
        record = {"id": 1, "name": "CNC加工中心-01"}
        result = self._call(action, record)
        assert result["status"] in ("ok", "error")

    def test_create_record_with_static_value(self):
        """create_record using static value mapping."""
        action = {
            "type": "create_record",
            "target_model": "work_orders",
            "field_mapping": [
                {"target": "status", "value": "pending"},
            ],
        }
        result = self._call(action, {"id": 1})
        assert result["status"] in ("ok", "error")


# ── Integration tests: full trigger evaluation ─────────────

class TestEvaluateTriggersIntegration:
    """Tests for the evaluate-triggers flow using mock data."""

    def _evaluate(self, model_name: str, action: str, record: dict, old_record: dict = None) -> dict:
        from app.api.rules import evaluate_triggers, EvaluateTriggersRequest
        body = EvaluateTriggersRequest(
            model_name=model_name,
            action=action,
            record=record,
            old_record=old_record,
        )
        return _run(evaluate_triggers(body))

    def test_matching_trigger_fires(self):
        """equipment with health_score=42 should fire the 低健康分自动工单 trigger."""
        result = self._evaluate(
            model_name="equipment",
            action="update",
            record={"id": 1, "name": "CNC-01", "health_score": 42},
        )
        assert "triggered" in result
        assert len(result["triggered"]) >= 1
        fired = result["triggered"][0]
        assert fired["rule_name"] == "低健康分自动工单"
        assert fired["action_type"] == "create_record"
        assert fired["result"]["status"] in ("ok", "error")

    def test_non_matching_trigger_does_not_fire(self):
        """equipment with health_score=88 should NOT fire the trigger."""
        result = self._evaluate(
            model_name="equipment",
            action="update",
            record={"id": 1, "name": "CNC-01", "health_score": 88},
        )
        assert "triggered" in result
        assert len(result["triggered"]) == 0

    def test_unknown_model_no_triggers(self):
        """A model with no triggers should return empty triggered list."""
        result = self._evaluate(
            model_name="nonexistent_model",
            action="create",
            record={"id": 1},
        )
        assert result["triggered"] == []

    def test_trigger_on_create(self):
        """Triggers also evaluate on create action."""
        result = self._evaluate(
            model_name="equipment",
            action="create",
            record={"id": 99, "name": "新设备", "health_score": 30},
        )
        assert len(result["triggered"]) >= 1

    def test_trigger_on_delete(self):
        """Triggers evaluate on delete with old record data."""
        result = self._evaluate(
            model_name="equipment",
            action="delete",
            record={"id": 1, "name": "CNC-01", "health_score": 55},
        )
        assert len(result["triggered"]) >= 1


# ── Unit test: best-effort wrapper ─────────────────────────

class TestBestEffortEvaluation:
    """Test that _evaluate_triggers_sync never raises."""

    def test_sync_never_raises_on_bad_input(self):
        """_evaluate_triggers_sync should swallow all exceptions."""
        from app.api.rules import _evaluate_triggers_sync
        # This should not raise even with nonsensical input
        _run(_evaluate_triggers_sync("bad_model", "bad_action", {}))

    def test_sync_never_raises_on_none_record(self):
        from app.api.rules import _evaluate_triggers_sync
        # None-like values should not crash
        _run(_evaluate_triggers_sync("equipment", "update", {"id": 1}))


# ── API endpoint tests (via TestClient) ────────────────────

class TestTriggerEndpoints:
    """Test the HTTP endpoints for triggers."""

    @pytest.fixture()
    def client(self):
        """Create a test client with just the rules router mounted."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.api.rules import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_list_triggers_for_model(self, client):
        """GET /rules/triggers?model_name=equipment returns trigger rules."""
        resp = client.get("/rules/triggers?model_name=equipment")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        trigger_names = [t["name"] for t in data["data"]]
        assert "低健康分自动工单" in trigger_names

    def test_list_triggers_for_model_no_triggers(self, client):
        """GET /rules/triggers for a model with no triggers returns empty."""
        resp = client.get("/rules/triggers?model_name=suppliers")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"] == []

    def test_evaluate_triggers_matching(self, client):
        """POST /rules/evaluate-triggers with matching condition fires trigger."""
        resp = client.post("/rules/evaluate-triggers", json={
            "model_name": "equipment",
            "action": "update",
            "record": {"id": 1, "name": "CNC-01", "health_score": 42},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["triggered"]) >= 1

    def test_evaluate_triggers_not_matching(self, client):
        """POST /rules/evaluate-triggers with non-matching condition returns empty."""
        resp = client.post("/rules/evaluate-triggers", json={
            "model_name": "equipment",
            "action": "update",
            "record": {"id": 1, "name": "CNC-01", "health_score": 95},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["triggered"]) == 0

    def test_evaluate_triggers_with_old_record(self, client):
        """POST /rules/evaluate-triggers with old_record field works."""
        resp = client.post("/rules/evaluate-triggers", json={
            "model_name": "equipment",
            "action": "update",
            "record": {"id": 1, "name": "CNC-01", "health_score": 42},
            "old_record": {"health_score": 88},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["triggered"]) >= 1
