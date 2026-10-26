"""Acceptance matrix: real JWTs and routers against disposable databases.

No authentication/permission/workflow implementation is mocked. Only the DB
session factory is redirected, including legacy routers and audit writes.
"""
from contextlib import AsyncExitStack
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import applications, auth, forms, workflow, notifications, admin
from app.core import db as core_db
from app.core.security import create_access_token, hash_password
from app.models.relational import (
    Base, Tenant, User, Role, UserRole, Application, ApplicationRole,
    ApplicationForm, ApplicationMenuNode, Form, FormField, FormPermission,
    OrgUnit, UserOrgMembership, WorkflowInstance, AuditLog,
)
from app.services.form_approval_config import save_approval_settings


@pytest_asyncio.fixture(params=['dynamic', 'physical_table'])
async def matrix(request, tmp_path, monkeypatch):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "matrix.db"}')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(core_db, 'AsyncSessionLocal', factory)
    accounts = {'a': (1, 1), 'b': (2, 1), 'c': (3, 1), 'd': (4, 1),
                'e': (5, 1), 'f': (6, 1), 'g': (7, 1), 'admin': (8, 1), 'other': (9, 2)}
    password = 'Isolated-Test-2026!'
    hashed = hash_password(password)
    async with factory() as db:
        db.add_all([Tenant(id=1, name='Acceptance', slug='acceptance'),
                    Tenant(id=2, name='Other tenant', slug='other-acceptance')])
        await db.flush()
        for rid, name in [(1, 'applicant'), (2, 'approver'), (3, 'observer')]:
            db.add(Role(id=rid, tenant_id=1, name=name, label=name))
        db.add(Role(id=4, tenant_id=2, name='applicant', label='Other applicant'))
        for name, (uid, tenant) in accounts.items():
            db.add(User(id=uid, tenant_id=tenant, username=name, hashed_password=hashed,
                        is_active=True, is_admin=name == 'admin'))
        db.add_all([OrgUnit(id=1, tenant_id=1, code='dept-a', name='Department A'),
                    OrgUnit(id=2, tenant_id=1, code='dept-b', name='Department B')])
        await db.flush()
        for uid in [1, 2, 3, 4, 5, 6, 9]:
            db.add(UserRole(tenant_id=2 if uid == 9 else 1, user_id=uid,
                            role_id=4 if uid == 9 else 1 if uid <= 3 else 2 if uid <= 5 else 3))
        for uid in range(1, 7):
            db.add(UserOrgMembership(tenant_id=1, user_id=uid, org_unit_id=2 if uid == 3 else 1))
        db.add(Application(id=1, tenant_id=1, name='Acceptance app', code='acceptance', status='published'))
        form = Form(id=1, tenant_id=1, name='Request', code='acceptance-request', status='published',
                    storage_mode=request.param, table_name='acceptance_records' if request.param == 'physical_table' else None)
        db.add(form)
        db.add(Form(id=2, tenant_id=1, name='Restricted', code='acceptance-restricted', status='published'))
        await db.flush()
        for rid in [1, 2, 3]:
            db.add(ApplicationRole(tenant_id=1, application_id=1, role_id=rid))
            db.add(FormPermission(tenant_id=1, form_id=1, role_id=rid, action='view', effect='allow'))
            for action in ['create', 'edit', 'delete', 'export', 'approve']:
                allowed = (rid == 1 and action in ['create', 'edit']) or (rid == 2 and action == 'approve')
                db.add(FormPermission(tenant_id=1, form_id=1, role_id=rid, action=action, effect='allow' if allowed else 'deny'))
        db.add(FormPermission(tenant_id=1, form_id=2, role_id=1, action='view', effect='deny'))
        db.add(ApplicationForm(tenant_id=1, application_id=1, form_id=1, enabled=True))
        db.add(ApplicationForm(tenant_id=1, application_id=1, form_id=2, enabled=True))
        db.add_all([
            ApplicationMenuNode(id=1, tenant_id=1, application_id=1, title='Requests', form_id=1, route_path='/dynamic/acceptance-request'),
            ApplicationMenuNode(id=2, tenant_id=1, application_id=1, title='Restricted', form_id=2, route_path='/dynamic/acceptance-restricted',
                                config={'permission_mode': 'custom', 'role_ids': [2]}),
        ])
        for name, kind in [('title', 'string'), ('org_unit_id', 'integer'), ('secret', 'string')]:
            db.add(FormField(tenant_id=1, form_id=1, field_name=name, label=name, field_type=kind, required=name == 'title'))
        await db.commit()
        await save_approval_settings(db, 1, 1, 8, {'enabled': True, 'stages': [
            {'name': 'First review', 'approver_ids': [4], 'approval_mode': 'single'},
            {'name': 'Final review', 'approver_ids': [5], 'approval_mode': 'single'},
        ]})
        await db.commit()
    app = FastAPI()
    for prefix, router in [('/auth', auth.router), ('/applications', applications.router),
                           ('/forms', forms.router), ('/workflow', workflow.router), ('/notifications', notifications.router),
                           ('/admin', admin.router)]:
        app.include_router(router, prefix=prefix)
    try:
        async with AsyncExitStack() as stack:
            clients = {}
            for name, (uid, tenant) in accounts.items():
                token = create_access_token(name, {'uid': uid, 'tenant_id': tenant, 'is_admin': name == 'admin'})
                clients[name] = await stack.enter_async_context(AsyncClient(transport=ASGITransport(app=app),
                    base_url='http://test', headers={'Authorization': f'Bearer {token}'}))
            anonymous = await stack.enter_async_context(AsyncClient(transport=ASGITransport(app=app), base_url='http://test'))
            yield SimpleNamespace(clients=clients, factory=factory, anonymous=anonymous, password=password)
    finally:
        await engine.dispose()


async def create_request(matrix, name='a'):
    response = await matrix.clients[name].post('/forms/1/records', json={'data': {
        'title': f'Request from {name}', 'org_unit_id': 2 if name == 'c' else 1, 'secret': f'private-{name}'}})
    assert response.status_code == 200, response.text
    return response.json()['data']


@pytest.mark.asyncio
async def test_pinned_node_field_visibility_covers_details_lists_export_and_workflow(matrix):
    admin = matrix.clients['admin']
    settings_response = await admin.get('/forms/1/workflow-bindings')
    assert settings_response.status_code == 200, settings_response.text
    wid = settings_response.json()['data'][0]['workflow_id']
    definition = (await admin.get(f'/workflow/definitions/{wid}')).json()
    definition['config']['steps'][1]['field_permissions'] = {'secret': {'visible': False, 'editable': False}}
    changed = await admin.put(f'/workflow/definitions/{wid}', json={
        'name': definition['name'], 'status': 'published', 'config': definition['config']})
    assert changed.status_code == 200, changed.text
    row_a, row_b = await create_request(matrix), await create_request(matrix, 'b')
    path = f'/forms/1/records/{row_a["id"]}'
    submitted = await matrix.clients['a'].post(path + '/submit', json={'expected_status': 'draft'})
    assert submitted.status_code == 200, submitted.text
    iid = submitted.json()['data']['_approval']['workflow_id']
    for who in ['a', 'd', 'e', 'f']:
        response = await matrix.clients[who].get(path)
        assert response.status_code == 200, response.text
        assert 'secret' not in response.json()['data']['data']
        assert 'secret' not in response.json()['data']['field_states']
    assert (await admin.get(path)).json()['data']['data']['secret'] == 'private-a'
    listed = (await matrix.clients['d'].get('/forms/1/records')).json()['data']
    assert 'secret' not in next(row for row in listed if row['id'] == row_a['id'])['data']
    assert next(row for row in listed if row['id'] == row_b['id'])['data']['secret'] == 'private-b'
    instance = (await matrix.clients['d'].get(f'/workflow/instances/{iid}')).json()
    assert 'secret' not in instance['form_data']
    items = (await matrix.clients['d'].get('/workflow/business-items')).json()['data']['items']
    item = next(item for item in items if (item.get('workflow') or {}).get('id') == iid)
    assert 'secret' not in {field['field_name'] for field in item['fields']}
    permissions = (await admin.get('/forms/1/permissions')).json()['data']
    export_permission = next(p for p in permissions if p['role_id'] == 3 and p['action'] == 'export')
    assert (await admin.put(f'/forms/1/permissions/{export_permission["id"]}', json={'effect': 'allow'})).status_code == 200
    exported = await matrix.clients['f'].get('/forms/1/records-export')
    assert exported.status_code == 200, exported.text
    assert 'private-a' not in exported.text and 'private-b' in exported.text
    # Editing the definition cannot remove restrictions from an existing node.
    definition['config']['steps'][1]['field_permissions'] = {}
    assert (await admin.put(f'/workflow/definitions/{wid}', json={
        'name': definition['name'], 'config': definition['config']})).status_code == 200
    assert 'secret' not in (await matrix.clients['d'].get(path)).json()['data']['data']
    assert (await matrix.clients['d'].post(f'/workflow/instances/{iid}/approve', json={})).status_code == 200
    assert (await matrix.clients['e'].get(path)).json()['data']['data']['secret'] == 'private-a'


@pytest.mark.asyncio
async def test_no_application_grants_returns_normal_empty_list(matrix):
    response = await matrix.clients['g'].get('/applications')
    assert response.status_code == 200, response.text
    assert response.json()['data'] == []


@pytest.mark.asyncio
async def test_application_menu_and_form_access_matrix(matrix):
    for who in ['a', 'b', 'c', 'd', 'e', 'f', 'admin']:
        client = matrix.clients[who]
        assert (await client.get('/applications')).status_code == 200
        assert (await client.get('/applications/1')).status_code == 200
        menu = await client.get('/applications/1/menus')
        assert menu.status_code == 200, menu.text
        ids = {row['id'] for row in menu.json()['data']}
        assert 1 in ids
        assert (2 in ids) == (who in ['d', 'e', 'admin'])
    for endpoint in ['/applications/1', '/applications/1/menus', '/forms/1', '/forms/1/records']:
        response = await matrix.clients['g'].get(endpoint)
        assert response.status_code in [403, 404], (endpoint, response.text)
        response = await matrix.clients['other'].get(endpoint)
        assert response.status_code in [403, 404], (endpoint, response.text)
    assert (await matrix.clients['a'].get('/forms/2')).status_code == 403


@pytest.mark.asyncio
async def test_application_detail_does_not_disclose_denied_menu(matrix):
    response = await matrix.clients['a'].get('/applications/1')
    assert response.status_code == 200, response.text
    data = response.json()['data']
    # Application detail has a second menu path, which must honor runtime rules.
    assert all(row.get('title') != 'Restricted' for row in data.get('menus', [])), data


@pytest.mark.asyncio
async def test_inherited_menu_honors_explicit_form_view_denial(matrix):
    async with matrix.factory() as db:
        node = await db.get(ApplicationMenuNode, 2)
        node.config = {}
        await db.commit()
    response = await matrix.clients['a'].get('/applications/1/menus')
    assert response.status_code == 200, response.text
    assert 2 not in {node['id'] for node in response.json()['data']}, response.text


@pytest.mark.asyncio
async def test_observer_cannot_write_export_or_approve(matrix):
    row = await create_request(matrix)
    path = f'/forms/1/records/{row["id"]}'
    client = matrix.clients['f']
    assert (await client.get(path)).status_code == 200
    for method, endpoint, payload in [('POST', '/forms/1/records', {'data': {'title': 'Forged'}}),
                                      ('PUT', path, {'data': {'title': 'Forged'}}),
                                      ('DELETE', path, None), ('GET', '/forms/1/records-export', None)]:
        response = await client.request(method, endpoint, json=payload)
        assert response.status_code == 403, (endpoint, response.text)
    submitted = await matrix.clients['a'].post(path + '/submit', json={'expected_status': 'draft'})
    assert submitted.status_code == 200, submitted.text
    wid = submitted.json()['data']['_approval']['workflow_id']
    response = await client.post(f'/workflow/instances/{wid}/approve', json={'comment': 'Forged', 'user_id': 4})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_three_applicants_two_stage_approval_and_notification_isolation(matrix):
    applications_created = []
    for name in ['a', 'b', 'c']:
        row = await create_request(matrix, name)
        path = f'/forms/1/records/{row["id"]}'
        submitted = await matrix.clients[name].post(path + '/submit', json={'expected_status': 'draft'})
        assert submitted.status_code == 200, submitted.text
        applications_created.append((name, path, submitted.json()['data']['_approval']['workflow_id']))
    assert len({wid for _, _, wid in applications_created}) == 3
    for who, expected in [('d', 3), ('e', 0), ('f', 0), ('g', 0), ('other', 0)]:
        notes = await matrix.clients[who].get('/notifications')
        assert notes.status_code == 200, notes.text
        assert len(notes.json()['data']) == expected, (who, notes.text)
    for name, path, wid in applications_created:
        endpoint = f'/workflow/instances/{wid}/approve'
        assert (await matrix.clients['e'].post(endpoint, json={'comment': 'Premature'})).status_code == 403
        assert (await matrix.clients[name].post(endpoint, json={'comment': 'Self approve', 'user_id': 4})).status_code == 403
        first = await matrix.clients['d'].post(endpoint, json={'comment': 'First accepted'})
        assert first.status_code == 200, first.text
        assert (await matrix.clients[name].get(path)).json()['data']['status'] == 'pending'
        final = await matrix.clients['e'].post(endpoint, json={'comment': 'Final accepted'})
        assert final.status_code == 200, final.text
        assert (await matrix.clients[name].get(path)).json()['data']['status'] == 'approved'
        assert (await matrix.clients['e'].post(endpoint, json={'comment': 'Duplicate'})).status_code == 409
        notes = (await matrix.clients[name].get('/notifications')).json()['data']
        assert len(notes) == 1 and notes[0]['resource_id'] == wid
    async with matrix.factory() as db:
        instances = (await db.scalars(select(WorkflowInstance))).all()
        assert len(instances) == 3 and {i.initiator_id for i in instances} == {1, 2, 3}
        assert (await db.scalars(select(AuditLog))).all(), 'Audit must persist in the isolated DB'


@pytest.mark.asyncio
async def test_department_scope_matches_list_and_detail(matrix):
    rows = {name: await create_request(matrix, name) for name in ['a', 'b', 'c']}
    async with matrix.factory() as db:
        form = await db.get(Form, 1)
        form.config = {**(form.config or {}), 'permissionDesign': {'roles': {
            'applicant': {'data': {'scope': 'org'}}}}}
        await db.commit()
    for who, visible in [('a', {'a', 'b'}), ('b', {'a', 'b'}), ('c', {'c'})]:
        response = await matrix.clients[who].get('/forms/1/records')
        assert response.status_code == 200, response.text
        assert {row['id'] for row in response.json()['data']} == {rows[name]['id'] for name in visible}, response.text
        for name, row in rows.items():
            response = await matrix.clients[who].get(f'/forms/1/records/{row["id"]}')
            assert response.status_code == (200 if name in visible else 403), (who, name, response.text)


@pytest.mark.asyncio
async def test_revocation_and_application_disable_with_existing_tokens(matrix):
    assert (await matrix.clients['a'].get('/applications/1')).status_code == 200
    async with matrix.factory() as db:
        await db.execute(delete(UserRole).where(UserRole.user_id == 1))
        await db.commit()
    assert (await matrix.clients['a'].get('/applications/1')).status_code == 403
    assert (await matrix.clients['a'].get('/forms/1/records')).status_code == 403
    async with matrix.factory() as db:
        app = await db.get(Application, 1)
        app.status = 'disabled'
        await db.commit()
    assert (await matrix.clients['b'].get('/applications/1')).status_code == 404
    assert (await matrix.clients['b'].get('/applications/1/menus')).status_code == 404


@pytest.mark.asyncio
async def test_real_login_cookie_and_logout_session_revocation(matrix):
    client = matrix.anonymous
    assert (await client.get('/forms/1/records')).status_code == 401
    response = await client.post('/auth/login', json={'username': 'a', 'password': matrix.password, 'tenant_id': 1})
    assert response.status_code == 200, response.text
    assert 'access_token' in client.cookies
    assert (await client.get('/forms/1/records')).status_code == 200
    token = response.json()['token']
    assert (await client.post('/auth/logout')).status_code == 200
    assert (await client.get('/forms/1/records')).status_code == 401
    assert (await client.get('/forms/1/records', headers={'Authorization': f'Bearer {token}'})).status_code == 401


@pytest.mark.asyncio
async def test_disabled_account_loses_existing_session_access(matrix):
    client = matrix.anonymous
    login = await client.post('/auth/login', json={'username': 'a', 'password': matrix.password, 'tenant_id': 1})
    assert login.status_code == 200, login.text
    assert (await client.get('/forms/1/records')).status_code == 200
    disabled = await matrix.clients['admin'].put('/admin/users/1', json={'is_active': False})
    assert disabled.status_code == 200, disabled.text
    # Confirm the account is actually disabled, independently of old sessions.
    denied_login = await matrix.clients['g'].post('/auth/login', json={'username': 'a', 'password': matrix.password, 'tenant_id': 1})
    assert denied_login.status_code == 401, denied_login.text
    response = await client.get('/forms/1/records')
    assert response.status_code in [401, 403], response.text
    assert (await matrix.clients['a'].get('/forms/1/records')).status_code == 401, 'Legacy bearer token must also be invalidated'


@pytest.mark.asyncio
async def test_live_admin_flag_and_session_identity_are_enforced(matrix):
    client = matrix.anonymous
    login = await client.post('/auth/login', json={'username': 'admin', 'password': matrix.password, 'tenant_id': 1})
    assert login.status_code == 200, login.text
    async with matrix.factory() as db:
        account = await db.get(User, 8)
        account.is_admin = False
        await db.commit()
    assert (await client.get('/admin/users')).status_code == 403
    assert (await matrix.clients['admin'].get('/admin/users')).status_code == 403
    from app.core.security import decode_access_token
    claims = decode_access_token(login.json()['token'])
    mismatched = create_access_token('a', {'uid': 1, 'tenant_id': 1, 'is_admin': False, 'sid': claims['sid']})
    response = await matrix.clients['a'].get('/forms/1/records', headers={'Authorization': f'Bearer {mismatched}'})
    assert response.status_code == 401


async def pending_request(matrix):
    row = await create_request(matrix)
    path = f'/forms/1/records/{row["id"]}'
    response = await matrix.clients['a'].post(path + '/submit', json={'expected_status': 'draft'})
    assert response.status_code == 200, response.text
    return path, response.json()['data']['_approval']['workflow_id']


@pytest.mark.asyncio
async def test_no_form_access_cannot_read_legacy_workflow_detail(matrix):
    _, wid = await pending_request(matrix)
    response = await matrix.clients['g'].get(f'/workflow/instances/{wid}')
    assert response.status_code in [403, 404], 'Legacy workflow detail exposes a protected form snapshot'


@pytest.mark.asyncio
async def test_no_form_access_cannot_read_legacy_workflow_list(matrix):
    _, wid = await pending_request(matrix)
    instance = await matrix.clients['admin'].get(f'/workflow/instances/{wid}')
    assert instance.status_code == 200, instance.text
    response = await matrix.clients['g'].get('/workflow/instances', params={'workflow_id': instance.json()['workflow_id']})
    assert response.status_code in [403, 404] or response.status_code == 200 and response.json()['data'] == [], \
        'Legacy workflow list exposes other users protected applications'


@pytest.mark.asyncio
async def test_workflow_snapshot_obeys_field_view_denial(matrix):
    async with matrix.factory() as db:
        db.add(FormPermission(tenant_id=1, form_id=1, role_id=3, field_name='secret', action='view', effect='deny'))
        await db.commit()
    path, wid = await pending_request(matrix)
    source = await matrix.clients['f'].get(path)
    assert source.status_code == 200 and 'secret' not in source.json()['data']['data']
    response = await matrix.clients['f'].get(f'/workflow/instances/{wid}')
    assert response.status_code in [403, 404] or response.status_code == 200 and 'secret' not in (response.json().get('form_data') or {}), \
        'Workflow snapshot bypasses source-record field protection'
