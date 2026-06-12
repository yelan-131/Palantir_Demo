"""FastAPI dependencies: auth, DB session injection."""
from __future__ import annotations

from typing import AsyncIterator, Optional

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session
from app.core.logging import get_logger
from app.core.security import decode_access_token

logger = get_logger(__name__)

DEMO_AUTH_OPTIONAL = False


async def get_db() -> AsyncIterator[AsyncSession]:
    async with db_session() as session:
        yield session


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    access_token: Optional[str] = Cookie(default=None),
) -> dict:
    """Resolve the current user from Authorization: Bearer <token>.

    Behavior: Authorization header is preferred over the auth cookie; missing
    or invalid credentials always raise 401.
    """
    raw = _extract_bearer(authorization) or access_token

    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    payload = decode_access_token(raw)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    sid = payload.get("sid")
    if sid:
        from app.services.iam import is_session_active

        if not await is_session_active(str(sid)):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired or revoked")

    return payload


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privilege required")
    return user


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
