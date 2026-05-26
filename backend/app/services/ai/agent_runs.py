"""Agent run state for the first enterprise AI runtime."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from .confirmations import consume_confirmation_token, create_confirmation_payload
from .schemas import AgentRequest, AgentResponse


AGENT_RUNS: dict[str, dict[str, Any]] = {}


def _user_key(user: dict[str, Any]) -> str:
    return str(user.get("sub") or user.get("username") or user.get("uid") or "unknown")


def create_agent_run(request: AgentRequest, response: AgentResponse, user: dict[str, Any]) -> dict[str, Any]:
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    actions = [action.model_dump() for action in response.actions]
    if response.requires_confirmation and not response.confirmation_payload:
        response.confirmation_payload = create_confirmation_payload(
            user=user,
            actions=actions,
            evidence=response.evidence,
            risk_level=response.risk_level,
        )
    response.run_id = run_id
    record = {
        "run_id": run_id,
        "status": "waiting_confirmation" if response.requires_confirmation else "completed",
        "mode": response.mode,
        "message": request.message,
        "page": request.page,
        "context": request.context,
        "answer": response.answer,
        "evidence": response.evidence,
        "steps": response.steps,
        "actions": actions,
        "requires_confirmation": response.requires_confirmation,
        "confirmation_payload": response.confirmation_payload,
        "risk_level": response.risk_level,
        "created_by": _user_key(user),
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    AGENT_RUNS[run_id] = record
    return record


def get_agent_run(run_id: str) -> dict[str, Any] | None:
    return AGENT_RUNS.get(run_id)


def cancel_agent_run(run_id: str, user: dict[str, Any]) -> dict[str, Any]:
    record = AGENT_RUNS.get(run_id)
    if not record:
        raise ValueError("Agent run not found")
    if record["status"] in {"confirmed", "completed", "cancelled"}:
        raise ValueError("Agent run cannot be cancelled in its current status")
    if record["created_by"] != _user_key(user):
        raise ValueError("Agent run belongs to a different user")
    record["status"] = "cancelled"
    record["updated_at"] = datetime.now().isoformat()
    return record


def confirm_agent_run(run_id: str, token: str, user: dict[str, Any]) -> dict[str, Any]:
    record = AGENT_RUNS.get(run_id)
    if not record:
        raise ValueError("Agent run not found")
    if record["status"] == "cancelled":
        raise ValueError("Cancelled agent runs cannot be confirmed")
    if record["status"] in {"confirmed", "completed"}:
        raise ValueError("Agent run has already been confirmed")
    if record["created_by"] != _user_key(user):
        raise ValueError("Agent run belongs to a different user")
    confirmation = consume_confirmation_token(token, user=user)
    expected_token = (record.get("confirmation_payload") or {}).get("confirmation_token")
    if expected_token and expected_token != token:
        raise ValueError("Confirmation token does not match this agent run")
    record["status"] = "confirmed"
    record["confirmation"] = confirmation
    record["updated_at"] = datetime.now().isoformat()
    return record
