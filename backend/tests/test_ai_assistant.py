"""Smoke tests for the AI assistant API module."""

from unittest.mock import AsyncMock, patch

import pytest


def test_detect_intent_oee_and_general():
    from app.api.ai_assistant import detect_intent

    assert detect_intent("show OEE for this week") == "oee"
    assert detect_intent("hello assistant") == "general"


@pytest.mark.asyncio
async def test_chat_returns_fallback_equipment_response():
    from app.api.ai_assistant import ChatRequest, chat

    with patch("app.api.ai_assistant._try_db", new_callable=AsyncMock, return_value=None):
        result = await chat(ChatRequest(message="machine health status", session_id="demo-session"))

    assert result["session_id"] == "demo-session"
    assert result["message"] == "machine health status"
    assert result["intent"] == "equipment"
    assert isinstance(result["response"], str)
    assert result["response"]
    assert isinstance(result["data"], list)
    assert result["timestamp"]


@pytest.mark.asyncio
async def test_chat_returns_general_contract_for_unknown_prompt():
    from app.api.ai_assistant import ChatRequest, chat

    result = await chat(ChatRequest(message="what can you do"))

    assert result["intent"] == "general"
    assert result["data"] is None
    assert isinstance(result["response"], str)
    assert result["timestamp"]


@pytest.mark.asyncio
async def test_smart_analyze_contract():
    from app.api.ai_assistant import AnalyzeRequest, smart_analyze

    result = await smart_analyze(AnalyzeRequest(query="analyze line risk", entity_type="line", entity_id=1))

    assert result["query"] == "analyze line risk"
    assert result["analysis_type"] == "trend"
    assert len(result["insights"]) >= 1
    assert len(result["recommendations"]) >= 1
    assert all("confidence" in insight for insight in result["insights"])
    assert result["timestamp"]
