"""Platform-level tenant administration APIs."""
from __future__ import annotations

import hashlib
import json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id, get_db, require_admin
from app.core.audit import write_audit_log
from app.core.security import hash_password
from app.services.tenant_onboarding import (
    DEFAULT_TENANT_CONFIG,
    DEFAULT_TENANT_LIMITS,
    create_invite,
    create_password_reset,
    normalize_domain,
)

def require_platform_admin(user: dict = Depends(require_admin)) -> dict:
    if current_tenant_id(user) != 1:
        raise HTTPException(403, "Platform admin privilege required")
    return user


router = APIRouter(dependencies=[Depends(require_platform_admin)])


class TenantCreate(BaseModel):
    name: str
    slug: str
    domains: list[str] = Field(default_factory=list)
    admin_email: Optional[str] = None
    config: dict = Field(default_factory=dict)
    limits: dict = Field(default_factory=dict)


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    domains: Optional[list[str]] = None
    config: Optional[dict] = None
    limits: Optional[dict] = None
    suspended_reason: Optional[str] = None


class TenantInviteRequest(BaseModel):
    email: str
    role: str = "member"


EXPORT_TABLES = [
    "tenants",
    "tenant_domains",
    "users",
    "roles",
    "user_roles",
    "role_permissions",
    "applications",
    "forms",
    "dynamic_records",
    "workflow_defs",
    "workflow_instances",
    "reports",
    "factories",
    "workshops",
    "production_lines",
    "equipment",
    "products",
    "materials",
    "suppliers",
    "warehouses",
    "inventory",
    "shipments",
    "inspections",
    "defects",
    "spc_points",
    "capa",
    "data_sources",
    "pipelines",
    "pipeline_runs",
    "knowledge_documents",
    "knowledge_chunks",
    "knowledge_ingestion_jobs",
    "knowledge_extraction_results",
    "knowledge_object_links",
    "ai_conversations",
    "ai_messages",
    "ai_agent_runs",
    "ai_tool_calls",
    "notifications",
    "rules",
    "scheduled_jobs",
]

SENSITIVE_KEYWORDS = ("password", "token", "secret", "credential", "smtp", "api_key", "apikey")


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _redact(value: Any, key_hint: str = "") -> Any:
    if any(keyword in key_hint.lower() for keyword in SENSITIVE_KEYWORDS):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {key: _redact(item, key) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item, key_hint) for item in value]
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return _redact(json.loads(stripped), key_hint)
            except Exception:
                return value
    return value


def _export_payload(row) -> dict[str, Any]:
    return {key: _redact(value, key) for key, value in dict(row).items()}


def _export_response(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "tenantId": row.tenant_id,
        "requestedBy": row.requested_by,
        "status": row.status,
        "format": row.format,
        "filePath": row.file_path,
        "checksum": row.checksum,
        "sizeBytes": row.size_bytes,
        "error": row.error,
        "createdAt": _iso(row.created_at),
        "updatedAt": _iso(row.updated_at),
        "completedAt": _iso(row.completed_at),
    }


def _clean_limits(limits: dict | None) -> dict:
    cleaned: dict[str, Optional[int]] = {}
    for key in ("users", "applications", "dynamicRecords"):
        if not limits or key not in limits:
            continue
        value = limits.get(key)
        if value is None:
            cleaned[key] = None
            continue
        if not isinstance(value, int) or value <= 0:
            raise HTTPException(422, "Tenant limits must be positive integers or null")
        cleaned[key] = value
    return cleaned


def _slug(value: str) -> str:
    normalized = (value or "").strip().lower()
    if not normalized or not all(ch.isalnum() or ch == "-" for ch in normalized):
        raise HTTPException(422, "Tenant slug may contain lowercase letters, numbers, and hyphens")
    return normalized


async def _tenant_payload(db: AsyncSession, tenant) -> dict:
    from app.models.relational import Application, AuditLog, DynamicRecord, Form, Report, TenantDomain, TenantInvite, User

    domains = (await db.execute(
        select(TenantDomain).where(TenantDomain.tenant_id == tenant.id).order_by(TenantDomain.is_primary.desc(), TenantDomain.id)
    )).scalars().all()
    now = datetime.utcnow()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "status": tenant.status,
        "config": tenant.config or {},
        "limits": tenant.limits or {},
        "domains": [{"id": item.id, "domain": item.domain, "status": item.status, "isPrimary": item.is_primary} for item in domains],
        "usage": {
            "users": await db.scalar(select(func.count(User.id)).where(User.tenant_id == tenant.id)) or 0,
            "applications": await db.scalar(select(func.count(Application.id)).where(Application.tenant_id == tenant.id)) or 0,
            "dynamicRecords": await db.scalar(select(func.count(DynamicRecord.id)).where(DynamicRecord.tenant_id == tenant.id)) or 0,
            "forms": await db.scalar(select(func.count(Form.id)).where(Form.tenant_id == tenant.id)) or 0,
            "reports": await db.scalar(select(func.count(Report.id)).where(Report.tenant_id == tenant.id)) or 0,
            "auditLogs": await db.scalar(select(func.count(AuditLog.id)).where(AuditLog.tenant_id == tenant.id)) or 0,
        },
        "adminUsersCount": await db.scalar(select(func.count(User.id)).where(User.tenant_id == tenant.id, User.is_admin.is_(True))) or 0,
        "activeUsersCount": await db.scalar(select(func.count(User.id)).where(User.tenant_id == tenant.id, User.is_active.is_(True))) or 0,
        "pendingInvitesCount": await db.scalar(
            select(func.count(TenantInvite.id)).where(
                TenantInvite.tenant_id == tenant.id,
                TenantInvite.accepted_at.is_(None),
                TenantInvite.revoked_at.is_(None),
                TenantInvite.replaced_by_invite_id.is_(None),
                TenantInvite.expires_at > now,
            )
        ) or 0,
        "lastLoginAt": _iso(await db.scalar(select(func.max(User.last_login_at)).where(User.tenant_id == tenant.id))),
        "createdAt": _iso(getattr(tenant, "created_at", None)),
        "updatedAt": _iso(getattr(tenant, "updated_at", None)),
        "openedBy": tenant.opened_by,
        "suspendedReason": tenant.suspended_reason,
    }


def _invite_status(invite) -> str:
    if invite.accepted_at is not None:
        return "accepted"
    if getattr(invite, "revoked_at", None) is not None:
        return "revoked"
    if getattr(invite, "replaced_by_invite_id", None) is not None:
        return "replaced"
    if invite.expires_at < datetime.utcnow():
        return "expired"
    return "pending"


def _invite_payload(invite) -> dict[str, Any]:
    return {
        "id": invite.id,
        "tenantId": invite.tenant_id,
        "email": invite.email,
        "role": invite.role,
        "status": _invite_status(invite),
        "expiresAt": _iso(invite.expires_at),
        "acceptedAt": _iso(invite.accepted_at),
        "revokedAt": _iso(getattr(invite, "revoked_at", None)),
        "createdAt": _iso(getattr(invite, "created_at", None)),
        "invitedBy": invite.invited_by,
        "userId": invite.user_id,
        "replacedByInviteId": getattr(invite, "replaced_by_invite_id", None),
    }


async def _tenant_detail_payload(db: AsyncSession, tenant) -> dict:
    from app.models.relational import AuditLog, Role, TenantInvite, User, UserRole

    payload = await _tenant_payload(db, tenant)
    admin_users = (await db.execute(
        select(User)
        .where(User.tenant_id == tenant.id, User.is_admin.is_(True))
        .order_by(User.id)
        .limit(20)
    )).scalars().all()
    active_users = (await db.execute(
        select(User)
        .where(User.tenant_id == tenant.id)
        .order_by(User.is_admin.desc(), User.id)
        .limit(50)
    )).scalars().all()
    role_rows = (await db.execute(
        select(UserRole.user_id, Role.id, Role.name, Role.label)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.tenant_id == tenant.id, Role.tenant_id == tenant.id)
    )).all()
    roles_by_user: dict[int, list[dict[str, Any]]] = {}
    for user_id, role_id, name, label in role_rows:
        roles_by_user.setdefault(user_id, []).append({"id": role_id, "name": name, "label": label})

    def user_payload(user) -> dict[str, Any]:
        return {
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
            "email": user.email,
            "isActive": user.is_active,
            "isAdmin": user.is_admin,
            "lastLoginAt": _iso(user.last_login_at),
            "lockedUntil": _iso(user.locked_until),
            "roles": roles_by_user.get(user.id, []),
        }

    invites = (await db.execute(
        select(TenantInvite)
        .where(TenantInvite.tenant_id == tenant.id)
        .order_by(desc(TenantInvite.created_at), desc(TenantInvite.id))
        .limit(20)
    )).scalars().all()
    audits = (await db.execute(
        select(AuditLog)
        .where(AuditLog.tenant_id == tenant.id)
        .order_by(desc(AuditLog.timestamp), desc(AuditLog.id))
        .limit(30)
    )).scalars().all()
    payload.update({
        "adminUsers": [user_payload(item) for item in admin_users],
        "users": [user_payload(item) for item in active_users],
        "recentInvites": [_invite_payload(item) for item in invites],
        "recentAuditLogs": [
            {
                "id": item.id,
                "tenantId": item.tenant_id,
                "userId": item.user_id,
                "action": item.action,
                "resourceType": item.resource_type,
                "resourceId": item.resource_id,
                "timestamp": _iso(item.timestamp),
                "oldValues": item.old_values,
                "newValues": item.new_values,
            }
            for item in audits
        ],
    })
    return payload


async def _ensure_role(db: AsyncSession, tenant_id: int, name: str, label: str):
    from app.models.relational import Role

    role = await db.scalar(select(Role).where(Role.tenant_id == tenant_id, Role.name == name))
    if role:
        return role
    legacy_global_role = await db.scalar(select(Role).where(Role.name == name))
    if legacy_global_role and legacy_global_role.tenant_id != tenant_id:
        return None
    role = Role(tenant_id=tenant_id, name=name, label=label)
    db.add(role)
    await db.flush()
    return role


@router.get("/tenants")
async def list_tenants(db: AsyncSession = Depends(get_db)):
    from app.models.relational import Tenant

    rows = (await db.execute(select(Tenant).order_by(Tenant.id))).scalars().all()
    return {"data": [await _tenant_payload(db, tenant) for tenant in rows]}


@router.get("/tenants/{tenant_id}")
async def get_tenant_detail(tenant_id: int, db: AsyncSession = Depends(get_db)):
    from app.models.relational import Tenant

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    return {"data": await _tenant_detail_payload(db, tenant)}


@router.post("/tenants")
async def create_tenant(body: TenantCreate, user: dict = Depends(require_platform_admin), db: AsyncSession = Depends(get_db)):
    from app.models.relational import Tenant, TenantDomain, User, UserRole

    slug = _slug(body.slug)
    if await db.scalar(select(Tenant.id).where(Tenant.slug == slug)):
        raise HTTPException(409, "Tenant slug already exists")
    domains = [normalize_domain(item) for item in body.domains]
    if len(set(domains)) != len(domains):
        raise HTTPException(409, "Duplicate tenant domain")
    if domains:
        existing = (await db.execute(select(TenantDomain.domain).where(TenantDomain.domain.in_(domains)))).scalars().all()
        if existing:
            raise HTTPException(409, f"Tenant domain already exists: {existing[0]}")

    tenant = Tenant(
        name=body.name,
        slug=slug,
        status="active",
        config={**DEFAULT_TENANT_CONFIG, **body.config},
        limits={**DEFAULT_TENANT_LIMITS, **_clean_limits(body.limits)},
        opened_by=current_user_id(user),
    )
    db.add(tenant)
    await db.flush()
    for idx, domain in enumerate(domains):
        db.add(TenantDomain(tenant_id=tenant.id, domain=domain, is_primary=idx == 0))
    admin_role = await _ensure_role(db, tenant.id, "admin", "Tenant Admin")
    await _ensure_role(db, tenant.id, "member", "Member")

    invite_payload = None
    if body.admin_email:
        email = body.admin_email.strip().lower()
        if domains and normalize_domain(email.rsplit("@", 1)[1]) not in domains:
            raise HTTPException(422, "Admin email domain must belong to the tenant")
        pending = User(
            tenant_id=tenant.id,
            username=email,
            email=email,
            display_name=email,
            hashed_password=hash_password("pending-invite"),
            is_active=False,
            is_admin=True,
            force_password_change=True,
        )
        db.add(pending)
        await db.flush()
        if admin_role:
            db.add(UserRole(tenant_id=tenant.id, user_id=pending.id, role_id=admin_role.id))
        invite_payload = await create_invite(db, tenant_id=tenant.id, email=email, role="admin", invited_by=current_user_id(user))
    await db.commit()
    await write_audit_log(
        tenant_id=tenant.id,
        user_id=current_user_id(user),
        action="create_tenant",
        resource_type="tenant",
        resource_id=tenant.id,
        new_values={"slug": tenant.slug, "domains": domains, "admin_email": body.admin_email},
    )
    payload = await _tenant_payload(db, tenant)
    if invite_payload:
        payload["adminInvite"] = invite_payload
    return {"data": payload}


@router.put("/tenants/{tenant_id}")
async def update_tenant(tenant_id: int, body: TenantUpdate, user: dict = Depends(require_platform_admin), db: AsyncSession = Depends(get_db)):
    from app.models.relational import Tenant, TenantDomain

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if body.status is not None and body.status not in {"active", "suspended", "archived"}:
        raise HTTPException(422, "Invalid tenant status")
    if tenant.status == "archived" and body.status == "active":
        raise HTTPException(422, "Archived tenant must be moved to suspended before active")
    old_status = tenant.status
    old_limits = dict(tenant.limits or {})
    old_domains = [row.domain for row in (await db.execute(select(TenantDomain).where(TenantDomain.tenant_id == tenant_id).order_by(TenantDomain.id))).scalars().all()]
    if body.name is not None:
        tenant.name = body.name
    if body.status is not None:
        tenant.status = body.status
    if body.config is not None:
        tenant.config = {**(tenant.config or {}), **body.config}
    if body.limits is not None:
        tenant.limits = {**(tenant.limits or {}), **_clean_limits(body.limits)}
    if body.suspended_reason is not None:
        tenant.suspended_reason = body.suspended_reason
    if body.domains is not None:
        domains = [normalize_domain(item) for item in body.domains]
        existing = (await db.execute(
            select(TenantDomain).where(TenantDomain.domain.in_(domains), TenantDomain.tenant_id != tenant_id)
        )).scalars().first()
        if existing:
            raise HTTPException(409, f"Tenant domain already exists: {existing.domain}")
        old = (await db.execute(select(TenantDomain).where(TenantDomain.tenant_id == tenant_id))).scalars().all()
        for item in old:
            await db.delete(item)
        for idx, domain in enumerate(domains):
            db.add(TenantDomain(tenant_id=tenant_id, domain=domain, is_primary=idx == 0))
    audit_user_id = current_user_id(user)
    audit_events: list[dict[str, Any]] = []
    if body.status is not None and old_status != tenant.status:
        audit_events.append({
            "action": "tenant_status_change",
            "old_values": {"status": old_status},
            "new_values": {"status": tenant.status, "suspended_reason": tenant.suspended_reason},
        })
    if body.limits is not None and old_limits != (tenant.limits or {}):
        audit_events.append({
            "action": "tenant_limits_change",
            "old_values": old_limits,
            "new_values": tenant.limits or {},
        })
    if body.domains is not None:
        next_domains = [normalize_domain(item) for item in body.domains]
        if old_domains != next_domains:
            audit_events.append({
                "action": "tenant_domains_change",
                "old_values": {"domains": old_domains},
                "new_values": {"domains": next_domains},
            })
    await db.commit()
    await db.refresh(tenant)
    for event in audit_events:
        await write_audit_log(
            tenant_id=tenant.id,
            user_id=audit_user_id,
            resource_type="tenant",
            resource_id=tenant.id,
            **event,
        )
    await write_audit_log(
        tenant_id=tenant.id,
        user_id=current_user_id(user),
        action="update_tenant",
        resource_type="tenant",
        resource_id=tenant.id,
        new_values=body.dict(exclude_unset=True),
    )
    return {"data": await _tenant_payload(db, tenant)}


@router.get("/tenants/{tenant_id}/invites")
async def list_tenant_invites(tenant_id: int, db: AsyncSession = Depends(get_db)):
    from app.models.relational import Tenant, TenantInvite

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    rows = (await db.execute(
        select(TenantInvite)
        .where(TenantInvite.tenant_id == tenant_id)
        .order_by(desc(TenantInvite.created_at), desc(TenantInvite.id))
    )).scalars().all()
    return {"data": [_invite_payload(item) for item in rows]}


@router.post("/tenants/{tenant_id}/invites/{invite_id}/revoke")
async def revoke_tenant_invite(
    tenant_id: int,
    invite_id: int,
    user: dict = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import Tenant, TenantInvite

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    invite = await db.get(TenantInvite, invite_id)
    if not invite or invite.tenant_id != tenant_id:
        raise HTTPException(404, "Invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(409, "Accepted invite cannot be revoked")
    if invite.revoked_at is None:
        invite.revoked_at = datetime.utcnow()
        invite.revoked_by = current_user_id(user)
    audit_payload = {"invite_id": invite.id, "email": invite.email, "role": invite.role}
    await db.commit()
    await db.refresh(invite)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="revoke_invite",
        resource_type="tenant_invite",
        resource_id=invite.id,
        new_values=audit_payload,
    )
    return {"data": _invite_payload(invite)}


@router.post("/tenants/{tenant_id}/invites/{invite_id}/resend")
async def resend_tenant_invite(
    tenant_id: int,
    invite_id: int,
    user: dict = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import Tenant, TenantInvite

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if tenant.status != "active":
        raise HTTPException(403, "Tenant is not active")
    invite = await db.get(TenantInvite, invite_id)
    if not invite or invite.tenant_id != tenant_id:
        raise HTTPException(404, "Invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(409, "Accepted invite cannot be resent")
    payload = await create_invite(db, tenant_id=tenant_id, email=invite.email, role=invite.role, invited_by=current_user_id(user))
    invite.revoked_at = datetime.utcnow()
    invite.revoked_by = current_user_id(user)
    invite.replaced_by_invite_id = payload["id"]
    audit_payload = {"old_invite_id": invite.id, "new_invite_id": payload["id"], "email": invite.email, "role": invite.role}
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="resend_invite",
        resource_type="tenant_invite",
        resource_id=invite.id,
        new_values=audit_payload,
    )
    return {"data": payload}


@router.post("/tenants/{tenant_id}/users/{user_id}/password-reset")
async def create_platform_password_reset(
    tenant_id: int,
    user_id: int,
    user: dict = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import Tenant, User

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if tenant.status != "active":
        raise HTTPException(403, "Tenant is not active")
    target = await db.get(User, user_id)
    if not target or target.tenant_id != tenant_id:
        raise HTTPException(404, "User not found")
    if not target.is_active or not target.email:
        raise HTTPException(409, "User is not active or has no email")
    payload = await create_password_reset(db, tenant_id=tenant_id, user_id=target.id, email=target.email)
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="platform_password_reset",
        resource_type="password_reset_token",
        resource_id=target.id,
        new_values={"user_id": target.id, "email": target.email, "emailDelivered": payload["emailDelivered"]},
    )
    return {"data": payload}


@router.post("/tenants/{tenant_id}/invites")
async def invite_tenant_user(
    tenant_id: int,
    body: TenantInviteRequest,
    user: dict = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import Role, Tenant, User, UserRole

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if tenant.status != "active":
        raise HTTPException(403, "Tenant is not active")
    role_name = "admin" if body.role in {"admin", "tenant_admin"} else "member"
    role = await db.scalar(select(Role).where(Role.tenant_id == tenant_id, Role.name == role_name))
    if not role:
        role = await _ensure_role(db, tenant_id, role_name, "Tenant Admin" if role_name == "admin" else "Member")
    email = body.email.strip().lower()
    user_row = await db.scalar(select(User).where(User.tenant_id == tenant_id, User.email == email))
    if user_row and user_row.is_active:
        raise HTTPException(409, "User already exists")
    if not user_row:
        user_row = User(
            tenant_id=tenant_id,
            username=email,
            email=email,
            display_name=email,
            hashed_password=hash_password("pending-invite"),
            is_active=False,
            is_admin=role_name == "admin",
            force_password_change=True,
        )
        db.add(user_row)
        await db.flush()
        if role:
            db.add(UserRole(tenant_id=tenant_id, user_id=user_row.id, role_id=role.id))
    payload = await create_invite(db, tenant_id=tenant_id, email=email, role=role_name, invited_by=current_user_id(user))
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create_invite",
        resource_type="tenant_invite",
        resource_id=payload["id"],
        new_values={"email": email, "role": role_name},
    )
    return {"data": payload}


@router.post("/tenants/{tenant_id}/exports")
async def create_tenant_export(
    tenant_id: int,
    user: dict = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.relational import Tenant, TenantExport

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    export_row = TenantExport(tenant_id=tenant_id, requested_by=current_user_id(user), status="running", format="zip")
    db.add(export_row)
    await db.commit()
    await db.refresh(export_row)

    try:
        payload: dict[str, Any] = {
            "tenant": {
                "id": tenant.id,
                "name": tenant.name,
                "slug": tenant.slug,
                "status": tenant.status,
                "config": _redact(tenant.config or {}),
                "limits": tenant.limits or {},
                "created_at": _iso(tenant.created_at),
                "updated_at": _iso(tenant.updated_at),
            },
            "tables": {},
        }
        for table_name in EXPORT_TABLES:
            nested = await db.begin_nested()
            try:
                sql = "SELECT * FROM tenants WHERE id = :tenant_id" if table_name == "tenants" else f"SELECT * FROM {table_name} WHERE tenant_id = :tenant_id"
                rows = (await db.execute(text(sql), {"tenant_id": tenant_id})).mappings().all()
                payload["tables"][table_name] = [_export_payload(row) for row in rows]
                await nested.commit()
            except Exception:
                await nested.rollback()
                payload["tables"][table_name] = []

        export_dir = Path(__file__).resolve().parents[2] / "storage" / "tenant_exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        file_path = export_dir / f"tenant-{tenant_id}-export-{export_row.id}.zip"
        manifest = {
            "tenantId": tenant_id,
            "exportId": export_row.id,
            "createdAt": datetime.utcnow().isoformat(),
            "format": "zip",
            "redaction": "password/token/secret/smtp/credential fields are redacted",
        }
        with zipfile.ZipFile(file_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2, default=_json_default))
            zf.writestr("tenant-data.json", json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default))

        checksum = hashlib.sha256(file_path.read_bytes()).hexdigest()
        export_row.status = "completed"
        export_row.file_path = str(file_path)
        export_row.checksum = checksum
        export_row.size_bytes = file_path.stat().st_size
        export_row.completed_at = datetime.utcnow()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="tenant_export",
            resource_type="tenant_export",
            resource_id=export_row.id,
            new_values={"export_id": export_row.id, "checksum": checksum},
        )
    except Exception as exc:
        export_row.status = "failed"
        export_row.error = str(exc)

    await db.commit()
    await db.refresh(export_row)
    return {"data": _export_response(export_row), "ok": export_row.status == "completed"}


@router.get("/tenants/{tenant_id}/exports")
async def list_tenant_exports(tenant_id: int, db: AsyncSession = Depends(get_db)):
    from app.models.relational import Tenant, TenantExport

    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    rows = (
        await db.execute(
            select(TenantExport).where(TenantExport.tenant_id == tenant_id).order_by(desc(TenantExport.created_at))
        )
    ).scalars().all()
    return {"data": [_export_response(row) for row in rows]}
