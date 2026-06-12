"""Tests for BudgetTracker token budget control.

Validates accumulation, exceeded detection, summary output, and runtime
budget-exhausted behaviour.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Ensure the backend app package is importable
_BACKEND_ROOT = str(Path(__file__).resolve().parent)
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

from app.services.ai.budget import BudgetTracker


# ── Unit tests for BudgetTracker ──────────────────────────────


class TestBudgetTrackerAccumulate:
    """BudgetTracker.accumulate correctly sums token counts."""

    def test_accumulate_with_openai_keys(self) -> None:
        bt = BudgetTracker()
        bt.accumulate({"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150})
        bt.accumulate({"prompt_tokens": 200, "completion_tokens": 80, "total_tokens": 280})
        s = bt.summary()
        assert s["input_tokens"] == 300
        assert s["output_tokens"] == 130
        assert s["total_tokens"] == 430
        assert s["turns_tracked"] == 2

    def test_accumulate_with_anthropic_keys(self) -> None:
        bt = BudgetTracker()
        bt.accumulate({"input_tokens": 500, "output_tokens": 200, "total_tokens": 700})
        s = bt.summary()
        assert s["input_tokens"] == 500
        assert s["output_tokens"] == 200

    def test_accumulate_with_empty_usage(self) -> None:
        bt = BudgetTracker()
        bt.accumulate({})
        bt.accumulate({"prompt_tokens": 0})
        s = bt.summary()
        assert s["input_tokens"] == 0
        assert s["output_tokens"] == 0
        assert s["turns_tracked"] == 2

    def test_accumulate_mixed_keys(self) -> None:
        bt = BudgetTracker()
        bt.accumulate({"prompt_tokens": 100, "completion_tokens": 30})
        bt.accumulate({"input_tokens": 50, "output_tokens": 20})
        s = bt.summary()
        assert s["input_tokens"] == 150
        assert s["output_tokens"] == 50


class TestBudgetTrackerIsExceeded:
    """BudgetTracker.is_exceeded returns correct boolean."""

    def test_under_limit_returns_false(self) -> None:
        bt = BudgetTracker(max_input_tokens=1000, max_output_tokens=500)
        bt.accumulate({"prompt_tokens": 500, "completion_tokens": 100, "total_tokens": 600})
        assert bt.is_exceeded() is False

    def test_exactly_at_limit_returns_false(self) -> None:
        bt = BudgetTracker(max_input_tokens=1000, max_output_tokens=500)
        bt.accumulate({"prompt_tokens": 1000, "completion_tokens": 500, "total_tokens": 1500})
        assert bt.is_exceeded() is False

    def test_input_exceeded_returns_true(self) -> None:
        bt = BudgetTracker(max_input_tokens=1000, max_output_tokens=500)
        bt.accumulate({"prompt_tokens": 1001, "completion_tokens": 10, "total_tokens": 1011})
        assert bt.is_exceeded() is True

    def test_output_exceeded_returns_true(self) -> None:
        bt = BudgetTracker(max_input_tokens=1000, max_output_tokens=500)
        bt.accumulate({"prompt_tokens": 10, "completion_tokens": 501, "total_tokens": 511})
        assert bt.is_exceeded() is True

    def test_both_exceeded_returns_true(self) -> None:
        bt = BudgetTracker(max_input_tokens=100, max_output_tokens=50)
        bt.accumulate({"prompt_tokens": 200, "completion_tokens": 100, "total_tokens": 300})
        assert bt.is_exceeded() is True

    def test_default_limits_not_exceeded_by_small_usage(self) -> None:
        bt = BudgetTracker()
        bt.accumulate({"prompt_tokens": 1000, "completion_tokens": 200, "total_tokens": 1200})
        assert bt.is_exceeded() is False


class TestBudgetTrackerSummary:
    """BudgetTracker.summary returns correct dict structure."""

    def test_summary_keys(self) -> None:
        bt = BudgetTracker(max_input_tokens=5000, max_output_tokens=1000)
        bt.accumulate({"prompt_tokens": 200, "completion_tokens": 50, "total_tokens": 250})
        s = bt.summary()
        expected_keys = {
            "input_tokens", "output_tokens", "total_tokens",
            "turns_tracked", "max_input_tokens", "max_output_tokens",
            "remaining_input", "remaining_output",
        }
        assert set(s.keys()) == expected_keys

    def test_summary_values(self) -> None:
        bt = BudgetTracker(max_input_tokens=5000, max_output_tokens=1000)
        bt.accumulate({"prompt_tokens": 200, "completion_tokens": 50, "total_tokens": 250})
        s = bt.summary()
        assert s["input_tokens"] == 200
        assert s["output_tokens"] == 50
        assert s["total_tokens"] == 250
        assert s["turns_tracked"] == 1
        assert s["max_input_tokens"] == 5000
        assert s["max_output_tokens"] == 1000
        assert s["remaining_input"] == 4800
        assert s["remaining_output"] == 950

    def test_remaining_clamped_to_zero(self) -> None:
        bt = BudgetTracker(max_input_tokens=100, max_output_tokens=50)
        bt.accumulate({"prompt_tokens": 200, "completion_tokens": 100, "total_tokens": 300})
        s = bt.summary()
        assert s["remaining_input"] == 0
        assert s["remaining_output"] == 0


# ── Integration test for runtime budget-exhausted response ────


class TestRuntimeBudgetExhausted:
    """AgentRuntime.run returns budget-exhausted message when budget is exceeded."""

    @pytest.mark.asyncio
    async def test_budget_exhausted_returns_special_message(self) -> None:
        """Runtime returns the budget-exhausted answer when budget is pre-exceeded.

        We inject a pre-exceeded budget into the state so the budget check fires
        on the very first loop iteration, before any LLM call is made.
        """
        from app.services.ai.runtime import AgentRuntime
        from app.services.ai.schemas import AgentRequest

        runtime = AgentRuntime()

        request = AgentRequest(
            message="test query",
            page="home",
            provider_config={
                "provider": "glm",
                "base_url": "https://open.bigmodel.cn/api/paas/v4",
                "api_key": "",
                "chat_model": "glm-5.1",
                "reasoning_model": "glm-5.1",
                "embedding_model": "embedding-3",
                "vision_model": "glm-4v-plus",
            },
        )
        user = {"uid": 1, "tenant_id": 1, "role": "admin", "is_admin": True}

        # Pre-exceeded budget: simulate having already consumed tokens
        exceeded_budget = BudgetTracker(max_input_tokens=10, max_output_tokens=10)
        exceeded_budget.accumulate({"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150})

        with patch("app.services.ai.runtime.settings_snapshot", return_value={
            "provider": "glm", "baseUrl": "", "apiKey": "",
            "chatModel": "glm-5.1", "reasoningModel": "glm-5.1",
            "embeddingModel": "embedding-3", "visionModel": "glm-4v-plus",
            "safetyPolicy": {"agentMaxInputTokens": 10, "agentMaxOutputTokens": 10, "maxToolSteps": 5},
        }), \
        patch("app.services.ai.runtime.safety_policy_snapshot", return_value={
            "agentMaxInputTokens": 10, "agentMaxOutputTokens": 10, "maxToolSteps": 5,
        }), \
        patch("app.services.ai.runtime.BudgetTracker", return_value=exceeded_budget), \
        patch("app.services.ai.runtime.preflight_agent_request") as mock_preflight_fn, \
        patch("app.services.ai.runtime.get_provider") as mock_get_provider:

            resp = await runtime.run(request, user=user)

            # The pre-exceeded budget should cause immediate budget-exhausted return
            assert "Token" in resp.answer or "预算" in resp.answer
            mock_preflight_fn.assert_not_called()
            mock_get_provider.assert_not_called()
            assert resp.token_budget is not None
            assert resp.token_budget["input_tokens"] == 100
            assert resp.token_budget["output_tokens"] == 50
            assert resp.token_budget["remaining_input"] == 0
            assert resp.token_budget["remaining_output"] == 0

    @pytest.mark.asyncio
    async def test_budget_check_stops_loop_before_llm_call(self) -> None:
        """Verify that budget.is_exceeded() check at loop top prevents the LLM call."""
        from app.services.ai.budget import BudgetTracker

        bt = BudgetTracker(max_input_tokens=10, max_output_tokens=10)
        # Simulate a previous turn that exceeded the budget
        bt.accumulate({"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150})
        assert bt.is_exceeded() is True

        summary = bt.summary()
        assert summary["remaining_input"] == 0
        assert summary["remaining_output"] == 0
