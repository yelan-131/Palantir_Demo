"""Token budget tracker for the agent runtime.

Accumulates token usage across turns and stops the loop when a configurable
limit is exceeded.  Inspired by Claude Code's max_budget_usd mechanism.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BudgetTracker:
    """Tracks cumulative token usage for a single agent run."""
    max_input_tokens: int = 100_000
    max_output_tokens: int = 20_000

    _input_tokens: int = field(default=0, init=False)
    _output_tokens: int = field(default=0, init=False)
    _total_tokens: int = field(default=0, init=False)
    _turns_tracked: int = field(default=0, init=False)

    def accumulate(self, usage: dict[str, Any]) -> None:
        """Add token counts from a single LLM API response."""
        self._input_tokens += int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        self._output_tokens += int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
        self._total_tokens += int(usage.get("total_tokens") or 0)
        self._turns_tracked += 1

    def is_exceeded(self) -> bool:
        """Return True if any budget limit has been breached."""
        return (
            self._input_tokens > self.max_input_tokens
            or self._output_tokens > self.max_output_tokens
        )

    def summary(self) -> dict[str, int]:
        """Return current usage statistics."""
        return {
            "input_tokens": self._input_tokens,
            "output_tokens": self._output_tokens,
            "total_tokens": self._total_tokens,
            "turns_tracked": self._turns_tracked,
            "max_input_tokens": self.max_input_tokens,
            "max_output_tokens": self.max_output_tokens,
            "remaining_input": max(0, self.max_input_tokens - self._input_tokens),
            "remaining_output": max(0, self.max_output_tokens - self._output_tokens),
        }
