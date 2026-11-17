"""Menu writes available to AI after platform confirmation."""

import hashlib
import json
from typing import Annotated

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.core.principal import current_tenant_id, ensure_admin
from app.models.relational import Application, ApplicationMenuNode, Form
from app.services.field_uniqueness import lock


PositiveId = Annotated[int, Field(gt=0)]
MenuTitle = Annotated[str, Field(min_length=1, max_length=200)]
PageCode = Annotated[str, Field(min_length=1, max_length=100)]


class MenuRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    application_id: PositiveId


class CreateMenuGroup(MenuRequest):
    title: MenuTitle
    parent_id: PositiveId | None = None


class CreateMenuEntry(CreateMenuGroup):
    page_code: PageCode | None = None
    form_id: PositiveId | None = None
    visible: bool = True
    default_entry: bool = False

    @model_validator(mode="after")
    def check_target(self):
        if (self.page_code is None) == (self.form_id is None):
            raise ValueError("请选择一个菜单目标，使用 page_code 或 form_id")
        return self


class ExistingMenuNode(MenuRequest):
    node_id: PositiveId


class UpdateMenuEntry(ExistingMenuNode):
    title: MenuTitle | None = None
    page_code: PageCode | None = None
    visible: bool | None = None
    default_entry: bool | None = None

    @model_validator(mode="after")
    def check_changes(self):
        fields = self.model_fields_set - {"application_id", "node_id"}
        if not fields or any(getattr(self, field) is None for field in fields):
            raise ValueError("至少提供一项有效的菜单修改")
        return self


class ReorderMenu(ExistingMenuNode):
    parent_id: PositiveId | None = Field(description="目标分组 ID；null 表示应用根菜单")
    position: int = Field(ge=1, description="目标同级列表中的新位置，从 1 开始")


MENU_REQUESTS = {
    "menus.create_group": CreateMenuGroup,
    "menus.create_entry": CreateMenuEntry,
    "menus.update_entry": UpdateMenuEntry,
    "menus.reorder": ReorderMenu,
    "menus.delete_entry": ExistingMenuNode,
}

MENU_TOOL_DETAILS = {
    "menus.create_group": ("新建菜单分组", "在已有应用下新建菜单分组，可指定上级分组。先查询应用和菜单的真实 ID。"),
    "menus.create_entry": ("新建菜单入口", "将已发布页面或表单添加到应用根菜单或已有分组，使用 page_code 或 form_id。"),
    "menus.update_entry": ("编辑菜单节点", "按菜单节点 ID 改名、设置可见性或默认入口，也可将现有业务入口指向已发布的组件页面。"),
    "menus.reorder": ("移动与排序菜单", "移动菜单节点到指定分组或应用根菜单，并指定从 1 开始的同级位置。"),
    "menus.delete_entry": ("删除菜单节点", "删除应用下的菜单入口或分组。删除分组时，其直接子节点提升到原分组的同级。"),
}


def _path(nodes, node):
    titles = []
    visited = set()
    while node is not None:
        if node.id in visited:
            raise HTTPException(409, "菜单层级存在循环")
        visited.add(node.id)
        titles.append(node.title)
        node = nodes.get(node.parent_id)
    return " / ".join(reversed(titles))


def _siblings(nodes, parent_id, *, exclude=None):
    return [node for node in nodes.values() if node.parent_id == parent_id and node.id != exclude]


def _snapshot(operation, request, application, nodes, destination):
    state = [
        operation, request.model_dump(mode="json", exclude_unset=True),
        application.id, application.name, application.status, destination,
        [(node.id, node.parent_id, node.sort_order, node.node_type, node.title, node.form_id,
          node.route_path, node.visible, node.default_entry, node.config) for node in nodes.values()],
    ]
    return hashlib.sha256(json.dumps(state, sort_keys=True, default=str).encode()).hexdigest()


async def _entry_target(session, user, request, *, required_host_form_id=None):
    if request.page_code is not None:
        from app.services.component_page_definitions import bound_host, find_page, published

        page = await find_page(session, user, request.page_code)
        version = await published(session, page)
        if version is None:
            raise HTTPException(409, "请先发布目标页面")
        if required_host_form_id is not None:
            host = await bound_host(session, page)
            if not host or host.id != required_host_form_id:
                raise HTTPException(422, "请选择原表单绑定的组件页面，以保留原入口的表单访问校验")
        return version.get("title") or page.code, page.published_version

    from app.services.form_runtime import _latest_form_version

    tenant_id = current_tenant_id(user)
    form = await session.get(Form, request.form_id)
    if form is None or form.tenant_id != tenant_id:
        raise HTTPException(404, "找不到目标表单")
    version = await _latest_form_version(session, tenant_id, form.id)
    if version is None:
        raise HTTPException(409, "请先发布目标表单，或使用发布表单并挂载应用菜单工具")
    return form.name, version.id


async def execute_menu_tool(operation, session, *, user, payload, prepare=False):
    from app.services.application_menu_nodes import _create_application_menu_node, _delete_application_menu_node, _update_application_menu_node
    from app.services.form_schemas import MenuNodeCreate, MenuNodeUpdate

    ensure_admin(user)
    tenant_id = current_tenant_id(user)
    request = MENU_REQUESTS[operation].model_validate({
        key: value for key, value in payload.items() if key not in {"_menu_snapshot", "_preview"}
    })
    if not prepare:
        await lock(session, tenant_id)
    app_query = select(Application).where(Application.id == request.application_id, Application.tenant_id == tenant_id)
    app = await session.scalar(app_query if prepare else app_query.with_for_update())
    if app is None:
        raise HTTPException(404, "找不到目标应用")
    node_query = select(ApplicationMenuNode).where(
        ApplicationMenuNode.application_id == app.id,
        ApplicationMenuNode.tenant_id == tenant_id,
    ).order_by(ApplicationMenuNode.sort_order, ApplicationMenuNode.id)
    nodes = {node.id: node for node in await session.scalars(node_query if prepare else node_query.with_for_update())}
    node = nodes.get(request.node_id) if isinstance(request, ExistingMenuNode) else None
    if isinstance(request, ExistingMenuNode) and node is None:
        raise HTTPException(404, "找不到目标菜单节点")

    parent_id = request.parent_id if isinstance(request, (CreateMenuGroup, ReorderMenu)) else node.parent_id
    parent = nodes.get(parent_id)
    if parent_id is not None and (parent is None or parent.node_type != "group"):
        raise HTTPException(422, "请选择目标应用下的菜单分组")
    menu_path = _path(nodes, node or parent)
    preview = {"target": f"{app.name} / {menu_path}" if menu_path else app.name, "fields": {}}
    fields = preview["fields"]
    destination = None

    if isinstance(request, CreateMenuGroup):
        fields["菜单名称"] = request.title
        if isinstance(request, CreateMenuEntry):
            destination = await _entry_target(session, user, request)
            fields["入口目标"] = destination[0]
            fields.update({"显示入口": request.visible, "默认入口": request.default_entry})
    elif isinstance(request, UpdateMenuEntry):
        if request.page_code:
            if node.node_type not in {"page", "form"}:
                raise HTTPException(422, "请选择已有页面或表单入口")
            destination = await _entry_target(session, user, request, required_host_form_id=node.form_id)
            fields["入口目标"] = destination[0]
        if node.node_type == "group" and request.default_entry:
            raise HTTPException(422, "菜单分组不能设为默认入口")
        for key, label in {"title": "菜单名称", "visible": "显示入口", "default_entry": "默认入口"}.items():
            if key in request.model_fields_set:
                fields[label] = getattr(request, key)
    elif isinstance(request, ReorderMenu):
        ancestor = parent
        visited = {node.id}
        while ancestor is not None:
            if ancestor.id in visited:
                raise HTTPException(422, "菜单分组不能移动到自身或其下级")
            visited.add(ancestor.id)
            ancestor = nodes.get(ancestor.parent_id)
        siblings = _siblings(nodes, parent_id, exclude=node.id)
        if request.position > len(siblings) + 1:
            raise HTTPException(422, "目标位置超出同级菜单范围")
        fields.update({"目标分组": _path(nodes, parent) or "应用根菜单", "目标位置": request.position})
    else:
        children = _siblings(nodes, node.id)
        fields["提升至同级的子节点数"] = len(children)

    snapshot = _snapshot(operation, request, app, nodes, destination)
    if prepare:
        return {**request.model_dump(exclude_unset=True), "_preview": preview, "_menu_snapshot": snapshot}
    if payload.get("_menu_snapshot") != snapshot:
        raise HTTPException(409, "应用菜单已发生变化，请重新生成确认卡片")

    if isinstance(request, CreateMenuGroup):
        values = request.model_dump(exclude={"application_id"})
        values["node_type"] = "group"
        if isinstance(request, CreateMenuEntry):
            values["node_type"] = "page" if request.page_code else "form"
        values["sort_order"] = max((item.sort_order for item in _siblings(nodes, parent_id)), default=-1) + 1
        return (await _create_application_menu_node(app.id, MenuNodeCreate(**values), session, user))["data"]
    if isinstance(request, UpdateMenuEntry):
        changes = request.model_dump(exclude_unset=True, exclude={"application_id", "node_id"})
        return (await _update_application_menu_node(app.id, node.id, MenuNodeUpdate(**changes), session, user))["data"]
    if isinstance(request, ReorderMenu):
        if parent_id != node.parent_id:
            for index, sibling in enumerate(_siblings(nodes, node.parent_id, exclude=node.id)):
                sibling.sort_order = index
        siblings.insert(request.position - 1, node)
        for index, sibling in enumerate(siblings):
            sibling.sort_order = index
        node.parent_id = parent_id
        await session.commit()
        return {"node_id": node.id, "application_id": app.id, "parent_id": parent_id, "position": request.position}

    promoted = [child.id for child in children]
    siblings = _siblings(nodes, node.parent_id)
    siblings[siblings.index(node):siblings.index(node) + 1] = children
    for index, sibling in enumerate(siblings):
        sibling.parent_id = node.parent_id
        sibling.sort_order = index
    await session.flush()
    await _delete_application_menu_node(app.id, node.id, session, user, defer_commit=True)
    await session.commit()
    return {"node_id": node.id, "application_id": app.id, "promoted_node_ids": promoted}
