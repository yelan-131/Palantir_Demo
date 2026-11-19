import copy

import pytest
from fastapi import HTTPException
from app.services.workflow_views import _workflow_config_steps, _instance_steps
from app.services.workflow_routing import rejection_route, route_node_ids, validate_graph
from tests.test_workflow import client, _definition_payload, _uid, _seed_users, _headers, _ok


def graph(a=1, b=2):
    return {'nodes': [
        {'id': 'start', 'type': 'startEvent'}, {'id': 'gate', 'type': 'exclusiveGateway'},
        {'id': 'low', 'type': 'userTask', 'assigneeRules': [{'type': 'user', 'value': [str(a)]}]},
        {'id': 'high', 'type': 'userTask', 'assigneeRules': [{'type': 'user', 'value': [str(b)]}]},
        {'id': 'final', 'type': 'userTask', 'assigneeRules': [{'type': 'user', 'value': [str(a)]}]},
        {'id': 'end', 'type': 'endEvent'}],
        'edges': [{'source': 'start', 'target': 'gate'},
                  {'source': 'gate', 'target': 'low', 'isDefault': True, 'priority': 0},
                  {'source': 'gate', 'target': 'high', 'conditionField': 'amount', 'conditionOperator': 'gte', 'conditionValue': '10000'},
                  {'source': 'low', 'target': 'final'}, {'source': 'high', 'target': 'final'},
                  {'source': 'final', 'target': 'end'}]}


@pytest.mark.parametrize('amount,branch', [(9999, 'low'), (10000, 'high'), (10001, 'high'), ('10000', 'high'), (None, 'low')])
def test_branch_boundaries_default_is_fallback_not_first_choice(amount, branch):
    config = graph()
    assert route_node_ids(config, {'amount': amount}) == ['start', 'gate', branch, 'final', 'end']
    steps = _workflow_config_steps(config, {'amount': amount})
    assert [step['node_id'] for step in steps] == ['start', 'gate', branch, 'final', 'end']
    assert steps[2]['assignee_rules'][0]['value'] == ['1' if branch == 'low' else '2']


@pytest.mark.parametrize('operator,value,expected,branch', [
    ('eq', 'yes', 'yes', 'high'), ('ne', 'no', 'yes', 'high'),
    ('contains', ['yes', 'no'], 'yes', 'high'), ('empty', None, '', 'high'),
    ('not_empty', 'yes', '', 'high'), ('eq', True, 'true', 'high'),
    ('lt', 5, '5', 'low'), ('lte', 5, '5', 'high'), ('gt', 5, '5', 'low'),
])
def test_visual_designer_condition_operators(operator, value, expected, branch):
    config = graph()
    config['edges'][2].update(conditionOperator=operator, conditionValue=expected)
    assert route_node_ids(config, {'amount': value})[2] == branch


@pytest.mark.parametrize('expression,data,branch', [
    ("amount >= '10000'", {'amount': 10000}, 'high'),
    ("amount == 'yes'", {'amount': 'yes'}, 'high'),
    ("amount.includes('yes')", {'amount': ['yes']}, 'high'),
    ('!amount', {}, 'high'), ('!!amount', {'amount': 'present'}, 'high'),
])
def test_legacy_designer_expression_grammar(expression, data, branch):
    config = graph()
    config['edges'][2] = {'source': 'gate', 'target': 'high', 'condition': expression}
    assert route_node_ids(config, data)[2] == branch


def test_conditions_cannot_execute_source_code_or_ambiguous_graphs():
    config = graph()
    config['edges'][2] = {'source': 'gate', 'target': 'high', 'condition': "__import__('os').system('false')"}
    with pytest.raises(HTTPException) as error:
        route_node_ids(config, {})
    assert error.value.status_code == 422
    for mutation in [
        lambda c: c['nodes'][1].update(type='parallelGateway'),
        lambda c: c['edges'][2].update(isDefault=True),
        lambda c: c['edges'][0].update(target='missing'),
        lambda c: c['nodes'].append(copy.deepcopy(c['nodes'][0])),
    ]:
        config = graph(); mutation(config)
        with pytest.raises(HTTPException): validate_graph(config)


def test_unmatched_paths_and_cycles_fail_instead_of_finishing_or_choosing_arbitrarily():
    config = graph(); config['edges'].pop(1)
    with pytest.raises(HTTPException) as error: route_node_ids(config, {'amount': 1})
    assert error.value.status_code == 409
    config = graph(); config['edges'][3]['target'] = 'start'
    with pytest.raises(HTTPException) as error: route_node_ids(config, {'amount': 1})
    assert error.value.status_code == 409


def test_pinned_route_is_used_and_preexisting_instances_keep_original_order():
    config = graph()
    old_order = [step['node_id'] for step in _workflow_config_steps(config)]
    assert [step['node_id'] for step in _instance_steps(config, {})] == old_order
    route = ['start', 'gate', 'high', 'final', 'end']
    assert [step['node_id'] for step in _instance_steps(config, {'execution_node_ids': route})] == route


def test_graph_route_executes_only_selected_branch_and_is_version_pinned(client):
    admin, initiator, a, b = [_uid() for _ in range(4)]
    _seed_users([admin, initiator, a, b], admin_uid=admin)
    config = graph(a, b)
    definition = _ok(client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True),
        json={'name': '条件流', 'status': 'published', 'config': config}), 'create')
    started = _ok(client.post(f'/api/v1/workflow/definitions/{definition["id"]}/start', headers=_headers(initiator),
        json={'title': '大额分流', 'form_data': {'amount': 10000}}), 'start')
    iid = started['instance_id']
    get = lambda: _ok(client.get(f'/api/v1/workflow/instances/{iid}', headers=_headers(initiator)), 'detail')
    assert get()['workflow_state']['current_assignee_ids'] == [b]
    assert [step['node_id'] for step in get()['steps']] == ['start', 'gate', 'high', 'final', 'end']
    changed = graph(a, b); changed['edges'][2]['conditionValue'] = '20000'
    _ok(client.put(f'/api/v1/workflow/definitions/{definition["id"]}', headers=_headers(admin, is_admin=True),
        json={'name': '修改条件后的流', 'config': changed}), 'publish new version')
    assert client.post(f'/api/v1/workflow/instances/{iid}/approve', headers=_headers(a), json={}).status_code == 403
    _ok(client.post(f'/api/v1/workflow/instances/{iid}/approve', headers=_headers(b), json={}), 'high route')
    assert get()['workflow_state']['current_assignee_ids'] == [a]
    _ok(client.post(f'/api/v1/workflow/instances/{iid}/approve', headers=_headers(a), json={}), 'shared final')
    assert get()['status'] == 'approved'
    assert [a['node_id'] for a in get()['approvals']] == ['high', 'final']


def test_parallel_graph_cannot_be_published_as_a_misleading_sequential_flow(client):
    admin = _uid(); _seed_users([admin], admin_uid=admin)
    config = graph(); config['nodes'][1]['type'] = 'parallelGateway'
    response = client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True),
        json={'name': '不支持的并行网关', 'status': 'published', 'config': config})
    assert response.status_code == 422
    assert '并行网关' in response.json()['detail']


@pytest.mark.parametrize('action, target, status', [
    ('approve', 'passed', 'approved'),
    ('reject', 'rejection-end', 'rejected'),
    ('reject', 'review', 'pending'),
])
def test_approval_actions_follow_the_configured_outcome_edge(client, action, target, status):
    admin, initiator, approver, reviewer = [_uid() for _ in range(4)]
    _seed_users([admin, initiator, approver, reviewer], admin_uid=admin)
    config = {
        'nodes': [
            {'id': 'start', 'type': 'startEvent'},
            {'id': 'approval', 'type': 'userTask', 'assigneeRules': [{'type': 'user', 'value': str(approver)}]},
            {'id': 'review', 'type': 'userTask', 'assigneeRules': [{'type': 'user', 'value': str(reviewer)}]},
            *[{'id': end, 'type': 'endEvent'} for end in ('passed', 'rejection-end')],
        ],
        'edges': [
            {'source': 'start', 'target': 'approval'},
            {'source': 'approval', 'target': 'passed', 'approvalOutcome': 'approve', 'label': '自定义连线名称'},
            {'source': 'approval', 'target': target if action == 'reject' else 'review', 'approvalOutcome': 'reject', 'priority': 1},
            {'source': 'review', 'target': 'passed'},
        ],
    }
    definition = _ok(client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True),
        json={'name': '按审批结果分流', 'status': 'published', 'config': config}), 'publish')
    started = _ok(client.post(f'/api/v1/workflow/definitions/{definition["id"]}/start', headers=_headers(initiator),
        json={'title': '审批结果连线'}), 'start')
    resource = f'/api/v1/workflow/instances/{started["instance_id"]}'
    _ok(client.post(f'{resource}/{action}', headers=_headers(approver), json={'comment': '测试审批'}), action)
    detail = _ok(client.get(resource, headers=_headers(initiator)), 'detail')
    assert detail['status'] == status
    expected = ['start', 'approval', target] + (['passed'] if target == 'review' else [])
    assert detail['workflow_state']['execution_node_ids'] == expected
    if target == 'review':
        assert detail['workflow_state']['current_assignee_ids'] == [reviewer]
        result = _ok(client.post(f'{resource}/approve', headers=_headers(reviewer), json={}), 'review')
        assert result['status'] == 'approved'


def test_duplicate_outcome_is_rejected_at_publish_with_a_diagnostic_code(client):
    admin = _uid()
    _seed_users([admin], admin_uid=admin)
    config = graph()
    config['edges'].append({'source': 'final', 'target': 'end', 'approvalOutcome': 'approve'})
    response = client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True),
        json={'name': '重复通过连线', 'status': 'published', 'config': config})
    assert response.status_code == 422
    assert '一条通过连线' in response.json()['detail']
    assert response.headers['x-error-code'] == 'WORKFLOW_APPROVAL_ROUTE_INVALID'


def test_custom_rejection_requires_a_direct_neighbor_and_can_target_start_or_next():
    config = graph()
    path = route_node_ids(config, {'amount': 1})
    pre_review = config['nodes'][2]
    pre_review['rejectionTargetId'] = 'start'
    with pytest.raises(HTTPException, match='直接相连'):
        validate_graph(config)
    pre_review['rejectionTargetId'] = 'final'
    assert rejection_route(config, {'amount': 1}, path[:3]) == path
    config['nodes'][4]['rejectionTargetId'] = 'end'
    assert rejection_route(config, {'amount': 1}, path[:-1]) == path
    config['edges'][0]['target'] = 'low'
    pre_review['rejectionTargetId'] = 'start'
    assert rejection_route(config, {'amount': 1}, ['start', 'low']) == ['start', 'low', 'start']


@pytest.mark.parametrize('custom_target', [False, True])
def test_rejection_reopens_prior_approval_with_fresh_votes_and_notification(client, custom_target):
    admin, initiator, first, second, final = [_uid() for _ in range(5)]
    _seed_users([admin, initiator, first, second, final], admin_uid=admin)
    config = {
        'nodes': [
            {'id': 'start', 'type': 'startEvent'},
            {'id': 'review', 'type': 'userTask', 'approvalMode': 'countersign',
             'assigneeRules': [{'type': 'user', 'value': [str(first), str(second)]}]},
            {'id': 'final', 'type': 'userTask', 'rejectionTargetId': 'review',
             'assigneeRules': [{'type': 'user', 'value': str(final)}]},
            {'id': 'end', 'type': 'endEvent'},
        ],
        'edges': [
            {'source': 'start', 'target': 'review'}, {'source': 'review', 'target': 'final'},
            {'source': 'final', 'target': 'end'},
        ],
    }
    if not custom_target:
        config['nodes'][2].pop('rejectionTargetId')
    definition = _ok(client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True),
        json={'name': '退回上一节点', 'status': 'published', 'config': config}), 'publish')
    started = _ok(client.post(f'/api/v1/workflow/definitions/{definition["id"]}/start', headers=_headers(initiator),
        json={'title': '退回重新会签'}), 'start')
    resource = f'/api/v1/workflow/instances/{started["instance_id"]}'

    def act(uid, action, node, step):
        return client.post(f'{resource}/act', headers=_headers(uid), json={
            'action': action, 'expected_node_id': node, 'expected_step': step, 'comment': '测试退回',
        })

    _ok(act(first, 'approve', 'review', 1), 'first initial vote')
    _ok(act(second, 'approve', 'review', 1), 'second initial vote')
    result = _ok(act(final, 'reject', 'final', 2), 'return to review')
    assert (result['status'], result['current_step']) == ('pending', 3)
    feed = _ok(client.get('/api/v1/workflow/notifications', headers=_headers(first)), 'review reminders')
    links = [row['link'] for row in feed['data'] if row['resource_id'] == started['instance_id'] and row['type'] == 'approval']
    assert len(links) == 2
    assert any(link.endswith('node_id=review&step=3') for link in links)
    assert act(first, 'approve', 'review', 1).status_code == 409
    assert _ok(act(first, 'approve', 'review', 3), 'new vote')['current_step'] == 3
    assert _ok(act(second, 'approve', 'review', 3), 'new second vote')['current_step'] == 4
    assert _ok(act(final, 'approve', 'final', 4), 'final approve')['status'] == 'approved'
    detail = _ok(client.get(resource, headers=_headers(initiator)), 'approval history')
    assert [row['action'] for row in detail['approvals']] == ['approve', 'approve', 'reject', 'approve', 'approve', 'approve']


@pytest.mark.parametrize('amount, branch', [(1, 'low'), (10001, 'high')])
def test_default_rejection_uses_the_actual_incoming_route_after_a_return(amount, branch):
    config = graph()
    data = {'amount': amount}
    path = route_node_ids(config, data)
    returned = rejection_route(config, data, path[:-1])
    assert returned == ['start', 'gate', branch, 'final', branch, 'final', 'end']
    # The gateway is passed on return to the trigger, and the old reviewer
    # that sent the record back is no longer the predecessor of this round.
    assert rejection_route(config, data, returned[:5]) == [*returned[:5], 'start']


@pytest.mark.parametrize('endpoint', ['approve', 'act'])
def test_old_page_cannot_approve_another_node_assigned_to_same_person(client, endpoint):
    admin, initiator, a = [_uid() for _ in range(3)]
    _seed_users([admin, initiator, a], admin_uid=admin)
    definition = _ok(client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True),
        json=_definition_payload('同一人连续审批', [[a], [a]])), 'create')
    started = _ok(client.post(f'/api/v1/workflow/definitions/{definition["id"]}/start', headers=_headers(initiator), json={'title': '防止旧页面重复审批'}), 'start')
    iid = started['instance_id']
    payload = {'expected_node_id': 'approval-1', 'action': 'approve'}
    _ok(client.post(f'/api/v1/workflow/instances/{iid}/{endpoint}', headers=_headers(a), json=payload), 'first step')
    assert client.post(f'/api/v1/workflow/instances/{iid}/{endpoint}', headers=_headers(a), json=payload).status_code == 409
    detail = _ok(client.get(f'/api/v1/workflow/instances/{iid}', headers=_headers(initiator)), 'detail')
    assert detail['status'] == 'pending'
    assert detail['workflow_state']['current_node'] == 'approval-2'
    assert len([row for row in detail['approvals'] if row['action'] == 'approve']) == 1


def test_workflow_detail_does_not_truncate_a_form_after_twelve_fields():
    from types import SimpleNamespace
    from app.services.workflow_views import _field_summary
    fields = [SimpleNamespace(field_name=f'field_{i}', id=i) for i in range(13)]
    data = {field.field_name: 'value' for field in fields}
    assert len(_field_summary(fields, data, limit=None)) == 13
    assert len(_field_summary(fields, data)) == 4
