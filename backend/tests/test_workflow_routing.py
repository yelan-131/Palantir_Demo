import copy

import pytest
from fastapi import HTTPException
from app.api.workflow import _workflow_config_steps, _instance_steps
from app.services.workflow_routing import route_node_ids, validate_graph
from tests.test_workflow import client, _uid, _seed_users, _headers, _ok


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


@pytest.mark.parametrize('endpoint', ['approve', 'act'])
def test_old_page_cannot_approve_another_node_assigned_to_same_person(client, endpoint):
    admin, initiator, a = [_uid() for _ in range(3)]
    _seed_users([admin, initiator, a], admin_uid=admin)
    definition = _ok(client.post('/api/v1/workflow/definitions', headers=_headers(admin, is_admin=True), json={
        'name': '同一人连续审批', 'status': 'published', 'steps': [
            {'type': 'approval', 'node_id': key, 'assignee_rules': [{'type': 'user', 'value': [str(a)]}]}
            for key in ['first', 'second']]}), 'create')
    started = _ok(client.post(f'/api/v1/workflow/definitions/{definition["id"]}/start', headers=_headers(initiator), json={'title': '防止旧页面重复审批'}), 'start')
    iid = started['instance_id']
    payload = {'expected_node_id': 'first', 'action': 'approve'}
    _ok(client.post(f'/api/v1/workflow/instances/{iid}/{endpoint}', headers=_headers(a), json=payload), 'first step')
    assert client.post(f'/api/v1/workflow/instances/{iid}/{endpoint}', headers=_headers(a), json=payload).status_code == 409
    detail = _ok(client.get(f'/api/v1/workflow/instances/{iid}', headers=_headers(initiator)), 'detail')
    assert detail['status'] == 'pending'
    assert detail['workflow_state']['current_node'] == 'second'
    assert len([row for row in detail['approvals'] if row['action'] == 'approve']) == 1


def test_workflow_detail_does_not_truncate_a_form_after_twelve_fields():
    from types import SimpleNamespace
    from app.api.workflow import _field_summary
    fields = [SimpleNamespace(field_name=f'field_{i}', id=i) for i in range(13)]
    data = {field.field_name: 'value' for field in fields}
    assert len(_field_summary(fields, data, limit=None)) == 13
    assert len(_field_summary(fields, data)) == 4
