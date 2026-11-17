"""Helpers for the authenticated principal dict carried through services."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status


def current_tenant_id(user: dict) -> int:
    """Return the active tenant id carried by the auth token.

    Tokens must carry tenant context; request handlers no longer infer demo
    tenant 1 on behalf of the caller.
    """
    tenant_id = user.get("tenant_id")
    if isinstance(tenant_id, int) and tenant_id > 0:
        return tenant_id
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Tenant context required")


def current_user_id(user: dict) -> Optional[int]:
    uid = user.get("uid")
    return int(uid) if isinstance(uid, int) and uid > 0 else None


def ensure_admin(user: dict) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privilege required")
    return user
