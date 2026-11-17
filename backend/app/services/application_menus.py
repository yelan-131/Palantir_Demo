"""Application menu invariants shared by menu and application configuration APIs."""
import hashlib
import json
from fastapi import HTTPException
from sqlalchemy import select, update
from app.models.relational import Application, ApplicationMenuNode


async def lock_application(db, tenant_id, application_id):
    if db.bind.dialect.name == "sqlite":
        # SQLite ignores FOR UPDATE. Acquire its write lock before reading a token;
        # pin updated_at so onupdate does not change the token being verified.
        await db.execute(update(Application).where(
            Application.id == application_id, Application.tenant_id == tenant_id,
        ).values(id=Application.id, updated_at=Application.updated_at))
    app = await db.scalar(select(Application).where(
        Application.id == application_id, Application.tenant_id == tenant_id,
    ).with_for_update().execution_options(populate_existing=True))
    if app is None:
        raise HTTPException(404, "Application not found")
    return app


async def menu_nodes(db, app):
    return list((await db.scalars(select(ApplicationMenuNode).where(
        ApplicationMenuNode.application_id == app.id,
        ApplicationMenuNode.tenant_id == app.tenant_id,
    ).execution_options(populate_existing=True))).all())


def validate_tree(parents):
    for node_id in parents:
        visited = set()
        parent_id = node_id
        while parent_id is not None:
            if parent_id in visited:
                raise HTTPException(422, "菜单不能引用自身或形成循环")
            if parent_id not in parents:
                raise HTTPException(422, "父菜单必须属于当前应用")
            visited.add(parent_id)
            parent_id = parents[parent_id]


async def validate_parent(db, app, parent_id, node_id=None):
    nodes = await menu_nodes(db, app)
    parents = {node.id: node.parent_id for node in nodes}
    if parent_id is not None and parent_id not in parents:
        raise HTTPException(422, "父菜单必须属于当前应用")
    parents[node_id if node_id is not None else 0] = parent_id
    validate_tree(parents)


async def set_application_default(db, app, route):
    """The application route is authoritative; mark at most one matching menu."""
    nodes = await menu_nodes(db, app)
    matched = False
    for node in sorted(nodes, key=lambda item: (item.sort_order, item.id)):
        node.default_entry = bool(not matched and route != "/" and node.visible and node.route_path == route)
        matched = matched or node.default_entry
    app.default_route = route


async def sync_menu_default(db, app, node, was_default=False):
    if node.default_entry and node.visible:
        if not node.route_path:
            raise HTTPException(422, "默认入口必须指向可打开的页面")
        route = node.route_path
        # Preserve the explicitly chosen entry when multiple menus share a route.
        nodes = await menu_nodes(db, app)
        for other in nodes:
            other.default_entry = other.id == node.id
        app.default_route = route
    elif was_default:
        node.default_entry = False
        await set_application_default(db, app, "/")
    else:
        node.default_entry = False


def edit_token(values):
    return hashlib.sha256(json.dumps(values, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


def application_edit_token(app):
    return edit_token({key: getattr(app, key) for key in (
        "id", "name", "code", "description", "icon", "default_route", "sort_order", "status", "is_pinned",
    )})


def check_edit_token(expected, actual):
    if expected is not None and expected != actual:
        raise HTTPException(409, "配置已被其他编辑更新，您的修改尚未保存，请重新加载后核对")


def form_edit_token(form):
    return edit_token({key: getattr(form, key, None) for key in (
        "id", "name", "description", "model_id", "table_name", "storage_mode", "status", "config",
    )})
