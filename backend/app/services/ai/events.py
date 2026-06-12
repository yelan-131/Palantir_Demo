"""Lifecycle event bus for the AI Agent runtime.

Provides a structured event system inspired by Claude Code's hook architecture.
Supports both fire-and-forget events (emit) and interceptable events (intercept).

Usage::

    bus = EventBus()

    # Register a handler
    async def on_tool_use(event, payload):
        print(f"Tool used: {payload['tool_name']}")

    bus.on(AgentEvent.POST_TOOL_USE, on_tool_use)

    # Fire-and-forget
    await bus.emit(AgentEvent.RUN_STARTED, {"user": "alice"})

    # Interceptable (handler can veto)
    result = await bus.intercept(AgentEvent.PRE_TOOL_USE, {"tool_name": "Bash"})
    if result.action == "abort":
        return  # blocked by hook
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


# ── Event types ──────────────────────────────────────────────

class AgentEvent(Enum):
    """Typed lifecycle events for the agent runtime."""

    # Run lifecycle
    RUN_STARTED = "run.started"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"

    # Step / loop
    STEP_COMPLETED = "step.completed"
    ITEM_CREATED = "item.created"
    ITEM_UPDATED = "item.updated"

    # Tool lifecycle (interceptable)
    PRE_TOOL_USE = "pre.tool_use"
    POST_TOOL_USE = "post.tool_use"
    POST_TOOL_BATCH = "post.tool_batch"

    # Validation lifecycle
    VALIDATION_STARTED = "validation.started"
    VALIDATION_COMPLETED = "validation.completed"

    # Context management
    CONTEXT_TRIMMED = "context.trimmed"
    PRE_COMPACT = "pre.compact"
    POST_COMPACT = "post.compact"

    # Budget
    BUDGET_EXCEEDED = "budget.exceeded"

    # Confirmation
    PRE_CONFIRMATION = "pre.confirmation"
    POST_CONFIRMATION = "post.confirmation"
    CONFIRMATION_CREATED = "confirmation.created"
    CONFIRMATION_CONSUMED = "confirmation.consumed"


# ── Handler result ───────────────────────────────────────────

@dataclass
class HookResult:
    """Result returned by an interceptable hook handler.

    action:
        "continue" — proceed normally
        "abort"    — block the operation
        "modify"   — proceed with modified payload
    """

    action: str = "continue"
    modified_payload: dict[str, Any] | None = None
    reason: str | None = None
    item: dict[str, Any] | None = None


# ── Handler protocol ─────────────────────────────────────────

EventHandler = Callable[[AgentEvent, dict[str, Any]], Awaitable[HookResult | None]]


class EventBus:
    """Central event bus for the agent runtime.

    Supports two modes:
    - ``emit``: fire-and-forget, calls all registered handlers sequentially.
      Handlers cannot veto; their HookResult is logged but ignored.

    - ``intercept``: calls handlers in registration order; the first handler
      that returns ``HookResult(action="abort")`` stops the chain and the
      intercept returns that result.  A handler returning ``action="modify"``
      updates the payload for subsequent handlers.
    """

    def __init__(self) -> None:
        self._handlers: dict[AgentEvent, list[EventHandler]] = {}

    def on(self, event: AgentEvent, handler: EventHandler) -> None:
        """Register an async handler for an event."""
        self._handlers.setdefault(event, []).append(handler)

    def off(self, event: AgentEvent, handler: EventHandler) -> None:
        """Unregister a handler."""
        handlers = self._handlers.get(event)
        if handlers and handler in handlers:
            handlers.remove(handler)

    async def emit(self, event: AgentEvent, payload: dict[str, Any]) -> None:
        """Fire-and-forget: call all handlers, ignoring their results."""
        for handler in self._handlers.get(event, []):
            try:
                await handler(event, payload)
            except Exception:
                # Handlers must not crash the runtime, but failures must be visible.
                logger.exception("Event handler failed: event=%s handler=%r", event.value, handler)

    async def intercept(
        self, event: AgentEvent, payload: dict[str, Any]
    ) -> HookResult:
        """Interceptable: handlers can abort or modify the payload.

        Returns the final HookResult.  If no handler objects, returns
        ``HookResult(action="continue")``.
        """
        current_payload = payload
        for handler in self._handlers.get(event, []):
            try:
                result = await handler(event, current_payload)
            except Exception:
                # A crashing hook must not silently disappear: log and treat
                # it as "no opinion" rather than blocking the pipeline.
                logger.exception("Intercept handler failed: event=%s handler=%r", event.value, handler)
                continue

            if result is None:
                continue

            if result.action == "abort":
                return result

            if result.action == "modify" and result.modified_payload is not None:
                current_payload = result.modified_payload

        return HookResult(action="continue", modified_payload=current_payload)


# ── Backward-compatible adapter ──────────────────────────────

class CompositeEventSink:
    """Wraps an EventBus and an optional legacy ``event_sink`` callable.

    Provides the ``Callable[[str, dict], Awaitable[None]]`` signature that
    the existing SSE streaming layer expects, while also forwarding events
    to the EventBus.
    """

    def __init__(
        self,
        bus: EventBus | None = None,
        legacy_sink: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        self._bus = bus
        self._legacy = legacy_sink

    async def __call__(self, event_type: str, data: dict[str, Any]) -> None:
        """Act as a drop-in replacement for the old event_sink callable."""
        # Forward to legacy SSE sink first (preserves real-time streaming)
        if self._legacy:
            await self._legacy(event_type, data)

        # Also emit to the bus (fire-and-forget)
        if self._bus:
            # Map common string event names to AgentEvent enum
            agent_event = _STRING_TO_EVENT.get(event_type)
            if agent_event:
                await self._bus.emit(agent_event, data)


# ── Mapping from legacy string event names to enum ───────────

_STRING_TO_EVENT: dict[str, AgentEvent] = {
    "run.started": AgentEvent.RUN_STARTED,
    "run.completed": AgentEvent.RUN_COMPLETED,
    "run.failed": AgentEvent.RUN_FAILED,
    "item.created": AgentEvent.ITEM_CREATED,
    "item.updated": AgentEvent.ITEM_UPDATED,
    "step.completed": AgentEvent.STEP_COMPLETED,
    "tool.started": AgentEvent.PRE_TOOL_USE,
    "tool.completed": AgentEvent.POST_TOOL_USE,
    "pre.tool_use": AgentEvent.PRE_TOOL_USE,
    "post.tool_use": AgentEvent.POST_TOOL_USE,
    "pre.confirmation": AgentEvent.PRE_CONFIRMATION,
    "post.confirmation": AgentEvent.POST_CONFIRMATION,
    "validation.started": AgentEvent.VALIDATION_STARTED,
    "validation.completed": AgentEvent.VALIDATION_COMPLETED,
    "context.trimmed": AgentEvent.CONTEXT_TRIMMED,
    "budget.exceeded": AgentEvent.BUDGET_EXCEEDED,
    "confirmation.created": AgentEvent.CONFIRMATION_CREATED,
    "confirmation.consumed": AgentEvent.CONFIRMATION_CONSUMED,
}
