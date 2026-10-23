"""Shared identities, authoritative formulas, impact checks and atomic propagation."""
import copy

import pytest
from sqlalchemy import func, select

from app.api import forms
from app.models.relational import AnalyticsSharedMetricVersion, Form, FormVersion
from tests.test_record_service import environment, seed
from tests.test_analytics_sources import source_design

LIB = '/dashboard/analytics/metrics'
BOARD = '/dashboard/programs/record-contract/analytics'


def definition(source='record-contract', expression='sum(qty)'):
    return {'name': '共享数量', 'source': source, 'expression': expression,
            'format': 'number', 'unit': '件', 'description': '当前授权范围的数量', 'threshold': ''}


async def publish(client, item, values=None, **extra):
    body = {'definition': values or item['draft'], 'expectedRevision': item['revision']}
    impact = await client.post(f'{LIB}/{item["id"]}/impact', json=body)
    assert impact.status_code == 200, impact.text
    return await client.post(f'{LIB}/{item["id"]}/publish', json={**body, 'impactToken': impact.json()['impactToken'], **extra})


async def library(client):
    response = await client.post(LIB, json=definition())
    assert response.status_code == 200, response.text
    response = await publish(client, response.json(), note='首个共享口径')
    assert response.status_code == 200, response.text
    return response.json()


def bound_design(item):
    design = source_design()
    design['metrics'][0] = {**{key: item['published'][key] for key in ('name', 'expression', 'format', 'unit', 'description', 'threshold')},
        'id': 'metric-total', 'datasetId': 'source', 'sharedMetricId': item['id'], 'sharedMetricVersion': item['publishedVersion']}
    return design


async def board(db, form, user, design, *, draft=True):
    form.config = {'analyticsDesign': copy.deepcopy(design), 'viewConfig': {'keep': 'live'}}
    await db.flush()
    await db.refresh(form)
    snapshot = await forms._form_snapshot(db, 1, form)
    db.add(FormVersion(tenant_id=1, form_id=form.id, version=1, status='published', snapshot=copy.deepcopy(snapshot)))
    config = copy.deepcopy(form.config)
    config['viewConfigDraft'] = {'keep': 'pending'}
    config['otherSetting'] = 'pending'
    if draft:
        config['analyticsDesignDraft'] = copy.deepcopy(design)
        config['analyticsDesignDraft']['widgets'][0]['title'] = '未发布的图表标题'
    form.config = config
    await db.commit()
    return snapshot


@pytest.mark.asyncio
async def test_library_requires_admin_and_does_not_disclose_foreign_tenant(environment):
    db, _, form, user, client = environment
    for method, suffix, body in [('get', '', None), ('post', '', definition()), ('get', '/unknown', None),
        ('get', '/unknown/references', None), ('put', '/unknown/draft', {'definition': definition(), 'expectedRevision': 'old'}),
        ('post', '/unknown/impact', {'definition': definition(), 'expectedRevision': 'old'}),
        ('post', '/unknown/publish', {'definition': definition(), 'expectedRevision': 'old', 'impactToken': 'old'})]:
        response = await client.request(method, LIB + suffix, **({'json': body} if body else {}))
        assert response.status_code == 403, response.text
    user['is_admin'] = True
    item = await library(client)
    user['tenant_id'] = 2
    assert (await client.get(LIB)).json()['items'] == []
    assert (await client.get(f'{LIB}/{item["id"]}')).status_code == 404
    assert (await client.get(f'{LIB}/{item["id"]}/references')).status_code == 404
    assert (await client.post(LIB, json=definition())).status_code == 422


@pytest.mark.asyncio
async def test_shared_binding_ignores_forged_local_formula_and_rejects_source_or_version_changes(environment):
    db, _, form, user, client = environment
    await seed(db, 'A'); await seed(db, 'B')
    user['is_admin'] = True
    item = await library(client)
    design = bound_design(item)
    design['metrics'][0].update(expression='count(*)', name='伪造的口径', unit='错误')
    preview = await client.post(f'{BOARD}/preview', json={'design': design})
    assert preview.status_code == 200, preview.text
    assert preview.json()['analyticsData']['metricValues']['metric-total'] == 4
    editor = (await client.get(f'{BOARD}/editor')).json()
    saved = await client.put(f'{BOARD}/draft', json={'design': design, 'expectedRevision': editor['revision']})
    assert saved.status_code == 200, saved.text
    metric = saved.json()['design']['metrics'][0]
    assert metric['expression'] == 'sum(qty)' and metric['name'] == '共享数量' and metric['unit'] == '件'
    bad = copy.deepcopy(design); bad['metrics'][0]['sharedMetricVersion'] = 999
    preview = await client.post(f'{BOARD}/preview', json={'design': bad})
    assert preview.json()['analyticsData']['metricValues']['metric-total'] is None
    assert preview.json()['analyticsData']['errors']
    response = await client.put(f'{BOARD}/draft', json={'design': bad, 'expectedRevision': saved.json()['revision']})
    assert response.status_code == 422
    db.add(Form(id=5, tenant_id=1, code='other-source', name='Other'))
    await db.commit()
    bad = copy.deepcopy(design); bad['datasets'][0]['source'] = 'other-source'
    assert (await client.put(f'{BOARD}/draft', json={'design': bad, 'expectedRevision': saved.json()['revision']})).status_code == 422
    bad = copy.deepcopy(design); bad['metrics'][0]['sharedMetricVersion'] = True
    assert (await client.post(f'{BOARD}/preview', json={'design': bad})).status_code == 422


@pytest.mark.asyncio
async def test_metric_draft_and_publication_update_all_boards_preserving_other_drafts_and_history(environment):
    db, _, form, user, client = environment
    await seed(db, 'A'); await seed(db, 'B')
    user['is_admin'] = True
    item = await library(client)
    original = await board(db, form, user, bound_design(item))
    second = Form(id=5, tenant_id=1, code='second-board', name='第二张看板')
    db.add(second); await db.flush()
    await board(db, second, user, bound_design(item))
    before = (await client.get(f'{BOARD}/editor')).json()
    updated = definition(expression='avg(qty)')
    saved = await client.put(f'{LIB}/{item["id"]}/draft', json={'definition': updated, 'expectedRevision': item['revision']})
    assert saved.status_code == 200, saved.text
    item = saved.json()
    assert item['published']['expression'] == 'sum(qty)'
    assert (await client.get('/dashboard/programs/record-contract')).json()['analyticsData']['metricValues']['metric-total'] == 4
    checked = (await client.post(f'{LIB}/{item["id"]}/impact', json={'definition': updated, 'expectedRevision': item['revision']})).json()
    assert checked['counts'] == {'publishedBoards': 2, 'publishedCharts': 2, 'draftBoards': 2, 'draftCharts': 2}
    assert {row['boardName'] for row in checked['references']} == {'Contract', '第二张看板'}
    assert not checked['errors']
    response = await client.post(f'{LIB}/{item["id"]}/publish', json={'definition': updated,
        'expectedRevision': item['revision'], 'impactToken': checked['impactToken'], 'note': '平均数量口径'})
    assert response.status_code == 200, response.text
    assert response.json()['publishedVersion'] == 2
    assert len(response.json()['updatedBoards']) == 2
    for code in ('record-contract', 'second-board'):
        runtime = (await client.get(f'/dashboard/programs/{code}')).json()
        assert runtime['analyticsData']['metricValues']['metric-total'] == 2
        assert runtime['analyticsPublishedVersion'] == 2
        editor = (await client.get(f'/dashboard/programs/{code}/analytics/editor')).json()
        assert editor['design']['widgets'][0]['title'] == '未发布的图表标题'
        assert editor['design']['metrics'][0]['sharedMetricVersion'] == 2
        assert editor['publishedDesign']['widgets'][0]['title'] != '未发布的图表标题'
    await db.refresh(form)
    assert form.config['viewConfigDraft'] == {'keep': 'pending'} and form.config['otherSetting'] == 'pending'
    latest = await db.scalar(select(FormVersion).where(FormVersion.form_id == 1, FormVersion.version == 2))
    for key in ('fields', 'layouts', 'actions', 'permissions', 'workflow_bindings'):
        assert latest.snapshot[key] == original[key]
    old = (await client.get(f'{BOARD}/versions/1')).json()['design']
    assert old['metrics'][0]['sharedMetricVersion'] == 1
    assert (await client.post(f'{BOARD}/preview', json={'design': old})).json()['analyticsData']['metricValues']['metric-total'] == 4
    stale = await client.put(f'{BOARD}/draft', json={'design': before['design'], 'expectedRevision': before['revision']})
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_impact_token_detects_new_references_and_stale_metric_edits(environment):
    db, _, form, user, client = environment
    user['is_admin'] = True
    item = await library(client)
    values = definition(expression='avg(qty)')
    body = {'definition': values, 'expectedRevision': item['revision']}
    checked = (await client.post(f'{LIB}/{item["id"]}/impact', json=body)).json()
    form.config = {'analyticsDesignDraft': bound_design(item)}
    await db.commit()
    assert (await client.post(f'{LIB}/{item["id"]}/publish', json={**body, 'impactToken': checked['impactToken']})).status_code == 409
    saved = await client.put(f'{LIB}/{item["id"]}/draft', json=body)
    assert saved.status_code == 200
    assert (await client.put(f'{LIB}/{item["id"]}/draft', json=body)).status_code == 409
    assert await db.scalar(select(func.count()).select_from(AnalyticsSharedMetricVersion)) == 1


@pytest.mark.asyncio
async def test_incompatible_metric_is_blocked_for_every_board_before_any_write(environment):
    db, _, form, user, client = environment
    await seed(db, 'A')
    user['is_admin'] = True
    item = await library(client)
    await board(db, form, user, bound_design(item))
    config = copy.deepcopy(form.config)
    values = definition(expression='sum(title)')
    body = {'definition': values, 'expectedRevision': item['revision']}
    checked = (await client.post(f'{LIB}/{item["id"]}/impact', json=body)).json()
    assert checked['errors']
    response = await client.post(f'{LIB}/{item["id"]}/publish', json={**body, 'impactToken': checked['impactToken']})
    assert response.status_code == 422
    await db.refresh(form)
    assert form.config == config
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 1
    assert await db.scalar(select(func.count()).select_from(AnalyticsSharedMetricVersion)) == 1


@pytest.mark.asyncio
async def test_database_failure_rolls_back_library_and_all_dashboard_versions(environment, monkeypatch):
    from app.services import analytics_metric_library as service
    db, _, form, user, client = environment
    user['is_admin'] = True
    item = await library(client)
    await board(db, form, user, bound_design(item))
    body = service.SharedMetricPublish(definition=definition(expression='avg(qty)'), expectedRevision=item['revision'],
        impactToken=(await client.post(f'{LIB}/{item["id"]}/impact', json={'definition': definition(expression='avg(qty)'), 'expectedRevision': item['revision']})).json()['impactToken'])
    async def fail(*args, **kwargs):
        raise RuntimeError('simulated audit storage failure')
    monkeypatch.setattr(service, 'change_audit', fail)
    with pytest.raises(RuntimeError, match='simulated'):
        await service.publish_metric(db, user, item['id'], body)
    current = (await client.get(f'{LIB}/{item["id"]}')).json()
    assert current['publishedVersion'] == 1
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 1
    assert await db.scalar(select(func.count()).select_from(AnalyticsSharedMetricVersion)) == 1


@pytest.mark.asyncio
async def test_draft_only_references_update_without_publishing_board_and_legacy_boards_get_baseline(environment):
    db, _, form, user, client = environment
    user['is_admin'] = True
    item = await library(client)
    design = bound_design(item)
    form.config = {'analyticsDesignDraft': design}
    await db.commit()
    response = await publish(client, item, definition(expression='avg(qty)'))
    assert response.status_code == 200, response.text
    assert response.json()['updatedBoards'] == []
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 0
    await db.refresh(form)
    assert 'analyticsDesign' not in form.config
    assert form.config['analyticsDesignDraft']['metrics'][0]['sharedMetricVersion'] == 2
    item = response.json()
    form.config = {'analyticsDesign': bound_design(item)}
    await db.commit()
    response = await publish(client, item, definition(expression='max(qty)'))
    assert response.status_code == 200, response.text
    assert response.json()['updatedBoards'] == [{'programId': 'record-contract', 'version': 2}]
    baseline = await db.scalar(select(FormVersion).where(FormVersion.form_id == 1, FormVersion.version == 1))
    assert baseline.snapshot['form']['config']['analyticsDesign']['metrics'][0]['sharedMetricVersion'] == 2


@pytest.mark.asyncio
async def test_shared_metric_still_applies_viewer_source_field_permissions(environment):
    from app.models.relational import FormPermission
    db, _, form, user, client = environment
    await seed(db, 'A')
    user['is_admin'] = True
    item = await library(client)
    await board(db, form, user, bound_design(item))
    user['is_admin'] = False
    response = await client.get('/dashboard/programs/record-contract')
    assert response.json()['analyticsData']['metricValues']['metric-total'] == 2
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, field_name='qty', action='view', effect='deny'))
    await db.commit()
    response = await client.get('/dashboard/programs/record-contract')
    data = response.json()['analyticsData']
    assert data['metricValues']['metric-total'] is None
    assert data['errors']
    assert all('qty' not in row for row in data['widgets']['total']['rows'])
    assert (await client.get(LIB)).status_code == 403


@pytest.mark.asyncio
async def test_full_form_publish_resolves_shared_definition_and_blocks_stale_bindings(environment, monkeypatch):
    from unittest.mock import AsyncMock
    db, _, form, user, client = environment
    user['is_admin'] = True
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    item = await library(client)
    design = bound_design(item)
    design['metrics'][0]['expression'] = 'count(*)'
    form.config = {'analyticsDesignDraft': design}
    await db.commit()
    response = await client.post('/forms/1/publish')
    assert response.status_code == 200, response.text
    await db.refresh(form)
    assert form.config['analyticsDesign']['metrics'][0]['expression'] == 'sum(qty)'
    changed = await publish(client, item, definition(expression='sum(qty) * 2'))
    assert changed.status_code == 200, changed.text
    state = (await client.get(f'{BOARD}/editor')).json()
    response = await client.put(f'{BOARD}/draft', json={'design': design, 'expectedRevision': state['revision']})
    assert response.status_code == 422, response.text
    assert '最新版本' in response.text
    await db.refresh(form)
    form.config = {**form.config, 'analyticsDesignDraft': design}
    await db.commit()
    response = await client.post('/forms/1/publish')
    assert response.status_code == 409, response.text
    assert '最新版本' in response.text


@pytest.mark.asyncio
async def test_concurrent_board_save_and_shared_publish_do_not_overwrite_each_other(environment):
    import asyncio
    from fastapi import HTTPException
    from app.services import analytics_editor as editor, analytics_metric_library as shared
    db, factory, form, user, client = environment
    if db.bind.dialect.name != 'postgresql':
        pytest.skip('Concurrent transaction locks are verified with disposable PostgreSQL')
    user['is_admin'] = True
    item = await library(client)
    design = bound_design(item)
    await board(db, form, user, design)
    state = (await client.get(f'{BOARD}/editor')).json()
    changed = definition(expression='sum(qty) * 2')
    body = {'definition': changed, 'expectedRevision': item['revision']}
    checked = (await client.post(f'{LIB}/{item["id"]}/impact', json=body)).json()
    await db.rollback()  # Release the fixture's read transaction before racing separate sessions.
    updated_board = copy.deepcopy(design)
    updated_board['widgets'][0]['title'] = '并发编辑的图表'
    async def write(kind):
        async with factory() as session:
            try:
                if kind == 'board':
                    await editor.write_design(session, user, 'record-contract', editor.AnalyticsWriteRequest(
                        design=updated_board, expectedRevision=state['revision']))
                else:
                    await shared.publish_metric(session, user, item['id'], shared.SharedMetricPublish(
                        **body, impactToken=checked['impactToken']))
                return 200
            except HTTPException as exc:
                await session.rollback()
                return exc.status_code
    results = await asyncio.wait_for(asyncio.gather(write('board'), write('metric')), 30)
    assert sorted(results) == [200, 409], results
