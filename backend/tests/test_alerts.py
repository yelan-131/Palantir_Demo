from types import SimpleNamespace
from datetime import datetime
import json
import pytest
from fastapi import HTTPException
from app.services.alert_service import (normalize_status, is_material_request, next_status,
                                        filter_alerts, alert_payload)

@pytest.mark.parametrize('old,new', [('待处理','pending'), ('确认中','acknowledged'),
    ('处理中','in_progress'), ('已关闭','closed'), ('active','pending'), (None,'pending')])
def test_legacy_status(old, new):
    assert normalize_status(old) == new


def test_material_classification_is_conservative():
    assert not is_material_request({'title':'前端新增料号申请'})
    assert not is_material_request({'title':'新增料号申请'})
    assert not is_material_request({'title':'新增料号申请： '})
    assert is_material_request({'title':'新增料号申请：MAT-2026-001'})
    assert is_material_request({'title':'前端新增料号申请 : MAT-2026-002'})
    assert not is_material_request({'title':'现场验证料号-365'})
    assert not is_material_request({'title':'料号库存告警'})


def test_disposition_requires_order_and_resolution():
    assert next_status('pending','acknowledge') == 'acknowledged'
    assert next_status('acknowledged','start') == 'in_progress'
    assert next_status('in_progress','resolve','更换轴承') == 'resolved'
    assert next_status('resolved','close') == 'closed'
    for status, action, comment in [('pending','close',''), ('pending','resolve','已修复'),
                                   ('in_progress','resolve','  '), ('closed','assign','')]:
        with pytest.raises(HTTPException):
            next_status(status, action, comment, 1)


def test_counts_precede_status_and_pagination():
    rows = [{'id': i, 'status': 'pending' if i < 5 else 'closed', 'title': '设备', 'due_at': None} for i in range(10)]
    result = filter_alerts(rows, '设备', 'pending', 2, 2)
    assert result['total'] == 5
    assert len(result['data']) == 2
    assert result['counts']['pending'] == result['counts']['closed'] == 5
    assert filter_alerts(rows, '不存在')['total'] == 0


def test_real_history_and_workflow_preserved():
    record = {'id': 1, 'status': 'approved', 'data': {'status':'确认中','owner':'旧负责人',
        'interaction_log': '[{"time":"12:00","actor":"系统","action":"创建告警"}]'}}
    event = SimpleNamespace(timestamp=datetime(2026,10,13), user_id=7,
        new_values=json.dumps({'action':'assign','owner_id':8,'actor_name':'张三'}))
    result = alert_payload(record, [event])
    assert result['record_status'] == 'approved'
    assert result['owner_id'] == 8
    assert result['history'][-1]['actor_id'] == 7
    assert len(result['history']) == 2


def test_legacy_text_history_is_retained():
    result = alert_payload({'id': 1, 'data': {'interaction_log': '历史人工备注'}})
    assert result['history'][0]['comment'] == '历史人工备注'

@pytest.mark.asyncio
async def test_stale_action_is_rejected_before_write(monkeypatch):
    from unittest.mock import AsyncMock
    from app.api import alerts
    db = SimpleNamespace(commit=AsyncMock(), execute=AsyncMock())
    monkeypatch.setattr(alerts, '_context', AsyncMock(return_value=(SimpleNamespace(id=1), [], {'title','status'})))
    monkeypatch.setattr(alerts, '_records', AsyncMock(return_value=[{'id':1,'data':{'title':'设备故障','status':'处理中'}}]))
    with pytest.raises(HTTPException) as error:
        await alerts.act_on_alert(1, alerts.AlertAction(action='acknowledge', expected_status='pending'), db,
                                 {'uid':1, 'tenant_id':1})
    assert error.value.status_code == 409
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_material_source_cannot_be_disposed(monkeypatch):
    from unittest.mock import AsyncMock
    from app.api import alerts
    db = SimpleNamespace(commit=AsyncMock(), execute=AsyncMock())
    monkeypatch.setattr(alerts, '_context', AsyncMock(return_value=(SimpleNamespace(id=1), [], {'title','status'})))
    monkeypatch.setattr(alerts, '_records', AsyncMock(return_value=[{'id':1,'data':{'title':'新增料号申请：MAT-1','status':'待处理'}}]))
    with pytest.raises(HTTPException) as error:
        await alerts.act_on_alert(1, alerts.AlertAction(action='acknowledge', expected_status='pending'), db,
                                 {'uid':1, 'tenant_id':1})
    assert error.value.status_code == 404
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_tenant_never_queries_database():
    from unittest.mock import AsyncMock
    from app.api.alerts import _context
    db = SimpleNamespace(scalar=AsyncMock())
    with pytest.raises(HTTPException) as error:
        await _context(db, {'uid':1})
    assert error.value.status_code == 403
    db.scalar.assert_not_awaited()


@pytest.mark.asyncio
async def test_cross_tenant_owner_is_rejected(monkeypatch):
    from unittest.mock import AsyncMock
    from app.api import alerts
    actor = SimpleNamespace(id=1, is_active=True, display_name='测试', username='tester')
    db = SimpleNamespace(scalar=AsyncMock(side_effect=[actor, None]), commit=AsyncMock(), execute=AsyncMock())
    monkeypatch.setattr(alerts, '_context', AsyncMock(return_value=(SimpleNamespace(id=1,tenant_id=1), [], {'title','status'})))
    monkeypatch.setattr(alerts, '_records', AsyncMock(return_value=[{'id':1,'data':{'title':'设备故障','status':'待处理'}}]))
    with pytest.raises(HTTPException) as error:
        await alerts.act_on_alert(1, alerts.AlertAction(action='assign', owner_id=99, expected_status='pending'), db,
                                 {'uid':1, 'tenant_id':1, 'is_admin':True})
    assert error.value.status_code == 422
    sql = str(db.scalar.call_args.args[0])
    assert 'users.tenant_id' in sql and 'users.is_active' in sql
    db.execute.assert_not_awaited()

@pytest.mark.asyncio
@pytest.mark.parametrize('action,status,owner_id', [('assign','pending',9),('start','acknowledged',None),
                                                   ('resolve','in_progress',None),('close','resolved',None)])
async def test_non_admin_cannot_dispose_others_alert(monkeypatch, action, status, owner_id):
    from unittest.mock import AsyncMock
    from app.api import alerts
    actor = SimpleNamespace(id=1, is_active=True, display_name='测试', username='tester')
    db = SimpleNamespace(scalar=AsyncMock(return_value=actor), commit=AsyncMock(), execute=AsyncMock())
    monkeypatch.setattr(alerts, '_context', AsyncMock(return_value=(SimpleNamespace(id=1,tenant_id=1), [], {'title','status','owner'})))
    monkeypatch.setattr(alerts, '_records', AsyncMock(return_value=[{'id':1,'data':{'title':'设备故障','status':status,'owner':'其他用户'}}]))
    monkeypatch.setattr(alerts, '_events', AsyncMock(return_value={}))
    with pytest.raises(HTTPException) as error:
        await alerts.act_on_alert(1, alerts.AlertAction(action=action, owner_id=owner_id, expected_status=status, comment='处置结论'), db,
                                 {'uid':1,'tenant_id':1})
    assert error.value.status_code == 403
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()
