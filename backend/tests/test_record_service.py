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
    schema_tables = None
    if external_url:
        # Test the dependency-closed record/workflow schema. Production uses
        # Alembic for unrelated AI/knowledge tables, not metadata.create_all.
        from app.models import relational
        model_names = ['SystemSetting','DataSource','Tenant', 'User', 'Role', 'UserRole', 'Material', 'Supplier', 'Form', 'FormField', 'FormLayout',
            'FormAction', 'FormPermission', 'FormVersion', 'AnalyticsSharedMetric', 'AnalyticsSharedMetricVersion', 'FormCodeSequence', 'DynamicRecord',
            'Application', 'ApplicationForm', 'ApplicationRole', 'ApplicationMenuNode', 'ComponentPage', 'ComponentPageVersion',
            'WorkflowBinding', 'WorkflowDef', 'WorkflowDefVersion', 'WorkflowInstance',
            'WorkflowApproval', 'RolePermission', 'UserOrgMembership', 'OrgUnit', 'AuditLog', 'Notification', 'AIAgentRun']
        tables = {getattr(relational, name).__table__ for name in model_names}
        pending = list(tables)
        while pending:
            for fk in pending.pop().foreign_keys:
                if fk.column.table not in tables:
                    tables.add(fk.column.table)
                    pending.append(fk.column.table)
        schema_tables = list(tables)
    engine = create_async_engine(external_url or f'sqlite+aiosqlite:///{tmp_path / "records.db"}')
    async with engine.begin() as connection:
        if external_url:
            await connection.execute(text('DROP TABLE IF EXISTS t1_business_contract'))
            await connection.run_sync(lambda conn: Base.metadata.drop_all(conn, tables=schema_tables))
            # Migration 0015 creates this legacy unique index separately from
            # ORM metadata; its conversation foreign key depends on it.
            await connection.run_sync(relational.Tenant.__table__.create)
            await connection.run_sync(relational.AIConversation.__table__.create)
            await connection.execute(text('CREATE UNIQUE INDEX ix_ai_conversations_legacy_id ON ai_conversations (conversation_id)'))
        await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=schema_tables))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        db.add_all([Tenant(id=1, name='One', slug='one'), Tenant(id=2, name='Two', slug='two')])
        await db.flush()
        db.add(Role(id=1, tenant_id=1, name='reader', label='Reader'))
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
        if external_url:
            await db.execute(text("SELECT setval(pg_get_serial_sequence('forms', 'id'), 1)"))
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
async def test_two_user_concurrency_never_overwrites_a_confirmed_change(environment):
    import asyncio
    from app.services.ai.form_record_tools import prepare_record_update, update_form_record
    db, factory, form, user, _ = environment
    if db.bind.dialect.name != 'postgresql':
        pytest.skip('Real row locking is verified against the disposable PostgreSQL database')
    record = await seed(db, 'Concurrent')
    proposals = []
    for uid, quantity in [(1, 31), (2, 32)]:
        actor = {**user, 'uid': uid}
        async with factory() as session:
            proposal = await prepare_record_update(session, user=actor, payload={'form_id': 1,
                'record_id': record['id'], 'data': {'qty': quantity}})
            proposals.append((actor, proposal))
    async def save(actor, proposal):
        async with factory() as session:
            try:
                return await update_form_record(session, user=actor, payload=proposal)
            except HTTPException as error:
                await session.rollback()
                return error.status_code
    results = await asyncio.wait_for(asyncio.gather(*(save(*p) for p in proposals)), 30)
    assert sum(isinstance(result, dict) for result in results) == 1, results
    assert 409 in results
    current = (await records.get_record(1, record['id'], db, user))['data']
    assert current['data']['qty'] in {31, 32}
    assert len((await db.scalars(select(AuditLog).where(AuditLog.action == 'update'))).all()) == 1


@pytest.mark.asyncio
async def test_page_stale_values_are_rejected_under_the_record_lock(environment):
    db, _, _, user, client = environment
    record = await seed(db, 'UI conflict')
    url = f"/forms/1/records/{record['id']}"
    assert (await client.put(url, json={'data': {'qty': 31}, 'expected_values': {'qty': 2}})).status_code == 200
    response = await client.put(url, json={'data': {'qty': 32}, 'expected_values': {'qty': 2}})
    assert response.status_code == 409
    assert (await records.get_record(1, record['id'], db, user))['data']['data']['qty'] == 31


@pytest.mark.asyncio
async def test_update_receipt_recovers_lost_response_without_a_second_write(environment, monkeypatch):
    from contextlib import asynccontextmanager
    from datetime import datetime, timedelta
    from app.models.relational import AIConversation, AIAgentRun
    from app.services.ai import run_recovery
    from app.services.ai.form_record_tools import prepare_record_update, update_form_record
    db, factory, _, user, _ = environment
    actor = {**user, 'sub': 'user1'}
    record = await seed(db, 'Receipt')
    proposal = await prepare_record_update(db, user=actor, payload={'form_id': 1, 'record_id': record['id'], 'data': {'qty': 30}})
    db.add(AIConversation(tenant_id=1, conversation_id='receipt-test', user_id='user1', title='Test'))
    await db.flush()
    confirmation = {'confirmation_token': 'test-receipt-token', 'user': 'user1',
        'expires_at': (datetime.now()+timedelta(minutes=10)).isoformat()}
    db.add(AIAgentRun(tenant_id=1, run_id='receipt-run', conversation_id='receipt-test', status='waiting_confirmation',
        input_message='改成30件', actions=[{'skill': 'forms.update_record', 'payload': proposal}],
        items=[{'type': 'confirmation', 'payload': confirmation}]))
    await db.commit()
    @asynccontextmanager
    async def session():
        async with factory() as scoped:
            yield scoped
    monkeypatch.setattr(run_recovery, 'db_session', session)
    if db.bind.dialect.name == 'postgresql':
        import asyncio
        results = await asyncio.gather(*[run_recovery.claim_confirmation('receipt-run', 'test-receipt-token', actor)
            for _ in range(2)], return_exceptions=True)
        assert sum(isinstance(item, tuple) and not item[1] for item in results) == 1
        assert sum(isinstance(item, HTTPException) and item.status_code == 409 for item in results) == 1
    else:
        _, replay = await run_recovery.claim_confirmation('receipt-run', 'test-receipt-token', actor)
        assert not replay
        with pytest.raises(HTTPException) as running:
            await run_recovery.claim_confirmation('receipt-run', 'test-receipt-token', actor)
        assert running.value.status_code == 409
    proposal['_execution_run_id'] = 'receipt-run'
    async with factory() as scoped:
        written = await update_form_record(scoped, user=actor, payload=proposal)
    # Simulate a lost response/process state: only the atomic DB receipt remains.
    recovered, replay = await run_recovery.claim_confirmation('receipt-run', 'test-receipt-token', actor)
    assert replay and recovered['status'] == 'completed'
    assert recovered['tool_results'][0]['result']['record_id'] == written['record_id']
    for token, principal in [('wrong-token', actor), ('test-receipt-token', {**actor, 'sub': 'user2'})]:
        with pytest.raises(HTTPException) as denied:
            await run_recovery.claim_confirmation('receipt-run', token, principal)
        assert denied.value.status_code == 404
    with pytest.raises(HTTPException) as terminal:
        await run_recovery.cancel_pending_run('receipt-run', actor)
    assert terminal.value.status_code == 409
    async with factory() as scoped:
        assert (await update_form_record(scoped, user=actor, payload=proposal)) == written
    assert len((await db.scalars(select(AuditLog).where(AuditLog.action == 'update'))).all()) == 1


@pytest.mark.asyncio
async def test_ai_identity_uses_current_database_roles_not_token_claims(environment, monkeypatch):
    from contextlib import asynccontextmanager
    from app.services.ai import identity_context
    db, _, _, user, _ = environment
    @asynccontextmanager
    async def session():
        yield db
    monkeypatch.setattr(identity_context, 'db_session', session)
    identity = await identity_context.resolve_ai_identity({**user, 'roles': [{'name': 'admin'}]})
    assert not identity['is_admin']
    assert [role['name'] for role in identity['roles']] == ['reader']
    from sqlalchemy import delete
    await db.execute(delete(UserRole).where(UserRole.user_id == 1))
    await db.commit()
    assert (await identity_context.resolve_ai_identity({**user, 'roles': [{'name': 'reader'}]}))['roles'] == []


@pytest.mark.asyncio
async def test_ai_record_scope_and_permission_revocation_block_confirmed_updates(environment):
    from app.services.ai.form_record_tools import prepare_record_update, update_form_record
    db, _, form, user, _ = environment
    own = await seed(db, 'Own')
    other = await seed(db, 'Other', uid=2)
    db.add(RolePermission(tenant_id=1, role_id=1, resource_type='form', resource_key='1', action='edit', effect='allow', data_scope='self'))
    await db.commit()
    with pytest.raises(HTTPException) as denied:
        await prepare_record_update(db, user=user, payload={'form_id': 1, 'record_id': other['id'], 'data': {'qty': 99}})
    assert denied.value.status_code == 403
    await db.rollback()
    proposal = await prepare_record_update(db, user=user, payload={'form_id': 1, 'record_id': own['id'], 'data': {'qty': 30}})
    # A view permission can be revoked while a confirmation card is open.
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='view', field_name='qty', effect='deny'))
    await db.commit()
    with pytest.raises(HTTPException) as revoked:
        await update_form_record(db, user=user, payload=proposal)
    assert revoked.value.status_code == 403
    await db.rollback()
    admin = {**user, 'is_admin': True}
    assert (await records.get_record(1, own['id'], db, admin))['data']['data']['qty'] == 2
    assert (await records.get_record(1, other['id'], db, admin))['data']['data']['qty'] == 2


@pytest.mark.asyncio
async def test_ai_update_preserves_record_and_rejects_stale_or_forbidden_writes(environment):
    from app.services.ai.form_record_tools import prepare_record_update, update_form_record
    db, _, form, user, client = environment
    first = await seed(db, 'Original')
    other = await seed(db, 'Other')
    proposal = await prepare_record_update(db, user=user, payload={
        'form_code': form.code, 'record_id': first['id'], 'data': {'qty': 30}, 'expected_values': {'qty': 999}})
    assert proposal['expected_values'] == {'qty': 2}
    assert (await records.get_record(form.id, first['id'], db, user))['data']['data']['qty'] == 2
    result = await update_form_record(db, user=user, payload=proposal)
    assert result['operation'] == 'update' and result['record_id'] == first['id']
    assert result['record']['data']['qty'] == 30 and result['record']['data']['title'] == 'Original'
    assert (await records.get_record(form.id, other['id'], db, user))['data']['data']['qty'] == 2
    with pytest.raises(HTTPException) as stale:
        await update_form_record(db, user=user, payload=proposal)
    assert stale.value.status_code == 409
    await db.rollback()
    db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='edit', field_name='qty', effect='deny'))
    await db.commit()
    with pytest.raises(HTTPException) as forbidden:
        await prepare_record_update(db, user=user, payload={'form_id': 1, 'record_id': first['id'], 'data': {'qty': 40}})
    assert forbidden.value.status_code == 403
    await db.rollback()
    with pytest.raises(HTTPException) as foreign:
        await prepare_record_update(db, user={**user, 'tenant_id': 2}, payload={'form_id': 1, 'record_id': first['id'], 'data': {'qty': 40}})
    assert foreign.value.status_code == 404


@pytest.mark.asyncio
async def test_ai_form_settings_resolves_exact_schema_without_cross_tenant_leak(environment, monkeypatch):
    from contextlib import asynccontextmanager
    from app.services.ai import tool_handlers
    db, _, form, user, _ = environment
    db.add(Form(tenant_id=2, code='other-private', name='Private', status='published'))
    await db.commit()
    @asynccontextmanager
    async def session():
        yield db
    monkeypatch.setattr(tool_handlers, 'db_session', session)
    context = tool_handlers.ToolHandlerContext(tool_name='platform.form_settings.query', current_user=user, settings={})
    result = await tool_handlers._platform_query({'form_code': form.code}, context)
    assert result['count'] == 1
    assert {f['field_name'] for f in result['items'][0]['fields']} == {'title', 'secret', 'qty', 'status'}
    assert (await tool_handlers._platform_query({'form_code': 'other-private'}, context))['count'] == 0


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
async def test_shared_archive_computation_visibility_and_encoding_for_ai_and_ui(environment):
    db, _, form, user, client = environment
    from app.models.relational import Material
    db.add_all([Material(id=1, tenant_id=1, name='真实物料', material_type='RAW', specs='10mm', unit='件'),
                Material(id=2, tenant_id=2, name='其他租户', material_type='RAW', unit='个')])
    definitions = [
        ('category', 'enum', True, None),
        ('material_code', 'string', True, {'businessType': 'code', 'encodingRule': {'template': 'MAT-{seq:4}', 'sequenceLength': 4, 'allowManualOverride': False}}),
        ('material_id', 'relation', True, {'relation_config': {'target_model': 'materials', 'label_field': 'name',
            'filters': [{'field': 'material_type', 'sourceField': 'category'}], 'backfill': {'material_name': 'name', 'unit': 'unit'}}}),
        ('material_name', 'string', False, {'readonly': True}),
        ('unit', 'string', False, {'readonly': True}),
        ('batch', 'string', True, None),
        ('display', 'string', False, {'readonly': True, 'computed': {'expression': "material_name + '-' + batch"}}),
        ('result', 'enum', True, None),
        ('reason', 'text', False, {'visibility': {'showWhen': {'field': 'result', 'equals': '不合格'}},
                                  'requiredWhen': {'field': 'result', 'equals': '不合格'}}),
        ('locked', 'string', False, {'readonly': True}),
    ]
    for name, kind, required, ui in definitions:
        db.add(FormField(tenant_id=1, form_id=form.id, field_name=name, label=name,
                         field_type=kind, required=required, ui_config=ui))
    await db.commit()
    payload = {'title': '规则测试', 'category': 'RAW', 'material_id': 1, 'batch': 'B001', 'result': '合格',
               'material_code': 'FORGED', 'display': 'FORGED', 'reason': 'should clear'}
    options = await client.post('/forms/1/fields/material_id/options', json={'data': {'category': 'RAW'}})
    assert options.status_code == 200 and options.json()['data'] == [{'id': 1, 'label': '真实物料'}]
    preview = await client.post('/forms/1/rules/evaluate', json={'data': payload})
    assert preview.status_code == 200, preview.text
    assert preview.json()['data']['data']['display'] == '真实物料-B001'
    assert preview.json()['data']['states']['reason']['visible'] is False
    created = await create_dynamic_record_draft_from_agent(db, user=user, skill='forms.create_record_draft',
                                                         payload={'form_id': 1, 'form_code': form.code, 'data': payload})
    assert created['data']['display'] == '真实物料-B001' and created['data']['reason'] is None
    assert created['data']['material_code'] == 'MAT-0001' and created['data']['unit'] == '件'
    rid = created['record_id']
    updated = await client.put(f'/forms/1/records/{rid}', json={'data': {'batch': 'B002'}})
    assert updated.status_code == 200, updated.text
    assert updated.json()['data']['data']['display'] == '真实物料-B002'
    for patch in [{'material_id': 2}, {'category': 'FINISHED'}, {'locked': 'manual'},
                  {'material_code': 'CHANGED'}, {'result': '不合格'}]:
        rejected = await client.put(f'/forms/1/records/{rid}', json={'data': patch})
        assert rejected.status_code == 422, (patch, rejected.text)
        await db.rollback()
    updated = await client.put(f'/forms/1/records/{rid}', json={'data': {'result': '不合格', 'reason': '复检异常'}})
    assert updated.status_code == 200, updated.text
    assert updated.json()['data']['data']['reason'] == '复检异常'


@pytest.mark.asyncio
async def test_form_archives_apply_source_row_and_field_permissions(environment):
    db, _, form, user, client = environment
    archive = Form(id=2, tenant_id=1, name='Supplier archive', code='supplier-archive', status='published')
    db.add(archive)
    await db.flush()
    db.add_all([FormField(tenant_id=1, form_id=2, field_name='name', label='Name', field_type='string'),
                FormField(tenant_id=1, form_id=2, field_name='status', label='Status', field_type='string'),
                FormPermission(tenant_id=1, form_id=2, role_id=1, action='*', effect='allow')])
    ref = FormField(tenant_id=1, form_id=1, field_name='supplier', label='Supplier', field_type='relation',
                    ui_config={'relation_config': {'target_form_code': 'supplier-archive', 'label_field': 'name',
                        'filters': [{'field': 'status', 'value': '启用'}], 'backfill': {'title': 'name'}}})
    db.add(ref)
    await db.commit()
    for name, status in [('Allowed', '启用'), ('Disabled', '停用'), ('Blocked', '启用')]:
        await records.create_record(2, forms.DynamicRecordCreate(data={'name': name, 'status': status}), db, user)
    db.add(RolePermission(tenant_id=1, role_id=1, resource_type='form', resource_key='2', action='view', effect='deny',
                          condition_json={'rules': [{'field': 'name', 'op': 'equals', 'value': 'Blocked'}]}))
    await db.commit()
    result = await client.post('/forms/1/fields/supplier/options', json={'data': {}})
    assert result.status_code == 200, result.text
    assert [option['label'] for option in result.json()['data']] == ['Allowed']
    source_id = result.json()['data'][0]['id']
    result = await client.post('/forms/1/records', json={'data': {'supplier': source_id}})
    assert result.status_code == 200, result.text
    assert result.json()['data']['data']['title'] == 'Allowed'
    db.add(FormPermission(tenant_id=1, form_id=2, role_id=1, action='view', field_name='name', effect='deny'))
    await db.commit()
    assert (await client.post('/forms/1/fields/supplier/options', json={'data': {}})).status_code == 403


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


@pytest.mark.asyncio
async def test_create_receipt_recovers_lost_response_without_another_record(environment, monkeypatch):
    from contextlib import asynccontextmanager
    from datetime import datetime, timedelta
    from app.models.relational import AIConversation, AIAgentRun
    from app.services.ai import run_recovery
    db, factory, form, user, _ = environment
    actor = {**user, 'sub': 'user1'}
    db.add(FormField(tenant_id=1, form_id=form.id, field_name='document_no', label='单号', field_type='string',
        ui_config={'businessType': 'code', 'encodingRule': {'template': 'IN-{seq:4}', 'sequenceLength': 4, 'allowManualOverride': False}}))
    proposal = {'form_code': form.code, 'data': {'title': '新增入库', 'qty': 10},
                '_execution_run_id': 'create-retry-run', '_execution_action_key': '0'}
    db.add(AIConversation(tenant_id=1, conversation_id='create-retry', user_id='user1', title='Test'))
    await db.flush()
    confirmation = {'confirmation_token': 'create-retry-token', 'user': 'user1',
        'expires_at': (datetime.now()+timedelta(minutes=10)).isoformat()}
    db.add(AIAgentRun(tenant_id=1, run_id='create-retry-run', conversation_id='create-retry', status='waiting_confirmation',
        input_message='帮我新增一条入库记录', actions=[{'skill': 'forms.create_record_draft', 'payload': proposal}],
        items=[{'type': 'confirmation', 'payload': confirmation}]))
    await db.commit()
    @asynccontextmanager
    async def session():
        async with factory() as scoped:
            yield scoped
    monkeypatch.setattr(run_recovery, 'db_session', session)
    await run_recovery.claim_confirmation('create-retry-run', 'create-retry-token', actor)
    async with factory() as scoped:
        async def lost_commit():
            raise RuntimeError('simulated transaction failure')
        with monkeypatch.context() as patch:
            patch.setattr(scoped, 'commit', lost_commit)
            with pytest.raises(RuntimeError, match='simulated transaction failure'):
                await create_dynamic_record_draft_from_agent(scoped, user=actor, skill='forms.create_record_draft', payload=proposal)
        await scoped.rollback()
    async with factory() as scoped:
        created = await create_dynamic_record_draft_from_agent(scoped, user=actor, skill='forms.create_record_draft', payload=proposal)
    # No executor final-state sync: emulate a lost reply immediately after commit.
    recovered, replay = await run_recovery.claim_confirmation('create-retry-run', 'create-retry-token', actor)
    assert replay and recovered['status'] == 'completed'
    assert recovered['tool_results'][0]['result']['record_id'] == created['record_id']
    assert created['data']['document_no'] == 'IN-0001'
    async with factory() as scoped:
        assert await create_dynamic_record_draft_from_agent(scoped, user=actor, skill='forms.create_record_draft', payload=proposal) == created
    rows = (await records.list_records(form.id, db, user))['data']
    assert len(rows) == 1
    assert len((await db.scalars(select(AuditLog).where(AuditLog.action == 'create'))).all()) == 1


@pytest.mark.asyncio
async def test_two_users_create_records_with_distinct_codes(environment):
    import asyncio
    db, factory, form, user, _ = environment
    if db.bind.dialect.name != 'postgresql':
        pytest.skip('Concurrent sequence allocation requires PostgreSQL row locks')
    db.add(FormField(tenant_id=1, form_id=form.id, field_name='document_no', label='单号', field_type='string',
        ui_config={'businessType': 'code', 'encodingRule': {'template': 'IN-{seq:4}', 'sequenceLength': 4, 'allowManualOverride': False}}))
    await db.commit()
    async def create(uid):
        async with factory() as scoped:
            return await create_dynamic_record_draft_from_agent(scoped, user={**user, 'uid': uid}, skill='forms.create_record_draft',
                payload={'form_code': form.code, 'data': {'title': '并发入库', 'qty': 10}})
    created = await asyncio.wait_for(asyncio.gather(create(1), create(2)), 30)
    assert len({item['record_id'] for item in created}) == 2
    assert {item['data']['document_no'] for item in created} == {'IN-0001', 'IN-0002'}
    # Repeat with the table, indexes and sequence counter already provisioned.
    more = await asyncio.wait_for(asyncio.gather(create(1), create(2)), 30)
    assert len({item['record_id'] for item in created + more}) == 4
    assert {item['data']['document_no'] for item in more} == {'IN-0003', 'IN-0004'}


async def publish_field_rules(db,form,client,user,rules_by_field):
    await db.refresh(form)
    controls=[{'id':name,'source':'field','fieldKey':name,'name':name,'controlType':'field','rules':rules} for name,rules in rules_by_field.items()]
    form.config={**(form.config or {}),'formDesignerControls':controls}
    await db.commit()
    await db.refresh(form)
    previous=user['is_admin'];user['is_admin']=True
    try:
        from unittest.mock import patch,AsyncMock
        with patch.object(forms,'write_audit_log',AsyncMock()):
            response=await client.post(f'/forms/{form.id}/publish')
    finally:user['is_admin']=previous
    return response


@pytest.mark.asyncio
async def test_published_unique_rule_survives_reload_and_guards_create_update(environment):
    db,_,form,user,client=environment
    response=await publish_field_rules(db,form,client,user,{'title':{'unique':{'enabled':True,'conditions':{'strategy':'form'}}}})
    assert response.status_code==200,response.text
    one=await seed(db,'Unique');two=await seed(db,'Other')
    with pytest.raises(HTTPException) as error:await seed(db,'Unique')
    assert error.value.status_code==409
    await db.rollback()
    r=await client.put(f'/forms/1/records/{two["id"]}',json={'data':{'title':'Unique'}})
    assert r.status_code==409,r.text
    await db.rollback()
    r=await client.put(f'/forms/1/records/{one["id"]}',json={'data':{'title':'Unique','qty':5}})
    assert r.status_code==200,r.text
    r=await client.get('/forms/1?schema=published&scope=designer')
    assert r.status_code==200
    user['is_admin']=True
    r=await client.get('/forms/1?schema=published&scope=designer')
    assert r.json()['data']['fields'][0]['ui_config']['rules']['unique']['conditions']['strategy']=='form'


@pytest.mark.asyncio
async def test_masks_survive_publication_and_never_replace_raw_storage(environment):
    db,_,form,user,client=environment
    rules={'secret':{'masked':{'enabled':True,'conditions':{'strategy':'partial','keepStart':2,'keepEnd':2}},'copyable':{'enabled':True,'conditions':{'strategy':'maskedCopy'}}},'qty':{'copyable':{'enabled':False}}}
    r=await publish_field_rules(db,form,client,user,rules);assert r.status_code==200,r.text
    record=await seed(db,'Masked');rid=record['id']
    assert record['data']['secret']=='pr****te'
    r=await client.get(f'/forms/1/records/{rid}');assert r.json()['data']['data']['secret']=='pr****te'
    policy=r.json()['data']['field_states'];assert policy['secret']['copyMode']=='maskedCopy' and policy['qty']['copyMode']=='disabled'
    r=await client.get('/forms/1/records');assert r.json()['data'][0]['data']['secret']=='pr****te'
    user['is_admin']=True
    r=await client.get('/forms/1/records');assert r.json()['data'][0]['data']['secret']=='pr****te'
    user['is_admin']=False
    r=await client.post('/forms/1/rules/evaluate',json={'record_id':rid,'data':{'secret':'pr****te','qty':9}})
    assert r.status_code==200 and r.json()['data']['data']['secret']=='pr****te',r.text
    r=await client.put(f'/forms/1/records/{rid}',json={'data':{'qty':9}});assert r.status_code==200,r.text
    raw=await records.read_raw(db,form,rid);assert raw['data']['secret']=='private' and raw['data']['qty']==9
    r=await client.put(f'/forms/1/records/{rid}',json={'data':{'secret':'masked-placeholder'}});assert r.status_code==403,r.text
    await db.rollback()
    r=await client.put(f'/forms/1/records/{rid}',json={'data':{'qty':10},'expected_values':{'secret':'private'}});assert r.status_code==403,r.text


@pytest.mark.asyncio
async def test_compound_unique_and_existing_duplicates_block_publication(environment):
    db,_,form,user,client=environment
    await seed(db,'Duplicate');await seed(db,'Duplicate')
    r=await publish_field_rules(db,form,client,user,{'title':{'unique':{'enabled':True}}})
    assert r.status_code==409 and r.json()['detail']['report']['blocking_count']>0,r.text
    await db.rollback()
    # A failed publish leaves the active schema usable; draft rules do not leak.
    await seed(db,'Duplicate')


@pytest.mark.asyncio
async def test_role_mask_reads_current_membership_instead_of_admin_bypass(environment):
    db,_,form,user,client=environment
    r=await publish_field_rules(db,form,client,user,{'secret':{'masked':{'enabled':True,'conditions':{'strategy':'role','roleIds':[1]}}}})
    assert r.status_code==200,r.text
    record=await seed(db,'Role mask');rid=record['id']
    r=await client.get(f'/forms/1/records/{rid}');assert r.json()['data']['data']['secret']=='private'
    # Remove the second user's unmasking role; admin form access remains intact.
    from sqlalchemy import delete
    await db.execute(delete(UserRole).where(UserRole.user_id==2));await db.commit()
    other=await records.get_record(1,rid,db,{'uid':2,'tenant_id':1,'is_admin':True})
    assert other['data']['data']['secret']!='private' and other['data']['field_states']['secret']['masked']


@pytest.mark.asyncio
async def test_compound_unique_and_domain_writes_share_the_guard(environment):
    db,_,form,user,client=environment
    r=await publish_field_rules(db,form,client,user,{'title':{'unique':{'enabled':True,'conditions':{'strategy':'compound','fields':['qty']}}}})
    assert r.status_code==200,r.text
    one=await seed(db,'Compound')
    other=(await records.create_record(1,forms.DynamicRecordCreate(data={'title':'Compound','qty':3}),db,{**user,'is_admin':True}))['data']
    raw=await records.read_raw(db,form,other['id'])
    with pytest.raises(HTTPException) as error:await records.write_fields(db,form,raw,{'qty':2},user=user,system=True)
    assert error.value.status_code==409
    await db.rollback()
    assert one['data']['qty']==2


@pytest.mark.asyncio
async def test_tenant_wide_unique_also_covers_forms_without_local_rule(environment):
    db,_,form,user,client=environment
    r=await publish_field_rules(db,form,client,user,{'title':{'unique':{'enabled':True,'conditions':{'strategy':'global'}}}})
    assert r.status_code==200,r.text
    await seed(db,'Shared')
    for tenant,fid in [(1,2),(2,3)]:
        peer=Form(id=fid,tenant_id=tenant,name='Peer',code=f'peer-{fid}',storage_mode='dynamic')
        db.add(peer);await db.flush();db.add(FormField(tenant_id=tenant,form_id=fid,field_name='title',label='title',field_type='string'));await db.commit()
    with pytest.raises(HTTPException) as error:await records.create_record(2,forms.DynamicRecordCreate(data={'title':'Shared'}),db,{**user,'is_admin':True})
    assert error.value.status_code==409
    await db.rollback()
    other=await records.create_record(3,forms.DynamicRecordCreate(data={'title':'Shared'}),db,{**user,'tenant_id':2,'is_admin':True})
    assert other['data']['data']['title']=='Shared'


@pytest.mark.asyncio
async def test_concurrent_unique_writes_are_serialized_on_postgres(environment):
    import asyncio
    db,factory,form,user,client=environment
    if db.bind.dialect.name!='postgresql':pytest.skip('Concurrent uniqueness requires PostgreSQL transaction locks')
    r=await publish_field_rules(db,form,client,user,{'title':{'unique':{'enabled':True}}});assert r.status_code==200,r.text
    await db.commit()
    async def writer():
        async with factory() as session:
            try:
                await records.create_record(1,forms.DynamicRecordCreate(data={'title':'Concurrent unique'}),session,{**user,'is_admin':True})
                return 200
            except HTTPException as error:
                await session.rollback();return error.status_code
    assert sorted(await asyncio.gather(writer(),writer()))==[200,409]


@pytest.mark.asyncio
async def test_form_field_capacity_rejects_new_fields_at_system_default(environment, monkeypatch):
    from unittest.mock import AsyncMock
    from app.services.field_limits import DEFAULT_FORM_FIELDS
    db, _, form, _, _ = environment
    actor = {'uid': 1, 'tenant_id': 1, 'is_admin': True}
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    for index in range(DEFAULT_FORM_FIELDS - 4):
        db.add(FormField(tenant_id=1, form_id=form.id, field_name=f'capacity_{index}', label='容量测试', field_type='string'))
    await db.commit()
    with pytest.raises(HTTPException) as error:
        await forms.create_form_field(form.id, forms.FormFieldCreate(field_name='overflow', label='超额字段'), db, actor)
    assert error.value.status_code == 422 and '200' in error.value.detail
    old = await db.scalar(select(FormField).where(FormField.form_id == form.id, FormField.field_name == 'capacity_0'))
    old.archived = True
    await db.commit()
    added = await forms.create_form_field(form.id, forms.FormFieldCreate(field_name='available', label='可用字段'), db, actor)
    assert added['data']['field_name'] == 'available'
    with pytest.raises(HTTPException) as restore_error:
        await forms.update_form_field(form.id, old.id, forms.FormFieldUpdate(archived=False), db, actor)
    assert restore_error.value.status_code == 422


@pytest.mark.asyncio
async def test_calculations_are_authoritative_in_runtime_preview_create_and_update(environment):
    db, _, form, user, client = environment
    fields = [FormField(tenant_id=1, form_id=1, field_name='price', label='单价', field_type='number'),
        FormField(tenant_id=1, form_id=1, field_name='total', label='金额', field_type='number',
            ui_config={'computed': {'expression': 'qty * price', 'precision': 2}})]
    db.add_all(fields); await db.commit()
    preview = await client.post('/forms/1/rules/evaluate', json={'data': {'title': '公式测试', 'qty': 3, 'price': 19.9, 'total': 1}})
    assert preview.status_code == 200, preview.text
    assert preview.json()['data']['data']['total'] == 59.7
    assert preview.json()['data']['states']['total']['readonly']
    created = await client.post('/forms/1/records', json={'data': {'title': '公式测试', 'qty': 3, 'price': 19.9, 'total': 1}})
    assert created.status_code == 200, created.text
    result = created.json()['data']
    assert result['data']['total'] == 59.7
    updated = await client.put(f'/forms/1/records/{result["id"]}', json={'data': {'qty': 4, 'total': 999}})
    assert updated.status_code == 200, updated.text
    assert updated.json()['data']['data']['total'] == 79.6
    fields[-1].ui_config = {'computed': {'expression': 'qty / (price - price)'}}
    await db.commit()
    invalid = await client.post('/forms/1/records', json={'data': {'title': '应阻止', 'qty': 3, 'price': 19.9}})
    assert invalid.status_code == 422 and '除数不能为 0' in invalid.text
