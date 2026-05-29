"""Backward-compatible AI Agent orchestrator facade."""

from __future__ import annotations

from .runtime import agent_runtime
from typing import Any, Awaitable, Callable

from .schemas import AgentRequest, AgentResponse


AgentEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]


async def run_agent(
    request: AgentRequest,
    user: dict[str, Any] | None = None,
    *,
    event_sink: AgentEventSink | None = None,
) -> AgentResponse:
    return await agent_runtime.run(request, user=user, event_sink=event_sink)
