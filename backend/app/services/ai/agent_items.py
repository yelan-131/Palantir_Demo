"""Agent item protocol for observable AI runtime events."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal


AgentItemType = Literal[
    "message",
    "intent",
    "context",
    "plan",
    "tool_call",
    "tool_result",
    "confirmation",
    "validation",
    "audit",
    "answer",
    "error",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _item_id(prefix: str = "item") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def build_agent_item(
    *,
    type: AgentItemType,
    status: str = "completed",
    title: str | None = None,
    summary: str | None = None,
    payload: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    run_id: str | None = None,
    item_id: str | None = None,
    legacy_id: str | None = None,
    tool: str | None = None,
    skill: str | None = None,
    risk_level: str | None = None,
    side_effect: str | None = None,
    duration_ms: int | None = None,
    error: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """Build a public AgentItem while preserving useful legacy lookup fields."""

    item: dict[str, Any] = {
        "item_id": item_id or legacy_id or _item_id(),
        "id": legacy_id or item_id or _item_id(),  # temporary local lookup aid
        "run_id": run_id,
        "type": type,
        "status": status,
        "title": title or _default_title(type, tool=tool, skill=skill),
        "summary": summary or "",
        "payload": payload or {},
        "metadata": metadata or {},
        "created_at": _now_iso(),
    }
    if tool:
        item["tool"] = tool
    if skill:
        item["skill"] = skill
    if risk_level:
        item["risk_level"] = risk_level
    if side_effect:
        item["side_effect"] = side_effect
    if duration_ms is not None:
        item["duration_ms"] = duration_ms
    if error:
        item["error"] = error
    item.update({key: value for key, value in extra.items() if value is not None})
    return item


def from_legacy_step(step: dict[str, Any], *, run_id: str | None = None) -> dict[str, Any]:
    """Convert an older step dict into the AgentItem protocol."""

    step_type = str(step.get("type") or "plan")
    item_type: AgentItemType
    if step_type == "tool":
        item_type = "tool_result"
    elif step_type in {"observe", "context", "configure"}:
        item_type = "context"
    elif step_type == "policy":
        item_type = "confirmation" if step.get("status") == "waiting_confirmation" else "validation"
    elif step_type == "respond":
        item_type = "answer"
    else:
        item_type = "plan"
    payload = {
        key: value
        for key, value in step.items()
        if key not in {"id", "type", "status", "title", "summary", "tool", "skill", "risk_level", "duration_ms", "error"}
    }
    return build_agent_item(
        type=item_type,
        status=str(step.get("status") or "completed"),
        title=str(step.get("title") or "") or None,
        summary=str(step.get("summary") or ""),
        payload=payload,
        run_id=run_id,
        legacy_id=str(step.get("id") or _item_id("legacy")),
        tool=str(step.get("tool")) if step.get("tool") else None,
        skill=str(step.get("skill")) if step.get("skill") else None,
        risk_level=str(step.get("risk_level")) if step.get("risk_level") else None,
        duration_ms=int(step["duration_ms"]) if isinstance(step.get("duration_ms"), int) else None,
        error=str(step.get("error")) if step.get("error") else None,
        result_count=step.get("result_count"),
        model=step.get("model"),
        provider=step.get("provider"),
        intent=step.get("intent"),
        capability=step.get("capability"),
        matched_role=step.get("matched_role"),
        semantic_objects=step.get("semantic_objects"),
        semantic_records=step.get("semantic_records"),
        sources=step.get("sources"),
        missing_slots=step.get("missing_slots"),
        required=step.get("required"),
    )


def tool_call_item(
    *,
    tool: str,
    skill: str | None = None,
    payload: dict[str, Any] | None = None,
    run_id: str | None = None,
    status: str = "running",
    side_effect: str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    return build_agent_item(
        type="tool_call",
        status=status,
        title=f"Call {tool}",
        summary=f"Calling {tool}",
        payload=payload or {},
        run_id=run_id,
        tool=tool,
        skill=skill,
        side_effect=side_effect,
        risk_level=risk_level,
    )


def tool_result_item(
    *,
    tool: str,
    skill: str | None = None,
    output: dict[str, Any] | None = None,
    run_id: str | None = None,
    status: str = "completed",
    duration_ms: int | None = None,
    error: str | None = None,
    side_effect: str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    result_count = _result_count(output or {})
    return build_agent_item(
        type="tool_result",
        status=status,
        title=f"{tool} result",
        summary=_result_summary(output or {}, error=error),
        payload=output or {},
        run_id=run_id,
        tool=tool,
        skill=skill,
        duration_ms=duration_ms,
        error=error,
        side_effect=side_effect,
        risk_level=risk_level,
        result_count=result_count,
    )


def confirmation_item(
    *,
    confirmation_payload: dict[str, Any],
    run_id: str | None = None,
    summary: str = "Human confirmation is required before execution.",
) -> dict[str, Any]:
    return build_agent_item(
        type="confirmation",
        status="waiting_confirmation",
        title="Waiting for confirmation",
        summary=summary,
        payload=confirmation_payload,
        run_id=run_id,
        risk_level=str(confirmation_payload.get("risk_level") or "medium"),
        requires_confirmation=True,
    )


def error_item(
    *,
    summary: str,
    error: str,
    run_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return build_agent_item(
        type="error",
        status="failed",
        title="Agent error",
        summary=summary,
        payload=payload or {},
        run_id=run_id,
        error=error,
    )


def validation_item(
    *,
    phase: str,
    status: str,
    summary: str,
    issues: list[dict[str, Any]] | None = None,
    run_id: str | None = None,
    tool: str | None = None,
    skill: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    issue_list = issues or []
    return build_agent_item(
        type="validation",
        status=status,
        title=f"Validation: {phase}",
        summary=summary,
        payload={
            "phase": phase,
            "valid": status != "failed",
            "issues": issue_list,
            **(payload or {}),
        },
        run_id=run_id,
        tool=tool,
        skill=skill,
        error=next((str(issue.get("message")) for issue in issue_list if issue.get("severity") == "error"), None),
        issue_count=len(issue_list),
    )


def extract_confirmation_payload(items: list[dict[str, Any]] | None) -> dict[str, Any]:
    for item in reversed(items or []):
        if item.get("type") == "confirmation" and isinstance(item.get("payload"), dict):
            return dict(item["payload"])
    return {}


def extract_actions(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    payload = extract_confirmation_payload(items)
    actions = payload.get("actions")
    return actions if isinstance(actions, list) else []


def items_from_steps(steps: list[dict[str, Any]] | None, *, run_id: str | None = None) -> list[dict[str, Any]]:
    return [from_legacy_step(step, run_id=run_id) for step in (steps or []) if isinstance(step, dict)]


def _default_title(item_type: str, *, tool: str | None = None, skill: str | None = None) -> str:
    if item_type in {"tool_call", "tool_result"} and tool:
        return tool
    if item_type == "confirmation":
        return "Confirmation"
    if skill:
        return skill
    return item_type.replace("_", " ").title()


def _result_count(output: dict[str, Any]) -> int | None:
    for key in ("result_count", "record_count", "count", "embedding_count"):
        value = output.get(key)
        if isinstance(value, int):
            return value
    for key in ("results", "records", "items", "chunks"):
        value = output.get(key)
        if isinstance(value, list):
            return len(value)
    return None


def _result_summary(output: dict[str, Any], *, error: str | None = None) -> str:
    if error:
        return error
    for key in ("summary", "message", "status"):
        value = output.get(key)
        if value:
            return str(value)
    count = _result_count(output)
    return f"Result count: {count}" if count is not None else "Tool completed"
