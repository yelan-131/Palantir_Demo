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
    # A source publication that removes a bound filter prevents republishing stale conditions.
    broken = copy.deepcopy(current)
    broken['widgets'][-1]['filterFields'] = ['qty']
    broken['widgets'][-1]['filterSettings']['requiredFields'] = ['qty']
    response = await client.post(f'/pages/{page["code"]}/preview', json={'definition': broken})
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_business_component_settings_reject_invalid_bounds_and_actions(pages_environment):
    _, _, user, client = pages_environment
    user['is_admin'] = True
    for patch in ({'pageSize': 0}, {'pageSize': 201}, {'rowActions': ['execute']}, {'selection': 'unknown'}):
        value = definition(); value['widgets'][-1]['listSettings'] = patch
        assert (await client.post('/pages', json=value)).status_code == 422
