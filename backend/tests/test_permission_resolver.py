"""Tests for the multi-layer permission resolver."""

from __future__ import annotations

import pytest

from app.services.ai.permission_resolver import (
    PermissionDecision,
    PermissionRule,
    PermissionResolver,
    build_default_rules,
    load_permission_rules,
)


# ---------------------------------------------------------------------------
# PermissionRule.matches()
# ---------------------------------------------------------------------------


class TestPermissionRuleMatches:
    """Tests for PermissionRule.matches() with glob patterns."""

    def test_no_patterns_matches_everything(self):
        rule = PermissionRule(action="allow")
        assert rule.matches("any_tool", {"admin"}, "low", "production") is True

    def test_tool_pattern_glob_star(self):
        rule = PermissionRule(action="deny", tool_pattern="forms.*")
        assert rule.matches("forms.query_records", set(), "low", None) is True
        assert rule.matches("forms.get_record", set(), "low", None) is True
        assert rule.matches("inventory.query", set(), "low", None) is False

    def test_tool_pattern_exact(self):
        rule = PermissionRule(action="deny", tool_pattern="data.delete_record")
        assert rule.matches("data.delete_record", set(), "low", None) is True
        assert rule.matches("data.query", set(), "low", None) is False

    def test_tool_pattern_wildcard_all(self):
        rule = PermissionRule(action="ask", tool_pattern="*")
        assert rule.matches("anything", set(), "low", None) is True

    def test_role_pattern_matches_any_role_in_set(self):
        rule = PermissionRule(action="deny", role_pattern="viewer")
        assert rule.matches("tool", {"admin", "viewer"}, "low", None) is True
        assert rule.matches("tool", {"admin"}, "low", None) is False

    def test_role_pattern_glob(self):
        rule = PermissionRule(action="allow", role_pattern="*manager")
        assert rule.matches("tool", {"production_manager"}, "low", None) is True
        assert rule.matches("tool", {"quality_engineer"}, "low", None) is False

    def test_domain_pattern_match(self):
        rule = PermissionRule(action="ask", domain_pattern="production")
        assert rule.matches("tool", set(), "low", "production") is True
        assert rule.matches("tool", set(), "low", "quality") is False

    def test_domain_pattern_with_none_domain(self):
        """If domain_pattern is set but domain is None, rule does not match."""
        rule = PermissionRule(action="ask", domain_pattern="production")
        assert rule.matches("tool", set(), "low", None) is False

    def test_risk_threshold_low_passes(self):
        """risk_threshold='low' means risk_level >= low must pass."""
        rule = PermissionRule(action="ask", risk_threshold="low")
        assert rule.matches("tool", set(), "low", None) is True
        assert rule.matches("tool", set(), "medium", None) is True

    def test_risk_threshold_high_blocks_medium(self):
        """risk_threshold='high' means only high and critical match."""
        rule = PermissionRule(action="ask", risk_threshold="high")
        assert rule.matches("tool", set(), "low", None) is False
        assert rule.matches("tool", set(), "medium", None) is False
        assert rule.matches("tool", set(), "high", None) is True
        assert rule.matches("tool", set(), "critical", None) is True

    def test_risk_threshold_critical_only(self):
        rule = PermissionRule(action="deny", risk_threshold="critical")
        assert rule.matches("tool", set(), "critical", None) is True
        assert rule.matches("tool", set(), "high", None) is False

    def test_combined_patterns_all_must_match(self):
        rule = PermissionRule(
            action="deny",
            tool_pattern="supply.*",
            role_pattern="viewer",
            risk_threshold="medium",
        )
        assert rule.matches("supply.order", {"viewer"}, "medium", None) is True
        assert rule.matches("supply.order", {"viewer"}, "low", None) is False
        assert rule.matches("supply.order", {"admin"}, "medium", None) is False
        assert rule.matches("inventory.query", {"viewer"}, "medium", None) is False


# ---------------------------------------------------------------------------
# PermissionResolver resolve()
# ---------------------------------------------------------------------------


class TestPermissionResolver:
    """Tests for PermissionResolver.resolve() decision ordering."""

    def _user(self, *, is_admin=False, roles=None):
        return {"is_admin": is_admin, "roles": roles or []}

    def test_deny_takes_precedence_over_allow(self):
        """Even if an allow rule matches, deny rules are checked first."""
        resolver = PermissionResolver([
            PermissionRule(action="allow", tool_pattern="forms.*"),
            PermissionRule(action="deny", tool_pattern="forms.delete"),
        ])
        user = self._user()
        decision, reason = resolver.resolve("forms.delete", user, "low")
        assert decision is PermissionDecision.DENY
        assert "forms.delete" in reason

    def test_deny_takes_precedence_over_ask(self):
        resolver = PermissionResolver([
            PermissionRule(action="ask", tool_pattern="*"),
            PermissionRule(action="deny", tool_pattern="dangerous.*"),
        ])
        user = self._user()
        decision, _ = resolver.resolve("dangerous.tool", user, "low")
        assert decision is PermissionDecision.DENY

    def test_ask_rule_returns_ask(self):
        resolver = PermissionResolver([
            PermissionRule(action="ask", risk_threshold="high"),
        ])
        user = self._user()
        decision, reason = resolver.resolve("some_tool", user, "high")
        assert decision is PermissionDecision.ASK
        assert reason

    def test_ask_before_allow(self):
        resolver = PermissionResolver([
            PermissionRule(action="allow", tool_pattern="*"),
            PermissionRule(action="ask", tool_pattern="write.*"),
        ])
        user = self._user()
        decision, _ = resolver.resolve("write.record", user, "low")
        assert decision is PermissionDecision.ASK

    def test_allow_rule_returns_allow(self):
        resolver = PermissionResolver([
            PermissionRule(action="allow", tool_pattern="knowledge.*"),
        ])
        user = self._user()
        decision, reason = resolver.resolve("knowledge.search", user, "low")
        assert decision is PermissionDecision.ALLOW
        assert "Allowed by rule" in reason

    def test_no_rules_returns_default_allow(self):
        resolver = PermissionResolver()
        user = self._user()
        decision, reason = resolver.resolve("any_tool", user, "low")
        assert decision is PermissionDecision.ALLOW
        assert "default" in reason.lower()

    def test_no_matching_rule_returns_default(self):
        resolver = PermissionResolver([
            PermissionRule(action="deny", tool_pattern="forbidden.*"),
        ])
        user = self._user()
        decision, reason = resolver.resolve("safe_tool", user, "low")
        assert decision is PermissionDecision.ALLOW
        assert "default" in reason.lower()

    def test_rule_with_role_pattern_admin(self):
        resolver = PermissionResolver([
            PermissionRule(action="deny", role_pattern="viewer", tool_pattern="admin.*"),
        ])
        admin_user = self._user(is_admin=True)
        viewer_user = self._user(roles=[{"name": "viewer"}])

        decision_a, _ = resolver.resolve("admin.settings", admin_user, "low")
        decision_v, _ = resolver.resolve("admin.settings", viewer_user, "low")

        assert decision_a is PermissionDecision.ALLOW  # admin does not match viewer pattern
        assert decision_v is PermissionDecision.DENY   # viewer matches

    def test_multiple_deny_rules_first_match_wins(self):
        resolver = PermissionResolver([
            PermissionRule(action="deny", tool_pattern="a.*", reason="first deny"),
            PermissionRule(action="deny", tool_pattern="a.b", reason="second deny"),
        ])
        user = self._user()
        decision, reason = resolver.resolve("a.b", user, "low")
        assert decision is PermissionDecision.DENY
        assert "first deny" in reason

    def test_fnmatch_pattern_forms_star(self):
        """fnmatch pattern 'forms.*' matches 'forms.query_records'."""
        resolver = PermissionResolver([
            PermissionRule(action="allow", tool_pattern="forms.*"),
        ])
        user = self._user()
        decision, _ = resolver.resolve("forms.query_records", user, "low")
        assert decision is PermissionDecision.ALLOW

    def test_domain_matching_in_resolve(self):
        resolver = PermissionResolver([
            PermissionRule(action="deny", domain_pattern="secret", tool_pattern="*"),
        ])
        user = self._user()
        decision, _ = resolver.resolve("some_tool", user, "low", domain="secret")
        assert decision is PermissionDecision.DENY

        decision2, _ = resolver.resolve("some_tool", user, "low", domain="public")
        assert decision2 is PermissionDecision.ALLOW  # falls through to default

    def test_risk_level_gate_in_resolve(self):
        resolver = PermissionResolver([
            PermissionRule(action="ask", risk_threshold="high"),
        ])
        user = self._user()

        decision_low, _ = resolver.resolve("tool", user, "low")
        assert decision_low is PermissionDecision.ALLOW  # falls through

        decision_high, _ = resolver.resolve("tool", user, "high")
        assert decision_high is PermissionDecision.ASK


# ---------------------------------------------------------------------------
# _extract_user_roles helper (tested indirectly via resolve, but also directly)
# ---------------------------------------------------------------------------


class TestExtractUserRoles:
    def test_admin_user(self):
        from app.services.ai.permission_resolver import _extract_user_roles
        assert _extract_user_roles({"is_admin": True}) == {"admin"}

    def test_dict_roles(self):
        from app.services.ai.permission_resolver import _extract_user_roles
        user = {"roles": [{"name": "production_manager"}, {"name": "viewer"}]}
        assert _extract_user_roles(user) == {"production_manager", "viewer"}

    def test_string_roles(self):
        from app.services.ai.permission_resolver import _extract_user_roles
        user = {"roles": ["admin", "viewer"]}
        assert _extract_user_roles(user) == {"admin", "viewer"}

    def test_no_roles(self):
        from app.services.ai.permission_resolver import _extract_user_roles
        assert _extract_user_roles({}) == set()


# ---------------------------------------------------------------------------
# load_permission_rules()
# ---------------------------------------------------------------------------


class TestLoadPermissionRules:
    def test_loads_from_safety_policy(self):
        settings = {
            "safetyPolicy": {
                "permissionRules": [
                    {"action": "deny", "tool": "data.delete_record", "reason": "Forbidden"},
                    {"action": "ask", "riskThreshold": "high"},
                ],
            },
        }
        rules = load_permission_rules(settings)
        assert len(rules) == 2
        assert rules[0].action == "deny"
        assert rules[0].tool_pattern == "data.delete_record"
        assert rules[0].reason == "Forbidden"
        assert rules[1].action == "ask"
        assert rules[1].risk_threshold == "high"

    def test_empty_settings_returns_empty_list(self):
        rules = load_permission_rules({})
        assert rules == []

    def test_no_permission_rules_key(self):
        rules = load_permission_rules({"safetyPolicy": {}})
        assert rules == []

    def test_missing_fields_get_defaults(self):
        settings = {
            "safetyPolicy": {
                "permissionRules": [{}],
            },
        }
        rules = load_permission_rules(settings)
        assert len(rules) == 1
        assert rules[0].action == "deny"  # default action


# ---------------------------------------------------------------------------
# build_default_rules()
# ---------------------------------------------------------------------------


class TestBuildDefaultRules:
    def test_produces_rules_from_forbidden_skills(self):
        rules = build_default_rules()
        deny_rules = [r for r in rules if r.action == "deny"]
        assert len(deny_rules) >= 1
        deny_tools = {r.tool_pattern for r in deny_rules}
        assert "purchase.create_purchase_order" in deny_tools
        assert "security.change_permission" in deny_tools

    def test_has_ask_rule_for_high_risk(self):
        rules = build_default_rules()
        ask_rules = [r for r in rules if r.action == "ask"]
        assert any(r.risk_threshold == "high" for r in ask_rules)

    def test_has_allow_rules_for_knowledge_and_platform(self):
        rules = build_default_rules()
        allow_tools = [r.tool_pattern for r in rules if r.action == "allow"]
        assert "knowledge.*" in allow_tools
        assert "platform.*" in allow_tools

    def test_default_rules_are_valid(self):
        """All default rules can be loaded into a resolver and used."""
        rules = build_default_rules()
        resolver = PermissionResolver(rules)
        # A forbidden skill should be denied
        decision, _ = resolver.resolve(
            "purchase.create_purchase_order", {"is_admin": True}, "low",
        )
        assert decision is PermissionDecision.DENY


# ---------------------------------------------------------------------------
# Integration: resolver with loaded settings
# ---------------------------------------------------------------------------


class TestResolverWithLoadedSettings:
    def test_resolve_with_settings_rules(self):
        settings = {
            "safetyPolicy": {
                "permissionRules": [
                    {"action": "deny", "tool": "supply.auto_order"},
                    {"action": "allow", "tool": "forms.*"},
                ],
            },
        }
        rules = load_permission_rules(settings)
        resolver = PermissionResolver(rules)
        user = {"is_admin": False, "roles": []}

        decision_deny, _ = resolver.resolve("supply.auto_order", user, "low")
        assert decision_deny is PermissionDecision.DENY

        decision_allow, _ = resolver.resolve("forms.query", user, "low")
        assert decision_allow is PermissionDecision.ALLOW

        # Unmatched tool falls to default
        decision_default, _ = resolver.resolve("other.tool", user, "low")
        assert decision_default is PermissionDecision.ALLOW
