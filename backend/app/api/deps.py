"""FastAPI dependencies: auth, DB session injection."""
from __future__ import annotations

from typing import AsyncIterator, Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session
from app.core.logging import get_logger
from app.core.principal import current_tenant_id, current_user_id, ensure_admin  # noqa: F401
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

    # Signed identity is not proof that the account is still enabled. Check
    # legacy bearer tokens too, including tokens without a session id.
    from app.models.relational import User, Tenant
    async with db_session() as db:
        account = await db.get(User, payload.get("uid")) if type(payload.get("uid")) is int else None
        if not account or not account.is_active or account.tenant_id != payload.get("tenant_id"):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled or unavailable")
        tenant = await db.get(Tenant, account.tenant_id)
        if not tenant or tenant.status != 'active':
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant disabled or unavailable")
        payload = {**payload, "is_admin": bool(account.is_admin), "sub": account.username}

    sid = payload.get("sid")
    if sid:
        from app.services.iam import is_session_active

        if not await is_session_active(str(sid), user_id=payload.get("uid"), tenant_id=payload.get("tenant_id")):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired or revoked")

    return payload


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    return ensure_admin(user)


def require_platform_admin(user: dict = Depends(require_admin)) -> dict:
    if current_tenant_id(user) != 1:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admin privilege required")
    return user


async def require_platform_admin_for_writes(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """Reads need a signed-in user; writes to platform-wide metadata need a platform admin."""
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        require_platform_admin(await require_admin(user))
    return user


def require_permission(resource_type: str, resource_key: str, action: str):
    async def checker(
        user: dict = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict:
        from app.core.permissions import has_permission

        if not await has_permission(user, resource_type, resource_key, action, db):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permission denied")
        return user

    return checker


def require_form_permission(action: str):
    async def checker(
        form_id: int,
        user: dict = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict:
        from app.core.permissions import has_form_permission

        if not await has_form_permission(user, form_id, action, db):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Form permission denied")
        return user

    return checker
