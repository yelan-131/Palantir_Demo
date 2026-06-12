"""Confirmation token helpers for AI side-effect actions."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from .confirmation_store import ConfirmationStore


CONFIRMATIONS: dict[str, dict[str, Any]] = {}


def _user_key(user: dict[str, Any] | None) -> str:
    if not user:
        return "system"
    return str(user.get("sub") or user.get("username") or user.get("uid") or "unknown")


def _prune_stale_confirmations(max_entries: int = 2000) -> None:
    """Keep the legacy in-memory dict bounded: drop expired/used tokens first."""
    if len(CONFIRMATIONS) < max_entries:
        return
    now = datetime.now()
    for token, record in list(CONFIRMATIONS.items()):
        if record.get("status") != "pending":
            CONFIRMATIONS.pop(token, None)
            continue
        try:
            if datetime.fromisoformat(str(record.get("expires_at"))) < now:
                CONFIRMATIONS.pop(token, None)
        except (TypeError, ValueError):
            CONFIRMATIONS.pop(token, None)
    # Still over the cap (all pending and unexpired): drop oldest entries.
    while len(CONFIRMATIONS) >= max_entries:
        CONFIRMATIONS.pop(next(iter(CONFIRMATIONS)), None)


# ---------------------------------------------------------------------------
# Store singleton -- selected via persistConfirmations safety policy flag
# ---------------------------------------------------------------------------

_store: ConfirmationStore | None = None


def _get_store() -> ConfirmationStore:
    global _store
    if _store is not None:
        return _store
    from .settings import safety_policy_snapshot, settings_snapshot

    settings = settings_snapshot()
    policy = safety_policy_snapshot(settings)
    if policy.get("persistConfirmations"):
        from .confirmation_store import DatabaseConfirmationStore

        _store = DatabaseConfirmationStore()
    else:
        from .confirmation_store import InMemoryConfirmationStore

        _store = InMemoryConfirmationStore()
    return _store


def reset_store() -> None:
    """Reset the store singleton -- used by tests and settings reloads."""
    global _store
    _store = None


# ---------------------------------------------------------------------------
# Public synchronous API (preserved for backward compatibility)
# ---------------------------------------------------------------------------


def create_confirmation_payload(
    *,
    user: dict[str, Any] | None,
    actions: list[dict[str, Any]],
    evidence: list[dict[str, Any]] | None = None,
    risk_level: str = "medium",
    ttl_minutes: int = 30,
) -> dict[str, Any]:
    _prune_stale_confirmations()
    token = f"confirm-{uuid.uuid4().hex[:24]}"
    expires_at = datetime.now() + timedelta(minutes=ttl_minutes)
    user_k = _user_key(user)
    payload = {
        "confirmation_token": token,
        "expires_at": expires_at.isoformat(),
        "user": user_k,
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


# ---------------------------------------------------------------------------
# Async API -- delegates to the pluggable store backend
# ---------------------------------------------------------------------------


async def async_create_confirmation_payload(
    *,
    user: dict[str, Any] | None,
    actions: list[dict[str, Any]],
    evidence: list[dict[str, Any]] | None = None,
    risk_level: str = "medium",
    ttl_minutes: int = 30,
) -> dict[str, Any]:
    """Async variant that delegates to the active ConfirmationStore."""
    _prune_stale_confirmations()
    store = _get_store()
    user_k = _user_key(user)
    payload: dict[str, Any] = {
        "user_key": user_k,
        "risk_level": risk_level,
        "actions": actions,
        "evidence": evidence or [],
        "ttl": ttl_minutes * 60,
    }
    result = await store.create(payload)
    token = result["token"]
    # Map internal field names to the public API contract
    public_payload = {
        "confirmation_token": token,
        "expires_at": result.get("expires_at", ""),
        "user": user_k,
        "risk_level": risk_level,
        "actions": actions,
        "evidence": evidence or [],
    }
    # Also populate the legacy CONFIRMATIONS dict so existing code can
    # still inspect it (e.g. test fixtures that clear it).
    CONFIRMATIONS[token] = {
        **public_payload,
        "status": "pending",
        "created_at": datetime.now().isoformat(),
    }
    return public_payload


async def async_verify_confirmation_token(
    token: str, *, user: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Async variant that delegates to the active ConfirmationStore."""
    store = _get_store()
    result = await store.verify(token, user_key=_user_key(user))
    if not result.get("valid"):
        raise ValueError(result.get("reason", "Confirmation token is invalid"))
    return result["payload"]


async def async_consume_confirmation_token(
    token: str, *, user: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Async variant that delegates to the active ConfirmationStore."""
    store = _get_store()
    result = await store.consume(token, user_key=_user_key(user))
    if not result.get("valid"):
        raise ValueError(result.get("reason", "Confirmation token is invalid"))
    # Sync the legacy dict so callers that inspect CONFIRMATIONS see the
    # updated status.
    if token in CONFIRMATIONS:
        CONFIRMATIONS[token]["status"] = "confirmed"
        CONFIRMATIONS[token]["confirmed_at"] = datetime.now().isoformat()
    return result["payload"]
