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
            role_response = await client.post('/admin/roles', json={'name':'assembly_new_role','label':'设备工程师','description':'真实保存验证'})
            assert role_response.status_code == 200, role_response.text
            role_id = role_response.json()['id']
            role_rows = await request(client, 'GET', '/admin/roles')
            saved_role = next(row for row in role_rows if row['id'] == role_id)
            assert saved_role['label'] == '设备工程师' and saved_role['description'] == '真实保存验证'
            assert saved_role['permissions'] == []  # Creation grants no privileges.
            await request(client, 'POST', '/admin/roles', {'name':'assembly_new_role','label':'重复角色'}, expected=409)
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
                await request(client, 'PUT', f'/forms/applications/{aid}/menu-nodes/{node["id"]}', {'title':'保存后的菜单','visible':False,'config':{'permission_mode':'custom','role_ids':[role_id]}})
                menu_nodes = await request(client, 'GET', f'/forms/applications/{aid}/menu-nodes')
                reloaded_node = next(item for item in menu_nodes if item['id'] == node['id'])
                assert reloaded_node['title'] == '保存后的菜单' and reloaded_node['visible'] is False
                assert reloaded_node['config']['role_ids'] == [role_id]
                assert reloaded_node['config']['permission_mode'] == 'custom'
                role_with_grants = next(row for row in await request(client, 'GET', '/admin/roles') if row['id'] == role_id)
                grant = next(item for item in role_with_grants['permissions'] if item['resource_key'] == f'menu_node:{node["id"]}')
                assert grant['enabled'] is False  # Hidden entries remain inaccessible.
                await request(client, 'PUT', f'/forms/applications/{aid}/menu-nodes/{node["id"]}', {'visible':True})
                visible_nodes = await request(client, 'GET', f'/forms/applications/{aid}/menu-nodes')
                assert next(item for item in visible_nodes if item['id'] == node['id'])['config']['role_ids'] == [role_id]
                field = await request(client, 'POST', f'/forms/{fid}/fields', {'field_name':'part_no','label':'物料编号','field_type':'string','ui_config':{'placeholder':'请输入物料编号'}})
                await request(client, 'POST', f'/forms/{fid}/fields', {'field_name':'part_no','label':'重复字段'}, expected=409)
                choice = await request(client, 'POST', f'/forms/{fid}/fields', {'field_name':'review_result','label':'审核结果','field_type':'enum','enum_values':{'values':['待处理','已完成']},'visible_in_list':False})
                draft = await request(client, 'GET', f'/forms/{fid}?schema=draft&scope=designer')
                assert draft['owner_id'] == 1
                assert draft['fields'][1]['label'] == '审核结果'
                assert draft['fields'][1]['visible_in_list'] is False
                assert draft['fields'][1]['enum_values']['values'] == ['待处理','已完成']
                config = {**draft['config'], 'ownerLabel':'测试负责人'}
                if kind == 'analysis':
                    config.update(analyticsDesign={'title':'旧画布'},
                                  analyticsDesignDraft={'title':'新画布'}, analyticsDesignMeta={'status':'draft'})
                await request(client, 'PUT', f'/forms/{fid}', {'name':'已保存表单','config':config,'owner_id':999})
                published = await request(client, 'POST', f'/forms/{fid}/publish')
                assert published['version'] == 1
                for schema in ['draft', 'published']:
                    loaded = await request(client, 'GET', f'/forms/{fid}?schema={schema}&scope=designer')
                    assert loaded['fields'][0]['label'] == '物料编号'
                    assert loaded['fields'][0]['field_name'] == 'part_no'
                    assert loaded['config']['ownerLabel'] == '测试负责人'
                    assert loaded['name'] == '已保存表单'
                    assert loaded['owner_id'] == 1
                    assert loaded['fields'][1]['label'] == '审核结果'
                    if kind == 'analysis':
                        assert loaded['config']['analyticsDesign']['title'] == '新画布'
                        assert loaded['config']['analyticsDesignMeta']['status'] == 'published'
                await request(client, 'PUT', f'/forms/{fid}', {'status':'disabled'})
                assert (await request(client,'GET',f'/forms/{fid}?schema=draft&scope=designer'))['status'] == 'disabled'
                if kind == 'analysis':
                    newer_config = {**loaded['config'], 'analyticsDesignDraft':{'title':'第二版画布'}}
                    await request(client, 'PUT', f'/forms/{fid}', {'config':newer_config})
                assert (await request(client, 'POST', f'/forms/{fid}/publish'))['version'] == 2
                if kind == 'analysis':
                    second = await request(client, 'GET', f'/forms/{fid}?schema=published&scope=designer')
                    assert second['config']['analyticsDesign']['title'] == '第二版画布'
                copied = await request(client, 'POST', f'/forms/{fid}/copy', {'name':'复制草稿','code':f'copy-{kind}'})
                assert copied['status'] == 'draft' and copied['table_name'] != form['table_name']
                assert copied['fields'][0]['id'] != field['id']
                copy_loaded = await request(client, 'GET', f'/forms/{copied["id"]}?schema=draft&scope=designer')
                assert copy_loaded['fields'][0]['label'] == '物料编号'
                assert copy_loaded['fields'][0]['ui_config']['placeholder'] == '请输入物料编号'
                assert copy_loaded['config']['viewConfigDraft'] == config['viewConfigDraft']
                assert not (await request(client, 'GET', f'/forms/{copied["id"]}/versions'))
                await request(client, 'POST', f'/forms/{fid}/copy', {'name':'重复','code':f'copy-{kind}'}, expected=409)
                # Existing field edits survive a fresh request without erasing
                # designer metadata. Published snapshots change only on publish.
                await request(client, 'PUT', f'/forms/{fid}/fields/{field["id"]}', {'label':'物料编号（修改）','required':True,'visible_in_list':False,'validation':{'maxBytes':64,'maxLength':20}})
                await request(client, 'PUT', f'/forms/{fid}/fields/{choice["id"]}', {'label':'审核结论','enum_values':{'values':['待处理','通过','退回']}})
                edited = await request(client, 'GET', f'/forms/{fid}?schema=draft&scope=designer')
                edited_field = next(item for item in edited['fields'] if item['id'] == field['id'])
                assert edited_field['label'] == '物料编号（修改）'
                assert edited_field['required'] is True and edited_field['visible_in_list'] is False
                assert edited_field['ui_config']['placeholder'] == '请输入物料编号'
                assert edited_field['field_name'] == 'part_no'
                assert edited_field['validation'] == {'maxBytes':64,'maxLength':20}
                assert edited['fields'][1]['enum_values']['values'] == ['待处理','通过','退回']
                await request(client, 'DELETE', f'/forms/{fid}/fields/{choice["id"]}')
                after_delete = await request(client, 'GET', f'/forms/{fid}?schema=draft&scope=designer')
                assert next(item for item in after_delete['fields'] if item['id'] == choice['id'])['archived'] is True
                still_published = await request(client, 'GET', f'/forms/{fid}?schema=published&scope=designer')
                assert still_published['fields'][0]['label'] == '物料编号'
                assert any(item['field_name'] == 'review_result' and not item.get('archived') for item in still_published['fields'])
                await request(client, 'POST', f'/forms/{fid}/publish')
                published_edits = await request(client, 'GET', f'/forms/{fid}?schema=published&scope=designer')
                assert published_edits['fields'][0]['label'] == '物料编号（修改）'
                assert not any(item['field_name'] == 'review_result' and not item.get('archived') for item in published_edits['fields'])
                # Size limits count UTF-8 bytes in physical rows too. A smaller
                # limit cannot silently invalidate already stored values.
                from app.models.relational import Form as StoredForm
                from app.api.form_engine.naming import _physical_column_name
                from sqlalchemy import text
                async with sessions() as data_db:
                    stored_form = await data_db.get(StoredForm, fid)
                    table_name = stored_form.table_name
                    column = _physical_column_name('part_no')
                    await data_db.execute(text(f"INSERT INTO {table_name} (tenant_id, {column}) VALUES (:tenant, :value)"), {'tenant':1,'value':'中文'})
                    await data_db.commit()
                await request(client, 'PUT', f'/forms/{fid}/fields/{field["id"]}', {'validation':{'maxBytes':5}}, expected=409)
                await request(client, 'PUT', f'/forms/{fid}/fields/{field["id"]}', {'validation':{'maxBytes':6}})
                limited = await request(client, 'GET', f'/forms/{fid}?schema=draft&scope=designer')
                assert limited['fields'][0]['validation']['maxBytes'] == 6
                actor['tenant_id'] = 2
                await request(client, 'POST', f'/forms/{fid}/copy', {'name':'越界','code':'other-tenant'}, expected=404)
                await request(client, 'PUT', f'/forms/{fid}/fields/{field["id"]}', {'label':'越界修改'}, expected=404)
                await request(client, 'DELETE', f'/forms/{fid}/fields/{field["id"]}', expected=404)
                actor['tenant_id'] = 1
            # Full designer lifecycle in both storage adapters. Required/list
            # are designer rules; raw field types and byte limits remain intact.
            for storage in ['dynamic', 'physical_table']:
                created = await request(client, 'POST', '/forms', {'name':'设计器往返验收','code':f'designer-{storage}',
                    'storage_mode':storage, **({'table_name':'t1_business_designer_dynamic'} if storage == 'dynamic' else {})})
                design_id = created['id']
                for name, typ, extra in [('title','string',{'validation':{'maxBytes':6}}), ('quantity','integer',{}), ('ratio','decimal',{})]:
                    await request(client, 'POST', f'/forms/{design_id}/fields', {'field_name':name,'label':name,'field_type':typ,**extra})
                config = {'formDesignerControls':[{'id':'title-control','source':'field','fieldKey':'title','controlType':'text',
                           'rules':{'required':{'enabled':True},'visible':{'enabled':True}}}],
                          'formLayout':{'sections':[{'fields':[{'fieldName':'title','required':True},{'fieldName':'quantity'}]}]},
                          'viewConfigDraft':{'table':{'columns':[{'fieldName':'title','enabled':False},{'fieldName':'quantity','enabled':True}]}}}
                await request(client, 'PUT', f'/forms/{design_id}', {'config':config})
                await request(client, 'POST', f'/forms/{design_id}/publish')
                for schema in ['draft','published']:
                    restored = await request(client, 'GET', f'/forms/{design_id}?schema={schema}&scope=designer')
                    by_name = {item['field_name']:item for item in restored['fields']}
                    assert by_name['title']['validation']['maxBytes'] == 6
                    assert by_name['quantity']['field_type'] == 'integer' and by_name['ratio']['field_type'] == 'decimal'
                    assert restored['config']['formDesignerControls'][0]['rules']['required']['enabled'] is True
                    if schema == 'published':
                        assert by_name['title']['required'] is True and by_name['title']['visible_in_list'] is False
                await request(client, 'POST', f'/forms/{design_id}/records', {'data':{'quantity':1}}, expected=422)
                await request(client, 'POST', f'/forms/{design_id}/records', {'data':{'title':'中文字'}}, expected=422)
                await request(client, 'POST', f'/forms/{design_id}/records', {'data':{'title':'中文','quantity':1,'ratio':1.5}})
                # Saving another draft must not change the running version.
                config['formDesignerControls'][0]['rules']['required']['enabled'] = False
                config['viewConfigDraft']['table']['columns'][0]['enabled'] = True
                await request(client, 'PUT', f'/forms/{design_id}', {'config':config})
                await request(client, 'POST', f'/forms/{design_id}/records', {'data':{'quantity':2}}, expected=422)
                await request(client, 'POST', f'/forms/{design_id}/publish')
                relaxed = await request(client, 'GET', f'/forms/{design_id}?schema=published&scope=create')
                assert relaxed['fields'][0]['required'] is False
                assert relaxed['fields'][0]['validation']['maxBytes'] == 6
                listed = await request(client, 'GET', f'/forms/{design_id}?schema=published&scope=list')
                assert listed['config']['viewConfig']['table']['columns'][0]['enabled'] is True
                await request(client, 'POST', f'/forms/{design_id}/records', {'data':{'quantity':2}})
    finally:
        await engine.dispose()
