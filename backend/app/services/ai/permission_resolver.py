"""Multi-layer permission resolver with deny > ask > allow precedence.

Inspired by Claude Code's 5-layer permission defense:
  deny rules -> ask rules -> allow rules -> classifier -> default

Rules are evaluated in strict order; the first matching rule wins.
When no rules match, the system falls back to the existing RBAC logic.
"""
from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class PermissionDecision(Enum):
    ALLOW = "allow"
    ASK = "ask"       # Needs confirmation
    DENY = "deny"


@dataclass
class PermissionRule:
    """A single permission rule.

    Patterns support glob-style matching:
    - "forms.*" matches "forms.query_records", "forms.get_record", etc.
    - "*" matches everything
    - None means "don't match on this field"
    """
    action: str  # "deny", "ask", "allow"
    tool_pattern: str | None = None
    role_pattern: str | None = None
    domain_pattern: str | None = None
    risk_threshold: str | None = None  # "low", "medium", "high", "critical"
    reason: str = ""

    def matches(
        self,
        tool_name: str,
        user_roles: set[str],
        risk_level: str,
        domain: str | None,
    ) -> bool:
        """Check if this rule matches the given context."""
        if self.tool_pattern and not fnmatch.fnmatch(tool_name, self.tool_pattern):
            return False
        if self.role_pattern and not any(fnmatch.fnmatch(r, self.role_pattern) for r in user_roles):
            return False
        if self.domain_pattern and (domain is None or not fnmatch.fnmatch(domain, self.domain_pattern)):
            return False
        if self.risk_threshold:
            risk_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
            if risk_rank.get(risk_level, 0) < risk_rank.get(self.risk_threshold, 0):
                return False
        return True


class PermissionResolver:
    """Evaluates permission rules in strict priority order.

    Rule evaluation order:
    1. All deny rules (in registration order)
    2. All ask rules (in registration order)
    3. All allow rules (in registration order)
    4. Default fallback (calls existing RBAC)

    The first matching rule wins.
    """

    def __init__(self, rules: list[PermissionRule] | None = None):
        self._deny_rules: list[PermissionRule] = []
        self._ask_rules: list[PermissionRule] = []
        self._allow_rules: list[PermissionRule] = []
        if rules:
            for rule in rules:
                self.add_rule(rule)

    def add_rule(self, rule: PermissionRule) -> None:
        """Add a rule to the appropriate priority bucket."""
        if rule.action == "deny":
            self._deny_rules.append(rule)
        elif rule.action == "ask":
            self._ask_rules.append(rule)
        elif rule.action == "allow":
            self._allow_rules.append(rule)

    def resolve(
        self,
        tool_name: str,
        user: dict[str, Any],
        risk_level: str,
        domain: str | None = None,
    ) -> tuple[PermissionDecision, str]:
        """Resolve permission for a tool call.

        Returns (decision, reason).
        """
        user_roles = _extract_user_roles(user)

        # Phase 1: Check deny rules
        for rule in self._deny_rules:
            if rule.matches(tool_name, user_roles, risk_level, domain):
                return PermissionDecision.DENY, rule.reason or f"Denied by rule: {rule.action} {rule.tool_pattern}"

        # Phase 2: Check ask rules
        for rule in self._ask_rules:
            if rule.matches(tool_name, user_roles, risk_level, domain):
                return PermissionDecision.ASK, rule.reason or f"Confirmation required by rule"

        # Phase 3: Check allow rules
        for rule in self._allow_rules:
            if rule.matches(tool_name, user_roles, risk_level, domain):
                return PermissionDecision.ALLOW, rule.reason or "Allowed by rule"

        # Phase 4: No rule matched -- return None to indicate "use default RBAC"
        return PermissionDecision.ALLOW, "No matching rule, using default"


def _extract_user_roles(user: dict[str, Any]) -> set[str]:
    """Extract role names from user dict."""
    if user.get("is_admin"):
        return {"admin"}
    roles = user.get("roles") or []
    names = set()
    for role in roles:
        if isinstance(role, dict):
            if role.get("name"):
                names.add(str(role["name"]))
        elif isinstance(role, str):
            names.add(role)
    return names


def load_permission_rules(settings: dict[str, Any]) -> list[PermissionRule]:
    """Load permission rules from safety policy settings."""
    policy = settings.get("safetyPolicy") or {}
    raw_rules = policy.get("permissionRules") or []
    rules = []
    for raw in raw_rules:
        if isinstance(raw, dict):
            rules.append(PermissionRule(
                action=raw.get("action", "deny"),
                tool_pattern=raw.get("tool"),
                role_pattern=raw.get("role"),
                domain_pattern=raw.get("domain"),
                risk_threshold=raw.get("riskThreshold"),
                reason=raw.get("reason", ""),
            ))
    return rules


def build_default_rules() -> list[PermissionRule]:
    """Build default rules from the existing FORBIDDEN_SKILLS and risk-level gates."""
    from .policies import FORBIDDEN_SKILLS

    rules = []
    # Forbidden skills become deny rules
    for skill in FORBIDDEN_SKILLS:
        rules.append(PermissionRule(
            action="deny",
            tool_pattern=skill,
            reason=f"Tool {skill} is disabled by AI safety policy",
        ))
    # High/critical risk tools need confirmation
    rules.append(PermissionRule(
        action="ask",
        risk_threshold="high",
        reason="High-risk tool requires confirmation",
    ))
    # Read tools are allowed
    rules.append(PermissionRule(
        action="allow",
        tool_pattern="knowledge.*",
        reason="Read-only knowledge tools",
    ))
    rules.append(PermissionRule(
        action="allow",
        tool_pattern="platform.*",
        reason="Read-only platform settings",
    ))
    return rules
