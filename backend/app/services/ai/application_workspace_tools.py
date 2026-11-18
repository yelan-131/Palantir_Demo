"""AI adapters for application workspace operations shared with Studio."""

from typing import Annotated, Literal
from uuid import uuid4

from fastapi import HTTPException
from pydantic import Field, model_validator

from app.core.principal import ensure_admin
from app.services.application_menu_nodes import (
    _create_application_menu_node, _menu_node_payload, _normalized_menu_node_config,
    _update_application_menu_node, paste_application_menu_nodes,
)
from app.services.application_menus import menu_nodes, validate_tree
from app.services.application_templates import (
    application_template_snapshot, get_application_template, instantiate_application_template,
    list_application_templates, save_application_template, validate_template_references,
)
from app.services.applications import (
    ApplicationAccessGroup, ApplicationCreate, _application_to_dict, create_application, effective_access_groups, get_tenant_application,
    ordered_applications, reorder_applications,
)
from app.services.field_uniqueness import lock
from app.services.form_schemas import MenuNodeCreate, MenuNodeUpdate
from app.services.roles import ensure_role_name_available, stage_role
from app.services.tenant_onboarding import assert_tenant_quota

from .application_admin_tools import ApplicationTarget, ApplicationToolRequest, Icon, _preview_value, _snapshot_digest
from .tenant_context import require_tenant_id


Id = Annotated[int, Field(gt=0, le=2**31 - 1)]


class MoveApplication(ApplicationTarget):
    position: int = Field(ge=1, description="应用列表中的新位置，从 1 开始")


class PasteMenus(ApplicationTarget):
    source_application_id: Id | None = Field(default=None, description="跨应用复制时提供源应用 ID，省略表示本应用")
    node_ids: list[Id] = Field(min_length=1, max_length=2000, description="选中的源节点 ID，分组包含全部后代")
    parent_id: Id | None = Field(default=None, description="目标应用内的分组 ID，省略表示根菜单")


class NewMenuPage(ApplicationTarget):
    title: str = Field(min_length=1, max_length=100)
    parent_id: Id | None = None
    icon: Icon | None = None
    description: str | None = None


class NewMenuRole(ApplicationToolRequest):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,99}$", description="角色编码")
    label: str = Field(min_length=1, max_length=200, description="角色名称")
    description: str | None = None


class MenuProperties(ApplicationTarget):
    node_id: Id
    icon: Icon | None = None
    description: str | None = None
    permission_mode: Literal['inherit', 'custom'] | None = None
    access_groups: list[ApplicationAccessGroup] | None = Field(default=None, max_length=20)
    add_access_group: ApplicationAccessGroup | None = Field(default=None, description="在自定义权限中追加一个权限组，保留已有组。请为新组提供唯一 id")
    new_role: NewMenuRole | None = Field(default=None, description="新建角色并授权给自定义菜单。加入所追加的权限组，或当前第一个权限组")

    @model_validator(mode="after")
    def validate_changes(self):
        fields = self.model_fields_set - {"application_id", "node_id"}
        access_fields = fields & {"access_groups", "add_access_group", "new_role"}
        if not fields or any(getattr(self, key) is None for key in fields - {"icon", "description"}):
            raise ValueError("请填写要修改的菜单属性")
        if self.permission_mode == "inherit" and access_fields:
            raise ValueError("跟随应用权限时无需提交菜单权限组")
        if "access_groups" in access_fields and len(access_fields) > 1:
            raise ValueError("完整替换权限组时请单独提交")
        return self


class TemplateTarget(ApplicationToolRequest):
    template_id: Id


READ_TOOLS = frozenset({"applications.inspect", "applications.list_templates"})
WORKSPACE_REQUESTS = {
    "applications.inspect": ApplicationTarget,
    "applications.reorder": MoveApplication,
    "applications.copy_draft": ApplicationTarget,
    "applications.list_templates": ApplicationToolRequest,
    "applications.save_template": ApplicationTarget,
    "applications.instantiate_template": TemplateTarget,
    "menus.copy": PasteMenus,
    "menus.create_page_draft": NewMenuPage,
    "menus.update_properties": MenuProperties,
}
WORKSPACE_DETAILS = {
    "applications.inspect": ("查看应用和菜单属性", "查看应用启动页、访问权限组及完整菜单结构，返回菜单节点 ID、父节点、顺序和权限来源。"),
    "applications.reorder": ("调整应用顺序", "将应用移动至从 1 开始的目标位置，其他应用相对顺序保留。"),
    "applications.copy_draft": ("复制应用属性为草稿", "复制应用基本属性到新草稿。完整复用菜单结构时使用应用模板。"),
    "applications.list_templates": ("查看应用模板", "列出本租户保存的应用模板及模板 ID。"),
    "applications.save_template": ("添加应用到模板中心", "保存应用基本配置及菜单结构，相同应用再次保存会更新模板。页面和表单保存为引用。"),
    "applications.instantiate_template": ("从模板创建草稿应用", "按模板 ID 创建应用草稿，复用原页面和表单，访问权限按草稿默认值配置。"),
    "menus.copy": ("复制菜单和分组", "在同一租户内将选中的菜单和全部后代复制到指定应用或分组，保留页面、表单引用，不替换目标应用默认入口。"),
    "menus.create_page_draft": ("新建菜单和页面草稿", "创建新菜单及同名通用页面草稿，可指定父分组；页面发布后才显示在导航中。"),
    "menus.update_properties": ("编辑菜单图标、说明和访问权限", "可跟随应用或自定义权限。选择自定义后，可追加权限组、新建并授权角色，或完整替换权限组。"),
}


async def _menu_configuration(session, app):
    return [await _menu_node_payload(session, node) for node in sorted(
        await menu_nodes(session, app), key=lambda node: (node.sort_order, node.id),
    )]


def _target_group(nodes, parent_id):
    if parent_id is None:
        return "应用根菜单"
    parent = next((node for node in nodes if node["id"] == parent_id and node["node_type"] == "group"), None)
    if parent is None:
        raise HTTPException(422, "请选择目标应用下的菜单分组")
    return parent["title"]


async def _menu_changes(session, tenant_id, node, request):
    changes = request.model_dump(exclude_unset=True, exclude={"application_id", "node_id"})
    values = {key: changes[key] for key in ("icon",) if key in changes}
    config = dict(node["config"])
    if "description" in changes:
        config["description"] = changes["description"] or ""
    if request.permission_mode is not None:
        config["permission_mode"] = request.permission_mode
        if request.permission_mode == "inherit" or node["config"].get("permission_mode") != "custom":
            config["access_groups"] = []
    if request.access_groups is not None or request.add_access_group or request.new_role:
        if config.get("permission_mode") != "custom":
            raise HTTPException(422, "请切换到自定义权限后再设置菜单权限组")
        if request.access_groups is not None:
            config["access_groups"] = [group.model_dump() for group in request.access_groups]
        else:
            groups = effective_access_groups(config.get("access_groups"), config.get("role_ids", []))
            if request.add_access_group:
                groups.append(request.add_access_group.model_dump())
            config["access_groups"] = groups or effective_access_groups(None, [])
    if config != node["config"]:
        values["config"] = await _normalized_menu_node_config(session, tenant_id, config)
    return values


async def execute_workspace_tool(operation, session, *, user, payload, prepare=False):
    ensure_admin(user)
    tenant_id = require_tenant_id(user)
    request = WORKSPACE_REQUESTS[operation].model_validate({
        key: value for key, value in payload.items() if key not in {"_workspace_snapshot", "_preview"}
    })
    if operation == "applications.list_templates":
        items = await list_application_templates(session, tenant_id)
        return {"items": items, "count": len(items)}
    if operation == "applications.inspect":
        app = await get_tenant_application(session, tenant_id, request.application_id)
        return {"application": await _application_to_dict(session, app, include_bindings=True),
                "menu_nodes": await _menu_configuration(session, app)}
    if not prepare:
        await lock(session, tenant_id)

    arguments = request.model_dump(exclude_unset=True)

    def confirm(state, target, fields):
        digest = _snapshot_digest({"operation": operation, "arguments": arguments, "state": state})
        if prepare:
            return {**arguments, "_workspace_snapshot": digest, "_preview": {"target": target, "fields": fields}}
        if payload.get("_workspace_snapshot") != digest:
            raise HTTPException(409, "应用、菜单或模板已变化，请重新确认")
        return None

    if isinstance(request, TemplateTarget):
        template = await get_application_template(session, tenant_id, request.template_id)
        await validate_template_references(session, tenant_id, template["menus"])
        await assert_tenant_quota(session, tenant_id, "applications")
        preview = confirm(template, template["application"]["name"], {"状态": "创建应用草稿", "菜单数": len(template["menus"])})
        return preview if prepare else await instantiate_application_template(session, tenant_id, request.template_id, user)

    if isinstance(request, MoveApplication):
        ordered = await ordered_applications(session, tenant_id, for_update=not prepare)
        names = {app.id: app.name for app in ordered}
        if request.application_id not in names or request.position > len(ordered):
            raise HTTPException(422, "应用或目标位置不在当前列表中")
        before = list(names)
        after = [app_id for app_id in before if app_id != request.application_id]
        after.insert(request.position - 1, request.application_id)
        fields = {"原位置": before.index(request.application_id) + 1, "目标位置": request.position}
        preview = confirm(list(names.items()), names[request.application_id], fields)
        return preview if prepare else await reorder_applications(session, tenant_id, before, after, user)

    source_id = request.source_application_id if isinstance(request, PasteMenus) else None
    apps = {app_id: await get_tenant_application(session, tenant_id, app_id, for_update=not prepare)
            for app_id in sorted({request.application_id, source_id or request.application_id})}
    app = apps[request.application_id]
    if operation == "applications.copy_draft":
        await assert_tenant_quota(session, tenant_id, "applications")
        values = {key: getattr(app, key) for key in ("name", "description", "icon", "default_route")}
        name = f"{app.name[:197]} 副本"
        preview = confirm(values, app.name, {"应用草稿名称": name, "复制范围": "基本属性"})
        return preview if prepare else await create_application(session, ApplicationCreate(
            **{**values, "name": name}, code=f"app-copy-{uuid4().hex}", status="draft",
        ), user)
    if operation == "applications.save_template":
        template = await application_template_snapshot(session, app)
        preview = confirm(template, app.name, {"菜单数": len(template["menus"]), "保存位置": "模板中心"})
        return preview if prepare else await save_application_template(session, tenant_id, app.id)

    nodes = await _menu_configuration(session, app)
    state = {"application": app.name, "nodes": nodes}
    if isinstance(request, PasteMenus):
        source = apps[source_id or app.id]
        source_nodes = await _menu_configuration(session, source) if source.id != app.id else nodes
        validate_tree({node["id"]: node["parent_id"] for node in source_nodes})
        selected = [node["title"] for node in source_nodes if node["id"] in request.node_ids]
        if len(selected) != len(set(request.node_ids)):
            raise HTTPException(409, "部分已复制菜单已变更，请重新选择")
        target = _target_group(nodes, request.parent_id)
        preview = confirm({**state, "source": source.name, "source_nodes": source_nodes}, f"{app.name} / {target}",
                          {"源应用": source.name, "所选菜单": "、".join(selected), "分组复制范围": "全部子菜单"})
        return preview if prepare else await paste_application_menu_nodes(
            app.id, request.node_ids, request.parent_id, session, user, source_application_id=source.id,
        )

    if isinstance(request, NewMenuPage):
        target = _target_group(nodes, request.parent_id)
        preview = confirm(state, f"{app.name} / {target}", {"新建入口": request.title, "页面状态": "草稿"})
        if prepare:
            return preview
        order = max((node["sort_order"] for node in nodes if node["parent_id"] == request.parent_id), default=-1) + 1
        return (await _create_application_menu_node(app.id, MenuNodeCreate(
            title=request.title, parent_id=request.parent_id, icon=request.icon, sort_order=order,
            create_page=True, config={"description": request.description or ""},
        ), session, user))["data"]

    node = next((node for node in nodes if node["id"] == request.node_id), None)
    if node is None:
        raise HTTPException(404, "找不到目标菜单节点")
    changes = await _menu_changes(session, tenant_id, node, request)
    labels = {"icon": "菜单图标", "description": "菜单说明", "permission_mode": "权限来源", "access_groups": "自定义权限组"}
    fields = {label: _preview_value(key, arguments[key]) for key, label in labels.items() if key in arguments}
    if request.permission_mode:
        fields["权限来源"] = "跟随应用权限" if request.permission_mode == "inherit" else "自定义"
    if request.add_access_group:
        fields["新增权限组"] = _preview_value("access_groups", [request.add_access_group.model_dump()])
    if request.new_role:
        await ensure_role_name_available(session, tenant_id, request.new_role.name)
        groups = changes.get("config", node["config"])["access_groups"]
        role_group = groups[-1] if request.add_access_group else groups[0]
        fields["新建并授权角色"] = f"{request.new_role.label}（{request.new_role.name}） → {role_group['name']}"
        if request.new_role.description:
            fields["角色说明"] = request.new_role.description
    preview = confirm(state, f"{app.name} / {node['title']}", fields)
    if prepare:
        return preview
    if request.new_role:
        role = await stage_role(session, tenant_id, **request.new_role.model_dump())
        role_group["roleIds"].append(role.id)
        changes["config"] = {**changes.get("config", node["config"]), "access_groups": groups}
    return (await _update_application_menu_node(app.id, node["id"], MenuNodeUpdate(**changes), session, user))["data"]
