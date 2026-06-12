"""Tests for the EventBus lifecycle system (Phase 0)."""
import asyncio
import pytest

from app.services.ai.events import (
    AgentEvent,
    CompositeEventSink,
    EventBus,
    HookResult,
)


# ── EventBus tests ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_event_bus_emit_calls_handler():
    bus = EventBus()
    received = []

    async def handler(event, payload):
        received.append((event, payload))

    bus.on(AgentEvent.RUN_STARTED, handler)
    await bus.emit(AgentEvent.RUN_STARTED, {"user": "alice"})

    assert len(received) == 1
    assert received[0][0] == AgentEvent.RUN_STARTED
    assert received[0][1] == {"user": "alice"}


@pytest.mark.asyncio
async def test_event_bus_emit_multiple_handlers():
    bus = EventBus()
    count = []

    async def h1(event, payload):
        count.append(1)

    async def h2(event, payload):
        count.append(2)

    bus.on(AgentEvent.STEP_COMPLETED, h1)
    bus.on(AgentEvent.STEP_COMPLETED, h2)
    await bus.emit(AgentEvent.STEP_COMPLETED, {})

    assert count == [1, 2]


@pytest.mark.asyncio
async def test_event_bus_emit_no_handler():
    bus = EventBus()
    # Should not raise
    await bus.emit(AgentEvent.BUDGET_EXCEEDED, {"tokens": 999})


@pytest.mark.asyncio
async def test_event_bus_emit_handler_exception_does_not_crash():
    bus = EventBus()

    async def bad_handler(event, payload):
        raise RuntimeError("boom")

    bus.on(AgentEvent.RUN_FAILED, bad_handler)
    # Should not raise
    await bus.emit(AgentEvent.RUN_FAILED, {})


@pytest.mark.asyncio
async def test_event_bus_off_removes_handler():
    bus = EventBus()
    count = []

    async def handler(event, payload):
        count.append(1)

    bus.on(AgentEvent.RUN_STARTED, handler)
    bus.off(AgentEvent.RUN_STARTED, handler)
    await bus.emit(AgentEvent.RUN_STARTED, {})

    assert count == []


# ── Intercept tests ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_intercept_continue_when_no_handler_objects():
    bus = EventBus()

    async def handler(event, payload):
        return HookResult(action="continue")

    bus.on(AgentEvent.PRE_TOOL_USE, handler)
    result = await bus.intercept(AgentEvent.PRE_TOOL_USE, {"tool_name": "Read"})

    assert result.action == "continue"


@pytest.mark.asyncio
async def test_intercept_abort_stops_chain():
    bus = EventBus()

    async def blocker(event, payload):
        return HookResult(action="abort", reason="Blocked!")

    bus.on(AgentEvent.PRE_TOOL_USE, blocker)
    result = await bus.intercept(AgentEvent.PRE_TOOL_USE, {"tool_name": "Bash"})

    assert result.action == "abort"
    assert result.reason == "Blocked!"


@pytest.mark.asyncio
async def test_intercept_modify_updates_payload():
    bus = EventBus()

    async def modifier(event, payload):
        return HookResult(
            action="modify",
            modified_payload={**payload, "extra": "added"},
        )

    bus.on(AgentEvent.PRE_TOOL_USE, modifier)
    result = await bus.intercept(AgentEvent.PRE_TOOL_USE, {"tool_name": "Read"})

    assert result.action == "continue"
    assert result.modified_payload == {"tool_name": "Read", "extra": "added"}


@pytest.mark.asyncio
async def test_intercept_handler_exception_skipped():
    bus = EventBus()

    async def bad(event, payload):
        raise RuntimeError("oops")

    async def good(event, payload):
        return HookResult(action="continue")

    bus.on(AgentEvent.PRE_TOOL_USE, bad)
    bus.on(AgentEvent.PRE_TOOL_USE, good)
    result = await bus.intercept(AgentEvent.PRE_TOOL_USE, {})

    assert result.action == "continue"


# ── CompositeEventSink tests ─────────────────────────────────

@pytest.mark.asyncio
async def test_composite_sink_forwards_to_legacy():
    bus = EventBus()
    legacy_events = []

    async def legacy(event_type, data):
        legacy_events.append((event_type, data))

    sink = CompositeEventSink(bus=bus, legacy_sink=legacy)
    await sink("step.completed", {"step": {"id": "s1"}})

    assert len(legacy_events) == 1
    assert legacy_events[0][0] == "step.completed"


@pytest.mark.asyncio
async def test_composite_sink_emits_to_bus():
    bus = EventBus()
    bus_events = []

    async def handler(event, payload):
        bus_events.append((event, payload))

    bus.on(AgentEvent.STEP_COMPLETED, handler)

    sink = CompositeEventSink(bus=bus)
    await sink("step.completed", {"step": {"id": "s1"}})

    assert len(bus_events) == 1
    assert bus_events[0][0] == AgentEvent.STEP_COMPLETED


@pytest.mark.asyncio
async def test_composite_sink_without_bus():
    legacy_events = []

    async def legacy(event_type, data):
        legacy_events.append(event_type)

    sink = CompositeEventSink(legacy_sink=legacy)
    await sink("run.completed", {})

    assert legacy_events == ["run.completed"]


@pytest.mark.asyncio
async def test_composite_sink_without_legacy():
    bus = EventBus()
    bus_events = []

    async def handler(event, payload):
        bus_events.append(event)

    bus.on(AgentEvent.RUN_STARTED, handler)

    sink = CompositeEventSink(bus=bus)
    await sink("run.started", {"user": "test"})

    assert bus_events == [AgentEvent.RUN_STARTED]


# ── AgentEvent enum tests ────────────────────────────────────

def test_agent_event_values():
    assert AgentEvent.RUN_STARTED.value == "run.started"
    assert AgentEvent.PRE_TOOL_USE.value == "pre.tool_use"
    assert AgentEvent.POST_TOOL_USE.value == "post.tool_use"
    assert AgentEvent.PRE_CONFIRMATION.value == "pre.confirmation"
    assert AgentEvent.POST_CONFIRMATION.value == "post.confirmation"
    assert AgentEvent.VALIDATION_STARTED.value == "validation.started"
    assert AgentEvent.VALIDATION_COMPLETED.value == "validation.completed"
    assert AgentEvent.BUDGET_EXCEEDED.value == "budget.exceeded"
    assert AgentEvent.CONTEXT_TRIMMED.value == "context.trimmed"
    assert AgentEvent.PRE_COMPACT.value == "pre.compact"
    assert AgentEvent.POST_COMPACT.value == "post.compact"


def test_hook_result_defaults():
    result = HookResult()
    assert result.action == "continue"
    assert result.modified_payload is None
    assert result.reason is None
    assert result.item is None
