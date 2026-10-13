"""Record-level draft and approval lifecycle, independent of business data.status."""
import json
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, text
from app.api.deps import current_user_id
from app.models.relational import AuditLog, DynamicRecord, Form, WorkflowBinding, WorkflowInstance, User


def parsed(raw):
    try:
        return json.loads(raw or '{}') if isinstance(raw, str) else raw or {}
    except (ValueError, TypeError):
        return {}


async def enabled(db, form):
    if form.code in {'material-application', 'alert-center'}:
        return False
    return bool(await db.scalar(select(WorkflowBinding.id).where(
        WorkflowBinding.tenant_id == form.tenant_id, WorkflowBinding.form_id == form.id,
        WorkflowBinding.enabled == True, WorkflowBinding.trigger_action == 'submit').limit(1)))


async def events(db, form, record_id):
    return (await db.scalars(select(AuditLog).where(AuditLog.tenant_id == form.tenant_id,
        AuditLog.resource_type == f'form_application:{form.id}', AuditLog.resource_id == record_id)
        .order_by(AuditLog.id))).all()


async def audit(db, form, record_id, user, action, **detail):
    uid = current_user_id(user)
    actor = await db.scalar(select(User).where(User.id == uid, User.tenant_id == form.tenant_id))
    detail.update(action=action, actor_id=uid, actor_name=(actor.display_name or actor.username) if actor else str(uid),
        created_at=datetime.now(timezone.utc).isoformat())
    db.add(AuditLog(tenant_id=form.tenant_id, user_id=uid, action=action,
        resource_type=f'form_application:{form.id}', resource_id=record_id,
        new_values=json.dumps(detail, ensure_ascii=False)))
    await db.flush()


async def metadata(db, form, record, user):
    history = [parsed(row.new_values) for row in await events(db, form, record['id'])]
    if not history:
        return None
    status = record.get('status')
    owns = bool(user.get('is_admin') or record.get('created_by') == current_user_id(user))
    from app.core.permissions import evaluate_form_permission
    permission = await evaluate_form_permission(user, form.id, 'edit', db, record_data=record.get('data'))
    allowed = bool(permission.get('allowed'))
    editable = owns and allowed and status in {'draft', 'rejected'}
    submissions = [item for item in history if item.get('action') == 'submit']
    return {'status': status, 'can_edit': editable, 'can_submit': editable and await enabled(db, form),
        'workflow_id': submissions[-1].get('workflow_id') if submissions else None, 'history': history}


async def decorate(db, form, record, user):
    value = await metadata(db, form, record, user)
    if value is not None:
        record['_approval'] = value
    return record


async def locked_record(db, form, record_id):
    from app.api.forms import _uses_physical_form_table, _runtime_form_fields, _physical_record_payload
    if _uses_physical_form_table(form):
        from app.api._model_driven_shared import assert_safe_identifier
        table = str(form.table_name)
        assert_safe_identifier(table)
        suffix = ' FOR UPDATE' if db.bind.dialect.name != 'sqlite' else ''
        row = (await db.execute(text(f'SELECT * FROM {table} WHERE id = :id AND tenant_id = :tenant AND deleted_at IS NULL{suffix}'),
            {'id': record_id, 'tenant': form.tenant_id})).first()
        if row is None:
            raise HTTPException(404, 'Record not found')
        return _physical_record_payload(row, form, await _runtime_form_fields(db, form.tenant_id, form.id))
    from app.api.forms import _record_payload
    row = await db.scalar(select(DynamicRecord).where(DynamicRecord.id == record_id,
        DynamicRecord.form_id == form.id, DynamicRecord.tenant_id == form.tenant_id,
        DynamicRecord.deleted_at.is_(None)).with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, 'Record not found')
    return _record_payload(row)


async def set_status(db, form, record, status, user):
    from app.api.forms import _uses_physical_form_table
    if _uses_physical_form_table(form):
        from app.api._model_driven_shared import assert_safe_identifier
        table = str(form.table_name)
        assert_safe_identifier(table)
        await db.execute(text(f'UPDATE {table} SET record_status=:status, updated_by=:uid, updated_at=CURRENT_TIMESTAMP WHERE id=:id AND tenant_id=:tenant AND deleted_at IS NULL'),
            {'status': status, 'uid': current_user_id(user), 'id': record['id'], 'tenant': form.tenant_id})
    else:
        row = await db.get(DynamicRecord, record['id'])
        row.status = status
        row.updated_by = current_user_id(user)
    record['status'] = status
    await db.flush()


async def guard_edit(db, form, record, user, requested_status=None):
    value = await metadata(db, form, record, user)
    if value is None:
        return
    if requested_status is not None and requested_status != record['status']:
        raise HTTPException(409, '审批状态只能由提交和审批操作修改')
    if not value['can_edit']:
        raise HTTPException(403 if record['status'] in {'draft', 'rejected'} else 409, '当前申请不可修改')


async def sync_form_application_instance(db, inst, user, action, comment):
    variables = parsed(inst.workflow_state).get('variables') or {}
    form_id, record_id = variables.get('form_id'), variables.get('record_id')
    if not form_id or not record_id:
        return
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != inst.tenant_id:
        return
    history = [parsed(row.new_values) for row in await events(db, form, record_id)]
    submissions = [item for item in history if item.get('action') == 'submit']
    if not submissions:
        return
    if submissions[-1].get('workflow_id') != inst.id:
        raise HTTPException(409, '此申请已经重新提交，请处理最新审批')
    record = await locked_record(db, form, record_id)
    status = {'approved': 'approved', 'completed': 'approved', 'rejected': 'rejected'}.get(inst.status, 'pending')
    await set_status(db, form, record, status, user)
    await audit(db, form, record_id, user, action, comment=comment, status=status, workflow_id=inst.id)
