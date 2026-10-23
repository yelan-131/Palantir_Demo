"""Analytics history exposes only published board designs within the tenant."""
import copy
from datetime import datetime

import pytest
from sqlalchemy import func, select

from app.models.relational import AuditLog, Form, FormVersion, User
from tests.test_analytics_editor import BASE, published_board
from tests.test_analytics_sources import source_design
from tests.test_record_service import environment


@pytest.mark.asyncio
async def test_history_is_read_only_paginated_and_contains_only_analytics(environment):
    db, _, form, user, client = environment
    original_version = await published_board(db, form, user)
    original_snapshot = copy.deepcopy(original_version.snapshot)
    publisher = await db.get(User, 1)
    publisher.display_name = '看板管理员'
    await db.commit()
    initial = (await client.get(f'{BASE}/editor')).json()
    assert initial['publishedAt'] == original_version.published_at.isoformat()
    updated = source_design()
    updated['widgets'][0]['title'] = '新的发布标题'
    response = await client.post(f'{BASE}/publish', json={
        'design': updated, 'expectedRevision': initial['revision'], 'note': '  调整产量指标标题  ',
    })
    assert response.status_code == 200, response.text
    published = response.json()
    before_config = copy.deepcopy(form.config)
    before_audits = await db.scalar(select(func.count()).select_from(AuditLog))

    listing = (await client.get(f'{BASE}/versions', params={'limit': 1})).json()
    assert listing['total'] == 2 and len(listing['items']) == 1
    current = listing['items'][0]
    assert current == {
        'version': 2, 'publishedAt': published['publishedAt'], 'publishedBy': 1,
        'publishedByName': '看板管理员', 'scope': 'analytics', 'note': '调整产量指标标题',
        'summary': {'widgets': 1, 'datasets': 1, 'metrics': 1}, 'current': True,
    }
    previous = (await client.get(f'{BASE}/versions', params={'limit': 1, 'offset': 1})).json()
    assert previous['total'] == 2 and previous['items'][0]['version'] == 1
    assert previous['items'][0]['scope'] == 'form' and previous['items'][0]['current'] is False
    assert 'design' not in previous['items'][0]
    detail = (await client.get(f'{BASE}/versions/1')).json()
    assert detail == {**previous['items'][0], 'design': source_design()}
    assert (await client.get(f'{BASE}/versions/2')).json() == {**current, 'design': updated}
    assert (await client.get(f'{BASE}/versions', params={'offset': 50})).json() == {'items': [], 'total': 2}
    assert (await client.get(f'{BASE}/versions/900')).status_code == 404
    await db.refresh(form)
    assert form.config == before_config
    assert original_version.snapshot == original_snapshot
    assert await db.scalar(select(func.count()).select_from(AuditLog)) == before_audits
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 2


@pytest.mark.asyncio
async def test_history_excludes_drafts_invalid_designs_and_foreign_rows(environment):
    db, _, form, user, client = environment
    await published_board(db, form, user)
    db.add(Form(id=8, tenant_id=2, code='record-contract', name='Foreign board'))
    db.add(User(id=8, tenant_id=2, username='foreign-user', display_name='Foreign publisher', hashed_password='test'))
    await db.flush()
    for number, design, status in [(2, None, 'published'), (3, [], 'published'), (4, 'invalid', 'published'),
                                   (5, source_design(), 'draft'), (6, source_design(), 'active')]:
        db.add(FormVersion(tenant_id=1, form_id=form.id, version=number, status=status,
                          snapshot={'form': {'config': {'analyticsDesign': design}}},
                          published_by=8, published_at=datetime.now()))
    # Also check tenant filters on the version itself, even if old data has an
    # inconsistent tenant/form association. Neither query may disclose it.
    db.add(FormVersion(tenant_id=2, form_id=form.id, version=7, status='published',
                       snapshot={'form': {'config': {'analyticsDesign': source_design()}}}))
    db.add(FormVersion(tenant_id=2, form_id=8, version=1, status='published',
                       snapshot={'form': {'config': {'analyticsDesign': source_design()}}}))
    await db.commit()
    response = await client.get(f'{BASE}/versions')
    assert response.status_code == 200, response.text
    listing = response.json()
    assert listing['total'] == 2
    assert [item['version'] for item in listing['items']] == [6, 1]
    assert listing['items'][0]['current'] is True
    assert listing['items'][0]['publishedByName'] is None
    assert 'Foreign publisher' not in response.text
    for number in (2, 3, 4, 5, 7):
        assert (await client.get(f'{BASE}/versions/{number}')).status_code == 404


@pytest.mark.asyncio
async def test_unversioned_board_history_is_empty_and_query_and_note_are_bounded(environment):
    db, _, form, user, client = environment
    user['is_admin'] = True
    form.config = {'analyticsDesign': source_design(), 'analyticsDesignMeta': {'publishedAt': '2026-10-23T08:00:00'}}
    await db.commit()
    assert (await client.get(f'{BASE}/versions')).json() == {'items': [], 'total': 0}
    assert (await client.get(f'{BASE}/versions/1')).status_code == 404
    runtime = (await client.get('/dashboard/programs/record-contract')).json()
    assert runtime['analyticsPublishedVersion'] is None
    assert runtime['analyticsPublishedAt'] == '2026-10-23T08:00:00'
    for params in ({'limit': 0}, {'limit': 101}, {'offset': -1}):
        assert (await client.get(f'{BASE}/versions', params=params)).status_code == 422
    initial = (await client.get(f'{BASE}/editor')).json()
    response = await client.post(f'{BASE}/publish', json={
        'design': source_design(), 'expectedRevision': initial['revision'], 'note': '长' * 501,
    })
    assert response.status_code == 422
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 0
    assert (await client.get(f'{BASE}/editor')).json() == initial


@pytest.mark.asyncio
async def test_historical_design_restore_is_a_new_analytics_only_publication(environment):
    db, _, form, user, client = environment
    original_version = await published_board(db, form, user)
    original_snapshot = copy.deepcopy(original_version.snapshot)
    initial = (await client.get(f'{BASE}/editor')).json()
    updated = source_design()
    updated['widgets'][0]['title'] = '第二版'
    response = await client.post(f'{BASE}/publish', json={'design': updated, 'expectedRevision': initial['revision']})
    assert response.status_code == 200, response.text
    second = response.json()
    runtime = (await client.get('/dashboard/programs/record-contract')).json()
    assert runtime['analyticsPublishedVersion'] == 2
    assert runtime['analyticsPublishedAt'] == second['publishedAt']
    form.config = {**form.config, 'viewConfigDraft': {'keep': 'unpublished'}, 'otherConfig': 'unpublished'}
    await db.commit()
    historical = (await client.get(f'{BASE}/versions/1')).json()
    # Loading and previewing history cannot move the published version.
    preview = await client.post(f'{BASE}/preview', json={'design': historical['design']})
    assert preview.status_code == 200, preview.text
    assert (await client.get(f'{BASE}/editor')).json()['publishedVersion'] == 2
    response = await client.post(f'{BASE}/publish', json={
        'design': historical['design'], 'expectedRevision': second['revision'], 'note': '恢复至版本 1 的配置',
    })
    assert response.status_code == 200, response.text
    restored = response.json()
    assert restored['publishedVersion'] == 3 and restored['publishedDesign'] == source_design()
    runtime = (await client.get('/dashboard/programs/record-contract')).json()
    assert runtime['analyticsPublishedVersion'] == 3
    assert runtime['analyticsPublishedAt'] == restored['publishedAt']
    latest = await db.scalar(select(FormVersion).where(FormVersion.form_id == form.id, FormVersion.version == 3))
    for key in ('fields', 'permissions', 'workflow_bindings', 'layouts', 'actions'):
        assert latest.snapshot[key] == original_snapshot[key]
    assert latest.snapshot['form']['config']['otherConfig'] == 'published'
    assert 'viewConfigDraft' not in latest.snapshot['form']['config']
    await db.refresh(form)
    assert form.config['viewConfigDraft'] == {'keep': 'unpublished'}
    assert form.config['otherConfig'] == 'unpublished'
    assert (await client.get(f'{BASE}/versions/1')).json()['design'] == source_design()
    assert (await client.get(f'{BASE}/versions/2')).json()['design'] == updated
    assert (await client.get(f'{BASE}/versions')).json()['total'] == 3


@pytest.mark.asyncio
async def test_runtime_hides_version_metadata_when_statistics_are_denied(environment):
    db, _, form, user, client = environment
    await published_board(db, form, user)
    form.config = {**form.config, 'permissionDesign': {'roles': {
        'reader': {'data': {'scope': 'all', 'ownership': {'statistics': False}}},
    }}}
    await db.commit()
    user['is_admin'] = False
    response = await client.get('/dashboard/programs/record-contract')
    assert response.status_code == 200, response.text
    runtime = response.json()
    assert runtime['analyticsDesign'] is None
    assert runtime['analyticsPublishedVersion'] is None
    assert runtime['analyticsPublishedAt'] is None
