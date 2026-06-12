"""In-memory AI audit log used by the demo runtime."""

from __future__ import annotations

import uuid
from collections import deque
from datetime import datetime
from typing import Any


# Bounded ring buffer: long-running processes must not grow audit memory
# without limit. Durable audit belongs in the database-backed audit path.
AI_AUDIT_LOG_LIMIT = 2000
AI_AUDIT_LOGS: deque[dict[str, Any]] = deque(maxlen=AI_AUDIT_LOG_LIMIT)


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
    bounded = max(1, min(limit, 500))
    return list(AI_AUDIT_LOGS)[-bounded:]
