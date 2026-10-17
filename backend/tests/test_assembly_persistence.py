"""Assembly actions against isolated storage, with a fresh session per request."""
import os
from unittest.mock import AsyncMock
from sqlalchemy.engine import make_url

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.api import applications, forms
from app.api.deps import get_db, get_current_user
from app.models.relational import Base, Tenant, User


@pytest.mark.asyncio
async def test_assembly_save_publish_reload_and_copy_preserve_field_names(tmp_path, monkeypatch):
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
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: actor
    monkeypatch.setattr(applications, 'safe_db_call', safe_call)
    monkeypatch.setattr(applications, 'write_audit_log', AsyncMock())
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    async def request(client, method, path, payload=None, expected=200):
        response = await client.request(method, path, json=payload)
        assert response.status_code == expected, response.text
        return response.json().get('data')
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            application = await request(client, 'POST', '/admin/applications', {'name':'测试应用','code':'assembly-test','status':'draft'})
            aid = application['id']
            await request(client, 'POST', '/admin/applications', {'name':'重复','code':'assembly-test'}, expected=409)
            for status in ['published', 'disabled', 'published']:
                await request(client, 'PUT', f'/admin/applications/{aid}', {'name':'已保存应用', 'status':status, 'is_pinned':True})
                loaded = await request(client, 'GET', '/admin/applications')
                assert loaded[0]['status'] == status and loaded[0]['name'] == '已保存应用'
            for kind in ['interaction', 'analysis']:
                form = await request(client, 'POST', '/forms', {'name':'测试表单','code':f'test-{kind}', 'config':{'assemblyKind':kind,'viewConfigDraft':{'table':{'columns':[{'fieldName':'part_no','label':'物料编号'}]}}}})
                fid = form['id']
                node = await request(client, 'POST', f'/forms/applications/{aid}/menu-nodes', {'title':'初始菜单','form_id':fid,'node_type':'form'})
                await request(client, 'PUT', f'/forms/applications/{aid}/menu-nodes/{node["id"]}', {'title':'保存后的菜单','visible':False})
                menu_nodes = await request(client, 'GET', f'/forms/applications/{aid}/menu-nodes')
                reloaded_node = next(item for item in menu_nodes if item['id'] == node['id'])
                assert reloaded_node['title'] == '保存后的菜单' and reloaded_node['visible'] is False
                field = await request(client, 'POST', f'/forms/{fid}/fields', {'field_name':'part_no','label':'物料编号','field_type':'string','ui_config':{'placeholder':'请输入物料编号'}})
                draft = await request(client, 'GET', f'/forms/{fid}?schema=draft&scope=designer')
                config = {**draft['config'], 'ownerLabel':'测试负责人'}
                await request(client, 'PUT', f'/forms/{fid}', {'name':'已保存表单','config':config})
                published = await request(client, 'POST', f'/forms/{fid}/publish')
                assert published['version'] == 1
                for schema in ['draft', 'published']:
                    loaded = await request(client, 'GET', f'/forms/{fid}?schema={schema}&scope=designer')
                    assert loaded['fields'][0]['label'] == '物料编号'
                    assert loaded['fields'][0]['field_name'] == 'part_no'
                    assert loaded['config']['ownerLabel'] == '测试负责人'
                    assert loaded['name'] == '已保存表单'
                await request(client, 'PUT', f'/forms/{fid}', {'status':'disabled'})
                assert (await request(client,'GET',f'/forms/{fid}?schema=draft&scope=designer'))['status'] == 'disabled'
                assert (await request(client, 'POST', f'/forms/{fid}/publish'))['version'] == 2
                copied = await request(client, 'POST', f'/forms/{fid}/copy', {'name':'复制草稿','code':f'copy-{kind}'})
                assert copied['status'] == 'draft' and copied['table_name'] != form['table_name']
                assert copied['fields'][0]['id'] != field['id']
                copy_loaded = await request(client, 'GET', f'/forms/{copied["id"]}?schema=draft&scope=designer')
                assert copy_loaded['fields'][0]['label'] == '物料编号'
                assert copy_loaded['fields'][0]['ui_config']['placeholder'] == '请输入物料编号'
                assert copy_loaded['config']['viewConfigDraft'] == config['viewConfigDraft']
                assert not (await request(client, 'GET', f'/forms/{copied["id"]}/versions'))
                await request(client, 'POST', f'/forms/{fid}/copy', {'name':'重复','code':f'copy-{kind}'}, expected=409)
                actor['tenant_id'] = 2
                await request(client, 'POST', f'/forms/{fid}/copy', {'name':'越界','code':'other-tenant'}, expected=404)
                actor['tenant_id'] = 1
    finally:
        await engine.dispose()
