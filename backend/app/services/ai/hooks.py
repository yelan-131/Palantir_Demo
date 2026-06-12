"""Built-in hook implementations for the agent runtime.

Provides configurable hooks that wire together the EventBus with
budget tracking, permission resolution, and audit logging.
Inspired by Claude Code's hook system where operators can configure
which lifecycle events trigger which behaviors.
"""
from __future__ import annotations

import logging
from typing import Any

from .events import AgentEvent, EventBus, HookResult

logger = logging.getLogger(__name__)


class BuiltinHooks:
    """Static methods that can be registered as EventBus handlers."""

    @staticmethod
    async def audit_tool_use(event: AgentEvent, payload: dict[str, Any]) -> HookResult | None:
        """Record tool usage to the audit log."""
        tool_name = payload.get("tool") or payload.get("tool_name", "unknown")
        step = payload.get("step", {})
        step_id = step.get("id", "unknown")
        logger.info("Agent tool use: tool=%s step=%s", tool_name, step_id)

        # Also write to the in-memory audit log
        try:
            from .audit import AI_AUDIT_LOGS
            AI_AUDIT_LOGS.append({
                "event": event.value,
                "tool": tool_name,
                "step_id": step_id,
                "payload_keys": list(payload.keys()),
            })
        except Exception:
            pass
        return None  # Continue normally

    @staticmethod
    async def log_budget_exceeded(event: AgentEvent, payload: dict[str, Any]) -> HookResult | None:
        """Log when token budget is exceeded."""
        budget_summary = payload.get("budget", {})
        logger.warning(
            "Agent token budget exceeded: input=%d/%d output=%d/%d",
            budget_summary.get("input_tokens", 0),
            budget_summary.get("max_input_tokens", 0),
            budget_summary.get("output_tokens", 0),
            budget_summary.get("max_output_tokens", 0),
        )
        return None

    @staticmethod
    async def log_compaction(event: AgentEvent, payload: dict[str, Any]) -> HookResult | None:
        """Log context compaction events."""
        summary = payload.get("summary", {})
        logger.info(
            "Context compacted: %d messages, tools=%s, errors=%d",
            summary.get("original_count", 0),
            summary.get("tools_called", []),
            len(summary.get("errors", [])),
        )
        return None

    @staticmethod
    def enforce_permission_rules(resolver: Any):
        """Factory: returns a hook that uses PermissionResolver for PRE_TOOL_USE interception."""
        async def hook(event: AgentEvent, payload: dict[str, Any]) -> HookResult | None:
            tool_name = payload.get("tool_name") or payload.get("tool", "")
            user = payload.get("user", {})
            risk_level = payload.get("risk_level", "low")
            domain = payload.get("domain")

            from .permission_resolver import PermissionDecision
            decision, reason = resolver.resolve(tool_name, user, risk_level, domain)

            if decision == PermissionDecision.DENY:
                return HookResult(action="abort", reason=reason)
            return None  # ALLOW or ASK — continue normally

        return hook


def register_builtin_hooks(bus: EventBus, settings: dict[str, Any]) -> None:
    """Register enabled hooks from settings onto the event bus.

    Reads ``enabledHooks`` from the safety policy.  Available hooks:

    - ``audit_tool_use``: logs every tool usage to the audit log
    - ``log_budget_exceeded``: warns when token budget is exceeded
    - ``log_compaction``: logs context compaction events
    - ``enforce_permissions``: uses PermissionResolver for tool interception
    """
    policy = settings.get("safetyPolicy") or {}
    enabled = set(policy.get("enabledHooks") or [])

    if not enabled:
        return

    if "audit_tool_use" in enabled:
        bus.on(AgentEvent.STEP_COMPLETED, BuiltinHooks.audit_tool_use)
        bus.on(AgentEvent.POST_TOOL_USE, BuiltinHooks.audit_tool_use)

    if "log_budget_exceeded" in enabled:
        bus.on(AgentEvent.BUDGET_EXCEEDED, BuiltinHooks.log_budget_exceeded)

    if "log_compaction" in enabled:
        bus.on(AgentEvent.POST_COMPACT, BuiltinHooks.log_compaction)

    if "enforce_permissions" in enabled:
        from .permission_resolver import build_default_rules, PermissionResolver, load_permission_rules
        rules = build_default_rules()
        rules.extend(load_permission_rules(settings))
        resolver = PermissionResolver(rules)
        hook = BuiltinHooks.enforce_permission_rules(resolver)
        bus.on(AgentEvent.PRE_TOOL_USE, hook)
