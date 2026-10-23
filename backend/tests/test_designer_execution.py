"""Designer settings must survive publication and execute on fresh runtime reads."""
import copy
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import select
from tests.test_record_service import environment, seed
from app.api import forms
from app.models.relational import Form, FormField, FormPermission, User
from app.services import records


@pytest.mark.asyncio
async def test_permissions_are_drafts_until_publish_and_restore_is_real(environment,monkeypatch):
    db,factory,form,user,client=environment
    monkeypatch.setattr(forms,'write_audit_log',AsyncMock())
    own=await seed(db,'Own',uid=1);await seed(db,'Other',uid=2)
    draft={'roles':{'reader':{'actions':{'view':True,'create':True,'edit':True,'export':True,'saveDraft':False,'submit':False},'fields':{'title':{'visible':True,'editable':True,'required':True}},'data':{'scope':'assigned','sensitiveFields':'full'}}}}
    form.config={'permissionDesignDraft':draft,'viewConfigDraft':{'filters':[],'table':{'columns':[{'id':'title','fieldName':'title','enabled':True}],'rowClickAction':'none'}}}
    await db.commit()
    assert (await records.list_records(1,db,user))['total']==2
    before=(await db.scalars(select(FormPermission).where(FormPermission.form_id==1))).all()
    user['is_admin']=True
    response=await client.post('/forms/1/publish');assert response.status_code==200,response.text
    user['is_admin']=False
    await db.refresh(form)
    assert (await records.list_records(1,db,user))['total']==1
    assert form.config['permissionDesign']==draft
    assert len((await db.scalars(select(FormPermission).where(FormPermission.form_id==1))).all())>len(before)
    response=await client.get('/forms/1?schema=published&scope=list');assert response.status_code==200,response.text
    assert response.json()['data']['runtime_permissions']['saveDraft'] is False
    # Fresh database session checks persisted active scope, not in-memory editor state.
    async with factory() as fresh:
        assert (await records.list_records(1,fresh,user))['total']==1
    user['is_admin']=True
    changed=copy.deepcopy(form.config);changed['viewConfigDraft']['table']['rowClickAction']='edit';changed['permissionDesignDraft']['roles']['reader']['data']['scope']='all';changed['workflowDesigner']={'draftWorkflowId':987,'publishedWorkflowId':654};form.config=changed;await db.commit()
    response=await client.post('/forms/1/draft/restore');assert response.status_code==200,response.text
    await db.refresh(form)
    assert form.config['viewConfigDraft']['table']['rowClickAction']=='none'
    assert form.config['permissionDesignDraft']==draft
    assert 'draftWorkflowId' not in (form.config.get('workflowDesigner') or {})
    assert len((await db.scalars(select(FormField).where(FormField.form_id==1))).all())==4
    user['is_admin']=False
    assert (await records.get_record(1,own['id'],db,user))['data']['data']['title']=='Own'


@pytest.mark.asyncio
async def test_export_uses_published_field_and_row_permissions(environment):
    db,_,form,user,client=environment
    await seed(db,'=FORMULA',uid=1);await seed(db,'Other',uid=2)
    form.config={'permissionDesign':{'roles':{'reader':{'data':{'scope':'assigned'},'actions':{'export':True}}}}}
    db.add(FormPermission(tenant_id=1,form_id=1,role_id=1,action='export',field_name='secret',effect='deny'))
    await db.commit()
    response=await client.get('/forms/1/records-export')
    assert response.status_code==200,response.text
    assert "'=FORMULA" in response.text
    assert 'Other' not in response.text and 'private' not in response.text


@pytest.mark.asyncio
async def test_organization_source_label_and_type_settings_survive_publish(environment,monkeypatch):
    db,_,form,user,client=environment
    monkeypatch.setattr(forms,'write_audit_log',AsyncMock())
    person=await db.get(User,2);person.display_name='Test Person'
    field=await db.scalar(select(FormField).where(FormField.form_id==1,FormField.field_name=='secret'))
    field.validation={'maxBytes':64}
    form.config={'formDesignerControls':[{'id':'person','source':'field','fieldKey':'secret','controlType':'select','name':'联系人','dataSourceKind':'organization','optionSource':'users','referenceLabelField':'username','assignmentRules':[{'targetField':'title','sourceAttribute':'record.username'},{'targetField':'status','sourceAttribute':'self.option_label'}],'typeSettings':{'selectionMode':'single','displayMode':'dropdown','allowClear':False}}]}
    await db.commit();await db.refresh(form);await db.refresh(field);user['is_admin']=True
    response=await client.post('/forms/1/publish');assert response.status_code==200,response.text
    await db.refresh(form)
    response=await client.get('/forms/1?schema=published&scope=designer');assert response.status_code==200,response.text
    saved=next(f for f in response.json()['data']['fields'] if f['field_name']=='secret')
    assert saved['validation']['maxBytes']==64
    assert saved['ui_config']['relation_config']['label_field']=='username'
    assert saved['ui_config']['typeSettings']['allowClear'] is False
    preview_controls=copy.deepcopy(form.config['formDesignerControls']);preview_controls[0]['referenceLabelField']='display_name'
    response=await client.post('/forms/1/fields/secret/options/preview',json={'controls':preview_controls,'data':{}});assert response.status_code==200,response.text
    assert any(item['label']=='Test Person' for item in response.json()['data'])
    user['is_admin']=False
    response=await client.post('/forms/1/fields/secret/options/preview',json={'controls':preview_controls,'data':{}});assert response.status_code==403,response.text
    user['is_admin']=True
    response=await client.post('/forms/1/fields/secret/options',json={'data':{}});assert response.status_code==200,response.text
    assert any(item['label']=='user2' for item in response.json()['data'])
    response=await client.post('/forms/1/records',json={'data':{'title':'Reference','secret':2,'qty':4}});assert response.status_code==200,response.text
    rid=response.json()['data']['id']
    response=await client.get(f'/forms/1/records/{rid}');assert response.status_code==200,response.text
    assert response.json()['data']['data']['secret']=='2'
    assert response.json()['data']['data']['title']==response.json()['data']['data']['status']=='user2'


@pytest.mark.asyncio
async def test_statistics_denial_does_not_block_business_page_and_draft_analytics_stays_inactive(environment):
    db,_,form,user,client=environment
    await seed(db,'Allowed')
    form.config={'assemblyKind':'business','permissionDesign':{'roles':{'reader':{'data':{'scope':'all','ownership':{'statistics':False}}}}},'analyticsDesignDraft':{'widgets':[{'id':'draft-only'}]}}
    await db.commit();await db.refresh(form)
    response=await client.get('/dashboard/programs/record-contract')
    assert response.status_code==200,response.text
    result=response.json()
    assert len(result['rows'])==1 and result['metrics']==[]
    assert result['analyticsDesign'] is None and result['analyticsData'] is None

@pytest.mark.asyncio
async def test_role_required_and_hidden_fields_are_server_enforced(environment):
    db,_,form,user,client=environment
    form.config={'permissionDesign':{'roles':{'reader':{'fields':{'qty':{'required':True},'secret':{'visible':False}},'data':{'scope':'all'}}}}}
    await db.commit();await db.refresh(form)
    response=await client.post('/forms/1/records',json={'data':{'title':'Required'}})
    assert response.status_code==422,response.text
    response=await client.post('/forms/1/records',json={'data':{'title':'Hidden','secret':'forbidden','qty':3}})
    assert response.status_code==403,response.text
    row=await seed(db,'Visible')
    response=await client.get(f"/forms/1/records/{row['id']}")
    assert response.status_code==200,response.text
    assert 'secret' not in response.json()['data']['data']
