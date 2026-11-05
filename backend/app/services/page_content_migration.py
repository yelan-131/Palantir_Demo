"""Translate existing business content into editable component-page drafts."""
from copy import deepcopy
from uuid import uuid4

from sqlalchemy import select

from app.models.relational import Form, ComponentPage


async def content_definition(db, form):
    from app.api.component_pages import PageDefinition
    config = form.config or {}
    design = config.get('analyticsDesignDraft') or config.get('analyticsDesign')
    if not design:
        return PageDefinition(title=form.name, sourceFormId=form.id, widgets=[
            {'id': 'filters', 'type': 'record-filter', 'title': form.name + '筛选',
             'targetWidgetIds': ['records'], 'width': 24},
            {'id': 'records', 'type': 'record-list', 'title': form.name, 'width': 24,
             'showFilters': False}])
    sources = {f.code: f.id for f in (await db.scalars(select(Form).where(Form.tenant_id == form.tenant_id))).all()}
    sources.update({str(value): value for value in list(sources.values())})
    datasets = {item['id']: item for item in design.get('datasets', [])}
    metrics = {item['id']: item for item in design.get('metrics', [])}
    widgets, translated = [], {}
    for item in design.get('widgets', []):
        ids = item.get('metricIds') or []
        if item['type'] not in {'metric-card', 'detail-table', 'bar', 'line', 'pie', 'rank-table'}:
            raise ValueError(f"不支持迁移的组件类型：{item['type']}")
        entries = ids if item['type'] != 'detail-table' else [None]
        if not entries:
            raise ValueError(f"组件缺少指标：{item['title']}")
        translated[item['id']] = []
        for index, metric_id in enumerate(entries):
            if metric_id is not None and metric_id not in metrics:
                raise ValueError(f"组件引用的指标不存在：{metric_id}")
            metric = metrics.get(metric_id, {})
            dataset = datasets.get(metric.get('datasetId') or item.get('datasetId'), {})
            if dataset.get('sourceType', 'businessForm') != 'businessForm':
                raise ValueError('暂不支持迁移非业务表单数据来源')
            if dataset.get('rangeFilters'):
                raise ValueError('数据集包含范围条件，需要先补齐范围配置迁移')
            source = sources.get(str(dataset.get('source', '')))
            if not source:
                raise ValueError(f"来源不存在：{dataset.get('source')}")
            wid = item['id'] if index == 0 else f"{item['id']}-{index}"
            translated[item['id']].append(wid)
            kind = 'record-list' if item['type'] == 'detail-table' else 'metric' if item['type'] == 'metric-card' else 'chart'
            appearance = deepcopy(item.get('appearance') or {})
            columns = max(1, min(4, appearance.get('metricColumns') or len(entries)))
            widget = {'id': wid, 'type': kind, 'title': metric.get('name', item['title']) if kind == 'metric' else item['title'],
                      'width': (max(6, 24 // columns) if len(entries)>1 else {'full':24,'half':12,'wide':18,'quarter':6}.get(item.get('width'),24)) if kind == 'metric' else {'full': 24, 'half': 12, 'wide':18, 'quarter': 6}.get(item.get('width'), 12),
                      'dataBinding': {'formId': source}, 'appearance': appearance,
                      'interaction': item.get('interaction', 'none'), 'showFilters': False}
            if kind == 'record-list':
                widget['listSettings'] = {'toolbarActions': ['refresh', 'export'], 'rowActions': ['detail']}
            if appearance.get('height') is not None:
                widget['height'] = max(160, min(600, int(appearance['height'])))
            if kind != 'record-list':
                widget.update(expression=metric.get('expression') or 'count()', format=metric.get('format', 'number'),
                              unit=metric.get('unit', ''), threshold=metric.get('threshold', ''),
                              dimension=item.get('dimension'), chartType=item['type'] if kind == 'chart' else 'bar')
                if metric.get('sharedMetricId'):
                    widget.update(sharedMetricId=metric['sharedMetricId'], sharedMetricVersion=metric.get('sharedMetricVersion'),
                                  sharedFields=list(dict.fromkeys(dataset.get('dimensions', []) + dataset.get('measures', []))))
                if kind == 'metric' and len(entries) > 1:
                    appearance['subtitle'] = item['title']
                if metric.get('description') and not appearance.get('infoText'):
                    appearance.update(infoText=metric['description'], infoTextMode='custom')
            widgets.append(widget)
    for link in design.get('interactions', []):
        if link.get('action') != 'filter':
            continue
        targets = translated.get(link.get('targetWidgetId'), [])
        for widget in widgets:
            if widget['id'] in translated.get(link.get('sourceWidgetId'), []):
                widget['targetWidgetIds'] = list(dict.fromkeys(widget.get('targetWidgetIds', []) + targets))
    filters = design.get('globalFilters') or []
    # The legacy global filter bar is source scoped; retain one bar per dataset source.
    for source in dict.fromkeys(w['dataBinding']['formId'] for w in widgets):
        dataset_fields = set().union(*(set(d.get('dimensions', [])) for d in datasets.values() if sources.get(str(d.get('source'))) == source))
        fields = [field for field in filters if field in dataset_fields]
        if fields:
            widgets.insert(0, {'id': f'filters-{source}', 'type': 'record-filter', 'title': '筛选条件', 'width': 24,
                              'dataBinding': {'formId': source}, 'filterFields': fields,
                              'targetWidgetIds': [w['id'] for w in widgets if w['type'] != 'record-filter' and w['dataBinding']['formId'] == source],
                              'filterSettings': {'showKeyword': False}})
    style = {key: value for key, value in (design.get('style') or {}).items() if key in PageDefinition.model_fields['style'].annotation.model_fields}
    intervals = [int(d.get('refreshInterval') or 60) for d in datasets.values() if d.get('refreshMode') in {'scheduled', 'realtime'}]
    if intervals:
        style['refreshInterval'] = max(10, min(86400, min(intervals)))
    return PageDefinition(title=form.name, widgets=widgets, style=style)


async def populate_pages(db, *, apply=False):
    """Only initialize absent or untouched empty drafts. Never replace user content."""
    results = []
    if apply:
        from app.services.field_uniqueness import lock
        tenants = (await db.scalars(select(Form.tenant_id).distinct())).all()
        for tenant in sorted(tenants):
            await lock(db, tenant)
    forms = (await db.scalars(select(Form).where(Form.status != 'archived').order_by(Form.id).with_for_update())).all()
    for form in forms:
        config = dict(form.config or {})
        page = await db.scalar(select(ComponentPage).where(ComponentPage.tenant_id == form.tenant_id,
                    ComponentPage.code == config.get('componentPageCode'))) if config.get('componentPageCode') else None
        if page and (page.published_version or (page.draft or {}).get('widgets') or page.revision != 1):
            results.append({'form': form.code, 'status': 'preserved'})
            continue
        try:
            definition = await content_definition(db, form)
        except (ValueError, KeyError) as exc:
            results.append({'form': form.code, 'status': 'blocked', 'reason': str(exc)})
            continue
        results.append({'form': form.code, 'status': 'populated' if apply else 'ready', 'widgets': len(definition.widgets)})
        if not apply:
            continue
        if page:
            page.draft = definition.model_dump()
            page.revision += 1
        else:
            page = ComponentPage(tenant_id=form.tenant_id, code=f'page-{uuid4().hex[:12]}', draft=definition.model_dump(), revision=1, published_version=0)
            db.add(page)
        if not config.get('componentPageEnabled'):
            config['componentPageLegacyFallback'] = True
        config.update(componentPageEnabled=True, componentPageCode=page.code)
        form.config = config
    if apply:
        await db.commit()
    return results


async def upgrade_content_pages(db, *, apply=False):
    """Upgrade only exact, unpublished output of the previous converter."""
    from app.api.component_pages import PageDefinition
    results = []
    forms = (await db.scalars(select(Form).order_by(Form.id))).all()
    for form in forms:
        config = form.config or {}
        design = config.get('analyticsDesignDraft') or config.get('analyticsDesign')
        if not design or not config.get('componentPageCode'):
            continue
        page = await db.scalar(select(ComponentPage).where(ComponentPage.tenant_id == form.tenant_id,
            ComponentPage.code == config['componentPageCode']).with_for_update())
        if not page or page.published_version or page.revision > 2:
            results.append({'form': form.code, 'status': 'preserved'})
            continue
        desired = await content_definition(db, form)
        baseline = desired.model_copy(deep=True)
        baseline.style.refreshInterval = 0
        originals = {w['id']: w for w in design.get('widgets', [])}
        for widget in baseline.widgets:
            widget.sharedMetricId, widget.sharedMetricVersion, widget.sharedFields = None, None, []
            original = originals.get(widget.id) or next((w for key,w in originals.items() if widget.id.startswith(key+'-')), {})
            widget.appearance.metricColumns = None
            if widget.type == 'metric':
                widget.width = 6
                widget.appearance.subtitle = (original.get('appearance') or {}).get('subtitle', '')
        current = PageDefinition.model_validate(page.draft)
        if current.model_dump() == desired.model_dump():
            continue
        if current.model_dump() != baseline.model_dump():
            results.append({'form': form.code, 'status': 'preserved'})
            continue
        results.append({'form': form.code, 'status': 'upgraded' if apply else 'ready'})
        if apply:
            page.draft = desired.model_dump()
            page.revision += 1
    if apply:
        await db.commit()
    return results
