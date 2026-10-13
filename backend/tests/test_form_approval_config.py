"""Isolated configuration tests: no developer database or runtime records."""
import asyncio
import json
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models.relational import Base, Form, User, WorkflowDef, WorkflowBinding, WorkflowDefVersion, WorkflowInstance
from app.services.form_approval_config import approval_settings, save_approval_settings

async def isolated(callback):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add_all([Form(id=1, tenant_id=1, code='biz', name='业务'), Form(id=2, tenant_id=1, code='material-application', name='料号'),
                Form(id=3, tenant_id=2, code='biz', name='其他租户'),
                User(id=1, tenant_id=1, username='first', hashed_password='test', is_active=True),
                User(id=2, tenant_id=1, username='second', hashed_password='test', is_active=True),
                User(id=3, tenant_id=2, username='other', hashed_password='test', is_active=True),
                User(id=4, tenant_id=1, username='inactive', hashed_password='test', is_active=False)])
            await db.commit()
            await callback(db)
    finally:
        await engine.dispose()


def body(uid=1):
    return {'enabled': True, 'stages': [{'name': '主管审批', 'approver_ids': [uid], 'approval_mode': 'single'}]}


def test_independent_versioned_settings_preserve_instances():
    async def case(db):
        first = await save_approval_settings(db, 1, 1, 1, body())
        await db.commit()
        initial = await db.scalar(select(WorkflowDefVersion))
        initial_config = initial.config
        instance = WorkflowInstance(tenant_id=1, workflow_id=first['workflow_id'], workflow_version=1, title='在途', initiator_id=1, status='pending', workflow_state='{}')
        db.add(instance)
        await db.commit()
        changes = body(2)
        changes['stages'].append({'name': '会签', 'approver_ids': [1,2], 'approval_mode': 'countersign'})
        second = await save_approval_settings(db, 1, 1, 1, changes)
        await db.commit()
        assert second['version'] == 2
        assert second['stages'] == changes['stages']
        assert initial.config == initial_config and instance.workflow_version == 1
        assert (await approval_settings(db, 1, 2))['enabled'] is False
        repeat = await save_approval_settings(db, 1, 1, 1, changes)
        assert repeat['version'] == 2
        assert len((await db.scalars(select(WorkflowDefVersion))).all()) == 2
    asyncio.run(isolated(case))


def test_tenant_active_users_and_version_conflicts():
    async def case(db):
        assert [u['id'] for u in (await approval_settings(db, 1, 1))['available_users']] == [1,2]
        for uid in (3,4):
            with pytest.raises(HTTPException) as error:
                await save_approval_settings(db, 1, 1, 1, body(uid))
            assert error.value.status_code == 422
        with pytest.raises(HTTPException) as error:
            await approval_settings(db, 1, 3)
        assert error.value.status_code == 404
        await save_approval_settings(db, 1, 1, 1, body())
        with pytest.raises(HTTPException) as error:
            await save_approval_settings(db, 1, 1, 1, {**body(), 'expected_version': 9})
        assert error.value.status_code == 409
    asyncio.run(isolated(case))


def test_custom_flow_requires_explicit_replacement_and_preserves_snapshot():
    async def case(db):
        config = json.dumps({'nodes': [{'type': 'condition'}]})
        old = WorkflowDef(tenant_id=1, name='Designer', config=config, status='published', version=1)
        db.add(old)
        await db.flush()
        old_binding = WorkflowBinding(tenant_id=1, form_id=1, workflow_id=old.id, trigger_action='submit', enabled=True)
        db.add_all([old_binding, WorkflowDefVersion(tenant_id=1, workflow_id=old.id, version=1, config=config, status='published')])
        await db.commit()
        current = await approval_settings(db, 1, 1)
        assert current['requires_replacement'] and not current['editable']
        with pytest.raises(HTTPException) as error:
            await save_approval_settings(db, 1, 1, 1, body())
        assert error.value.status_code == 409
        changed = await save_approval_settings(db, 1, 1, 1, {**body(), 'replace_existing': True})
        assert changed['managed'] and changed['workflow_id'] != old.id
        assert not old_binding.enabled and old.config == config
        assert (await db.scalar(select(WorkflowDefVersion).where(WorkflowDefVersion.workflow_id == old.id))).config == config
    asyncio.run(isolated(case))


def test_material_marker_and_trigger_preserved_disable_only_future_submits():
    async def case(db):
        settings = await save_approval_settings(db, 1, 2, 1, body())
        definition = await db.get(WorkflowDef, settings['workflow_id'])
        assert json.loads(definition.config)['domainCode'] == 'material-application-approval'
        assert settings['trigger_action'] == 'manual_submit'
        disabled = await save_approval_settings(db, 1, 2, 1, {'enabled': False, 'stages': body()['stages']})
        assert not disabled['enabled'] and disabled['version'] == 1
    asyncio.run(isolated(case))


def test_shared_managed_definition_not_mutated():
    async def case(db):
        first = await save_approval_settings(db, 1, 1, 1, body())
        definition = await db.get(WorkflowDef, first['workflow_id'])
        config = definition.config
        db.add(WorkflowBinding(tenant_id=1, form_id=2, workflow_id=definition.id, trigger_action='submit', enabled=True))
        await db.flush()
        assert (await approval_settings(db, 1, 1))['requires_replacement']
        replacement = await save_approval_settings(db, 1, 1, 1, {**body(2), 'replace_existing': True})
        assert replacement['workflow_id'] != definition.id and definition.config == config
    asyncio.run(isolated(case))


def test_non_business_and_archived_forms_cannot_configure():
    async def case(db):
        form = await db.get(Form, 1)
        for kind in ['analysis', 'dashboard', 'bi', 'bi_report']:
            form.config = {'assemblyKind': kind}
            await db.flush()
            with pytest.raises(HTTPException) as error:
                await save_approval_settings(db, 1, 1, 1, body())
            assert error.value.status_code == 422
        form.config = {}
        form.status = 'archived'
        with pytest.raises(HTTPException) as error:
            await save_approval_settings(db, 1, 1, 1, body())
        assert error.value.status_code == 422
    asyncio.run(isolated(case))


def test_initial_null_version_guard_and_independent_forms():
    async def case(db):
        initial = await save_approval_settings(db, 1, 1, 1, {**body(), 'expected_version': None})
        await db.commit()
        with pytest.raises(HTTPException) as error:
            await save_approval_settings(db, 1, 1, 1, {**body(2), 'expected_version': None})
        assert error.value.status_code == 409
        other = await save_approval_settings(db, 1, 2, 1, body(2))
        assert other['workflow_id'] != initial['workflow_id']
        await save_approval_settings(db, 1, 1, 1, {**body(), 'enabled': False})
        assert (await approval_settings(db, 1, 2))['enabled']
        reenabled = await save_approval_settings(db, 1, 1, 1, body())
        assert reenabled['version'] == 1
    asyncio.run(isolated(case))


def test_admin_route_permission_and_tenant_boundary():
    from fastapi import FastAPI
    from httpx import AsyncClient, ASGITransport
    from app.api.form_approvals import router
    from app.api.deps import get_current_user, get_db
    async def case(db):
        app = FastAPI()
        app.include_router(router, prefix='/forms')
        actor = {'tenant_id': 1, 'uid': 1, 'is_admin': False}
        async def current():
            return actor
        async def database():
            yield db
        app.dependency_overrides[get_current_user] = current
        app.dependency_overrides[get_db] = database
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            assert (await client.get('/forms/1/approval-settings')).status_code == 403
            assert (await client.put('/forms/1/approval-settings', json=body())).status_code == 403
            actor['is_admin'] = True
            assert (await client.get('/forms/3/approval-settings')).status_code == 404
            assert (await client.put('/forms/3/approval-settings', json=body())).status_code == 404
            response = await client.put('/forms/1/approval-settings', json={**body(), 'expected_version': None})
            assert response.status_code == 200, response.text
            assert response.json()['data']['enabled']
    asyncio.run(isolated(case))
