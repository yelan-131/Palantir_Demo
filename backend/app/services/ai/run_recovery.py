"""Durable confirmation claims and replayable execution results."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select, update

from app.core.db import db_session
from app.models.relational import AIAgentRun
from .agent_items import extract_actions, extract_confirmation_payload


def receipts(items):
    return [item for item in (items or []) if item.get('execution_receipt')]


def restore_run(row):
    snapshots = [item for item in (row.items or []) if item.get('execution_snapshot')]
    results = snapshots[-1]['payload']['tool_results'] if snapshots else [
        {'tool': item['tool'], 'status': 'completed', 'result': item['payload']} for item in receipts(row.items)]
    payload = extract_confirmation_payload(row.items or []) or row.confirmation_payload or {}
    return {'run_id': row.run_id, 'tenant_id': row.tenant_id, 'status': row.status,
        'created_by': str(payload.get('user') or ''), 'actions': row.actions or extract_actions(row.items or []),
        'items': row.items or [], 'answer': row.answer, 'mode': row.mode, 'evidence': row.evidence or [],
        'risk_level': row.risk_level, 'requires_confirmation': row.status == 'waiting_confirmation',
        'tool_results': results}


async def read_run(run_id, user):
    async with db_session() as db:
        row = await db.scalar(select(AIAgentRun).where(AIAgentRun.run_id == run_id,
            AIAgentRun.tenant_id == user['tenant_id']))
        if row is None:
            return None
        run = restore_run(row)
        if run['created_by'] != str(user.get('sub') or user.get('username') or user.get('uid')):
            raise HTTPException(404, 'Agent run not found')
        return run


async def cancel_pending_run(run_id, user):
    async with db_session() as db:
        row = await db.scalar(select(AIAgentRun).where(AIAgentRun.run_id == run_id,
            AIAgentRun.tenant_id == user['tenant_id']).with_for_update())
        if row is None:
            return None
        run = restore_run(row)
        if run['created_by'] != str(user.get('sub') or user.get('username') or user.get('uid')):
            raise HTTPException(404, 'Agent run not found')
        if row.status != 'waiting_confirmation':
            raise HTTPException(409, '操作已确认或结束，无法取消，请查看执行结果')
        row.status = 'cancelled'
        row.requires_confirmation = False
        await db.commit()
        return restore_run(row)


async def claim_confirmation(run_id, token, user):
    """CAS every persisted run, including the first in-memory confirmation."""
    async with db_session() as db:
        row = await db.scalar(select(AIAgentRun).where(AIAgentRun.run_id == run_id,
            AIAgentRun.tenant_id == user['tenant_id']).with_for_update())
        if row is None:
            return None
        payload = extract_confirmation_payload(row.items or []) or row.confirmation_payload or {}
        owner = str(user.get('sub') or user.get('username') or user.get('uid'))
        if not payload.get('confirmation_token') or payload['confirmation_token'] != token or str(payload.get('user')) != owner:
            raise HTTPException(404, 'Agent run not found')
        if row.status in {'completed', 'failed'}:
            return restore_run(row), True
        if row.status == 'confirmed':
            actions = row.actions or extract_actions(row.items or [])
            done = receipts(row.items)
            # The receipt is committed together with the record write, so even
            # a crash before the final response can recover this single action.
            if len(actions) == 1 and len(done) == 1 and done[0].get('tool') in {'forms.update_record', 'forms.create_dynamic_record_draft'}:
                row.status = 'completed'
                row.requires_confirmation = False
                await db.commit()
                return restore_run(row), True
            raise HTTPException(409, '操作正在执行或等待状态核实，请稍后重试；不要重新创建相同操作')
        if row.status != 'waiting_confirmation':
            raise HTTPException(409, '操作已取消或不可确认')
        if payload.get('expires_at') and datetime.fromisoformat(str(payload['expires_at'])) < datetime.now():
            raise HTTPException(400, 'Confirmation token has expired')
        claimed = await db.execute(update(AIAgentRun).where(AIAgentRun.id == row.id,
            AIAgentRun.status == 'waiting_confirmation').values(status='confirmed'))
        if claimed.rowcount != 1:
            raise HTTPException(409, '操作已被其他请求确认，请稍后重试查看结果')
        await db.commit()
        run = restore_run(row)
        run['status'] = 'confirmed'
        return run, False


def merge_execution_items(stored, run):
    items = list(run.get('items') or [])
    ids = {item.get('id') for item in items}
    items.extend(item for item in receipts(stored) if item.get('id') not in ids)
    items.append({'type': 'tool_result', 'id': 'execution-snapshot', 'execution_snapshot': True,
        'status': run.get('status'), 'payload': {'tool_results': run.get('tool_results') or []}})
    return items
