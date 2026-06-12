"""Tests for built-in hooks (Phase 8)."""
import asyncio
import pytest

from app.services.ai.events import AgentEvent, EventBus, HookResult
from app.services.ai.hooks import BuiltinHooks, register_builtin_hooks


class TestAuditToolUse:

    @pytest.mark.asyncio
    async def test_writes_to_audit_log(self):
        from app.services.ai.audit import AI_AUDIT_LOGS
        initial_count = len(AI_AUDIT_LOGS)

        hook = BuiltinHooks.audit_tool_use
        await hook(AgentEvent.POST_TOOL_USE, {"tool": "forms.query_records", "step": {"id": "s1"}})

        assert len(AI_AUDIT_LOGS) > initial_count
        last = AI_AUDIT_LOGS[-1]
        assert last["tool"] == "forms.query_records"

    @pytest.mark.asyncio
    async def test_returns_none(self):
        result = await BuiltinHooks.audit_tool_use(AgentEvent.STEP_COMPLETED, {"tool": "test"})
        assert result is None


class TestLogBudgetExceeded:

    @pytest.mark.asyncio
    async def test_returns_none(self):
        result = await BuiltinHooks.log_budget_exceeded(
            AgentEvent.BUDGET_EXCEEDED,
            {"budget": {"input_tokens": 120000, "max_input_tokens": 100000}},
        )
        assert result is None


class TestLogCompaction:

    @pytest.mark.asyncio
    async def test_returns_none(self):
        result = await BuiltinHooks.log_compaction(
            AgentEvent.POST_COMPACT,
            {"summary": {"original_count": 50, "tools_called": ["forms.query_records"], "errors": []}},
        )
        assert result is None


class TestEnforcePermissions:

    @pytest.mark.asyncio
    async def test_denies_forbidden_tool(self):
        from app.services.ai.permission_resolver import PermissionResolver, PermissionRule, PermissionDecision

        resolver = PermissionResolver([
            PermissionRule(action="deny", tool_pattern="data.delete_record", reason="Forbidden"),
        ])
        hook = BuiltinHooks.enforce_permission_rules(resolver)
        result = await hook(
            AgentEvent.PRE_TOOL_USE,
            {"tool_name": "data.delete_record", "user": {}, "risk_level": "low"},
        )
        assert result is not None
        assert result.action == "abort"

    @pytest.mark.asyncio
    async def test_allows_normal_tool(self):
        from app.services.ai.permission_resolver import PermissionResolver

        resolver = PermissionResolver([])
        hook = BuiltinHooks.enforce_permission_rules(resolver)
        result = await hook(
            AgentEvent.PRE_TOOL_USE,
            {"tool_name": "forms.query_records", "user": {}, "risk_level": "low"},
        )
        assert result is None  # Continue


class TestRegisterBuiltinHooks:

    def test_nothing_registered_when_empty(self):
        bus = EventBus()
        register_builtin_hooks(bus, {"safetyPolicy": {"enabledHooks": []}})
        # No handlers registered
        assert not bus._handlers.get(AgentEvent.STEP_COMPLETED)

    def test_audit_registered(self):
        bus = EventBus()
        register_builtin_hooks(bus, {"safetyPolicy": {"enabledHooks": ["audit_tool_use"]}})
        assert len(bus._handlers.get(AgentEvent.STEP_COMPLETED, [])) == 1
        assert len(bus._handlers.get(AgentEvent.POST_TOOL_USE, [])) == 1

    def test_budget_registered(self):
        bus = EventBus()
        register_builtin_hooks(bus, {"safetyPolicy": {"enabledHooks": ["log_budget_exceeded"]}})
        assert len(bus._handlers.get(AgentEvent.BUDGET_EXCEEDED, [])) == 1

    def test_compaction_registered(self):
        bus = EventBus()
        register_builtin_hooks(bus, {"safetyPolicy": {"enabledHooks": ["log_compaction"]}})
        assert len(bus._handlers.get(AgentEvent.POST_COMPACT, [])) == 1

    def test_permissions_registered(self):
        bus = EventBus()
        register_builtin_hooks(bus, {"safetyPolicy": {"enabledHooks": ["enforce_permissions"]}})
        assert len(bus._handlers.get(AgentEvent.PRE_TOOL_USE, [])) == 1

    def test_multiple_hooks(self):
        bus = EventBus()
        register_builtin_hooks(bus, {"safetyPolicy": {"enabledHooks": ["audit_tool_use", "log_budget_exceeded"]}})
        assert len(bus._handlers.get(AgentEvent.STEP_COMPLETED, [])) == 1
        assert len(bus._handlers.get(AgentEvent.BUDGET_EXCEEDED, [])) == 1
