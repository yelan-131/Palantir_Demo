"""Tenant scoped material applications with explicit submission and approval."""
import json
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, get_db, current_tenant_id, current_user_id
from app.api.forms import (_ensure_form_permission, _runtime_form_fields, _runtime_visible_field_names,
    _create_dynamic_record, DynamicRecordCreate, _start_form_workflows)
from app.api.alerts import _records
from app.core.permissions import allowed_form_fields, evaluate_form_permission, get_user_role_ids
from app.models.relational import Form, AuditLog, WorkflowApproval, WorkflowBinding, WorkflowDef, WorkflowDefVersion, User, ApplicationForm, ApplicationRole
from app.services.material_workflow import STATUS_LABELS, normalize_status, require_transition, write_data, audit, latest_instance
router = APIRouter()

class MaterialBody(BaseModel):
    part_no: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=500)

class MaterialEdit(MaterialBody):
    expected_status: Literal['draft', 'rejected']

class MaterialAction(BaseModel):
    expected_status: Literal['draft', 'pending', 'approved', 'rejected']
    comment: str = Field(default='', max_length=10000)

async def _context(db, user, action='view'):
    form = await db.scalar(select(Form).where(Form.tenant_id == current_tenant_id(user), Form.code == 'material-application'))
    if not form:
        raise HTTPException(404, '料号申请表单不存在')
    await _ensure_form_permission(db, user, form.id, action)
    fields = await _runtime_form_fields(db, form.tenant_id, form.id)
    visible = await _runtime_visible_field_names(user, form.id, fields, db)
    if not {'part_no','title','status'} <= visible:
        raise HTTPException(403, '缺少申请正文或状态的查看权限')
    return form, fields, visible

async def _can_view(db, form, record, user):
    from app.services.records import record_allowed
    return await record_allowed(db, user, form, 'view', record)

async def _record(db, user, record_id, action='view', lock=False):
    form, fields, visible = await _context(db, user, action)
    rows = await _records(db, form, fields, None, record_id, lock=lock)
    if not rows or not await _can_view(db, form, rows[0], user):
        raise HTTPException(404, '申请不存在或无权访问')
    return form, fields, visible, rows[0]

async def _present(db, form, record, user):
    data = record['data']
    legacy = bool(data.get('migration_marker'))
    events = (await db.scalars(select(AuditLog).where(AuditLog.tenant_id == form.tenant_id,
        AuditLog.resource_type == f'material:{form.id}', AuditLog.resource_id == record['id']).order_by(AuditLog.id))).all()
    history = [json.loads(e.new_values or '{}') for e in events]
    inst = await latest_instance(db, form, record['id']) if not legacy else None
    state = json.loads(inst.workflow_state or '{}') if inst else {}
    ids = state.get('current_assignees') or state.get('current_assignee_ids') or []
    ids = [int(i) for i in ids if isinstance(i, (int,str)) and str(i).isdigit()]
    actors = (await db.scalars(select(User).where(User.tenant_id == form.tenant_id, User.id.in_(ids)))).all() if ids else []
    status = 'legacy' if legacy else normalize_status(data.get('status'))
    owns = user.get('is_admin') or record.get('created_by') == current_user_id(user)
    can_edit = bool(owns and not legacy and status in {'draft','rejected'} and
        (await evaluate_form_permission(user, form.id, 'edit', db, record_data=data))['allowed'])
    can_approve = bool(not legacy and status == 'pending' and inst and
        (user.get('is_admin') or current_user_id(user) in ids))
    fields = await _runtime_form_fields(db, form.tenant_id, form.id)
    from app.services.records import policy_data
    visible = (await _runtime_visible_field_names(user, form.id, fields, db)) & await allowed_form_fields(
        user, form.id, 'view', fields, db, record_data=policy_data(record))
    return {**{k:data.get(k) for k in ('request_no','part_no','title','applicant','applied_at') if k in visible},
        'id':record['id'], 'created_by':record.get('created_by'), 'status':status,
        'legacy_status':data.get('status') if legacy else None, 'is_legacy':legacy,
        'approval_source':data.get('approval_source') if legacy else None,
        'workflow_id':inst.id if inst else None,'workflow_version':inst.workflow_version if inst else None,
        'current_assignees':[{'id':u.id,'name':u.display_name or u.username} for u in actors],
        'history':history,'can_edit':can_edit,'can_submit':can_edit,'can_approve':can_approve}

@router.get('')
async def list_material_applications(q: str='', status: str|None=None, page:int=Query(1,ge=1), page_size:int=Query(20,ge=1,le=200), db:AsyncSession=Depends(get_db), user:dict=Depends(get_current_user)):
    form, fields, visible = await _context(db,user)
    rows=[]
    for record in await _records(db,form,fields,None):
        if await _can_view(db,form,record,user):
            rows.append(await _present(db,form,record,user))
    rows=[r for r in rows if q.lower() in ' '.join(str(r.get(k) or '') for k in ('title','part_no','request_no','applicant')).lower()]
    counts={s:sum(r['status']==s for r in rows) for s in (*STATUS_LABELS,'legacy')}
    counts['all']=len(rows)
    selected=[r for r in rows if not status or r['status']==status]
    return {'data':selected[(page-1)*page_size:page*page_size],'total':len(selected),'counts':counts}

@router.get('/{record_id}')
async def get_material_application(record_id:int, db:AsyncSession=Depends(get_db), user:dict=Depends(get_current_user)):
    form, _, _, record=await _record(db,user,record_id)
    return {'data':await _present(db,form,record,user)}

async def _body_data(body,db,form,fields,user,action):
    data={k:v.strip() for k,v in body.model_dump(include={'part_no','title'}).items()}
    if not all(data.values()):
        raise HTTPException(422,'请填写料号与申请说明')
    if not set(data)<=await allowed_form_fields(user,form.id,action,fields,db):
        raise HTTPException(403,'缺少申请字段编辑权限')
    return data

@router.post('')
async def create_material_application(body:MaterialBody, db:AsyncSession=Depends(get_db), user:dict=Depends(get_current_user)):
    form,fields,_=await _context(db,user,'create')
    data=await _body_data(body,db,form,fields,user,'create')
    result=await _create_dynamic_record(form.id,DynamicRecordCreate(data=data),db,user,defer_commit=True)
    await audit(db,form,result['data']['id'],user,'create',to_status='draft')
    await db.commit()
    return await get_material_application(result['data']['id'],db,user)

@router.put('/{record_id}')
async def edit_material_application(record_id:int, body:MaterialEdit, db:AsyncSession=Depends(get_db), user:dict=Depends(get_current_user)):
    form,fields,_,record=await _record(db,user,record_id,'edit',True)
    require_transition(record,body.expected_status,'submit')
    presented=await _present(db,form,record,user)
    if not presented['can_edit']:
        raise HTTPException(403,'仅申请人或管理员可修改草稿、已驳回申请')
    data=await _body_data(body,db,form,fields,user,'edit')
    from app.services.records import write_fields
    await write_fields(db, form, record, data, user=user)
    await audit(db,form,record_id,user,'edit')
    await db.commit()
    return await get_material_application(record_id,db,user)

@router.post('/{record_id}/submit')
async def submit_material_application(record_id:int, body:MaterialAction, db:AsyncSession=Depends(get_db), user:dict=Depends(get_current_user)):
    form,fields,_,record=await _record(db,user,record_id,'edit',True)
    before=require_transition(record,body.expected_status,'submit')
    if not user.get('is_admin') and record.get('created_by')!=current_user_id(user):
        raise HTTPException(403,'仅申请人可提交申请')
    if not all(str(record['data'].get(k) or '').strip() for k in ('part_no','title')):
        raise HTTPException(422,'请填写完整料号与申请说明')
    bindings=(await db.scalars(select(WorkflowBinding).where(WorkflowBinding.tenant_id==form.tenant_id,WorkflowBinding.form_id==form.id,WorkflowBinding.trigger_action=='manual_submit',WorkflowBinding.enabled.is_(True)))).all()
    if len(bindings)!=1:
        raise HTTPException(409,'需要配置唯一有效的料号审批流程')
    definition=await db.scalar(select(WorkflowDef).where(WorkflowDef.id==bindings[0].workflow_id,WorkflowDef.tenant_id==form.tenant_id).with_for_update())
    if not definition or definition.status not in {'published','active'}:
        raise HTTPException(409,'审批流程尚未发布')
    version=await db.scalar(select(WorkflowDefVersion).where(WorkflowDefVersion.workflow_id==definition.id,WorkflowDefVersion.version==definition.version,WorkflowDefVersion.tenant_id==form.tenant_id))
    if not version or json.loads(version.config or '{}')!=json.loads(definition.config or '{}'):
        raise HTTPException(409,'审批流程版本未发布，请先发布配置')
    config=json.loads(version.config or '{}')
    if config.get('domainCode')!='material-application-approval':
        raise HTTPException(409,'绑定的流程不是料号审批流程')
    started=await _start_form_workflows(db,tenant_id=form.tenant_id,form=form,record_payload=record,user=user,trigger_action='manual_submit')
    if len(started)!=1 or not started[0].get('approver_ids'):
        raise HTTPException(409,'审批流程未指定有效审批人')
    await write_data(db,form,record,{'status':'待审批','process_status':'待审批'},current_user_id(user))
    await audit(db,form,record_id,user,'submit',from_status=before,to_status='pending',workflow_id=started[0]['instance_id'],workflow_version=definition.version)
    await db.commit()
    return await get_material_application(record_id,db,user)

async def _act(record_id,body,db,user,action):
    form,_,_,record=await _record(db,user,record_id,'view',True)
    require_transition(record,body.expected_status,action)
    inst=await latest_instance(db,form,record_id,lock=True)
    if not inst:
        raise HTTPException(409,'此申请尚未绑定审批流程')
    if action=='reject' and not body.comment.strip():
        raise HTTPException(422,'驳回时必须填写原因')
    presented=await _present(db,form,record,user)
    if not presented['can_approve']:
        raise HTTPException(403,'仅当前指定审批人或管理员可审批')
    from app.api.workflow import _act_on_step, StepApprovalRequest
    await _act_on_step(inst.id,StepApprovalRequest(comment=body.comment.strip()),action,user=user,db=db)
    await db.commit()
    return await get_material_application(record_id,db,user)

@router.post('/{record_id}/approve')
async def approve_material_application(record_id:int,body:MaterialAction,db:AsyncSession=Depends(get_db),user:dict=Depends(get_current_user)):
    return await _act(record_id,body,db,user,'approve')

@router.post('/{record_id}/reject')
async def reject_material_application(record_id:int,body:MaterialAction,db:AsyncSession=Depends(get_db),user:dict=Depends(get_current_user)):
    return await _act(record_id,body,db,user,'reject')
