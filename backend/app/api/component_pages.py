"""First component-page slice: one business source, composable CRUD and analytics."""
from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user, require_admin, current_tenant_id, current_user_id
from app.core.permissions import get_user_role_ids, allowed_form_fields, has_form_permission
from app.models.relational import ComponentPage, ComponentPageVersion, Form, Role
from app.services.records import runtime_fields, change_audit, authorized_records
from app.services.analytics_data import load_data
from app.services.analytics_runtime import source_errors, design_errors

router = APIRouter()


class WidgetAppearance(BaseModel):
    subtitle: str = Field(default='', max_length=160)
    palette: Literal['manufacturing', 'business', 'warning', 'mono'] | None = None
    radius: int | None = Field(default=None, ge=0, le=24)
    showLegend: bool = True
    showLabels: bool = False
    smooth: bool = False


class FilterSettings(BaseModel):
    queryMode: Literal['submit', 'change'] = 'submit'
    resetMode: Literal['defaults', 'clear'] = 'defaults'
    showKeyword: bool = True
    expandAdvanced: bool = False
    requiredFields: list[str] = Field(default_factory=list, max_length=30)
    queryLabel: str = Field(default='查询', min_length=1, max_length=20)
    resetLabel: str = Field(default='重置', min_length=1, max_length=20)


class ListSort(BaseModel):
    field: str = Field(min_length=1, max_length=200)
    order: Literal['asc', 'desc'] = 'asc'


class ListSettings(BaseModel):
    columns: list[str] | None = Field(default=None, min_length=1, max_length=100)
    pageSize: int | None = Field(default=None, ge=1, le=200)
    defaultSort: ListSort | None = None
    rowClick: Literal['none', 'detail', 'edit'] | None = None
    toolbarActions: list[Literal['create', 'refresh', 'import', 'export']] | None = None
    rowActions: list[Literal['detail', 'edit', 'delete']] | None = None
    selection: Literal['none', 'single', 'multiple'] = 'none'
    emptyText: str = Field(default='暂无符合条件的数据', min_length=1, max_length=100)


class PageWidget(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    type: Literal['record-list', 'record-filter', 'metric', 'chart']
    title: str = Field(min_length=1, max_length=100)
    width: Literal[6, 12, 18, 24] = 24
    dimension: str | None = Field(default=None, max_length=200)
    measure: str | None = Field(default=None, max_length=200)
    aggregate: Literal['count', 'sum', 'avg', 'min', 'max'] = 'count'
    height: int = Field(default=280, ge=160, le=600)
    showFilters: bool = True
    filterSettings: FilterSettings = Field(default_factory=FilterSettings)
    listSettings: ListSettings = Field(default_factory=ListSettings)
    filterFields: list[str] | None = Field(default=None, max_length=30)
    targetWidgetIds: list[str] = Field(default_factory=list, max_length=30)
    interaction: Literal['filter', 'none', 'drilldown', 'navigate'] = 'filter'
    chartType: Literal['bar', 'line', 'pie', 'rank-table'] = 'bar'
    format: Literal['number', 'percent', 'currency', 'duration'] = 'number'
    unit: str = Field(default='', max_length=30)
    threshold: str = Field(default='', max_length=100)
    appearance: WidgetAppearance = Field(default_factory=WidgetAppearance)


class PageStyle(BaseModel):
    componentGap: int = Field(default=12, ge=0, le=32)
    cardRadius: int = Field(default=8, ge=0, le=20)
    preset: Literal['clean', 'factory', 'executive'] = 'clean'
    background: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    cardBorder: Literal['none', 'light', 'strong'] = 'light'
    chartPalette: Literal['manufacturing', 'business', 'warning', 'mono'] = 'manufacturing'
    tableDensity: Literal['compact', 'standard', 'comfortable'] | None = None
    filterTheme: Literal['toolbar', 'inline', 'panel'] = 'toolbar'
    refreshInterval: int = Field(default=0, ge=0, le=3600)


class PageDefinition(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    sourceFormId: int = Field(gt=0)
    filterFields: list[str] = Field(default_factory=list, max_length=12)
    roleIds: list[int] = Field(default_factory=list, max_length=100)
    widgets: list[PageWidget] = Field(min_length=1, max_length=30)
    style: PageStyle = Field(default_factory=PageStyle)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({w.id for w in self.widgets}) != len(self.widgets):
            raise ValueError('组件 ID 不能重复')
        if len(set(self.filterFields)) != len(self.filterFields) or any(not f or len(f) > 200 for f in self.filterFields):
            raise ValueError('筛选字段无效或重复')
        if any(value <= 0 for value in self.roleIds):
            raise ValueError('角色 ID 无效')
        return self


class PageWrite(BaseModel):
    definition: PageDefinition
    expectedRevision: int = Field(gt=0)


class RuntimeQuery(BaseModel):
    filters: dict[str, str] = Field(default_factory=dict, max_length=12)
    widget_filters: dict[str, dict[str, str]] = Field(default_factory=dict, max_length=30)


class PagePreview(RuntimeQuery):
    definition: PageDefinition


class PageBinding(BaseModel):
    existingCode: str | None = Field(default=None, max_length=100)


async def bound_host(db, page):
    return await db.scalar(select(Form).where(Form.tenant_id == page.tenant_id,
        Form.config['componentPageCode'].as_string() == page.code))


async def check_host(db, user, form):
    if form is None or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, '表单不存在')
    if not user.get('is_admin'):
        if form.status != 'published':
            raise HTTPException(404, '表单尚未发布或已停用')
        if not await has_form_permission(user, form.id, 'view', db):
            raise HTTPException(403, '无权访问此表单')


def host_payload(form):
    return {'id': form.id, 'code': form.code, 'name': form.name, 'status': form.status,
            'kind': (form.config or {}).get('assemblyKind', 'interaction')}


async def find_page(db, user, code):
    page = await db.scalar(select(ComponentPage).where(
        ComponentPage.tenant_id == current_tenant_id(user), ComponentPage.code == code))
    if page is None:
        raise HTTPException(404, '页面不存在')
    return page


async def published(db, page):
    version = await db.scalar(select(ComponentPageVersion).where(
        ComponentPageVersion.page_id == page.id, ComponentPageVersion.version == page.published_version,
        ComponentPageVersion.tenant_id == page.tenant_id))
    return version.definition if version else None


async def check_audience(db, user, definition):
    if not user.get('is_admin') and definition.get('roleIds'):
        if not set(definition['roleIds']) & set(await get_user_role_ids(user, db)):
            raise HTTPException(403, '无权访问此页面')


async def source_form(db, user, definition):
    form = await db.get(Form, definition.sourceFormId)
    if form is None or form.tenant_id != current_tenant_id(user):
        raise HTTPException(422, '业务数据来源不存在')
    return form


def analytics_design(definition):
    dimensions = set(definition.filterFields)
    measures, metrics, widgets = set(), [], []
    for widget in definition.widgets:
        if widget.type in {'record-list', 'record-filter'}:
            continue
        if widget.dimension:
            dimensions.add(widget.dimension)
        if widget.measure:
            measures.add(widget.measure)
        metrics.append({'id': widget.id, 'name': widget.title, 'datasetId': 'source',
                        'expression': f'{widget.aggregate}({widget.measure})' if widget.aggregate != 'count' else 'count()',
                        'format': widget.format, 'unit': widget.unit, 'threshold': widget.threshold})
        widgets.append({'id': widget.id, 'title': widget.title, 'datasetId': 'source', 'metricIds': [widget.id],
                        'type': 'metric-card' if widget.type == 'metric' else widget.chartType, 'dimension': widget.dimension})
    return {'datasets': [{'id': 'source', 'name': '业务数据', 'sourceType': 'businessForm',
                          'source': str(definition.sourceFormId), 'refreshMode': 'manual',
                          'dimensions': sorted(dimensions), 'measures': sorted(measures)}],
            'metrics': metrics, 'widgets': widgets, 'globalFilters': definition.filterFields, 'interactions': []}


async def validate_publish(db, user, definition):
    form = await source_form(db, user, definition)
    if (form.config or {}).get('assemblyKind') in {'analysis', 'analytics', 'dashboard', 'report'}:
        raise HTTPException(422, '请在页面设置中选择业务表单作为数据来源')
    if form.status != 'published':
        raise HTTPException(422, '请先发布业务数据来源')
    fields = await runtime_fields(db, form)
    available = {f.field_name: f for f in fields if not f.archived}
    from app.services.form_runtime import _latest_form_version
    from app.api.forms import _published_form_payload
    version = await _latest_form_version(db, form.tenant_id, form.id)
    published_config = (_published_form_payload(form, version)['config'] if version else form.config) or {}
    view = published_config.get('viewConfig') or {}
    views = view.get('tabs') or [view]
    configured_filters = {item.get('fieldName') for current in views for item in current.get('filters', []) if item.get('enabled', True)}
    configured_columns = {item.get('fieldName') for current in views for item in current.get('table', {}).get('columns', []) if item.get('enabled', True)}
    references = set(definition.filterFields)
    list_ids = {widget.id for widget in definition.widgets if widget.type == 'record-list'}
    for widget in definition.widgets:
        if widget.type == 'record-filter':
            if not widget.targetWidgetIds or set(widget.targetWidgetIds) - list_ids:
                raise HTTPException(422, '筛选组件需要关联有效的业务列表')
            references.update(widget.filterFields or [])
            references.update(widget.filterSettings.requiredFields)
            if view and (set(widget.filterSettings.requiredFields) | set(widget.filterFields or [])) - configured_filters:
                raise HTTPException(422, '筛选组件引用了来源发布视图中不可用的筛选字段')
            if widget.filterFields is not None and set(widget.filterSettings.requiredFields) - set(widget.filterFields):
                raise HTTPException(422, '必填筛选条件必须包含在组件筛选字段中')
            if not widget.filterSettings.showKeyword and widget.filterFields == []:
                raise HTTPException(422, '筛选组件至少需要一个筛选条件')
        if widget.type == 'record-list':
            columns = widget.listSettings.columns
            if columns is not None and len(set(columns)) != len(columns):
                raise HTTPException(422, '列表显示列不能重复')
            references.update(columns or [])
            if view and columns is not None and set(columns) - configured_columns:
                raise HTTPException(422, '列表显示列不属于来源发布视图')
            if widget.listSettings.defaultSort:
                references.add(widget.listSettings.defaultSort.field)
                if columns is not None and widget.listSettings.defaultSort.field not in columns:
                    raise HTTPException(422, '默认排序字段必须在列表显示列中')
        if widget.type == 'chart' and not widget.dimension:
            raise HTTPException(422, '图表需要选择分组字段')
        if widget.dimension:
            references.add(widget.dimension)
        if widget.type == 'chart' and (set(widget.targetWidgetIds) - {w.id for w in definition.widgets if w.id != widget.id and w.type != 'record-filter'}):
            raise HTTPException(422, '图表联动目标不存在或指向自身')
        if widget.aggregate != 'count':
            if widget.measure not in available or available[widget.measure].field_type not in {'int', 'integer', 'float', 'decimal', 'number'}:
                raise HTTPException(422, '求和需要有效的数值字段')
            references.add(widget.measure)
    if references - available.keys():
        raise HTTPException(422, '页面引用了不存在或已归档的字段')
    roles = set((await db.scalars(select(Role.id).where(Role.tenant_id == form.tenant_id, Role.id.in_(definition.roleIds)))).all())
    if roles != set(definition.roleIds):
        raise HTTPException(422, '页面角色不属于当前租户')
    if any(w.type in {'metric', 'chart'} for w in definition.widgets):
        errors = design_errors(analytics_design(definition))
        errors += await source_errors(db, form.tenant_id, form, analytics_design(definition),
                                     [{'field_name': f.field_name, 'archived': f.archived} for f in fields])
        if errors:
            raise HTTPException(422, {'message': '页面数据配置无效', 'errors': errors})


async def editor_payload(db, page):
    host = await bound_host(db, page)
    return {'code': page.code, 'revision': page.revision, 'publishedVersion': page.published_version,
            'definition': page.draft, 'publishedDefinition': await published(db, page),
            'hostForm': host_payload(host) if host else None}


@router.post('')
async def create_page(definition: PageDefinition, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    await source_form(db, user, definition)
    page = ComponentPage(tenant_id=current_tenant_id(user), code=f'page-{uuid4().hex[:12]}',
                         draft=definition.model_dump(), revision=1, published_version=0)
    db.add(page)
    await db.flush()
    await change_audit(db, tenant_id=page.tenant_id, user_id=current_user_id(user), action='create',
                       resource_type='component_page', resource_id=page.id, new_values=page.draft)
    await db.commit()
    return await editor_payload(db, page)


@router.get('')
async def list_pages(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    pages = (await db.scalars(select(ComponentPage).where(ComponentPage.tenant_id == current_tenant_id(user))
                             .order_by(ComponentPage.updated_at.desc()))).all()
    items = []
    for page in pages:
        definition = await published(db, page)
        if not definition and not user.get('is_admin'):
            continue
        try:
            await check_audience(db, user, definition or page.draft)
            host = await bound_host(db, page)
            if host:
                await check_host(db, user, host)
        except HTTPException:
            continue
        items.append({'code': page.code, 'title': (page.draft if user.get('is_admin') else definition)['title'],
                      'publishedVersion': page.published_version})
    return {'items': items}


@router.get('/{code}/editor')
async def get_editor(code: str, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    return await editor_payload(db, await find_page(db, user, code))


@router.get('/forms/{slug}/binding')
async def resolve_form_page(slug: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    query = select(Form).where(Form.tenant_id == current_tenant_id(user))
    form = await db.scalar(query.where(Form.id == int(slug) if slug.isdigit() else Form.code == slug))
    if form is None:
        return {'enabled': False, 'code': None}
    config = form.config or {}
    if not config.get('componentPageEnabled') and not config.get('componentPageCode'):
        return {'enabled': False, 'code': None}
    await check_host(db, user, form)
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
                   if analysis else [{'id': 'filters', 'type': 'record-filter', 'title': '业务筛选', 'width': 24, 'targetWidgetIds': ['records']},
                                     {'id': 'records', 'type': 'record-list', 'title': form.name, 'width': 24, 'showFilters': False}])
        definition = PageDefinition(title=form.name, sourceFormId=form.id, widgets=widgets)
        page = ComponentPage(tenant_id=form.tenant_id, code=f'page-{uuid4().hex[:12]}',
                             draft=definition.model_dump(), revision=1, published_version=0)
        db.add(page)
        await db.flush()
    config.update(componentPageEnabled=True, componentPageCode=page.code)
    form.config = config
    await change_audit(db, tenant_id=form.tenant_id, user_id=current_user_id(user),
                       action='bind_page', resource_type='form', resource_id=form.id,
                       new_values={'componentPageCode': page.code})
    await db.commit()
    return await editor_payload(db, page)


@router.put('/{code}/draft')
@router.post('/{code}/publish')
async def write_page(code: str, body: PageWrite, request: Request,
                     db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    releasing = request.url.path.endswith('/publish')
    if releasing:
        await validate_publish(db, user, body.definition)
    else:
        await source_form(db, user, body.definition)
    values = {'draft': body.definition.model_dump(), 'revision': ComponentPage.revision + 1}
    if releasing:
        values['published_version'] = ComponentPage.published_version + 1
    updated = await db.execute(update(ComponentPage).where(ComponentPage.id == page.id,
        ComponentPage.tenant_id == page.tenant_id, ComponentPage.revision == body.expectedRevision).values(**values))
    if updated.rowcount != 1:
        raise HTTPException(409, '页面已被其他编辑更新，请重新加载')
    await db.refresh(page)
    if releasing:
        db.add(ComponentPageVersion(tenant_id=page.tenant_id, page_id=page.id, version=page.published_version,
                                   definition=body.definition.model_dump(), published_by=current_user_id(user)))
    await change_audit(db, tenant_id=page.tenant_id, user_id=current_user_id(user),
                       action='publish' if releasing else 'save_draft', resource_type='component_page',
                       resource_id=page.id, new_values={'revision': page.revision, 'version': page.published_version})
    await db.commit()
    return await editor_payload(db, page)


@router.get('/{code}')
async def get_page(code: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    page = await find_page(db, user, code)
    definition = await published(db, page)
    if definition is None:
        raise HTTPException(404, '页面尚未发布')
    await check_audience(db, user, definition)
    host = await bound_host(db, page)
    if host:
        await check_host(db, user, host)
    return {'code': code, 'definition': definition, 'publishedVersion': page.published_version,
            'hostForm': host_payload(host) if host else None}


@router.post('/{code}/data')
async def page_data(code: str, query: RuntimeQuery, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    page = await find_page(db, user, code)
    payload = await get_page(code, db, user)
    definition = PageDefinition.model_validate(payload['definition'])
    data = await runtime_data(db, user, page, definition, query.filters, query.widget_filters)
    return {'publishedVersion': page.published_version, 'analyticsData': data}


@router.post('/{code}/preview')
async def preview_page(code: str, body: PagePreview, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    await validate_publish(db, user, body.definition)
    data = await runtime_data(db, user, page, body.definition, body.filters, body.widget_filters)
    return {'analyticsData': data}


async def runtime_data(db, user, page, definition, filters, widget_filters=None):
    widget_filters = widget_filters or {}
    statistical_ids = {w.id for w in definition.widgets if w.type in {'chart', 'metric'}}
    if set(widget_filters) - statistical_ids or any(len(value) > 2000 for conditions in widget_filters.values() for value in conditions.values()):
        raise HTTPException(422, '组件筛选目标无效或筛选值过长')
    if set(filters) - set(definition.filterFields) or any(len(value) > 2000 for value in filters.values()):
        raise HTTPException(422, '筛选字段未配置或筛选值过长')
    form = await source_form(db, user, definition)
    if not any(w.type in {'metric', 'chart'} for w in definition.widgets):
        records = await authorized_records(db, user, form, decorate=False)
        fields = await runtime_fields(db, form)
        visible = await allowed_form_fields(user, form.id, 'view', fields, db)
        if set(definition.filterFields) - visible:
            raise HTTPException(403, '无权查看页面筛选字段')
        options = {field: sorted({str(record['data'][field]) for record in records
                                 if record['data'].get(field) is not None})[:500]
                   for field in definition.filterFields}
        return {'filterOptions': options, 'errors': []}
    return await load_data(db, page.tenant_id, form, analytics_design(definition), user=user, filters=filters, widget_filters=widget_filters)
