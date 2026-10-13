"""Material lifecycle guards, isolated from the business database."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.services.material_workflow import normalize_status, require_transition

@pytest.mark.parametrize('value,status', [('待提交','draft'),('待审批','pending'),('已通过','approved'),('已驳回','rejected')])
def test_status_labels(value,status):
    assert normalize_status(value)==status

@pytest.mark.parametrize('status,action',[('draft','approve'),('pending','submit'),('approved','reject'),('approved','submit')])
def test_invalid_lifecycle(status,action):
    with pytest.raises(HTTPException) as error:
        require_transition({'data':{'status':status}},status,action)
    assert error.value.status_code==409

def test_stale_status_rejected():
    with pytest.raises(HTTPException) as error:
        require_transition({'data':{'status':'已驳回'}},'pending','approve')
    assert error.value.status_code==409

def test_legacy_readonly():
    with pytest.raises(HTTPException) as error:
        require_transition({'data':{'status':'待提交','migration_marker':'alert-material-split-v1'}},'draft','submit')
    assert error.value.status_code==403

@pytest.mark.asyncio
async def test_submit_cannot_impersonate_applicant(monkeypatch):
    from app.api import material_applications as api
    form=SimpleNamespace(id=1,tenant_id=1)
    db=SimpleNamespace(commit=AsyncMock(),execute=AsyncMock())
    monkeypatch.setattr(api,'_record',AsyncMock(return_value=(form,[],set(),{'id':1,'created_by':9,'data':{'status':'draft'}})))
    with pytest.raises(HTTPException) as error:
        await api.submit_material_application(1,api.MaterialAction(expected_status='draft'),db,{'uid':7,'tenant_id':1})
    assert error.value.status_code==403
    db.commit.assert_not_awaited()

@pytest.mark.asyncio
async def test_reject_requires_reason(monkeypatch):
    from app.api import material_applications as api
    form=SimpleNamespace(id=1,tenant_id=1)
    db=SimpleNamespace(commit=AsyncMock())
    monkeypatch.setattr(api,'_record',AsyncMock(return_value=(form,[],set(),{'id':1,'created_by':7,'data':{'status':'pending'}})))
    monkeypatch.setattr(api,'latest_instance',AsyncMock(return_value=SimpleNamespace(id=99)))
    with pytest.raises(HTTPException) as error:
        await api.reject_material_application(1,api.MaterialAction(expected_status='pending',comment='  '),db,{'uid':7,'tenant_id':1})
    assert error.value.status_code==422
    db.commit.assert_not_awaited()

@pytest.mark.asyncio
async def test_workflow_sync_ignores_other_domains():
    from app.services.material_workflow import sync_material_instance
    db=SimpleNamespace(scalar=AsyncMock())
    await sync_material_instance(db,SimpleNamespace(workflow_state='{}'))
    db.scalar.assert_not_awaited()

@pytest.mark.asyncio
async def test_real_sqlite_submit_reject_resubmit_approve(tmp_path,monkeypatch):
    import json
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.relational import Base,Tenant,User,Form,FormField,DynamicRecord,WorkflowDef,WorkflowDefVersion,WorkflowBinding,WorkflowInstance
    from app.api import material_applications as api
    from app.api import workflow
    engine=create_async_engine('sqlite+aiosqlite:///'+str(tmp_path/'material.db'))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    async with sessions() as db:
        db.add(Tenant(id=1,name='test',slug='test'))
        db.add(User(id=1,tenant_id=1,username='applicant',hashed_password='test',is_admin=True))
        db.add(User(id=2,tenant_id=1,username='approver',hashed_password='test',is_admin=True))
        form=Form(id=1,tenant_id=1,name='料号申请',code='material-application',storage_mode='dynamic')
        db.add(form)
        for name in ['title','part_no','status','request_no','applicant','applied_at','process_status','migration_marker','approval_source']:
            db.add(FormField(tenant_id=1,form_id=1,field_name=name,label=name,field_type='string'))
        config={'domainCode':'material-application-approval','steps':[{'type':'start','name':'start'},
            {'type':'approval','name':'审核','node_id':'review','assignee_rules':[{'type':'user','value':['2']}]},{'type':'end','name':'end'}]}
        config=json.dumps(config,ensure_ascii=False)
        db.add(WorkflowDef(id=1,tenant_id=1,name='审批',config=config,status='published',version=1))
        db.add(WorkflowDefVersion(tenant_id=1,workflow_id=1,version=1,config=config,status='published'))
        db.add(WorkflowBinding(tenant_id=1,form_id=1,workflow_id=1,trigger_action='manual_submit',enabled=True))

        await db.commit()
        applicant={'uid':1,'tenant_id':1,'is_admin':True}
        approver={'uid':2,'tenant_id':1,'is_admin':True}
        # Keep generic audit isolated in this in-memory fixture; real material audit is asserted below.
        monkeypatch.setattr(workflow,'write_audit_log',AsyncMock())
        created=await api.create_material_application(api.MaterialBody(title='申请测试',part_no='MAT-1'),db,applicant)
        assert created['data']['status']=='draft'
        assert not created['data']['workflow_id']
        visible_helper = api._runtime_visible_field_names
        monkeypatch.setattr(api, '_runtime_visible_field_names', AsyncMock(return_value={'title', 'part_no', 'status'}))
        masked = await api.get_material_application(1, db, applicant)
        assert masked['data'].get('request_no') is None
        assert masked['data'].get('applicant') is None
        assert masked['data'].get('applied_at') is None
        monkeypatch.setattr(api, '_runtime_visible_field_names', visible_helper)
        first=await api.submit_material_application(1,api.MaterialAction(expected_status='draft'),db,applicant)
        assert first['data']['status']=='pending'
        assert first['data']['current_assignees']==[{'id':2,'name':'approver'}]
        first_id=first['data']['workflow_id']
        # Generic workflow route must honor material form permissions as well.
        original_record = api._record
        monkeypatch.setattr(api, '_record', AsyncMock(side_effect=HTTPException(403, 'Form permission denied')))
        with pytest.raises(HTTPException) as denied:
            await workflow._act_on_step(first_id, workflow.StepApprovalRequest(comment='同意'), 'approve', user=approver, db=db)
        assert denied.value.status_code == 403
        monkeypatch.setattr(api, '_record', original_record)
        rejected=await api.reject_material_application(1,api.MaterialAction(expected_status='pending',comment='信息缺失'),db,approver)
        assert rejected['data']['status']=='rejected'
        await api.edit_material_application(1,api.MaterialEdit(title='补充申请',part_no='MAT-1',expected_status='rejected'),db,applicant)
        second=await api.submit_material_application(1,api.MaterialAction(expected_status='rejected'),db,applicant)
        assert second['data']['workflow_id']!=first_id
        approved=await api.approve_material_application(1,api.MaterialAction(expected_status='pending',comment='同意'),db,approver)
        assert approved['data']['status']=='approved'
        assert [h['action'] for h in approved['data']['history']]==['create','submit','reject','edit','submit','approve']
        assert (await db.get(WorkflowInstance,first_id)).status=='rejected'
        # A preloaded ORM instance may be stale after waiting on another lock.
        # The locked query must refresh it before deciding whether it is actionable.
        from sqlalchemy.orm.attributes import set_committed_value
        completed = await db.get(WorkflowInstance, second['data']['workflow_id'])
        set_committed_value(completed, 'status', 'pending')
        with pytest.raises(HTTPException) as completed_error:
            await workflow._act_on_step(completed.id, workflow.StepApprovalRequest(comment='重复批准'), 'approve', user=approver, db=db)
        assert completed_error.value.status_code == 409
        assert completed.status == 'approved'
        with pytest.raises(HTTPException) as error:
            await api.submit_material_application(1,api.MaterialAction(expected_status='pending'),db,applicant)
        assert error.value.status_code==409
    await engine.dispose()
