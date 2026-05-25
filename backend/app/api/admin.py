"""Admin API — User/Role/Permission CRUD."""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select

from app.api.deps import current_tenant_id, require_admin

router = APIRouter(dependencies=[Depends(require_admin)])


# ── Schemas ───────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    password: str
    is_admin: bool = False
    role_ids: list[int] = []
    org_unit_ids: list[int] = []
    primary_org_unit_id: Optional[int] = None
    position_title: Optional[str] = None


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    role_ids: Optional[list[int]] = None
    org_unit_ids: Optional[list[int]] = None
    primary_org_unit_id: Optional[int] = None
    position_title: Optional[str] = None


class RoleCreate(BaseModel):
    name: str
    label: str
    description: Optional[str] = None


class PermissionSet(BaseModel):
    role_id: int
    permissions: list[dict]


class OrgUnitCreate(BaseModel):
    code: str
    name: str
    parent_id: Optional[int] = None
    org_type: str = "department"
    sort_order: int = 0
    status: str = "active"
    description: Optional[str] = None


class OrgUnitUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    parent_id: Optional[int] = None
    org_type: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None
    description: Optional[str] = None


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

_EXTRA_MOCK_ROLES = [
    {"id": 4, "name": "quality_engineer", "label": "\u8d28\u91cf\u5de5\u7a0b\u5e08", "description": "\u8d28\u91cf\u603b\u89c8\u3001\u68c0\u9a8c\u6279\u6b21\u3001\u7f3a\u9677\u5206\u6790\u548c CAPA \u8ddf\u8e2a\u3002", "permissions": [
        {"resource_type": "menu", "resource_key": "quality-analytics", "action": "view"},
        {"resource_type": "form", "resource_key": "quality-event", "action": "edit"},
    ]},
    {"id": 5, "name": "maintenance_manager", "label": "\u8bbe\u5907\u7ef4\u62a4\u7ecf\u7406", "description": "\u8bbe\u5907\u5065\u5eb7\u3001\u6545\u969c\u9884\u6d4b\u3001\u7ef4\u4fee\u5de5\u5355\u548c\u7ef4\u62a4\u62a5\u8868\u3002", "permissions": [
        {"resource_type": "menu", "resource_key": "predictive-maintenance", "action": "view"},
        {"resource_type": "form", "resource_key": "maintenance-order", "action": "approve"},
    ]},
    {"id": 6, "name": "maintenance_engineer", "label": "\u7ef4\u4fee\u5de5\u7a0b\u5e08", "description": "\u7ef4\u4fee\u5de5\u5355\u6267\u884c\u3001\u8bbe\u5907\u70b9\u68c0\u548c\u544a\u8b66\u786e\u8ba4\u3002", "permissions": [
        {"resource_type": "form", "resource_key": "maintenance-order", "action": "edit"},
    ]},
    {"id": 7, "name": "process_engineer", "label": "\u5de5\u827a\u5de5\u7a0b\u5e08", "description": "\u8fc7\u7a0b\u80fd\u529b\u3001\u5de5\u827a\u53c2\u6570\u548c\u5f02\u5e38\u5206\u6790\u3002", "permissions": [
        {"resource_type": "report", "resource_key": "process-capability-dashboard", "action": "view"},
    ]},
    {"id": 8, "name": "supply_chain_manager", "label": "\u4f9b\u5e94\u94fe\u7ecf\u7406", "description": "\u4f9b\u5e94\u94fe\u98ce\u9669\u3001\u7269\u6599\u5f71\u54cd\u548c\u98ce\u9669\u590d\u6838\u3002", "permissions": [
        {"resource_type": "menu", "resource_key": "supply-chain-risk", "action": "view"},
        {"resource_type": "form", "resource_key": "risk-review", "action": "approve"},
    ]},
    {"id": 9, "name": "warehouse_operator", "label": "\u4ed3\u50a8\u64cd\u4f5c\u5458", "description": "\u7269\u6599\u51fa\u5165\u5e93\u3001\u5e93\u5b58\u6838\u5bf9\u548c\u5f71\u54cd\u8303\u56f4\u786e\u8ba4\u3002", "permissions": [
        {"resource_type": "form", "resource_key": "material-impact", "action": "edit"},
    ]},
    {"id": 10, "name": "data_steward", "label": "\u6570\u636e\u4e13\u5458", "description": "\u4e3b\u6570\u636e\u7ef4\u62a4\u3001\u6570\u636e\u8d28\u91cf\u68c0\u67e5\u548c\u6570\u636e\u53d8\u66f4\u5ba1\u6279\u3002", "permissions": [
        {"resource_type": "data", "resource_key": "master-data", "action": "edit"},
    ]},
    {"id": 11, "name": "approval_lead", "label": "\u5ba1\u6279\u8d1f\u8d23\u4eba", "description": "\u8de8\u6a21\u5757\u5ba1\u6279\u3001\u98ce\u9669\u653e\u884c\u548c\u4e1a\u52a1\u6d41\u7a0b\u7ec8\u5ba1\u3002", "permissions": [
        {"resource_type": "workflow", "resource_key": "*", "action": "approve"},
    ]},
    {"id": 12, "name": "viewer", "label": "\u53ea\u8bfb\u89c2\u5bdf\u5458", "description": "\u53ea\u8bfb\u67e5\u770b\u5de5\u4f5c\u53f0\u3001\u770b\u677f\u548c\u57fa\u7840\u62a5\u8868\u3002", "permissions": [
        {"resource_type": "menu", "resource_key": "*", "action": "view"},
        {"resource_type": "report", "resource_key": "*", "action": "view"},
    ]},
]

_EXTRA_MOCK_USERS_ADMIN = [
    {"id": 4, "username": "pm_li", "display_name": "\u674e\u660e \u00b7 \u751f\u4ea7\u7ecf\u7406", "email": "pm.li@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 2, "name": "production_manager", "label": "\u751f\u4ea7\u7ecf\u7406"}, {"id": 11, "name": "approval_lead", "label": "\u5ba1\u6279\u8d1f\u8d23\u4eba"}]},
    {"id": 5, "username": "qe_wang", "display_name": "\u738b\u654f \u00b7 \u8d28\u91cf\u5de5\u7a0b\u5e08", "email": "qe.wang@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 4, "name": "quality_engineer", "label": "\u8d28\u91cf\u5de5\u7a0b\u5e08"}]},
    {"id": 6, "username": "mm_zhou", "display_name": "\u5468\u5f3a \u00b7 \u8bbe\u5907\u7ef4\u62a4\u7ecf\u7406", "email": "mm.zhou@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 5, "name": "maintenance_manager", "label": "\u8bbe\u5907\u7ef4\u62a4\u7ecf\u7406"}]},
    {"id": 7, "username": "me_sun", "display_name": "\u5b59\u6d69 \u00b7 \u7ef4\u4fee\u5de5\u7a0b\u5e08", "email": "me.sun@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 6, "name": "maintenance_engineer", "label": "\u7ef4\u4fee\u5de5\u7a0b\u5e08"}]},
    {"id": 8, "username": "pe_huang", "display_name": "\u9ec4\u5a77 \u00b7 \u5de5\u827a\u5de5\u7a0b\u5e08", "email": "pe.huang@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 7, "name": "process_engineer", "label": "\u5de5\u827a\u5de5\u7a0b\u5e08"}]},
    {"id": 9, "username": "scm_liu", "display_name": "\u5218\u6d0b \u00b7 \u4f9b\u5e94\u94fe\u7ecf\u7406", "email": "scm.liu@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 8, "name": "supply_chain_manager", "label": "\u4f9b\u5e94\u94fe\u7ecf\u7406"}]},
    {"id": 10, "username": "wh_feng", "display_name": "\u51af\u5b87 \u00b7 \u4ed3\u50a8\u64cd\u4f5c\u5458", "email": "wh.feng@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 9, "name": "warehouse_operator", "label": "\u4ed3\u50a8\u64cd\u4f5c\u5458"}]},
    {"id": 11, "username": "ds_he", "display_name": "\u4f55\u9759 \u00b7 \u6570\u636e\u4e13\u5458", "email": "ds.he@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 10, "name": "data_steward", "label": "\u6570\u636e\u4e13\u5458"}]},
    {"id": 12, "username": "auditor_gu", "display_name": "\u987e\u5b89 \u00b7 \u5ba1\u8ba1\u89c2\u5bdf\u5458", "email": "auditor.gu@manufoundry.local", "is_active": True, "is_admin": False, "roles": [{"id": 12, "name": "viewer", "label": "\u53ea\u8bfb\u89c2\u5bdf\u5458"}]},
]

_MOCK_ROLES = _MOCK_ROLES + _EXTRA_MOCK_ROLES
_MOCK_USERS_ADMIN = _MOCK_USERS_ADMIN + _EXTRA_MOCK_USERS_ADMIN


def _hash_password(password: str) -> str:
    """Delegate to core.security so admin & auth share the same algorithm."""
    from app.core.security import hash_password
    return hash_password(password)


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── User CRUD ────────────────────────────────────────────

@router.get("/users")
async def list_users(user_ctx: dict = Depends(require_admin)):
    """用户列表."""
    async def _query(db):
        from app.models.relational import OrgUnit, Role, User, UserOrgMembership, UserRole
        tenant_id = current_tenant_id(user_ctx)
        result = await db.execute(select(User).where(User.tenant_id == tenant_id).order_by(User.id))
        users = result.scalars().all()
        out = []
        for u in users:
            roles_res = await db.execute(
                select(Role.id, Role.name, Role.label)
                .join(UserRole, UserRole.role_id == Role.id)
                .where(UserRole.user_id == u.id, UserRole.tenant_id == tenant_id, Role.tenant_id == tenant_id)
                .order_by(Role.id)
            )
            orgs_res = await db.execute(
                select(
                    OrgUnit.id,
                    OrgUnit.code,
                    OrgUnit.name,
                    OrgUnit.org_type,
                    UserOrgMembership.position_title,
                    UserOrgMembership.is_primary,
                )
                .join(UserOrgMembership, UserOrgMembership.org_unit_id == OrgUnit.id)
                .where(
                    UserOrgMembership.user_id == u.id,
                    UserOrgMembership.tenant_id == tenant_id,
                    OrgUnit.tenant_id == tenant_id,
                )
                .order_by(UserOrgMembership.is_primary.desc(), OrgUnit.sort_order, OrgUnit.id)
            )
            out.append({
                "id": u.id, "username": u.username, "display_name": u.display_name,
                "email": u.email, "is_active": u.is_active, "is_admin": u.is_admin,
                "roles": [{"id": r[0], "name": r[1], "label": r[2]} for r in roles_res.fetchall()],
                "org_units": [
                    {
                        "id": o[0],
                        "code": o[1],
                        "name": o[2],
                        "org_type": o[3],
                        "position_title": o[4],
                        "is_primary": o[5],
                    }
                    for o in orgs_res.fetchall()
                ],
            })
        return {"data": out}

    result = await _try_db(_query)
    return result or {"data": _MOCK_USERS_ADMIN}


@router.post("/users")
async def create_user(body: UserCreate, user_ctx: dict = Depends(require_admin)):
    """创建用户."""
    async def _query(db):
        from app.models.relational import OrgUnit, User, UserOrgMembership, UserRole
        tenant_id = current_tenant_id(user_ctx)
        existing = await db.scalar(select(User).where(User.username == body.username))
        if existing:
            raise HTTPException(400, "用户名已存在")
        user = User(
            tenant_id=tenant_id,
            username=body.username, display_name=body.display_name,
            email=body.email, hashed_password=_hash_password(body.password),
            is_admin=body.is_admin,
        )
        db.add(user)
        await db.flush()
        for rid in body.role_ids:
            db.add(UserRole(tenant_id=tenant_id, user_id=user.id, role_id=rid))
        org_unit_ids = list(dict.fromkeys(body.org_unit_ids))
        if body.primary_org_unit_id and body.primary_org_unit_id not in org_unit_ids:
            org_unit_ids.insert(0, body.primary_org_unit_id)
        if org_unit_ids:
            valid_org_ids = set((await db.execute(
                select(OrgUnit.id).where(OrgUnit.tenant_id == tenant_id, OrgUnit.id.in_(org_unit_ids))
            )).scalars().all())
            primary_id = body.primary_org_unit_id or org_unit_ids[0]
            for org_id in org_unit_ids:
                if org_id not in valid_org_ids:
                    continue
                db.add(UserOrgMembership(
                    tenant_id=tenant_id,
                    user_id=user.id,
                    org_unit_id=org_id,
                    position_title=body.position_title,
                    is_primary=org_id == primary_id,
                ))
        await db.commit()
        return {"id": user.id, "username": user.username}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"id": len(_MOCK_USERS_ADMIN) + 10, "username": body.username}


@router.put("/users/{user_id}")
async def update_user(user_id: int, body: UserUpdate, user_ctx: dict = Depends(require_admin)):
    """更新用户."""
    async def _query(db):
        from app.models.relational import OrgUnit, User, UserOrgMembership, UserRole
        tenant_id = current_tenant_id(user_ctx)
        user = await db.get(User, user_id)
        if not user or user.tenant_id != tenant_id:
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
                UserRole.__table__.delete().where(UserRole.user_id == user_id, UserRole.tenant_id == tenant_id)
            )
            for rid in body.role_ids:
                db.add(UserRole(tenant_id=tenant_id, user_id=user_id, role_id=rid))
        if body.org_unit_ids is not None:
            await db.execute(
                UserOrgMembership.__table__.delete().where(
                    UserOrgMembership.user_id == user_id,
                    UserOrgMembership.tenant_id == tenant_id,
                )
            )
            org_unit_ids = list(dict.fromkeys(body.org_unit_ids))
            if body.primary_org_unit_id and body.primary_org_unit_id not in org_unit_ids:
                org_unit_ids.insert(0, body.primary_org_unit_id)
            if org_unit_ids:
                valid_org_ids = set((await db.execute(
                    select(OrgUnit.id).where(OrgUnit.tenant_id == tenant_id, OrgUnit.id.in_(org_unit_ids))
                )).scalars().all())
                primary_id = body.primary_org_unit_id or org_unit_ids[0]
                for org_id in org_unit_ids:
                    if org_id not in valid_org_ids:
                        continue
                    db.add(UserOrgMembership(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        org_unit_id=org_id,
                        position_title=body.position_title,
                        is_primary=org_id == primary_id,
                    ))
        elif body.position_title is not None or body.primary_org_unit_id is not None:
            memberships = (await db.execute(select(UserOrgMembership).where(
                UserOrgMembership.user_id == user_id,
                UserOrgMembership.tenant_id == tenant_id,
            ))).scalars().all()
            for membership in memberships:
                if body.position_title is not None:
                    membership.position_title = body.position_title
                if body.primary_org_unit_id is not None:
                    membership.is_primary = membership.org_unit_id == body.primary_org_unit_id
        await db.commit()
        return {"id": user.id}

    result = await _try_db(_query)
    return result or {"id": user_id}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, user_ctx: dict = Depends(require_admin)):
    """删除用户."""
    async def _query(db):
        from app.models.relational import User, UserOrgMembership, UserRole
        tenant_id = current_tenant_id(user_ctx)
        user = await db.get(User, user_id)
        if not user or user.tenant_id != tenant_id:
            return None
        await db.execute(UserRole.__table__.delete().where(UserRole.user_id == user_id, UserRole.tenant_id == tenant_id))
        await db.execute(UserOrgMembership.__table__.delete().where(
            UserOrgMembership.user_id == user_id,
            UserOrgMembership.tenant_id == tenant_id,
        ))
        await db.delete(user)
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


# ── Role CRUD ────────────────────────────────────────────

# -- Organization CRUD -----------------------------------------------------

@router.get("/org-units")
async def list_org_units(user_ctx: dict = Depends(require_admin)):
    """List organization units used as the source of data-scope permissions."""
    async def _query(db):
        from app.models.relational import OrgUnit, UserOrgMembership
        from sqlalchemy import func as sa_func

        tenant_id = current_tenant_id(user_ctx)
        member_counts = dict((await db.execute(
            select(UserOrgMembership.org_unit_id, sa_func.count(UserOrgMembership.user_id))
            .where(UserOrgMembership.tenant_id == tenant_id)
            .group_by(UserOrgMembership.org_unit_id)
        )).all())
        orgs = (await db.execute(
            select(OrgUnit).where(OrgUnit.tenant_id == tenant_id).order_by(OrgUnit.sort_order, OrgUnit.id)
        )).scalars().all()
        return {
            "data": [
                {
                    "id": org.id,
                    "tenant_id": org.tenant_id,
                    "parent_id": org.parent_id,
                    "code": org.code,
                    "name": org.name,
                    "org_type": org.org_type,
                    "sort_order": org.sort_order,
                    "status": org.status,
                    "description": org.description,
                    "member_count": int(member_counts.get(org.id, 0)),
                }
                for org in orgs
            ]
        }

    result = await _try_db(_query)
    return result or {"data": []}


@router.post("/org-units")
async def create_org_unit(body: OrgUnitCreate, user_ctx: dict = Depends(require_admin)):
    """Create an organization unit."""
    async def _query(db):
        from app.models.relational import OrgUnit

        tenant_id = current_tenant_id(user_ctx)
        existing = await db.scalar(select(OrgUnit).where(OrgUnit.tenant_id == tenant_id, OrgUnit.code == body.code))
        if existing:
            raise HTTPException(400, "组织编码已存在")
        if body.parent_id is not None:
            parent = await db.get(OrgUnit, body.parent_id)
            if not parent or parent.tenant_id != tenant_id:
                raise HTTPException(400, "父级组织不存在")
        org = OrgUnit(tenant_id=tenant_id, **body.dict())
        db.add(org)
        await db.commit()
        await db.refresh(org)
        return {"id": org.id, "code": org.code}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"id": 0, "code": body.code}


@router.put("/org-units/{org_id}")
async def update_org_unit(org_id: int, body: OrgUnitUpdate, user_ctx: dict = Depends(require_admin)):
    """Update an organization unit."""
    async def _query(db):
        from app.models.relational import OrgUnit

        tenant_id = current_tenant_id(user_ctx)
        org = await db.get(OrgUnit, org_id)
        if not org or org.tenant_id != tenant_id:
            return None
        updates = body.dict(exclude_unset=True)
        if "parent_id" in updates and updates["parent_id"] is not None:
            if updates["parent_id"] == org_id:
                raise HTTPException(400, "父级组织不能是自己")
            parent = await db.get(OrgUnit, updates["parent_id"])
            if not parent or parent.tenant_id != tenant_id:
                raise HTTPException(400, "父级组织不存在")
        for key, value in updates.items():
            setattr(org, key, value)
        await db.commit()
        return {"id": org.id}

    result = await _try_db(_query)
    return result or {"id": org_id}


@router.delete("/org-units/{org_id}")
async def delete_org_unit(org_id: int, user_ctx: dict = Depends(require_admin)):
    """Delete an empty organization unit."""
    async def _query(db):
        from app.models.relational import OrgUnit, UserOrgMembership

        tenant_id = current_tenant_id(user_ctx)
        org = await db.get(OrgUnit, org_id)
        if not org or org.tenant_id != tenant_id:
            return None
        child = await db.scalar(select(OrgUnit.id).where(OrgUnit.parent_id == org_id, OrgUnit.tenant_id == tenant_id).limit(1))
        if child:
            raise HTTPException(400, "请先删除子组织")
        member = await db.scalar(select(UserOrgMembership.id).where(
            UserOrgMembership.org_unit_id == org_id,
            UserOrgMembership.tenant_id == tenant_id,
        ).limit(1))
        if member:
            raise HTTPException(400, "该组织仍有成员，不能删除")
        await db.delete(org)
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


@router.get("/roles")
async def list_roles(user_ctx: dict = Depends(require_admin)):
    """角色列表."""
    async def _query(db):
        from app.models.relational import Role, RolePermission
        tenant_id = current_tenant_id(user_ctx)
        result = await db.execute(select(Role).where(Role.tenant_id == tenant_id).order_by(Role.id))
        roles = result.scalars().all()
        out = []
        for r in roles:
            perms_res = await db.execute(
                select(RolePermission).where(RolePermission.role_id == r.id, RolePermission.tenant_id == tenant_id)
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
async def create_role(body: RoleCreate, user_ctx: dict = Depends(require_admin)):
    """创建角色."""
    async def _query(db):
        from app.models.relational import Role
        tenant_id = current_tenant_id(user_ctx)
        role = Role(tenant_id=tenant_id, name=body.name, label=body.label, description=body.description)
        db.add(role)
        await db.commit()
        await db.refresh(role)
        return {"id": role.id, "name": role.name}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"id": len(_MOCK_ROLES) + 10, "name": body.name}


@router.put("/roles/{role_id}/permissions")
async def set_permissions(role_id: int, body: PermissionSet, user_ctx: dict = Depends(require_admin)):
    """设置角色权限."""
    async def _query(db):
        from app.models.relational import RolePermission
        tenant_id = current_tenant_id(user_ctx)
        target_role_id = body.role_id or role_id
        await db.execute(
            RolePermission.__table__.delete().where(RolePermission.role_id == target_role_id, RolePermission.tenant_id == tenant_id)
        )
        for p in body.permissions:
            db.add(RolePermission(
                tenant_id=tenant_id,
                role_id=target_role_id,
                resource_type=p.get("resource_type", "action"),
                resource_key=p.get("resource_key"),
                action=p.get("action", "view"),
            ))
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    return result or {"ok": True}


@router.delete("/roles/{role_id}")
async def delete_role(role_id: int, user_ctx: dict = Depends(require_admin)):
    """删除角色."""
    async def _query(db):
        from app.models.relational import Role
        tenant_id = current_tenant_id(user_ctx)
        role = await db.get(Role, role_id)
        if not role or role.tenant_id != tenant_id:
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
    user_id: Optional[int] = None,
    keyword: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(require_admin),
):
    """审计日志查询."""
    async def _query(db):
        from sqlalchemy import func as sa_func
        from app.models.relational import AuditLog
        tenant_id = current_tenant_id(user)
        filters = [AuditLog.tenant_id == tenant_id]
        if resource_type:
            filters.append(AuditLog.resource_type == resource_type)
        if action:
            filters.append(AuditLog.action == action)
        if user_id is not None:
            filters.append(AuditLog.user_id == user_id)
        if start_time:
            filters.append(AuditLog.timestamp >= start_time)
        if end_time:
            filters.append(AuditLog.timestamp <= end_time)
        if keyword:
            pattern = f"%{keyword.strip()}%"
            filters.append(or_(
                AuditLog.action.ilike(pattern),
                AuditLog.resource_type.ilike(pattern),
                AuditLog.old_values.ilike(pattern),
                AuditLog.new_values.ilike(pattern),
            ))

        q = select(AuditLog).where(*filters).order_by(AuditLog.timestamp.desc())
        count_q = select(sa_func.count()).select_from(q.subquery())
        total = await db.scalar(count_q)
        summary_q = (
            select(AuditLog.resource_type, sa_func.count())
            .where(*filters)
            .group_by(AuditLog.resource_type)
        )
        summary_result = await db.execute(summary_q)
        resource_counts = {row[0] or "unknown": row[1] for row in summary_result.fetchall()}
        action_q = (
            select(AuditLog.action, sa_func.count())
            .where(*filters)
            .group_by(AuditLog.action)
        )
        action_result = await db.execute(action_q)
        action_counts = {row[0] or "unknown": row[1] for row in action_result.fetchall()}
        q = q.offset((page - 1) * page_size).limit(page_size)
        result = await db.execute(q)
        logs = result.scalars().all()
        return {
            "data": [
                {
                    "id": l.id, "tenant_id": l.tenant_id, "user_id": l.user_id, "action": l.action,
                    "resource_type": l.resource_type, "resource_id": l.resource_id,
                    "old_values": l.old_values, "new_values": l.new_values,
                    "timestamp": l.timestamp.isoformat() if l.timestamp else None,
                }
                for l in logs
            ],
            "total": total, "page": page, "page_size": page_size,
            "summary": {
                "resource_counts": resource_counts,
                "action_counts": action_counts,
            },
        }

    result = await _try_db(_query)
    return result or {"data": [], "total": 0, "page": page, "page_size": page_size, "summary": {"resource_counts": {}, "action_counts": {}}}
