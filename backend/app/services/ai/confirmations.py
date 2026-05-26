"""Confirmation token helpers for AI side-effect actions."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any


CONFIRMATIONS: dict[str, dict[str, Any]] = {}


def _user_key(user: dict[str, Any] | None) -> str:
    if not user:
        return "system"
    return str(user.get("sub") or user.get("username") or user.get("uid") or "unknown")


def create_confirmation_payload(
    *,
    user: dict[str, Any] | None,
    actions: list[dict[str, Any]],
    evidence: list[dict[str, Any]] | None = None,
    risk_level: str = "medium",
    ttl_minutes: int = 30,
) -> dict[str, Any]:
    token = f"confirm-{uuid.uuid4().hex[:24]}"
    expires_at = datetime.now() + timedelta(minutes=ttl_minutes)
    payload = {
        "confirmation_token": token,
        "expires_at": expires_at.isoformat(),
        "user": _user_key(user),
        "risk_level": risk_level,
        "actions": actions,
        "evidence": evidence or [],
    }
    CONFIRMATIONS[token] = {
        **payload,
        "status": "pending",
        "created_at": datetime.now().isoformat(),
    }
    return payload


def verify_confirmation_token(token: str, *, user: dict[str, Any] | None = None) -> dict[str, Any]:
    record = CONFIRMATIONS.get(token)
    if not record:
        raise ValueError("Confirmation token is invalid")
    if record["status"] != "pending":
        raise ValueError("Confirmation token has already been used")
    if datetime.fromisoformat(record["expires_at"]) < datetime.now():
        record["status"] = "expired"
        raise ValueError("Confirmation token has expired")
    if user and record["user"] != _user_key(user):
        raise ValueError("Confirmation token does not belong to the current user")
    return record


def consume_confirmation_token(token: str, *, user: dict[str, Any] | None = None) -> dict[str, Any]:
    record = verify_confirmation_token(token, user=user)
    record["status"] = "confirmed"
    record["confirmed_at"] = datetime.now().isoformat()
    return record
