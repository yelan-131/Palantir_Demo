"""Explicit material-request lifecycle; approval never creates master material data."""
import json
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, text
from app.models.relational import AuditLog, DynamicRecord, Form, User, WorkflowInstance, WorkflowApproval, WorkflowDef, WorkflowDefVersion
from app.api.deps import current_user_id

STATUS_LABELS = {'draft': '待提交', 'pending': '待审批', 'approved': '已通过', 'rejected': '已驳回'}


def normalize_status(value):
    return {**{v: k for k, v in STATUS_LABELS.items()}, **{k: k for k in STATUS_LABELS}}.get(value, 'draft')


def require_transition(record, expected, action):
    if record['data'].get('migration_marker'):
        raise HTTPException(403, '历史申请快照只读，请在原审批流程处理')
    status = normalize_status(record['data'].get('status'))
    if status != expected:
        raise HTTPException(409, '申请状态已变化，请刷新后重试')
    if status not in ({'draft', 'rejected'} if action == 'submit' else {'pending'}):
        raise HTTPException(409, '当前状态不允许此操作')
    return status


async def write_data(db, form, record, changes, actor_id):
    from app.services.records import write_fields
    # Material domain endpoints verify applicant/approver transitions before this
    # internal write. Workflow-owned status fields are not user-editable fields.
    return await write_fields(db, form, record, changes,
        user={"uid": actor_id, "tenant_id": form.tenant_id}, system=True)


async def audit(db, form, record_id, user, action, **detail):
    uid = current_user_id(user)
    actor = await db.scalar(select(User).where(User.id == uid, User.tenant_id == form.tenant_id))
    detail.update(action=action, actor_id=uid, actor_name=(actor.display_name or actor.username) if actor else str(uid),
                  created_at=datetime.now(timezone.utc).isoformat())
    db.add(AuditLog(tenant_id=form.tenant_id, user_id=uid, action=action,
                    resource_type=f'material:{form.id}', resource_id=record_id,
                    new_values=json.dumps(detail, ensure_ascii=False)))


async def latest_instance(db, form, record_id, lock=False):
    # Only the latest submission is actionable; previous rounds remain history.
    events = (await db.scalars(select(AuditLog).where(AuditLog.tenant_id == form.tenant_id,
        AuditLog.resource_type == f'material:{form.id}', AuditLog.resource_id == record_id).order_by(AuditLog.id.desc()))).all()
    for event in events:
        detail = json.loads(event.new_values or '{}')
        if detail.get('action') == 'submit' and detail.get('workflow_id'):
            query = select(WorkflowInstance).where(WorkflowInstance.id == detail['workflow_id'], WorkflowInstance.tenant_id == form.tenant_id)
            return await db.scalar(query.with_for_update() if lock else query)
    return None


async def sync_material_instance(db, inst, user=None, action=None, comment=None):
    """Hook called by the workflow engine inside its existing transaction."""
    state = json.loads(inst.workflow_state or '{}')
    variables = state.get('variables') or {}
    if variables.get('form_code') != 'material-application' or variables.get('trigger_action') != 'manual_submit':
        return
    form = await db.scalar(select(Form).where(Form.id == variables.get('form_id'), Form.tenant_id == inst.tenant_id))
    definition = await db.scalar(select(WorkflowDef).where(WorkflowDef.id == inst.workflow_id, WorkflowDef.tenant_id == inst.tenant_id))
    snapshot = await db.scalar(select(WorkflowDefVersion).where(WorkflowDefVersion.workflow_id == inst.workflow_id, WorkflowDefVersion.version == inst.workflow_version, WorkflowDefVersion.tenant_id == inst.tenant_id))
    if not form or form.code != 'material-application' or not definition or not snapshot or json.loads(snapshot.config or '{}').get('domainCode') != 'material-application-approval':
        raise HTTPException(409, '申请表单已不存在')
    if action == 'reject' and not str(comment or '').strip():
        raise HTTPException(422, '驳回时必须填写原因')
    from app.api.alerts import _records
    from app.services.form_runtime import _runtime_form_fields
    fields = await _runtime_form_fields(db, inst.tenant_id, form.id)
    records = await _records(db, form, fields, None, variables.get('record_id'), lock=True)
    if not records or records[0]['data'].get('migration_marker'):
        raise HTTPException(409, '申请不存在或为只读历史快照')
    latest = await latest_instance(db, form, records[0]['id'])
    if not latest or latest.id != inst.id:
        raise HTTPException(409, '此审批已不是申请的最新提交')
    before = normalize_status(records[0]['data'].get('status'))
    status = inst.status if inst.status in STATUS_LABELS else 'pending'
    await write_data(db, form, records[0], {'status': STATUS_LABELS[status], 'process_status': STATUS_LABELS[status]}, current_user_id(user or {}) or inst.initiator_id)
    if user and action:
        await audit(db, form, records[0]['id'], user, action, comment=comment, from_status=before, to_status=status, workflow_id=inst.id)
