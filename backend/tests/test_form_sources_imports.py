"""New sources and imports use actual persisted schemas, permissions and transactions."""
import copy
import io
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from openpyxl import Workbook
from tests.test_record_service import environment
from app.api import forms
from app.models.relational import Form, FormField, FormPermission, DataSource, SystemSetting
from app.services import form_option_sources as sources, records
from app.services.form_imports import parse_file, convert


async def publish(db,form,user,client,monkeypatch,config):
    monkeypatch.setattr(forms,'write_audit_log',AsyncMock())
    form.config=config;await db.commit();await db.refresh(form)
    user['is_admin']=True
    response=await client.post('/forms/1/publish');assert response.status_code==200,response.text
    await db.refresh(form)
    user['is_admin']=False


@pytest.mark.asyncio
async def test_dictionary_codes_labels_disabled_values_and_tenant_persist(environment,monkeypatch):
    db,factory,form,user,client=environment
    db.add_all([SystemSetting(key='reference_data_admin:1',value={'dictionaries':[{'dictCode':'priority','dictName':'优先级','options':[{'value':'high','label':'高','enabled':True},{'value':'off','label':'停用','enabled':False}]}]}),SystemSetting(key='reference_data_admin:2',value={'dictionaries':[{'dictCode':'other','options':[{'value':'private','label':'Other tenant'}]}]})])
    control={'id':'priority','fieldKey':'secret','controlType':'select','dataSourceKind':'dictionary','optionSource':'priority','typeSettings':{'selectionMode':'single','displayMode':'dropdown'}}
    await publish(db,form,user,client,monkeypatch,{'formDesignerControls':[control]})
    response=await client.post('/forms/1/fields/secret/options',json={'data':{}});assert response.status_code==200,response.text
    assert response.json()['data']==[{'id':'high','label':'高'}]
    response=await client.post('/forms/1/records',json={'data':{'title':'Valid','secret':'high','qty':2}});assert response.status_code==200,response.text
    rid=response.json()['data']['id']
    response=await client.post('/forms/1/records',json={'data':{'title':'Invalid','secret':'off'}});assert response.status_code==422,response.text
    response=await client.get('/forms/reference-sources');assert response.status_code==403
    async with factory() as fresh:
        saved=(await records.get_record(1,rid,fresh,user))['data']
        assert saved['data']['secret']=='high'
        schema=await records.runtime_fields(fresh,await fresh.get(Form,1))
        field=next(field for field in schema if field.field_name=='secret')
        assert field.ui_config['relation_config']['source_code']=='priority'
    user['is_admin']=True
    response=await client.get('/forms/reference-sources');assert response.status_code==200,response.text
    assert response.json()['data']['dictionaries']==[{'code':'priority','name':'优先级'}]


@pytest.mark.asyncio
async def test_external_mapping_backfill_preview_and_secret_boundary(environment,monkeypatch):
    db,factory,form,user,client=environment
    db.add(DataSource(id=1,tenant_id=1,name='API',source_type='api',status='active',connection_config=json.dumps({'url':'https://api.example.test/options','headers':{'Authorization':'Bearer secret-token'}})))
    db.add(DataSource(id=2,tenant_id=2,name='Other',source_type='api',status='active',connection_config='{}'))
    fetch=AsyncMock(return_value={'payload':{'items':[{'code':'E-01','name':'设备一','count':8}]}})
    monkeypatch.setattr(sources,'fetch_json',fetch)
    control={'id':'external','fieldKey':'secret','controlType':'select','dataSourceKind':'externalApi','optionSource':'1','referenceValueField':'code','referenceLabelField':'name','referenceItemsPath':'payload.items','assignmentRules':[{'targetField':'status','sourceAttribute':'record.name'}]}
    await publish(db,form,user,client,monkeypatch,{'formDesignerControls':[control]})
    response=await client.post('/forms/1/fields/secret/options',json={'data':{}});assert response.status_code==200,response.text
    assert response.json()['data']==[{'id':'E-01','label':'设备一'}]
    response=await client.post('/forms/1/records',json={'data':{'title':'External','secret':'E-01'}});assert response.status_code==200,response.text
    rid=response.json()['data']['id'];assert response.json()['data']['data']['status']=='设备一'
    async with factory() as fresh:
        saved=(await records.get_record(1,rid,fresh,user))['data'];assert saved['data']['secret']=='E-01'
    response=await client.get('/forms/1?schema=published&scope=list');assert response.status_code==200,response.text
    assert 'secret-token' not in response.text and 'api.example.test' not in response.text
    user['is_admin']=True
    response=await client.get('/forms/reference-sources');assert response.status_code==200,response.text
    assert response.json()['data']['externalApis']==[{'id':1,'name':'API'}]
    bad=copy.deepcopy(control);bad['optionSource']='2'
    response=await client.post('/forms/1/fields/secret/options/preview',json={'controls':[bad],'data':{}});assert response.status_code==422,response.text
    assert 'secret-token' not in response.text


@pytest.mark.asyncio
async def test_atomic_import_mapping_idempotency_and_reload(environment,monkeypatch):
    db,factory,form,user,client=environment
    await publish(db,form,user,client,monkeypatch,{})
    content='标题,数量\nFirst,2\nSecond,3\n'.encode()
    response=await client.post('/forms/1/imports/preview',files={'file':('rows.csv',content,'text/csv')});assert response.status_code==200,response.text
    preview=response.json()['data'];assert preview['row_count']==2
    mapping={'0':'title','1':'qty'}
    fields={'mapping':json.dumps(mapping),'request_key':'import-test-0000001','schema_version':str(preview['schema_version'])}
    response=await client.post('/forms/1/imports',data=fields,files={'file':('rows.csv',content)});assert response.status_code==200,response.text
    assert response.json()['data']['count']==2
    response=await client.post('/forms/1/imports',data=fields,files={'file':('rows.csv',content)});assert response.status_code==200,response.text
    assert response.json()['data']['replayed'] is True
    async with factory() as fresh:
        rows=(await records.list_records(1,fresh,user))['data']
        assert len(rows)==2 and {row['data']['qty'] for row in rows}=={2,3}
        receipt=await fresh.scalar(select(SystemSetting).where(SystemSetting.key.like('form_import:1:1:1:%')))
        assert receipt.value['result']['count']==2


@pytest.mark.asyncio
async def test_import_bad_row_rolls_back_all_writes_and_uniqueness(environment,monkeypatch):
    db,_,form,user,client=environment
    await publish(db,form,user,client,monkeypatch,{'formDesignerControls':[{'id':'title','fieldKey':'title','controlType':'text','rules':{'unique':{'enabled':True,'conditions':{'strategy':'form'}}}}]})
    fields={'mapping':json.dumps({'0':'title','1':'qty'}),'request_key':'rollback-test-00001','schema_version':'1'}
    response=await client.post('/forms/1/imports',data=fields,files={'file':('rows.csv',b'title,qty\nFirst,2\nSecond,no-number\n')})
    assert response.status_code==422,response.text
    assert response.json()['detail']['row']==3
    assert (await records.list_records(1,db,user))['total']==0
    fields['request_key']='duplicate-test-0001'
    response=await client.post('/forms/1/imports',data=fields,files={'file':('rows.csv',b'title,qty\nSame,2\nSame,3\n')})
    assert response.status_code==409,response.text
    assert (await records.list_records(1,db,user))['total']==0


@pytest.mark.asyncio
async def test_import_requires_import_create_and_field_permissions_and_version(environment,monkeypatch):
    db,_,form,user,client=environment
    await publish(db,form,user,client,monkeypatch,{})
    db.add(FormPermission(tenant_id=1,form_id=1,role_id=1,action='import',effect='deny'));await db.commit()
    response=await client.post('/forms/1/imports/preview',files={'file':('rows.csv',b'title\nA\n')});assert response.status_code==403
    denied=await db.scalar(select(FormPermission).where(FormPermission.action=='import'));await db.delete(denied)
    db.add(FormPermission(tenant_id=1,form_id=1,role_id=1,action='create',field_name='secret',effect='deny'));await db.commit()
    response=await client.post('/forms/1/imports/preview',files={'file':('rows.csv',b'title,secret\nA,private\n')});assert response.status_code==200,response.text
    assert 'secret' not in {field['name'] for field in response.json()['data']['fields']}
    fields={'mapping':json.dumps({'0':'title','1':'secret'}),'request_key':'permissions-test-01','schema_version':'1'}
    response=await client.post('/forms/1/imports',data=fields,files={'file':('rows.csv',b'title,secret\nA,private\n')});assert response.status_code==422
    fields['mapping']=json.dumps({'0':'title'});fields['schema_version']='999'
    response=await client.post('/forms/1/imports',data=fields,files={'file':('rows.csv',b'title\nA\n')});assert response.status_code==409
    assert (await records.list_records(1,db,user))['total']==0


def test_excel_parser_bounds_formula_rejection_and_precise_numeric_conversion():
    book=Workbook();sheet=book.active;sheet.append(['title','qty']);sheet.append(['Excel',3]);stream=io.BytesIO();book.save(stream)
    assert parse_file('rows.xlsx',stream.getvalue())==(['title','qty'],[['Excel',3]])
    sheet['B2']='=1+2';stream=io.BytesIO();book.save(stream)
    with pytest.raises(Exception) as error:parse_file('rows.xlsx',stream.getvalue())
    assert error.value.status_code==422 and '公式' in error.value.detail
    from types import SimpleNamespace
    field=SimpleNamespace(field_type='integer',label='数量')
    assert convert('2147483647',field)==2147483647
    with pytest.raises(Exception):convert('2147483648',field)
    with pytest.raises(Exception):parse_file('rows.csv',b'title,title\na,b')


@pytest.mark.asyncio
async def test_external_request_is_pinned_no_redirects_and_blocks_metadata(monkeypatch):
    original=httpx.AsyncClient
    captured=[]
    def handler(request):
        captured.append(request)
        return httpx.Response(200,json={'data':[{'id':'A','name':'Alpha'}]})
    monkeypatch.setattr(sources.socket,'getaddrinfo',lambda *args,**kwargs:[(2,1,6,'',('93.184.216.34',443))])
    monkeypatch.setattr(sources.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs))
    assert (await sources.fetch_json({'url':'https://api.example.test/options','headers':{'Authorization':'Bearer secret'}}))['data'][0]['id']=='A'
    assert captured[0].url.host=='93.184.216.34' and captured[0].headers['host']=='api.example.test'
    assert captured[0].extensions['sni_hostname']=='api.example.test'
    monkeypatch.setattr(sources.socket,'getaddrinfo',lambda *args,**kwargs:[(2,1,6,'',('169.254.169.254',80))])
    with pytest.raises(Exception) as error:await sources.fetch_json({'url':'http://metadata.example.test','allow_private_network':True})
    assert error.value.status_code==422
    assert len(captured)==1

@pytest.mark.asyncio
async def test_registered_api_editor_save_test_preview_refresh_and_privileges(environment,monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport,AsyncClient
    from app.api import data_sources
    from app.api.deps import get_current_user
    db,factory,_,user,_=environment
    async def safe_call(fn):
        async with factory() as fresh:return await fn(fresh)
    monkeypatch.setattr(data_sources,'_try_db',safe_call)
    fetch=AsyncMock(return_value={'data':[{'id':'A','name':'Real API item'}]})
    monkeypatch.setattr(sources,'fetch_json',fetch)
    app=FastAPI();app.include_router(data_sources.router,prefix='/sources');app.dependency_overrides[get_current_user]=lambda:user
    async with AsyncClient(transport=ASGITransport(app),base_url='http://test') as client:
        payload={'name':'Registered API','source_type':'api','connection_config':json.dumps({'url':'https://api.example.test/options?token=secret','headers':{'Authorization':'Bearer private'}})}
        response=await client.post('/sources',json=payload);assert response.status_code==403
        user['is_admin']=True
        response=await client.post('/sources/test-config',json={'source_type':'api','connection_config':payload['connection_config']});assert response.status_code==200,response.text
        response=await client.post('/sources',json=payload);assert response.status_code==200,response.text
        sid=response.json()['id']
        response=await client.get('/sources');assert 'private' not in response.text and 'token=secret' not in response.text
        response=await client.post(f'/sources/{sid}/test');assert response.status_code==200,response.text
        assert response.json()['success'] is True
        response=await client.get(f'/sources/{sid}/preview');assert response.status_code==200,response.text
        assert response.json()['rows']==[{'id':'A','name':'Real API item'}]
        response=await client.get(f'/sources/{sid}');assert response.status_code==200,response.text
        assert json.loads(response.json()['connection_config'])['headers']['Authorization']=='Bearer private'
        payload['connection_config']=json.dumps({'url':'https://api.example.test/new','headers':{'X-Key':'updated'}})
        response=await client.put(f'/sources/{sid}',json=payload);assert response.status_code==200,response.text
        response=await client.get(f'/sources/{sid}');assert json.loads(response.json()['connection_config'])['headers']=={'X-Key':'updated'}
        user['is_admin']=False
        assert (await client.get(f'/sources/{sid}')).status_code==403
        assert (await client.put(f'/sources/{sid}',json=payload)).status_code==403
        assert (await client.delete(f'/sources/{sid}')).status_code==403
        assert (await client.get(f'/sources/{sid}/preview')).status_code==403


@pytest.mark.asyncio
async def test_concurrent_import_retry_creates_one_batch(environment,monkeypatch):
    import asyncio
    from app.services.form_imports import execute
    db,factory,form,user,client=environment
    if db.bind.dialect.name!='postgresql':pytest.skip('Concurrency verified on disposable PostgreSQL')
    await publish(db,form,user,client,monkeypatch,{})
    async def write():
        async with factory() as fresh:
            return await execute(fresh,user,1,'rows.csv',b'title,qty\nOne,1\nTwo,2',{'0':'title','1':'qty'},'concurrency-test-01',1)
    one,two=await asyncio.gather(write(),write())
    assert one['record_ids']==two['record_ids']
    assert sorted([one['replayed'],two['replayed']])==[False,True]
    assert (await records.list_records(1,db,user))['total']==2

@pytest.mark.asyncio
async def test_import_external_options_read_once_per_batch(environment,monkeypatch):
    db,_,form,user,client=environment
    db.add(DataSource(id=1,tenant_id=1,name='API',source_type='api',connection_config='{}'))
    fetch=AsyncMock(return_value={'data':[{'id':'A','name':'Alpha'}]});monkeypatch.setattr(sources,'fetch_json',fetch)
    await publish(db,form,user,client,monkeypatch,{'formDesignerControls':[{'id':'api','fieldKey':'secret','controlType':'select','dataSourceKind':'externalApi','optionSource':'1'}]})
    fetch.reset_mock()
    response=await client.post('/forms/1/imports',data={'mapping':json.dumps({'0':'title','1':'secret'}),'request_key':'external-cache-0001','schema_version':'1'},files={'file':('rows.csv',b'title,secret\nOne,A\nTwo,A\n')})
    assert response.status_code==200,response.text
    assert fetch.await_count==1

@pytest.mark.asyncio
async def test_numeric_external_ids_roundtrip_in_enum_storage(environment,monkeypatch):
    db,factory,form,user,client=environment
    field=await db.scalar(select(FormField).where(FormField.form_id==1,FormField.field_name=='secret'));field.field_type='enum';field.enum_values={'values':['old']}
    db.add(DataSource(id=1,tenant_id=1,name='Numeric API',source_type='api',connection_config='{}'))
    monkeypatch.setattr(sources,'fetch_json',AsyncMock(return_value={'data':[{'id':7.0,'name':'Seven'}]}))
    await publish(db,form,user,client,monkeypatch,{'formDesignerControls':[{'id':'api','fieldKey':'secret','controlType':'select','dataSourceKind':'externalApi','optionSource':'1'}]})
    response=await client.post('/forms/1/records',json={'data':{'title':'Numeric','secret':7}});assert response.status_code==200,response.text
    rid=response.json()['data']['id']
    async with factory() as fresh:
        record=(await records.get_record(1,rid,fresh,user))['data']
        assert record['data']['secret']=='7'

@pytest.mark.asyncio
async def test_import_required_and_utf8_byte_limits_roll_back(environment,monkeypatch):
    db,_,form,user,client=environment
    secret=await db.scalar(select(FormField).where(FormField.form_id==1,FormField.field_name=='secret'));secret.validation={'maxBytes':4}
    await publish(db,form,user,client,monkeypatch,{})
    for key,content in [('bytes-test-0000001','title,secret\nFirst,OK\nSecond,中文三\n'.encode()),('required-test-0001',b'title,secret\nFirst,OK\n,NO\n')]:
        response=await client.post('/forms/1/imports',data={'mapping':json.dumps({'0':'title','1':'secret'}),'request_key':key,'schema_version':'1'},files={'file':('rows.csv',content)})
        assert response.status_code==422,response.text
        assert response.json()['detail']['row']==3
        assert (await records.list_records(1,db,user))['total']==0
