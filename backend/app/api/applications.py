"""Application workspace APIs.

An application is a business workspace that owns a default route, a set of
menu entries, and role visibility. The API keeps a mock fallback so the demo
still works when the relational DB is not available.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db, require_admin
from app.config import settings
from app.core.audit import write_audit_log
from app.core.db import safe_db_call

router = APIRouter()
admin_router = APIRouter()


class ApplicationCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    icon: Optional[str] = None
    default_route: str = "/"
    sort_order: int = 0
    status: str = "published"
    is_pinned: bool = False


class ApplicationUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    default_route: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None
    is_pinned: Optional[bool] = None


class BindingUpdate(BaseModel):
    menu_ids: Optional[list[int]] = None
    role_ids: Optional[list[int]] = None


DEFAULT_MENUS = [
    {"id": 1001, "parent_id": None, "title": "生产态势", "icon": "DashboardOutlined", "route_path": "/dashboard", "sort_order": 10, "is_visible": True},
    {"id": 1002, "parent_id": None, "title": "预测性维护", "icon": "ToolOutlined", "route_path": "/maintenance", "sort_order": 20, "is_visible": True},
    {"id": 1003, "parent_id": None, "title": "质量分析", "icon": "SafetyCertificateOutlined", "route_path": "/quality", "sort_order": 30, "is_visible": True},
    {"id": 1004, "parent_id": None, "title": "供应链风险", "icon": "ShopOutlined", "route_path": "/supply-chain", "sort_order": 40, "is_visible": True},
    {"id": 1005, "parent_id": None, "title": "料号关系追踪", "icon": "SafetyCertificateOutlined", "route_path": "/program/quality-event", "sort_order": 35, "is_visible": True},
]

DEFAULT_APPLICATIONS = [
    {
        "id": 1, "name": "生产态势", "code": "production-dashboard", "description": "生产效率、OEE、产线告警和班次趋势的业务工作包。",
        "icon": "DashboardOutlined", "default_route": "/dashboard", "sort_order": 10, "status": "published", "is_pinned": True,
        "menu_routes": ["/dashboard"], "role_names": ["admin", "production_manager", "process_engineer", "viewer"],
    },
    {
        "id": 2, "name": "预测性维护", "code": "maintenance-analysis", "description": "设备健康总览、健康分析、故障预测和工单管理。",
        "icon": "ToolOutlined", "default_route": "/maintenance", "sort_order": 20, "status": "published", "is_pinned": True,
        "menu_routes": ["/maintenance"], "role_names": ["admin", "production_manager", "maintenance_manager", "maintenance_engineer", "viewer"],
    },
    {
        "id": 3, "name": "质量分析", "code": "quality-control", "description": "质量缺陷、检验批次、料号追踪和过程能力分析。",
        "icon": "SafetyCertificateOutlined", "default_route": "/quality", "sort_order": 30, "status": "published", "is_pinned": False,
        "menu_routes": ["/quality", "/program/quality-event"], "role_names": ["admin", "quality_inspector", "quality_engineer", "viewer"],
    },
    {
        "id": 4, "name": "供应链风险", "code": "supply-risk", "description": "供应商交付、库存水位、风险预警和替代方案。",
        "icon": "ShopOutlined", "default_route": "/supply-chain", "sort_order": 40, "status": "published", "is_pinned": False,
        "menu_routes": ["/supply-chain"], "role_names": ["admin", "production_manager", "supply_chain_manager", "warehouse_operator", "viewer"],
    },
]


def _mock_role_names(user: dict) -> list[str]:
    if user.get("is_admin") or user.get("sub") == "admin":
        return ["admin"]
    if user.get("sub") == "lisi":
        return ["quality_inspector"]
    if user.get("sub") == "zhangsan":
        return ["production_manager"]
    return []


async def _role_names_for_user(db: AsyncSession, user: dict) -> list[str]:
    if user.get("is_admin"):
        return ["admin"]
    uid = user.get("uid")
    if not uid:
        return _mock_role_names(user)
    try:
        from app.models.relational import Role, UserRole
        tenant_id = current_tenant_id(user)
        result = await db.execute(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == uid, UserRole.tenant_id == tenant_id, Role.tenant_id == tenant_id)
        )
        names = [r[0] for r in result.fetchall()]
        return names or _mock_role_names(user)
    except Exception:
        return _mock_role_names(user)


async def _user_can_access_application(db: AsyncSession, user: dict, app_id: int) -> bool:
    if user.get("is_admin"):
        return True
    role_names = await _role_names_for_user(db, user)
    if not role_names:
        return False
    from app.models.relational import ApplicationRole, Role
    tenant_id = current_tenant_id(user)

    allowed_role_id = await db.scalar(
        select(Role.id)
        .join(ApplicationRole, ApplicationRole.role_id == Role.id)
        .where(
            ApplicationRole.application_id == app_id,
            ApplicationRole.tenant_id == tenant_id,
            Role.tenant_id == tenant_id,
            Role.name.in_(role_names),
        )
        .limit(1)
    )
    return allowed_role_id is not None


def _menu_tree(items: list[dict]) -> list[dict]:
    nodes: dict[int, dict] = {}
    roots: list[dict] = []
    for item in sorted(items, key=lambda x: x.get("sort_order", 0)):
        node = {**item, "children": []}
        nodes[int(item["id"])] = node
    for item in sorted(items, key=lambda x: x.get("sort_order", 0)):
        node = nodes[int(item["id"])]
        parent_id = item.get("parent_id")
        if parent_id and parent_id in nodes:
            nodes[parent_id]["children"].append(node)
        else:
            roots.append(node)
    for node in nodes.values():
        if not node["children"]:
            node.pop("children", None)
    return roots


def _platform_menu_payload(node) -> dict:
    return {
        "id": node.id,
        "parent_id": node.parent_id,
        "title": node.title,
        "icon": node.icon,
        "route_path": node.route_path or (f"/dynamic/{node.form_id}" if node.form_id else ""),
        "sort_order": node.sort_order,
        "is_visible": node.visible,
        "is_default": node.default_entry,
        "form_id": node.form_id,
    }


def _mock_menu_by_route(route: str) -> dict | None:
    return next((m for m in DEFAULT_MENUS if m["route_path"] == route), None)


def _mock_application_payload(app: dict, include_bindings: bool = False) -> dict:
    menus = [_mock_menu_by_route(route) for route in app["menu_routes"]]
    menus = [m for m in menus if m]
    payload = {k: app[k] for k in ["id", "name", "code", "description", "icon", "default_route", "sort_order", "status", "is_pinned"]}
    if include_bindings:
        payload["menus"] = menus
        role_ids = {"admin": 1, "production_manager": 2, "quality_inspector": 3}
        role_labels = {"admin": "平台管理员", "production_manager": "生产经理", "quality_inspector": "质量工程师"}
        payload["roles"] = [
            {"id": role_ids.get(name, idx + 100), "name": name, "label": role_labels.get(name, name)}
            for idx, name in enumerate(app["role_names"])
        ]
    return payload


def _mock_visible_apps(user: dict) -> list[dict]:
    if user.get("is_admin") or user.get("_anonymous"):
        return [_mock_application_payload(a) for a in DEFAULT_APPLICATIONS if a["status"] == "published"]
    role_names = set(_mock_role_names(user))
    if not role_names:
        return [_mock_application_payload(a) for a in DEFAULT_APPLICATIONS if a["status"] == "published"]
    return [
        _mock_application_payload(a)
        for a in DEFAULT_APPLICATIONS
        if a["status"] == "published" and role_names.intersection(a["role_names"])
    ]


async def _ensure_default_seed(db: AsyncSession, tenant_id: int = 1) -> None:
    from app.models.relational import Application, ApplicationMenu, ApplicationRole, MenuItem, Role, Tenant

    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        db.add(Tenant(id=tenant_id, name="Default Tenant", slug="default"))
        await db.flush()

    existing = await db.scalar(select(Application.id).where(Application.tenant_id == tenant_id).limit(1))
    if existing:
        return

    db_menus: dict[str, MenuItem] = {}
    for menu in DEFAULT_MENUS:
        item = await db.scalar(select(MenuItem).where(MenuItem.route_path == menu["route_path"], MenuItem.tenant_id == tenant_id))
        if item is None:
            item = MenuItem(
                tenant_id=tenant_id,
                parent_id=None,
                title=menu["title"],
                icon=menu["icon"],
                route_path=menu["route_path"],
                sort_order=menu["sort_order"],
                is_visible=True,
            )
            db.add(item)
            await db.flush()
        db_menus[menu["route_path"]] = item

    roles = (await db.execute(select(Role).where(Role.tenant_id == tenant_id))).scalars().all()
    role_by_name = {role.name: role for role in roles}

    for app_cfg in DEFAULT_APPLICATIONS:
        app = Application(
            tenant_id=tenant_id,
            name=app_cfg["name"],
            code=app_cfg["code"],
            description=app_cfg["description"],
            icon=app_cfg["icon"],
            default_route=app_cfg["default_route"],
            sort_order=app_cfg["sort_order"],
            status=app_cfg["status"],
            is_pinned=app_cfg["is_pinned"],
        )
        db.add(app)
        await db.flush()
        for idx, route in enumerate(app_cfg["menu_routes"]):
            menu = db_menus.get(route)
            if menu:
                db.add(ApplicationMenu(tenant_id=tenant_id, application_id=app.id, menu_id=menu.id, sort_order=idx, is_default=route == app.default_route))
        for role_name in app_cfg["role_names"]:
            role = role_by_name.get(role_name)
            if role:
                db.add(ApplicationRole(tenant_id=tenant_id, application_id=app.id, role_id=role.id))
    await db.commit()


async def _application_to_dict(db: AsyncSession, app, include_bindings: bool = False) -> dict:
    from app.models.relational import ApplicationMenu, ApplicationRole, MenuItem, Role

    payload = {
        "id": app.id,
        "name": app.name,
        "code": app.code,
        "description": app.description,
        "icon": app.icon,
        "default_route": app.default_route,
        "sort_order": app.sort_order,
        "status": app.status,
        "is_pinned": app.is_pinned,
    }
    if include_bindings:
        tenant_id = app.tenant_id
        menu_rows = await db.execute(
            select(MenuItem, ApplicationMenu)
            .join(ApplicationMenu, ApplicationMenu.menu_id == MenuItem.id)
            .where(ApplicationMenu.application_id == app.id, ApplicationMenu.tenant_id == tenant_id, MenuItem.tenant_id == tenant_id)
            .order_by(ApplicationMenu.sort_order, MenuItem.sort_order)
        )
        payload["menus"] = [
            {
                "id": menu.id,
                "parent_id": menu.parent_id,
                "title": menu.title,
                "icon": menu.icon,
                "route_path": menu.route_path,
                "sort_order": binding.sort_order,
                "is_visible": menu.is_visible,
                "is_default": binding.is_default,
            }
            for menu, binding in menu_rows.fetchall()
        ]
        role_rows = await db.execute(
            select(Role)
            .join(ApplicationRole, ApplicationRole.role_id == Role.id)
            .where(ApplicationRole.application_id == app.id, ApplicationRole.tenant_id == tenant_id, Role.tenant_id == tenant_id)
            .order_by(Role.id)
        )
        payload["roles"] = [
            {"id": role.id, "name": role.name, "label": role.label}
            for role in role_rows.scalars().all()
        ]
    return payload


@router.get("")
async def list_applications(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    async def _query(session):
        from app.models.relational import Application, ApplicationRole, Role

        tenant_id = current_tenant_id(user)
        await _ensure_default_seed(session, tenant_id)
        role_names = await _role_names_for_user(session, user)
        query = select(Application).where(Application.status == "published", Application.tenant_id == tenant_id).order_by(Application.sort_order, Application.id)
        if not user.get("is_admin"):
            if not role_names:
                return {"data": []}
            query = (
                query.join(ApplicationRole, ApplicationRole.application_id == Application.id)
                .where(ApplicationRole.role_id.in_(
                    select(Role.id).where(Role.name.in_(role_names), Role.tenant_id == tenant_id)
                ))
                .where(ApplicationRole.tenant_id == tenant_id)
                .distinct()
            )
        apps = (await session.execute(query)).scalars().all()
        return {"data": [await _application_to_dict(session, app) for app in apps]}

    result = await safe_db_call(_query)
    if result is None and settings.IS_PRODUCTION:
        raise HTTPException(503, "Applications database unavailable")
    return result or {"data": _mock_visible_apps(user)}


@router.get("/{app_id}/menus")
async def list_application_menus(app_id: int, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    async def _query(session):
        from app.models.relational import Application, ApplicationMenu, ApplicationMenuNode, MenuItem

        tenant_id = current_tenant_id(user)
        await _ensure_default_seed(session, tenant_id)
        app = await session.get(Application, app_id)
        if not app or app.tenant_id != tenant_id or app.status != "published":
            raise HTTPException(404, "Application not found")
        if not await _user_can_access_application(session, user, app_id):
            raise HTTPException(403, "Application access denied")
        platform_nodes = (await session.execute(
            select(ApplicationMenuNode)
            .where(ApplicationMenuNode.application_id == app_id, ApplicationMenuNode.tenant_id == tenant_id, ApplicationMenuNode.visible.is_(True))
            .order_by(ApplicationMenuNode.sort_order, ApplicationMenuNode.id)
        )).scalars().all()
        if platform_nodes:
            return {"data": _menu_tree([_platform_menu_payload(node) for node in platform_nodes])}
        rows = await session.execute(
            select(MenuItem, ApplicationMenu)
            .join(ApplicationMenu, ApplicationMenu.menu_id == MenuItem.id)
            .where(ApplicationMenu.application_id == app_id, ApplicationMenu.tenant_id == tenant_id, MenuItem.tenant_id == tenant_id, MenuItem.is_visible.is_(True))
            .order_by(ApplicationMenu.sort_order, MenuItem.sort_order)
        )
        items = [
            {
                "id": menu.id,
                "parent_id": menu.parent_id,
                "title": menu.title,
                "icon": menu.icon,
                "route_path": menu.route_path,
                "sort_order": binding.sort_order,
                "is_visible": menu.is_visible,
                "is_default": binding.is_default,
            }
            for menu, binding in rows.fetchall()
        ]
        return {"data": _menu_tree(items)}

    result = await safe_db_call(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Application menu database unavailable")
    app = next((a for a in DEFAULT_APPLICATIONS if a["id"] == app_id), None)
    if not app:
        raise HTTPException(404, "Application not found")
    menus = [_mock_menu_by_route(route) for route in app["menu_routes"]]
    return {"data": _menu_tree([m for m in menus if m])}


@router.get("/{app_id}")
async def get_application(app_id: int, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    async def _query(session):
        from app.models.relational import Application

        tenant_id = current_tenant_id(user)
        await _ensure_default_seed(session, tenant_id)
        app = await session.get(Application, app_id)
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(404, "Application not found")
        if not user.get("is_admin") and app.status != "published":
            raise HTTPException(404, "Application not found")
        if not await _user_can_access_application(session, user, app_id):
            raise HTTPException(403, "Application access denied")
        return {"data": await _application_to_dict(session, app, include_bindings=True)}

    result = await safe_db_call(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Application database unavailable")
    app = next((a for a in DEFAULT_APPLICATIONS if a["id"] == app_id), None)
    if not app:
        raise HTTPException(404, "Application not found")
    return {"data": _mock_application_payload(app, include_bindings=True)}


@admin_router.get("/applications")
async def admin_list_applications(user: dict = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    async def _query(session):
        from app.models.relational import Application

        tenant_id = current_tenant_id(user)
        await _ensure_default_seed(session, tenant_id)
        apps = (await session.execute(select(Application).where(Application.tenant_id == tenant_id).order_by(Application.sort_order, Application.id))).scalars().all()
        return {"data": [await _application_to_dict(session, app, include_bindings=True) for app in apps]}

    result = await safe_db_call(_query)
    if result is None and settings.IS_PRODUCTION:
        raise HTTPException(503, "Applications database unavailable")
    return result or {"data": [_mock_application_payload(app, include_bindings=True) for app in DEFAULT_APPLICATIONS]}


@admin_router.post("/applications")
async def admin_create_application(body: ApplicationCreate, user: dict = Depends(require_admin)):
    async def _query(db):
        from app.models.relational import Application

        tenant_id = current_tenant_id(user)
        app = Application(tenant_id=tenant_id, **body.dict())
        db.add(app)
        await db.commit()
        await db.refresh(app)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="application",
            resource_id=app.id,
            new_values=body.dict(),
        )
        return {"data": await _application_to_dict(db, app, include_bindings=True)}

    result = await safe_db_call(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Application database unavailable")
    return {"data": {**body.dict(), "id": max(a["id"] for a in DEFAULT_APPLICATIONS) + 1, "menus": [], "roles": []}}


@admin_router.put("/applications/{app_id}")
async def admin_update_application(app_id: int, body: ApplicationUpdate, user: dict = Depends(require_admin)):
    async def _query(db):
        from app.models.relational import Application

        tenant_id = current_tenant_id(user)
        app = await db.get(Application, app_id)
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(404, "Application not found")
        old_values = await _application_to_dict(db, app, include_bindings=False)
        for key, value in body.dict(exclude_unset=True).items():
            setattr(app, key, value)
        await db.commit()
        await db.refresh(app)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="update",
            resource_type="application",
            resource_id=app.id,
            old_values=old_values,
            new_values=body.dict(exclude_unset=True),
        )
        return {"data": await _application_to_dict(db, app, include_bindings=True)}

    result = await safe_db_call(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Application database unavailable")
    raise HTTPException(404, "Application not found")


@admin_router.delete("/applications/{app_id}")
async def admin_delete_application(app_id: int, user: dict = Depends(require_admin)):
    async def _query(db):
        from app.models.relational import Application

        tenant_id = current_tenant_id(user)
        app = await db.get(Application, app_id)
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(404, "Application not found")
        await db.delete(app)
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="delete",
            resource_type="application",
            resource_id=app_id,
        )
        return {"ok": True}

    result = await safe_db_call(_query)
    if result is None and settings.IS_PRODUCTION:
        raise HTTPException(503, "Application database unavailable")
    return result or {"ok": True}


@admin_router.put("/applications/{app_id}/bindings")
async def admin_update_application_bindings(app_id: int, body: BindingUpdate, user: dict = Depends(require_admin)):
    async def _query(db):
        from app.models.relational import Application, ApplicationMenu, ApplicationRole

        tenant_id = current_tenant_id(user)
        app = await db.get(Application, app_id)
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(404, "Application not found")
        if body.menu_ids is not None:
            await db.execute(delete(ApplicationMenu).where(ApplicationMenu.application_id == app_id, ApplicationMenu.tenant_id == tenant_id))
            for idx, menu_id in enumerate(body.menu_ids):
                db.add(ApplicationMenu(tenant_id=tenant_id, application_id=app_id, menu_id=menu_id, sort_order=idx, is_default=idx == 0))
        if body.role_ids is not None:
            await db.execute(delete(ApplicationRole).where(ApplicationRole.application_id == app_id, ApplicationRole.tenant_id == tenant_id))
            for role_id in body.role_ids:
                db.add(ApplicationRole(tenant_id=tenant_id, application_id=app_id, role_id=role_id))
        await db.commit()
        await db.refresh(app)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="update_bindings",
            resource_type="application",
            resource_id=app_id,
            new_values=body.dict(exclude_unset=True),
        )
        return {"data": await _application_to_dict(db, app, include_bindings=True)}

    result = await safe_db_call(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Application database unavailable")
    raise HTTPException(404, "Application not found")
