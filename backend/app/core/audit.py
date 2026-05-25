"""Audit logging helper — best-effort write of change events."""

from __future__ import annotations

import json
from typing import Any, Optional

from app.core.logging import get_logger

logger = get_logger(__name__)


async def write_audit_log(
    *,
    action: str,
    resource_type: str,
    resource_id: Optional[int] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    user_id: Optional[int] = None,
    tenant_id: Optional[int] = None,
) -> None:
    try:
        from app.core.db import db_session
        from app.models.relational import AuditLog

        async with db_session() as session:
            entry = AuditLog(
                tenant_id=tenant_id,
                user_id=user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                old_values=json.dumps(old_values, ensure_ascii=False, default=str) if old_values else None,
                new_values=json.dumps(new_values, ensure_ascii=False, default=str) if new_values else None,
            )
            session.add(entry)
            await session.commit()
    except Exception as exc:
        logger.warning("Audit log write failed: %s", exc)
