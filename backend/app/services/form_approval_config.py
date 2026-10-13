"""Independent, versioned approval settings for each business form.

The caller owns the transaction. Existing instances and published snapshots
are never updated, including when explicitly replacing a custom binding.
"""
import json
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select
from app.api.form_engine.naming import _is_analysis_form_config
from app.models.relational import Form, User, WorkflowBinding, WorkflowDef, WorkflowDefVersion, AuditLog


def parsed(value):
    if isinstance(value, dict):
        return value
    try:
        result = json.loads(value or '{}')
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError):
        return {}


def domain_code(form):
    return 'material-application-approval' if form.code == 'material-application' else f'form-approval:{form.id}'


def trigger_action(form):
    return 'manual_submit' if form.code == 'material-application' else 'submit'


def build_config(form, stages):
    return {'domainCode': domain_code(form), 'steps': [
        {'name': '提交申请', 'type': 'start', 'node_id': 'form-start'},
        *[{'name': stage['name'], 'type': 'approval', 'node_id': f'form-approval-{index + 1}',
           'approval_mode': stage['approval_mode'],
           'assignee_rules': [{'type': 'user', 'value': [str(uid) for uid in stage['approver_ids']]}]}
          for index, stage in enumerate(stages)],
        {'name': '结束', 'type': 'end', 'node_id': 'form-end'}]}


def editable_stages(config):
    """Return None for designer graphs, conditions or non-fixed assignment rules."""
    if set(config) - {'domainCode', 'steps'} or not isinstance(config.get('steps'), list):
        return None
    stages = []
    for step in config['steps']:
        if not isinstance(step, dict):
            return None
        if step.get('type') in {'start', 'end'}:
            continue
        if step.get('type') != 'approval' or set(step) - {'name', 'type', 'node_id', 'approval_mode', 'assignee_rules'}:
            return None
        rules = step.get('assignee_rules', [])
        if len(rules) != 1 or rules[0].get('type') != 'user':
            return None
        try:
            ids = [int(uid) for uid in rules[0]['value']]
        except (KeyError, ValueError, TypeError):
            return None
        mode = step.get('approval_mode', 'single')
        if not ids or mode not in {'single', 'countersign'}:
            return None
        stages.append({'name': step.get('name', '审批'), 'approver_ids': ids, 'approval_mode': mode})
    return stages or None


async def _form(db, tenant_id, form_id, lock=False):
    statement = select(Form).where(Form.tenant_id == tenant_id, Form.id == form_id)
    if lock:
        statement = statement.with_for_update()
    form = await db.scalar(statement)
    if not form:
        raise HTTPException(404, '表单不存在')
    if form.status == 'archived' or _is_analysis_form_config(form.config) or str((form.config or {}).get('assemblyKind') or (form.config or {}).get('kind') or (form.config or {}).get('type') or '').lower() == 'bi':
        raise HTTPException(422, '仅业务表单可配置审批，归档或分析表单不支持')
    return form


async def _bindings(db, form):
    return list((await db.scalars(select(WorkflowBinding).where(
        WorkflowBinding.tenant_id == form.tenant_id, WorkflowBinding.form_id == form.id,
        WorkflowBinding.trigger_action == trigger_action(form)).order_by(WorkflowBinding.id))).all())


async def approval_settings(db, tenant_id, form_id):
    form = await _form(db, tenant_id, form_id)
    bindings = await _bindings(db, form)
    definitions = {}
    for binding in bindings:
        definition = await db.scalar(select(WorkflowDef).where(WorkflowDef.id == binding.workflow_id, WorkflowDef.tenant_id == tenant_id))
        if definition:
            definitions[definition.id] = definition
    active = [binding for binding in bindings if binding.enabled]
    managed = [binding for binding in bindings if binding.workflow_id in definitions and parsed(definitions[binding.workflow_id].config).get('domainCode') == domain_code(form)]
    selected = next((binding for binding in managed if binding.enabled), managed[-1] if managed else None)
    definition = definitions.get(selected.workflow_id) if selected else None
    stages = editable_stages(parsed(definition.config)) if definition else []
    custom = any(binding not in managed for binding in active) or bool(definition and stages is None)
    shared = bool(definition and await db.scalar(select(WorkflowBinding.id).where(
        WorkflowBinding.workflow_id == definition.id, WorkflowBinding.form_id != form.id)))
    users = (await db.scalars(select(User).where(User.tenant_id == tenant_id, User.is_active.is_(True)).order_by(User.id))).all()
    return {'form_id': form.id, 'enabled': bool(active), 'managed': bool(selected),
            'editable': not custom and not shared, 'requires_replacement': custom or shared,
            'stages': stages or [], 'workflow_id': definition.id if definition else None,
            'workflow_version': definition.version if definition else None,
            'version': definition.version if definition else None, 'trigger_action': trigger_action(form),
            'available_users': [{'id': user.id, 'name': user.display_name or user.username} for user in users],
            'existing_workflows': [{'id': binding.workflow_id, 'name': definitions[binding.workflow_id].name if binding.workflow_id in definitions else '未知流程', 'trigger_action': binding.trigger_action} for binding in active]}


async def save_approval_settings(db, tenant_id, form_id, actor_id, body):
    form = await _form(db, tenant_id, form_id, lock=True)
    before = await approval_settings(db, tenant_id, form_id)
    if 'expected_version' in body and body['expected_version'] != before['version']:
        raise HTTPException(409, '审批配置已更新，请刷新后重试')
    if before['requires_replacement'] and not body.get('replace_existing'):
        raise HTTPException(409, '已有自定义或共享流程，需明确确认替换未来提交的审批；在途实例不变')
    stages = body.get('stages') or []
    if body['enabled'] and not stages:
        raise HTTPException(422, '启用审批至少需要一个审批节点')
    active_ids = {user['id'] for user in before['available_users']}
    for stage in stages:
        if not stage['approver_ids'] or any(uid not in active_ids for uid in stage['approver_ids']):
            raise HTTPException(422, '审批人必须是本租户的有效用户')
        if len(set(stage['approver_ids'])) != len(stage['approver_ids']):
            raise HTTPException(422, '同一审批节点不能重复选择审批人')
    bindings = await _bindings(db, form)
    definition = await db.get(WorkflowDef, before['workflow_id']) if before['workflow_id'] else None
    if before['requires_replacement']:
        definition = None  # never reshape a designer or shared definition
    desired = build_config(form, stages) if stages else None
    if body['enabled'] or desired:
        if definition is None:
            definition = WorkflowDef(tenant_id=tenant_id, name=f'{form.name}审批', description='表单独立审批设置',
                config=json.dumps(desired, ensure_ascii=False), status='published', version=1)
            db.add(definition)
            await db.flush()
        else:
            definition = await db.scalar(select(WorkflowDef).where(WorkflowDef.id == definition.id).with_for_update())
            snapshot = await db.scalar(select(WorkflowDefVersion).where(WorkflowDefVersion.workflow_id == definition.id, WorkflowDefVersion.version == definition.version))
            if parsed(definition.config) != desired or definition.status != 'published' or (snapshot and parsed(snapshot.config) != desired):
                definition.version = int(definition.version or 1) + 1
                definition.config = json.dumps(desired, ensure_ascii=False)
                definition.status = 'published'
        snapshot = await db.scalar(select(WorkflowDefVersion).where(WorkflowDefVersion.workflow_id == definition.id, WorkflowDefVersion.version == definition.version))
        if not snapshot:
            db.add(WorkflowDefVersion(tenant_id=tenant_id, workflow_id=definition.id, version=definition.version,
                config=definition.config, form_config=definition.form_config, status='published', published_by=actor_id, published_at=datetime.now()))
        binding = next((item for item in bindings if item.workflow_id == definition.id), None)
        if not binding:
            binding = WorkflowBinding(tenant_id=tenant_id, form_id=form.id, workflow_id=definition.id,
                trigger_action=trigger_action(form), config={'domainCode': domain_code(form)}, enabled=body['enabled'])
            db.add(binding)
        binding.enabled = body['enabled']
    for binding in bindings:
        if definition is None or binding.workflow_id != definition.id or not body['enabled']:
            binding.enabled = False
    db.add(AuditLog(tenant_id=tenant_id, user_id=actor_id, action='approval_settings', resource_type='form', resource_id=form.id,
        old_values=json.dumps({key: value for key, value in before.items() if key != 'available_users'}, ensure_ascii=False), new_values=json.dumps(body, ensure_ascii=False)))
    await db.flush()
    return await approval_settings(db, tenant_id, form_id)
