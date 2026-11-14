import asyncio
"""Assembly actions against isolated storage, with a fresh session per request."""
import os
from unittest.mock import AsyncMock
from sqlalchemy.engine import make_url

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.api import applications, forms, admin
from app.api.deps import get_db, get_current_user
from app.models.relational import Base, Tenant, User


@pytest.mark.asyncio
async def test_settings_concurrent_writes(tmp_path, monkeypatch):
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
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    async def request(client, method, path, payload=None, expected=200):
        response = await client.request(method, path, json=payload)
        assert response.status_code == expected, response.text
        return response.json().get('data')
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            a = await request(client,'POST','/admin/applications',{'name':'Concurrent','code':'concurrent'})
            path = f'/forms/applications/{a["id"]}/menu-nodes'
            first = await request(client,'POST',path,{'title':'First','node_type':'group'})
            second = await request(client,'POST',path,{'title':'Second','node_type':'group'})
            form = await request(client,'POST','/forms',{'name':'Source','code':'concurrent-source'})
            async def race(url, left, right, codes):
                results = await asyncio.gather(client.put(url,json=left),client.put(url,json=right))
                assert sorted(result.status_code for result in results) == sorted(codes), [(r.status_code,r.text) for r in results]
                return next(result.json()['data'] for result in results if result.status_code == 200)
            saved = await race(f'/admin/applications/{a["id"]}',
                {'name':'Editor A','expected_token':a['edit_token']},
                {'name':'Editor B','expected_token':a['edit_token']},[200,409])
            assert saved['name'] in ['Editor A','Editor B']
            await race(f'{path}/{first["id"]}',
                {'title':'Menu A','expected_token':first['edit_token']},
                {'title':'Menu B','expected_token':first['edit_token']},[200,409])
            await race(f'/forms/{form["id"]}',
                {'name':'Form A','expected_token':form['edit_token']},
                {'name':'Form B','expected_token':form['edit_token']},[200,409])
            # Two valid moves considered separately must not jointly create a cycle.
            moves = await asyncio.gather(
                client.put(f'{path}/{first["id"]}',json={'parent_id':second['id']}),
                client.put(f'{path}/{second["id"]}',json={'parent_id':first['id']}))
            assert sorted(r.status_code for r in moves) == [200,422], [(r.status_code,r.text) for r in moves]
            rows = await request(client,'GET',path)
            expected=[{key:row[key] for key in ['id','parent_id','sort_order']} for row in rows]
            one=[{**row,'parent_id':None,'sort_order':index} for index,row in enumerate(expected)]
            two=[{**row,'parent_id':None,'sort_order':len(expected)-index-1} for index,row in enumerate(expected)]
            await race(f'/forms/applications/{a["id"]}/menu-order',
                {'expected':expected,'nodes':one},{'expected':expected,'nodes':two},[200,409])
    finally:
        await engine.dispose()
