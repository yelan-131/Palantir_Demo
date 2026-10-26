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


async def metadata(db, form, record, user, *, cache=None):
    cache = cache if cache is not None else {}
    event_key = ('application_events', form.tenant_id, form.id, record['id'])
    rows = cache[event_key] if event_key in cache else await events(db, form, record['id'])
    history = [parsed(row.new_values) for row in rows]
    if not history:
        return None
    status = record.get('status')
    owns = bool(user.get('is_admin') or record.get('created_by') == current_user_id(user))
    from app.core.permissions import evaluate_form_permission
    editable = can_submit = False
    if owns and status in {'draft', 'rejected'}:
        permission = await evaluate_form_permission(user, form.id, 'edit', db, record_data=record.get('data'), cache=cache)
        editable = bool(permission.get('allowed'))
        if editable:
            from app.services.designer_permissions import role_configs
            configs=await role_configs(db,user,form,cache=cache)
            can_submit=not any((value.get('actions') or {}).get('submit') is False for value in configs)
            binding_key = ('approval_enabled', form.tenant_id, form.id)
            if binding_key not in cache:cache[binding_key] = await enabled(db, form)
            can_submit = can_submit and cache[binding_key]
    submissions = [item for item in history if item.get('action') == 'submit']
    return {'status': status, 'can_edit': editable, 'can_submit': editable and can_submit,
        'workflow_id': submissions[-1].get('workflow_id') if submissions else None, 'history': history}


async def decorate(db, form, record, user, *, cache=None):
    value = await metadata(db, form, record, user, cache=cache)
    if value is not None:
        record['_approval'] = value
    return record


async def decorate_records(db, form, records, user, *, cache=None):
    """Batch histories for already-authorized rows, preserving their full order."""
    if not records:
        return records
    cache = cache if cache is not None else {}
    # Chunk large exports to keep the bind count bounded on both DB adapters.
    for offset in range(0, len(records), 200):
        ids = {record['id'] for record in records[offset:offset + 200]}
        grouped = {record_id: [] for record_id in ids}
        rows = (await db.scalars(select(AuditLog).where(AuditLog.tenant_id == form.tenant_id,
            AuditLog.resource_type == f'form_application:{form.id}', AuditLog.resource_id.in_(ids))
            .order_by(AuditLog.id))).all()
        for row in rows:grouped[row.resource_id].append(row)
        for record_id, history in grouped.items():
            cache[('application_events', form.tenant_id, form.id, record_id)] = history
    for record in records:
        await decorate(db, form, record, user, cache=cache)
    return records


async def locked_record(db, form, record_id):
    from app.services.records import read_raw
    return await read_raw(db, form, record_id, lock=True)


async def set_status(db, form, record, status, user):
    from app.services.records import set_record_status
    return await set_record_status(db, form, record, status, user)


async def guard_edit(db, form, record, user, requested_status=None, *, cache=None):
    value = await metadata(db, form, record, user, cache=cache)
    if value is None:
        return
    if requested_status is not None and requested_status != record['status']:
        raise HTTPException(409, '审批状态只能由提交和审批操作修改')
    if not value['can_edit']:
        raise HTTPException(403 if record['status'] in {'draft', 'rejected'} else 409, '当前申请不可修改')
    return value


async def sync_form_application_instance(db, inst, user, action, comment):
    variables = parsed(inst.workflow_state).get('variables') or {}
    form_id, record_id = variables.get('form_id'), variables.get('record_id')
    if not form_id or not record_id:
        return
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != inst.tenant_id:
        return
    history = [parsed(row.new_values) for row in await events(db, form, record_id)]
    from app.services.designer_permissions import role_configs
    configs=await role_configs(db,user,form)
    can_submit=not any((value.get('actions') or {}).get('submit') is False for value in configs)
    submissions = [item for item in history if item.get('action') == 'submit']
    if not submissions:
        return
    if submissions[-1].get('workflow_id') != inst.id:
        raise HTTPException(409, '此申请已经重新提交，请处理最新审批')
    record = await locked_record(db, form, record_id)
    status = {'approved': 'approved', 'completed': 'approved', 'rejected': 'rejected'}.get(inst.status, 'pending')
    await set_status(db, form, record, status, user)
    await audit(db, form, record_id, user, action, comment=comment, status=status, workflow_id=inst.id)
