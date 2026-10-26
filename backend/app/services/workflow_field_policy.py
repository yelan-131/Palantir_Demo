"""Current pinned approval-node field visibility, shared by record readers."""
import json
from sqlalchemy import select
from app.models.relational import AuditLog, WorkflowInstance, WorkflowDef


def parsed(value):
    if isinstance(value, dict): return value
    try: return json.loads(value or '{}')
    except (ValueError, TypeError): return {}


async def current_policy(db, user, form, record_id, *, cache=None):
    if user.get('is_admin') or not record_id:
        return {}
    cache = cache if cache is not None else {}
    key = ('workflow_node_fields', form.tenant_id, form.id)
    if key not in cache:
        rows = (await db.scalars(select(AuditLog).where(
            AuditLog.tenant_id == form.tenant_id,
            AuditLog.resource_type == f'form_application:{form.id}',
            AuditLog.action == 'submit').order_by(AuditLog.id.desc()))).all()
        latest = {}
        for row in rows:
            latest.setdefault(row.resource_id, parsed(row.new_values).get('workflow_id'))
        instance_ids = {iid for iid in latest.values() if iid}
        instances = (await db.scalars(select(WorkflowInstance).where(
            WorkflowInstance.tenant_id == form.tenant_id,
            WorkflowInstance.id.in_(instance_ids),
            WorkflowInstance.status.in_(['pending', 'running', 'in_progress', 'processing'])))).all() if instance_ids else []
        definition_ids = {instance.workflow_id for instance in instances}
        definitions = (await db.scalars(select(WorkflowDef).where(
            WorkflowDef.tenant_id == form.tenant_id, WorkflowDef.id.in_(definition_ids)))).all() if definition_ids else []
        from app.api.workflow import _configs_for_instances, _instance_steps
        configs = await _configs_for_instances(db, instances, {d.id: d for d in definitions})
        by_instance = {}
        for instance in instances:
            state = parsed(instance.workflow_state)
            config = configs[instance.id]
            step = next((step for step in _instance_steps(config, state)
                         if step.get('node_id', step.get('name')) == state.get('current_node')), {})
            policy = step.get('field_permissions') or (config.get('fieldPermissions') or {}).get(state.get('current_node')) or {}
            by_instance[instance.id] = policy if isinstance(policy, dict) else {}
        cache[key] = {rid: by_instance.get(iid, {}) for rid, iid in latest.items()}
    return cache[key].get(record_id, {})
