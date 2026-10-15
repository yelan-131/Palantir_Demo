"""Backward-compatible AI Agent orchestrator facade."""

from __future__ import annotations

from .harness_runtime import harness_runtime
from typing import Any, Awaitable, Callable

from .schemas import AgentRequest, AgentResponse


AgentEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]


async def run_agent(
    request: AgentRequest,
    user: dict[str, Any] | None = None,
    *,
    event_sink: AgentEventSink | None = None,
) -> AgentResponse:
    return await harness_runtime.run(request, user=user, event_sink=event_sink)
