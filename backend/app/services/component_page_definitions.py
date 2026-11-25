"""Component page definition schema, publish validation, and access checks."""
from __future__ import annotations

import ast
import re
from contextlib import contextmanager
from typing import Annotated, Literal
from fastapi import HTTPException
from pydantic import AfterValidator, BaseModel, Field, SerializerFunctionWrapHandler, model_serializer, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.principal import current_tenant_id
from app.core.production_errors import coded_error
from app.core.permissions import get_user_role_ids, has_form_permission
from app.models.relational import ComponentPage, ComponentPageVersion, Form, Role, User, OrgUnit
from app.services.form_application_lifecycle import APPROVAL_STATUS_FIELD
from app.services.records import RECORD_LIST_METADATA_FIELDS, runtime_fields
from app.services.analytics_runtime import source_errors, design_errors


class WidgetAppearance(BaseModel):
    surface: Literal['plain', 'soft', 'card'] | None = None
    headingStyle: Literal['inline', 'bar'] | None = None
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
    actions: list[Literal['create', 'refresh', 'import', 'export', 'copy', 'disable', 'delete']] = Field(default_factory=list, max_length=7)


SYSTEM_DISPLAY_COLUMNS = RECORD_LIST_METADATA_FIELDS | {APPROVAL_STATUS_FIELD}
MAX_BUSINESS_DISPLAY_COLUMNS = 100


def _check_business_display_columns(columns: list[str]) -> list[str]:
    if sum(column not in SYSTEM_DISPLAY_COLUMNS for column in columns) > MAX_BUSINESS_DISPLAY_COLUMNS:
        raise ValueError(f'列表最多配置 {MAX_BUSINESS_DISPLAY_COLUMNS} 个业务列')
    return columns


DisplayColumns = Annotated[
    list[str],
    Field(max_length=MAX_BUSINESS_DISPLAY_COLUMNS + len(SYSTEM_DISPLAY_COLUMNS)),
    AfterValidator(_check_business_display_columns),
]


class DisplayGroup(ToolbarGroup):
    columns: DisplayColumns | None = None
    approvalStatusConfigured: bool | None = None
    recordMetadataConfigured: bool | None = None


class FilterToolbarGroup(ToolbarGroup):
    actions: list[Literal['query', 'reset']] = Field(default_factory=list, max_length=2)


class FilterScheme(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=50)
    showKeyword: bool = False
    defaultRows: int | None = Field(default=None, ge=0, le=12, strict=True)
    fieldsPerRow: int | None = Field(default=None, ge=1, le=6, strict=True)
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
    displayGroups: list[DisplayGroup] | None = Field(default=None, max_length=20)
    toolbarGroups: list[ToolbarGroup] | None = Field(default=None, max_length=20)
    columns: DisplayColumns | None = Field(default=None, min_length=1)
    pageSize: int | None = Field(default=None, ge=1, le=200)
    defaultSort: ListSort | None = None
    rowClick: Literal['none', 'detail', 'edit'] | None = None
    toolbarActions: list[Literal['create', 'refresh', 'import', 'export', 'copy', 'delete']] | None = None
    rowActions: list[Literal['detail', 'edit', 'delete']] | None = None
    selection: Literal['none', 'single', 'multiple'] = 'none'
    emptyText: str = Field(default='暂无符合条件的数据', min_length=1, max_length=100)


class DataBinding(BaseModel):
    formId: int = Field(gt=0)


class ContainerPresentation(BaseModel):
    surface: Literal['plain', 'soft', 'card'] | None = None
    background: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    border: Literal['none', 'light', 'strong'] | None = None
    shadow: Literal['none', 'soft'] | None = None
    radius: int | None = Field(default=None, ge=0, le=24)
    padding: int | None = Field(default=None, ge=0, le=48)


class HeaderPresentation(BaseModel):
    visible: bool | None = None
    titleVisible: bool | None = None
    descriptionVisible: bool | None = None
    actionsVisible: bool | None = None
    layout: Literal['inline', 'stack'] | None = None
    divider: bool | None = None
    padding: int | None = Field(default=None, ge=0, le=48)


class ContentPresentation(BaseModel):
    density: Literal['compact', 'standard', 'comfortable'] | None = None
    gap: int | None = Field(default=None, ge=0, le=48)
    innerSurface: Literal['plain', 'soft', 'card'] | None = None
    innerTitles: bool | None = None
    separators: bool | None = None
    overflow: Literal['auto', 'hidden'] | None = None


class ComponentPresentation(BaseModel):
    container: ContainerPresentation | None = None
    header: HeaderPresentation | None = None
    content: ContentPresentation | None = None

    @model_serializer(mode='wrap')
    def serialize_overrides(self, serialize: SerializerFunctionWrapHandler):
        # Missing values inherit. In particular, an explicit null background
        # overrides a page color with the automatic surface color.
        result = {}
        for name, values in serialize(self).items():
            if name not in self.model_fields_set:
                continue
            section = getattr(self, name)
            result[name] = None if section is None else {
                key: value for key, value in values.items() if key in section.model_fields_set
            }
        return result


class PageWidget(BaseModel):
    accessGroups: list[ToolbarGroup] | None = Field(default=None, max_length=20)
    id: str = Field(min_length=1, max_length=100)
    type: Literal['record-list', 'record-filter', 'metric', 'chart', 'workspace']
    workspaceModule: Literal['overview', 'continuation', 'recent', 'support', 'forms'] | None = None
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
    heightPercent: Literal[25, 33, 50, 75, 100] | None = None
    height: int = Field(default=280, ge=160, le=600)
    showFilters: bool = True
    standaloneFilter: bool | None = Field(default=None, exclude_if=lambda enabled: not enabled)
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
    presentation: ComponentPresentation | None = None


class PageStyle(BaseModel):
    componentDefaults: ComponentPresentation | None = None
    componentSurface: Literal['plain', 'soft', 'card'] | None = None
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


class ComponentPublishValidationError(HTTPException):
    def __init__(self, error: HTTPException, widget_ids: list[str], target: Literal['data', 'interaction']):
        super().__init__(error.status_code, detail=error.detail, headers=error.headers)
        self.widget_targets = dict.fromkeys(widget_ids, target)


@contextmanager
def _publish_target(widget_ids: list[str], target: Literal['data', 'interaction'] = 'data'):
    try:
        yield
    except ComponentPublishValidationError:
        raise
    except HTTPException as error:
        if widget_ids and error.status_code == 422 and isinstance(error.detail, str):
            raise ComponentPublishValidationError(error, widget_ids, target) from error
        raise


def source_definitions(definition):
    groups = {}
    for widget in definition.widgets:
        if widget.type == 'workspace':
            continue
        source_id = widget_source_id(definition, widget)
        if source_id is None:
            with _publish_target([widget.id]):
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
    legacy_filter_groups = widget.filterSettings.toolbarGroups if widget.type != 'record-list' else None
    return [*(widget.accessGroups or []), *(group for scheme in (widget.filterSettings.schemes or []) for group in scheme.groups),
            *(legacy_filter_groups or []), *(widget.listSettings.displayGroups or []), *(widget.listSettings.toolbarGroups or [])]


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
        with _publish_target([widget.id], 'interaction' if widget.type == 'chart' else 'data'):
            for target_id in widget.targetWidgetIds:
                target = by_id.get(target_id)
                if target is None or target.id == widget.id:
                    raise HTTPException(422, '组件联动目标不存在或指向自身')
                if widget_source_id(definition, target) != widget_source_id(definition, widget):
                    raise HTTPException(422, '当前联动仅支持相同业务数据来源的组件')
    for group in source_definitions(definition):
        await validate_source_publish(db, user, group)


async def validate_source_publish(db, user, definition):
    with _publish_target([widget.id for widget in definition.widgets]):
        form = await source_form(db, user, definition)
        if (form.config or {}).get('assemblyKind') in {'analysis', 'analytics', 'dashboard', 'report'} and not (form.config or {}).get('analyticsDesign'):
            raise HTTPException(422, '请在页面设置中选择业务表单作为数据来源')
        if form.status != 'published':
            raise HTTPException(422, '请先发布业务数据来源')
    fields = await runtime_fields(db, form)
    available = {f.field_name: f for f in fields if not f.archived}
    from app.services.form_runtime import _latest_form_version
    from app.services.form_published_payload import _published_form_payload
    version = await _latest_form_version(db, form.tenant_id, form.id)
    published_config = (_published_form_payload(form, version)['config'] if version else form.config) or {}
    view = published_config.get('viewConfig') or {}
    views = view.get('tabs') or [view]
    configured_filters = {item.get('fieldName') for current in views for item in current.get('filters', []) if item.get('enabled', True)}
    configured_columns = {item.get('fieldName') for current in views for item in current.get('table', {}).get('columns', []) if item.get('enabled', True)}
    references = set(definition.filterFields)
    target_ids = {widget.id for widget in definition.widgets if widget.type != 'record-filter'}
    list_ids = {widget.id for widget in definition.widgets if widget.type == 'record-list'}
    published_columns = configured_columns | SYSTEM_DISPLAY_COLUMNS if view else None
    references_by_widget = {}
    for widget in definition.widgets:
        with _publish_target([widget.id]):
            widget_references = _widget_publish_references(widget, target_ids, list_ids, published_columns, available)
        references.update(widget_references)
        references_by_widget[widget.id] = widget_references

    def widgets_referencing(fields):
        return [widget_id for widget_id, field_names in references_by_widget.items() if field_names & fields]

    if invalid_fields := references & RECORD_LIST_METADATA_FIELDS:
        with _publish_target(widgets_referencing(invalid_fields)):
            raise coded_error(422, 'COMPONENT_QUERY_INVALID', '记录元数据仅用于列表显示或记录列表的筛选方案')
    if APPROVAL_STATUS_FIELD in references:
        with _publish_target(widgets_referencing({APPROVAL_STATUS_FIELD})):
            raise coded_error(422, 'COMPONENT_QUERY_INVALID', '审批状态仅用于记录列表的筛选和显示')
    if invalid_fields := references - available.keys():
        with _publish_target(widgets_referencing(invalid_fields)):
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


def _widget_publish_references(widget, target_ids, list_ids, published_columns, available):
    references = set()
    if widget.type in {'record-filter', 'record-list'}:
        filter_system_fields = {APPROVAL_STATUS_FIELD} if (
            widget.type == 'record-list' or set(widget.targetWidgetIds) <= list_ids
        ) else set()
        schemes = widget.filterSettings.schemes
        if schemes is not None:
            if filter_system_fields:
                filter_system_fields = filter_system_fields | RECORD_LIST_METADATA_FIELDS
            if len({scheme.id for scheme in schemes}) != len(schemes):
                raise HTTPException(422, '筛选方案 ID 不能重复')
            for scheme in schemes:
                scheme_fields = {field for group in scheme.groups for field in (group.columns or [])}
                if set(scheme.fieldControls) - scheme_fields:
                    raise HTTPException(422, '筛选控件必须对应方案已启用的字段')
                if set(scheme.fieldControls) & RECORD_LIST_METADATA_FIELDS:
                    raise coded_error(422, 'COMPONENT_QUERY_INVALID', '记录系统字段使用固定的筛选控件')
                if len(scheme_fields) > 30:
                    raise HTTPException(422, '每个筛选方案最多配置 30 个字段')
                if len({group.id for group in scheme.groups}) != len(scheme.groups):
                    raise HTTPException(422, '筛选字段权限组 ID 不能重复')
                for group in scheme.groups:
                    if group.columns is None or len(set(group.columns)) != len(group.columns):
                        raise HTTPException(422, '筛选权限组需要配置不重复的字段')
                    references.update(set(group.columns) - filter_system_fields)

        if widget.type == 'record-filter' and (not widget.targetWidgetIds or set(widget.targetWidgetIds) - target_ids):
            raise HTTPException(422, '筛选组件需要关联有效的列表、指标或图表')
        if schemes is None:
            references.update((set(widget.filterFields or []) | set(widget.filterSettings.requiredFields)) - filter_system_fields)
        if schemes is None and widget.filterFields is not None and set(widget.filterSettings.requiredFields) - set(widget.filterFields):
            raise HTTPException(422, '必填筛选条件必须包含在组件筛选字段中')
        if schemes is None and not widget.filterSettings.showKeyword and widget.filterFields == []:
            raise HTTPException(422, '筛选组件至少需要一个筛选条件')
    if widget.type == 'record-list':
        columns = widget.listSettings.columns
        if columns is not None and len(set(columns)) != len(columns):
            raise HTTPException(422, '列表显示列不能重复')
        references.update(set(columns or []) - SYSTEM_DISPLAY_COLUMNS)
        if SYSTEM_DISPLAY_COLUMNS.intersection(widget.listSettings.sortableColumns or []):
            raise coded_error(422, 'COMPONENT_QUERY_INVALID', '系统显示列不支持排序')
        for group in widget.listSettings.displayGroups or []:
            if group.columns is None:
                raise HTTPException(422, '显示权限组需要配置显示列')
            if SYSTEM_DISPLAY_COLUMNS.intersection(group.sortableColumns or []):
                raise coded_error(422, 'COMPONENT_QUERY_INVALID', '系统显示列不支持排序')
            if group.sortableColumns is not None and set(group.sortableColumns) - set(group.columns):
                raise HTTPException(422, '允许排序字段必须为可见列')
            if group.defaultSort:
                references.add(group.defaultSort.field)
                if group.defaultSort.field not in group.columns or (group.sortableColumns is not None and group.defaultSort.field not in group.sortableColumns):
                    raise HTTPException(422, '权限组默认排序必须为本组可见且允许排序的字段')
            references.update(set(group.columns) - SYSTEM_DISPLAY_COLUMNS)
            if len(set(group.columns)) != len(group.columns) or (published_columns is not None and set(group.columns) - published_columns):
                raise HTTPException(422, '显示权限组包含重复或来源视图未开放的列')
        if published_columns is not None and columns is not None and set(columns) - published_columns:
            raise HTTPException(422, '列表显示列不属于来源发布视图')
        if widget.listSettings.defaultSort:
            references.add(widget.listSettings.defaultSort.field)
            if columns is not None and widget.listSettings.defaultSort.field not in columns:
                raise HTTPException(422, '默认排序字段必须在列表显示列中')
    if widget.type == 'chart' and not widget.dimension:
        raise HTTPException(422, '图表需要选择分组字段')
    if widget.dimension:
        references.add(widget.dimension)
    if widget.type == 'chart' and set(widget.targetWidgetIds) - (target_ids - {widget.id}):
        with _publish_target([widget.id], 'interaction'):
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
    return references


async def list_pages(*, db: AsyncSession, user):
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
