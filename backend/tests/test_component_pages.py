"""Independent page publication must preserve record, tenant and approval boundaries."""
import copy

import pytest
import pytest_asyncio
from sqlalchemy import select

from tests.test_record_service import environment, seed
from app.api import component_pages
from app.models.relational import ComponentPageVersion, FormPermission, RolePermission


@pytest_asyncio.fixture
async def pages_environment(environment):
    db, factory, form, user, client = environment
    client._transport.app.include_router(component_pages.router, prefix='/pages')
    yield db, form, user, client


def definition():
    return {'title': '混合工作台', 'sourceFormId': 1, 'filterFields': ['title'], 'roleIds': [],
            'widgets': [
                {'id': 'total', 'type': 'metric', 'title': '记录数', 'width': 6},
                {'id': 'quantity', 'type': 'metric', 'title': '数量', 'aggregate': 'sum', 'measure': 'qty', 'width': 6},
                {'id': 'chart', 'type': 'chart', 'title': '分组', 'dimension': 'title', 'width': 12},
                {'id': 'list', 'type': 'record-list', 'title': '业务列表', 'width': 24}]}


async def create_publish(client, user, value=None):
    user['is_admin'] = True
    response = await client.post('/pages', json=value or definition())
    assert response.status_code == 200, response.text
    page = response.json()
    response = await client.post(f'/pages/{page["code"]}/publish',
        json={'definition': page['definition'], 'expectedRevision': page['revision']})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_shared_form_lists_publish_as_an_application_page(environment, monkeypatch):
    from app.api import applications
    from app.api.deps import get_db
    from app.models.relational import Application

    db, factory, _, user, client = environment
    user['is_admin'] = True
    app_api = client._transport.app
    app_api.include_router(component_pages.router, prefix='/pages')
    app_api.include_router(applications.router, prefix='/applications')

    async def fresh_session():
        async with factory() as session:
            yield session

    async def query_fixture_database(query):
        async with factory() as session:
            return await query(session)

    app_api.dependency_overrides[get_db] = fresh_session
    monkeypatch.setattr(applications, 'safe_db_call', query_fixture_database)

    source_response = await client.post('/forms', json={
        'name': '业务申请', 'code': 'shared-request-source', 'config': {'assemblyKind': 'interaction'},
    })
    assert source_response.status_code == 200, source_response.text
    source_id = source_response.json()['data']['id']
    for name, label in [('title', '申请主题'), ('status', '处理状态')]:
        response = await client.post(f'/forms/{source_id}/fields', json={
            'field_name': name, 'label': label, 'field_type': 'string', 'sortable': True,
        })
        assert response.status_code == 200, response.text
    response = await client.post(f'/forms/{source_id}/publish')
    assert response.status_code == 200, response.text
    source_schema = await client.get(f'/forms/{source_id}?schema=published&scope=list')
    assert source_schema.status_code == 200, source_schema.text
    assert not source_schema.json()['data']['config']['viewConfig']
    for title, status in [('新申请', '待审批'), ('旧申请', '已通过')]:
        response = await client.post(f'/forms/{source_id}/records', json={'data': {'title': title, 'status': status}})
        assert response.status_code == 200, response.text

    draft = await client.post('/pages', json={'title': '申请处理'})
    assert draft.status_code == 200, draft.text
    page = draft.json()
    binding = {'formId': source_id}
    definition = {**page['definition'], 'widgets': [
        {'id': 'pending', 'type': 'record-list', 'title': '待审批申请', 'dataBinding': binding,
         'listSettings': {'columns': ['title', 'status'], 'rowClick': 'detail'}},
        {'id': 'approved', 'type': 'record-list', 'title': '已通过申请', 'dataBinding': binding,
         'listSettings': {'columns': ['status', 'title'], 'rowClick': 'none'}},
        {'id': 'filter', 'type': 'record-filter', 'title': '状态筛选', 'dataBinding': binding,
         'filterFields': ['status'], 'targetWidgetIds': ['pending']},
    ]}
    response = await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': definition, 'expectedRevision': page['revision'],
    })
    assert response.status_code == 200, response.text

    app = Application(tenant_id=1, name='申请管理', code='request-management', status='published')
    db.add(app)
    await db.commit()
    menu = await client.post(f'/forms/applications/{app.id}/menu-nodes', json={
        'title': '申请处理', 'node_type': 'page', 'page_code': page['code'],
    })
    assert menu.status_code == 200, menu.text
    menu_response = await client.get(f'/applications/{app.id}/menus')
    assert menu_response.status_code == 200, menu_response.text
    [entry] = menu_response.json()['data']
    assert entry['route_path'] == f'/pages/{page["code"]}'
    loaded = await client.get(entry['route_path'])
    assert loaded.status_code == 200, loaded.text
    first, second, filter_widget = loaded.json()['definition']['widgets']
    assert first['dataBinding'] == second['dataBinding'] == binding
    assert first['listSettings']['columns'] == ['title', 'status']
    assert second['listSettings']['columns'] == ['status', 'title']
    assert (first['listSettings']['rowClick'], second['listSettings']['rowClick']) == ('detail', 'none')
    assert filter_widget['targetWidgetIds'] == ['pending']
    records = await client.get(f'/forms/{source_id}/records')
    assert records.status_code == 200, records.text
    assert {row['data']['status'] for row in records.json()['data']} == {'待审批', '已通过'}


@pytest.mark.asyncio
async def test_page_drafts_do_not_publish_business_or_page_changes(pages_environment):
    db, form, user, client = pages_environment
    form.config = {'viewConfigDraft': {'privateDraft': True}, 'permissionDesignDraft': {'roles': {}},
                   'workflowDesigner': {'draftWorkflowId': 99}}
    await db.commit()
    before = copy.deepcopy(form.config)
    page = await create_publish(client, user)
    code = page['code']
    modified = {**page['definition'], 'title': '未发布标题'}
    response = await client.put(f'/pages/{code}/draft', json={'definition': modified, 'expectedRevision': page['revision']})
    assert response.status_code == 200, response.text
    assert (await client.get(f'/pages/{code}')).json()['definition']['title'] == '混合工作台'
    assert (await client.get(f'/pages/{code}/editor')).json()['definition']['title'] == '未发布标题'
    assert (await client.post(f'/pages/{code}/publish', json={'definition': modified, 'expectedRevision': page['revision']})).status_code == 409
    await db.refresh(form)
    assert form.config == before
    snapshots = (await db.scalars(select(ComponentPageVersion))).all()
    assert len(snapshots) == 1
    assert snapshots[0].definition['title'] == '混合工作台'


@pytest.mark.asyncio
async def test_filters_aggregate_all_authorized_records_and_reflect_writes(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'A'); await seed(db, 'B')
    page = await create_publish(client, user)
    user['is_admin'] = False
    path = f'/pages/{page["code"]}/data'
    data = (await client.post(path, json={'filters': {}})).json()['analyticsData']
    assert data['metricValues'] == {'total': 2, 'quantity': 4, 'chart': 2}
    assert not data['errors']
    filtered = (await client.post(path, json={'filters': {'title': 'A'}})).json()['analyticsData']
    assert filtered['metricValues']['total'] == 1
    await seed(db, 'A')
    filtered = (await client.post(path, json={'filters': {'title': 'A'}})).json()['analyticsData']
    assert filtered['metricValues']['total'] == 2
    assert filtered['metricValues']['quantity'] == 4
    assert set(filtered['filterOptions']['title']) == {'A', 'B'}
    assert (await client.post(path, json={'filters': {'secret': 'private'}})).status_code == 422


@pytest.mark.asyncio
async def test_page_access_never_grants_record_or_statistics_permissions(pages_environment):
    db, form, user, client = pages_environment
    await seed(db, 'A')
    page = await create_publish(client, user)
    user['is_admin'] = False
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='view', effect='deny'))
    await db.commit()
    assert (await client.get(f'/pages/{page["code"]}')).status_code == 200
    data = (await client.post(f'/pages/{page["code"]}/data', json={})).json()['analyticsData']
    assert data['errors']
    assert data['widgets']['total']['metricValues']['total'] is None
    assert data['filterOptions']['title'] == []
    assert (await client.get('/forms/1/records')).status_code == 403


@pytest.mark.asyncio
async def test_statistics_honor_row_and_field_scopes(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'Mine', uid=1); await seed(db, 'Other', uid=2)
    page = await create_publish(client, user)
    user['is_admin'] = False
    db.add(RolePermission(tenant_id=1, role_id=1, resource_type='form', resource_key='1',
                          action='view', effect='allow', data_scope='own'))
    await db.commit()
    data = (await client.post(f'/pages/{page["code"]}/data', json={})).json()['analyticsData']
    assert data['metricValues']['total'] == 1
    assert data['filterOptions']['title'] == ['Mine']
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, field_name='qty', action='view', effect='deny'))
    # RolePermission is deliberately higher precedence; use its field restriction.
    permission = await db.scalar(select(RolePermission))
    permission.field_rules_json = {'fields': {'qty': {'visible': False}}}
    await db.commit()
    data = (await client.post(f'/pages/{page["code"]}/data', json={})).json()['analyticsData']
    assert data['errors']
    assert 'qty' not in data['fieldLabels']['source']


@pytest.mark.asyncio
async def test_role_audiences_tenants_and_admin_editing(pages_environment):
    _, _, user, client = pages_environment
    value = definition(); value['roleIds'] = [1]
    page = await create_publish(client, user, value)
    code = page['code']
    user['is_admin'] = False
    assert (await client.get(f'/pages/{code}')).status_code == 200
    assert (await client.get(f'/pages/{code}/editor')).status_code == 403
    assert (await client.post('/pages', json=value)).status_code == 403
    user['uid'] = 99
    assert (await client.get(f'/pages/{code}')).status_code == 403
    assert (await client.post(f'/pages/{code}/data', json={})).status_code == 403
    assert (await client.get('/pages')).json()['items'] == []
    user['tenant_id'] = 2; user['is_admin'] = True
    assert (await client.get(f'/pages/{code}')).status_code == 404
    assert (await client.get(f'/pages/{code}/editor')).status_code == 404
    assert (await client.post('/pages', json=value)).status_code == 422


@pytest.mark.asyncio
async def test_publish_validates_references_without_modifying_live_page(pages_environment):
    _, _, user, client = pages_environment
    page = await create_publish(client, user)
    for change in ('dimension', 'measure', 'role'):
        invalid = copy.deepcopy(page['definition'])
        if change == 'dimension': invalid['widgets'][2]['dimension'] = 'missing'
        if change == 'measure': invalid['widgets'][1]['measure'] = 'title'
        if change == 'role': invalid['roleIds'] = [999]
        response = await client.post(f'/pages/{page["code"]}/publish', json={'definition': invalid, 'expectedRevision': page['revision']})
        assert response.status_code == 422, response.text
    current = (await client.get(f'/pages/{page["code"]}')).json()
    assert current['publishedVersion'] == 1
    assert current['definition'] == page['definition']


@pytest.mark.asyncio
async def test_list_only_page_filters_do_not_require_statistics(pages_environment):
    db, form, user, client = pages_environment
    await seed(db, 'A'); await seed(db, 'B')
    form.config = {'permissionDesign': {'roles': {'reader': {'data': {'ownership': {'statistics': False}}}}}}
    await db.commit()
    value = definition(); value['widgets'] = [value['widgets'][-1]]
    page = await create_publish(client, user, value)
    user['is_admin'] = False
    response = await client.post(f'/pages/{page["code"]}/data', json={})
    assert response.status_code == 200, response.text
    assert response.json()['analyticsData']['filterOptions']['title'] == ['A', 'B']


@pytest.mark.asyncio
async def test_new_page_is_private_draft_until_first_publication(pages_environment):
    _, _, user, client = pages_environment
    user['is_admin'] = True
    response = await client.post('/pages', json=definition())
    code = response.json()['code']
    assert (await client.get(f'/pages/{code}')).status_code == 404
    assert (await client.post(f'/pages/{code}/data', json={})).status_code == 404
    user['is_admin'] = False
    assert (await client.get('/pages')).json()['items'] == []


@pytest.mark.asyncio
async def test_page_record_create_edit_submit_and_approval_share_the_existing_flow(pages_environment, monkeypatch):
    from unittest.mock import AsyncMock
    from app.api import forms, workflow
    from app.models.relational import WorkflowInstance
    from app.services.form_approval_config import save_approval_settings
    db, _, user, client = pages_environment
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    monkeypatch.setattr(workflow, 'write_audit_log', AsyncMock())
    await save_approval_settings(db, 1, 1, 1, {'enabled': True,
        'stages': [{'name': 'Review', 'approver_ids': [2], 'approval_mode': 'single'}]})
    await db.commit()
    page = await create_publish(client, user)
    user['is_admin'] = False
    response = await client.post('/forms/1/records', json={'data': {'title': 'Page request', 'qty': 5}})
    assert response.status_code == 200, response.text
    record = response.json()['data']
    assert record['_approval']['can_submit']
    path = f'/forms/1/records/{record["id"]}'
    data_path = f'/pages/{page["code"]}/data'
    assert (await client.post(data_path, json={})).json()['analyticsData']['metricValues']['quantity'] == 5
    response = await client.put(path, json={'data': {'qty': 9}})
    assert response.status_code == 200, response.text
    assert (await client.post(data_path, json={})).json()['analyticsData']['metricValues']['quantity'] == 9
    response = await client.post(path + '/submit', json={'expected_status': 'draft'})
    assert response.status_code == 200, response.text
    workflow_id = response.json()['data']['_approval']['workflow_id']
    assert (await client.put(path, json={'data': {'qty': 99}})).status_code == 409
    instance = await db.get(WorkflowInstance, workflow_id)
    assert instance.workflow_version == 1
    await workflow._act_on_step(workflow_id, workflow.StepApprovalRequest(comment='Accepted'), 'approve',
                               user={**user, 'uid': 2}, db=db)
    await db.commit()
    response = await client.get(path)
    assert response.json()['data']['_approval']['status'] == 'approved'
    assert (await client.post(data_path, json={})).json()['analyticsData']['metricValues']['quantity'] == 9


@pytest.mark.asyncio
async def test_new_business_form_binding_is_idempotent_and_keeps_field_drafts(pages_environment):
    db, form, user, client = pages_environment
    user['is_admin'] = True
    form.config = {'assemblyKind': 'interaction', 'componentPageEnabled': True, 'viewConfigDraft': {'private': True}}
    form.status = 'draft'
    await db.commit()
    pending = (await client.get('/pages/forms/record-contract/binding')).json()
    assert pending['enabled'] and pending['code'] is None
    response = await client.post('/pages/forms/1/binding')
    assert response.status_code == 200, response.text
    page = response.json()
    assert [w['type'] for w in page['definition']['widgets']] == ['record-filter', 'record-list']
    assert page['definition']['sourceFormId'] == 1
    assert page['hostForm']['id'] == 1
    assert (await client.post('/pages/forms/1/binding')).json()['code'] == page['code']
    assert (await client.get('/pages/forms/1/binding')).json()['code'] == page['code']
    await db.refresh(form)
    assert form.status == 'draft'
    assert form.config['viewConfigDraft'] == {'private': True}
    user['is_admin'] = False
    assert (await client.get('/pages/forms/1/binding')).status_code == 404
    assert (await client.post('/pages/forms/1/binding')).status_code == 403


@pytest.mark.asyncio
async def test_new_analytics_form_uses_same_page_with_business_source(pages_environment):
    from app.models.relational import Form
    db, _, user, client = pages_environment
    user['is_admin'] = True
    host = Form(id=8, tenant_id=1, code='new-board', name='新看板', status='draft',
                config={'assemblyKind': 'analysis', 'componentPageEnabled': True})
    db.add(host); await db.commit()
    response = await client.post('/pages/forms/8/binding')
    assert response.status_code == 200, response.text
    page = response.json()
    assert page['definition']['widgets'][0]['type'] == 'metric'
    response = await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': page['definition'], 'expectedRevision': page['revision']})
    assert response.status_code == 422
    value = {**page['definition'], 'sourceFormId': 1}
    response = await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': value, 'expectedRevision': page['revision']})
    assert response.status_code == 200, response.text
    await db.refresh(host)
    assert host.status == 'draft'
    user['is_admin'] = False
    assert (await client.get(f'/pages/{page["code"]}')).status_code == 404


@pytest.mark.asyncio
async def test_bound_page_respects_host_visibility_and_cannot_be_reassigned(pages_environment):
    from app.models.relational import Form
    db, form, user, client = pages_environment
    page = await create_publish(client, user)
    response = await client.post('/pages/forms/1/binding', json={'existingCode': page['code']})
    assert response.status_code == 200, response.text
    assert response.json()['hostForm']['id'] == 1
    db.add(Form(id=9, tenant_id=1, code='other-host', name='Other', status='published'))
    await db.commit()
    assert (await client.post('/pages/forms/9/binding', json={'existingCode': page['code']})).status_code == 409
    user['is_admin'] = False
    assert (await client.get(f'/pages/{page["code"]}')).status_code == 200
    form.status = 'disabled'; await db.commit()
    assert (await client.get(f'/pages/{page["code"]}')).status_code == 404
    assert (await client.post(f'/pages/{page["code"]}/data', json={})).status_code == 404
    assert (await client.get('/pages')).json()['items'] == []
    user.update(is_admin=True, tenant_id=2)
    assert (await client.post('/pages/forms/1/binding')).status_code == 404


@pytest.mark.asyncio
async def test_draft_live_preview_never_saves_or_publishes(pages_environment):
    db, _, user, client = pages_environment
    await seed(db,'A');await seed(db,'B')
    page=await create_publish(client,user)
    preview=copy.deepcopy(page['definition'])
    preview['widgets'][1]['aggregate']='count'
    preview['style']={'componentGap':20,'cardRadius':12}
    response=await client.post(f'/pages/{page["code"]}/preview',json={'definition':preview,'filters':{'title':'A'}})
    assert response.status_code==200,response.text
    assert response.json()['analyticsData']['metricValues']['quantity']==1
    current=(await client.get(f'/pages/{page["code"]}/editor')).json()
    assert current['revision']==page['revision']
    assert current['definition']==page['definition']
    assert current['publishedDefinition']==page['publishedDefinition']
    user['is_admin']=False
    assert (await client.post(f'/pages/{page["code"]}/preview',json={'definition':preview})).status_code==403


@pytest.mark.asyncio
async def test_presentation_and_interaction_settings_survive_publication(pages_environment):
    _, _, user, client=pages_environment
    value=definition()
    value['style']={'componentGap':16,'cardRadius':10}
    value['widgets'][2].update(height=360,interaction='none')
    page=await create_publish(client,user,value)
    current=(await client.get(f'/pages/{page["code"]}')).json()['definition']
    assert {key: current['style'][key] for key in value['style']} == value['style']
    assert current['widgets'][2]['height']==360
    assert current['widgets'][2]['interaction']=='none'
    invalid=copy.deepcopy(current);invalid['style']['componentGap']=1000
    assert (await client.put(f'/pages/{page["code"]}/draft',json={'definition':invalid,'expectedRevision':page['revision']})).status_code==422

@pytest.mark.asyncio
async def test_detached_filters_publish_without_analytics_and_require_valid_targets(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'A')
    value = definition()
    value['widgets'] = [
        {'id': 'filters', 'type': 'record-filter', 'title': '筛选', 'targetWidgetIds': ['list'], 'filterFields': ['title']},
        {'id': 'list', 'type': 'record-list', 'title': '列表', 'showFilters': False}]
    page = await create_publish(client, user, value)
    response = await client.post(f'/pages/{page["code"]}/data', json={'filters': {}})
    assert response.status_code == 200, response.text
    assert response.json()['analyticsData']['errors'] == []
    assert component_pages.analytics_design(component_pages.PageDefinition.model_validate(value))['widgets'] == []
    for targets in ([], ['missing'], ['filters']):
        value['widgets'][0]['targetWidgetIds'] = targets
        response = await client.post(f'/pages/{page["code"]}/publish', json={'definition': value, 'expectedRevision': page['revision']})
        assert response.status_code == 422, response.text
    value['widgets'][0]['targetWidgetIds'] = ['list']
    value['widgets'][0]['filterFields'] = ['missing']
    response = await client.post(f'/pages/{page["code"]}/publish', json={'definition': value, 'expectedRevision': page['revision']})
    assert response.status_code == 422, response.text

@pytest.mark.asyncio
async def test_dashboard_options_round_trip_and_targeted_statistics(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'A'); await seed(db, 'B')
    value = definition()
    value['style'] = {'preset': 'executive', 'background': '#f1f3f8', 'cardBorder': 'strong',
                      'chartPalette': 'business', 'tableDensity': 'compact', 'filterTheme': 'panel', 'refreshInterval': 60}
    value['widgets'][1].update(aggregate='avg', format='currency', unit='件', threshold='红色 > 1',
                               width=18, appearance={'subtitle': '平均数量', 'palette': 'warning', 'radius': 12})
    value['widgets'][2].update(chartType='pie', interaction='filter', targetWidgetIds=['quantity'],
                               appearance={'showLabels': True, 'showLegend': False, 'smooth': True})
    page = await create_publish(client, user, value)
    public = (await client.get(f'/pages/{page["code"]}')).json()['definition']
    assert public['widgets'][1]['appearance']['radius'] == 12
    assert public['widgets'][2]['chartType'] == 'pie'
    assert public['style']['chartPalette'] == 'business'
    response = await client.post(f'/pages/{page["code"]}/data', json={'filters': {}, 'widget_filters': {'total': {'title': 'A'}}})
    assert response.status_code == 200, response.text
    data = response.json()['analyticsData']
    assert not data['errors']
    assert data['widgets']['total']['metricValues']['total'] == 1
    assert data['widgets']['quantity']['metricValues']['quantity'] == 2
    assert len(data['widgets']['chart']['series']) == 2
    for filters in ({'missing': {'title': 'A'}}, {'list': {'title': 'A'}}, {'total': {'secret': 'private'}}):
        response = await client.post(f'/pages/{page["code"]}/data', json={'filters': {}, 'widget_filters': filters})
        assert response.status_code in {403, 422}, response.text
    for kind in ('bar', 'line', 'pie', 'rank-table'):
        value['widgets'][2]['chartType'] = kind
        response = await client.post(f'/pages/{page["code"]}/preview', json={'definition': value})
        assert response.status_code == 200, response.text
        assert not response.json()['analyticsData']['errors']
    value['widgets'][2]['targetWidgetIds'] = ['missing']
    response = await client.post(f'/pages/{page["code"]}/publish', json={'definition': value, 'expectedRevision': page['revision']})
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_dashboard_presentation_bounds_are_validated(pages_environment):
    _, _, user, client = pages_environment
    user['is_admin'] = True
    for style in ({'background': 'url(javascript:bad)'}, {'refreshInterval': -1}, {'chartPalette': 'unknown'}):
        response = await client.post('/pages', json={**definition(), 'style': style})
        assert response.status_code == 422
    value = definition()
    value['widgets'][0]['appearance'] = {'radius': 100}
    assert (await client.post('/pages', json=value)).status_code == 422

@pytest.mark.asyncio
async def test_business_component_settings_publish_and_reject_stale_bindings(pages_environment):
    db, form, user, client = pages_environment
    form.config = {'viewConfig': {'filters': [{'fieldName': 'title', 'enabled': True}],
        'table': {'columns': [{'fieldName': 'title', 'enabled': True}, {'fieldName': 'qty', 'enabled': True}]}}}
    await db.commit()
    value = definition()
    value['widgets'].append({'id': 'filter', 'type': 'record-filter', 'title': '业务筛选', 'filterFields': ['title'],
        'targetWidgetIds': ['list'], 'filterSettings': {'queryMode': 'change', 'resetMode': 'clear',
        'showKeyword': False, 'expandAdvanced': True, 'requiredFields': ['title'], 'resetLabel': '清空'}})
    value['widgets'][-2]['listSettings'] = {'columns': ['qty', 'title'], 'pageSize': 5,
        'defaultSort': {'field': 'qty', 'order': 'desc'}, 'rowClick': 'detail', 'selection': 'multiple',
        'toolbarActions': ['refresh'], 'rowActions': ['detail'], 'emptyText': '未找到计划'}
    page = await create_publish(client, user, value)
    current = (await client.get(f'/pages/{page["code"]}')).json()['definition']
    assert current['widgets'][-2]['listSettings']['columns'] == ['qty', 'title']
    assert current['widgets'][-1]['filterSettings']['resetMode'] == 'clear'
    for patch in ({'columns': ['missing']}, {'columns': ['title', 'title']},
                  {'columns': ['secret']}, {'columns': ['title'], 'defaultSort': {'field': 'qty'}}):
        broken = copy.deepcopy(current)
        broken['widgets'][-2]['listSettings'].update(patch)
        response = await client.post(f'/pages/{page["code"]}/publish', json={'definition': broken, 'expectedRevision': page['revision']})
        assert response.status_code == 422, response.text
    for patch in ({'requiredFields': ['qty']}, {'requiredFields': [], 'showKeyword': False}):
        broken = copy.deepcopy(current)
        broken['widgets'][-1]['filterSettings'].update(patch)
        broken['widgets'][-1]['filterFields'] = []
        response = await client.post(f'/pages/{page["code"]}/publish', json={'definition': broken, 'expectedRevision': page['revision']})
        assert response.status_code == 422, response.text
    # Component filters may use published fields outside the source view presets.
    broken = copy.deepcopy(current)
    broken['widgets'][-1]['filterFields'] = ['qty']
    broken['widgets'][-1]['filterSettings']['requiredFields'] = ['qty']
    response = await client.post(f'/pages/{page["code"]}/preview', json={'definition': broken})
    assert response.status_code == 200, response.text
    broken['widgets'][-1]['filterFields'] = ['missing']
    broken['widgets'][-1]['filterSettings']['requiredFields'] = []
    response = await client.post(f'/pages/{page["code"]}/preview', json={'definition': broken})
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_business_component_settings_reject_invalid_bounds_and_actions(pages_environment):
    _, _, user, client = pages_environment
    user['is_admin'] = True
    for patch in ({'pageSize': 0}, {'pageSize': 201}, {'rowActions': ['execute']}, {'selection': 'unknown'}):
        value = definition(); value['widgets'][-1]['listSettings'] = patch
        assert (await client.post('/pages', json=value)).status_code == 422

@pytest.mark.asyncio
async def test_metric_card_title_and_content_appearance_survives_publication(pages_environment):
    _, _, user, client = pages_environment
    value = definition()
    appearance = {'showTitle': False, 'showMetricLabel': False, 'showMetricInfo': False,
                  'titleFontSize': 18, 'valueFontSize': 42, 'contentPadding': 24,
                  'titleAlign': 'center', 'titleFontFamily': 'serif', 'titleColor': '#123456',
                  'titleWeight': 'normal', 'titleItalic': True, 'titleGap': 8,
                  'subtitle': '仅统计已授权的产线数据。', 'showSubtitle': False,
                  'subtitleFontSize': 14, 'subtitleColor': '#536775', 'subtitleAlign': 'right',
                  'contentAlign': 'center', 'metricColumns': 2, 'widthColumns': 7, 'cardHeight': 420, 'cardOpacity': .65, 'cardBlur': 8,
                  'groupBackground': True, 'legendPosition': 'bottom', 'showAxisLabels': False,
                  'showGrid': False, 'horizontal': True, 'barWidth': 30, 'lineWidth': 4,
                  'symbolSize': 8, 'pieInnerRadius': 30, 'pieOuterRadius': 80,
                  'tableDensity': 'compact', 'tablePageSize': 20, 'showTableHeader': False,
                  'tableStriped': True, 'tableBordered': True, 'tableAlign': 'right',
                  'infoText': '仅统计已授权的产线数据。', 'infoTextMode': 'custom', 'legendFontSize': 14, 'legendItemGap': 20,
                  'legendSelectable': False, 'legendOrient': 'vertical', 'labelFontSize': 13,
                  'labelPosition': 'inside', 'gridLineType': 'dotted', 'axisLabelFontSize': 12,
                  'axisLabelRotate': 45}
    value['widgets'][0]['appearance'] = appearance
    published = await create_publish(client, user, value)
    for key, expected in appearance.items():
        assert published['definition']['widgets'][0]['appearance'][key] == expected
    editor = (await client.get(f'/pages/{published["code"]}/editor')).json()
    for key, expected in appearance.items():
        assert editor['definition']['widgets'][0]['appearance'][key] == expected


@pytest.mark.asyncio
async def test_independent_blank_page_publishes_without_a_form_and_keeps_role_checks(pages_environment):
    _, _, user, client = pages_environment
    page = await create_publish(client, user, {'title': '空白页面', 'widgets': []})
    assert page['hostForm'] is None
    assert page['definition']['sourceFormId'] is None
    assert page['definition']['widgets'] == []
    user['is_admin'] = False
    assert (await client.get(f'/pages/{page["code"]}')).status_code == 200
    data = (await client.post(f'/pages/{page["code"]}/data', json={})).json()['analyticsData']
    assert data['widgets'] == {} and data['errors'] == []
    assert (await client.post(f'/pages/{page["code"]}/data', json={'filters': {'title': 'A'}})).status_code == 422
    user['is_admin'] = True
    invalid = {**page['definition'], 'roleIds': [999]}
    assert (await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': invalid, 'expectedRevision': page['revision']})).status_code == 422
    user['tenant_id'] = 2
    assert (await client.get(f'/pages/{page["code"]}/editor')).status_code == 404


async def second_source(db, user, client):
    from app.models.relational import Form, FormField
    db.add(Form(id=20, tenant_id=1, code='independent-second', name='第二来源', status='published'))
    await db.flush()
    db.add_all([FormField(tenant_id=1, form_id=20, field_name='amount', label='金额', field_type='integer'),
                FormPermission(tenant_id=1, form_id=20, role_id=1, action='*', effect='allow')])
    await db.commit()
    response = await client.post('/forms/20/records', json={'data': {'amount': 17}})
    assert response.status_code == 200, response.text
    return response.json()['data']


@pytest.mark.asyncio
async def test_component_sources_query_and_write_independently(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'First')
    await second_source(db, user, client)
    value = {'title': '独立来源', 'widgets': [
        {'id': 'first', 'type': 'metric', 'title': '第一计数', 'dataBinding': {'formId': 1}},
        {'id': 'second', 'type': 'metric', 'title': '第二汇总', 'aggregate': 'sum', 'measure': 'amount', 'dataBinding': {'formId': 20}},
        {'id': 'list1', 'type': 'record-list', 'title': '第一列表', 'dataBinding': {'formId': 1}, 'listSettings': {'columns': ['title']}},
        {'id': 'list2', 'type': 'record-list', 'title': '第二列表', 'dataBinding': {'formId': 20}, 'listSettings': {'columns': ['amount']}}]}
    page = await create_publish(client, user, value)
    path = f'/pages/{page["code"]}/data'
    user['is_admin'] = False
    data = (await client.post(path, json={})).json()['analyticsData']
    assert data['metricValues'] == {'first': 1, 'second': 17}
    assert data['errors'] == []
    await client.post('/forms/20/records', json={'data': {'amount': 8}})
    data = (await client.post(path, json={})).json()['analyticsData']
    assert data['metricValues'] == {'first': 1, 'second': 25}
    assert len((await client.get('/forms/1/records')).json()['data']) == 1
    assert len((await client.get('/forms/20/records')).json()['data']) == 2


@pytest.mark.asyncio
async def test_shared_list_removal_and_empty_publication_preserve_records(pages_environment):
    db, _, user, client = pages_environment
    record = await seed(db, 'Keep')
    value = {'title': '共享列表', 'widgets': [
        {'id': id, 'type': 'record-list', 'title': id, 'dataBinding': {'formId': 1}}
        for id in ('one', 'two')]}
    page = await create_publish(client, user, value)
    for remaining in (page['definition']['widgets'][1:], []):
        response = await client.post(f'/pages/{page["code"]}/publish', json={
            'definition': {**page['definition'], 'widgets': remaining}, 'expectedRevision': page['revision']})
        assert response.status_code == 200, response.text
        page = response.json()
        rows = (await client.get('/forms/1/records')).json()['data']
        assert len(rows) == 1 and rows[0]['data']['title'] == 'Keep'
    assert page['publishedVersion'] == 3


@pytest.mark.asyncio
async def test_unbound_component_can_save_draft_but_cannot_publish(pages_environment):
    _, _, user, client = pages_environment
    user['is_admin'] = True
    response = await client.post('/pages', json={'title': '待配置', 'widgets': [
        {'id': 'one', 'type': 'record-list', 'title': '待绑定'}]})
    assert response.status_code == 200, response.text
    page = response.json()
    assert (await client.put(f'/pages/{page["code"]}/draft', json={
        'definition': page['definition'], 'expectedRevision': page['revision']})).status_code == 200
    editor = (await client.get(f'/pages/{page["code"]}/editor')).json()
    assert (await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': editor['definition'], 'expectedRevision': editor['revision']})).status_code == 422


@pytest.mark.asyncio
async def test_binding_validation_checks_each_source_and_rejects_cross_source_links(pages_environment):
    from app.models.relational import Form
    db, _, user, client = pages_environment
    await second_source(db, user, client)
    db.add(Form(id=21, tenant_id=2, code='foreign', name='其他租户', status='published'))
    await db.commit()
    user['is_admin'] = True
    value = {'title': '来源检查', 'widgets': [
        {'id': 'one', 'type': 'record-list', 'title': '来源', 'dataBinding': {'formId': 21}}]}
    assert (await client.post('/pages', json=value)).status_code == 422
    value['widgets'][0]['dataBinding']['formId'] = 20
    value['widgets'][0]['listSettings'] = {'columns': ['title']}
    page = (await client.post('/pages', json=value)).json()
    assert (await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': page['definition'], 'expectedRevision': page['revision']})).status_code == 422
    value['widgets'][0].pop('listSettings')
    value['widgets'].append({'id': 'filter', 'type': 'record-filter', 'title': '错误关联',
        'dataBinding': {'formId': 1}, 'targetWidgetIds': ['one']})
    assert (await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': value, 'expectedRevision': page['revision']})).status_code == 422


@pytest.mark.asyncio
async def test_global_filters_only_apply_to_inherited_source(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'A'); await seed(db, 'B')
    await second_source(db, user, client)
    value = {'title': '默认筛选隔离', 'sourceFormId': 1, 'filterFields': ['title'], 'widgets': [
        {'id': 'one', 'type': 'metric', 'title': '默认计数'},
        {'id': 'two', 'type': 'metric', 'title': '其他来源', 'dataBinding': {'formId': 20}}]}
    page = await create_publish(client, user, value)
    data = (await client.post(f'/pages/{page["code"]}/data', json={'filters': {'title': 'missing'}})).json()['analyticsData']
    assert data['metricValues'] == {'one': 0, 'two': 1}
    assert set(data['filterOptions']['title']) == {'A', 'B'}


@pytest.mark.asyncio
async def test_denied_statistics_source_never_leaks_or_hides_other_source(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'Visible')
    await second_source(db, user, client)
    page = await create_publish(client, user, {'title': '权限隔离', 'widgets': [
        {'id': 'one', 'type': 'metric', 'title': '可见', 'dataBinding': {'formId': 1}},
        {'id': 'two', 'type': 'metric', 'title': '无权', 'dataBinding': {'formId': 20}}]})
    db.add(FormPermission(tenant_id=1, form_id=20, role_id=1, action='view', effect='deny'))
    await db.commit()
    user['is_admin'] = False
    data = (await client.post(f'/pages/{page["code"]}/data', json={})).json()['analyticsData']
    assert data['metricValues']['one'] == 1
    assert data['metricValues']['two'] is None
    assert data['widgetErrors']['one'] == []
    assert data['widgetErrors']['two']


@pytest.mark.asyncio
async def test_raw_legacy_page_snapshot_remains_readable_without_rewriting(pages_environment):
    from app.models.relational import ComponentPage
    db, _, user, client = pages_environment
    await seed(db, 'Historical')
    legacy = definition()  # Stored before schemaVersion and dataBinding existed.
    page = ComponentPage(tenant_id=1, code='legacy-snapshot', draft=copy.deepcopy(legacy),
                         revision=7, published_version=1)
    db.add(page); await db.flush()
    db.add(ComponentPageVersion(tenant_id=1, page_id=page.id, version=1, definition=copy.deepcopy(legacy)))
    await db.commit()
    response = await client.get('/pages/legacy-snapshot')
    assert response.status_code == 200
    assert response.json()['definition'] == legacy
    data = (await client.post('/pages/legacy-snapshot/data', json={})).json()['analyticsData']
    assert data['metricValues']['total'] == 1
    assert data['metricValues']['quantity'] == 2
    await db.refresh(page)
    assert page.revision == 7 and page.draft == legacy


@pytest.mark.asyncio
async def test_denied_list_source_does_not_block_other_source_statistics(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'Visible')
    await second_source(db, user, client)
    page = await create_publish(client, user, {'title': '列表权限隔离', 'widgets': [
        {'id': 'one', 'type': 'metric', 'title': '可见统计', 'dataBinding': {'formId': 1}},
        {'id': 'two', 'type': 'record-list', 'title': '无权列表', 'dataBinding': {'formId': 20}}]})
    db.add(FormPermission(tenant_id=1, form_id=20, role_id=1, action='view', effect='deny'))
    await db.commit()
    user['is_admin'] = False
    response = await client.post(f'/pages/{page["code"]}/data', json={})
    assert response.status_code == 200, response.text
    data = response.json()['analyticsData']
    assert data['metricValues']['one'] == 1
    assert data['widgetErrors']['one'] == []
    assert data['widgetErrors']['two']
    assert (await client.get('/forms/20/records')).status_code == 403


@pytest.mark.asyncio
async def test_existing_business_and_board_entries_can_initialize_blank_canvas(pages_environment):
    from app.models.relational import Form
    db, form, user, client = pages_environment
    record = await seed(db, 'Keep existing data')
    user['is_admin'] = True
    form.config = {'componentPageEnabled': True, 'assemblyKind': 'interaction'}
    board = Form(id=31, tenant_id=1, code='blank-board-entry', name='空白看板', status='draft',
                 config={'componentPageEnabled': True, 'assemblyKind': 'analysis'})
    db.add(board); await db.commit()
    for form_id, slug in ((1, form.code), (31, board.code)):
        response = await client.post(f'/pages/forms/{form_id}/binding', json={'blank': True})
        assert response.status_code == 200, response.text
        page = response.json()
        assert page['definition']['widgets'] == []
        assert page['hostForm']['id'] == form_id
        assert page['definition']['sourceFormId'] is None
        assert (await client.get(f'/pages/forms/{slug}/binding')).json()['code'] == page['code']
        # Reopening never replaces an already bound page or changes form lifecycle.
        assert (await client.post(f'/pages/forms/{form_id}/binding', json={'blank': True})).json()['code'] == page['code']
    rows = (await client.get('/forms/1/records')).json()['data']
    assert len(rows) == 1 and rows[0]['data']['title'] == 'Keep existing data'
    await db.refresh(form); await db.refresh(board)
    assert form.status == 'published' and board.status == 'draft'


@pytest.mark.asyncio
async def test_component_filters_drive_only_linked_statistics_and_use_record_predicates(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'Alpha'); await seed(db, 'Beta')
    value = definition()
    value['widgets'].append({'id': 'filter', 'type': 'record-filter', 'title': '筛选',
                             'targetWidgetIds': ['total', 'chart'], 'filterFields': ['title']})
    page = await create_publish(client, user, value)
    user['is_admin'] = False
    path = f'/pages/{page["code"]}/data'
    response = await client.post(path, json={'filter_queries': {'filter': {
        'search': 'Alpha', 'filters': [{'field': 'title', 'op': 'contains', 'value': 'Al'}]}}})
    assert response.status_code == 200, response.text
    data = response.json()['analyticsData']
    assert data['widgets']['total']['metricValues']['total'] == 1
    assert data['metricValues']['total'] == 1
    assert data['widgets']['chart']['total'] == 1
    assert data['metricValues']['quantity'] == 4  # deliberately unlinked
    reset = (await client.post(path, json={'filter_queries': {'filter': {'filters': []}}})).json()['analyticsData']
    assert reset['metricValues']['total'] == 2
    assert (await client.post(path, json={'filter_queries': {'filter': {'filters': [{'field': 'secret', 'op': 'equals', 'value': 'x'}]}}})).status_code == 422
    assert (await client.post(path, json={'filter_queries': {'filter': {'filters': [{'field': 'title', 'op': 'sql', 'value': 'x'}]}}})).status_code == 422


@pytest.mark.asyncio
async def test_independent_chart_conditions_intersect_and_clear_without_overwriting(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'A'); await seed(db, 'B')
    value = definition()
    value['widgets'][2]['targetWidgetIds'] = ['total']
    value['widgets'].append({'id': 'other', 'type': 'chart', 'title': '第二图表', 'dimension': 'title', 'targetWidgetIds': ['total']})
    page = await create_publish(client, user, value)
    path = f'/pages/{page["code"]}/data'
    data = (await client.post(path, json={'chart_values': {'chart': 'A', 'other': 'B'}})).json()['analyticsData']
    assert data['metricValues']['total'] == 0
    data = (await client.post(path, json={'chart_values': {'other': 'B'}})).json()['analyticsData']
    assert data['metricValues']['total'] == 1
    assert data['widgets']['chart']['total'] == 2
    assert (await client.post(path, json={})).json()['analyticsData']['metricValues']['total'] == 2


@pytest.mark.asyncio
async def test_component_roles_are_enforced_on_config_and_data_and_validate_tenant(pages_environment):
    from app.models.relational import Role
    db, _, user, client = pages_environment
    db.add(Role(id=2, tenant_id=1, name='restricted', label='Restricted'))
    await db.commit()
    await seed(db, 'A')
    value = definition()
    value['widgets'][0]['roleIds'] = [2]
    value['widgets'].append({'id': 'private-filter', 'type': 'record-filter', 'title': '私有条件', 'roleIds': [2], 'targetWidgetIds': ['total']})
    page = await create_publish(client, user, value)
    user['is_admin'] = False
    published = (await client.get(f'/pages/{page["code"]}')).json()['definition']
    assert 'total' not in {w['id'] for w in published['widgets']}
    assert 'private-filter' not in {w['id'] for w in published['widgets']}
    data = (await client.post(f'/pages/{page["code"]}/data', json={})).json()['analyticsData']
    assert 'total' not in data['widgets'] and 'total' not in data['metricValues']
    assert (await client.post(f'/pages/{page["code"]}/data', json={'filter_queries': {'private-filter': {}}})).status_code == 422
    user['is_admin'] = True
    assert 'total' in {w['id'] for w in (await client.get(f'/pages/{page["code"]}')).json()['definition']['widgets']}
    invalid = copy.deepcopy(page['definition']); invalid['widgets'][0]['roleIds'] = [999]
    assert (await client.post(f'/pages/{page["code"]}/publish', json={'definition': invalid, 'expectedRevision': page['revision']})).status_code == 422


@pytest.mark.asyncio
async def test_required_filters_and_hidden_predicates_never_expose_aggregates(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'A')
    value = definition()
    value['widgets'].append({'id': 'filter', 'type': 'record-filter', 'title': '必填', 'filterFields': ['secret'],
                             'filterSettings': {'requiredFields': ['secret']}, 'targetWidgetIds': ['total']})
    page = await create_publish(client, user, value)
    path = f'/pages/{page["code"]}/data'
    assert (await client.post(path, json={})).json()['analyticsData']['metricValues']['total'] == 0
    # ready=True is not sufficient without the required field.
    assert (await client.post(path, json={'filter_queries': {'filter': {'ready': True}}})).json()['analyticsData']['metricValues']['total'] == 0
    user['is_admin'] = False
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, field_name='secret', action='view', effect='deny'))
    await db.commit()
    data = (await client.post(path, json={'filter_queries': {'filter': {'filters': [{'field':'secret','op':'equals','value':'secret'}]}}})).json()['analyticsData']
    assert data['widgetErrors']['total']
    assert data['metricValues']['total'] is None
    assert data['metricValues']['quantity'] == 2


def test_toolbar_group_audiences_merge_without_mutating_saved_definition():
    widget = {'id': 'list', 'listSettings': {'toolbarGroups': [
        {'id': 'all', 'name': '通用', 'roleIds': [], 'actions': ['refresh']},
        {'id': 'a', 'name': '录入', 'roleIds': [1], 'actions': ['create', 'refresh']},
        {'id': 'b', 'name': '导出', 'roleIds': [2], 'actions': ['export']}]}}
    original = copy.deepcopy(widget)
    assert component_pages.resolve_toolbar_groups(widget, {1})['listSettings']['toolbarActions'] == ['refresh', 'create']
    assert component_pages.resolve_toolbar_groups(widget, {3})['listSettings']['toolbarActions'] == ['refresh']
    assert component_pages.resolve_toolbar_groups(widget, {1, 2})['listSettings']['toolbarActions'] == ['refresh', 'create', 'export']
    assert widget == original
    assert component_pages.resolve_toolbar_groups({'listSettings': {'toolbarGroups': []}}, set())['listSettings']['toolbarActions'] == []
    assert component_pages.resolve_toolbar_groups({'listSettings': {'toolbarActions': ['refresh']}}, set()) == {'listSettings': {'toolbarActions': ['refresh']}}


def test_section_merge_preserves_other_tab_and_original():
    original = {'id': 'list', 'type': 'record-list', 'title': 'Original', 'dataBinding': {'formId': 1},
                'listSettings': {'columns': ['title'], 'toolbarActions': ['refresh']}}
    edited = copy.deepcopy(original)
    edited.update(title='Changed', dataBinding={'formId': 2})
    edited['listSettings'].update(columns=['qty'], toolbarActions=['import'])
    basic = component_pages.merge_widget_section(original, edited, 'basic')
    assert basic['title'] == 'Changed'
    assert basic['dataBinding'] == {'formId': 1}
    assert basic['listSettings'] == {'columns': ['title'], 'toolbarActions': ['import']}
    data = component_pages.merge_widget_section(original, edited, 'data')
    assert data['title'] == 'Original'
    assert data['dataBinding'] == {'formId': 2}
    assert data['listSettings'] == {'columns': ['qty'], 'toolbarActions': ['refresh']}
    assert original['title'] == 'Original'


@pytest.mark.asyncio
async def test_component_section_publish_isolated_and_revision_checked(pages_environment):
    db, form, user, client = pages_environment
    page = await create_publish(client, user)
    code = page['code']
    edited = copy.deepcopy(page['definition'])
    edited['widgets'][0]['title'] = '独立基本版本'
    edited['widgets'][1]['title'] = '未发布其他组件'
    edited['widgets'][0]['aggregate'] = 'sum'
    edited['widgets'][0]['measure'] = 'qty'
    url = f'/pages/{code}/widgets/total/basic'
    response = await client.post(url + '/publish', json={'definition': edited, 'expectedRevision': page['revision']})
    assert response.status_code == 200, response.text
    published_page = response.json()
    widgets = published_page['publishedDefinition']['widgets']
    assert widgets[0]['title'] == '独立基本版本'
    assert widgets[0]['aggregate'] == 'count'
    assert widgets[1]['title'] == page['definition']['widgets'][1]['title']
    history = (await client.get(url + '/versions')).json()['items']
    assert len(history) == 2
    data_history = (await client.get(f'/pages/{code}/widgets/total/data/versions')).json()['items']
    assert len(data_history) == 1
    stale = await client.post(url + '/publish', json={'definition': edited, 'expectedRevision': page['revision']})
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_common_permission_templates_round_trip_and_validate_roles(pages_environment):
    db, form, user, client = pages_environment
    user['is_admin'] = True
    body = {'name': '通用权限', 'groups': [{'id': 'base', 'name': '默认组', 'roleIds': [], 'actions': ['refresh', 'disable', 'delete']}]}
    response = await client.post('/pages/permission-templates', json=body)
    assert response.status_code == 200, response.text
    template_id = response.json()['id']
    templates = (await client.get('/pages/permission-templates')).json()['data']
    assert next(item for item in templates if item['id'] == template_id)['groups'] == [component_pages.ToolbarGroup.model_validate(group).model_dump() for group in body['groups']]
    invalid = copy.deepcopy(body)
    invalid['groups'][0]['roleIds'] = [99999999]
    assert (await client.post('/pages/permission-templates', json=invalid)).status_code == 422
    assert (await client.delete(f'/pages/permission-templates/{template_id}')).status_code == 200
    assert all(item['id'] != template_id for item in (await client.get('/pages/permission-templates')).json()['data'])
    user['is_admin'] = False
    assert (await client.post('/pages/permission-templates', json=body)).status_code == 403


def test_toolbar_audiences_match_any_subject_without_empty_roles_granting_access():
    widget = {'listSettings': {'toolbarGroups': [
        {'id': 'u', 'roleIds': [], 'userIds': [12], 'actions': ['create']},
        {'id': 'g', 'roleIds': [], 'orgUnitIds': [8], 'actions': ['export']},
        {'id': 'mixed', 'roleIds': [4], 'userIds': [15], 'actions': ['refresh']}]}}
    resolve = component_pages.resolve_toolbar_groups
    assert resolve(widget, set(), 99, set())['listSettings']['toolbarActions'] == []
    assert resolve(widget, set(), 12, {8})['listSettings']['toolbarActions'] == ['create', 'export']
    assert resolve(widget, {4}, 99, set())['listSettings']['toolbarActions'] == ['refresh']
    assert resolve(widget, set(), 15, set())['listSettings']['toolbarActions'] == ['refresh']


@pytest.mark.asyncio
async def test_toolbar_audiences_directory_and_cross_tenant_validation(pages_environment):
    db, form, user, client = pages_environment
    user['is_admin'] = True
    response = await client.get('/pages/permission-audiences')
    assert response.status_code == 200, response.text
    assert set(response.json()) == {'users', 'orgUnits'}
    for key in ['userIds', 'orgUnitIds']:
        body = {'name': '非法对象', 'groups': [{'id': 'x', 'name': 'x', key: [999999], 'actions': ['refresh']}]}
        assert (await client.post('/pages/permission-templates', json=body)).status_code == 422
    user['is_admin'] = False
    assert (await client.get('/pages/permission-audiences')).status_code == 403


@pytest.mark.asyncio
async def test_page_version_history_returns_whole_published_pages_only(pages_environment):
    db, form, user, client = pages_environment
    page = await create_publish(client, user)
    code = page['code']
    first = copy.deepcopy(page['definition'])
    second = {**first, 'title': '第二版整页', 'style': {'componentGap': 24},
              'widgets': [first['widgets'][0]]}
    response = await client.post(f'/pages/{code}/publish', json={
        'definition': second, 'expectedRevision': page['revision']})
    assert response.status_code == 200, response.text
    page = response.json()
    saved = await client.put(f'/pages/{code}/draft', json={
        'definition': {**page['definition'], 'title': '尚未发布的修改'},
        'expectedRevision': page['revision']})
    assert saved.status_code == 200
    before = (await client.get(f'/pages/{code}/editor')).json()
    response = await client.get(f'/pages/{code}/versions')
    assert response.status_code == 200, response.text
    items = response.json()['items']
    assert [item['version'] for item in items] == [2, 1]
    assert items[1]['definition'] == first
    assert items[0]['definition'] == page['definition']
    assert all(item['publishedAt'] for item in items)
    assert (await client.get(f'/pages/{code}/editor')).json() == before
    user['is_admin'] = False
    assert (await client.get(f'/pages/{code}/versions')).status_code == 403
    user['is_admin'] = True
    user['tenant_id'] = 2
    assert (await client.get(f'/pages/{code}/versions')).status_code == 404


def test_filter_scope_keeps_available_fields_outside_list_presets():
    from app.api.forms import _scoped_form_payload
    payload = {'fields': [{'field_name': 'title', 'visible_in_list': True}, {'field_name': 'purpose'}, {'field_name': 'old', 'archived': True}], 'config': {'viewConfig': {'filters': [], 'table': {'columns': []}}, 'privateDesignerSettings': True}}
    scoped = _scoped_form_payload(payload, 'filters')
    assert [f['field_name'] for f in scoped['fields']] == ['title', 'purpose']
    assert 'privateDesignerSettings' not in scoped['config']
    assert len(_scoped_form_payload(payload, 'list')['fields']) == 1


@pytest.mark.asyncio
async def test_multi_choice_filter_uses_selected_values_for_both_storage_adapters(pages_environment):
    import json
    from app.services import records
    db, _, user, client = pages_environment
    await seed(db, 'A')
    await seed(db, 'B')
    await seed(db, 'C')
    page = await create_publish(client, user)
    result = await records.list_records(1, db, user, filters_json=json.dumps([{'field':'title','op':'in','value':['A','C']}]))
    assert result['total'] == 2
    result = await records.list_records(1, db, user, filters_json=json.dumps([{'field':'title','op':'in','value':['missing']}]))
    assert result['total'] == 0


def test_multi_choice_matches_array_members_and_scalar_values():
    from types import SimpleNamespace
    from app.api.form_engine.query import _record_matches_filters
    fields = [SimpleNamespace(field_name='kind', archived=False)]
    predicate = [{'field':'kind','op':'in','value':['A','C']}]
    assert _record_matches_filters(SimpleNamespace(data={'kind':['B','C']}),fields,predicate)
    assert _record_matches_filters(SimpleNamespace(data={'kind':'A'}),fields,predicate)
    assert not _record_matches_filters(SimpleNamespace(data={'kind':['ABC']}),fields,predicate)


@pytest.mark.asyncio
async def test_multi_choice_sql_matches_whole_array_options(pages_environment):
    from sqlalchemy import literal
    from app.api.form_engine.query import _selection_filter_clause
    db, _, _, _ = pages_environment
    assert await db.scalar(select(_selection_filter_clause(literal('["A", "B"]'), ['B'], db.bind.dialect.name)))
    assert not await db.scalar(select(_selection_filter_clause(literal('["ABC"]'), ['A'], db.bind.dialect.name)))


def test_component_access_groups_replace_legacy_and_default_to_closed_when_empty():
    check = component_pages.component_accessible
    assert check({'roleIds': [2]}, {2})
    assert not check({'roleIds': [2]}, {3})
    assert not check({'accessGroups': []}, set())
    assert check({'roleIds': [2], 'accessGroups': [{'userIds': [12]}]}, set(), 12)
    assert not check({'accessGroups': [{'userIds': [12]}]}, {2}, 13)
    assert check({'accessGroups': [{'orgUnitIds': [8]}, {'roleIds': [3]}]}, {3}, 13)
    assert check({'accessGroups': [{}]}, set(), 13)


def test_display_groups_resolve_matching_columns_only_and_do_not_mutate_saved_groups():
    widget = {'listSettings': {'displayGroups': [
        {'roleIds': [2], 'columns': ['qty', 'name']},
        {'userIds': [12], 'columns': ['name', 'status']}]}}
    original = copy.deepcopy(widget)
    result = component_pages.resolve_display_groups(widget, {2}, 12)
    assert result['listSettings']['columns'] == ['qty', 'name', 'status']
    assert component_pages.resolve_display_groups(widget, set(), 13) is None
    assert component_pages.resolve_display_groups({'listSettings': {'displayGroups': []}}, set()) is None
    assert widget == original
    assert component_pages.resolve_display_groups({'listSettings': {'columns': ['qty']}}, set()) == {'listSettings': {'columns': ['qty']}}


@pytest.mark.asyncio
async def test_access_groups_and_display_groups_round_trip_in_published_page(pages_environment):
    db, form, user, client = pages_environment
    value = definition()
    value['widgets'][-1]['accessGroups'] = [{'id': 'access', 'name': '访问', 'roleIds': [], 'actions': []}]
    value['widgets'][-1]['listSettings'] = {'displayGroups': [{'id': 'display', 'name': '列', 'roleIds': [], 'actions': [], 'columns': ['title']}]}
    page = await create_publish(client, user, value)
    user['is_admin'] = False
    response = await client.get('/pages/' + page['code'])
    assert response.status_code == 200, response.text
    widget = next(item for item in response.json()['definition']['widgets'] if item['id'] == 'list')
    assert widget['listSettings']['columns'] == ['title']


@pytest.mark.asyncio
async def test_all_permission_group_roles_are_tenant_validated(pages_environment):
    from fastapi import HTTPException
    db, form, user, client = pages_environment
    user['is_admin'] = True
    for scope in ['access', 'display']:
        value = definition()
        group = {'id': 'invalid', 'name': '非法角色', 'roleIds': [999999], 'actions': [], 'columns': ['title']}
        if scope == 'access':
            value['widgets'][-1]['accessGroups'] = [group]
        else:
            value['widgets'][-1]['listSettings'] = {'displayGroups': [group]}
        with pytest.raises(HTTPException) as exc:
            await component_pages.validate_publish(db, user, component_pages.PageDefinition.model_validate(value))
        assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_permission_templates_are_separated_by_scope(pages_environment):
    db, form, user, client = pages_environment
    user['is_admin'] = True
    body = {'scope': 'display', 'name': '列表列模板', 'groups': [{'id': 'cols', 'name': '列', 'actions': [], 'columns': ['title']}]}
    response = await client.post('/pages/permission-templates', json=body)
    assert response.status_code == 200, response.text
    template_id = response.json()['id']
    assert any(item['id'] == template_id for item in (await client.get('/pages/permission-templates?scope=display')).json()['data'])
    assert all(item['id'] != template_id for item in (await client.get('/pages/permission-templates')).json()['data'])


def test_filter_button_groups_match_subjects_and_preserve_legacy_defaults():
    widget = {'filterSettings': {'toolbarGroups': [
        {'id': 'public', 'actions': ['reset']},
        {'id': 'role', 'roleIds': [4], 'actions': ['query']},
        {'id': 'user', 'userIds': [12], 'actions': ['query']},
        {'id': 'org', 'orgUnitIds': [8], 'actions': ['query']}]}}
    original = copy.deepcopy(widget)
    resolve = component_pages.resolve_filter_groups
    actions = lambda value: {action for group in value['filterSettings']['toolbarGroups'] for action in group['actions']}
    assert actions(resolve(widget, set(), 99, set())) == {'reset'}
    for roles, uid, units in [({4}, 99, set()), (set(), 12, set()), (set(), 99, {8})]:
        assert actions(resolve(widget, roles, uid, units)) == {'query', 'reset'}
    assert widget == original
    assert resolve({'filterSettings': {}}, set()) == {'filterSettings': {}}
    assert actions(resolve({'filterSettings': {'toolbarGroups': []}}, {4}, 12, {8})) == set()


@pytest.mark.asyncio
async def test_filter_button_groups_are_projected_and_template_scope_isolated(pages_environment):
    db, form, user, client = pages_environment
    value = definition()
    value['widgets'].append({'id': 'filter', 'type': 'record-filter', 'title': '筛选',
        'targetWidgetIds': ['list'], 'filterFields': ['title'], 'filterSettings': {'toolbarGroups': [
            {'id': 'public', 'name': '重置组', 'actions': ['reset']},
            {'id': 'role', 'name': '查询组', 'roleIds': [1], 'actions': ['query']}]}})
    page = await create_publish(client, user, value)
    user['is_admin'] = False
    runtime = (await client.get(f'/pages/{page["code"]}')).json()['definition']
    groups = next(w for w in runtime['widgets'] if w['id'] == 'filter')['filterSettings']['toolbarGroups']
    assert {action for group in groups for action in group['actions']} == {'query', 'reset'}
    user['uid'] = 99
    runtime = (await client.get(f'/pages/{page["code"]}')).json()['definition']
    groups = next(w for w in runtime['widgets'] if w['id'] == 'filter')['filterSettings']['toolbarGroups']
    assert [group['id'] for group in groups] == ['public']
    user['is_admin'] = True
    template = {'scope': 'filter', 'name': '筛选按钮模板', 'groups': [{'id': 'q', 'name': '查询', 'actions': ['query']}]}
    assert (await client.post('/pages/permission-templates', json=template)).status_code == 200
    assert len((await client.get('/pages/permission-templates?scope=filter')).json()['data']) == 1
    assert (await client.get('/pages/permission-templates?scope=toolbar')).json()['data'] == []
    assert (await client.post('/pages/permission-templates', json={**template, 'scope': 'toolbar'})).status_code == 422
    for key in ['userIds', 'orgUnitIds']:
        invalid = copy.deepcopy(value)
        invalid['widgets'][-1]['filterSettings']['toolbarGroups'] = [{'id': 'bad', 'name': 'bad', key: [999999], 'actions': ['query']}]
        created = (await client.post('/pages', json=invalid)).json()
        response = await client.post(f'/pages/{created["code"]}/publish', json={
            'definition': invalid, 'expectedRevision': created['revision']})
        assert response.status_code == 422, response.text


def test_filter_button_permissions_publish_with_basic_section_without_changing_fields():
    live = {'id': 'f', 'type': 'record-filter', 'filterFields': ['title'], 'filterSettings': {
        'queryMode': 'submit', 'showKeyword': True, 'requiredFields': ['title'], 'toolbarGroups': None}}
    draft = {**live, 'filterFields': ['qty'], 'filterSettings': {
        'queryMode': 'change', 'showKeyword': False, 'requiredFields': ['qty'], 'toolbarGroups': []}}
    basic = component_pages.merge_widget_section(live, draft, 'basic')
    assert basic['filterFields'] == ['title']
    assert basic['filterSettings'] == {'queryMode': 'change', 'showKeyword': True, 'requiredFields': ['title'], 'toolbarGroups': []}
    data = component_pages.merge_widget_section(live, draft, 'data')
    assert data['filterSettings'] == {'queryMode': 'submit', 'showKeyword': False, 'requiredFields': ['qty'], 'toolbarGroups': None}


@pytest.mark.asyncio
async def test_display_group_sorting_round_trip_and_visible_column_validation(pages_environment):
    from fastapi import HTTPException
    db, form, user, client = pages_environment
    user['is_admin'] = True
    value = definition()
    value['widgets'][-1]['listSettings'] = {'displayGroups': [{'id': 'display', 'name': '排序', 'columns': ['title'], 'sortableColumns': ['qty']}]}
    with pytest.raises(HTTPException) as exc:
        await component_pages.validate_publish(db, user, component_pages.PageDefinition.model_validate(value))
    assert exc.value.status_code == 422
    value['widgets'][-1]['listSettings']['displayGroups'][0]['sortableColumns'] = ['title']
    page = await create_publish(client, user, value)
    group = page['publishedDefinition']['widgets'][-1]['listSettings']['displayGroups'][0]
    assert group['sortableColumns'] == ['title']


@pytest.mark.asyncio
async def test_display_group_default_sort_round_trip_and_group_boundaries(pages_environment):
    from fastapi import HTTPException
    db, form, user, client = pages_environment
    user['is_admin'] = True
    value = definition()
    group = {'id': 'display', 'name': '组内排序', 'columns': ['title'], 'sortableColumns': ['title'],
             'defaultSort': {'field': 'title', 'order': 'desc'}, 'inheritDefaultSort': False}
    value['widgets'][-1]['listSettings'] = {'displayGroups': [group]}
    page = await create_publish(client, user, value)
    saved = page['publishedDefinition']['widgets'][-1]['listSettings']['displayGroups'][0]
    assert saved['defaultSort'] == {'field': 'title', 'order': 'desc'}
    assert saved['inheritDefaultSort'] is False
    for invalid in [{**group, 'sortableColumns': []}, {**group, 'defaultSort': {'field': 'qty', 'order': 'asc'}}]:
        value['widgets'][-1]['listSettings']['displayGroups'] = [invalid]
        with pytest.raises(HTTPException) as exc:
            await component_pages.validate_publish(db, user, component_pages.PageDefinition.model_validate(value))
        assert exc.value.status_code == 422


def test_filter_schemes_project_tabs_and_fields_by_any_matching_subject():
    widget = {'filterSettings': {'schemes': [
        {'id': 'common', 'name': '常用', 'fieldControls': {'qty': 'checkbox'}, 'groups': [{'id': 'public', 'columns': ['title']},
            {'id': 'role', 'roleIds': [4], 'columns': ['qty']}]},
        {'id': 'user', 'name': '个人', 'groups': [{'id': 'u', 'userIds': [12], 'columns': ['qty']}]},
        {'id': 'org', 'name': '部门', 'groups': [{'id': 'o', 'orgUnitIds': [8], 'columns': ['title']}]}]}}
    before = copy.deepcopy(widget)
    resolve = component_pages.resolve_filter_schemes
    ordinary = resolve(widget, set(), 99, set())['filterSettings']['schemes']
    assert [scheme['id'] for scheme in ordinary] == ['common']
    assert [group['id'] for group in ordinary[0]['groups']] == ['public']
    assert ordinary[0]['fieldControls'] == {}
    mixed = resolve(widget, {4}, 12, {8})['filterSettings']['schemes']
    assert [scheme['id'] for scheme in mixed] == ['common', 'user', 'org']
    assert [group['id'] for group in mixed[0]['groups']] == ['public', 'role']
    assert mixed[0]['fieldControls'] == {'qty': 'checkbox'}
    assert widget == before
    assert resolve({'filterSettings': {}}, set()) == {'filterSettings': {}}
    assert resolve({'filterSettings': {'schemes': [widget['filterSettings']['schemes'][1]]}}, set(), 99) is None


@pytest.mark.asyncio
async def test_filter_schemes_validate_visible_scheme_fields_and_clear_switch_queries(pages_environment):
    db, form, user, client = pages_environment
    await seed(db, 'Alpha'); await seed(db, 'Beta')
    value = definition()
    value['widgets'].append({'id': 'filter', 'type': 'record-filter', 'title': '方案筛选', 'targetWidgetIds': ['total'],
        'filterSettings': {'schemes': [
            {'id': 'title', 'name': '按主题', 'showKeyword': False, 'groups': [{'id': 'title-fields', 'name': '全部用户', 'columns': ['title']}]},
            {'id': 'qty', 'name': '按数量', 'groups': [{'id': 'qty-fields', 'name': '角色组', 'roleIds': [1], 'columns': ['qty']}]}
        ]}})
    page = await create_publish(client, user, value)
    user['is_admin'] = False
    path = f'/pages/{page["code"]}/data'
    queried = await client.post(path, json={'filter_queries': {'filter': {'schemeId': 'title', 'filters': [{'field':'title','op':'equals','value':'Alpha'}]}}})
    assert queried.status_code == 200, queried.text
    assert queried.json()['analyticsData']['metricValues']['total'] == 1
    switched = await client.post(path, json={'filter_queries': {'filter': {'schemeId':'qty','filters':[]}}})
    assert switched.status_code == 200
    assert switched.json()['analyticsData']['metricValues']['total'] == 2
    assert (await client.post(path, json={'filter_queries': {'filter': {'schemeId':'title','filters':[{'field':'qty','op':'equals','value':2}]}}})).status_code == 422
    user['uid'] = 99
    runtime = (await client.get(f'/pages/{page["code"]}')).json()['definition']
    assert [item['id'] for item in runtime['widgets'][-1]['filterSettings']['schemes']] == ['title']
    assert (await client.post(path, json={'filter_queries': {'filter': {'schemeId':'qty'}}})).status_code == 422
    user['is_admin'] = True
    invalid = copy.deepcopy(value)
    invalid['widgets'][-1]['filterSettings']['schemes'][0]['groups'][0]['columns'] = ['nonexistent']
    assert (await client.post(f'/pages/{page["code"]}/publish', json={'definition':invalid,'expectedRevision':page['revision']})).status_code == 422
    invalid = copy.deepcopy(value)
    invalid['widgets'][-1]['filterSettings']['schemes'][1]['groups'][0]['userIds'] = [999999]
    assert (await client.post(f'/pages/{page["code"]}/publish', json={'definition':invalid,'expectedRevision':page['revision']})).status_code == 422


def test_display_group_page_size_and_empty_text_match_the_current_audience():
    widget = {'listSettings': {'pageSize': 20, 'emptyText': '旧提示', 'displayGroups': [
        {'roleIds': [2], 'columns': ['title'], 'pageSize': 5, 'emptyText': '暂无我的申请'},
        {'roleIds': [3], 'columns': ['title'], 'pageSize': 50, 'emptyText': '暂无待办'}]}}
    original = copy.deepcopy(widget)
    resolve = component_pages.resolve_display_groups
    assert resolve(widget, {2})['listSettings']['pageSize'] == 5
    assert resolve(widget, {3})['listSettings']['emptyText'] == '暂无待办'
    assert resolve(widget, {2, 3})['listSettings']['pageSize'] == 5
    assert widget == original
    widget['listSettings']['displayGroups'][0].update(pageSize=None, emptyText=' ')
    assert resolve(widget, {2, 3})['listSettings']['emptyText'] == '暂无待办'
    assert resolve(widget, {2})['listSettings']['pageSize'] == 20


@pytest.mark.asyncio
async def test_display_group_presentation_round_trips(pages_environment):
    db, form, user, client = pages_environment
    value = definition()
    value['widgets'][-1]['listSettings'] = {'displayGroups': [{'id': 'display', 'name': '独立分页', 'columns': ['title'], 'pageSize': 7, 'emptyText': '没有符合条件的申请'}]}
    page = await create_publish(client, user, value)
    saved = page['publishedDefinition']['widgets'][-1]['listSettings']['displayGroups'][0]
    assert saved['pageSize'] == 7
    assert saved['emptyText'] == '没有符合条件的申请'
    user['is_admin'] = False
    payload = (await client.get('/pages/' + page['code'])).json()
    projected = next(widget for widget in payload['definition']['widgets'] if widget['id'] == 'list')['listSettings']
    assert projected['pageSize'] == 7
    assert projected['emptyText'] == '没有符合条件的申请'


def test_new_filter_scheme_keyword_search_is_opt_in():
    scheme = component_pages.FilterScheme(id='new', name='New')
    assert scheme.showKeyword is False
    assert component_pages.FilterScheme(id='old', name='Old', showKeyword=True).showKeyword is True
    assert component_pages.FilterSettings().showKeyword is True  # legacy pages keep their configured behavior


@pytest.mark.asyncio
async def test_audience_templates_extract_subjects_without_importing_fields_or_actions(pages_environment):
    db, form, user, client = pages_environment
    user['is_admin'] = True
    saved = await client.post('/pages/permission-templates', json={'scope':'display','name':'字段权限模板',
        'groups':[{'id':'group','name':'角色组','roleIds':[1],'columns':['title'],'actions':['refresh']}]})
    assert saved.status_code == 200, saved.text
    imported = (await client.get('/pages/permission-templates?scope=audience')).json()['data']
    assert len(imported) == 1
    group = imported[0]['groups'][0]
    assert group['roleIds'] == [1]
    assert group['actions'] == []
    assert 'columns' not in group
    assert (await client.post('/pages/permission-templates', json={'scope':'audience','name':'共享对象','groups':[group]})).status_code == 200
    assert (await client.post('/pages/permission-templates', json={'scope':'audience','name':'非法按钮','groups':[{**group,'actions':['query']}]})).status_code == 422
    user['tenant_id'] = 2
    assert (await client.get('/pages/permission-templates?scope=audience')).json()['data'] == []


@pytest.mark.asyncio
async def test_legacy_form_shared_designer_preserves_runtime_until_publication(pages_environment):
    db, form, user, client = pages_environment
    await seed(db, 'Keep business record')
    form.config = {'assemblyKind': 'interaction', 'viewConfigDraft': {'private': True}}
    await db.commit()
    assert (await client.get(f'/pages/forms/{form.code}/binding')).json()['enabled'] is False
    user['is_admin'] = True
    pending = (await client.get(f'/pages/forms/{form.code}/binding')).json()
    assert pending['enabled'] and pending['form']['id'] == form.id
    page = (await client.post(f'/pages/forms/{form.id}/binding', json={'blank': True})).json()
    assert page['definition']['widgets'] == []
    assert page['definition']['sourceFormId'] is None
    await db.refresh(form)
    assert form.config['viewConfigDraft'] == {'private': True}
    assert form.status == 'published'
    user['is_admin'] = False
    assert (await client.get(f'/pages/forms/{form.code}/binding')).json()['enabled'] is False
    user['is_admin'] = True
    response = await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': page['definition'], 'expectedRevision': page['revision']})
    assert response.status_code == 200, response.text
    user['is_admin'] = False
    assert (await client.get(f'/pages/forms/{form.code}/binding')).json()['code'] == page['code']
    assert len((await client.get('/forms/1/records')).json()['data']) == 1


@pytest.mark.asyncio
async def test_shared_page_formula_calculation_and_missing_field_validation(pages_environment):
    db, _, user, client = pages_environment
    await seed(db, 'Formula record')
    value = definition()
    value['widgets'] = [{'id': 'formula', 'type': 'metric', 'title': '平均数量',
                         'expression': 'sum(qty) / count()', 'width': 6}]
    page = await create_publish(client, user, value)
    response = await client.post(f'/pages/{page["code"]}/data', json={})
    assert response.status_code == 200, response.text
    assert response.json()['analyticsData']['metricValues']['formula'] == 2
    for expression in ('sum(missing)', '__import__("os")', 'sum('):
        invalid = copy.deepcopy(value)
        invalid['widgets'][0]['expression'] = expression
        response = await client.post(f'/pages/{page["code"]}/publish', json={
            'definition': invalid, 'expectedRevision': page['revision']})
        assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_menu_page_target_rejects_drafts_and_obeys_page_audience(environment, monkeypatch):
    from app.api import applications
    from app.models.relational import Application, ApplicationRole, ComponentPage, Role, UserRole

    db, factory, _, user, client = environment
    user['is_admin'] = True
    app_api = client._transport.app
    app_api.include_router(component_pages.router, prefix='/pages')
    app_api.include_router(applications.router, prefix='/applications')

    async def query_fixture_database(query):
        async with factory() as session:
            return await query(session)

    monkeypatch.setattr(applications, 'safe_db_call', query_fixture_database)
    app = Application(tenant_id=1, name='流程应用', code='request-app', status='published')
    db.add_all([app, Role(id=2, tenant_id=1, name='reviewer', label='Reviewer'),
                ComponentPage(tenant_id=2, code='other-page', draft={'title': '其他租户页面'})])
    await db.flush()
    db.add(ApplicationRole(tenant_id=1, application_id=app.id, role_id=1))
    await db.commit()

    draft = await client.post('/pages', json={'title': '审批页面'})
    assert draft.status_code == 200, draft.text
    page = draft.json()
    path = f'/forms/applications/{app.id}/menu-nodes'
    assert (await client.post(path, json={'title': '审批', 'page_code': page['code']})).status_code == 409
    assert (await client.post(path, json={'title': '其他', 'page_code': 'other-page'})).status_code == 404

    legacy = await client.post(path, json={'title': '审批', 'form_id': 1, 'route_path': '/dynamic/record-contract'})
    assert legacy.status_code == 200, legacy.text
    entry = legacy.json()['data']
    assert entry['route_path'] == '/dynamic/record-contract'
    published = await client.post(f'/pages/{page["code"]}/publish', json={
        'definition': {**page['definition'], 'roleIds': [2]},
        'expectedRevision': page['revision'],
    })
    assert published.status_code == 200, published.text
    migrated = await client.put(f'{path}/{entry["id"]}', json={'page_code': page['code']})
    assert migrated.status_code == 200, migrated.text
    [saved] = (await client.get(path)).json()['data']
    assert (saved['id'], saved['title'], saved['form_id'], saved['page_code'], saved['route_path']) == (
        entry['id'], '审批', None, page['code'], f'/pages/{page["code"]}',
    )

    user['is_admin'] = False
    runtime_path = f'/applications/{app.id}/menus'
    hidden = await client.get(runtime_path)
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()['data'] == []
    db.add(UserRole(tenant_id=1, user_id=user['uid'], role_id=2))
    await db.commit()
    visible = await client.get(runtime_path)
    assert visible.status_code == 200, visible.text
    assert [item['route_path'] for item in visible.json()['data']] == [saved['route_path']]
