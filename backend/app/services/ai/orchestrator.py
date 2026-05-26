"""First-pass AI Agent orchestrator."""

from __future__ import annotations

from .knowledge_ingestion import search_ingested_knowledge
from .schemas import AgentRequest, AgentResponse
from .tools import choose_draft_actions


RISK_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def _max_risk(actions) -> str:
    if not actions:
        return "low"
    return max((action.risk_level for action in actions), key=lambda value: RISK_RANK.get(value, 0))


async def run_agent(request: AgentRequest) -> AgentResponse:
    steps = [
        {
            "id": "step-intent",
            "type": "observe",
            "title": "Intent received",
            "status": "completed",
            "summary": request.message[:160],
        }
    ]
    evidence = search_ingested_knowledge(request.message, limit=3)
    steps.append({
        "id": "step-knowledge-search",
        "type": "tool",
        "tool": "knowledge.search",
        "status": "completed",
        "result_count": len(evidence),
    })
    actions = choose_draft_actions(request.message, evidence=evidence)
    if actions:
        steps.append({
            "id": "step-skill-selection",
            "type": "plan",
            "status": "completed",
            "skills": [action.skill for action in actions],
        })
        steps.append({
            "id": "step-confirmation",
            "type": "policy",
            "status": "waiting_confirmation",
            "summary": "Draft actions require human confirmation before saving or submission.",
        })
        return AgentResponse(
            answer="I prepared draft skill actions. They are not submitted until a user confirms them.",
            actions=actions,
            evidence=evidence,
            steps=steps,
            risk_level=_max_risk(actions),
            requires_confirmation=any(action.requires_confirmation for action in actions),
            mode="assisted",
        )

    if evidence:
        return AgentResponse(
            answer="I found related knowledge evidence. Use the cited sources to review the answer before acting.",
            evidence=evidence,
            steps=steps,
            mode="qa",
        )

    steps.append({
        "id": "step-no-action",
        "type": "reflect",
        "status": "completed",
        "summary": "No supported draft skill or knowledge evidence was selected.",
    })
    return AgentResponse(
        answer="AI is configured for enterprise Q&A and draft generation. Add knowledge assets or ask for a supported draft to get richer results.",
        steps=steps,
        mode="qa",
    )
