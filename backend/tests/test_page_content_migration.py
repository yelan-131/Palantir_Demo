import copy
import pytest
from sqlalchemy import select

from tests.test_component_pages import pages_environment
from tests.test_record_service import environment, seed
from app.models.relational import ComponentPage, Form
from app.services.page_content_migration import content_definition, populate_pages


@pytest.mark.asyncio
async def test_population_preserves_records_and_customized_pages(pages_environment):
    db, form, user, client = pages_environment
    await seed(db, 'Existing business content')
    original = copy.deepcopy(form.config)
    result = await populate_pages(db)
    assert result[0]['status'] == 'ready'
    assert not (await db.scalars(select(ComponentPage))).all()
    await populate_pages(db, apply=True)
    page = await db.scalar(select(ComponentPage))
    assert [w['type'] for w in page.draft['widgets']] == ['record-filter', 'record-list']
    assert page.draft['sourceFormId'] == form.id
    snapshot = copy.deepcopy(page.draft)
    assert (await populate_pages(db, apply=True))[0]['status'] == 'preserved'
    assert page.draft == snapshot
    assert form.status == 'published'
    assert len((await client.get('/forms/1/records')).json()['data']) == 1
    assert all(form.config[key] == value for key, value in (original or {}).items())


@pytest.mark.asyncio
async def test_board_content_keeps_metrics_formulas_sources_and_filter_links(pages_environment):
    db, form, user, client = pages_environment
    await seed(db, 'Real board source')
    host = Form(id=8, tenant_id=1, code='migrate-board', name='负荷分析', status='published', config={
        'assemblyKind': 'analysis', 'analyticsDesign': {
            'datasets': [{'id': 'data', 'source': form.code, 'dimensions': ['title'], 'measures': ['qty'], 'refreshMode':'scheduled', 'refreshInterval':7200}],
            'metrics': [{'id': 'total', 'name': '负荷数量', 'expression': 'sum(qty)', 'datasetId': 'data'},
                        {'id': 'avg', 'name': '平均负荷', 'expression': 'sum(qty) / count()', 'datasetId': 'data'}],
            'widgets': [{'id': 'cards', 'title': '负荷指标', 'type': 'metric-card', 'metricIds': ['total', 'avg']},
                        {'id': 'chart', 'title': '负荷趋势', 'type': 'line', 'metricIds': ['total'], 'dimension': 'title'},
                        {'id': 'detail', 'title': '负荷明细', 'type': 'detail-table', 'datasetId': 'data'}],
            'globalFilters': ['title'], 'interactions': [{'sourceWidgetId': 'chart', 'targetWidgetId': 'detail', 'action': 'filter'},
                {'sourceWidgetId': 'chart', 'targetWidgetId': 'cards', 'action': 'filter'}]}})
    db.add(host)
    await db.commit()
    definition = await content_definition(db, host)
    assert len(definition.widgets) == 5
    assert definition.style.refreshInterval == 7200
    assert definition.widgets[1].width == 12
    assert definition.widgets[1].appearance.subtitle == '负荷指标'
    assert definition.widgets[0].targetWidgetIds == ['cards', 'cards-1', 'chart', 'detail']
    assert definition.widgets[2].expression == 'sum(qty) / count()'
    assert definition.widgets[3].targetWidgetIds == ['detail', 'cards', 'cards-1']
    user['is_admin'] = True
    response = await client.post('/pages', json=definition.model_dump())
    page = response.json()
    response = await client.post(f'/pages/{page["code"]}/preview', json={'definition': definition.model_dump()})
    assert response.status_code == 200, response.text
    assert response.json()['analyticsData']['metricValues']['cards-1'] == 2
    config = copy.deepcopy(host.config)
    config['analyticsDesign']['widgets'][0]['metricIds'] = ['missing-metric']
    host.config = config
    with pytest.raises(ValueError, match='指标不存在'):
        await content_definition(db, host)


@pytest.mark.asyncio
async def test_shared_component_metric_updates_atomically_and_keeps_old_versions(pages_environment):
    from tests.test_analytics_metric_library import library, publish, definition as metric_definition
    db, form, user, client = pages_environment
    await seed(db, 'Source quantity')
    user['is_admin'] = True
    item = await library(client)
    value = {'title': '共享组件页', 'sourceFormId': form.id, 'widgets': [
        {'id': 'shared', 'type': 'metric', 'title': '共享数量', 'expression': 'sum(qty)',
         'sharedMetricId': item['id'], 'sharedMetricVersion': item['publishedVersion'],
         'sharedFields': ['qty']}]}
    page = (await client.post('/pages', json=value)).json()
    response = await client.post(f'/pages/{page["code"]}/publish', json={'definition':page['definition'], 'expectedRevision':page['revision']})
    assert response.status_code == 200, response.text
    references = (await client.get(f'/dashboard/analytics/metrics/{item["id"]}/references')).json()
    assert references['counts']['publishedPages'] == 1
    editor = (await client.get(f'/pages/{page["code"]}/editor')).json()
    changed = copy.deepcopy(editor['definition'])
    changed['title'] = '未发布的标题'
    assert (await client.put(f'/pages/{page["code"]}/draft', json={'definition':changed, 'expectedRevision':editor['revision']})).status_code == 200
    response = await publish(client, item, metric_definition(expression='sum(qty) * 3'))
    assert response.status_code == 200, response.text
    data = (await client.post(f'/pages/{page["code"]}/data', json={})).json()
    assert data['publishedVersion'] == 2
    assert data['analyticsData']['metricValues']['shared'] == 6
    editor = (await client.get(f'/pages/{page["code"]}/editor')).json()
    assert editor['definition']['widgets'][0]['sharedMetricVersion'] == 2
    assert editor['definition']['title'] == '未发布的标题'
    assert editor['publishedDefinition']['title'] == '共享组件页'
    from app.models.relational import ComponentPageVersion
    original = await db.scalar(select(ComponentPageVersion).where(ComponentPageVersion.version == 1))
    assert original.definition['widgets'][0]['sharedMetricVersion'] == 1


@pytest.mark.asyncio
async def test_content_upgrade_only_replaces_exact_old_converter_output(pages_environment):
    from app.services.page_content_migration import upgrade_content_pages
    db, form, user, client = pages_environment
    form.config = {'analyticsDesign': {
        'datasets':[{'id':'data','source':form.code,'refreshMode':'realtime','dimensions':['title'],'measures':['qty']}],
        'metrics':[{'id':'metric','name':'数量','datasetId':'data','expression':'sum(qty)'}],
        'widgets':[{'id':'card','title':'指标组','type':'metric-card','metricIds':['metric'],'width':'quarter'}]}}
    desired = await content_definition(db, form)
    old = desired.model_copy(deep=True)
    old.style.refreshInterval = 0
    old.widgets[0].width = 6
    page = ComponentPage(tenant_id=1, code='upgrade-safe', draft=old.model_dump(), revision=1, published_version=0)
    db.add(page)
    form.config = {**form.config, 'componentPageCode':page.code}
    await db.commit()
    assert (await upgrade_content_pages(db))[0]['status'] == 'ready'
    await upgrade_content_pages(db, apply=True)
    assert page.draft['style']['refreshInterval'] == 60
    assert page.draft['widgets'][0]['width'] == 6
    customized = copy.deepcopy(page.draft)
    customized['title'] = '用户修改的标题'
    page.draft = customized
    await db.commit()
    assert (await upgrade_content_pages(db, apply=True))[0]['status'] == 'preserved'
    assert page.draft['title'] == '用户修改的标题'


@pytest.mark.asyncio
async def test_unified_alert_list_excludes_legacy_material_requests(pages_environment):
    db, form, user, client = pages_environment
    await seed(db, 'Normal equipment alert')
    await seed(db, '新增料号申请：MAT-001')
    form.code = 'alert-center'
    await db.commit()
    user['is_admin'] = True
    response = await client.get('/forms/1/records')
    assert response.status_code == 200, response.text
    assert [row['data']['title'] for row in response.json()['data']] == ['Normal equipment alert']
