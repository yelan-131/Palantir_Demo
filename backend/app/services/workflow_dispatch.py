"""Durable post-commit workflow delivery jobs, scoped to the initiating user."""
import asyncio
import copy
import json
import logging
from datetime import datetime, timezone
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import select

logger = logging.getLogger(__name__)


def validate_actions(config):
    for node in config.get('nodes') or []:
        action = node.get('externalAction') or {}
        if not isinstance(action, dict):
            raise HTTPException(422, '下发配置格式无效')
        if not action.get('enabled'):
            continue
        if node.get('type') != 'serviceTask':
            raise HTTPException(422, '下发操作只能配置在自动任务节点')
        kind = action.get('action', 'api')
        if kind not in {'form', 'api', 'webhook'}:
            raise HTTPException(422, '下发方式仅支持站内表单、API 或 Webhook')
        if kind == 'form':
            target = action.get('targetFormId')
            if not isinstance(target, int) or isinstance(target, bool) or target <= 0:
                raise HTTPException(422, '请选择目标表单')
        else:
            try:
                url = urlsplit(str(action.get('endpoint') or ''))
            except ValueError:
                raise HTTPException(422, '下发地址格式无效')
            if url.scheme not in {'https', 'http'} or not url.hostname or url.username or url.password or url.fragment:
                raise HTTPException(422, '请填写有效的 HTTP/HTTPS 下发地址')
        mappings = action.get('fieldMappings') or []
        if not isinstance(mappings, list) or not mappings or len(mappings)>100 or any(not isinstance(m,dict) or any(not isinstance(m.get(key),str) or not m[key].strip() or len(m[key])>200 for key in ('sourceField','targetField')) for m in mappings):
            raise HTTPException(422, '请完整配置下发字段映射')
        if len({m['targetField'] for m in mappings}) != len(mappings):
            raise HTTPException(422, '下发目标字段不能重复')


def enqueue(state, steps, start, stop):
    jobs = copy.deepcopy(state.get('dispatch_jobs') or [])
    known = {job['node_id'] for job in jobs}
    for index, step in enumerate(steps[start:stop], start):
        action = step.get('external_action') or {}
        node_id = step.get('node_id')
        if action.get('enabled') and node_id not in known:
            jobs.append({'node_id': node_id, 'node_title': step.get('name'), 'action': copy.deepcopy(action),
                         'status': 'pending', 'attempts': 0, 'step': index})
            known.add(node_id)
    state['dispatch_jobs'] = jobs
    state['dispatch_pending'] = any(job['status']=='pending' for job in jobs)


async def _deliver(db, instance, state, job):
    from app.models.relational import User, Form
    from app.services.records import runtime_fields, create_record
    from app.core.permissions import allowed_form_fields, has_form_permission
    actor = await db.get(User, instance.initiator_id)
    if not actor or not actor.is_active or actor.tenant_id != instance.tenant_id:
        raise HTTPException(403, '发起人已停用或不属于当前租户')
    user = {'uid': actor.id, 'tenant_id': actor.tenant_id, 'is_admin': actor.is_admin}
    data = json.loads(instance.form_data or '{}')
    action = job['action']
    mappings = action['fieldMappings']
    source_id = (state.get('variables') or {}).get('form_id')
    if source_id:
        source = await db.get(Form, int(source_id))
        if not source or source.tenant_id != instance.tenant_id or not await has_form_permission(user, source.id, 'view', db):
            raise HTTPException(403, '无权访问下发来源')
        fields = await runtime_fields(db, source)
        allowed = await allowed_form_fields(user, source.id, 'view', fields, db)
        if any(mapping['sourceField'] not in allowed for mapping in mappings):
            raise HTTPException(403, '下发字段超出发起人的可见范围')
    if any(mapping['sourceField'] not in data for mapping in mappings):
        raise HTTPException(422, '下发来源字段不存在')
    payload = {mapping['targetField']: data[mapping['sourceField']] for mapping in mappings}
    if action.get('action') == 'form':
        form = await db.get(Form, action['targetFormId'])
        if not form or form.tenant_id != instance.tenant_id or form.status != 'published':
            raise HTTPException(422, '目标表单不存在或未发布')
        # Draft delivery avoids triggering recursive workflows or submitting on behalf of users.
        result = await create_record(form.id, SimpleNamespace(data=payload, status='draft'), db, user,
                                     defer_commit=True, draft=True, source='workflow_dispatch')
        return {'form_id': form.id, 'record_id': result['data']['id'], 'record_status': 'draft'}
    from app.services.form_option_sources import validate_url
    url = action['endpoint']
    parsed, address = await validate_url(url)
    key = f'workflow:{instance.tenant_id}:{instance.id}:{job["node_id"]}'
    async with httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5), follow_redirects=False, trust_env=False) as client:
        pinned = httpx.URL(url).copy_with(host=address)
        async with client.stream('POST', pinned, json=payload,
                                 headers={'Host': parsed.netloc, 'Idempotency-Key': key},
                                 extensions={'sni_hostname': parsed.hostname}) as response:
            if not 200 <= response.status_code < 300:
                raise HTTPException(502, f'目标系统返回 HTTP {response.status_code}')
            return {'http_status': response.status_code, 'idempotency_key': key}


async def process_instance(db, instance):
    state = json.loads(instance.workflow_state or '{}')
    jobs = state.get('dispatch_jobs') or []
    for job in jobs:
        if job['status'] != 'pending':
            continue
        if instance.status in {'cancelled', 'canceled', 'rejected'}:
            job['status']='cancelled'
            continue
        job['attempts'] += 1
        try:
            async with db.begin_nested():
                result = await _deliver(db, instance, state, job)
            job.update(status='succeeded', result=result)
            job.pop('error', None)
        except Exception as error:
            detail = error.detail if isinstance(error, HTTPException) else '下发失败，请检查目标配置或网络后重试'
            job.update(status='failed', error=str(detail)[:300])
            logger.warning('Workflow delivery failed: instance=%s node=%s error=%s', instance.id, job['node_id'], type(error).__name__)
        job['finished_at'] = datetime.now(timezone.utc).isoformat()
        from app.services.records import change_audit
        await change_audit(db,tenant_id=instance.tenant_id,user_id=instance.initiator_id,action='workflow_dispatch',resource_type='workflow_instance',resource_id=instance.id,new_values={'node_id':job['node_id'],'status':job['status'],'attempt':job['attempts'],'result':job.get('result')})
    state['dispatch_pending'] = any(job['status']=='pending' for job in jobs)
    instance.workflow_state = json.dumps(state, ensure_ascii=False)
    await db.flush()


async def run_worker():
    from app.core.db import db_session
    from app.models.relational import WorkflowInstance
    while True:
        try:
            async with db_session() as db:
                instances = (await db.scalars(select(WorkflowInstance).where(
                    WorkflowInstance.workflow_state.like('%"dispatch_pending": true%')
                ).order_by(WorkflowInstance.id).limit(20).with_for_update(skip_locked=True))).all()
                for instance in instances:
                    await process_instance(db, instance)
                await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('Workflow delivery worker failed')
        await asyncio.sleep(5)
