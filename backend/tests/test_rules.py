"""Tests for the Rules Engine — CRUD and validation."""

import json
from unittest.mock import AsyncMock, patch

import pytest


# ── Fixtures ──────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_mock_rules():
    """Reset mock state between tests."""
    from app.api import rules as rules_mod
    original = list(rules_mod.MOCK_RULES)
    original_id = rules_mod._next_mock_id
    yield
    rules_mod.MOCK_RULES.clear()
    rules_mod.MOCK_RULES.extend(original)
    rules_mod._next_mock_id = original_id


# ── CRUD tests ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_rules_all():
    """GET /rules returns all rules."""
    from app.api.rules import list_rules
    result = await list_rules(model_id=None)
    assert "data" in result
    assert len(result["data"]) >= 2  # at least mock rules


@pytest.mark.asyncio
async def test_list_rules_filtered_by_model():
    """GET /rules?model_id=1 returns only rules for model 1."""
    from app.api.rules import list_rules
    result = await list_rules(model_id=1)
    assert "data" in result
    for r in result["data"]:
        assert r["model_id"] == 1


@pytest.mark.asyncio
async def test_create_rule():
    """POST /rules creates a new rule in mock store."""
    from app.api.rules import RuleCreate, create_rule
    body = RuleCreate(
        model_id=1, name="Test rule", rule_type="validation",
        field_name="status", condition='{"operator": "required"}',
        message="Status is required",
    )
    result = await create_rule(body)
    assert result["name"] == "Test rule"
    assert result["field_name"] == "status"
    assert result["id"] is not None


@pytest.mark.asyncio
async def test_create_rule_invalid_condition():
    """POST /rules rejects malformed condition JSON."""
    from fastapi import HTTPException
    from app.api.rules import RuleCreate, create_rule
    body = RuleCreate(
        model_id=1, name="Bad", condition="not-json",
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_rule(body)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_rule_missing_operator():
    """POST /rules rejects condition without operator."""
    from fastapi import HTTPException
    from app.api.rules import RuleCreate, create_rule
    body = RuleCreate(
        model_id=1, name="Bad", condition='{"value": 5}',
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_rule(body)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_update_rule():
    """PUT /rules/{id} updates a rule in mock store."""
    from app.api.rules import RuleUpdate, update_rule
    body = RuleUpdate(name="Updated name", message="New message")
    result = await update_rule(rule_id=1, body=body)
    assert result["name"] == "Updated name"
    assert result["message"] == "New message"


@pytest.mark.asyncio
async def test_update_rule_not_found():
    """PUT /rules/{id} returns 404 for nonexistent rule."""
    from fastapi import HTTPException
    from app.api.rules import RuleUpdate, update_rule
    body = RuleUpdate(name="X")
    with pytest.raises(HTTPException) as exc_info:
        await update_rule(rule_id=9999, body=body)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_rule():
    """DELETE /rules/{id} removes a rule from mock store."""
    from app.api.rules import delete_rule, list_rules
    before = await list_rules(model_id=None)
    count_before = len(before["data"])
    result = await delete_rule(rule_id=1)
    assert result["ok"] is True
    after = await list_rules(model_id=None)
    assert len(after["data"]) == count_before - 1


# ── Validation tests ─────────────────────────────────────

@pytest.mark.asyncio
async def test_validate_required_pass():
    """Validation passes when required field is present."""
    from app.api.rules import ValidateRequest, validate_data
    body = ValidateRequest(
        model_name="equipment",
        data={"name": "CNC-01", "health_score": 90},
    )
    result = await validate_data(body)
    assert result["valid"] is True
    assert result["errors"] == []


@pytest.mark.asyncio
async def test_validate_required_fail():
    """Validation fails when required field is missing."""
    from app.api.rules import ValidateRequest, validate_data
    body = ValidateRequest(
        model_name="equipment",
        data={"health_score": 90},  # missing 'name'
    )
    result = await validate_data(body)
    assert result["valid"] is False
    assert any(e["field"] == "name" for e in result["errors"])


@pytest.mark.asyncio
async def test_validate_required_empty_string():
    """Validation fails when required field is empty string."""
    from app.api.rules import ValidateRequest, validate_data
    body = ValidateRequest(
        model_name="equipment",
        data={"name": "  ", "health_score": 50},
    )
    result = await validate_data(body)
    assert result["valid"] is False
    assert any(e["field"] == "name" for e in result["errors"])


@pytest.mark.asyncio
async def test_validate_min_pass():
    """Validation passes when value >= min."""
    from app.api.rules import ValidateRequest, validate_data
    body = ValidateRequest(
        model_name="equipment",
        data={"name": "CNC-01", "health_score": 50},
    )
    result = await validate_data(body)
    assert result["valid"] is True


@pytest.mark.asyncio
async def test_validate_min_fail():
    """Validation fails when value < min."""
    from app.api.rules import ValidateRequest, validate_data
    body = ValidateRequest(
        model_name="equipment",
        data={"name": "CNC-01", "health_score": -5},
    )
    result = await validate_data(body)
    assert result["valid"] is False
    assert any(e["field"] == "health_score" for e in result["errors"])


@pytest.mark.asyncio
async def test_validate_max_fail():
    """Validation fails when value > max."""
    from app.api.rules import ValidateRequest, validate_data
    body = ValidateRequest(
        model_name="equipment",
        data={"name": "CNC-01", "health_score": 150},
    )
    result = await validate_data(body)
    assert result["valid"] is False
    assert any("100" in e["message"] or "health_score" in e["field"] for e in result["errors"])


@pytest.mark.asyncio
async def test_validate_no_rules_for_model():
    """Validation passes when no rules exist for a model."""
    from app.api.rules import ValidateRequest, validate_data
    body = ValidateRequest(
        model_name="nonexistent_model",
        data={"anything": "goes"},
    )
    result = await validate_data(body)
    assert result["valid"] is True
    assert result["errors"] == []


# ── Direct _evaluate_rule unit tests ─────────────────────

def test_evaluate_rule_min_length():
    from app.api.rules import _evaluate_rule
    rule = {
        "field_name": "name",
        "condition": '{"operator": "min_length", "value": 3}',
        "message": "Too short",
    }
    assert _evaluate_rule(rule, {"name": "AB"}) == "Too short"
    assert _evaluate_rule(rule, {"name": "ABC"}) is None


def test_evaluate_rule_max_length():
    from app.api.rules import _evaluate_rule
    rule = {
        "field_name": "name",
        "condition": '{"operator": "max_length", "value": 5}',
        "message": "Too long",
    }
    assert _evaluate_rule(rule, {"name": "ABCDEF"}) == "Too long"
    assert _evaluate_rule(rule, {"name": "ABC"}) is None


def test_evaluate_rule_regex():
    from app.api.rules import _evaluate_rule
    rule = {
        "field_name": "email",
        "condition": '{"operator": "regex", "value": "^[^@]+@[^@]+\\\\.[^@]+$"}',
        "message": "Invalid email",
    }
    assert _evaluate_rule(rule, {"email": "bad"}) == "Invalid email"
    assert _evaluate_rule(rule, {"email": "a@b.c"}) is None


def test_evaluate_rule_unique_always_passes():
    from app.api.rules import _evaluate_rule
    rule = {
        "field_name": "sku",
        "condition": '{"operator": "unique"}',
        "message": "Must be unique",
    }
    # Mock: unique always passes
    assert _evaluate_rule(rule, {"sku": "DUPLICATE"}) is None


def test_evaluate_rule_none_value_numeric():
    """Numeric rules should pass when value is None (field not present)."""
    from app.api.rules import _evaluate_rule
    rule = {
        "field_name": "score",
        "condition": '{"operator": "min", "value": 0}',
        "message": "Too low",
    }
    assert _evaluate_rule(rule, {}) is None
    assert _evaluate_rule(rule, {"score": None}) is None
