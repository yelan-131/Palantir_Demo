"""Editor HTTP contracts against real dynamic/physical storage and version history."""
import copy
import json
from datetime import datetime

import pytest
from sqlalchemy import func, select

from app.api import forms
from app.models.relational import AuditLog, Form, FormField, FormVersion
from tests.test_analytics_sources import source_design
from tests.test_record_service import environment, seed


BASE = '/dashboard/programs/record-contract/analytics'


async def published_board(db, form, user):
    user['is_admin'] = True
    form.config = {'analyticsDesign': source_design(), 'viewConfig': {'published': True},
                   'permissionDesign': {'published': True}, 'otherConfig': 'published'}
    await db.flush()
    await db.refresh(form)
    snapshot = await forms._form_snapshot(db, 1, form)
    # These are deliberately distinct from later live drafts.
    snapshot['workflow_bindings'] = [{'sentinel': 'published workflow'}]
    snapshot['layouts'] = [{'sentinel': 'published layout'}]
    snapshot['actions'] = [{'sentinel': 'published action'}]
    version = FormVersion(tenant_id=1, form_id=form.id, version=1, status='published',
                          snapshot=snapshot, published_at=datetime.now(), published_by=1)
    db.add(version)
    await db.commit()
    return version


@pytest.mark.asyncio
async def test_preview_uses_real_filters_without_saving_any_configuration(environment):
    db, _, form, user, client = environment
    await seed(db, 'A'); await seed(db, 'B')
    await published_board(db, form, user)
    before = copy.deepcopy(form.config)
    design = source_design()
    design['metrics'][0]['expression'] = 'count(*)'
    design['interactions'] = [{'sourceWidgetId': 'total', 'targetWidgetId': 'another', 'action': 'filter'}]
    response = await client.post(f'{BASE}/preview', json={'design': design, 'filters': {'title': 'A'}})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['analyticsDesignState'] == 'draft'
    assert payload['analyticsData']['metricValues']['metric-total'] == 1
    assert payload['analyticsData']['errors']  # An unfinished link is editable, not a failed request.
    await db.refresh(form)
    assert form.config == before
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 1
    assert not (await db.scalars(select(AuditLog).where(AuditLog.resource_type == 'form_analytics'))).all()
    runtime = (await client.get('/dashboard/programs/record-contract')).json()
    assert runtime['analyticsData']['metricValues']['metric-total'] == 4


@pytest.mark.asyncio
async def test_editor_requires_admin_for_read_preview_save_and_publish(environment):
    _, _, _, _, client = environment
    for method, suffix, body in [('get', 'editor', None), ('get', 'versions', None), ('get', 'versions/1', None),
                                 ('post', 'preview', {'design': source_design()}),
                                 ('put', 'draft', {'design': source_design(), 'expectedRevision': 'old'}),
                                 ('post', 'publish', {'design': source_design(), 'expectedRevision': 'old'})]:
        response = await client.request(method, f'{BASE}/{suffix}', **({'json': body} if body else {}))
        assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_draft_isolated_from_runtime_and_revision_conflicts_cannot_overwrite(environment):
    db, _, form, user, client = environment
    await published_board(db, form, user)
    original = (await client.get(f'{BASE}/editor')).json()
    assert original['publishedVersion'] == 1
    draft = source_design()
    draft['widgets'][0]['title'] = 'Edited draft'
    draft['metrics'][0].update(description='按当前筛选范围汇总数量', unit='件')
    response = await client.put(f'{BASE}/draft', json={'design': draft, 'expectedRevision': original['revision']})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['design'] == draft and saved['publishedDesign'] == original['publishedDesign']
    assert saved['draftSavedAt'] and saved['revision'] != original['revision']
    for method, suffix in [('put', 'draft'), ('post', 'publish')]:
        response = await client.request(method, f'{BASE}/{suffix}', json={'design': source_design(), 'expectedRevision': original['revision']})
        assert response.status_code == 409, response.text
    assert (await client.get(f'{BASE}/editor')).json()['design'] == draft
    assert (await client.get('/dashboard/programs/record-contract')).json()['analyticsDesign'] == original['publishedDesign']
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 1


@pytest.mark.asyncio
async def test_simultaneous_writers_cannot_silently_overwrite_each_other(environment):
    import asyncio
    from fastapi import HTTPException
    from app.services.analytics_editor import AnalyticsWriteRequest, write_design

    db, factory, form, user, client = environment
    await published_board(db, form, user)
    initial = (await client.get(f'{BASE}/editor')).json()
    await db.commit()

    async def save(title):
        design = source_design()
        design['widgets'][0]['title'] = title
        async with factory() as session:
            try:
                return await write_design(session, user, form.code,
                    AnalyticsWriteRequest(design=design, expectedRevision=initial['revision']))
            except HTTPException as exc:
                await session.rollback()
                return exc.status_code

    results = await asyncio.wait_for(asyncio.gather(save('Editor A'), save('Editor B')), 15)
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 409 in results
    await db.refresh(form)
    winner = next(result for result in results if isinstance(result, dict))
    assert form.config['analyticsDesignDraft'] == winner['design']


@pytest.mark.asyncio
async def test_publish_only_promotes_analytics_and_preserves_all_other_drafts(environment):
    db, _, form, user, client = environment
    old_version = await published_board(db, form, user)
    old_snapshot = copy.deepcopy(old_version.snapshot)
    form.name = 'Unpublished form name'
    other_drafts = {'otherConfig': 'unpublished', 'viewConfigDraft': {'draft': True},
                    'permissionDesignDraft': {'unpublished': True}, 'formDesignerControls': [{'draft': True}],
                    'workflowDraft': {'unpublished': True}}
    form.config = {**form.config, **other_drafts}
    db.add(FormField(tenant_id=1, form_id=1, field_name='new_draft_field', label='Unpublished', field_type='string'))
    await db.commit()
    initial = (await client.get(f'{BASE}/editor')).json()
    design = source_design()
    design['widgets'][0]['title'] = 'Published dashboard title'
    response = await client.post(f'{BASE}/publish', json={'design': design, 'expectedRevision': initial['revision']})
    assert response.status_code == 200, response.text
    state = response.json()
    assert state['publishedVersion'] == 2 and state['publishedDesign'] == state['design'] == design
    assert state['revision'] != initial['revision']
    latest = await db.scalar(select(FormVersion).where(FormVersion.version == 2))
    for key in ('fields', 'permissions', 'workflow_bindings', 'layouts', 'actions'):
        assert latest.snapshot[key] == old_snapshot[key]
    assert latest.snapshot['form']['name'] == old_snapshot['form']['name']
    published_config = latest.snapshot['form']['config']
    assert published_config['otherConfig'] == 'published'
    assert published_config['permissionDesign'] == old_snapshot['form']['config']['permissionDesign']
    assert not any(key in published_config for key in ('viewConfigDraft', 'permissionDesignDraft', 'workflowDraft'))
    assert published_config['analyticsDesign'] == design
    await db.refresh(form)
    assert {key: form.config[key] for key in other_drafts} == other_drafts
    assert form.name == 'Unpublished form name'
    assert old_version.snapshot == old_snapshot
    audit = await db.scalar(select(AuditLog).where(AuditLog.resource_type == 'form_analytics', AuditLog.action == 'publish'))
    assert audit and json.loads(audit.new_values)['version'] == 2
    assert (await client.get('/dashboard/programs/record-contract')).json()['analyticsDesign'] == design


@pytest.mark.asyncio
async def test_publish_validates_published_self_schema_and_failure_is_atomic(environment):
    db, _, form, user, client = environment
    await published_board(db, form, user)
    db.add(FormField(tenant_id=1, form_id=1, field_name='draft_measure', label='Draft only', field_type='integer'))
    await db.commit()
    initial = (await client.get(f'{BASE}/editor')).json()
    design = source_design()
    design['datasets'][0]['measures'].append('draft_measure')
    design['metrics'][0]['expression'] = 'sum(draft_measure)'
    response = await client.post(f'{BASE}/publish', json={'design': design, 'expectedRevision': initial['revision']})
    assert response.status_code == 422, response.text
    assert 'draft_measure' in response.text
    assert (await client.get(f'{BASE}/editor')).json() == initial
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 1


@pytest.mark.asyncio
async def test_tenant_boundaries_apply_to_board_and_preview_sources(environment):
    db, _, form, user, client = environment
    await published_board(db, form, user)
    foreign = Form(id=9, tenant_id=2, code='private-board', name='Private', config={'analyticsDesign': source_design()})
    db.add(foreign)
    await db.commit()
    for method, suffix, body in [('get', 'editor', None), ('get', 'versions', None), ('get', 'versions/1', None),
                                 ('post', 'preview', {'design': source_design()}),
                                 ('put', 'draft', {'design': source_design(), 'expectedRevision': 'old'}),
                                 ('post', 'publish', {'design': source_design(), 'expectedRevision': 'old'})]:
        response = await client.request(method, f'/dashboard/programs/private-board/analytics/{suffix}', **({'json': body} if body else {}))
        assert response.status_code == 404, response.text
    response = await client.post(f'{BASE}/preview', json={'design': source_design('private-board')})
    assert response.status_code == 200, response.text
    data = response.json()['analyticsData']
    assert data['errors'] and data['widgets']['total']['rows'] == []
    assert data['widgets']['total']['metricValues']['metric-total'] is None
    current = (await client.get(f'{BASE}/editor')).json()
    response = await client.post(f'{BASE}/publish', json={'design': source_design('9'), 'expectedRevision': current['revision']})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_first_publish_requires_initialized_form_but_drafts_remain_saveable(environment):
    db, _, form, user, client = environment
    user['is_admin'] = True
    initial = (await client.get(f'{BASE}/editor')).json()
    assert initial['publishedVersion'] is None
    response = await client.put(f'{BASE}/draft', json={'design': source_design(), 'expectedRevision': initial['revision']})
    assert response.status_code == 200, response.text
    saved = response.json()
    response = await client.post(f'{BASE}/publish', json={'design': source_design(), 'expectedRevision': saved['revision']})
    assert response.status_code == 409
    assert '首次发布' in response.text
    assert (await client.get(f'{BASE}/editor')).json()['design'] == source_design()
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 0


@pytest.mark.asyncio
async def test_preview_rejects_malformed_structure_and_filters_without_500(environment):
    db, _, form, user, client = environment
    await published_board(db, form, user)
    for design in ({'datasets': {}}, {'datasets': [None]}, {'widgets': [{'id': []}]},
                   {'datasets': [{'id': 'bad', 'dimensions': {'bad': 'type'}}]}):
        response = await client.post(f'{BASE}/preview', json={'design': design})
        assert response.status_code == 422, response.text
    for filters in ({'title': {}}, {'secret': 'private'}, {'title': ['A']}):
        response = await client.post(f'{BASE}/preview', json={'design': source_design(), 'filters': filters})
        assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_stale_legacy_save_cannot_overwrite_managed_dashboard(environment, monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    db, _, form, user, client = environment
    await published_board(db, form, user)
    stale_config = copy.deepcopy(form.config)
    initial = (await client.get(f'{BASE}/editor')).json()
    design = source_design()
    design['widgets'][0]['title'] = 'New dashboard draft'
    response = await client.put(f'{BASE}/draft', json={'design': design, 'expectedRevision': initial['revision']})
    assert response.status_code == 200, response.text
    saved = response.json()
    await db.refresh(form)
    assert form.config['analyticsDesignMeta']['managedBy'] == 'analytics-editor'
    for config in (stale_config, None, {**form.config, 'analyticsDesignDraft': source_design()}):
        response = await client.put('/forms/1', json={'config': config})
        assert response.status_code == 409, response.text
        assert '看板编辑器' in response.text
    assert (await client.get(f'{BASE}/editor')).json() == saved

    fresh_config = {**form.config, 'otherConfig': 'fresh unrelated update'}
    response = await client.put('/forms/1', json={'config': fresh_config})
    assert response.status_code == 200, response.text
    assert response.json()['data']['config']['otherConfig'] == 'fresh unrelated update'
    assert (await client.get(f'{BASE}/editor')).json() == saved
    response = await client.put('/forms/1', json={'description': 'Metadata edit without config'})
    assert response.status_code == 200, response.text

    # Dashboard writes still work after a permitted generic form update.
    response = await client.post(f'{BASE}/publish', json={'design': design, 'expectedRevision': saved['revision']})
    assert response.status_code == 200, response.text
    assert response.json()['publishedDesign'] == design
    await db.refresh(form)
    assert form.config['otherConfig'] == 'fresh unrelated update'


@pytest.mark.asyncio
async def test_legacy_initialization_and_general_publish_still_work(environment, monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    db, _, form, user, client = environment
    user['is_admin'] = True
    initial = (await client.get(f'{BASE}/editor')).json()
    response = await client.put(f'{BASE}/draft', json={'design': source_design(), 'expectedRevision': initial['revision']})
    assert response.status_code == 200, response.text
    await db.refresh(form)
    initialized = source_design()
    initialized['widgets'][0]['title'] = 'Initialized in form settings'
    response = await client.put('/forms/1', json={'config': {**form.config, 'analyticsDesignDraft': initialized}})
    assert response.status_code == 200, response.text
    response = await client.post('/forms/1/publish')
    assert response.status_code == 200, response.text
    editor = (await client.get(f'{BASE}/editor')).json()
    assert editor['publishedDesign'] == initialized and editor['publishedVersion'] == 1
    await db.refresh(form)
    response = await client.put('/forms/1', json={'config': {**form.config, 'otherConfig': 'general form draft'}})
    assert response.status_code == 200, response.text
    response = await client.post('/forms/1/publish')
    assert response.status_code == 200, response.text
    version = await db.scalar(select(FormVersion).where(FormVersion.form_id == 1, FormVersion.version == 2))
    assert version.snapshot['form']['config']['analyticsDesign'] == initialized
    assert version.snapshot['form']['config']['otherConfig'] == 'general form draft'


@pytest.mark.asyncio
async def test_running_legacy_dashboard_can_publish_first_version_without_promoting_other_drafts(environment):
    from app.models.relational import FormLayout, FormPermission, WorkflowBinding, WorkflowDef
    from app.services.records import runtime_fields

    db, _, form, user, client = environment
    await seed(db, 'A'); await seed(db, 'B')
    live_view = {'table': {'columns': [{'fieldName': 'title', 'enabled': True}, {'fieldName': 'qty', 'enabled': True}]}}
    view_draft = {'table': {'columns': [{'fieldName': 'title', 'enabled': True}]}}
    live_permissions = {'roles': {'reader': {'actions': {'view': True}, 'data': {'scope': 'all'}}}}
    other_config = {
        'viewConfig': live_view, 'viewConfigDraft': view_draft,
        'viewConfigMeta': {'publishedVersion': 1, 'draftVersion': 2, 'draftSavedAt': 'later', 'status': 'draft'},
        'permissionDesign': live_permissions,
        'permissionDesignDraft': {'roles': {'reader': {'actions': {'view': False}, 'data': {'ownership': {'statistics': False}}}}},
        'workflowConfig': {'active': True}, 'workflowConfigDraft': {'active': False},
        'workflowDesigner': {'publishedWorkflowId': 11, 'draftWorkflowId': 12},
        'formDesignerControls': [{'id': 'qty-control', 'fieldKey': 'qty', 'controlType': 'number',
                                  'name': 'Draft label', 'rules': {'required': {'enabled': True}}}],
    }
    form.config = {**copy.deepcopy(other_config), 'analyticsDesign': source_design()}
    db.add_all([
        WorkflowDef(id=11, tenant_id=1, name='Active flow', status='published', config='{}'),
        WorkflowDef(id=12, tenant_id=1, name='Draft flow', status='draft', config='{}'),
        FormLayout(tenant_id=1, form_id=1, layout_type='view', config={'published': live_view, 'draft': view_draft}),
    ])
    await db.flush()
    db.add(WorkflowBinding(tenant_id=1, form_id=1, workflow_id=11, trigger_action='submit', enabled=True))
    await db.commit()
    before = (await client.get('/dashboard/programs/record-contract')).json()
    before_fields = [forms._field_payload(field) for field in await runtime_fields(db, form)]
    before_permissions = [forms._permission_payload(permission) for permission in
        (await db.scalars(select(FormPermission).where(FormPermission.form_id == 1).order_by(FormPermission.id))).all()]
    stale_config = copy.deepcopy(form.config)
    user['is_admin'] = True
    editor = (await client.get(f'{BASE}/editor')).json()
    assert editor['publishedVersion'] is None and editor['publishedDesign'] == source_design()
    design = source_design()
    design['widgets'][0]['title'] = 'First separately published dashboard'
    saved = await client.put(f'{BASE}/draft', json={'design': design, 'expectedRevision': editor['revision']})
    assert saved.status_code == 200, saved.text
    # Managed legacy boards are protected even before their first FormVersion.
    stale = await client.put('/forms/1', json={'config': stale_config})
    assert stale.status_code == 409, stale.text
    response = await client.post(f'{BASE}/publish', json={'design': design, 'expectedRevision': saved.json()['revision']})
    assert response.status_code == 200, response.text
    assert response.json()['publishedVersion'] == 1
    version = await db.scalar(select(FormVersion).where(FormVersion.form_id == 1))
    snapshot = version.snapshot
    config = snapshot['form']['config']
    assert snapshot['fields'] == before_fields  # No draft required/label/visibility rules applied.
    assert snapshot['permissions'] == before_permissions
    assert config['viewConfig'] == live_view and config['permissionDesign'] == live_permissions
    assert config['workflowConfig'] == {'active': True}
    assert config['workflowDesigner'] == {'publishedWorkflowId': 11}
    assert all(key not in config for key in ('viewConfigDraft', 'permissionDesignDraft', 'workflowConfigDraft'))
    assert 'draftVersion' not in config['viewConfigMeta'] and 'draftSavedAt' not in config['viewConfigMeta']
    assert config['analyticsDesign'] == config['analyticsDesignDraft'] == design
    assert snapshot['workflow_bindings'][0]['workflow_id'] == 11
    assert snapshot['layouts'][0]['config'] == {'published': live_view}
    await db.refresh(form)
    assert {key: form.config[key] for key in other_config} == other_config
    layout = await db.scalar(select(FormLayout).where(FormLayout.form_id == 1))
    assert layout.config == {'published': live_view, 'draft': view_draft}
    draft_workflow = await db.get(WorkflowDef, 12)
    assert draft_workflow.status == 'draft'
    assert [forms._field_payload(field) for field in await runtime_fields(db, form)] == before_fields
    user['is_admin'] = False
    after = (await client.get('/dashboard/programs/record-contract')).json()
    assert after['analyticsDesign'] == design
    assert after['analyticsData'] == before['analyticsData']


@pytest.mark.asyncio
async def test_component_appearance_publishes_without_changing_metrics_and_preserves_history(environment):
    db, _, form, user, client = environment
    await seed(db, 'A')
    await published_board(db, form, user)
    state = (await client.get(f'{BASE}/editor')).json()
    design = copy.deepcopy(state['design'])
    appearance = {'subtitle': '当前授权数据', 'palette': 'business', 'height': 360, 'radius': 16,
                  'showLegend': False, 'showLabels': True, 'smooth': True}
    design['widgets'][0]['appearance'] = appearance
    saved = await client.put(f'{BASE}/draft', json={'design': design, 'expectedRevision': state['revision']})
    assert saved.status_code == 200, saved.text
    response = await client.post(f'{BASE}/publish', json={'design': design, 'expectedRevision': saved.json()['revision']})
    assert response.status_code == 200, response.text
    live = (await client.get('/dashboard/programs/record-contract')).json()
    assert live['analyticsDesign']['widgets'][0]['appearance'] == appearance
    assert live['analyticsDesign']['metrics'] == state['design']['metrics']
    assert live['analyticsData']['metricValues']['metric-total'] == 2
    old = (await client.get(f'{BASE}/versions/1')).json()
    assert 'appearance' not in old['design']['widgets'][0]
