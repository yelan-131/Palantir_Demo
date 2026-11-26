"""Read menu destinations and publish a standard form into an application."""
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.core.principal import ensure_admin
from app.models.relational import Application, ApplicationMenuNode, Form
from app.services.field_uniqueness import lock
from app.services.form_runtime import _latest_form_version
from app.services.form_versions import preview_form_publish, publish_form
from .tenant_context import require_tenant_id


class FormMenuTarget(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    application_id: int = Field(gt=0)
    parent_id: int | None = Field(default=None, gt=0)
    menu_title: str | None = Field(default=None, min_length=1, max_length=200)


async def application_menus(db, tenant_id, application_id, limit):
    rows = (await db.scalars(select(ApplicationMenuNode).where(
        ApplicationMenuNode.tenant_id == tenant_id,
        ApplicationMenuNode.application_id == application_id,
    ).order_by(ApplicationMenuNode.sort_order, ApplicationMenuNode.id).limit(limit + 1))).all()
    items = [{key: getattr(node, key) for key in ('id', 'parent_id', 'node_type', 'title', 'form_id', 'route_path', 'visible')}
             for node in rows[:limit]]
    return {'subject': 'menus', 'application_id': application_id, 'items': items, 'count': len(items), 'has_more': len(rows) > limit}


async def resolve_menu_target(db, tenant_id, target):
    app = await db.get(Application, target.application_id)
    if not app or app.tenant_id != tenant_id or app.status not in {'published', 'active'}:
        raise HTTPException(404, '目标应用不存在或尚未发布')
    parent = await db.get(ApplicationMenuNode, target.parent_id) if target.parent_id else None
    if target.parent_id and (not parent or parent.tenant_id != tenant_id or parent.application_id != app.id
                             or parent.node_type != 'group' or not parent.visible):
        raise HTTPException(422, '请选择目标应用下可见的菜单分组')
    return app, parent


async def publish_form_to_menu(db, user, payload, *, prepare=False):
    from app.services.application_menu_nodes import _create_application_menu_node
    from app.services.form_schemas import MenuNodeCreate

    ensure_admin(user)
    tenant_id = require_tenant_id(user)
    target = FormMenuTarget.model_validate(payload)
    if not prepare:
        await lock(db, tenant_id)
    app, parent = await resolve_menu_target(db, tenant_id, target)
    form = await db.get(Form, int(payload['form_id']))
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, '表单不存在或不可访问')
    if form.status not in {'draft', 'active', 'published'}:
        raise HTTPException(422, '当前表单状态无法发布到菜单')
    config = form.config or {}
    kind = str(config.get('assemblyKind') or config.get('kind') or config.get('type') or '').lower()
    if kind in {'analysis', 'analytics', 'dashboard', 'report', 'bi_report', 'metric_dashboard', 'list_analysis'}:
        raise HTTPException(422, '该工具仅支持标准业务表单')
    siblings = select(ApplicationMenuNode).where(ApplicationMenuNode.tenant_id == tenant_id,
        ApplicationMenuNode.application_id == app.id, ApplicationMenuNode.parent_id == target.parent_id)
    title = (target.menu_title or form.name).strip()
    if not title:
        raise HTTPException(422, '菜单名称不能为空')
    route = f'/dynamic/{form.code}'
    candidates = (await db.scalars(siblings.where((ApplicationMenuNode.title == title) |
        (ApplicationMenuNode.form_id == form.id) | (ApplicationMenuNode.route_path == route)))).all()
    existing = next((node for node in candidates if node.form_id == form.id and node.route_path == route and node.visible), None)
    if candidates and not existing:
        raise HTTPException(409, '目标位置已有同名入口或已有隐藏的表单入口，请先检查菜单')
    version = await _latest_form_version(db, tenant_id, form.id)
    destination = ' / '.join([app.name, *([parent.title] if parent else []), existing.title if existing else title])
    if payload.get('destination') and payload['destination'] != destination:
        raise HTTPException(409, '菜单位置已变化，请重新生成确认卡片')
    if prepare:
        if not version:
            preview = (await preview_form_publish(form.id, db, user))['data']
            if preview['blocking_count']:
                raise HTTPException(409, {'message': '表单发布检查未通过', 'report': preview})
        return {'form_id': form.id, **target.model_dump(exclude_none=True), 'form_name': form.name, 'destination': destination,
                'publish_required': not bool(version)}
    if not version:
        if payload.get('publish_required') is False:
            raise HTTPException(409, '表单发布状态已变化，请重新生成确认卡片')
        await publish_form(form.id, db, user, defer_commit=True)
    if existing:
        node_id = existing.id
    else:
        last = await db.scalar(siblings.with_only_columns(func.max(ApplicationMenuNode.sort_order)))
        created = await _create_application_menu_node(app.id, MenuNodeCreate(form_id=form.id,
            parent_id=target.parent_id, title=title, sort_order=(last if last is not None else -1) + 1), db, user, defer_commit=True)
        node_id = created['data']['id']
    await db.commit()
    return {'form_id': form.id, 'menu_id': node_id, 'application_id': app.id, 'application_name': app.name, 'route_path': route, 'destination': destination}
