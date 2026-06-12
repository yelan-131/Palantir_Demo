"""Tenant onboarding, tenant resolution, quotas, and email helpers."""
from __future__ import annotations

import hashlib
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

DEFAULT_TENANT_CONFIG = {"brandName": "ManuFoundry", "defaultLanguage": "zh-CN"}
DEFAULT_TENANT_LIMITS = {"users": 50, "applications": 20, "dynamicRecords": 100000}


def normalize_domain(domain: str) -> str:
    value = (domain or "").strip().lower()
    if value.startswith("@"):
        value = value[1:]
    if not value or "." not in value:
        raise HTTPException(422, "Invalid tenant email domain")
    return value


def email_domain(email: str) -> str:
    value = (email or "").strip().lower()
    if "@" not in value:
        raise HTTPException(400, "Email login is required for tenant resolution")
    return normalize_domain(value.rsplit("@", 1)[1])


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _url(path: str, token: str) -> str:
    base = settings.APP_PUBLIC_URL.rstrip("/")
    return f"{base}{path}?token={token}"


def invite_url(token: str) -> str:
    return _url("/invite/accept", token)


def password_reset_url(token: str) -> str:
    return _url("/password-reset", token)


def _send_email(to_email: str, subject: str, body: str) -> bool:
    if not settings.SMTP_HOST:
        logger.info("Email delivery disabled; would send to %s: %s\n%s", to_email, subject, body)
        return False
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            if settings.SMTP_TLS:
                smtp.starttls()
            if settings.SMTP_USER:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except OSError as exc:
        logger.warning("Email delivery failed for %s via %s:%s: %s", to_email, settings.SMTP_HOST, settings.SMTP_PORT, exc)
        return False


async def resolve_tenant_by_email(db, login: str):
    from app.models.relational import Tenant, TenantDomain

    domain = email_domain(login)
    rows = (await db.execute(
        select(Tenant, TenantDomain)
        .join(TenantDomain, TenantDomain.tenant_id == Tenant.id)
        .where(TenantDomain.domain == domain, TenantDomain.status == "active")
    )).all()
    active = [(tenant, mapping) for tenant, mapping in rows if tenant.status == "active"]
    if not active:
        suspended = [tenant for tenant, _mapping in rows if tenant.status != "active"]
        if suspended:
            raise HTTPException(403, "Tenant is not active")
        raise HTTPException(404, "Tenant domain is not registered")
    if len(active) > 1:
        raise HTTPException(409, "Tenant domain is ambiguous")
    return active[0][0]


async def ensure_tenant_active(db, tenant_id: int):
    from app.models.relational import Tenant

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if tenant.status != "active":
        raise HTTPException(403, "Tenant is not active")
    return tenant


async def assert_tenant_quota(db, tenant_id: int, quota_key: str, *, extra_count: int = 0) -> None:
    """Enforce a tenant resource quota.

    ``extra_count`` lets callers add usage that lives outside the counted ORM
    model — e.g. physical-table form records, which share the
    ``dynamicRecords`` quota but are stored in per-form tables.
    """
    from app.models.relational import Application, DynamicRecord, Tenant, User

    tenant = await ensure_tenant_active(db, tenant_id)
    limits = {**DEFAULT_TENANT_LIMITS, **(tenant.limits or {})}
    limit = limits.get(quota_key)
    if not isinstance(limit, int) or limit <= 0:
        return
    model_by_key: dict[str, Any] = {
        "users": User,
        "applications": Application,
        "dynamicRecords": DynamicRecord,
    }
    model = model_by_key.get(quota_key)
    if model is None:
        return
    count = await db.scalar(select(func.count(model.id)).where(model.tenant_id == tenant_id))
    if (count or 0) + max(0, int(extra_count)) >= limit:
        raise HTTPException(403, f"Tenant quota exceeded: {quota_key}")


async def create_invite(db, *, tenant_id: int, email: str, role: str, invited_by: int | None = None) -> dict[str, Any]:
    from app.models.relational import TenantInvite

    token = secrets.token_urlsafe(32)
    invite = TenantInvite(
        tenant_id=tenant_id,
        email=email.strip().lower(),
        role=role,
        token_hash=hash_token(token),
        expires_at=datetime.utcnow() + timedelta(days=7),
        invited_by=invited_by,
    )
    db.add(invite)
    await db.flush()
    link = invite_url(token)
    delivered = _send_email(
        invite.email,
        "You are invited to ManuFoundry",
        f"Use this link to activate your account:\n\n{link}\n\nThis invite expires in 7 days.",
    )
    return {"id": invite.id, "email": invite.email, "role": invite.role, "inviteUrl": link, "emailDelivered": delivered}


async def create_password_reset(db, *, tenant_id: int, user_id: int, email: str) -> dict[str, Any]:
    from app.models.relational import PasswordResetToken

    token = secrets.token_urlsafe(32)
    row = PasswordResetToken(
        tenant_id=tenant_id,
        user_id=user_id,
        token_hash=hash_token(token),
        expires_at=datetime.utcnow() + timedelta(hours=2),
    )
    db.add(row)
    await db.flush()
    link = password_reset_url(token)
    delivered = _send_email(
        email,
        "Reset your ManuFoundry password",
        f"Use this link to reset your password:\n\n{link}\n\nThis link expires in 2 hours.",
    )
    return {"resetUrl": link, "emailDelivered": delivered}
