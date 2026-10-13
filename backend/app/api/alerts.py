"""Tenant-scoped alert registration and disposition endpoints."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db
from app.api.forms import (_ensure_form_permission, _runtime_form_fields, _runtime_visible_field_names,
                           _record_payload, create_dynamic_record, DynamicRecordCreate)
from app.api.form_engine import _uses_physical_form_table, _physical_record_payload, _physical_column_name
from app.api._model_driven_shared import assert_safe_identifier
from app.core.permissions import allowed_form_fields
from app.database import DB_TYPE
from app.models.relational import Form, DynamicRecord, AuditLog, User
from app.services.alert_service import (alert_payload, filter_alerts, is_material_request, next_status, normalize_status)

router = APIRouter()


class AlertCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    device: str = Field(default='', max_length=200)
    level: Literal['严重', '一般', '提醒'] = '一般'
    source: Literal['人工上报', '系统监测', '外部接口'] = '人工上报'
    occurred_at: datetime | None = None
    due_at: datetime | None = None


class AlertAction(BaseModel):
    action: Literal['acknowledge', 'assign', 'start', 'resolve', 'close']
    owner_id: int | None = Field(default=None, gt=0)
    comment: str | None = Field(default=None, max_length=10000)
    expected_status: Literal['pending', 'acknowledged', 'in_progress', 'resolved', 'closed']


async def _context(db, user, action='view'):
    tenant = current_tenant_id(user)
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant, Form.code == 'alert-center'))
    if not form:
        raise HTTPException(404, '告警表单不存在')
    await _ensure_form_permission(db, user, form.id, action)
    fields = await _runtime_form_fields(db, tenant, form.id)
    visible = await _runtime_visible_field_names(user, form.id, fields, db)
    # Classification and lifecycle must not leak hidden business data.
    if not {'title', 'status'} <= visible:
        raise HTTPException(403, '缺少告警标题或状态的查看权限')
    return form, fields, visible


async def _records(db, form, fields, visible, record_id=None, lock=False):
    if _uses_physical_form_table(form):
        table = str(form.table_name)
        assert_safe_identifier(table)
        clause = ' AND id = :id' if record_id is not None else ''
        locking = ' FOR UPDATE' if lock and DB_TYPE != 'sqlite' else ''
        result = await db.execute(text(f'SELECT * FROM {table} WHERE tenant_id = :tenant AND deleted_at IS NULL{clause} ORDER BY id DESC{locking}'),
                                  {'tenant': form.tenant_id, 'id': record_id})
        return [_physical_record_payload(row, form, fields, visible_fields=visible) for row in result]
    query = select(DynamicRecord).where(DynamicRecord.tenant_id == form.tenant_id,
                                       DynamicRecord.form_id == form.id, DynamicRecord.deleted_at.is_(None))
    if record_id is not None:
        query = query.where(DynamicRecord.id == record_id)
    if lock:
        query = query.with_for_update()
    return [_record_payload(row, visible_fields=visible) for row in (await db.scalars(query.order_by(DynamicRecord.id.desc()))).all()]


async def _events(db, form, ids):
    if not ids:
        return {}
    result = await db.scalars(select(AuditLog).where(AuditLog.tenant_id == form.tenant_id,
                              AuditLog.resource_type == f'alert:{form.id}', AuditLog.resource_id.in_(ids)).order_by(AuditLog.id))
    grouped = {}
    for event in result:
        grouped.setdefault(event.resource_id, []).append(event)
    return grouped


def _present(record, events, visible):
    row = alert_payload(record, events)
    if 'owner' not in visible:
        row['owner_id'] = None
        row['owner_name'] = None
    for event in row['history']:
        if 'resolution' not in visible:
            event.pop('comment', None)
        if 'owner' not in visible:
            event.pop('owner_id', None)
            event.pop('owner_name', None)
    return row


@router.get('')
async def list_alerts(q: str = '', status: str | None = None, page: int = Query(1, ge=1),
                      page_size: int = Query(20, ge=1, le=200), db: AsyncSession = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    form, fields, visible = await _context(db, user)
    records = [r for r in await _records(db, form, fields, visible) if not is_material_request(r['data'])]
    events = await _events(db, form, [r['id'] for r in records])
    rows = [_present(r, events.get(r['id'], []), visible) for r in records]
    return filter_alerts(rows, q, status, page, page_size)


@router.get('/{alert_id}')
async def get_alert(alert_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    form, fields, visible = await _context(db, user)
    records = await _records(db, form, fields, visible, alert_id)
    if not records or is_material_request(records[0]['data']):
        raise HTTPException(404, '告警不存在')
    events = await _events(db, form, [alert_id])
    return {'data': _present(records[0], events.get(alert_id, []), visible)}


@router.post('')
async def create_alert(body: AlertCreate, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    form, fields, visible = await _context(db, user, 'create')
    if is_material_request({'title': body.title}):
        raise HTTPException(422, '料号申请请在独立的料号申请入口登记')
    now = datetime.now(timezone.utc)
    occurred_at = body.occurred_at or now
    if body.due_at:
        comparable = lambda value: value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if comparable(body.due_at) < comparable(occurred_at):
            raise HTTPException(422, '截止时间不能早于发生时间')
    if not body.source.strip():
        raise HTTPException(422, '请填写告警来源')
    data = body.model_dump(mode='json', exclude_none=True)
    data['source'] = body.source.strip()
    data.update({'title': body.title.strip(), 'status': '待处理', 'occurred_at': data.get('occurred_at') or now.isoformat(),
                 'alert_id': 'AL-' + now.strftime('%Y%m%d%H%M%S%f')})
    if not data['title']:
        raise HTTPException(422, '请填写告警标题')
    editable = await allowed_form_fields(user, form.id, 'create', fields, db)
    if not set(data) <= editable:
        raise HTTPException(403, '缺少告警登记字段的创建权限')
    result = await create_dynamic_record(form.id, DynamicRecordCreate(data=data), db, user)
    actor = await db.scalar(select(User).where(User.id == current_user_id(user), User.tenant_id == form.tenant_id))
    detail = {'action': 'create', 'to_status': 'pending', 'actor_name': (actor.display_name or actor.username) if actor else str(current_user_id(user)),
              'created_at': now.isoformat()}
    db.add(AuditLog(tenant_id=form.tenant_id, user_id=current_user_id(user), action='create',
                   resource_type=f'alert:{form.id}', resource_id=result['data']['id'],
                   new_values=json.dumps(detail, ensure_ascii=False)))
    await db.commit()
    return await get_alert(result['data']['id'], db, user)


@router.post('/{alert_id}/actions')
async def act_on_alert(alert_id: int, body: AlertAction, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    form, fields, visible = await _context(db, user, 'edit')
    records = await _records(db, form, fields, visible, alert_id, lock=True)
    if not records or is_material_request(records[0]['data']):
        raise HTTPException(404, '告警不存在')
    record = records[0]
    current = normalize_status(record['data'].get('status'))
    if current != body.expected_status:
        raise HTTPException(409, '告警已被其他人更新，请刷新后重试')
    target = next_status(current, body.action, body.comment, body.owner_id)
    actor = await db.scalar(select(User).where(User.id == current_user_id(user), User.tenant_id == form.tenant_id))
    if not actor or not actor.is_active:
        raise HTTPException(403, '当前用户已失效')
    if not user.get('is_admin'):
        if body.action == 'assign' and body.owner_id != actor.id:
            raise HTTPException(403, '只能认领给自己，分派他人需要管理员权限')
        if body.action in ('start', 'resolve', 'close'):
            events = await _events(db, form, [alert_id])
            current_row = alert_payload(record, events.get(alert_id, []))
            owned = (current_row['owner_id'] == actor.id) if current_row['owner_id'] is not None else (
                bool(current_row['owner_name']) and current_row['owner_name'] in (actor.display_name, actor.username))
            if not owned:
                raise HTTPException(403, '请先认领告警，只有负责人可执行处置操作')
    updates = {'status': target}
    owner = None
    if body.action == 'assign':
        owner = await db.scalar(select(User).where(User.id == body.owner_id, User.tenant_id == form.tenant_id, User.is_active.is_(True)))
        if not owner:
            raise HTTPException(422, '负责人必须是本租户的有效用户')
        updates['owner'] = owner.display_name or owner.username
    if body.action == 'resolve':
        updates['resolution'] = body.comment.strip()
    editable = await allowed_form_fields(user, form.id, 'edit', fields, db)
    if not set(updates) <= editable:
        raise HTTPException(403, '缺少告警状态、负责人或处置结论的编辑权限')
    actor_name = (actor.display_name or actor.username) if actor else str(user.get('sub') or current_user_id(user))
    if _uses_physical_form_table(form):
        table = str(form.table_name)
        assert_safe_identifier(table)
        assignments = [f'{_physical_column_name(key)} = :{key}' for key in updates]
        await db.execute(text(f"UPDATE {table} SET {', '.join(assignments)}, updated_by = :actor, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND tenant_id = :tenant AND deleted_at IS NULL"),
                         {**updates, 'actor': current_user_id(user), 'id': alert_id, 'tenant': form.tenant_id})
    else:
        row = await db.get(DynamicRecord, alert_id)
        row.data = {**row.data, **updates}
        row.updated_by = current_user_id(user)
    detail = {'action': body.action, 'from_status': current, 'to_status': target,
              'comment': (body.comment or '').strip(), 'actor_name': actor_name,
              'created_at': datetime.now(timezone.utc).isoformat()}
    if owner:
        detail.update(owner_id=owner.id, owner_name=updates['owner'])
    db.add(AuditLog(tenant_id=form.tenant_id, user_id=current_user_id(user), action=body.action,
                   resource_type=f'alert:{form.id}', resource_id=alert_id,
                   old_values=json.dumps({'status': current}), new_values=json.dumps(detail, ensure_ascii=False)))
    # Business state and its history commit together; record_status/process_status are never overwritten.
    await db.commit()
    return await get_alert(alert_id, db, user)
