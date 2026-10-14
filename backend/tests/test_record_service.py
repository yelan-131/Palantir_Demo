"""Cross-entry-point contracts using isolated databases for both storage adapters."""
import json
import os

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import forms, dashboard, workflow
from app.api.deps import get_db, get_current_user
from app.models.relational import Base, Tenant, User, Role, UserRole, Form, FormField, FormPermission, RolePermission, AuditLog, FormVersion
from app.services import records
from app.services.ai.form_record_tools import query_form_records, get_form_record
from app.services.ai.dynamic_record_drafts import create_dynamic_record_draft_from_agent


@pytest_asyncio.fixture(params=['dynamic', 'physical_table'])
async def environment(request, tmp_path):
    external_url = os.getenv('RECORD_TEST_DATABASE_URL')
    if external_url:
        assert make_url(external_url).database.startswith('record_service_verify_'), 'Use a disposable verification database only'
    engine = create_async_engine(external_url or f'sqlite+aiosqlite:///{tmp_path / "records.db"}')
    async with engine.begin() as connection:
        if external_url:
            await connection.execute(text('DROP TABLE IF EXISTS t1_business_contract'))
            await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        db.add_all([Tenant(id=1, name='One', slug='one'), Tenant(id=2, name='Two', slug='two'),
            Role(id=1, tenant_id=1, name='reader', label='Reader')])
        await db.flush()
        for uid in (1, 2):
            db.add(User(id=uid, tenant_id=1, username=f'user{uid}', hashed_password='test'))
        await db.flush()
        for uid in (1, 2):
            db.add(UserRole(tenant_id=1, user_id=uid, role_id=1))
        form = Form(id=1, tenant_id=1, code='record-contract', name='Contract', status='published',
            storage_mode=request.param, table_name='t1_business_contract' if request.param == 'physical_table' else None)
        db.add(form)
        await db.flush()
        for name, kind in [('title', 'string'), ('secret', 'string'), ('qty', 'integer'), ('status', 'string')]:
            db.add(FormField(tenant_id=1, form_id=1, field_name=name, label=name,
                field_type=kind, required=name == 'title', searchable=True, sortable=True))
        db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='*', effect='allow'))
        await db.commit()
        user = {'uid': 1, 'tenant_id': 1, 'is_admin': False}
        app = FastAPI()
        app.include_router(forms.router, prefix='/forms')
        app.include_router(dashboard.router, prefix='/dashboard')
        async def session():
            yield db
        async def principal():
            return user
        app.dependency_overrides[get_db] = session
        app.dependency_overrides[get_current_user] = principal
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            yield db, factory, form, user, client
    await engine.dispose()


async def seed(db, title, *, uid=1):
    return (await records.create_record(1, forms.DynamicRecordCreate(data={'title': title, 'secret': 'private', 'qty': 2}, status='draft'),
        db, {'uid': uid, 'tenant_id': 1, 'is_admin': True}))['data']


@pytest.mark.asyncio
async def test_ui_ai_dashboard_inbox_share_row_scope_and_field_mask(environment):
    db, _, form, user, client = environment
    own = await seed(db, 'Own')
    other = await seed(db, 'Other', uid=2)
    db.add(RolePermission(tenant_id=1, role_id=1, resource_type='form', resource_key='1', action='view', effect='allow', data_scope='self'))
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='view', field_name='secret', effect='deny'))
    # Role-level explicit field deny has precedence over the broad role grant.
    db.add(RolePermission(tenant_id=1, role_id=1, resource_type='form', resource_key='1', action='view', effect='allow',
        field_rules_json={'fields': {'secret': {'deny': True}}}, data_scope='self'))
    await db.commit()
    ui = await client.get('/forms/1/records?page_size=1')
    assert ui.status_code == 200, ui.text
    assert ui.json()['total'] == 1
    assert [row['id'] for row in ui.json()['data']] == [own['id']]
    ai = await query_form_records(db, user=user, payload={'form_id': 1})
    board_response = await client.get('/dashboard/programs/record-contract?limit=1')
    assert board_response.status_code == 200, board_response.text
    board = board_response.json()
    assert board['total'] == 1 and board['metrics'][0]['value'] == 1
    assert [row['recordId'] for row in board['rows']] == [own['id']]
    assert [row['id'] for row in ai['records']] == [own['id']]
    assert 'secret' not in ui.json()['data'][0]['data']
    assert 'secret' not in ai['records'][0]['data']
    assert 'secret' not in board['rows'][0]['_formData']
    inbox = await workflow._workflow_business_dataset(db, user)
    assert any(item.get('record', {}).get('id') == own['id'] for item in inbox['items'])
    assert not any(item.get('record', {}).get('id') == other['id'] for item in inbox['items'])
    assert 'private' not in json.dumps(inbox)
    assert (await client.get(f"/forms/1/records/{other['id']}")).status_code == 403
    with pytest.raises(HTTPException) as denied:
        await get_form_record(db, user=user, payload={'form_id': 1, 'record_id': other['id']})
    assert denied.value.status_code == 403
    user['tenant_id'] = 2
    assert (await client.get('/forms/1/records')).status_code == 404
    assert (await client.get('/dashboard/programs/record-contract')).json()['source'] == 'unsupported'
    with pytest.raises(HTTPException) as denied:
        await query_form_records(db, user=user, payload={'form_id': 1})
    assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_ai_draft_uses_shared_validation_permissions_and_atomic_audit(environment):
    db, _, form, user, client = environment
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='create', field_name='secret', effect='deny'))
    await db.commit()
    async def draft(data):
        return await create_dynamic_record_draft_from_agent(db, user=user,
            skill='forms.create_record_draft', payload={'form_code': 'record-contract', 'data': data})
    with pytest.raises(HTTPException) as denied:
        await draft({'title': 'Hidden write', 'secret': 'forbidden'})
    assert denied.value.status_code == 403
    await db.rollback()
    with pytest.raises(HTTPException) as invalid:
        await draft({'title': 'Wrong type', 'qty': 'not-an-integer'})
    assert invalid.value.status_code == 422
    await db.rollback()
    result = await draft({'title': 'AI record', 'qty': 3})
    assert result['status'] == 'draft'
    ui = (await client.get(f"/forms/1/records/{result['record_id']}")).json()['data']
    ai = (await get_form_record(db, user=user, payload={'form_id': 1, 'record_id': result['record_id']}))['record']
    assert ui['data'] == ai['data'] == result['data']
    audits = (await db.scalars(select(AuditLog).where(AuditLog.action == 'create'))).all()
    assert len(audits) == 1
    assert json.loads(audits[0].new_values)['source'] == 'ai_agent_confirmation'


@pytest.mark.asyncio
async def test_updates_deletes_and_failed_audit_are_transactional(environment, monkeypatch):
    db, factory, form, user, client = environment
    row = await seed(db, 'Original')
    response = await client.put(f"/forms/1/records/{row['id']}", json={'data': {'title': 'Updated'}})
    assert response.status_code == 200, response.text
    assert response.json()['data']['data']['title'] == 'Updated'
    response = await client.delete(f"/forms/1/records/{row['id']}")
    assert response.status_code == 200, response.text
    async with factory() as check:
        assert (await records.list_records(1, check, user))['total'] == 0
        assert {entry.action for entry in (await check.scalars(select(AuditLog))).all()} >= {'create', 'update', 'delete'}
    async def fail_audit(*args, **kwargs):
        raise RuntimeError('audit write failed')
    monkeypatch.setattr(records, 'change_audit', fail_audit)
    with pytest.raises(RuntimeError, match='audit write failed'):
        await seed(db, 'Must roll back')
    await db.rollback()
    async with factory() as check:
        assert (await records.list_records(1, check, user))['total'] == 0


@pytest.mark.asyncio
async def test_published_schema_and_conditional_denies_apply_before_counts(environment):
    db, _, form, user, client = environment
    own = await seed(db, 'Allowed')
    await seed(db, 'Blocked')
    fields = await records.runtime_fields(db, form)
    snapshot_fields = [{'field_name': field.field_name, 'label': field.label, 'field_type': field.field_type,
        'required': field.required, 'searchable': field.searchable, 'sortable': field.sortable} for field in fields]
    db.add(FormVersion(tenant_id=1, form_id=1, version=1, status='published', snapshot={'fields': snapshot_fields}))
    db.add(FormField(tenant_id=1, form_id=1, field_name='draft_only', label='Draft', field_type='string'))
    db.add(RolePermission(tenant_id=1, role_id=1, resource_type='form', resource_key='1', action='view', effect='deny',
        condition_json={'rules': [{'field': 'title', 'op': 'equals', 'value': 'Blocked'}]}))
    await db.commit()
    result = await client.get('/forms/1/records')
    assert result.status_code == 200, result.text
    assert result.json()['total'] == 1 and result.json()['data'][0]['id'] == own['id']
    assert (await query_form_records(db, user=user, payload={'form_id': 1}))['record_count'] == 1
    assert (await client.get('/dashboard/programs/record-contract')).json()['total'] == 1
    bad = await client.post('/forms/1/records', json={'data': {'title': 'New', 'draft_only': 'not published'}})
    assert bad.status_code == 422, bad.text


@pytest.mark.asyncio
async def test_ai_current_page_context_reads_authorized_storage(environment):
    db, _, form, user, client = environment
    await seed(db, 'Page data')
    from app.services.ai.agent_context_router import agent_context_router
    context = await agent_context_router.build_semantic_context(db, message='分析当前表单数据',
        context={'route': '/program/record-contract'}, tenant_id=1, user=user)
    assert context['status'] == 'ready' and context['record_count'] == 1
    assert context['records'][0]['data']['title'] == 'Page data'
    denied = await agent_context_router.build_semantic_context(db, message='分析当前表单数据',
        context={'route': '/program/record-contract'}, tenant_id=2, user={**user, 'tenant_id': 2})
    assert denied['record_count'] == 0 and denied['status'] == 'semantic_context_unavailable'


@pytest.mark.asyncio
async def test_pagination_and_null_updates_are_consistent(environment):
    db, _, form, user, client = environment
    first = await seed(db, 'First')
    second = await seed(db, 'Second')
    page = await client.get('/forms/1/records?page_size=1&page=2')
    assert page.status_code == 200, page.text
    assert page.json()['total'] == 2 and page.json()['data'][0]['id'] == first['id']
    cursor = await client.get(f"/forms/1/records?page_size=1&cursor_after_id={second['id']}")
    assert cursor.status_code == 200, cursor.text
    assert cursor.json()['data'][0]['id'] == first['id']
    updated = await client.put(f"/forms/1/records/{first['id']}", json={'data': None, 'status': None})
    assert updated.status_code == 200, updated.text
    assert updated.json()['data']['status'] == 'draft' and updated.json()['data']['data']['title'] == 'First'
    # Exercise the SQL pagination path for administrators too.
    result = await records.list_records(1, db, {**user, 'is_admin': True}, page=2, page_size=1)
    assert result['total'] == 2 and result['data'][0]['id'] == first['id']


@pytest.mark.asyncio
async def test_json_boolean_types_and_metadata_protection(environment):
    db, _, form, user, client = environment
    for name, kind in [('attributes', 'json'), ('enabled', 'boolean'), ('due', 'date'), ('tenantId', 'integer')]:
        db.add(FormField(tenant_id=1, form_id=1, field_name=name, label=name, field_type=kind))
    await db.commit()
    payload = {'title': 'Typed', 'attributes': {'tags': ['a', 'b']}, 'enabled': False, 'due': '2026-10-14'}
    response = await client.post('/forms/1/records', json={'data': payload})
    assert response.status_code == 200, response.text
    row = response.json()['data']
    ai = await get_form_record(db, user=user, payload={'form_id': 1, 'record_id': row['id']})
    assert ai['record']['data']['attributes'] == {'tags': ['a', 'b']}
    assert ai['record']['data']['enabled'] is False
    for value in ('123', False, ['a', 2]):
        updated = await client.put(f"/forms/1/records/{row['id']}", json={'data': {'attributes': value}})
        assert updated.status_code == 200, updated.text
        actual = updated.json()['data']['data']['attributes']
        assert actual == value and type(actual) is type(value)
    for invalid in ({'qty': True}, {'due': 'invalid-date'}):
        response = await client.post('/forms/1/records', json={'data': {'title': 'Invalid', **invalid}})
        assert response.status_code == 422, response.text
    response = await client.post('/forms/1/records', json={'data': {'title': 'Spoof', 'tenantId': 2}})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_approval_transition_is_visible_to_ui_ai_and_dashboard(environment):
    db, _, form, user, client = environment
    from app.services.form_approval_config import save_approval_settings
    await save_approval_settings(db, 1, 1, 1, {'enabled': True,
        'stages': [{'name': 'Review', 'approver_ids': [2], 'approval_mode': 'single'}]})
    await db.commit()
    response = await client.post('/forms/1/records', json={'data': {'title': 'Review me'}})
    assert response.status_code == 200, response.text
    record_id = response.json()['data']['id']
    submitted = await client.post(f'/forms/1/records/{record_id}/submit', json={'expected_status': 'draft'})
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()['data']['status'] == 'pending'
    instance_id = submitted.json()['data']['workflow_instances'][0]['instance_id']
    await workflow._act_on_step(instance_id, workflow.StepApprovalRequest(comment='Verified'), 'approve',
        user={**user, 'uid': 2}, db=db)
    await db.commit()
    ui = (await client.get(f'/forms/1/records/{record_id}')).json()['data']
    ai = (await get_form_record(db, user=user, payload={'form_id': 1, 'record_id': record_id}))['record']
    board = (await client.get('/dashboard/programs/record-contract')).json()
    assert ui['status'] == ai['status'] == 'approved'
    assert board['rows'][0]['_approval']['status'] == 'approved'
    audit = (await db.scalars(select(AuditLog).where(AuditLog.action == 'status_transition'))).all()
    assert len(audit) == 2
