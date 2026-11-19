"""Application CRUD shared by the application routes and AI application tools."""
from __future__ import annotations

from typing import Literal, Optional
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.principal import current_tenant_id, current_user_id
from app.core.audit import write_audit_log
from app.core.production_errors import coded_error
from app.services.tenant_onboarding import assert_tenant_quota


class ApplicationAccessGroup(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=50)
    roleIds: list[int] = Field(default_factory=list)


class ApplicationAccessSettings(BaseModel):
    role_ids: Optional[list[int]] = None
    access_groups: Optional[list[ApplicationAccessGroup]] = Field(default=None, max_length=20)

    @field_validator("access_groups")
    @classmethod
    def unique_access_group_ids(cls, groups):
        if groups is not None and len({group.id for group in groups}) != len(groups):
            raise ValueError("权限组编号不能重复")
        return groups


class ApplicationCreate(ApplicationAccessSettings):
    name: str
    code: str
    description: Optional[str] = None
    icon: Optional[str] = None
    default_route: str = "/"
    sort_order: int = 0
    status: Literal["draft"] = "draft"
    is_pinned: bool = False


class ApplicationUpdate(ApplicationAccessSettings):
    expected_token: Optional[str] = Field(default=None, max_length=64)
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    default_route: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[Literal["draft", "published", "active", "disabled"]] = None
    is_pinned: Optional[bool] = None


async def _application_to_dict(db: AsyncSession, app, include_bindings: bool = False) -> dict:
    from app.models.relational import ApplicationMenu, ApplicationRole, MenuItem, Role

    from app.services.application_menus import application_edit_token
    payload = {
        "id": app.id,
        "name": app.name,
        "code": app.code,
        "code_locked": application_code_locked(app),
        "description": app.description,
        "icon": app.icon,
        "default_route": app.default_route,
        "sort_order": app.sort_order,
        "status": app.status,
        "is_pinned": app.is_pinned,
    }
    tenant_id = app.tenant_id
    role_rows = await db.execute(
        select(Role)
        .join(ApplicationRole, ApplicationRole.role_id == Role.id)
        .where(ApplicationRole.application_id == app.id, ApplicationRole.tenant_id == tenant_id, Role.tenant_id == tenant_id)
        .order_by(Role.id)
    )
    roles = [
        {"id": role.id, "name": role.name, "label": role.label}
        for role in role_rows.scalars().all()
    ]
    payload["edit_token"] = application_edit_token(app, [role["id"] for role in roles])
    if include_bindings:
        payload["access_groups"] = effective_access_groups(app.access_groups, [role["id"] for role in roles])
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
        payload["roles"] = roles
    return payload


async def ensure_application_code_available(db, tenant_id, code, *, application_id=None):
    from app.models.relational import Application

    query = select(Application.id).where(Application.tenant_id == tenant_id, Application.code == code)
    if application_id is not None:
        query = query.where(Application.id != application_id)
    if await db.scalar(query) is not None:
        raise coded_error(409, "APPLICATION_CODE_CONFLICT", "Application code already exists")


def application_code_locked(app) -> bool:
    return app.code_locked or app.status in {"published", "active", "disabled"}


async def validate_application_code_change(db, app, code):
    if code == app.code:
        return
    if application_code_locked(app):
        raise HTTPException(409, "应用编码在首次发布后不可修改")
    await ensure_application_code_available(db, app.tenant_id, code, application_id=app.id)


async def get_tenant_application(db, tenant_id, application_id, *, for_update=False):
    from app.models.relational import Application

    if for_update:
        from app.services.application_menus import lock_application

        return await lock_application(db, tenant_id, application_id)
    app = await db.get(Application, application_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    return app


async def validate_tenant_roles(db, tenant_id, role_ids):
    from app.models.relational import Role

    role_ids = set(role_ids)
    valid_ids = set(await db.scalars(select(Role.id).where(
        Role.tenant_id == tenant_id, Role.id.in_(role_ids),
    )))
    if role_ids != valid_ids:
        raise coded_error(422, "APPLICATION_ROLES_INVALID", "所选角色不存在或不属于当前租户")
    return role_ids


async def replace_application_roles(db, app, role_ids):
    from app.models.relational import ApplicationRole

    role_ids = await validate_tenant_roles(db, app.tenant_id, role_ids)
    await db.execute(delete(ApplicationRole).where(
        ApplicationRole.application_id == app.id, ApplicationRole.tenant_id == app.tenant_id,
    ))
    db.add_all([
        ApplicationRole(tenant_id=app.tenant_id, application_id=app.id, role_id=role_id)
        for role_id in sorted(role_ids)
    ])
    if app.access_groups is not None:
        app.access_groups = effective_access_groups(app.access_groups, sorted(role_ids))


def effective_access_groups(groups, role_ids):
    """Keep group membership aligned with the authoritative application role bindings."""
    if groups is None:
        return [{"id": "default-access", "name": "默认权限组", "roleIds": role_ids}]
    allowed = set(role_ids)
    result = [
        {**group, "roleIds": list(dict.fromkeys(role_id for role_id in group["roleIds"] if role_id in allowed))}
        for group in groups
    ]
    grouped = {role_id for group in result for role_id in group["roleIds"]}
    missing = [role_id for role_id in role_ids if role_id not in grouped]
    if missing:
        if result:
            result[0]["roleIds"].extend(missing)
        else:
            return effective_access_groups(None, missing)
    return result


async def save_application_access(db, app, body):
    if body.access_groups is not None:
        app.access_groups = [group.model_dump() for group in body.access_groups]
        await replace_application_roles(db, app, {
            role_id for group in body.access_groups for role_id in group.roleIds
        })
    elif body.role_ids is not None:
        await replace_application_roles(db, app, body.role_ids)


async def stage_application(db, body: ApplicationCreate, tenant_id: int):
    from app.models.relational import Application

    await assert_tenant_quota(db, tenant_id, "applications")
    await ensure_application_code_available(db, tenant_id, body.code)
    app = Application(
        tenant_id=tenant_id,
        code_locked=body.status in {"published", "active", "disabled"},
        **body.model_dump(exclude={"role_ids", "access_groups"}),
    )
    db.add(app)
    await db.flush()
    if body.role_ids is not None or body.access_groups is not None:
        await save_application_access(db, app, body)
    return app


async def create_application(db, body: ApplicationCreate, user: dict):
    tenant_id = current_tenant_id(user)
    app = await stage_application(db, body, tenant_id)
    await db.commit()
    await db.refresh(app)
    await write_audit_log(
        tenant_id=tenant_id, user_id=current_user_id(user), action="create",
        resource_type="application", resource_id=app.id, new_values=body.model_dump(),
    )
    return {"data": await _application_to_dict(db, app, include_bindings=True)}


async def ordered_applications(db, tenant_id, *, for_update=False):
    from app.models.relational import Application

    query = select(Application).where(Application.tenant_id == tenant_id).order_by(Application.sort_order, Application.id)
    return list(await db.scalars(query.with_for_update() if for_update else query))


async def reorder_applications(db, tenant_id, expected, order, user):
    apps = await ordered_applications(db, tenant_id, for_update=True)
    by_id = {app.id: app for app in apps}
    if expected != list(by_id):
        raise HTTPException(409, "应用顺序已变化，请刷新后重试")
    if len(order) != len(by_id) or set(order) != set(by_id):
        raise HTTPException(422, "排序必须包含当前租户的全部应用")
    for position, app_id in enumerate(order, start=1):
        by_id[app_id].sort_order = position
    await db.commit()
    await write_audit_log(tenant_id=tenant_id, user_id=current_user_id(user), action="reorder",
                          resource_type="application", old_values={"order": expected}, new_values={"order": order})
    return {"data": [await _application_to_dict(db, by_id[app_id], include_bindings=True) for app_id in order]}


async def update_application(db, app, body: ApplicationUpdate, user: dict):
    from app.services.application_menus import check_edit_token, set_application_default

    old_values = await _application_to_dict(db, app, include_bindings=body.role_ids is not None or body.access_groups is not None)
    check_edit_token(body.expected_token, old_values["edit_token"])
    values = body.model_dump(exclude_unset=True, exclude={"expected_token"})
    if "code" in values:
        await validate_application_code_change(db, app, body.code)
    if "status" in values and body.status != app.status:
        allowed = {"draft": "published", "published": "disabled", "active": "disabled", "disabled": "published"}
        if body.status is None or body.status != allowed.get(app.status):
            raise coded_error(409, "APPLICATION_STATE_CONFLICT", "当前应用状态不支持该操作")
    code_was_locked = application_code_locked(app)
    for key, value in values.items():
        if key not in {"role_ids", "access_groups"}:
            setattr(app, key, value)
    app.code_locked = code_was_locked or application_code_locked(app)
    if "default_route" in values:
        await set_application_default(db, app, body.default_route or "/")
    await save_application_access(db, app, body)
    await db.commit()
    await db.refresh(app)
    await write_audit_log(
        tenant_id=app.tenant_id, user_id=current_user_id(user), action="update",
        resource_type="application", resource_id=app.id, old_values=old_values, new_values=values,
    )
    return {"data": await _application_to_dict(db, app, include_bindings=True)}


def require_deletable_application(app):
    if app.status != "draft" or application_code_locked(app):
        raise coded_error(409, "APPLICATION_STATE_CONFLICT", "只能删除未发布过的草稿应用")


async def delete_application(db, app, user: dict):
    from app.services.application_menu_nodes import _delete_menu_node_entry_permissions
    from app.services.application_menus import empty_menu_key
    from app.models.relational import ApplicationForm, ApplicationMenuNode, SystemSetting

    require_deletable_application(app)
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
    await db.execute(delete(SystemSetting).where(SystemSetting.key == empty_menu_key(app)))
    await db.delete(app)
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id, user_id=current_user_id(user), action="delete",
        resource_type="application", resource_id=app_id,
    )
    return {"ok": True}
