"""Application menu node writes shared by the form routes and AI menu tools."""
from __future__ import annotations

from typing import Optional
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.principal import current_tenant_id
from app.services.application_menus import lock_application, menu_nodes, validate_parent, sync_menu_default, set_application_default


MENU_NODE_PERMISSION_PREFIX = "menu_node:"


def _menu_node_permission_key(node_id: int) -> str:
    return f"{MENU_NODE_PERMISSION_PREFIX}{node_id}"


def _entry_role_ids_from_config(config: Optional[dict]) -> list[int]:
    if not isinstance(config, dict) or config.get("permission_mode") != "custom":
        return []
    role_ids = config.get("role_ids")
    if not isinstance(role_ids, list):
        return []
    normalized: list[int] = []
    for role_id in role_ids:
        try:
            value = int(role_id)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in normalized:
            normalized.append(value)
    return normalized


def _normalized_menu_node_config(config: Optional[dict]) -> dict:
    normalized = dict(config or {})
    if "permission_mode" in normalized or "role_ids" in normalized:
        normalized["permission_synced"] = True
    normalized.pop("permission_rules", None)
    return normalized


async def _sync_menu_node_entry_permissions(db: AsyncSession, node) -> None:
    """Persist menu entry role shortcuts into the unified role permission table."""
    from app.models.relational import RolePermission

    permission_key = _menu_node_permission_key(node.id)
    await db.execute(
        RolePermission.__table__.delete().where(
            RolePermission.tenant_id == node.tenant_id,
            RolePermission.resource_type == "menu",
            RolePermission.resource_key == permission_key,
        )
    )
    for role_id in _entry_role_ids_from_config(node.config):
        db.add(RolePermission(
            tenant_id=node.tenant_id,
            role_id=role_id,
            resource_type="menu",
            resource_key=permission_key,
            action="view",
            effect="allow",
            data_scope="all",
            condition_json={"managed_by": "application_menu_node", "node_id": node.id},
            priority=100,
            enabled=bool(node.visible),
        ))


async def _delete_menu_node_entry_permissions(db: AsyncSession, node) -> None:
    from app.models.relational import RolePermission

    await db.execute(
        RolePermission.__table__.delete().where(
            RolePermission.tenant_id == node.tenant_id,
            RolePermission.resource_type == "menu",
            RolePermission.resource_key == _menu_node_permission_key(node.id),
        )
    )


async def _ensure_application_form_binding(db: AsyncSession, application_id: int, form_id: int) -> None:
    from app.models.relational import ApplicationForm
    from app.models.relational import Form

    form = await db.get(Form, form_id)
    tenant_id = getattr(form, "tenant_id", None)
    existing = await db.scalar(
        select(ApplicationForm).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    )
    if existing:
        if not existing.enabled:
            existing.enabled = True
        return
    db.add(ApplicationForm(tenant_id=tenant_id, application_id=application_id, form_id=form_id))


async def _menu_node_payload(db: AsyncSession, node) -> dict:
    from app.models.relational import RolePermission

    config = dict(node.config or {})
    permission_key = _menu_node_permission_key(node.id)
    role_rows = (await db.execute(
        select(RolePermission.role_id).where(
            RolePermission.tenant_id == node.tenant_id,
            RolePermission.resource_type == "menu",
            RolePermission.resource_key == permission_key,
            RolePermission.effect == "allow",
            RolePermission.enabled.is_(True),
        )
    )).fetchall()
    synced_role_ids = sorted({int(row[0]) for row in role_rows})
    # Hiding an entry disables its grants, but must retain the configured role
    # selection so a refresh/edit/show cycle does not erase the policy.
    if not node.visible and config.get("permission_synced"):
        synced_role_ids = _entry_role_ids_from_config(config)
    if config.get("permission_synced"):
        config["role_ids"] = synced_role_ids
        config["permission_mode"] = "custom" if synced_role_ids else config.get("permission_mode", "inherit")
    elif synced_role_ids:
        config["role_ids"] = synced_role_ids
        config["permission_mode"] = "custom"
    payload = {
        "id": node.id,
        "application_id": node.application_id,
        "parent_id": node.parent_id,
        "node_type": node.node_type,
        "title": node.title,
        "icon": node.icon,
        "form_id": node.form_id,
        "page_code": (node.route_path or "").removeprefix("/pages/") if node.node_type == "page" else None,
        "route_path": node.route_path,
        "visible": node.visible,
        "default_entry": node.default_entry,
        "sort_order": node.sort_order,
        "config": config,
    }
    from app.services.application_menus import edit_token
    payload["edit_token"] = edit_token(payload)
    return payload


async def _set_menu_page_target(db: AsyncSession, user: dict, values: dict, node=None) -> None:
    from app.services.component_page_definitions import find_page, published

    page_code = values.pop("page_code", None)
    if page_code is not None:
        if values.get("form_id") is not None:
            raise HTTPException(422, "请选择一个菜单目标")
        page = await find_page(db, user, page_code)
        if await published(db, page) is None:
            raise HTTPException(409, "请先发布目标页面")
        values.update(node_type="page", form_id=None, route_path=f"/pages/{page.code}")
    elif values.get("node_type") == "page" or (
        node is not None and node.node_type == "page"
        and {"node_type", "form_id", "route_path"}.intersection(values)
    ):
        raise HTTPException(422, "请选择目标页面")


async def _create_application_menu_node(application_id, body, db, user, *, defer_commit=False):
    from app.models.relational import Application, ApplicationMenuNode, Form

    tenant_id = current_tenant_id(user)
    app = await lock_application(db, tenant_id, application_id)
    form = await db.get(Form, body.form_id) if body.form_id is not None else None
    if body.form_id is not None and (not form or form.tenant_id != tenant_id):
        raise HTTPException(404, "Form not found")
    await validate_parent(db, app, body.parent_id)

    values = body.model_dump()
    await _set_menu_page_target(db, user, values)
    values["config"] = _normalized_menu_node_config(values.get("config"))
    if values.get("form_id") and not values.get("route_path"):
        form_config = form.config or {}
        form_kind = str(form_config.get("assemblyKind") or form_config.get("kind") or form_config.get("type") or "").lower()
        values["route_path"] = (
            f"/program/{form.code}"
            if form_kind in {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}
            else f"/dynamic/{form.code}"
        )
    node = ApplicationMenuNode(tenant_id=tenant_id, application_id=application_id, **values)
    db.add(node)
    await db.flush()
    await sync_menu_default(db, app, node)
    await _sync_menu_node_entry_permissions(db, node)
    if node.form_id is not None:
        await _ensure_application_form_binding(db, application_id, node.form_id)
    if not defer_commit:
        await db.commit()
    await db.refresh(node)
    return {"data": await _menu_node_payload(db, node)}


async def _update_application_menu_node(application_id, node_id, body, db, user):
    from app.models.relational import ApplicationMenuNode, Form

    tenant_id = current_tenant_id(user)
    app = await lock_application(db, tenant_id, application_id)
    node = await db.get(ApplicationMenuNode, node_id)
    if not node or node.application_id != application_id or node.tenant_id != tenant_id:
        raise HTTPException(404, "Menu node not found")
    from app.services.application_menus import check_edit_token
    current = await _menu_node_payload(db, node)
    check_edit_token(body.expected_token, current["edit_token"])
    updates = body.model_dump(exclude_unset=True, exclude={"expected_token"})
    await _set_menu_page_target(db, user, updates, node)
    form = await db.get(Form, updates["form_id"]) if "form_id" in updates and updates["form_id"] is not None else None
    if "form_id" in updates and updates["form_id"] is not None and (not form or form.tenant_id != tenant_id):
        raise HTTPException(404, "Form not found")
    if "parent_id" in updates:
        await validate_parent(db, app, updates["parent_id"], node.id)
    was_default = node.default_entry
    if updates.get("form_id") and not updates.get("route_path"):
        form_config = form.config or {}
        form_kind = str(form_config.get("assemblyKind") or form_config.get("kind") or form_config.get("type") or "").lower()
        updates["route_path"] = (
            f"/program/{form.code}"
            if form_kind in {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}
            else f"/dynamic/{form.code}"
        )
    if "config" in updates:
        updates["config"] = _normalized_menu_node_config(updates.get("config"))
    for key, value in updates.items():
        setattr(node, key, value)
    await sync_menu_default(db, app, node, was_default)
    await _sync_menu_node_entry_permissions(db, node)
    if node.form_id is not None:
        await _ensure_application_form_binding(db, application_id, node.form_id)
    await db.commit()
    await db.refresh(node)
    return {"data": await _menu_node_payload(db, node)}


async def _delete_application_menu_node(application_id, node_id, db, user, *, defer_commit=False):
    from app.models.relational import ApplicationMenuNode

    tenant_id = current_tenant_id(user)
    app = await lock_application(db, tenant_id, application_id)
    node = await db.get(ApplicationMenuNode, node_id)
    if not node or node.application_id != application_id or node.tenant_id != tenant_id:
        raise HTTPException(404, "Menu node not found")
    nodes = await menu_nodes(db, app)
    siblings = [item for item in nodes if item.parent_id == node.parent_id and item.id != node.id]
    sort_order = max((item.sort_order for item in siblings), default=-1) + 1
    for child in sorted((item for item in nodes if item.parent_id == node.id), key=lambda item: (item.sort_order, item.id)):
        child.parent_id = node.parent_id
        child.sort_order = sort_order
        sort_order += 1
    if node.default_entry:
        await set_application_default(db, app, "/")
    await _delete_menu_node_entry_permissions(db, node)
    await db.delete(node)
    if not defer_commit:
        await db.commit()
    return {"ok": True}
