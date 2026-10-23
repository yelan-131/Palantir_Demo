from types import SimpleNamespace
import pytest
from sqlalchemy import select
from fastapi import HTTPException
from tests.test_record_service import environment
from app.models.relational import Material, Form, FormField, FormPermission, DynamicRecord, RolePermission
from app.services.option_search import search, schema, range_matches, match_fields
from app.services.form_rules import archive_options
from app.api import forms


def ref(config, target='materials'):
    return SimpleNamespace(field_name='secret', label='选择项', field_type='string', enum_values=None,
        ui_config={'typeSettings': {'search': config}, 'relation_config': {'target_model': target, 'label_field': 'name'}})


def test_keyword_modes_and_missing_dependencies_and_false_values():
    values={'name':'Mat_100%', 'code':'AB-007', 'active':False}
    assert match_fields(values,['name','code'],'ab-','prefix')==['code']
    assert match_fields(values,['name'],'MAT_100%','exact')==['name']
    assert not match_fields(values,['name'],'Mat','exact')
    spec={'filters':[{'field':'active','operator':'eq','source':'field','sourceField':'flag'}]}
    assert not range_matches(values,spec,{})
    assert range_matches(values,spec,{'flag':False})


@pytest.mark.asyncio
async def test_builtin_searches_past_old_cap_literal_wildcards_scope_and_paging(environment):
    db,_,_,user,_=environment
    db.add_all([Material(tenant_id=1,name=f'Mat-{i:03}',material_type='A',specs='shared',unit='件') for i in range(230)])
    db.add(Material(tenant_id=1,name='LAST_100%',material_type='A',specs='unique-spec',unit='件'))
    db.add(Material(tenant_id=2,name='Private_100%',material_type='A',unit='件'))
    await db.commit()
    field=ref({'fields':['name','specs'],'match':'contains','filters':[{'field':'unit','operator':'eq','source':'field','sourceField':'title'}]})
    assert not (await search(db,user,field,{},context_fields={'title'}))['data']
    result=await search(db,user,field,{'title':'件'},keyword='unique-spec',context_fields={'title'})
    assert [row['label'] for row in result['data']]==['LAST_100%']
    assert result['data'][0]['matchedFields']==['specs']
    assert [row['label'] for row in (await search(db,user,field,{'title':'件'},keyword='_100%',context_fields={'title'}))['data']]==['LAST_100%']
    first=await search(db,user,field,{'title':'件'},keyword='Mat-',page_size=20,context_fields={'title'})
    second=await search(db,user,field,{'title':'件'},keyword='Mat-',page=2,page_size=20,context_fields={'title'})
    assert first['has_more'] and len(first['data'])==20
    assert not {row['id'] for row in first['data']} & {row['id'] for row in second['data']}
    selected=result['data'][0]['id']
    numeric=ref({'fields':['name'],'filters':[{'field':'id','operator':'eq','value':str(selected)+'.0'}]})
    assert [row['id'] for row in (await search(db,user,numeric,{}))['data']]==[selected]
    assert (await search(db,user,field,{'title':'箱'},selected=selected,context_fields={'title'}))['data']==[]
    assert not await archive_options(db,user,field,{'title':'箱'},selected=selected)
    with pytest.raises(HTTPException): await search(db,user,ref({'fields':['tenant_id']}),{})
    with pytest.raises(HTTPException): await search(db,user,field,{'title':'件'},context_fields={'other'})


@pytest.mark.asyncio
async def test_business_search_applies_row_and_field_permissions_before_results(environment):
    db,_,_,user,client=environment
    db.add(Form(id=2,tenant_id=1,name='目录',code='catalog-search',status='published'))
    await db.flush()
    db.add_all([FormField(tenant_id=1,form_id=2,field_name='name',label='名称',field_type='string'),
        FormField(tenant_id=1,form_id=2,field_name='status',label='状态',field_type='string'),
        FormPermission(tenant_id=1,form_id=2,role_id=1,action='*',effect='allow')])
    db.add_all([DynamicRecord(tenant_id=1,form_id=2,data={'name':f'Catalog-{i:03}','status':'启用'},created_by=1) for i in range(230)])
    db.add(DynamicRecord(tenant_id=1,form_id=2,data={'name':'Blocked','status':'启用'},created_by=1))
    db.add(RolePermission(tenant_id=1,role_id=1,resource_type='form',resource_key='2',action='view',effect='deny',condition_json={'rules':[{'field':'name','op':'equals','value':'Blocked'}]}))
    owner=FormField(tenant_id=1,form_id=1,field_name='choice',label='目录',field_type='string',ui_config=ref({'fields':['name'],'match':'exact','filters':[{'field':'status','operator':'eq','source':'fixed','value':'启用'}]},'catalog-search').ui_config)
    db.add(owner);await db.commit()
    response=await client.post('/forms/1/fields/choice/options',json={'data':{},'query':'Catalog-229','page':1})
    assert response.status_code==200,response.text
    assert [row['label'] for row in response.json()['data']]==['Catalog-229']
    response=await client.post('/forms/1/fields/choice/options',json={'data':{},'query':'Blocked','page':1})
    assert response.status_code==200 and not response.json()['data']
    db.add(FormPermission(tenant_id=1,form_id=2,role_id=1,action='view',field_name='status',effect='deny'));await db.commit()
    assert 'status' not in {item['value'] for item in (await schema(db,user,owner))['fields']}
    response=await client.post('/forms/1/fields/choice/options',json={'data':{},'query':'Catalog','page':1})
    assert response.status_code==403,response.text


@pytest.mark.asyncio
async def test_static_preview_search_config_roundtrip_paging_and_validation(environment):
    _,_,_,user,client=environment;user['is_admin']=True
    control={'id':'status','fieldKey':'status','controlType':'select','dataSourceKind':'static','optionSource':','.join(f'状态{i:03}' for i in range(50)),
        'typeSettings':{'displayMode':'search','search':{'fields':['label'],'match':'prefix','filters':[]}}}
    response=await client.post('/forms/1/fields/status/options/schema/preview',json={'controls':[control]})
    assert response.status_code==200 and response.json()['data']['kind']=='static'
    response=await client.post('/forms/1/fields/status/options/preview',json={'controls':[control],'page':2,'page_size':20,'query':'状态'})
    assert response.status_code==200,response.text
    assert len(response.json()['data'])==20 and response.json()['data'][0]['label']=='状态020' and response.json()['has_more']
    response=await client.post('/forms/1/fields/status/options/preview',json={'controls':[control],'query':'状态001','page':1})
    assert [item['label'] for item in response.json()['data']]==['状态001']
    assert (await client.post('/forms/1/fields/status/options/preview',json={'controls':[control],'page':0})).status_code==422
    control['typeSettings']['search']['fields']=['password']
    assert (await client.post('/forms/1/fields/status/options/preview',json={'controls':[control],'page':1})).status_code==403


def test_range_numeric_equality_and_schema_validation():
    from app.services.option_search import validate
    assert range_matches({'id':1},{'filters':[{'field':'id','operator':'eq','value':'1.0'}]}, {})
    for settings in [{'match':'sql'}, {'fields':['name']*9}, {'filters':[{'field':'name','operator':'eval','value':'x'}]}]:
        with pytest.raises(HTTPException): validate(settings)
