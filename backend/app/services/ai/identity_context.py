"""Resolve current database role membership for AI requests and confirmations."""
from fastapi import HTTPException
from sqlalchemy import select

from app.api.deps import current_tenant_id, current_user_id
from app.core.db import db_session
from app.models.relational import User, Role, UserRole


async def resolve_ai_identity(user: dict) -> dict:
    normalized = {**user}
    if user.get('is_admin'):
        normalized['roles'] = [{'name': 'admin', 'label': 'Admin'}]
        return normalized
    tenant_id, uid = current_tenant_id(user), current_user_id(user)
    async with db_session() as session:
        principal = await session.scalar(select(User).where(User.id == uid, User.tenant_id == tenant_id, User.is_active.is_(True)))
        if principal is None:
            raise HTTPException(401, '用户不存在或已停用')
        rows = (await session.execute(select(Role.id, Role.name, Role.label).join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == uid, UserRole.tenant_id == tenant_id, Role.tenant_id == tenant_id))).all()
        normalized['is_admin'] = principal.is_admin
        normalized['roles'] = [{'id': row.id, 'name': row.name, 'label': row.label} for row in rows]
    return normalized
