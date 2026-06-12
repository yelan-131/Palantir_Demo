"""Agent run state for the first enterprise AI runtime."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from .confirmations import consume_confirmation_token, create_confirmation_payload
from .agent_items import confirmation_item, extract_confirmation_payload
from .agent_validation import agent_validation_service
from .schemas import AgentRequest, AgentResponse
from .settings import settings_snapshot


AGENT_RUNS: dict[str, dict[str, Any]] = {}

# In-memory run store must stay bounded in long-running processes.
# Finished runs are evicted first (oldest insertion order first); only when
# every run is still active do we evict the oldest one outright.
MAX_AGENT_RUNS = 1000
_TERMINAL_STATUSES = {"completed", "cancelled", "failed", "confirmed"}


def _evict_agent_runs() -> None:
    while len(AGENT_RUNS) >= MAX_AGENT_RUNS:
        evict_id = next(
            (run_id for run_id, record in AGENT_RUNS.items() if record.get("status") in _TERMINAL_STATUSES),
            next(iter(AGENT_RUNS)),
        )
        AGENT_RUNS.pop(evict_id, None)


def _user_key(user: dict[str, Any]) -> str:
    return str(user.get("sub") or user.get("username") or user.get("uid") or "unknown")


def create_agent_run(request: AgentRequest, response: AgentResponse, user: dict[str, Any]) -> dict[str, Any]:
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    actions = [action.model_dump() for action in response.actions]
    response.run_id = run_id
    response.items = [{**item, "run_id": item.get("run_id") or run_id} for item in response.items]
    confirmation_validation = None
    if response.requires_confirmation:
        confirmation_validation = agent_validation_service.validate_confirmation(
            actions=actions,
            settings=settings_snapshot(),
        )
        response.items.append(confirmation_validation.as_item(run_id=run_id))
        if not confirmation_validation.valid:
            response.requires_confirmation = False
            response.confirmation_payload = {}
            response.answer = f"{response.answer}\n\n确认前验证失败：{confirmation_validation.summary()}"
    if response.requires_confirmation and not response.confirmation_payload:
        response.confirmation_payload = create_confirmation_payload(
            user=user,
            actions=actions,
            evidence=response.evidence,
            risk_level=response.risk_level,
        )
        if confirmation_validation and confirmation_validation.warnings:
            response.confirmation_payload["checklist"] = [
                issue.as_dict() for issue in confirmation_validation.warnings
            ]
    if response.requires_confirmation and response.confirmation_payload:
        response.items = [
            *response.items,
            confirmation_item(confirmation_payload=response.confirmation_payload, run_id=run_id),
        ]
    record = {
        "run_id": run_id,
        "status": "waiting_confirmation" if response.requires_confirmation else ("failed" if confirmation_validation and not confirmation_validation.valid else "completed"),
        "mode": response.mode,
        "message": request.message,
        "page": request.page,
        "context": request.context,
        "answer": response.answer,
        "evidence": response.evidence,
        "items": response.items,
        "actions": actions,
        "requires_confirmation": response.requires_confirmation,
        "risk_level": response.risk_level,
        "created_by": _user_key(user),
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    _evict_agent_runs()
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
    expected_token = extract_confirmation_payload(record.get("items")).get("confirmation_token")
    if expected_token and expected_token != token:
        raise ValueError("Confirmation token does not match this agent run")
    record["status"] = "confirmed"
    record["confirmation"] = confirmation
    record["updated_at"] = datetime.now().isoformat()
    return record
