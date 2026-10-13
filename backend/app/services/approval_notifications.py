"""Transactional, stage-deduplicated in-app approval notifications."""
from urllib.parse import quote, parse_qs, urlparse
from sqlalchemy import select
from app.models.relational import Notification, User, WorkflowInstance
from app.api.deps import current_tenant_id


def _state(instance):
    import json
    try:
        value = json.loads(instance.workflow_state or '{}')
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


async def notify_pending(db, tenant_id, approver_ids, title, instance_id):
    # Serialize writers on the workflow row; never commit outside the business transaction.
    inst = await db.scalar(select(WorkflowInstance).where(
        WorkflowInstance.id == instance_id, WorkflowInstance.tenant_id == tenant_id
    ).with_for_update())
    if not inst or inst.status not in ('pending', 'in_progress'):
        return
    state = _state(inst)
    stage = str(state.get('current_node') or state.get('current_step') or 'start')
    link = f'/workflow?tab=pending&instance_id={instance_id}&node_id={quote(stage, safe="")}'
    ids = set(approver_ids)
    if not ids:
        return
    users = (await db.scalars(select(User).where(User.id.in_(ids), User.tenant_id == tenant_id,
                                                 User.is_active.is_(True)))).all()
    existing = set((await db.scalars(select(Notification.user_id).where(
        Notification.tenant_id == tenant_id, Notification.resource_type == 'workflow_instance',
        Notification.resource_id == instance_id, Notification.type == 'approval', Notification.link == link
    ))).all())
    for user in users:
        if user.id not in existing:
            db.add(Notification(tenant_id=tenant_id, user_id=user.id,
                title=f'待审批：{title}'[:200], content='您有一条新的审批待办，请查看申请内容后处理。',
                type='approval', is_read=False, resource_type='workflow_instance', resource_id=instance_id, link=link))
    await db.flush()


async def notify_result(db, inst, action=None, comment=None):
    locked = await db.scalar(select(WorkflowInstance).where(
        WorkflowInstance.id == inst.id, WorkflowInstance.tenant_id == inst.tenant_id
    ).with_for_update())
    if not locked or locked.status not in ('approved', 'rejected') or not locked.initiator_id:
        return
    recipient = await db.scalar(select(User).where(User.id == locked.initiator_id,
        User.tenant_id == locked.tenant_id, User.is_active.is_(True)))
    if not recipient:
        return
    exists = await db.scalar(select(Notification.id).where(Notification.tenant_id == locked.tenant_id,
        Notification.resource_type == 'workflow_instance', Notification.resource_id == locked.id,
        Notification.type == 'approval_result', Notification.user_id == recipient.id))
    if exists:
        return
    label = '已通过' if locked.status == 'approved' else '已驳回'
    content = f'您的申请{label}。'
    if comment and comment.strip():
        content += f'审批意见：{comment.strip()}'
    db.add(Notification(tenant_id=locked.tenant_id, user_id=recipient.id,
        title=f'审批{label}：{locked.title}'[:200], content=content, type='approval_result', is_read=False,
        resource_type='workflow_instance', resource_id=locked.id,
        link=f'/workflow?tab=initiated&instance_id={locked.id}'))
    await db.flush()


async def notification_context(db, notifications, user):
    """Reuse the inbox's form/record permissions and real current-node task membership."""
    if not any(n.resource_type == 'workflow_instance' for n in notifications):
        return {}
    from app.api.workflow import _workflow_business_dataset
    dataset = await _workflow_business_dataset(db, user)
    contexts = {item['workflow']['id']: dict(item) for item in dataset['items'] if item.get('workflow')}
    if contexts:
        instances = (await db.scalars(select(WorkflowInstance).where(
            WorkflowInstance.id.in_(contexts), WorkflowInstance.tenant_id == current_tenant_id(user)
        ))).all()
        for instance in instances:
            state = _state(instance)
            contexts[instance.id]['notification_stage'] = str(
                state.get('current_node') or state.get('current_step') or 'start')
    return contexts


def notification_navigation(notification, contexts):
    category = 'todo' if notification.type == 'approval' else 'result' if notification.type == 'approval_result' else 'other'
    output = dict(category=category, actionable=False, can_approve=False, target_url=None, workflow_status=None)
    if notification.resource_type != 'workflow_instance':
        return output
    item = contexts.get(notification.resource_id)
    if not item:
        return output
    actionable = bool(item.get('can_approve'))
    # An older stage's reminder is history even when this user is assigned again.
    notified_stage = parse_qs(urlparse(notification.link or '').query).get('node_id', [None])[0]
    if notified_stage is not None and notified_stage != item.get('notification_stage'):
        actionable = False
    views = item.get('views', [])
    tab = 'pending' if actionable else 'initiated' if 'initiated' in views else 'processed' if 'processed' in views else None
    output.update(actionable=actionable, can_approve=actionable, workflow_status=item.get('raw_status'),
                  target_url=f'/workflow?tab={tab}&instance_id={notification.resource_id}' if tab else None)
    return output
