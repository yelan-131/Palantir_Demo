"""Admin API — User/Role/Permission CRUD."""

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    password: str
    is_admin: bool = False
    role_ids: list[int] = []


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    role_ids: Optional[list[int]] = None


class RoleCreate(BaseModel):
    name: str
    label: str
    description: Optional[str] = None


class PermissionSet(BaseModel):
    role_id: int
    permissions: list[dict]


# ── Mock data ─────────────────────────────────────────────

_MOCK_USERS_ADMIN = [
    {"id": 1, "username": "admin", "display_name": "系统管理员", "email": "admin@manufoundry.local",
     "is_active": True, "is_admin": True, "roles": [{"id": 1, "name": "admin", "label": "管理员"}]},
    {"id": 2, "username": "zhangsan", "display_name": "张三", "email": "zhangsan@manufoundry.local",
     "is_active": True, "is_admin": False, "roles": [{"id": 2, "name": "production_manager", "label": "生产主管"}]},
    {"id": 3, "username": "lisi", "display_name": "李四", "email": "lisi@manufoundry.local",
     "is_active": True, "is_admin": False, "roles": [{"id": 3, "name": "quality_inspector", "label": "质检员"}]},
]

_MOCK_ROLES = [
    {"id": 1, "name": "admin", "label": "管理员", "description": "系统管理员，拥有全部权限",
     "permissions": [
         {"resource_type": "all", "resource_key": "*", "action": "*"},
     ]},
    {"id": 2, "name": "production_manager", "label": "生产主管", "description": "管理生产相关模块",
     "permissions": [
         {"resource_type": "menu", "resource_key": "/", "action": "view"},
         {"resource_type": "menu", "resource_key": "/maintenance", "action": "view"},
         {"resource_type": "action", "resource_key": "work_order", "action": "create"},
     ]},
    {"id": 3, "name": "quality_inspector", "label": "质检员", "description": "质量管理相关权限",
     "permissions": [
         {"resource_type": "menu", "resource_key": "/quality", "action": "view"},
         {"resource_type": "action", "resource_key": "inspection", "action": "create"},
     ]},
]


def _hash_password(password: str) -> str:
    """Delegate to core.security so admin & auth share the same algorithm."""
    from app.core.security import hash_password
    return hash_password(password)


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── User CRUD ────────────────────────────────────────────

@router.get("/users")
async def list_users():
    """用户列表."""
    async def _query(db):
        from app.models.relational import User, UserRole, Role
        result = await db.execute(select(User).order_by(User.id))
        users = result.scalars().all()
        out = []
        for u in users:
            roles_res = await db.execute(
                select(Role.name, Role.label)
                .join(UserRole, UserRole.role_id == Role.id)
                .where(UserRole.user_id == u.id)
            )
            out.append({
                "id": u.id, "username": u.username, "display_name": u.display_name,
                "email": u.email, "is_active": u.is_active, "is_admin": u.is_admin,
                "roles": [{"id": 0, "name": r[0], "label": r[1]} for r in roles_res.fetchall()],
            })
        return {"data": out}

    result = await _try_db(_query)
    return result or {"data": _MOCK_USERS_ADMIN}


@router.post("/users")
async def create_user(body: UserCreate):
    """创建用户."""
    async def _query(db):
        from app.models.relational import User, UserRole
        existing = await db.scalar(select(User).where(User.username == body.username))
        if existing:
            raise HTTPException(400, "用户名已存在")
        user = User(
            username=body.username, display_name=body.display_name,
            email=body.email, hashed_password=_hash_password(body.password),
            is_admin=body.is_admin,
        )
        db.add(user)
        await db.flush()
        for rid in body.role_ids:
            db.add(UserRole(user_id=user.id, role_id=rid))
        await db.commit()
        return {"id": user.id, "username": user.username}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"id": len(_MOCK_USERS_ADMIN) + 10, "username": body.username}


@router.put("/users/{user_id}")
async def update_user(user_id: int, body: UserUpdate):
    """更新用户."""
    async def _query(db):
        from app.models.relational import User, UserRole
        user = await db.get(User, user_id)
        if not user:
            return None
        if body.display_name is not None:
            user.display_name = body.display_name
        if body.email is not None:
            user.email = body.email
        if body.is_active is not None:
            user.is_active = body.is_active
        if body.is_admin is not None:
            user.is_admin = body.is_admin
        if body.role_ids is not None:
            await db.execute(
                UserRole.__table__.delete().where(UserRole.user_id == user_id)
            )
            for rid in body.role_ids:
                db.add(UserRole(user_id=user_id, role_id=rid))
        await db.commit()
        return {"id": user.id}

    result = await _try_db(_query)
    return result or {"id": user_id}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int):
    """删除用户."""
    async def _query(db):
        from app.models.relational import User, UserRole
        user = await db.get(User, user_id)
        if not user:
            return None
        await db.execute(UserRole.__table__.delete().where(UserRole.user_id == user_id))
        await db.delete(user)
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


# ── Role CRUD ────────────────────────────────────────────

@router.get("/roles")
async def list_roles():
    """角色列表."""
    async def _query(db):
        from app.models.relational import Role, RolePermission
        result = await db.execute(select(Role).order_by(Role.id))
        roles = result.scalars().all()
        out = []
        for r in roles:
            perms_res = await db.execute(
                select(RolePermission).where(RolePermission.role_id == r.id)
            )
            perms = perms_res.scalars().all()
            out.append({
                "id": r.id, "name": r.name, "label": r.label, "description": r.description,
                "permissions": [
                    {"resource_type": p.resource_type, "resource_key": p.resource_key, "action": p.action}
                    for p in perms
                ],
            })
        return {"data": out}

    result = await _try_db(_query)
    return result or {"data": _MOCK_ROLES}


@router.post("/roles")
async def create_role(body: RoleCreate):
    """创建角色."""
    async def _query(db):
        from app.models.relational import Role
        role = Role(name=body.name, label=body.label, description=body.description)
        db.add(role)
        await db.commit()
        await db.refresh(role)
        return {"id": role.id, "name": role.name}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"id": len(_MOCK_ROLES) + 10, "name": body.name}


@router.put("/roles/{role_id}/permissions")
async def set_permissions(body: PermissionSet):
    """设置角色权限."""
    async def _query(db):
        from app.models.relational import RolePermission
        await db.execute(
            RolePermission.__table__.delete().where(RolePermission.role_id == body.role_id)
        )
        for p in body.permissions:
            db.add(RolePermission(
                role_id=body.role_id,
                resource_type=p.get("resource_type", "action"),
                resource_key=p.get("resource_key"),
                action=p.get("action", "view"),
            ))
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


@router.delete("/roles/{role_id}")
async def delete_role(role_id: int):
    """删除角色."""
    async def _query(db):
        from app.models.relational import Role
        role = await db.get(Role, role_id)
        if not role:
            return None
        await db.delete(role)
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


# ── Audit Logs ──────────────────────────────────────────

@router.get("/audit-logs")
async def list_audit_logs(
    resource_type: Optional[str] = None,
    action: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """审计日志查询."""
    async def _query(db):
        from sqlalchemy import func as sa_func
        from app.models.relational import AuditLog
        q = select(AuditLog).order_by(AuditLog.timestamp.desc())
        if resource_type:
            q = q.where(AuditLog.resource_type == resource_type)
        if action:
            q = q.where(AuditLog.action == action)
        count_q = select(sa_func.count()).select_from(q.subquery())
        total = await db.scalar(count_q)
        q = q.offset((page - 1) * page_size).limit(page_size)
        result = await db.execute(q)
        logs = result.scalars().all()
        return {
            "data": [
                {
                    "id": l.id, "user_id": l.user_id, "action": l.action,
                    "resource_type": l.resource_type, "resource_id": l.resource_id,
                    "old_values": l.old_values, "new_values": l.new_values,
                    "timestamp": l.timestamp.isoformat() if l.timestamp else None,
                }
                for l in logs
            ],
            "total": total, "page": page, "page_size": page_size,
        }

    result = await _try_db(_query)
    return result or {"data": [], "total": 0, "page": page, "page_size": page_size}
