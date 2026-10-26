"""Per-object rules must affect execution, including overlapping memberships."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.api.workflow import _resolve_step_approver_ids
from app.services.approval_groups import evaluate_approval_groups
from tests.test_workflow import client, _uid, _seed_users, _ok, _headers


def row(uid, action=None):
    return SimpleNamespace(approver_id=uid, action=action)


def test_overlapping_or_sign_does_not_skip_member_needed_by_countersign():
    groups = [{'mode': 'orSign', 'user_ids': [1, 2]}, {'mode': 'countersign', 'user_ids': [2, 3]}]
    assert evaluate_approval_groups(groups, [row(1, 'approve'), row(2), row(3)]) == (False, [2, 3])
    assert evaluate_approval_groups(groups, [row(1, 'approve'), row(2, 'approve'), row(3, 'approve')]) == (True, [])


@pytest.mark.asyncio
async def test_role_policies_pin_separate_groups_and_single_chooses_first(monkeypatch):
    monkeypatch.setattr('app.api.workflow._resolve_users_by_role', AsyncMock(side_effect=[[1, 2], [2, 3], [4, 5]]))
    groups = []
    step = {'assignee_rules': [{'type': 'role', 'value': role, 'approvalMode': mode}
        for role, mode in [('production', 'orSign'), ('quality', 'countersign'), ('owner', 'single')]]}
    assert await _resolve_step_approver_ids(None, 1, step, {}, {}, 9, 9, approval_groups=groups) == [1, 2, 3, 4]
    assert [group['user_ids'] for group in groups] == [[1, 2], [2, 3], [4]]
    assert step['assignee_rules'][0]['approvalMode'] == 'orSign'


@pytest.mark.asyncio
async def test_empty_role_cannot_fall_back_to_initiator(monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr('app.api.workflow._resolve_users_by_role', AsyncMock(return_value=[]))
    with pytest.raises(HTTPException) as error:
        await _resolve_step_approver_ids(None, 1, {'assignee_rules': [{'type': 'role', 'value': 'empty', 'approvalMode': 'orSign'}]}, {}, {}, 9, 9)
    assert error.value.status_code == 409


def start_grouped(client, admin, groups, *, next_groups=None):
    def approval(node, entries):
        return {'type': 'approval', 'name': node, 'node_id': node,
            'assignee_rules': [{'id': f'{node}-{index}', 'type': 'user', 'value': [str(uid) for uid in members], 'approvalMode': mode}
                               for index, (mode, members) in enumerate(entries)]}
    steps = [{'type': 'start', 'name': '开始'}, approval('first', groups)]
    if next_groups:
        steps.append(approval('second', next_groups))
    steps.append({'type': 'end', 'name': '结束'})
    definition = _ok(client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True),
        json={'name': f'grouped-{admin}', 'status': 'published', 'steps': steps}), 'create grouped')
    return _ok(client.post(f"/api/v1/workflow/definitions/{definition['id']}/start", headers=_headers(admin, is_admin=True),
        json={'title': '混合审批方式'}), 'start grouped')['instance_id']


def act(client, instance, uid, action='approve'):
    return client.post(f'/api/v1/workflow/instances/{instance}/{action}', headers=_headers(uid), json={'comment': '处理'})


def test_mixed_group_modes_execute_and_overlap_is_retained(client):
    admin, a, b, c, d, e = [_uid() for _ in range(6)]
    _seed_users([admin, a, b, c, d, e], admin_uid=admin)
    instance = start_grouped(client, admin, [('orSign', [a, b]), ('countersign', [b, c]), ('single', [d, e])])
    assert act(client, instance, e).status_code == 403
    assert _ok(act(client, instance, a), 'or-sign')['status'] == 'pending'
    assert _ok(act(client, instance, d), 'single')['status'] == 'pending'
    assert _ok(act(client, instance, c), 'partial countersign')['status'] == 'pending'
    assert _ok(act(client, instance, b), 'all groups satisfied')['status'] == 'approved'


def test_satisfied_or_sign_closes_only_its_siblings_and_next_node_reassigns(client):
    admin, a, b, c = [_uid() for _ in range(4)]
    _seed_users([admin, a, b, c], admin_uid=admin)
    instance = start_grouped(client, admin, [('orSign', [a, b]), ('single', [c])], next_groups=[('single', [b])])
    assert _ok(act(client, instance, a), 'first group')['status'] == 'pending'
    assert act(client, instance, b).status_code == 409
    assert _ok(act(client, instance, c), 'next node')['status'] == 'pending'
    assert _ok(act(client, instance, b), 'second node')['status'] == 'approved'


def test_any_group_reject_ends_entire_node(client):
    admin, a, b = [_uid() for _ in range(3)]
    _seed_users([admin, a, b], admin_uid=admin)
    instance = start_grouped(client, admin, [('single', [a]), ('single', [b])])
    assert _ok(act(client, instance, a, 'reject'), 'reject')['status'] == 'rejected'
    assert act(client, instance, b).status_code == 409


def test_visual_graph_preserves_each_objects_mode():
    from app.api.workflow import _get_steps_from_workflow
    rules = [{'type': 'role', 'value': 'production', 'approvalMode': 'orSign'},
             {'type': 'role', 'value': 'quality', 'approvalMode': 'countersign'}]
    steps = _get_steps_from_workflow({'config': {
        'nodes': [{'id': 'start', 'type': 'startEvent'}, {'id': 'review', 'type': 'userTask', 'assigneeRules': rules}, {'id': 'end', 'type': 'endEvent'}],
        'edges': [{'source': 'start', 'target': 'review'}, {'source': 'review', 'target': 'end'}],
    }})
    assert steps[1]['assignee_rules'] == rules


def test_form_trigger_pins_group_membership(client):
    import asyncio
    import json
    from app.core.db import db_session
    from app.models.relational import Form, WorkflowDef, WorkflowBinding, WorkflowInstance
    from app.api.forms import _start_form_workflows

    admin, a, b = [_uid() for _ in range(3)]
    _seed_users([admin, a, b], admin_uid=admin)

    async def check():
        async with db_session() as db:
            form = Form(tenant_id=1, code=f'group-source-{admin}', name='组审批测试')
            definition = WorkflowDef(tenant_id=1, name=f'group-source-{admin}', status='published', version=1,
                config=json.dumps({'steps': [{'name': '审批', 'type': 'approval', 'node_id': 'review', 'assignee_rules': [
                    {'type': 'user', 'value': [str(a), str(b)], 'approvalMode': 'countersign'}]}, {'name': '结束', 'type': 'end'}]}))
            db.add_all([form, definition])
            await db.flush()
            db.add(WorkflowBinding(tenant_id=1, form_id=form.id, workflow_id=definition.id, trigger_action='submit', enabled=True))
            await db.flush()
            started = await _start_form_workflows(db, tenant_id=1, form=form, record_payload={'id': 123, 'data': {}}, user={'uid': admin, 'tenant_id': 1})
            instance = await db.get(WorkflowInstance, started[0]['instance_id'])
            state = json.loads(instance.workflow_state)
            assert state['current_approval_groups'][0]['user_ids'] == [a, b]
            assert state['current_approval_groups'][0]['mode'] == 'countersign'
            await db.rollback()

    asyncio.run(check())
