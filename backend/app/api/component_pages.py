"""Independent pages with versioned, per-component business data bindings."""
from __future__ import annotations


from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user, require_admin, current_tenant_id, current_user_id
from app.core.production_errors import coded_error, diagnose_operation
from app.core.request_diagnostics import mark_partial_failure
from app.models.relational import (
    ComponentPage,
    ComponentPageVersion,
    Form,
    Role,
    SystemSetting,
    User,
    OrgUnit,
)
from app.services.records import change_audit
from app.services import component_page_definitions as component_page_definitions_service
from app.services.component_page_definitions import (  # noqa: F401  (re-exported for tests/callers)
    ComponentPresentation,
    FilterScheme,
    FilterSettings,
    FilterToolbarGroup,
    PageDefinition,
    PageWidget,
    ToolbarGroup,
    WidgetAppearance,
    analytics_design,
    bound_host,
    check_audience,
    check_host,
    find_page,
    published,
    source_definitions,
    validate_draft_sources,
    validate_publish,
    validate_toolbar_audiences,
)
from app.services import component_page_editor as component_page_editor_service
from app.services.component_page_editor import (  # noqa: F401  (re-exported for tests/callers)
    PageWrite,
    RuntimeQuery,
    component_accessible,
    editor_payload,
    host_payload,
    resolve_display_groups,
    resolve_filter_groups,
    resolve_filter_schemes,
    resolve_toolbar_groups,
    runtime_data,
    save_page_definition,
)

router = APIRouter()


class PagePreview(RuntimeQuery):
    definition: PageDefinition


class PageBinding(BaseModel):
    blank: bool = False
    populate: bool = False
    existingCode: str | None = Field(default=None, max_length=100)


class PermissionTemplate(BaseModel):
    scope: Literal['toolbar', 'access', 'display', 'filter', 'filter-fields', 'audience'] = 'toolbar'
    name: str = Field(min_length=1, max_length=50)
    groups: list[ToolbarGroup | FilterToolbarGroup] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def scope_actions(self):
        allowed = set() if self.scope == 'audience' else {'query', 'reset'} if self.scope == 'filter' else {'create', 'refresh', 'import', 'export', 'disable', 'delete'}
        if any(set(group.actions) - allowed for group in self.groups):
            raise ValueError('模板按钮与使用范围不匹配')
        return self


@router.get('/permission-audiences')
async def permission_audiences(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    tenant_id = current_tenant_id(user)
    users = (await db.scalars(select(User).where(User.tenant_id == tenant_id, User.is_active.is_(True)))).all()
    units = (await db.scalars(select(OrgUnit).where(OrgUnit.tenant_id == tenant_id, OrgUnit.status == 'active'))).all()
    return {'users': [{'id': item.id, 'label': f"{item.display_name or item.username} ({item.username})"} for item in users],
            'orgUnits': [{'id': item.id, 'label': item.name, 'type': item.org_type} for item in units]}


@router.get('/permission-templates')
async def permission_templates(scope: Literal['toolbar', 'access', 'display', 'filter', 'filter-fields', 'audience'] = 'toolbar', db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    prefix = f"permission-template:{current_tenant_id(user)}:"
    rows = (await db.scalars(select(SystemSetting).where(SystemSetting.key.startswith(prefix)))).all()
    if scope == 'audience':
        return {'data': [{'id': row.key.removeprefix(prefix), 'name': row.value['name'], 'scope': 'audience',
                          'groups': [{**{key: group.get(key, []) for key in ('roleIds', 'userIds', 'orgUnitIds')},
                                      'id': group['id'], 'name': group['name'], 'actions': []}
                                     for group in row.value.get('groups', [])]} for row in rows]}
    return {'data': [{'id': row.key.removeprefix(prefix), **row.value} for row in rows if row.value.get('scope', 'toolbar') == scope]}


@router.post('/permission-templates')
async def save_permission_template(body: PermissionTemplate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    await validate_toolbar_audiences(db, current_tenant_id(user), body.groups)
    role_ids = {role for group in body.groups for role in group.roleIds}
    valid = set((await db.scalars(select(Role.id).where(Role.tenant_id == current_tenant_id(user), Role.id.in_(role_ids)))).all())
    if valid != role_ids:
        raise HTTPException(422, '模板角色不属于当前租户')
    template_id = uuid4().hex
    db.add(SystemSetting(key=f"permission-template:{current_tenant_id(user)}:{template_id}", value=body.model_dump(), description='通用按钮权限模板'))
    await db.commit()
    return {'id': template_id, **body.model_dump()}


@router.delete('/permission-templates/{template_id}')
async def delete_permission_template(template_id: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    row = await db.scalar(select(SystemSetting).where(SystemSetting.key == f"permission-template:{current_tenant_id(user)}:{template_id}"))
    if row is None:
        raise HTTPException(404, '权限模板不存在')
    await db.delete(row)
    await db.commit()
    return {'ok': True}


@router.post('')
@diagnose_operation('COMPONENT_PAGE_WRITE_FAILED')
async def create_page(definition: PageDefinition, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    return await component_page_editor_service.create_page(definition=definition, db=db, user=user)


@router.get('')
async def list_pages(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await component_page_definitions_service.list_pages(db=db, user=user)


WORKSPACE_CODE = 'system-workspace-home'


@router.get('/workspace/home')
async def workspace_binding(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    page = await db.scalar(select(ComponentPage).where(
        ComponentPage.tenant_id == current_tenant_id(user), ComponentPage.code == WORKSPACE_CODE))
    return {'code': page.code if page and page.published_version else None}


@router.post('/workspace/home')
async def initialize_workspace(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    # Serialize first-open creation for each tenant, like form/page binding.
    from app.services.field_uniqueness import lock
    await lock(db, current_tenant_id(user))
    page = await db.scalar(select(ComponentPage).where(
        ComponentPage.tenant_id == current_tenant_id(user), ComponentPage.code == WORKSPACE_CODE))
    if page:
        return {'code': page.code}
    modules = [('overview', '工作概览', 24), ('continuation', '未完成工作', 12),
               ('support', '待办与申请', 12), ('recent', '最近工作', 12), ('forms', '业务表单', 12)]
    definition = PageDefinition(title='我的工作台', widgets=[PageWidget(
        id=key, type='workspace', workspaceModule=key, title=title, width=width,
        appearance=WidgetAppearance(showTitle=False)) for key, title, width in modules]).model_dump()
    page = ComponentPage(tenant_id=current_tenant_id(user), code=WORKSPACE_CODE,
                         draft=definition, revision=1, published_version=1)
    db.add(page)
    await db.flush()
    db.add(ComponentPageVersion(tenant_id=page.tenant_id, page_id=page.id, version=1,
                               definition=definition, published_by=current_user_id(user)))
    await change_audit(db, tenant_id=page.tenant_id, user_id=current_user_id(user),
                       action='create', resource_type='component_page', resource_id=page.id,
                       new_values={'code': page.code, 'version': 1})
    await db.commit()
    return {'code': page.code}


@router.get('/{code}/editor')
@diagnose_operation('COMPONENT_PAGE_LOAD_FAILED')
async def get_editor(code: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    return await component_page_editor_service.get_editor(code=code, db=db, user=user)


@router.get('/forms/{slug}/binding')
@diagnose_operation('COMPONENT_PAGE_LOAD_FAILED')
async def resolve_form_page(slug: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    query = select(Form).where(Form.tenant_id == current_tenant_id(user))
    form = await db.scalar(query.where(Form.id == int(slug) if slug.isdigit() else Form.code == slug))
    if form is None:
        return {'enabled': False, 'code': None}
    config = form.config or {}
    if not user.get('is_admin') and not config.get('componentPageEnabled') and not config.get('componentPageCode'):
        return {'enabled': False, 'code': None}
    await check_host(db, user, form)
    if config.get('componentPageLegacyFallback') and not user.get('is_admin'):
        page = await find_page(db, user, config['componentPageCode'])
        if not page.published_version:
            return {'enabled': False, 'code': None}
    return {'enabled': True, 'code': config.get('componentPageCode'), 'form': host_payload(form)}


@router.post('/forms/{form_id}/binding')
async def bind_form_page(form_id: int, body: PageBinding | None = None,
                         db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    from app.services.field_uniqueness import lock
    await lock(db, current_tenant_id(user))
    form = await db.scalar(select(Form).where(Form.id == form_id,
        Form.tenant_id == current_tenant_id(user)).with_for_update().execution_options(populate_existing=True))
    await check_host(db, user, form)
    config = dict(form.config or {})
    if config.get('componentPageCode'):
        page = await find_page(db, user, config['componentPageCode'])
        if body and body.existingCode and body.existingCode != page.code:
            raise HTTPException(409, '此表单已绑定组件页面')
        return await editor_payload(db, page)
    if body and body.existingCode:
        page = await find_page(db, user, body.existingCode)
        host = await bound_host(db, page)
        if host and host.id != form.id:
            raise HTTPException(409, '此页面已属于其他表单')
    else:
        analysis = config.get('assemblyKind') in {'analysis', 'analytics', 'dashboard', 'report'}
        widgets = ([{'id': 'total', 'type': 'metric', 'title': '记录总数', 'width': 6}]
                   if analysis else [{'id': 'records', 'type': 'record-list', 'title': form.name, 'width': 24}])
        blank = bool(body and body.blank)
        definition = PageDefinition(title=form.name, sourceFormId=None if blank else form.id,
                                    widgets=[] if blank else widgets)
        if body and body.populate and (config.get('analyticsDesign') or form.status == 'published'):
            from app.services.page_content_migration import content_definition
            try:
                definition = await content_definition(db, form)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        page = ComponentPage(tenant_id=form.tenant_id, code=f'page-{uuid4().hex[:12]}',
                             draft=definition.model_dump(), revision=1, published_version=0)
        db.add(page)
        await db.flush()
    if not config.get('componentPageEnabled'):
        config['componentPageLegacyFallback'] = True
    config.update(componentPageEnabled=True, componentPageCode=page.code)
    form.config = config
    await change_audit(db, tenant_id=form.tenant_id, user_id=current_user_id(user),
                       action='bind_page', resource_type='form', resource_id=form.id,
                       new_values={'componentPageCode': page.code})
    await db.commit()
    return await editor_payload(db, page)


@router.put('/{code}/draft')
@router.post('/{code}/publish')
@diagnose_operation('COMPONENT_PAGE_WRITE_FAILED')
async def write_page(code: str, body: PageWrite, request: Request,
                     db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    return await save_page_definition(code, body, db, user, releasing=request.url.path.endswith('/publish'))


@router.get('/{code}')
@diagnose_operation('COMPONENT_PAGE_LOAD_FAILED')
async def get_page(code: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await component_page_editor_service.get_page(code=code, db=db, user=user)


@router.post('/{code}/data')
@diagnose_operation('COMPONENT_DATA_LOAD_FAILED')
async def page_data(code: str, query: RuntimeQuery, request: Request,
                    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    payload = await component_page_editor_service.page_data(code=code, query=query, db=db, user=user)
    diagnose_component_data(request, payload['analyticsData'])
    return payload


@router.post('/{code}/preview')
@diagnose_operation('COMPONENT_DATA_LOAD_FAILED')
async def preview_page(code: str, body: PagePreview, request: Request,
                       db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    await validate_publish(db, user, body.definition)
    data = await runtime_data(db, user, page, body.definition, body.filters, body.widget_filters, body.filter_queries, body.chart_values)
    diagnose_component_data(request, data)
    return {'analyticsData': data}


def diagnose_component_data(request: Request, data: dict) -> None:
    affected = sum(bool(errors) for errors in data.get('widgetErrors', {}).values())
    if affected or data.get('errors'):
        mark_partial_failure(request, 'COMPONENT_DATA_PARTIAL_FAILURE', affected)


# A section release stores a complete runtime snapshot but merges only its own fields.
_SECTION_DATA = {'dataBinding', 'dimension', 'measure', 'aggregate', 'expression', 'sharedMetricId', 'sharedMetricVersion', 'sharedFields', 'filterFields', 'filterSettings', 'showFilters'}
_SECTION_LIST_DATA = {'sortableColumns', 'displayGroups', 'columns', 'pageSize', 'defaultSort', 'emptyText'}
_SECTION_FILTER_DATA = {'showKeyword', 'expandAdvanced', 'requiredFields', 'schemes'}


def widget_section(widget, section):
    result = {k: v for k, v in widget.items() if k not in {'id', 'type', 'listSettings', 'filterSettings'} and ((k in _SECTION_DATA) == (section == 'data'))}
    result['listSettings'] = {k: v for k, v in (widget.get('listSettings') or {}).items() if ((k in _SECTION_LIST_DATA) == (section == 'data'))}
    filter_data_keys = set(FilterSettings.model_fields) if widget.get('type') == 'record-list' else _SECTION_FILTER_DATA
    result['filterSettings'] = {k: v for k, v in (widget.get('filterSettings') or {}).items() if ((k in filter_data_keys) == (section == 'data'))}
    return result


def merge_widget_section(widget, snapshot, section):
    patch = widget_section(snapshot, section)
    return {**widget, **patch, 'listSettings': {**(widget.get('listSettings') or {}), **patch['listSettings']}, 'filterSettings': {**(widget.get('filterSettings') or {}), **patch['filterSettings']}}


@router.get('/{code}/versions')
async def page_versions(code: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    versions = (await db.scalars(select(ComponentPageVersion).where(
        ComponentPageVersion.page_id == page.id, ComponentPageVersion.tenant_id == page.tenant_id
    ).order_by(ComponentPageVersion.version.desc()))).all()
    return {'items': [{'version': item.version, 'publishedAt': item.created_at,
                       'title': (item.definition or {}).get('title') or '',
                       'widgetCount': len((item.definition or {}).get('widgets') or [])} for item in versions]}


@router.get('/{code}/versions/{version_number}')
async def page_version(code: str, version_number: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    version = await db.scalar(select(ComponentPageVersion).where(
        ComponentPageVersion.page_id == page.id, ComponentPageVersion.tenant_id == page.tenant_id,
        ComponentPageVersion.version == version_number))
    if version is None:
        raise HTTPException(404, '页面版本不存在')
    return {'version': version.version, 'publishedAt': version.created_at, 'definition': version.definition}


@router.get('/{code}/widgets/{widget_id}/{section}/versions')
async def section_versions(code: str, widget_id: str, section: Literal['basic', 'data'],
                           db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    versions = (await db.scalars(select(ComponentPageVersion).where(
        ComponentPageVersion.page_id == page.id, ComponentPageVersion.tenant_id == page.tenant_id
    ).order_by(ComponentPageVersion.version))).all()
    items = []
    previous = None
    for version in versions:
        widget = next((w for w in version.definition.get('widgets', []) if w['id'] == widget_id), None)
        if widget is None:
            continue
        snapshot = widget_section(widget, section)
        if snapshot != previous:
            items.append({'version': len(items) + 1, 'pageVersion': version.version, 'snapshot': snapshot})
            previous = snapshot
    return {'items': list(reversed(items))}


@router.post('/{code}/widgets/{widget_id}/{section}/publish')
@diagnose_operation('COMPONENT_PAGE_WRITE_FAILED')
async def publish_section(code: str, widget_id: str, section: Literal['basic', 'data'], body: PageWrite,
                          db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    definition = await published(db, page)
    if not definition:
        raise HTTPException(422, '请先发布页面首个版本，再独立发布组件页签')
    source = next((w.model_dump() for w in body.definition.widgets if w.id == widget_id), None)
    if source is None or not any(w['id'] == widget_id for w in definition['widgets']):
        raise HTTPException(422, '新组件请先通过页面发布')
    if section == 'data' and source['type'] == 'record-list':
        draft_ids = {widget.id for widget in body.definition.widgets}
        if any(w['type'] == 'record-filter' and w.get('targetWidgetIds') == [widget_id] and w['id'] not in draft_ids
               for w in definition['widgets']):
            raise HTTPException(422, '请发布整个页面，以同步移除已合并的筛选组件')
    definition = {**definition, 'widgets': [merge_widget_section(w, source, section) if w['id'] == widget_id else w for w in definition['widgets']]}
    validated = PageDefinition.model_validate(definition)
    await validate_publish(db, user, validated)
    await validate_draft_sources(db, user, body.definition)
    updated = await db.execute(update(ComponentPage).where(ComponentPage.id == page.id,
        ComponentPage.tenant_id == page.tenant_id, ComponentPage.revision == body.expectedRevision).values(
        draft=body.definition.model_dump(), revision=ComponentPage.revision + 1, published_version=ComponentPage.published_version + 1))
    if updated.rowcount != 1:
        raise coded_error(409, 'COMPONENT_PAGE_VERSION_CONFLICT', '页面已被其他编辑更新，请重新加载')
    await db.refresh(page)
    db.add(ComponentPageVersion(tenant_id=page.tenant_id, page_id=page.id, version=page.published_version,
                               definition=validated.model_dump(), published_by=current_user_id(user)))
    await change_audit(db, tenant_id=page.tenant_id, user_id=current_user_id(user), action='publish_section',
                       resource_type='component_page', resource_id=page.id,
                       new_values={'widget': widget_id, 'section': section, 'version': page.published_version})
    await db.commit()
    return await editor_payload(db, page)
