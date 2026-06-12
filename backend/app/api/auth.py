"""Auth API: local login, OIDC login, MFA, password changes, and sessions."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db
from app.config import settings
from app.core.audit import write_audit_log
from app.core.logging import get_logger
from app.core.security import create_access_token, hash_password, verify_password
from app.core.production_errors import database_unavailable
from app.services.iam import (
    add_password_history,
    build_oidc_login_url,
    claim_value,
    create_user_session,
    ensure_password_not_reused,
    exchange_oidc_code,
    generate_totp_secret,
    get_iam_security_settings,
    get_oidc_config,
    load_iam_settings,
    revoke_session,
    validate_password_policy,
    verify_totp,
)
from app.services.tenant_onboarding import (
    create_password_reset,
    hash_token,
    resolve_tenant_by_email,
)

logger = get_logger(__name__)
router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str
    tenant_id: Optional[int] = None
    mfa_code: Optional[str] = None


class InviteAcceptRequest(BaseModel):
    token: str
    password: str
    display_name: Optional[str] = None


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirmRequest(BaseModel):
    token: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class MfaVerifyRequest(BaseModel):
    code: str


class OidcLoginRequest(BaseModel):
    redirect_uri: Optional[str] = None
    tenant_id: Optional[int] = None
    tenant_slug: Optional[str] = None
    login_hint: Optional[str] = None


class OidcCallbackRequest(BaseModel):
    code: str
    state: str
    redirect_uri: Optional[str] = None



def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=settings.IS_PRODUCTION,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def _build_token_and_user(
    uid: int,
    username: str,
    is_admin: bool,
    user_payload: dict,
    *,
    tenant_id: int,
    session_id: Optional[str] = None,
) -> dict:
    extra = {"uid": uid, "is_admin": is_admin, "tenant_id": tenant_id}
    if session_id:
        extra["sid"] = session_id
    token = create_access_token(subject=username, extra=extra)
    user = {**user_payload, "tenant_id": tenant_id}
    return {
        "token": token,
        "user": user,
        "requires_mfa": False,
        "requires_password_change": bool(user.get("force_password_change")),
    }


async def _roles_for_user(db: AsyncSession, user_id: int, tenant_id: int) -> list[dict]:
    from app.models.relational import Role, UserRole

    rows = await db.execute(
        select(Role.id, Role.name, Role.label)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id, UserRole.tenant_id == tenant_id, Role.tenant_id == tenant_id)
    )
    return [{"id": r[0], "name": r[1], "label": r[2]} for r in rows.fetchall()]


def _user_payload(user, roles: list[dict]) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "is_admin": user.is_admin,
        "roles": roles,
        "is_active": user.is_active,
        "mfa_enabled": getattr(user, "mfa_enabled", False),
        "force_password_change": getattr(user, "force_password_change", False),
        "sso_provider": getattr(user, "sso_provider", None),
    }


async def _ensure_active_tenant(db: AsyncSession, tenant_id: int):
    if not isinstance(tenant_id, int) or tenant_id <= 0:
        raise HTTPException(422, "Invalid tenant_id")

    from app.models.relational import Tenant

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if tenant.status != "active":
        raise HTTPException(403, "Tenant is not active")
    return tenant


async def _resolve_oidc_login_tenant(db: AsyncSession, body: OidcLoginRequest):
    if body.tenant_id is not None:
        return await _ensure_active_tenant(db, body.tenant_id)

    if body.tenant_slug:
        from app.models.relational import Tenant

        slug = body.tenant_slug.strip().lower()
        tenant = await db.scalar(select(Tenant).where(Tenant.slug == slug))
        if not tenant:
            raise HTTPException(404, "Tenant not found")
        if tenant.status != "active":
            raise HTTPException(403, "Tenant is not active")
        return tenant

    if body.login_hint:
        return await resolve_tenant_by_email(db, body.login_hint)

    raise HTTPException(400, "Tenant identity required for OIDC login")


async def _db_login(db: AsyncSession, body: LoginRequest, request: Request) -> Optional[dict]:
    try:
        from app.models.relational import User
    except Exception as exc:
        logger.debug("Auth DB models unavailable: %s", exc)
        return None

    await load_iam_settings(db)
    login_policy = get_iam_security_settings()["login"]

    try:
        login_name = body.username.strip().lower()
        username = body.username.strip()
        tenant_id: int | None = None
        if body.tenant_id is not None:
            tenant = await _ensure_active_tenant(db, body.tenant_id)
            tenant_id = tenant.id
            user = await db.scalar(
                select(User).where(
                    User.tenant_id == tenant_id,
                    (User.email == login_name) | (User.username == username),
                )
            )
        elif "@" in login_name:
            tenant = await resolve_tenant_by_email(db, login_name)
            tenant_id = tenant.id
            user = await db.scalar(
                select(User).where(User.tenant_id == tenant_id, (User.email == login_name) | (User.username == login_name))
            )
        else:
            users = (await db.execute(select(User).where(User.username == username).limit(2))).scalars().all()
            if len(users) > 1:
                raise HTTPException(400, "Username login is ambiguous; use email address or tenant_id")
            user = users[0] if users else None
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        raise database_unavailable("Authentication database unavailable") from exc

    if not user:
        return None
    tenant_id = tenant_id or getattr(user, "tenant_id", None)
    if not isinstance(tenant_id, int) or tenant_id <= 0:
        raise HTTPException(403, "Tenant context required")
    await _ensure_active_tenant(db, tenant_id)
    if not user.is_active:
        raise HTTPException(401, "Invalid credentials")
    if getattr(user, "locked_until", None) and user.locked_until > datetime.utcnow():
        raise HTTPException(423, "Account is locked")
    if not verify_password(body.password, user.hashed_password):
        user.login_failed_count = (getattr(user, "login_failed_count", 0) or 0) + 1
        if user.login_failed_count >= int(login_policy.get("lock_threshold") or settings.LOGIN_LOCK_THRESHOLD):
            user.locked_until = datetime.utcnow() + timedelta(minutes=int(login_policy.get("lock_minutes") or settings.LOGIN_LOCK_MINUTES))
        await db.commit()
        await write_audit_log(
            action="login_failed",
            resource_type="auth",
            user_id=user.id,
            tenant_id=tenant_id,
            new_values={"username": body.username, "reason": "invalid_credentials"},
        )
        raise HTTPException(401, "Invalid credentials")
    if getattr(user, "mfa_enabled", False):
        if not body.mfa_code:
            return {"requires_mfa": True, "mfa_required": True, "user": {"username": user.username}}
        if not verify_totp(user.mfa_secret or "", body.mfa_code):
            raise HTTPException(401, "Invalid MFA code")

    roles = await _roles_for_user(db, user.id, tenant_id)
    sid = await create_user_session(
        db,
        user_id=user.id,
        tenant_id=tenant_id,
        login_method="local",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    user.login_failed_count = 0
    user.locked_until = None
    user.last_login_at = datetime.utcnow()
    user.last_login_ip = request.client.host if request.client else None
    await db.commit()
    return _build_token_and_user(
        user.id,
        user.username,
        user.is_admin,
        _user_payload(user, roles),
        tenant_id=tenant_id,
        session_id=sid,
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    db_result = await _db_login(db, body, request)
    if db_result is not None:
        if not db_result.get("requires_mfa"):
            _set_auth_cookie(response, db_result["token"])
            await write_audit_log(
                action="login_success",
                resource_type="auth",
                user_id=db_result["user"].get("id"),
                tenant_id=db_result["user"].get("tenant_id"),
                new_values={"username": body.username, "source": "database"},
            )
        return db_result
    await write_audit_log(
        action="login_failed",
        resource_type="auth",
        new_values={"username": body.username, "reason": "invalid_credentials"},
    )
    raise HTTPException(401, "Invalid credentials")


@router.post("/logout")
async def logout(
    response: Response,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    response.delete_cookie("access_token", path="/")
    if user.get("sid"):
        await revoke_session(db, str(user.get("sid")), current_user_id(user))
        await db.commit()
    await write_audit_log(
        action="logout",
        resource_type="auth",
        user_id=current_user_id(user),
        tenant_id=current_tenant_id(user),
        new_values={"username": user.get("sub")},
    )
    return {"ok": True}


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    username = user.get("sub")
    try:
        from app.models.relational import Tenant, User, UserOrgMembership

        tenant_id = current_tenant_id(user)
        tenant = await db.get(Tenant, tenant_id)
        row = await db.scalar(select(User).where(User.username == username, User.tenant_id == tenant_id))
        if row:
            roles = await _roles_for_user(db, row.id, tenant_id)
            org_rows = await db.execute(
                select(UserOrgMembership.org_unit_id).where(
                    UserOrgMembership.user_id == row.id,
                    UserOrgMembership.tenant_id == tenant_id,
                )
            )
            payload = _user_payload(row, roles)
            payload["tenant_id"] = tenant_id
            payload["tenant_name"] = tenant.name if tenant else ""
            payload["tenant_status"] = tenant.status if tenant else "unknown"
            payload["org_unit_ids"] = [int(item[0]) for item in org_rows.fetchall()]
            return payload
    except Exception as exc:
        raise database_unavailable("Authentication database unavailable") from exc

    raise HTTPException(401, "User not found")


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import User

    tenant_id = current_tenant_id(user)
    row = await db.get(User, current_user_id(user))
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(404, "User not found")
    if not verify_password(body.old_password, row.hashed_password):
        raise HTTPException(401, "Old password is incorrect")
    validate_password_policy(body.new_password)
    await ensure_password_not_reused(db, row.id, body.new_password, tenant_id)
    row.hashed_password = hash_password(body.new_password)
    row.force_password_change = False
    await add_password_history(db, row.id, tenant_id, row.hashed_password)
    await db.commit()
    await write_audit_log(action="change_password", resource_type="auth", resource_id=row.id, user_id=row.id, tenant_id=tenant_id)
    return {"ok": True}


@router.post("/invite/accept")
async def accept_invite(
    body: InviteAcceptRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import Role, Tenant, TenantInvite, User, UserRole

    invite = await db.scalar(select(TenantInvite).where(TenantInvite.token_hash == hash_token(body.token)))
    if (
        not invite
        or invite.accepted_at is not None
        or getattr(invite, "revoked_at", None) is not None
        or getattr(invite, "replaced_by_invite_id", None) is not None
        or invite.expires_at < datetime.utcnow()
    ):
        raise HTTPException(400, "Invalid or expired invite")
    tenant = await db.get(Tenant, invite.tenant_id)
    if not tenant or tenant.status != "active":
        raise HTTPException(403, "Tenant is not active")
    validate_password_policy(body.password)
    email = invite.email.strip().lower()
    user = await db.scalar(select(User).where(User.tenant_id == invite.tenant_id, User.email == email))
    if not user:
        user = User(
            tenant_id=invite.tenant_id,
            username=email,
            email=email,
            display_name=body.display_name or email,
            hashed_password=hash_password(body.password),
            is_active=True,
            is_admin=invite.role == "admin",
        )
        db.add(user)
        await db.flush()
    else:
        user.hashed_password = hash_password(body.password)
        user.display_name = body.display_name or user.display_name or email
        user.is_active = True
        user.force_password_change = False
        if invite.role == "admin":
            user.is_admin = True
    role_name = "admin" if invite.role == "admin" else "member"
    role = await db.scalar(select(Role).where(Role.tenant_id == invite.tenant_id, Role.name == role_name))
    if role:
        existing_role = await db.scalar(select(UserRole.id).where(UserRole.tenant_id == invite.tenant_id, UserRole.user_id == user.id, UserRole.role_id == role.id))
        if not existing_role:
            db.add(UserRole(tenant_id=invite.tenant_id, user_id=user.id, role_id=role.id))
    invite.accepted_at = datetime.utcnow()
    invite.user_id = user.id
    await add_password_history(db, user.id, invite.tenant_id, user.hashed_password)
    sid = await create_user_session(
        db,
        user_id=user.id,
        tenant_id=invite.tenant_id,
        login_method="invite",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    roles = await _roles_for_user(db, user.id, invite.tenant_id)
    payload = _build_token_and_user(user.id, user.username, user.is_admin, _user_payload(user, roles), tenant_id=invite.tenant_id, session_id=sid)
    _set_auth_cookie(response, payload["token"])
    await write_audit_log(
        action="accept_invite",
        resource_type="tenant_invite",
        resource_id=invite.id,
        user_id=user.id,
        tenant_id=invite.tenant_id,
        new_values={"email": email},
    )
    return payload


@router.post("/password-reset/request")
async def request_password_reset(body: PasswordResetRequest, db: AsyncSession = Depends(get_db)):
    from app.models.relational import User

    tenant = await resolve_tenant_by_email(db, body.email)
    email = body.email.strip().lower()
    user = await db.scalar(select(User).where(User.tenant_id == tenant.id, User.email == email))
    if not user or not user.is_active:
        await write_audit_log(action="password_reset_requested", resource_type="auth", tenant_id=tenant.id, new_values={"email": email, "found": False})
        await db.commit()
        return {"ok": True}
    payload = await create_password_reset(db, tenant_id=tenant.id, user_id=user.id, email=email)
    await db.commit()
    await write_audit_log(action="password_reset_requested", resource_type="auth", user_id=user.id, tenant_id=tenant.id, new_values={"email": email})
    return {"ok": True, "data": payload if not settings.IS_PRODUCTION else {"emailDelivered": payload["emailDelivered"]}}


@router.post("/password-reset/confirm")
async def confirm_password_reset(body: PasswordResetConfirmRequest, db: AsyncSession = Depends(get_db)):
    from app.models.relational import PasswordResetToken, User

    row = await db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(body.token)))
    if not row or row.used_at is not None or row.expires_at < datetime.utcnow():
        raise HTTPException(400, "Invalid or expired password reset token")
    user = await db.get(User, row.user_id)
    if not user or user.tenant_id != row.tenant_id or not user.is_active:
        raise HTTPException(400, "Invalid password reset token")
    validate_password_policy(body.new_password)
    await ensure_password_not_reused(db, user.id, body.new_password, row.tenant_id)
    user.hashed_password = hash_password(body.new_password)
    user.force_password_change = False
    row.used_at = datetime.utcnow()
    await add_password_history(db, user.id, row.tenant_id, user.hashed_password)
    await db.commit()
    await write_audit_log(action="password_reset_confirmed", resource_type="auth", user_id=user.id, tenant_id=row.tenant_id)
    return {"ok": True}


@router.post("/mfa/setup")
async def setup_mfa(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.relational import User

    row = await db.get(User, current_user_id(user))
    if not row:
        raise HTTPException(404, "User not found")
    if not row.mfa_secret:
        row.mfa_secret = generate_totp_secret()
    await db.commit()
    return {"secret": row.mfa_secret, "enabled": row.mfa_enabled}


@router.post("/mfa/enable")
async def enable_mfa(body: MfaVerifyRequest, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.relational import User

    row = await db.get(User, current_user_id(user))
    if not row or not row.mfa_secret:
        raise HTTPException(404, "MFA setup not found")
    if not verify_totp(row.mfa_secret, body.code):
        raise HTTPException(401, "Invalid MFA code")
    row.mfa_enabled = True
    await db.commit()
    return {"ok": True}


@router.post("/mfa/disable")
async def disable_mfa(body: MfaVerifyRequest, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.relational import User

    row = await db.get(User, current_user_id(user))
    if not row:
        raise HTTPException(404, "User not found")
    if row.mfa_enabled and not verify_totp(row.mfa_secret or "", body.code):
        raise HTTPException(401, "Invalid MFA code")
    row.mfa_enabled = False
    row.mfa_secret = None
    await db.commit()
    return {"ok": True}


@router.get("/oidc/config")
async def oidc_config(db: AsyncSession = Depends(get_db)):
    await load_iam_settings(db)
    config = get_oidc_config()
    return {
        "enabled": config["enabled"],
        "issuer": config["issuer"],
        "client_id": config["client_id"],
        "scopes": config["scopes"],
        "require_platform_mfa": config["require_platform_mfa"],
    }


@router.post("/oidc/login-url")
async def oidc_login_url(body: OidcLoginRequest, db: AsyncSession = Depends(get_db)):
    tenant = await _resolve_oidc_login_tenant(db, body)
    payload = await build_oidc_login_url(db, tenant_id=tenant.id, redirect_uri=body.redirect_uri)
    await db.commit()
    return payload


@router.post("/oidc/callback")
async def oidc_callback(
    body: OidcCallbackRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import OidcState, Role, User, UserRole

    await load_iam_settings(db)
    state = await db.scalar(select(OidcState).where(OidcState.state == body.state))
    if not state or state.consumed_at is not None or state.expires_at < datetime.utcnow():
        raise HTTPException(400, "Invalid OIDC state")
    state.consumed_at = datetime.utcnow()
    claims = await exchange_oidc_code(body.code, body.redirect_uri or state.redirect_uri)
    config = get_oidc_config()
    subject = claim_value(claims, config["subject_claim"])
    if not subject:
        raise HTTPException(400, "OIDC subject missing")
    tenant_id = state.tenant_id
    if not isinstance(tenant_id, int) or tenant_id <= 0:
        raise HTTPException(400, "OIDC state is missing tenant context")
    user = await db.scalar(select(User).where(User.tenant_id == tenant_id, User.sso_subject == subject))
    username = claim_value(claims, config["username_claim"], subject)
    email = claim_value(claims, config["email_claim"])
    if not user and email:
        user = await db.scalar(select(User).where(User.tenant_id == tenant_id, User.email == email))
    if not user:
        user = User(
            tenant_id=tenant_id,
            username=username,
            display_name=claim_value(claims, config["display_name_claim"], username),
            email=email,
            hashed_password=hash_password(secrets.token_urlsafe(24)),
            is_active=True,
            is_admin=False,
            sso_provider=config["issuer"] or "oidc",
            sso_subject=subject,
        )
        db.add(user)
        await db.flush()
        viewer_role = await db.scalar(select(Role).where(Role.tenant_id == tenant_id, Role.name == "viewer"))
        if viewer_role:
            db.add(UserRole(tenant_id=tenant_id, user_id=user.id, role_id=viewer_role.id))
    else:
        user.sso_provider = config["issuer"] or "oidc"
        user.sso_subject = subject
        user.email = email or user.email
        user.display_name = claim_value(claims, config["display_name_claim"], user.display_name or username)
    if not user.is_active:
        raise HTTPException(401, "User disabled")

    roles = await _roles_for_user(db, user.id, tenant_id)
    sid = await create_user_session(
        db,
        user_id=user.id,
        tenant_id=tenant_id,
        login_method="oidc",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    user.last_login_at = datetime.utcnow()
    user.last_login_ip = request.client.host if request.client else None
    await db.commit()
    payload = _build_token_and_user(user.id, user.username, user.is_admin, _user_payload(user, roles), tenant_id=tenant_id, session_id=sid)
    _set_auth_cookie(response, payload["token"])
    await write_audit_log(
        action="login_success",
        resource_type="auth",
        user_id=user.id,
        tenant_id=tenant_id,
        new_values={"username": user.username, "source": "oidc"},
    )
    return payload
