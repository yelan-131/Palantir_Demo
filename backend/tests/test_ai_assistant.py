"""Smoke tests for the AI assistant API module."""

from unittest.mock import AsyncMock, patch

import pytest


def test_detect_intent_oee_and_general():
    from app.api.ai_assistant import detect_intent

    assert detect_intent("show OEE for this week") == "oee"
    assert detect_intent("hello assistant") == "general"


def test_ai_timestamp_serialization_marks_database_utc_values():
    from datetime import datetime

    from app.api.ai_assistant import _now_iso

    assert _now_iso(datetime(2026, 5, 27, 14, 21, 0)) == "2026-05-27T14:21:00+00:00"


@pytest.mark.asyncio
async def test_legacy_chat_uses_the_authenticated_harness_and_preserves_response_contract(monkeypatch):
    from app.api import ai_assistant as api
    from app.services.ai.schemas import AgentResponse
    runner = AsyncMock(return_value=AgentResponse(answer="Harness reply", run_id="run-test"))
    monkeypatch.setattr(api, "_run_agent_for_user", runner)
    user = {"sub": "tester", "tenant_id": 1, "is_admin": True}
    result = await api.chat(api.ChatRequest(message="hello", session_id="demo-session"), user)
    assert result["session_id"] == "demo-session"
    assert result["intent"] == "agent"
    assert result["response"] == "Harness reply"
    runner.assert_awaited_once()
    assert runner.call_args.args[1]["sub"] == "tester"


@pytest.mark.asyncio
async def test_smart_analyze_routes_through_authenticated_harness(monkeypatch):
    from app.api import ai_assistant as api
    from app.services.ai.schemas import AgentResponse
    runner = AsyncMock(return_value=AgentResponse(answer="Analysis"))
    monkeypatch.setattr(api, "_run_agent_for_user", runner)
    result = await api.smart_analyze(api.AnalyzeRequest(query="analyze risk"), {"sub": "tester", "tenant_id": 1, "is_admin": True})
    assert result["analysis_type"] == "agent"
    assert result["response"] == "Analysis"
    runner.assert_awaited_once()
