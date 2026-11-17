"""Component page creation, editing, saving, and runtime data reads."""
from __future__ import annotations

from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.principal import current_tenant_id, current_user_id
from app.core.permissions import get_user_role_ids, allowed_form_fields
from app.models.relational import ComponentPage, ComponentPageVersion, OrgUnit, UserOrgMembership
from app.services.records import runtime_fields, change_audit
from app.services.analytics_data import load_data
from app.services.component_page_definitions import PageDefinition, analytics_design, bound_host, check_audience, check_host, find_page, published, source_definitions, source_form, validate_draft_sources, validate_publish


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


def host_payload(form):
    return {'id': form.id, 'code': form.code, 'name': form.name, 'status': form.status,
            'kind': (form.config or {}).get('assemblyKind', 'interaction')}


async def editor_payload(db, page):
    host = await bound_host(db, page)
    return {'code': page.code, 'revision': page.revision, 'publishedVersion': page.published_version,
            'definition': page.draft, 'publishedDefinition': await published(db, page),
            'hostForm': host_payload(host) if host else None}


async def save_page_definition(code, body, db, user, *, releasing):
    page = await find_page(db, user, code)
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
    if widget.get('type') == 'record-list':
        actions = list(dict.fromkeys(action for group in groups for action in group.get('actions', [])
                                     if action in {'query', 'reset'}))
        matching = [{'id': 'default-filter-buttons', 'name': '查询与重置按钮',
                     'roleIds': [], 'actions': actions}]
    else:
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
    if not visible and widget.get('type') != 'record-list':
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
        fields = await runtime_fields(db, form)
        visible = await allowed_form_fields(user, form.id, 'view', fields, db)
        if set(definition.filterFields) - visible:
            raise HTTPException(403, '无权查看页面筛选字段')
        from app.services.plain_aggregates import distinct_values
        return {'filterOptions': await distinct_values(db, user, form, list(definition.filterFields)), 'errors': []}
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


async def create_page_draft(db, user, definition: PageDefinition):
    await validate_draft_sources(db, user, definition)
    page = ComponentPage(tenant_id=current_tenant_id(user), code=f'page-{uuid4().hex[:12]}',
                         draft=definition.model_dump(), revision=1, published_version=0)
    db.add(page)
    await db.flush()
    await change_audit(db, tenant_id=page.tenant_id, user_id=current_user_id(user), action='create',
                       resource_type='component_page', resource_id=page.id, new_values=page.draft)
    return page


async def create_page(*, definition: PageDefinition, db: AsyncSession, user):
    page = await create_page_draft(db, user, definition)
    await db.commit()
    return await editor_payload(db, page)


async def get_editor(*, code: str, db: AsyncSession, user):
    return await editor_payload(db, await find_page(db, user, code))


async def get_page(*, code: str, db: AsyncSession, user):
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


async def page_data(*, code: str, query: RuntimeQuery, db: AsyncSession, user):
    page = await find_page(db, user, code)
    payload = await get_page(code=code, db=db, user=user)
    definition = PageDefinition.model_validate(payload['definition'])
    data = await runtime_data(db, user, page, definition, query.filters, query.widget_filters, query.filter_queries, query.chart_values)
    return {'publishedVersion': page.published_version, 'analyticsData': data}
