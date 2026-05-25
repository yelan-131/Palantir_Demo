"""Permission helpers for RBAC and platform forms.

The project stores permissions in two places:
- role_permissions: generic RBAC grants such as menu/report/workflow actions.
- form_permissions + application_forms/application_roles: form-specific access.

This module is the single backend decision point so UI visibility never becomes
the security boundary.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.deps import current_tenant_id


ACTION_ALIASES: dict[str, set[str]] = {
    "view": {"view", "read"},
    "read": {"view", "read"},
    "edit": {"edit", "update"},
    "update": {"edit", "update"},
    "delete": {"delete", "remove"},
    "remove": {"delete", "remove"},
}


def _uid(user: dict) -> Optional[int]:
    uid = user.get("uid")
    if isinstance(uid, int) and uid > 0:
        return uid
    return None


def _action_matches(granted: str, requested: str) -> bool:
    if granted == "*" or granted == requested:
        return True
    return requested in ACTION_ALIASES.get(granted, set())


def _key_matches(granted: Optional[str], requested: str) -> bool:
    return granted in {"*", requested}


async def get_user_role_ids(user: dict, db: AsyncSession) -> list[int]:
    """Return role ids for a principal.

    JWTs intentionally keep only stable identity claims, so current role
    membership is fetched from the database at authorization time.
    """
    if user.get("is_admin"):
        return []
    uid = _uid(user)
    if not uid:
        return []

    from app.models.relational import UserRole

    tenant_id = current_tenant_id(user)
    result = await db.execute(
        select(UserRole.role_id).where(
            UserRole.user_id == uid,
            UserRole.tenant_id == tenant_id,
        )
    )
    return [int(row[0]) for row in result.fetchall()]


async def has_permission(
    user: dict,
    resource_type: str,
    resource_key: str,
    action: str,
    db: AsyncSession,
) -> bool:
    """Check generic role_permissions.

    Admin users bypass checks. Non-admin users need a matching role permission.
    Wildcards are supported with resource_key/action = "*".
    """
    if user.get("is_admin"):
        return True

    role_ids = await get_user_role_ids(user, db)
    if not role_ids:
        return False

    from app.models.relational import RolePermission

    tenant_id = current_tenant_id(user)
    result = await db.execute(
        select(RolePermission).where(
            RolePermission.role_id.in_(role_ids),
            RolePermission.tenant_id == tenant_id,
            RolePermission.resource_type.in_([resource_type, "all"]),
        )
    )
    permissions = result.scalars().all()
    return any(
        _key_matches(permission.resource_key, resource_key)
        and _action_matches(permission.action, action)
        for permission in permissions
    )


def require_permission(resource_type: str, resource_key: str, action: str):
    async def checker(
        user: dict = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict:
        if not await has_permission(user, resource_type, resource_key, action, db):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permission denied")
        return user

    return checker


def _binding_allows(binding, action: str) -> bool:
    if action in {"view", "read"}:
        return bool(binding.enabled)
    if action == "create":
        return bool(binding.enabled and binding.allow_create)
    if action in {"edit", "update"}:
        return bool(binding.enabled and binding.allow_edit)
    if action in {"delete", "remove"}:
        return bool(binding.enabled and binding.allow_delete)
    if action == "export":
        return bool(binding.enabled and binding.allow_export)
    return False


async def has_form_permission(
    user: dict,
    form_id: int,
    action: str,
    db: AsyncSession,
    *,
    field_name: Optional[str] = None,
) -> bool:
    """Check access to a platform form.

    Resolution order:
    1. Admin bypass.
    2. Explicit form_permissions: deny wins, then allow.
    3. Application bindings: a user with a visible app role can access the
       form according to application_forms allow_* flags.
    """
    if user.get("is_admin"):
        return True

    role_ids = await get_user_role_ids(user, db)
    if not role_ids:
        return False

    from app.models.relational import ApplicationForm, ApplicationRole, FormPermission

    tenant_id = current_tenant_id(user)
    permission_rows = (await db.execute(
        select(FormPermission).where(
            FormPermission.form_id == form_id,
            FormPermission.tenant_id == tenant_id,
            FormPermission.role_id.in_(role_ids),
        )
    )).scalars().all()

    relevant = [
        permission
        for permission in permission_rows
        if (permission.field_name is None or permission.field_name == field_name)
        and _action_matches(permission.action, action)
    ]
    if any(permission.effect == "deny" for permission in relevant):
        return False
    if any(permission.effect == "allow" for permission in relevant):
        return True

    bindings = (await db.execute(
        select(ApplicationForm)
        .join(ApplicationRole, ApplicationRole.application_id == ApplicationForm.application_id)
        .where(
            ApplicationForm.form_id == form_id,
            ApplicationForm.tenant_id == tenant_id,
            ApplicationRole.tenant_id == tenant_id,
            ApplicationRole.role_id.in_(role_ids),
        )
    )).scalars().all()
    return any(_binding_allows(binding, action) for binding in bindings)


def require_form_permission(action: str):
    async def checker(
        form_id: int,
        user: dict = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict:
        if not await has_form_permission(user, form_id, action, db):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Form permission denied")
        return user

    return checker
