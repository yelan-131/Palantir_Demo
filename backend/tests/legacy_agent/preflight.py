"""Cheap preflight gate before expensive Agent planning."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.services.ai.policies import decide_ai_permission


@dataclass
class PreflightDecision:
    allowed: bool
    capability: str
    risk_level: str
    domain: str | None = None
    reason: str = ""
    matched_role: str | None = None
    requires_confirmation: bool = False
    audit_required: bool = False

    def as_step(self) -> dict[str, Any]:
        return {
            "id": "step-preflight",
            "type": "policy",
            "status": "completed" if self.allowed else "blocked",
            "capability": self.capability,
            "risk_level": self.risk_level,
            "domain": self.domain,
            "matched_role": self.matched_role,
            "requires_confirmation": self.requires_confirmation,
            "audit_required": self.audit_required,
            "summary": self.reason or ("Preflight passed" if self.allowed else "Preflight blocked"),
        }


def _contains(text: str, tokens: list[str]) -> bool:
    lowered = text.lower()
    compacted = re.sub(r"\s+", "", lowered)
    return any(token.lower() in lowered or re.sub(r"\s+", "", token.lower()) in compacted for token in tokens)


def classify_preflight(message: str, context: dict[str, Any] | None = None) -> tuple[str, str, str | None]:
    """Return capability, risk, and domain using only cheap local signals."""

    context = context or {}
    text = f"{message}\n{context.get('currentPage') or ''}\n{context.get('page') or ''}"
    if _contains(text, ["\u5220\u9664", "delete", "\u6539\u6743\u9650", "\u6743\u9650\u53d8\u66f4", "change permission"]):
        return "config", "critical", "low-code"
    if _contains(text, ["\u8868\u5355", "form"]) and _contains(text, ["\u65b0\u5efa", "\u521b\u5efa", "create", "new", "build"]):
        return "config", "high", "low-code"
    if _contains(text, ["\u65b0\u5efa\u8868\u5355", "\u521b\u5efa\u8868\u5355", "\u65b0\u589e\u5b57\u6bb5", "\u65b0\u5efa\u5b57\u6bb5", "low-code", "low code", "form creation"]):
        return "config", "high", "low-code"
    if _contains(text, ["\u542f\u52a8\u6d41\u7a0b", "\u63d0\u4ea4\u5ba1\u6279", "\u53d1\u8d77\u6d41\u7a0b", "workflow", "submit"]):
        return "workflow", "high", "workflow"
    if _contains(text, ["\u4e0b\u5355", "\u8ba2\u5355", "\u91c7\u8d2d", "purchase order", "order"]):
        return "workflow", "high", "supply-chain"
    if _contains(text, ["\u8349\u7a3f", "\u65b0\u5efa\u6570\u636e", "\u521b\u5efa\u8bb0\u5f55", "create record", "draft"]):
        return "draft", "medium", None
    if _contains(text, ["\u5206\u6790", "\u67e5\u8be2", "\u7edf\u8ba1", "\u67e5\u770b", "records", "record", "analyze", "query"]):
        return "business_query", "low", None
    return "qa", "low", None


def preflight_agent_request(
    *,
    message: str,
    context: dict[str, Any] | None,
    user: dict[str, Any] | None,
    settings: dict[str, Any],
) -> PreflightDecision:
    capability, risk_level, domain = classify_preflight(message, context)
    if not user:
        return PreflightDecision(
            allowed=True,
            capability=capability,
            risk_level=risk_level,
            domain=domain,
            reason="No authenticated user context supplied to service-level preflight",
            requires_confirmation=risk_level in {"medium", "high", "critical"},
        )
    decision = decide_ai_permission(user, settings, capability, domain=domain, risk_level=risk_level)
    return PreflightDecision(
        allowed=decision.allowed,
        capability=capability,
        risk_level=risk_level,
        domain=domain,
        reason=decision.reason,
        matched_role=decision.matched_role,
        requires_confirmation=decision.requires_confirmation,
        audit_required=decision.audit_required,
    )
