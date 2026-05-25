"""First-pass AI Agent orchestrator."""

from __future__ import annotations

from .knowledge_ingestion import search_ingested_knowledge
from .schemas import AgentRequest, AgentResponse
from .tools import choose_draft_actions


async def run_agent(request: AgentRequest) -> AgentResponse:
    evidence = search_ingested_knowledge(request.message, limit=3)
    actions = choose_draft_actions(request.message, evidence=evidence)
    if actions:
        return AgentResponse(
            answer="I prepared draft skill actions. They are not submitted until a user confirms them.",
            actions=actions,
            evidence=evidence,
            requires_confirmation=any(action.requires_confirmation for action in actions),
            mode="assisted",
        )

    if evidence:
        return AgentResponse(
            answer="I found related knowledge evidence. Use the cited sources to review the answer before acting.",
            evidence=evidence,
            mode="qa",
        )

    return AgentResponse(
        answer="AI is configured for enterprise Q&A and draft generation. Add knowledge assets or ask for a supported draft to get richer results.",
        mode="qa",
    )
