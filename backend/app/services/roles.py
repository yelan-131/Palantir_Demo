"""Tenant-scoped role creation shared by administration and menu settings."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.relational import Role


async def ensure_role_name_available(db, tenant_id, name):
    existing = await db.scalar(select(Role.id).where(Role.tenant_id == tenant_id, Role.name == name))
    if existing is not None:
        raise HTTPException(409, "Role name already exists")


async def stage_role(db, tenant_id, *, name, label, description=None):
    await ensure_role_name_available(db, tenant_id, name)
    role = Role(tenant_id=tenant_id, name=name, label=label, description=description)
    try:
        async with db.begin_nested():
            db.add(role)
            await db.flush()
    except IntegrityError:
        await ensure_role_name_available(db, tenant_id, name)
        raise
    return role
