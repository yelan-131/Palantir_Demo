"""Pluggable confirmation token storage.

Provides a protocol with two implementations:
- InMemoryConfirmationStore: the current behavior (dict-based)
- DatabaseConfirmationStore: persists to the ai_confirmation_tokens table

The store is selected via the `persistConfirmations` safety policy flag.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ConfirmationStore(Protocol):
    """Protocol for confirmation token storage backends."""

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]: ...
    async def verify(self, token: str, user_key: str | None = None) -> dict[str, Any]: ...
    async def consume(self, token: str, user_key: str | None = None) -> dict[str, Any]: ...


class InMemoryConfirmationStore:
    """In-memory confirmation store — the current default behavior."""

    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        token = payload.get("token") or f"confirm-{uuid.uuid4().hex[:12]}"
        payload["token"] = token
        payload.setdefault("status", "pending")
        payload.setdefault("created_at", time.time())
        ttl = payload.pop("ttl", 1800)  # 30 min default
        payload["expires_at"] = time.time() + ttl
        self._store[token] = payload
        return payload

    async def verify(self, token: str, user_key: str | None = None) -> dict[str, Any]:
        entry = self._store.get(token)
        if entry is None:
            return {"valid": False, "reason": "Token not found"}
        if entry.get("status") != "pending":
            return {"valid": False, "reason": f"Token is {entry.get('status')}"}
        if time.time() > entry.get("expires_at", 0):
            return {"valid": False, "reason": "Token expired"}
        if user_key and entry.get("user_key") and entry["user_key"] != user_key:
            return {"valid": False, "reason": "User mismatch"}
        return {"valid": True, "payload": entry}

    async def consume(self, token: str, user_key: str | None = None) -> dict[str, Any]:
        verification = await self.verify(token, user_key)
        if not verification.get("valid"):
            return verification
        entry = self._store[token]
        entry["status"] = "confirmed"
        entry["confirmed_at"] = time.time()
        return {"valid": True, "payload": entry}


class DatabaseConfirmationStore:
    """Database-backed confirmation store — persists across restarts."""

    async def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        token = payload.get("token") or f"confirm-{uuid.uuid4().hex[:12]}"
        payload["token"] = token
        payload.setdefault("status", "pending")

        from datetime import datetime, timezone

        from sqlalchemy import text

        from app.core.db import db_session

        ttl = payload.pop("ttl", 1800)
        import time as _time

        expires_at = datetime.fromtimestamp(_time.time() + ttl, tz=timezone.utc)

        async with db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO ai_confirmation_tokens
                        (token, status, user_key, risk_level, actions_json, expires_at)
                    VALUES
                        (:token, 'pending', :user_key, :risk_level, :actions_json, :expires_at)
                """
                ),
                {
                    "token": token,
                    "user_key": payload.get("user_key", ""),
                    "risk_level": payload.get("risk_level", "low"),
                    "actions_json": __import__("json").dumps(
                        payload.get("actions", []), ensure_ascii=False
                    ),
                    "expires_at": expires_at,
                },
            )

        payload["expires_at"] = _time.time() + ttl
        return payload

    async def verify(self, token: str, user_key: str | None = None) -> dict[str, Any]:
        import json
        import time

        from datetime import datetime, timezone

        from sqlalchemy import text

        from app.core.db import db_session

        async with db_session() as session:
            row = (
                (
                    await session.execute(
                        text(
                            "SELECT token, status, user_key, actions_json, expires_at "
                            "FROM ai_confirmation_tokens WHERE token = :token"
                        ),
                        {"token": token},
                    )
                )
                .mappings()
                .first()
            )

        if row is None:
            return {"valid": False, "reason": "Token not found"}
        if row["status"] != "pending":
            return {"valid": False, "reason": f"Token is {row['status']}"}
        expires = row["expires_at"]
        if expires and datetime.now(timezone.utc) > expires:
            return {"valid": False, "reason": "Token expired"}
        if user_key and row["user_key"] and row["user_key"] != user_key:
            return {"valid": False, "reason": "User mismatch"}

        return {
            "valid": True,
            "payload": {
                "token": token,
                "status": row["status"],
                "user_key": row["user_key"],
                "actions": json.loads(row["actions_json"]) if row["actions_json"] else [],
                "risk_level": row.get("risk_level", "low"),
            },
        }

    async def consume(self, token: str, user_key: str | None = None) -> dict[str, Any]:
        verification = await self.verify(token, user_key)
        if not verification.get("valid"):
            return verification

        from datetime import datetime, timezone

        from sqlalchemy import text

        from app.core.db import db_session

        async with db_session() as session:
            # Atomic single-use guard: the WHERE status='pending' clause makes
            # concurrent consumers race on the row update instead of both
            # passing the earlier verify() read.
            result = await session.execute(
                text(
                    "UPDATE ai_confirmation_tokens "
                    "SET status = 'confirmed', confirmed_at = :now "
                    "WHERE token = :token AND status = 'pending'"
                ),
                {"now": datetime.now(timezone.utc), "token": token},
            )
            if getattr(result, "rowcount", 0) == 0:
                return {"valid": False, "reason": "Token has already been used"}

        verification["payload"]["status"] = "confirmed"
        return verification
