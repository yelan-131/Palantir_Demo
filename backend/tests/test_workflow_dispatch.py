import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from tests.test_record_service import environment
from app.services import workflow_dispatch as delivery


def action(kind='form'):
    return {'enabled':True,'action':kind,'targetFormId':1,'endpoint':'https://receiver.example/hook',
            'fieldMappings':[{'sourceField':'title','targetField':'title'},{'sourceField':'qty','targetField':'qty'}]}


def instance(config=None):
    state={}
    delivery.enqueue(state,[{'node_id':'send','name':'下发','external_action':config or action()}],0,1)
    return SimpleNamespace(id=99,tenant_id=1,initiator_id=1,status='approved',
        form_data=json.dumps({'title':'Delivered','qty':5}),workflow_state=json.dumps(state))


def test_enqueue_is_idempotent_and_obeys_executed_range():
    state={}
    steps=[{'node_id':'one','external_action':action()},{'node_id':'two','external_action':action()}]
    delivery.enqueue(state,steps,0,1)
    delivery.enqueue(state,steps,0,1)
    assert len(state['dispatch_jobs'])==1
    assert state['dispatch_jobs'][0]['node_id']=='one'
    assert state['dispatch_pending'] is True


def test_publish_rejects_incomplete_or_unsupported_delivery():
    delivery.validate_actions({'nodes':[{'type':'serviceTask','externalAction':action()}]})
    for patch in ({'action':'message'},{'targetFormId':None},{'fieldMappings':[]},{'fieldMappings':[{'sourceField':'title'}]}):
        with pytest.raises(HTTPException):
            delivery.validate_actions({'nodes':[{'type':'serviceTask','externalAction':{**action(),**patch}}]})
    with pytest.raises(HTTPException):
        delivery.validate_actions({'nodes':[{'type':'userTask','externalAction':action()}]})


@pytest.mark.asyncio
async def test_internal_delivery_creates_one_draft_and_never_resubmits(environment):
    from app.services import records
    db,_,_,user,_=environment
    inst=instance()
    await delivery.process_instance(db,inst)
    job=json.loads(inst.workflow_state)['dispatch_jobs'][0]
    assert job['status']=='succeeded',job
    assert job['result']['record_status']=='draft'
    await delivery.process_instance(db,inst)
    rows=await records.list_records(1,db,{**user,'is_admin':True})
    assert rows['total']==1
    assert rows['data'][0]['data']['title']=='Delivered'


@pytest.mark.asyncio
async def test_target_tenant_failure_is_logged_without_creating_record(environment):
    from app.models.relational import Form
    db,_,_,_,_=environment
    db.add(Form(id=2,tenant_id=2,code='other',name='Other',status='published'))
    await db.flush()
    inst=instance({**action(),'targetFormId':2})
    await delivery.process_instance(db,inst)
    state=json.loads(inst.workflow_state)
    assert state['dispatch_jobs'][0]['status']=='failed'
    assert state['dispatch_pending'] is False


@pytest.mark.asyncio
async def test_external_delivery_sends_mapped_fields_and_stable_key(environment,monkeypatch):
    from urllib.parse import urlsplit
    from app.services import form_option_sources
    db,_,_,_,_=environment
    captured=[]
    async def validate(url):return urlsplit(url),'93.184.216.34'
    monkeypatch.setattr(form_option_sources,'validate_url',validate)
    class Client:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def stream(self,method,url,**kwargs):
            captured.append((method,url,kwargs))
            class Response:
                status_code=204
                async def __aenter__(self):return self
                async def __aexit__(self,*args):pass
            return Response()
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:Client())
    inst=instance(action('webhook'))
    await delivery.process_instance(db,inst)
    await delivery.process_instance(db,inst)
    assert len(captured)==1
    assert captured[0][2]['json']=={'title':'Delivered','qty':5}
    assert captured[0][2]['headers']['Idempotency-Key']=='workflow:1:99:send'
    assert captured[0][1].host=='93.184.216.34'


@pytest.mark.asyncio
async def test_approving_node_queues_only_reached_delivery(environment,monkeypatch):
    from app.api import workflow
    from app.models.relational import WorkflowDef,WorkflowInstance,WorkflowApproval
    db,_,_,user,_=environment
    config={'nodes':[{'id':'start','type':'startEvent'},{'id':'approval','type':'userTask','label':'审核'},
                     {'id':'send','type':'serviceTask','label':'下发','externalAction':action()}, {'id':'end','type':'endEvent'}],
            'edges':[{'id':'a','source':'start','target':'approval'},{'id':'b','source':'approval','target':'send'},{'id':'c','source':'send','target':'end'}]}
    definition=WorkflowDef(tenant_id=1,name='Delivery',config=json.dumps(config),status='published',version=1)
    db.add(definition);await db.flush()
    state={'current_step':1,'current_node':'approval','variables':{}}
    workflow._set_current_assignees(state,[1])
    inst=WorkflowInstance(tenant_id=1,workflow_id=definition.id,workflow_version=1,title='Approve then deliver',initiator_id=1,
                          status='pending',form_data=json.dumps({'title':'Delivered','qty':5}),workflow_state=json.dumps(state))
    db.add(inst);await db.flush()
    db.add(WorkflowApproval(instance_id=inst.id,approver_id=1,node_id='approval'));await db.commit()
    async def audit(**kwargs):pass
    monkeypatch.setattr(workflow,'write_audit_log',audit)
    await workflow._act_on_step(inst.id,workflow.StepApprovalRequest(),action='approve',user={**user,'is_admin':True},db=db)
    state=json.loads(inst.workflow_state)
    assert state['dispatch_pending']
    assert state['dispatch_jobs'][0]['node_id']=='send'
    assert state['dispatch_jobs'][0]['status']=='pending'


@pytest.mark.asyncio
async def test_failed_job_can_be_retried_and_history_hides_configuration(environment,monkeypatch):
    from app.api import workflow
    from app.models.relational import WorkflowDef,WorkflowInstance
    db,_,_,user,_=environment
    definition=WorkflowDef(tenant_id=1,name='Delivery',config='{}',status='published',version=1)
    db.add(definition);await db.flush()
    data=instance({**action(),'targetFormId':99999})
    inst=WorkflowInstance(tenant_id=1,workflow_id=definition.id,workflow_version=1,title='Failure',initiator_id=1,status='approved',form_data=data.form_data,workflow_state=data.workflow_state)
    db.add(inst);await db.commit()
    await delivery.process_instance(db,inst);await db.commit()
    assert json.loads(inst.workflow_state)['dispatch_jobs'][0]['status']=='failed'
    async def query(fn):return await fn(db)
    monkeypatch.setattr(workflow,'_try_db',query)
    actor={**user,'is_admin':True}
    history=await workflow.definition_dispatches(definition.id,actor)
    assert history['items'][0]['status']=='failed'
    assert 'action' not in history['items'][0]
    await workflow.retry_dispatch(inst.id,'send',actor)
    await delivery.process_instance(db,inst)
    assert json.loads(inst.workflow_state)['dispatch_jobs'][0]['attempts']==2
    with pytest.raises(HTTPException):
        await workflow.definition_dispatches(definition.id,{**actor,'tenant_id':2})


@pytest.mark.asyncio
async def test_cancelled_workflow_does_not_send_pending_job(environment):
    db,_,_,_,_=environment
    inst=instance();inst.status='cancelled'
    await delivery.process_instance(db,inst)
    job=json.loads(inst.workflow_state)['dispatch_jobs'][0]
    assert job['status']=='cancelled'
    assert job['attempts']==0
