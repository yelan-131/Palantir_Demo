import copy
"""Real record boundary, tenant isolation, published config and source permissions."""
import pytest
from tests.test_record_service import environment, seed
from app.models.relational import Form, FormField, FormPermission


def source_design(source='record-contract'):
    return {'datasets': [{'id': 'source', 'name': '业务来源', 'sourceType': 'businessForm', 'source': source, 'dimensions': ['title'], 'measures': ['qty'], 'refreshMode': 'manual'}],
            'metrics': [{'id': 'metric-total', 'name': '数量', 'datasetId': 'source', 'expression': 'sum(qty)'}],
            'widgets': [{'id': 'total', 'title': '数量', 'type': 'metric-card', 'datasetId': 'source', 'metricIds': ['metric-total']}], 'globalFilters': ['title'], 'interactions': []}

@pytest.mark.asyncio
async def test_cross_form_dataset_uses_source_records_and_its_permissions(environment):
    db, factory, source, user, client = environment
    await seed(db, 'A'); await seed(db, 'B')
    board = Form(id=5, tenant_id=1, code='analytics-board', name='Board', status='published', config={'analyticsDesign': source_design()})
    db.add(board); await db.flush()
    db.add(FormPermission(tenant_id=1, form_id=5, role_id=1, action='view', effect='allow'))
    await db.commit()
    response = await client.get('/dashboard/programs/analytics-board')
    assert response.status_code == 200, response.text
    data = response.json()['analyticsData']
    assert data['metricValues']['metric-total'] == 4
    assert data['widgets']['total']['total'] == 2
    assert not data['errors']
    assert set(data['fieldLabels']['source']) == {'title', 'qty'}
    assert 'secret' not in data['fieldLabels']['source']
    response = await client.get('/dashboard/programs/analytics-board', params={'filters': '{"title":"A"}'})
    assert response.json()['analyticsData']['metricValues']['metric-total'] == 2
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='view', effect='deny')); await db.commit()
    response = await client.get('/dashboard/programs/analytics-board')
    data = response.json()['analyticsData']
    assert data['errors']
    assert data['widgets']['total']['rows'] == []
    assert data['widgets']['total']['metricValues']['metric-total'] is None
    assert data['fieldLabels'] == {}

@pytest.mark.asyncio
async def test_datasets_cannot_read_another_tenant_and_drafts_are_ignored(environment):
    db, factory, form, user, client = environment
    await seed(db, 'A')
    form.config = {'analyticsDesign': source_design(), 'analyticsDesignDraft': source_design('private-source')}
    db.add(Form(id=9, tenant_id=2, code='private-source', name='Private', status='published'))
    await db.commit()
    response = await client.get('/dashboard/programs/record-contract')
    assert response.json()['analyticsData']['metricValues']['metric-total'] == 2
    form.config = {'analyticsDesign': source_design('private-source')}; await db.commit()
    response = await client.get('/dashboard/programs/record-contract')
    data = response.json()['analyticsData']
    assert data['errors']
    assert data['widgets']['total']['rows'] == []
    assert data['widgets']['total']['metricValues']['metric-total'] is None

@pytest.mark.asyncio
async def test_invalid_filters_return_422_without_reading_other_fields(environment):
    db, factory, form, user, client = environment
    form.config = {'analyticsDesign': source_design()}; await db.commit()
    for filters in ['[]', '{"title":{"bad":1}}', '{"secret":"private"}']:
        response = await client.get('/dashboard/programs/record-contract', params={'filters': filters})
        assert response.status_code == 422, response.text

@pytest.mark.asyncio
async def test_publication_blocks_bad_formulas_sources_and_cross_dataset_bindings(environment, monkeypatch):
    from unittest.mock import AsyncMock
    from app.api import forms
    db, factory, form, user, client = environment
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    user['is_admin'] = True
    design = source_design()
    form.config = {'analyticsDesignDraft': design}
    await db.commit()
    response = await client.post('/forms/1/publish')
    assert response.status_code == 200, response.text
    await db.refresh(form)
    published = copy.deepcopy(form.config['analyticsDesign'])
    bad = source_design('missing-source')
    bad['metrics'][0]['expression'] = 'sum(missing_field)'
    bad['widgets'][0]['metricIds'] = ['nonexistent']
    form.config = {**form.config, 'analyticsDesignDraft': bad}
    await db.commit()
    response = await client.post('/forms/1/publish')
    assert response.status_code == 409, response.text
    report = response.json()['detail']['report']
    assert report['blocking_count'] >= 3
    response = await client.get('/dashboard/programs/record-contract')
    assert response.json()['analyticsDesign'] == published

@pytest.mark.asyncio
async def test_hidden_measure_cannot_be_aggregated_or_returned_in_details(environment):
    db, factory, form, user, client = environment
    await seed(db, 'A')
    form.config = {'analyticsDesign': source_design()}
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, field_name='qty', action='view', effect='deny'))
    await db.commit()
    response = await client.get('/dashboard/programs/record-contract')
    assert response.status_code == 200, response.text
    data = response.json()['analyticsData']
    assert data['metricValues']['metric-total'] is None
    assert data['errors']
    assert all('qty' not in row and 'secret' not in row for row in data['widgets']['total']['rows'])
    assert set(data['fieldLabels']['source']) == {'title'}
