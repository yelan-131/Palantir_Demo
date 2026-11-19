"""Tenant-local snapshots of application and menu structure."""
from collections import defaultdict
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.audit import write_audit_log
from app.core.principal import current_user_id
from app.models.relational import Application, ApplicationMenuNode, ComponentPage, Form, SystemSetting
from app.services.application_menu_nodes import _ensure_application_form_binding
from app.services.application_menus import lock_application, menu_nodes, require_group_parent, validate_tree
from app.services.applications import ApplicationCreate, stage_application
from app.services.field_uniqueness import lock


def _prefix(tenant_id):
    return f"application-template:{tenant_id}:"


def _summary(row):
    app = row.value["application"]
    menus = row.value["menus"]
    return {
        "id": row.id,
        "kind": "application",
        "name": app["name"],
        "description": app["description"] or "",
        "icon": app["icon"],
        "category": "general",
        "is_public": False,
        "config": {
            "menus": [node["title"] for node in menus],
            "forms": sorted({node["form_id"] for node in menus if node["form_id"] is not None}),
            "pages": sorted({node["route_path"] for node in menus if node["node_type"] == "page" and node["route_path"]}),
        },
    }


async def list_application_templates(db, tenant_id):
    rows = await db.scalars(select(SystemSetting).where(SystemSetting.key.startswith(_prefix(tenant_id)))
                            .order_by(SystemSetting.updated_at.desc(), SystemSetting.id.desc()))
    return [_summary(row) for row in rows]


async def application_template_snapshot(db, app):
    nodes = sorted(await menu_nodes(db, app), key=lambda node: (node.sort_order, node.id))
    validate_tree({node.id: node.parent_id for node in nodes})
    attributes = ("id", "parent_id", "node_type", "title", "icon", "form_id", "route_path", "visible", "default_entry", "sort_order")
    return {
        "application": {key: getattr(app, key) for key in ("name", "description", "icon", "default_route")},
        "menus": [{**{key: getattr(node, key) for key in attributes},
                   "config": {"description": (node.config or {}).get("description", "")}} for node in nodes],
    }


async def save_application_template(db, tenant_id, application_id):
    await lock(db, tenant_id)
    app = await lock_application(db, tenant_id, application_id)
    snapshot = await application_template_snapshot(db, app)
    key = f"{_prefix(tenant_id)}{application_id}:{app.created_at.isoformat()}"
    row = await db.scalar(select(SystemSetting).where(SystemSetting.key == key))
    if row is None:
        row = SystemSetting(key=key, value=snapshot, description="应用结构模板")
        db.add(row)
    else:
        row.value = snapshot
    await db.flush()
    result = _summary(row)
    await db.commit()
    return result


async def get_application_template(db, tenant_id, template_id):
    row = await db.scalar(select(SystemSetting).where(
        SystemSetting.id == template_id, SystemSetting.key.startswith(_prefix(tenant_id)),
    ))
    if row is None:
        raise HTTPException(404, "应用模板不存在")
    return row.value


async def validate_template_references(db, tenant_id, menus):
    validate_tree({node["id"]: node["parent_id"] for node in menus})
    groups = {node["id"] for node in menus if node["node_type"] == "group"}
    for node in menus:
        require_group_parent(node["parent_id"], groups)
        if node["id"] in groups and node["default_entry"]:
            raise HTTPException(422, "菜单分组不能设为默认入口")
    form_ids = {node["form_id"] for node in menus if node["form_id"] is not None}
    if form_ids and form_ids != set(await db.scalars(select(Form.id).where(Form.id.in_(form_ids), Form.tenant_id == tenant_id))):
        raise HTTPException(409, "模板引用的表单已不存在，请更新模板")
    page_codes = {(node["route_path"] or "").removeprefix("/pages/") for node in menus if node["node_type"] == "page"}
    if page_codes and page_codes != set(await db.scalars(select(ComponentPage.code).where(
        ComponentPage.code.in_(page_codes), ComponentPage.tenant_id == tenant_id,
    ))):
        raise HTTPException(409, "模板引用的页面已不存在，请更新模板")
    return form_ids


async def instantiate_application_template(db, tenant_id, template_id, user):
    await lock(db, tenant_id)
    snapshot = await get_application_template(db, tenant_id, template_id)
    menus = snapshot["menus"]
    form_ids = await validate_template_references(db, tenant_id, menus)
    last_order = await db.scalar(select(func.max(Application.sort_order)).where(Application.tenant_id == tenant_id))
    body = ApplicationCreate(**snapshot["application"], code=f"app-template-{uuid4().hex}",
                             status="draft", sort_order=(last_order or 0) + 1)
    app = await stage_application(db, body, tenant_id)
    children = defaultdict(list)
    for node in menus:
        children[node["parent_id"]].append(node)
    pending = [(node, None) for node in reversed(children[None])]
    while pending:
        source, parent_id = pending.pop()
        copied = ApplicationMenuNode(tenant_id=tenant_id, application_id=app.id, parent_id=parent_id, **{
            key: value for key, value in source.items() if key not in {"id", "parent_id"}
        })
        db.add(copied)
        await db.flush()
        pending.extend((node, copied.id) for node in reversed(children[source["id"]]))
    for form_id in sorted(form_ids):
        await _ensure_application_form_binding(db, app.id, form_id)

    result = {"id": app.id, "name": app.name}
    await db.commit()
    await write_audit_log(tenant_id=tenant_id, user_id=current_user_id(user), action="create",
                          resource_type="application", resource_id=result["id"], new_values=body.model_dump())
    return result
