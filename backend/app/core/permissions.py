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
from app.services.iam import condition_matches


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


async def get_user_org_ids(user: dict, db: AsyncSession, *, include_descendants: bool = False) -> list[int]:
    uid = _uid(user)
    if not uid:
        return []
    from app.models.relational import OrgUnit, UserOrgMembership

    tenant_id = current_tenant_id(user)
    own_ids = [
        int(row[0])
        for row in (await db.execute(
            select(UserOrgMembership.org_unit_id).where(
                UserOrgMembership.user_id == uid,
                UserOrgMembership.tenant_id == tenant_id,
            )
        )).fetchall()
    ]
    if not include_descendants or not own_ids:
        return own_ids
    all_orgs = (await db.execute(select(OrgUnit.id, OrgUnit.parent_id).where(OrgUnit.tenant_id == tenant_id))).fetchall()
    children: dict[int, list[int]] = {}
    for org_id, parent_id in all_orgs:
        if parent_id is not None:
            children.setdefault(int(parent_id), []).append(int(org_id))
    expanded = set(own_ids)
    stack = list(own_ids)
    while stack:
        current = stack.pop()
        for child in children.get(current, []):
            if child not in expanded:
                expanded.add(child)
                stack.append(child)
    return sorted(expanded)


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
            RolePermission.enabled.is_(True),
        )
        .order_by(RolePermission.priority.asc(), RolePermission.id.asc())
    )
    permissions = result.scalars().all()
    matched = [
        permission
        for permission in permissions
        if _key_matches(permission.resource_key, resource_key)
        and _action_matches(permission.action, action)
    ]
    if any(permission.effect == "deny" for permission in matched):
        return False
    return any(permission.effect == "allow" for permission in matched)


def _field_rule_allows(field_rules: Optional[dict], field_name: str, action: str) -> Optional[bool]:
    if not field_rules or not field_name:
        return None
    fields = field_rules.get("fields") if isinstance(field_rules, dict) else None
    if not isinstance(fields, dict):
        return None
    rule = fields.get(field_name)
    if not isinstance(rule, dict):
        return None
    if rule.get("deny") is True:
        return False
    visible = rule.get("visible")
    editable = rule.get("editable")
    if action in {"view", "read", "export"} and visible is not None:
        return bool(visible)
    if action in {"edit", "update", "create"} and editable is not None:
        return bool(editable)
    return None


async def evaluate_form_permission(
    user: dict,
    form_id: int,
    action: str,
    db: AsyncSession,
    *,
    field_name: Optional[str] = None,
    record_data: Optional[dict] = None,
    cache: Optional[dict] = None,
) -> dict:
    """Return an explainable permission decision for a form action."""
    if user.get("is_admin"):
        return {"allowed": True, "source": "admin", "reason": "admin bypass", "matched": []}

    cache = cache if cache is not None else {}
    if "role_ids" not in cache:
        cache["role_ids"] = await get_user_role_ids(user, db)
    role_ids = cache["role_ids"]
    if not role_ids:
        return {"allowed": False, "source": "roles", "reason": "no roles", "matched": []}

    from app.models.relational import ApplicationForm, ApplicationRole, Form, FormPermission, RolePermission

    tenant_id = current_tenant_id(user)
    form_cache_key = ("form", form_id)
    if form_cache_key not in cache:
        cache[form_cache_key] = await db.get(Form, form_id)
    form = cache[form_cache_key]
    resource_keys = [str(form_id)]
    if form and form.code:
        resource_keys.append(form.code)

    role_permissions_key = ("role_permissions", tenant_id, tuple(role_ids))
    if role_permissions_key not in cache:
        cache[role_permissions_key] = (await db.execute(
            select(RolePermission).where(
                RolePermission.tenant_id == tenant_id,
                RolePermission.role_id.in_(role_ids),
                RolePermission.resource_type.in_(["form", "all"]),
                RolePermission.enabled.is_(True),
            )
            .order_by(RolePermission.priority.asc(), RolePermission.id.asc())
        )).scalars().all()
    role_permissions = cache[role_permissions_key]

    matched = []
    for permission in role_permissions:
        if not any(_key_matches(permission.resource_key, key) for key in resource_keys):
            continue
        if not _action_matches(permission.action, action):
            continue
        # A form-level capability check has no row yet. Conditional grants
        # allow entering the form; conditional denies are evaluated on rows.
        if record_data is None and permission.condition_json and permission.effect == "deny":
            continue
        if record_data is not None and not condition_matches(permission.condition_json, record_data, user):
            continue
        field_allowed = _field_rule_allows(permission.field_rules_json, field_name or "", action)
        if field_allowed is False:
            matched.append({"id": permission.id, "effect": "deny", "source": "role_permission", "reason": "field rule deny"})
            continue
        if field_allowed is None and field_name and permission.field_rules_json:
            continue
        matched.append({
            "id": permission.id,
            "effect": permission.effect,
            "source": "role_permission",
            "data_scope": permission.data_scope,
            "resource_key": permission.resource_key,
            "action": permission.action,
        })

    if any(item["effect"] == "deny" for item in matched):
        return {"allowed": False, "source": "role_permission", "reason": "explicit deny", "matched": matched}
    if any(item["effect"] == "allow" for item in matched):
        return {"allowed": True, "source": "role_permission", "reason": "explicit allow", "matched": matched}

    form_permissions_key = ("form_permissions", tenant_id, form_id, tuple(role_ids))
    if form_permissions_key not in cache:
        cache[form_permissions_key] = (await db.execute(
            select(FormPermission).where(
                FormPermission.form_id == form_id,
                FormPermission.tenant_id == tenant_id,
                FormPermission.role_id.in_(role_ids),
            )
        )).scalars().all()
    permission_rows = cache[form_permissions_key]
    relevant = [
        permission
        for permission in permission_rows
        if (permission.field_name is None or permission.field_name == field_name)
        and _action_matches(permission.action, action)
    ]
    form_matched = [
        {"id": permission.id, "effect": permission.effect, "source": "form_permission", "field_name": permission.field_name}
        for permission in relevant
    ]
    if any(permission.effect == "deny" for permission in relevant):
        return {"allowed": False, "source": "form_permission", "reason": "explicit deny", "matched": form_matched}
    if any(permission.effect == "allow" for permission in relevant):
        return {"allowed": True, "source": "form_permission", "reason": "explicit allow", "matched": form_matched}

    if field_name:
        return {"allowed": False, "source": "field", "reason": "no field-level allow", "matched": matched + form_matched}

    bindings_key = ("application_form_bindings", tenant_id, form_id, tuple(role_ids))
    if bindings_key not in cache:
        cache[bindings_key] = (await db.execute(
            select(ApplicationForm)
            .join(ApplicationRole, ApplicationRole.application_id == ApplicationForm.application_id)
            .where(
                ApplicationForm.form_id == form_id,
                ApplicationForm.tenant_id == tenant_id,
                ApplicationRole.tenant_id == tenant_id,
                ApplicationRole.role_id.in_(role_ids),
            )
        )).scalars().all()
    bindings = cache[bindings_key]
    allowed_bindings = [binding for binding in bindings if _binding_allows(binding, action)]
    if allowed_bindings:
        binding_matches = [{"id": binding.id, "effect": "allow", "source": "application_form", "data_scope": binding.data_scope} for binding in allowed_bindings]
        return {"allowed": True, "source": "application_form", "reason": "application binding", "matched": matched + form_matched + binding_matches}
    return {"allowed": False, "source": "default", "reason": "no matching allow", "matched": matched + form_matched}


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
    decision = await evaluate_form_permission(
        user,
        form_id,
        action,
        db,
        field_name=field_name,
    )
    return bool(decision["allowed"])


async def allowed_form_fields(user: dict, form_id: int, action: str, fields: list, db: AsyncSession, *, record_data: Optional[dict] = None, cache: Optional[dict] = None) -> set[str]:
    if user.get("is_admin"):
        return {field.field_name for field in fields if not getattr(field, "archived", False)}
    allowed: set[str] = set()
    denied: set[str] = set()
    cache = cache if cache is not None else {}
    for field in fields:
        if getattr(field, "archived", False):
            continue
        decision = await evaluate_form_permission(user, form_id, action, db, field_name=field.field_name, record_data=record_data, cache=cache)
        if decision["allowed"]:
            allowed.add(field.field_name)
        elif decision.get("reason") == "explicit deny":
            denied.add(field.field_name)
    if not allowed and (await evaluate_form_permission(user, form_id, action, db, record_data=record_data, cache=cache))["allowed"]:
        allowed = {field.field_name for field in fields if not getattr(field, "archived", False)} - denied
    from app.services.designer_permissions import field_settings
    settings=await field_settings(db,user,fields,cache=cache)
    return allowed-{name for name,value in settings.items() if value.get("hidden")}


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
