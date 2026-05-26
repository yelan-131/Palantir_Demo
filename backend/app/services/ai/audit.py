"""In-memory AI audit log used by the demo runtime."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any


AI_AUDIT_LOGS: list[dict[str, Any]] = []


def record_ai_event(user: dict[str, Any], event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    record = {
        "id": f"audit-{uuid.uuid4().hex[:12]}",
        "event_type": event_type,
        "user": user.get("sub") or user.get("username") or user.get("uid") or "unknown",
        "payload": payload,
        "created_at": datetime.now().isoformat(),
    }
    AI_AUDIT_LOGS.append(record)
    return record


def list_ai_audit_logs(limit: int = 100) -> list[dict[str, Any]]:
    return AI_AUDIT_LOGS[-max(1, min(limit, 500)):]
