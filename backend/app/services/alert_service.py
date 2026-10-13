"""Alert domain over existing form records; workflow lifecycle remains separate."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from fastapi import HTTPException

STATUSES = ('pending', 'acknowledged', 'in_progress', 'resolved', 'closed')
STATUS_ALIASES = {
    '待处理': 'pending', '待确认': 'pending', 'active': 'pending', '': 'pending',
    '确认中': 'acknowledged', '已确认': 'acknowledged', '处理中': 'in_progress',
    '已解决': 'resolved', '已处置': 'resolved', '已关闭': 'closed',
}
MATERIAL_TITLES = {'新增料号申请', '前端新增料号申请'}


def normalize_status(value):
    value = str(value or '').strip()
    return STATUS_ALIASES.get(value, value if value in STATUSES else 'pending')


def is_material_request(data):
    title = str(data.get('title') or '').strip()
    return bool(re.fullmatch(r'(?:前端)?新增料号申请\s*[:：]\s*\S.*', title))


def next_status(status, action, comment=None, owner_id=None):
    transitions = {'acknowledge': ('pending', 'acknowledged'), 'start': ('acknowledged', 'in_progress'),
                   'resolve': ('in_progress', 'resolved'), 'close': ('resolved', 'closed')}
    if action == 'assign':
        if status not in STATUSES[:3] or not owner_id:
            raise HTTPException(409, '仅未结束的告警可分派，且必须选择负责人')
        return status
    if action not in transitions or transitions[action][0] != status:
        raise HTTPException(409, '告警状态已变化或该操作不适用于当前状态')
    if action == 'resolve' and not str(comment or '').strip():
        raise HTTPException(422, '解决告警必须填写处置结论')
    return transitions[action][1]


def parse_history(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            value = [{'action': 'legacy', 'comment': value}] if value.strip() else []
    return value if isinstance(value, list) else []


def alert_payload(record, events=()):
    data = record['data']
    history = parse_history(data.get('interaction_log'))[:]
    owner_id = None
    for event in events:
        detail = json.loads(event.new_values or '{}')
        history.append({'time': event.timestamp.isoformat(), 'actor_id': event.user_id, **detail})
        if detail.get('owner_id') is not None:
            owner_id = detail['owner_id']
    return {'id': record['id'], 'alert_id': data.get('alert_id'), 'title': data.get('title'),
            'device': data.get('device'), 'level': data.get('level'), 'source': data.get('source'),
            'occurred_at': data.get('occurred_at') or record.get('created_at'), 'due_at': data.get('due_at'),
            'owner_id': owner_id, 'owner_name': data.get('owner'), 'status': normalize_status(data.get('status')),
            'resolution': data.get('resolution'), 'history': history, 'record_status': record.get('status')}


def is_overdue(row):
    if row['status'] in ('resolved', 'closed') or not row.get('due_at'):
        return False
    try:
        due = datetime.fromisoformat(str(row['due_at']).replace('Z', '+00:00'))
        # Historical timestamps are server wall-clock (UTC), as returned by the form engine.
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return due < datetime.now(timezone.utc)
    except ValueError:
        return False


def filter_alerts(rows, q='', status=None, page=1, page_size=20):
    q = (q or '').strip().lower()
    matched = [row for row in rows if not q or any(q in str(row.get(key) or '').lower()
               for key in ('alert_id', 'title', 'device', 'owner_name', 'source'))]
    counts = {key: sum(row['status'] == key for row in matched) for key in STATUSES}
    counts['overdue'] = sum(is_overdue(row) for row in matched)
    if status == 'overdue':
        matched = [row for row in matched if is_overdue(row)]
    elif status:
        if status not in STATUSES:
            raise HTTPException(422, '未知告警状态')
        matched = [row for row in matched if row['status'] == status]
    start = (page - 1) * page_size
    return {'data': matched[start:start + page_size], 'total': len(matched), 'counts': counts,
            'page': page, 'page_size': page_size}
