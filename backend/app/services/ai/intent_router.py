"""Structured intent routing for Agent runtime decisions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from .agent_context_router import ContextNeed, classify_context_need
from .planner import plan_agent_turn
from .schemas import AIProviderConfig
from .semantic_planner import plan_agent_turn_semantic


IntentKind = Literal["conversation", "knowledge", "business_query", "action_prepare", "page_help"]


@dataclass
class IntentRoute:
    intent: IntentKind
    target: str | None = None
    skill: str | None = None
    context_need: ContextNeed = "none"
    needs_context: list[str] = field(default_factory=list)
    missing_slots: list[str] = field(default_factory=list)
    risk: str = "low"
    confidence: float = 0.4
    reason: str = ""
    extracted_context: dict[str, Any] = field(default_factory=dict)
    source_message: str = ""

    def as_step(self) -> dict[str, Any]:
        return {
            "id": "step-intent-router",
            "type": "plan",
            "status": "completed",
            "intent": self.intent,
            "target": self.target,
            "skill": self.skill,
            "context_need": self.context_need,
            "needs_context": self.needs_context,
            "missing_slots": self.missing_slots,
            "risk": self.risk,
            "confidence": self.confidence,
            "reason": self.reason,
        }


def route_intent(message: str, context: dict[str, Any] | None = None) -> IntentRoute:
    context = context or {}
    normalized = message.strip()
    if not normalized:
        return IntentRoute(intent="conversation", reason="empty_message", source_message=message)

    plan = plan_agent_turn(message, context)
    if plan.intent == "action" and plan.skill:
        return IntentRoute(
            intent="action_prepare",
            target="form" if plan.skill == "low_code.create_form_definition" else "action",
            skill=plan.skill,
            context_need="draft_action",
            needs_context=["skill_contract", "tool_contract", "permission_policy"],
            missing_slots=[],
            risk="high",
            confidence=plan.confidence,
            reason=plan.reason,
            extracted_context=plan.extracted_context,
            source_message=plan.source_message,
        )

    context_need = classify_context_need(message, context)
    if context_need == "knowledge_rag":
        return IntentRoute(
            intent="knowledge",
            target="knowledge",
            context_need=context_need,
            needs_context=["knowledge_evidence"],
            confidence=0.72,
            reason="context_router",
            source_message=message,
        )
    if context_need in {"business_query", "visible_dataset", "current_object", "semantic_graph"}:
        return IntentRoute(
            intent="business_query",
            target="business_data",
            context_need=context_need,
            needs_context=["semantic_context"],
            confidence=0.68,
            reason="context_router",
            source_message=message,
        )
    if context_need == "ui_page":
        return IntentRoute(
            intent="page_help",
            target="current_page",
            context_need=context_need,
            needs_context=["page_context"],
            confidence=0.62,
            reason="context_router",
            source_message=message,
        )
    return IntentRoute(intent="conversation", reason="default_conversation", source_message=message)


async def route_intent_async(
    message: str,
    context: dict[str, Any] | None = None,
    *,
    provider_config: AIProviderConfig | None = None,
    usage_sink: Callable[[dict[str, Any]], None] | None = None,
) -> IntentRoute:
    context = context or {}
    normalized = message.strip()
    if not normalized:
        return IntentRoute(intent="conversation", reason="empty_message", source_message=message)

    plan = await plan_agent_turn_semantic(message, context, provider_config=provider_config, usage_sink=usage_sink)
    if plan.intent == "action" and plan.skill:
        return IntentRoute(
            intent="action_prepare",
            target="form" if plan.skill == "low_code.create_form_definition" else "action",
            skill=plan.skill,
            context_need="draft_action",
            needs_context=["skill_contract", "tool_contract", "permission_policy"],
            missing_slots=[],
            risk="high",
            confidence=plan.confidence,
            reason=plan.reason,
            extracted_context=plan.extracted_context,
            source_message=plan.source_message,
        )

    context_need = classify_context_need(message, context)
    if context_need == "knowledge_rag":
        return IntentRoute(
            intent="knowledge",
            target="knowledge",
            context_need=context_need,
            needs_context=["knowledge_evidence"],
            confidence=0.72,
            reason="context_router",
            source_message=message,
        )
    if context_need in {"business_query", "visible_dataset", "current_object", "semantic_graph"}:
        return IntentRoute(
            intent="business_query",
            target="business_data",
            context_need=context_need,
            needs_context=["semantic_context"],
            confidence=0.68,
            reason="context_router",
            source_message=message,
        )
    if context_need == "ui_page":
        return IntentRoute(
            intent="page_help",
            target="current_page",
            context_need=context_need,
            needs_context=["page_context"],
            confidence=0.62,
            reason="context_router",
            source_message=message,
        )
    return IntentRoute(intent="conversation", reason="default_conversation", source_message=message)
