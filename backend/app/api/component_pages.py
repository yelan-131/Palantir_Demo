"""Independent pages with versioned, per-component business data bindings."""
from __future__ import annotations

import ast
import re

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user, require_admin, current_tenant_id, current_user_id
from app.core.permissions import get_user_role_ids, allowed_form_fields, has_form_permission
from app.models.relational import ComponentPage, ComponentPageVersion, Form, Role, SystemSetting, User, OrgUnit, UserOrgMembership
from app.services.records import runtime_fields, change_audit, authorized_records
from app.services.analytics_data import load_data
from app.services.analytics_runtime import source_errors, design_errors

router = APIRouter()


class WidgetAppearance(BaseModel):
    widthColumns: int | None = Field(default=None, ge=3, le=12)
    cardHeight: int | None = Field(default=None, ge=160, le=960)
    infoTextMode: Literal['auto', 'custom'] = 'auto'
    infoText: str = Field(default='', max_length=500)
    legendFontSize: int = Field(default=11, ge=10, le=20)
    legendItemGap: int = Field(default=10, ge=4, le=32)
    legendSelectable: bool = True
    legendOrient: Literal['auto', 'horizontal', 'vertical'] = 'auto'
    labelFontSize: int = Field(default=11, ge=10, le=20)
    labelPosition: Literal['top', 'bottom', 'inside', 'outside', 'right'] | None = None
    gridLineType: Literal['solid', 'dashed', 'dotted'] = 'dashed'
    axisLabelFontSize: int = Field(default=11, ge=10, le=20)
    axisLabelRotate: int = Field(default=0, ge=0, le=90)
    height: int = Field(default=280, ge=200, le=640)
    legendPosition: Literal['top', 'bottom', 'left', 'right'] = 'top'
    showGrid: bool = True
    showAxisLabels: bool = True
    horizontal: bool = False
    barWidth: int = Field(default=42, ge=8, le=80)
    lineWidth: float = Field(default=2.5, ge=1, le=8)
    symbolSize: int = Field(default=6, ge=0, le=16)
    pieInnerRadius: int = Field(default=48, ge=0, le=80)
    pieOuterRadius: int = Field(default=70, ge=40, le=90)
    tableDensity: Literal['compact', 'standard', 'comfortable'] | None = None
    tablePageSize: int = Field(default=10, ge=5, le=100)
    showTableHeader: bool = True
    tableStriped: bool = False
    tableBordered: bool = False
    tableAlign: Literal['left', 'center', 'right'] = 'left'
    cardOpacity: float | None = Field(default=None, ge=0.3, le=1)
    cardBlur: int | None = Field(default=None, ge=0, le=24)
    groupBackground: bool = False
    showTitle: bool = True
    showMetricLabel: bool = True
    showMetricInfo: bool = True
    titleFontSize: int = Field(default=12, ge=10, le=24)
    titleAlign: Literal['left', 'center', 'right'] = 'left'
    titleFontFamily: str | None = Field(default=None, max_length=100)
    titleColor: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    titleWeight: Literal['normal', 'bold'] | None = None
    titleItalic: bool = False
    titleGap: int = Field(default=0, ge=0, le=40)
    valueFontSize: int = Field(default=30, ge=16, le=64)
    contentPadding: int = Field(default=18, ge=0, le=40)
    contentAlign: Literal['left', 'center', 'right'] = 'left'
    metricColumns: int | None = Field(default=None, ge=1, le=6)
    subtitle: str = Field(default='', max_length=160)
    showSubtitle: bool = True
    subtitleFontSize: int = Field(default=12, ge=10, le=24)
    subtitleColor: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    subtitleAlign: Literal['left', 'center', 'right'] = 'left'
    palette: Literal['manufacturing', 'business', 'warning', 'mono'] | None = None
    radius: int | None = Field(default=None, ge=0, le=24)
    showLegend: bool = True
    showLabels: bool = False
    smooth: bool = False


class ListSort(BaseModel):
    field: str = Field(min_length=1, max_length=200)
    order: Literal['asc', 'desc'] = 'asc'


class ToolbarGroup(BaseModel):
    pageSize: int | None = Field(default=None, ge=1, le=200)
    emptyText: str | None = Field(default=None, max_length=100)
    defaultSort: ListSort | None = None
    inheritDefaultSort: bool = True
    sortableColumns: list[str] | None = Field(default=None, max_length=100)
    columns: list[str] | None = Field(default=None, max_length=100)
    userIds: list[int] = Field(default_factory=list, max_length=100)
    orgUnitIds: list[int] = Field(default_factory=list, max_length=100)
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=50)
    roleIds: list[int] = Field(default_factory=list, max_length=100)
    actions: list[Literal['create', 'refresh', 'import', 'export', 'disable', 'delete']] = Field(default_factory=list, max_length=6)


class FilterToolbarGroup(ToolbarGroup):
    actions: list[Literal['query', 'reset']] = Field(default_factory=list, max_length=2)


class FilterScheme(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=50)
    showKeyword: bool = False
    fieldControls: dict[str, Literal['dropdown', 'radio', 'multi-dropdown', 'checkbox']] = Field(default_factory=dict, max_length=30)
    groups: list[ToolbarGroup] = Field(default_factory=list, max_length=20)


class FilterSettings(BaseModel):
    schemes: list[FilterScheme] | None = Field(default=None, min_length=1, max_length=12)
    toolbarGroups: list[FilterToolbarGroup] | None = Field(default=None, max_length=20)
    queryMode: Literal['submit', 'change'] = 'submit'
    resetMode: Literal['defaults', 'clear'] = 'defaults'
    showKeyword: bool = True
    expandAdvanced: bool = False
    requiredFields: list[str] = Field(default_factory=list, max_length=30)
    queryLabel: str = Field(default='查询', min_length=1, max_length=20)
    resetLabel: str = Field(default='重置', min_length=1, max_length=20)


class ListSettings(BaseModel):
    sortableColumns: list[str] | None = Field(default=None, max_length=100)
    displayGroups: list[ToolbarGroup] | None = Field(default=None, max_length=20)
    toolbarGroups: list[ToolbarGroup] | None = Field(default=None, max_length=20)
    columns: list[str] | None = Field(default=None, min_length=1, max_length=100)
    pageSize: int | None = Field(default=None, ge=1, le=200)
    defaultSort: ListSort | None = None
    rowClick: Literal['none', 'detail', 'edit'] | None = None
    toolbarActions: list[Literal['create', 'refresh', 'import', 'export']] | None = None
    rowActions: list[Literal['detail', 'edit', 'delete']] | None = None
    selection: Literal['none', 'single', 'multiple'] = 'none'
    emptyText: str = Field(default='暂无符合条件的数据', min_length=1, max_length=100)


class DataBinding(BaseModel):
    formId: int = Field(gt=0)


class PageWidget(BaseModel):
    accessGroups: list[ToolbarGroup] | None = Field(default=None, max_length=20)
    id: str = Field(min_length=1, max_length=100)
    type: Literal['record-list', 'record-filter', 'metric', 'chart']
    title: str = Field(min_length=1, max_length=100)
    width: Literal[6, 8, 12, 18, 24] = 24
    roleIds: list[int] = Field(default_factory=list, max_length=100)
    dataBinding: DataBinding | None = None
    dimension: str | None = Field(default=None, max_length=200)
    measure: str | None = Field(default=None, max_length=200)
    aggregate: Literal['count', 'sum', 'avg', 'min', 'max'] = 'count'
    expression: str | None = Field(default=None, max_length=512)
    sharedMetricId: str | None = Field(default=None, max_length=100)
    sharedMetricVersion: int | None = Field(default=None, gt=0)
    sharedFields: list[str] = Field(default_factory=list, max_length=200)
    customWidth: int | None = Field(default=None, ge=160, le=3840)
    customHeight: int | None = Field(default=None, ge=120, le=3000)
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
    gridSize: int = Field(default=44, ge=16, le=88)
    cardOpacity: float = Field(default=0.78, ge=0.3, le=1)
    cardBlur: int = Field(default=12, ge=0, le=24)
    componentGap: int = Field(default=16, ge=0, le=32)
    cardRadius: int = Field(default=12, ge=0, le=20)
    preset: Literal['clean', 'factory', 'executive'] = 'clean'
    background: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    cardBorder: Literal['none', 'light', 'strong'] = 'light'
    chartPalette: Literal['manufacturing', 'business', 'warning', 'mono'] = 'manufacturing'
    tableDensity: Literal['compact', 'standard', 'comfortable'] | None = None
    filterTheme: Literal['toolbar', 'inline', 'panel'] = 'toolbar'
    refreshInterval: int = Field(default=0, ge=0, le=86400)


class PageDefinition(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    schemaVersion: Literal[1, 2] = 2
    sourceFormId: int | None = Field(default=None, gt=0)
    filterFields: list[str] = Field(default_factory=list, max_length=12)
    roleIds: list[int] = Field(default_factory=list, max_length=100)
    widgets: list[PageWidget] = Field(default_factory=list, max_length=30)
    style: PageStyle = Field(default_factory=PageStyle)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({w.id for w in self.widgets}) != len(self.widgets):
            raise ValueError('组件 ID 不能重复')
        if len(set(self.filterFields)) != len(self.filterFields) or any(not f or len(f) > 200 for f in self.filterFields):
            raise ValueError('筛选字段无效或重复')
        if any(value <= 0 for value in self.roleIds + [role for widget in self.widgets for role in widget.roleIds]):
            raise ValueError('角色 ID 无效')
        return self


class PageWrite(BaseModel):
    definition: PageDefinition
    expectedRevision: int = Field(gt=0)


class ComponentFilter(BaseModel):
    schemeId: str | None = Field(default=None, min_length=1, max_length=100)
    search: str = Field(default="", max_length=2000)
    filters: list[dict] = Field(default_factory=list, max_length=30)
    ready: bool = True


class RuntimeQuery(BaseModel):
    filters: dict[str, str] = Field(default_factory=dict, max_length=12)
    widget_filters: dict[str, dict[str, str]] = Field(default_factory=dict, max_length=30)
    filter_queries: dict[str, ComponentFilter] = Field(default_factory=dict, max_length=30)
    chart_values: dict[str, str] = Field(default_factory=dict, max_length=30)


class PagePreview(RuntimeQuery):
    definition: PageDefinition


class PageBinding(BaseModel):
    blank: bool = False
    populate: bool = False
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


def widget_source_id(definition, widget):
    # Missing binding inherits the old page-level source without rewriting records.
    return widget.dataBinding.formId if widget.dataBinding else definition.sourceFormId


def source_definitions(definition):
    groups = {}
    for widget in definition.widgets:
        source_id = widget_source_id(definition, widget)
        if source_id is None:
            raise HTTPException(422, f'请为组件「{widget.title}」选择业务数据来源')
        groups.setdefault(source_id, []).append(widget)
    if definition.filterFields:
        if definition.sourceFormId is None:
            raise HTTPException(422, '全局筛选需要选择默认业务数据来源')
        groups.setdefault(definition.sourceFormId, [])
    return [definition.model_copy(update={
        'sourceFormId': source_id, 'widgets': widgets,
        'filterFields': definition.filterFields if source_id == definition.sourceFormId else [],
    }) for source_id, widgets in groups.items()]


async def validate_draft_sources(db, user, definition):
    source_ids = {definition.sourceFormId} | {w.dataBinding.formId for w in definition.widgets if w.dataBinding}
    for source_id in source_ids - {None}:
        await source_form(db, user, definition.model_copy(update={'sourceFormId': source_id}))


async def source_form(db, user, definition):
    form = await db.get(Form, definition.sourceFormId)
    if form is None or form.tenant_id != current_tenant_id(user):
        raise HTTPException(422, '业务数据来源不存在')
    return form


def expression_fields(expression):
    from app.services.analytics_runtime import parse_expression
    root = parse_expression(expression, set(re.findall(r'\b[A-Za-z_]\w*\b', expression)))
    functions = {id(node.func) for node in ast.walk(root) if isinstance(node, ast.Call)}
    return {node.id for node in ast.walk(root) if isinstance(node, ast.Name) and id(node) not in functions}


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
        if widget.expression:
            measures.update(expression_fields(widget.expression))
        measures.update(widget.sharedFields if widget.sharedMetricId else [])
        metrics.append({'id': widget.id, 'name': widget.title, 'datasetId': 'source',
                        'expression': widget.expression or (f'{widget.aggregate}({widget.measure})' if widget.aggregate != 'count' else 'count()'),
                        'format': widget.format, 'unit': widget.unit, 'threshold': widget.threshold,
                        'sharedMetricId': widget.sharedMetricId, 'sharedMetricVersion': widget.sharedMetricVersion})
        widgets.append({'id': widget.id, 'title': widget.title, 'datasetId': 'source', 'metricIds': [widget.id],
                        'type': 'metric-card' if widget.type == 'metric' else widget.chartType, 'dimension': widget.dimension})
    return {'datasets': [{'id': 'source', 'name': '业务数据', 'sourceType': 'businessForm',
                          'source': str(definition.sourceFormId), 'refreshMode': 'manual',
                          'dimensions': sorted(dimensions), 'measures': sorted(measures)}],
            'metrics': metrics, 'widgets': widgets, 'globalFilters': definition.filterFields, 'interactions': []}


async def validate_toolbar_audiences(db, tenant_id, groups):
    for model, field in [(User, 'userIds'), (OrgUnit, 'orgUnitIds')]:
        ids = {value for group in groups for value in getattr(group, field)}
        valid = set((await db.scalars(select(model.id).where(model.tenant_id == tenant_id, model.id.in_(ids)))).all())
        if ids != valid:
            raise HTTPException(422, '适用对象不存在或不属于当前租户')


def widget_permission_groups(widget):
    return [*(widget.accessGroups or []), *(group for scheme in (widget.filterSettings.schemes or []) for group in scheme.groups), *(widget.filterSettings.toolbarGroups or []), *(widget.listSettings.displayGroups or []), *(widget.listSettings.toolbarGroups or [])]


async def validate_publish(db, user, definition):
    tenant_id = current_tenant_id(user)
    await validate_toolbar_audiences(db, tenant_id, [group for widget in definition.widgets for group in widget_permission_groups(widget)])
    requested_roles = set(definition.roleIds) | {role for widget in definition.widgets for role in widget.roleIds}
    requested_roles |= {role for widget in definition.widgets for group in widget_permission_groups(widget) for role in group.roleIds}
    roles = set((await db.scalars(select(Role.id).where(
        Role.tenant_id == tenant_id, Role.id.in_(requested_roles)))).all())
    if roles != requested_roles:
        raise HTTPException(422, '页面角色不属于当前租户')
    # Current interactions require the same source; cross-source mapping is a later feature.
    by_id = {w.id: w for w in definition.widgets}
    for widget in definition.widgets:
        for target_id in widget.targetWidgetIds:
            target = by_id.get(target_id)
            if target is None or target.id == widget.id:
                raise HTTPException(422, '组件联动目标不存在或指向自身')
            if widget_source_id(definition, target) != widget_source_id(definition, widget):
                raise HTTPException(422, '当前联动仅支持相同业务数据来源的组件')
    for group in source_definitions(definition):
        await validate_source_publish(db, user, group)


async def validate_source_publish(db, user, definition):
    form = await source_form(db, user, definition)
    if (form.config or {}).get('assemblyKind') in {'analysis', 'analytics', 'dashboard', 'report'} and not (form.config or {}).get('analyticsDesign'):
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
    target_ids = {widget.id for widget in definition.widgets if widget.type != 'record-filter'}
    for widget in definition.widgets:
        if widget.type == 'record-filter':
            schemes = widget.filterSettings.schemes
            if schemes is not None:
                if len({scheme.id for scheme in schemes}) != len(schemes):
                    raise HTTPException(422, '筛选方案 ID 不能重复')
                for scheme in schemes:
                    scheme_fields = {field for group in scheme.groups for field in (group.columns or [])}
                    if set(scheme.fieldControls) - scheme_fields:
                        raise HTTPException(422, '筛选控件必须对应方案已启用的字段')
                    if len(scheme_fields) > 30:
                        raise HTTPException(422, '每个筛选方案最多配置 30 个字段')
                    if len({group.id for group in scheme.groups}) != len(scheme.groups):
                        raise HTTPException(422, '筛选字段权限组 ID 不能重复')
                    for group in scheme.groups:
                        if group.columns is None or len(set(group.columns)) != len(group.columns):
                            raise HTTPException(422, '筛选权限组需要配置不重复的字段')
                        references.update(group.columns)

            if not widget.targetWidgetIds or set(widget.targetWidgetIds) - target_ids:
                raise HTTPException(422, '筛选组件需要关联有效的列表、指标或图表')
            references.update((widget.filterFields or []) if schemes is None else [])
            references.update(widget.filterSettings.requiredFields if schemes is None else [])
            if schemes is None and widget.filterFields is not None and set(widget.filterSettings.requiredFields) - set(widget.filterFields):
                raise HTTPException(422, '必填筛选条件必须包含在组件筛选字段中')
            if schemes is None and not widget.filterSettings.showKeyword and widget.filterFields == []:
                raise HTTPException(422, '筛选组件至少需要一个筛选条件')
        if widget.type == 'record-list':
            columns = widget.listSettings.columns
            if columns is not None and len(set(columns)) != len(columns):
                raise HTTPException(422, '列表显示列不能重复')
            references.update(columns or [])
            for group in widget.listSettings.displayGroups or []:
                if group.columns is None:
                    raise HTTPException(422, '显示权限组需要配置显示列')
                if group.sortableColumns is not None and set(group.sortableColumns) - set(group.columns):
                    raise HTTPException(422, '允许排序字段必须为可见列')
                if group.defaultSort:
                    references.add(group.defaultSort.field)
                    if group.defaultSort.field not in group.columns or (group.sortableColumns is not None and group.defaultSort.field not in group.sortableColumns):
                        raise HTTPException(422, '权限组默认排序必须为本组可见且允许排序的字段')
                references.update(group.columns)
                if len(set(group.columns)) != len(group.columns) or (view and set(group.columns) - configured_columns):
                    raise HTTPException(422, '显示权限组包含重复或来源视图未开放的列')
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
        if widget.expression and widget.type in {'metric', 'chart'}:
            from app.services.analytics_runtime import AnalyticsError, parse_expression
            try:
                parse_expression(widget.expression, set(available))
                references.update(expression_fields(widget.expression))
            except AnalyticsError as exc:
                raise HTTPException(422, str(exc)) from exc
        elif widget.aggregate != 'count':
            if widget.measure not in available or available[widget.measure].field_type not in {'int', 'integer', 'float', 'decimal', 'number'}:
                raise HTTPException(422, '求和需要有效的数值字段')
            references.add(widget.measure)
    if references - available.keys():
        raise HTTPException(422, '页面引用了不存在或已归档的字段')
    roles = set((await db.scalars(select(Role.id).where(Role.tenant_id == form.tenant_id, Role.id.in_(definition.roleIds)))).all())
    if roles != set(definition.roleIds):
        raise HTTPException(422, '页面角色不属于当前租户')
    if any(w.type in {'metric', 'chart'} for w in definition.widgets):
        from app.services.analytics_metric_library import hydrate_design
        design, errors = await hydrate_design(db, form.tenant_id, analytics_design(definition))
        errors += design_errors(design)
        errors += await source_errors(db, form.tenant_id, form, design,
                                     [{'field_name': f.field_name, 'archived': f.archived} for f in fields])
        if errors:
            raise HTTPException(422, {'message': '页面数据配置无效', 'errors': errors})


async def editor_payload(db, page):
    host = await bound_host(db, page)
    return {'code': page.code, 'revision': page.revision, 'publishedVersion': page.published_version,
            'definition': page.draft, 'publishedDefinition': await published(db, page),
            'hostForm': host_payload(host) if host else None}


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
async def create_page(definition: PageDefinition, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    await validate_draft_sources(db, user, definition)
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
                   if analysis else [{'id': 'filters', 'type': 'record-filter', 'title': '业务筛选', 'width': 24, 'targetWidgetIds': ['records']},
                                     {'id': 'records', 'type': 'record-list', 'title': form.name, 'width': 24, 'showFilters': False}])
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
async def write_page(code: str, body: PageWrite, request: Request,
                     db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    releasing = request.url.path.endswith('/publish')
    if releasing:
        await validate_publish(db, user, body.definition)
    else:
        await validate_draft_sources(db, user, body.definition)
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


def audience_matches(group, roles, user_id=None, org_unit_ids=None):
    return (not any(group.get(key) for key in ('roleIds', 'userIds', 'orgUnitIds'))
            or bool(roles.intersection(group.get('roleIds', [])))
            or user_id in group.get('userIds', [])
            or bool(set(org_unit_ids or []).intersection(group.get('orgUnitIds', []))))


def component_accessible(widget, roles, user_id=None, org_unit_ids=None):
    groups = widget.get('accessGroups')
    if groups is None:
        return not widget.get('roleIds') or bool(roles.intersection(widget['roleIds']))
    return any(audience_matches(group, roles, user_id, org_unit_ids) for group in groups)


def resolve_toolbar_groups(widget, roles, user_id=None, org_unit_ids=None):
    settings = widget.get('listSettings') or {}
    groups = settings.get('toolbarGroups')
    if groups is None:
        return widget
    matching = [group for group in groups if audience_matches(group, roles, user_id, org_unit_ids)]
    actions = list(dict.fromkeys(action for group in matching for action in group.get('actions', []) if action in {'create', 'refresh', 'import', 'export'}))
    return {**widget, 'listSettings': {**settings, 'toolbarGroups': matching, 'toolbarActions': actions}}


def resolve_filter_groups(widget, roles, user_id=None, org_unit_ids=None):
    settings = widget.get('filterSettings') or {}
    groups = settings.get('toolbarGroups')
    if groups is None:
        return widget
    matching = [group for group in groups if audience_matches(group, roles, user_id, org_unit_ids)]
    return {**widget, 'filterSettings': {**settings, 'toolbarGroups': matching}}


def resolve_filter_schemes(widget, roles, user_id=None, org_unit_ids=None):
    settings = widget.get('filterSettings') or {}
    schemes = settings.get('schemes')
    if schemes is None:
        return widget
    visible = []
    for scheme in schemes:
        groups = [group for group in scheme.get('groups', []) if audience_matches(group, roles, user_id, org_unit_ids)]
        if groups:
            visible_fields = {field for group in groups for field in (group.get('columns') or [])}
            controls = {field: mode for field, mode in (scheme.get('fieldControls') or {}).items() if field in visible_fields}
            visible.append({**scheme, 'groups': groups, 'fieldControls': controls})
    if not visible:
        return None
    return {**widget, 'filterSettings': {**settings, 'schemes': visible}}


def resolve_display_groups(widget, roles, user_id=None, org_unit_ids=None):
    settings = widget.get('listSettings') or {}
    groups = settings.get('displayGroups')
    if groups is None:
        return widget
    matching = [group for group in groups if audience_matches(group, roles, user_id, org_unit_ids)]
    columns = list(dict.fromkeys(column for group in matching for column in (group.get('columns') or [])))
    if not columns:
        return None
    presentation = {}
    for key in ('pageSize', 'emptyText'):
        value = next((group.get(key) for group in matching if group.get(key) is not None and (key != 'emptyText' or str(group[key]).strip())), None)
        if value is not None:
            presentation[key] = value
    return {**widget, 'listSettings': {**settings, **presentation, 'displayGroups': matching, 'columns': columns}}


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
    if not user.get('is_admin'):
        roles = set(await get_user_role_ids(user, db))
        org_unit_ids = set((await db.scalars(select(UserOrgMembership.org_unit_id).join(OrgUnit, OrgUnit.id == UserOrgMembership.org_unit_id).where(
            UserOrgMembership.tenant_id == current_tenant_id(user), UserOrgMembership.user_id == current_user_id(user),
            OrgUnit.tenant_id == current_tenant_id(user), OrgUnit.status == 'active'))).all())
        widgets = [w for w in definition.get('widgets', []) if component_accessible(w, roles, current_user_id(user), org_unit_ids)]
        widgets = [resolve_filter_groups(resolve_toolbar_groups(w, roles, current_user_id(user), org_unit_ids), roles, current_user_id(user), org_unit_ids) for w in widgets]
        widgets = [resolved for w in widgets if (resolved := resolve_display_groups(w, roles, current_user_id(user), org_unit_ids)) is not None]
        widgets = [resolved for w in widgets if (resolved := resolve_filter_schemes(w, roles, current_user_id(user), org_unit_ids)) is not None]
        visible_ids = {w['id'] for w in widgets}
        definition = {**definition, 'widgets': [{**w, 'targetWidgetIds': [target for target in w['targetWidgetIds'] if target in visible_ids]} if 'targetWidgetIds' in w else w for w in widgets]}
    return {'code': code, 'definition': definition, 'publishedVersion': page.published_version,
            'hostForm': host_payload(host) if host else None}


@router.post('/{code}/data')
async def page_data(code: str, query: RuntimeQuery, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    page = await find_page(db, user, code)
    payload = await get_page(code, db, user)
    definition = PageDefinition.model_validate(payload['definition'])
    data = await runtime_data(db, user, page, definition, query.filters, query.widget_filters, query.filter_queries, query.chart_values)
    return {'publishedVersion': page.published_version, 'analyticsData': data}


@router.post('/{code}/preview')
async def preview_page(code: str, body: PagePreview, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    await validate_publish(db, user, body.definition)
    data = await runtime_data(db, user, page, body.definition, body.filters, body.widget_filters, body.filter_queries, body.chart_values)
    return {'analyticsData': data}


async def runtime_data(db, user, page, definition, filters, widget_filters=None, filter_queries=None, chart_values=None):
    widget_filters = widget_filters or {}
    statistical_ids = {w.id for w in definition.widgets if w.type in {'metric', 'chart'}}
    if set(widget_filters) - statistical_ids:
        raise HTTPException(422, '组件筛选目标无效')
    if set(filters) - set(definition.filterFields):
        raise HTTPException(422, '筛选字段未配置')
    record_queries = linked_record_queries(definition, filter_queries or {}, chart_values or {})
    groups = source_definitions(definition)
    result = {'widgets': {}, 'metricValues': {}, 'filterOptions': {}, 'errors': [],
              'widgetErrors': {}, 'datasetSources': {}, 'fieldLabels': {}}
    for group in groups:
        ids = {w.id for w in group.widgets}
        try:
            data = await runtime_source_data(db, user, page, group,
                filters if group.sourceFormId == definition.sourceFormId else {},
                {key: value for key, value in widget_filters.items() if key in ids},
                {key: value for key, value in record_queries.items() if key in ids})
        except HTTPException as exc:
            # Keep the legacy single-source response; isolate unavailable sources on mixed pages.
            if len(groups) == 1 or exc.status_code not in {403, 404}:
                raise
            data = {'errors': ['此业务来源无权访问或已停用'],
                    'filterOptions': {field: [] for field in group.filterFields}}
        for key in ('widgets', 'metricValues'):
            result[key].update(data.get(key, {}))
        if group.sourceFormId == definition.sourceFormId:
            result['filterOptions'] = data.get('filterOptions', {})
        result['errors'].extend(data.get('errors', []))
        for widget in group.widgets:
            result['widgetErrors'][widget.id] = data.get('errors', []) + data.get('widgetErrors', {}).get(widget.id, [])
            if widget.type in {'metric', 'chart'}:
                result['metricValues'].setdefault(widget.id, None)
        result['datasetSources'][str(group.sourceFormId)] = str(group.sourceFormId)
        result['fieldLabels'][str(group.sourceFormId)] = data.get('fieldLabels', {}).get('source', {})
        if group.sourceFormId == definition.sourceFormId:
            result['fieldLabels']['source'] = data.get('fieldLabels', {}).get('source', {})
            result['datasetSources']['source'] = data.get('datasetSources', {}).get('source', str(group.sourceFormId))
    result['errors'] = list(dict.fromkeys(result['errors']))
    return result


async def runtime_source_data(db, user, page, definition, filters, widget_filters=None, record_queries=None):
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
    return await load_data(db, page.tenant_id, form, analytics_design(definition), user=user, filters=filters, widget_filters=widget_filters, widget_record_queries=record_queries)


def linked_record_queries(definition, filter_queries, chart_values):
    by_id = {widget.id: widget for widget in definition.widgets}
    result = {}
    for source_id, query in filter_queries.items():
        widget = by_id.get(source_id)
        if not widget or widget.type != 'record-filter':
            raise HTTPException(422, '筛选组件不存在或不可访问')
        scheme = None
        if widget.filterSettings.schemes is not None:
            scheme = next((item for item in widget.filterSettings.schemes if item.id == query.schemeId), None)
            if scheme is None:
                raise HTTPException(422, '筛选方案不存在或不可访问')
            allowed = {field for group in scheme.groups for field in (group.columns or [])}
        else:
            allowed = set(widget.filterFields) if widget.filterFields is not None else None
        for condition in query.filters:
            field, op = condition.get('field'), condition.get('op', 'equals')
            if not isinstance(field, str) or len(field)>200 or (allowed is not None and field not in allowed):
                raise HTTPException(422, '筛选字段未在组件中配置')
            if op not in {'contains', 'equals', 'between', 'gte', 'lte', 'in'}:
                raise HTTPException(422, '筛选操作符无效')
            value = condition.get('value')
            if isinstance(value, (dict, list)) and not (isinstance(value, list) and ((op == 'between' and len(value) == 2) or (op == 'in' and 0 < len(value) <= 100 and all(isinstance(item, (str, int, float, bool)) for item in value)))):
                raise HTTPException(422, '筛选值格式无效')
            if len(str(value))>2000:
                raise HTTPException(422, '筛选值过长')
        def filled(value):
            return value not in (None, '') and (not isinstance(value, list) or bool(value) and all(filled(part) for part in value))
        present = {c.get('field') for c in query.filters if filled(c.get('value'))}
        ready = query.ready and (scheme is not None or set(widget.filterSettings.requiredFields)<=present)
        for target in widget.targetWidgetIds:
            result.setdefault(target, []).append({'search': query.search if (scheme.showKeyword if scheme else widget.filterSettings.showKeyword) else '', 'filters': query.filters, 'ready': ready})
    # Missing required filters must block aggregates before a first query as well.
    for widget in definition.widgets:
        if widget.type == 'record-filter' and widget.id not in filter_queries and widget.filterSettings.schemes is None and widget.filterSettings.requiredFields:
            for target in widget.targetWidgetIds:
                result.setdefault(target, []).append({'ready': False, 'search': '', 'filters': []})
    for source_id, value in chart_values.items():
        widget = by_id.get(source_id)
        if not widget or widget.type != 'chart' or widget.interaction != 'filter' or not widget.dimension or len(value)>2000:
            raise HTTPException(422, '图表联动来源无效')
        for target in widget.targetWidgetIds:
            result.setdefault(target, []).append({'ready': True, 'search': '', 'filters': [{'field': widget.dimension, 'op': 'equals', 'value': value}]})
    return {target: {'ready': all(q['ready'] for q in queries), 'search': ' '.join(q['search'] for q in queries if q['search']), 'filters': [c for q in queries for c in q['filters']]} for target, queries in result.items()}

# A section release stores a complete runtime snapshot but merges only its own fields.
_SECTION_DATA = {'dataBinding', 'dimension', 'measure', 'aggregate', 'expression', 'sharedMetricId', 'sharedMetricVersion', 'sharedFields', 'filterFields', 'filterSettings'}
_SECTION_LIST_DATA = {'sortableColumns', 'displayGroups', 'columns', 'pageSize', 'defaultSort', 'emptyText'}
_SECTION_FILTER_DATA = {'showKeyword', 'expandAdvanced', 'requiredFields', 'schemes'}


def widget_section(widget, section):
    result = {k: v for k, v in widget.items() if k not in {'id', 'type', 'listSettings', 'filterSettings'} and ((k in _SECTION_DATA) == (section == 'data'))}
    result['listSettings'] = {k: v for k, v in (widget.get('listSettings') or {}).items() if ((k in _SECTION_LIST_DATA) == (section == 'data'))}
    result['filterSettings'] = {k: v for k, v in (widget.get('filterSettings') or {}).items() if ((k in _SECTION_FILTER_DATA) == (section == 'data'))}
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
                       'definition': item.definition} for item in versions]}


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
async def publish_section(code: str, widget_id: str, section: Literal['basic', 'data'], body: PageWrite,
                          db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    page = await find_page(db, user, code)
    definition = await published(db, page)
    if not definition:
        raise HTTPException(422, '请先发布页面首个版本，再独立发布组件页签')
    source = next((w.model_dump() for w in body.definition.widgets if w.id == widget_id), None)
    if source is None or not any(w['id'] == widget_id for w in definition['widgets']):
        raise HTTPException(422, '新组件请先通过页面发布')
    definition = {**definition, 'widgets': [merge_widget_section(w, source, section) if w['id'] == widget_id else w for w in definition['widgets']]}
    validated = PageDefinition.model_validate(definition)
    await validate_publish(db, user, validated)
    await validate_draft_sources(db, user, body.definition)
    updated = await db.execute(update(ComponentPage).where(ComponentPage.id == page.id,
        ComponentPage.tenant_id == page.tenant_id, ComponentPage.revision == body.expectedRevision).values(
        draft=body.definition.model_dump(), revision=ComponentPage.revision + 1, published_version=ComponentPage.published_version + 1))
    if updated.rowcount != 1:
        raise HTTPException(409, '页面已被其他编辑更新，请重新加载')
    await db.refresh(page)
    db.add(ComponentPageVersion(tenant_id=page.tenant_id, page_id=page.id, version=page.published_version,
                               definition=validated.model_dump(), published_by=current_user_id(user)))
    await change_audit(db, tenant_id=page.tenant_id, user_id=current_user_id(user), action='publish_section',
                       resource_type='component_page', resource_id=page.id,
                       new_values={'widget': widget_id, 'section': section, 'version': page.published_version})
    await db.commit()
    return await editor_payload(db, page)
