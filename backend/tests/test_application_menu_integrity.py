"""Assembly actions against isolated storage, with a fresh session per request."""
import os
from unittest.mock import AsyncMock
from sqlalchemy import text
from sqlalchemy.engine import make_url

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.api import applications, forms, admin
from app.services import applications as applications_service
from app.services import form_admin
from app.api.deps import get_db, get_current_user
from app.models.relational import Base, Tenant, User


@pytest.mark.asyncio
async def test_menu_integrity_defaults_and_atomic_reorder(tmp_path, monkeypatch):
    external_url = os.getenv('ASSEMBLY_TEST_DATABASE_URL')
    tables = None
    if external_url:
        assert make_url(external_url).database.startswith('assembly_verify_')
        from app.models import relational
        roots = ['Tenant', 'User', 'Role', 'UserRole', 'Form', 'FormField', 'FormLayout',
                 'FormAction', 'FormPermission', 'FormVersion', 'FormCodeSequence', 'DynamicRecord',
                 'Application', 'ApplicationForm', 'ApplicationRole', 'ApplicationMenuNode', 'ApplicationMenu', 'MenuItem',
                 'WorkflowBinding', 'WorkflowDef', 'WorkflowDefVersion', 'RolePermission', 'AuditLog']
        selected = {getattr(relational, name).__table__ for name in roots}
        pending = list(selected)
        while pending:
            for fk in pending.pop().foreign_keys:
                if fk.column.table not in selected:
                    selected.add(fk.column.table)
                    pending.append(fk.column.table)
        tables = list(selected)
    engine = create_async_engine(external_url or f'sqlite+aiosqlite:///{tmp_path / "assembly.db"}')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        if external_url:
            # The disposable verification database is shared with the other
            # assembly tests; physical form tables also reference users.
            await connection.execute(text('DROP SCHEMA public CASCADE'))
            await connection.execute(text('CREATE SCHEMA public'))
        await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=tables))
    async with sessions() as db:
        db.add(Tenant(id=1, name='isolated', slug='isolated'))
        await db.flush()
        db.add(User(id=1, tenant_id=1, username='admin', hashed_password='test', is_active=True))
        await db.commit()
    actor = {'uid': 1, 'tenant_id': 1, 'is_admin': True}
    async def database():
        async with sessions() as db:
            yield db
    async def safe_call(query):
        async with sessions() as db:
            return await query(db)
    app = FastAPI()
    app.include_router(forms.router, prefix='/forms')
    app.include_router(applications.admin_router, prefix='/admin')
    app.include_router(admin.router, prefix='/admin')
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: actor
    monkeypatch.setattr(applications, 'safe_db_call', safe_call)
    monkeypatch.setattr(admin, '_try_db', safe_call)
    monkeypatch.setattr(applications, 'write_audit_log', AsyncMock())
    monkeypatch.setattr(applications_service, 'write_audit_log', AsyncMock())
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    monkeypatch.setattr(form_admin, 'write_audit_log', AsyncMock())
    async def request(client, method, path, payload=None, expected=200):
        response = await client.request(method, path, json=payload)
        assert response.status_code == expected, response.text
        return response.json().get('data')
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            a = await request(client, 'POST', '/admin/applications', {'name':'A','code':'integrity-a'})
            b = await request(client, 'POST', '/admin/applications', {'name':'B','code':'integrity-b'})
            path = f'/forms/applications/{a["id"]}/menu-nodes'
            parent = await request(client, 'POST', path, {'title':'Parent','node_type':'group'})
            # Two editors start with the same snapshot. A stale write must not overwrite either names or permissions.
            app_token = a['edit_token']
            renamed_app = await request(client, 'PUT', f'/admin/applications/{a["id"]}', {'name':'A edited','expected_token':app_token})
            await request(client, 'PUT', f'/admin/applications/{a["id"]}', {'name':'A stale','expected_token':app_token}, expected=409)
            assert next(row for row in await request(client,'GET','/admin/applications') if row['id']==a['id'])['name'] == 'A edited'
            assert renamed_app['edit_token'] != app_token
            token = parent['edit_token']
            fresh = await request(client,'PUT',f'{path}/{parent["id"]}',{'title':'Parent edited','expected_token':token})
            await request(client,'PUT',f'{path}/{parent["id"]}',{'title':'Stale name','config':{'permission_mode':'custom','role_ids':[1]},'expected_token':token},expected=409)
            parent = next(row for row in await request(client,'GET',path) if row['id']==parent['id'])
            assert parent['title'] == 'Parent edited'
            assert parent['edit_token'] == fresh['edit_token']
            assert parent['config'].get('permission_mode') != 'custom'
            child = await request(client, 'POST', path, {'title':'Child','node_type':'group','parent_id':parent['id']})
            foreign = await request(client,'POST',f'/forms/applications/{b["id"]}/menu-nodes',{'title':'Foreign','node_type':'group'})
            for parent_id in [parent['id'], child['id'], foreign['id']]:
                await request(client,'PUT',f'{path}/{parent["id"]}',{'parent_id':parent_id},expected=422)
            await request(client,'POST',path,{'title':'Bad','node_type':'group','parent_id':foreign['id']},expected=422)
            rows = await request(client,'GET',path)
            assert len(rows) == 2
            expected = [{k:row[k] for k in ['id','parent_id','sort_order']} for row in rows]
            order_path = f'/forms/applications/{a["id"]}/menu-order'
            invalid = [{**item,'parent_id':child['id']} for item in expected]
            await request(client,'PUT',order_path,{'expected':expected,'nodes':invalid},expected=422)
            unchanged = await request(client,'GET',path)
            assert [{k:row[k] for k in ['id','parent_id','sort_order']} for row in unchanged] == expected
            moved = [{**item,'parent_id':None,'sort_order':index} for index,item in enumerate(expected)]
            saved = await request(client,'PUT',order_path,{'expected':expected,'nodes':moved})
            assert all(row['parent_id'] is None for row in saved)
            await request(client,'PUT',order_path,{'expected':expected,'nodes':moved},expected=409)
            # The default route and flags change together, with only one default.
            first = await request(client,'POST',path,{'title':'Entry1','node_type':'group','route_path':'/dashboard','default_entry':True})
            second = await request(client,'POST',path,{'title':'Entry2','node_type':'group','route_path':'/quality','default_entry':True})
            async def assert_default(route, node_id):
                apps = await request(client,'GET','/admin/applications')
                assert next(row for row in apps if row['id']==a['id'])['default_route'] == route
                nodes = await request(client,'GET',path)
                assert [row['id'] for row in nodes if row['default_entry']] == ([] if node_id is None else [node_id])
            await assert_default('/quality',second['id'])
            await request(client,'PUT',f'/admin/applications/{a["id"]}',{'default_route':'/dashboard'})
            await assert_default('/dashboard',first['id'])
            await request(client,'PUT',f'{path}/{first["id"]}',{'route_path':'/maintenance'})
            await assert_default('/maintenance',first['id'])
            await request(client,'PUT',f'{path}/{first["id"]}',{'visible':False})
            await assert_default('/',None)
            await request(client,'PUT',f'{path}/{second["id"]}',{'default_entry':True})
            await request(client,'DELETE',f'{path}/{second["id"]}')
            await assert_default('/',None)
            await request(client,'POST',path,{'title':'No destination','node_type':'group','default_entry':True},expected=422)
            # Deleting a group promotes children in the same transaction.
            await request(client,'PUT',f'{path}/{child["id"]}',{'parent_id':parent['id']})
            await request(client,'DELETE',f'{path}/{parent["id"]}')
            nodes = await request(client,'GET',path)
            assert next(row for row in nodes if row['id']==child['id'])['parent_id'] is None
    finally:
        await engine.dispose()
