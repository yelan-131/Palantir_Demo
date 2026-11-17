"""Application CRUD shared by the application routes and AI application tools."""
from __future__ import annotations

from typing import Optional
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.principal import current_tenant_id, current_user_id
from app.core.audit import write_audit_log
from app.services.tenant_onboarding import assert_tenant_quota


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
    expected_token: Optional[str] = Field(default=None, max_length=64)
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    default_route: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None
    is_pinned: Optional[bool] = None


async def _application_to_dict(db: AsyncSession, app, include_bindings: bool = False) -> dict:
    from app.models.relational import ApplicationMenu, ApplicationRole, MenuItem, Role

    from app.services.application_menus import application_edit_token
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
    payload["edit_token"] = application_edit_token(app)
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


async def ensure_application_code_available(db, tenant_id, code, *, application_id=None):
    from app.models.relational import Application

    query = select(Application.id).where(Application.tenant_id == tenant_id, Application.code == code)
    if application_id is not None:
        query = query.where(Application.id != application_id)
    if await db.scalar(query) is not None:
        raise HTTPException(409, "Application code already exists")


async def get_tenant_application(db, tenant_id, application_id, *, for_update=False):
    from app.models.relational import Application

    if for_update:
        from app.services.application_menus import lock_application

        return await lock_application(db, tenant_id, application_id)
    app = await db.get(Application, application_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    return app


async def create_application(db, body: ApplicationCreate, user: dict):
    from app.models.relational import Application

    tenant_id = current_tenant_id(user)
    await assert_tenant_quota(db, tenant_id, "applications")
    await ensure_application_code_available(db, tenant_id, body.code)
    values = body.model_dump()
    app = Application(tenant_id=tenant_id, **values)
    db.add(app)
    await db.commit()
    await db.refresh(app)
    await write_audit_log(
        tenant_id=tenant_id, user_id=current_user_id(user), action="create",
        resource_type="application", resource_id=app.id, new_values=values,
    )
    return {"data": await _application_to_dict(db, app, include_bindings=True)}


async def update_application(db, app, body: ApplicationUpdate, user: dict):
    from app.services.application_menus import check_edit_token, set_application_default

    old_values = await _application_to_dict(db, app)
    check_edit_token(body.expected_token, old_values["edit_token"])
    values = body.model_dump(exclude_unset=True, exclude={"expected_token"})
    if "code" in values:
        await ensure_application_code_available(db, app.tenant_id, body.code, application_id=app.id)
    for key, value in values.items():
        setattr(app, key, value)
    if "default_route" in values:
        await set_application_default(db, app, body.default_route or "/")
    await db.commit()
    await db.refresh(app)
    await write_audit_log(
        tenant_id=app.tenant_id, user_id=current_user_id(user), action="update",
        resource_type="application", resource_id=app.id, old_values=old_values, new_values=values,
    )
    return {"data": await _application_to_dict(db, app, include_bindings=True)}


async def delete_application(db, app, user: dict):
    from app.services.application_menu_nodes import _delete_menu_node_entry_permissions
    from app.models.relational import ApplicationForm, ApplicationMenuNode

    tenant_id, app_id = app.tenant_id, app.id
    nodes = await db.scalars(select(ApplicationMenuNode).where(
        ApplicationMenuNode.tenant_id == tenant_id, ApplicationMenuNode.application_id == app_id,
    ))
    for node in nodes:
        await _delete_menu_node_entry_permissions(db, node)
    # A single DELETE removes both parents and children before FK validation.
    await db.execute(delete(ApplicationMenuNode).where(
        ApplicationMenuNode.tenant_id == tenant_id, ApplicationMenuNode.application_id == app_id,
    ))
    await db.execute(delete(ApplicationForm).where(
        ApplicationForm.tenant_id == tenant_id, ApplicationForm.application_id == app_id,
    ))
    await db.delete(app)
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id, user_id=current_user_id(user), action="delete",
        resource_type="application", resource_id=app_id,
    )
    return {"ok": True}
