"""Bounded routing for visual workflows, using structured field conditions.

No source expressions are evaluated. Unsupported parallel execution is rejected
instead of silently turning parallel branches into sequential approvals.
"""
import ast
import re

from fastapi import HTTPException
from app.core.production_errors import coded_error
from app.services.form_rules import matches


APPROVAL_NODE_TYPES = ('userTask', 'manualTask', 'approval')


def _approval_route_error(detail, status=422):
    return coded_error(status, 'WORKFLOW_APPROVAL_ROUTE_INVALID', detail)


def _node_kind(node):
    data = node.get('data')
    return node.get('type') or (data.get('type') if isinstance(data, dict) else None)


def _start_bindings(config, starts):
    bindings = config.get('triggerBindings') or []
    if not isinstance(bindings, list) or any(not isinstance(binding, dict) for binding in bindings):
        raise HTTPException(422, '表单触发必须为对象列表')
    entries = {}
    for binding in bindings:
        if not binding.get('enabled'):
            continue
        action, start = binding.get('action'), binding.get('startNodeId')
        if not isinstance(action, str) or not action or action in entries:
            raise HTTPException(422, '启用的触发动作必须有唯一标识')
        if start not in starts:
            raise HTTPException(422, '有多个开始事件时，请为每个已启用的触发动作选择开始事件')
        entries[action] = start
    if not entries:
        raise HTTPException(422, '有多个开始事件时，请配置至少一个触发入口')
    return entries


def validate_graph(config, *, require_cc_recipients=False):
    steps = config.get('steps')
    if steps:
        if not isinstance(steps, list) or any(not isinstance(step, dict) for step in steps):
            raise HTTPException(422, '流程步骤必须为对象列表')
        kinds = [step.get('type') for step in steps]
        if kinds[0] != 'start' or kinds.count('start') != 1:
            raise HTTPException(422, '线性流程必须以唯一的开始事件为首个步骤')
        if kinds[-1] != 'end' or kinds.count('end') != 1:
            raise HTTPException(422, '线性流程必须以结束事件为最后一个步骤')
        return
    nodes, edges = config.get('nodes', []), config.get('edges') or []
    if not isinstance(nodes, list) or not isinstance(edges, list) or any(not isinstance(n, dict) for n in nodes) or any(not isinstance(e, dict) for e in edges):
        raise HTTPException(422, '流程节点和连线必须为对象列表')
    from app.services.workflow_dispatch import validate_actions
    validate_actions(config)
    if len(nodes) > 1000 or len(edges) > 4000:
        raise HTTPException(422, '流程节点或连线数量超出限制')
    ids = [n.get('id') for n in nodes]
    if not all(isinstance(key, str) and key for key in ids) or len(set(ids)) != len(ids):
        raise HTTPException(422, '流程节点标识缺失或重复')
    kinds = {node['id']: _node_kind(node) for node in nodes}
    if require_cc_recipients:
        from app.services.workflow_cc import validate_recipients
        for node in nodes:
            if kinds[node['id']] == 'ccTask':
                validate_recipients(node)
    if any(kind in ('parallelGateway', 'joinGateway') for kind in kinds.values()):
        raise HTTPException(422, '当前运行时尚不支持并行网关；请使用同一节点的多个审批组配置会签或或签')
    starts = [key for key, kind in kinds.items() if kind in ('startEvent', 'start')]
    ends = {key for key, kind in kinds.items() if kind in ('endEvent', 'end')}
    if not starts:
        raise HTTPException(422, '可视流程必须包含至少一个开始事件')
    if not ends:
        raise HTTPException(422, '可视流程必须包含至少一个结束事件')
    outgoing = {}
    incoming = {}
    for edge in edges:
        if not isinstance(edge.get('priority', 999), (int, float)):
            raise HTTPException(422, '流程连线优先级必须为数字')
        source, target = edge.get('source') or edge.get('fromId'), edge.get('target') or edge.get('toId')
        if source not in ids or target not in ids:
            raise HTTPException(422, '流程连线指向不存在的节点')
        outcome = edge.get('approvalOutcome')
        if outcome is not None and (outcome not in ('approve', 'reject') or kinds[source] not in APPROVAL_NODE_TYPES):
            raise _approval_route_error('审批结果只能在审批节点的出线上配置，且必须是通过或驳回')
        outgoing.setdefault(source, []).append(edge)
        incoming.setdefault(target, []).append(source)
    for node in nodes:
        routes = outgoing.get(node['id'], [])
        kind = kinds[node['id']]
        rejection_target = node.get('rejectionTargetId')
        if rejection_target is not None:
            downstream = {edge.get('target') or edge.get('toId') for edge in routes}
            neighbors = downstream | set(incoming.get(node['id'], []))
            if (kind not in APPROVAL_NODE_TYPES or not isinstance(rejection_target, str)
                    or rejection_target == node['id'] or rejection_target not in neighbors):
                raise _approval_route_error('自定义驳回目标必须是与该审批节点直接相连的前置或后续节点')
        if kind in APPROVAL_NODE_TYPES and any(edge.get('approvalOutcome') for edge in routes):
            outcomes = [edge.get('approvalOutcome') or 'approve' for edge in routes]
            if outcomes.count('approve') != 1 or outcomes.count('reject') > 1:
                raise _approval_route_error('审批节点必须有一条通过连线，且最多有一条驳回连线')
        elif len(routes) > 1 and kind != 'exclusiveGateway':
            raise HTTPException(422, '多条分支必须通过条件网关配置')
        if kind == 'exclusiveGateway' and sum(bool(e.get('isDefault')) for e in routes) > 1:
            raise HTTPException(422, '条件网关只能有一条默认路径')

    visited = set()
    pending = list(ends)
    while pending:
        node_id = pending.pop()
        if node_id in visited:
            continue
        visited.add(node_id)
        pending.extend(incoming.get(node_id, []))
    if any(start not in visited for start in starts):
        raise HTTPException(422, '每个开始事件必须连接到至少一个结束事件')
    if any(edge.get('approvalOutcome') and (edge.get('target') or edge.get('toId')) not in visited for edge in edges):
        raise _approval_route_error('每条审批结果连线都必须通往结束事件')
    if len(starts) > 1:
        _start_bindings(config, starts)


def _condition(edge):
    field = edge.get('conditionField')
    if field:
        return {'field': field, 'operator': {'empty': 'isEmpty'}.get(edge.get('conditionOperator'), edge.get('conditionOperator') or 'eq'),
                'value': edge.get('conditionValue')}
    expression = edge.get('condition')
    if not expression:
        return None
    if isinstance(expression, dict):
        return expression
    # Compatibility with expressions generated by the visual designer.
    # Parse only its fixed field/operator/literal grammar, never execute code.
    expression = str(expression).strip()
    if len(expression) > 1000:
        raise HTTPException(422, '流程条件过长')
    empty = re.fullmatch(r'(!{1,2})([A-Za-z_]\w*)', expression)
    if empty:
        return {'field': empty[2], 'operator': 'isEmpty' if empty[1] == '!' else 'notEmpty'}
    compare = re.fullmatch(r'([A-Za-z_]\w*)\s*(==|!=|>=|<=|>|<)\s*(.+)', expression)
    includes = re.fullmatch(r'([A-Za-z_]\w*)\.includes\((.+)\)', expression)
    if not compare and not includes:
        raise HTTPException(422, '流程条件必须使用字段条件编辑器配置')
    text = compare[3] if compare else includes[2]
    try:
        value = {'true': True, 'false': False, 'null': None}[text] if text in {'true', 'false', 'null'} else ast.literal_eval(text)
        if not isinstance(value, (str, int, float, bool, type(None))):
            raise ValueError()
    except (ValueError, SyntaxError, TypeError):
        raise HTTPException(422, '流程条件值必须为文本、数字或布尔值')
    return {'field': compare[1] if compare else includes[1],
            'operator': {'==': 'eq', '!=': 'ne', '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt'}[compare[2]] if compare else 'contains',
            'value': value}


def route_node_ids(config, data, *, trigger_action=None):
    validate_graph(config)
    nodes = {n['id']: n for n in config.get('nodes') or []}
    starts = [key for key, node in nodes.items() if _node_kind(node) in ('startEvent', 'start')]
    current = starts[0] if len(starts) == 1 else None
    if len(starts) > 1:
        entries = _start_bindings(config, starts)
        current = entries.get(trigger_action if trigger_action is not None else 'submit')
        if current is None and trigger_action is None and len(set(entries.values())) == 1:
            current = next(iter(entries.values()))
        if current is None:
            raise HTTPException(409, '未为当前触发动作配置开始事件')
    return _follow_route(config, nodes, data, current)


def rejection_route(config, data, path):
    """Keep the executed visits and resolve an explicit or default return."""
    if config.get('steps') or not path:
        return None
    current = path[-1]
    nodes = {node['id']: node for node in config.get('nodes') or []}
    target = nodes.get(current, {}).get('rejectionTargetId')
    edges = config.get('edges') or []
    if target is None:
        if any(edge.get('approvalOutcome') == 'reject' and (edge.get('source') or edge.get('fromId')) == current
               for edge in edges):
            validate_graph(config)
            return _follow_route(config, nodes, data, current, path=path[:-1], reject_at=current)
        target = _previous_return_node(nodes, edges, path)
    if target is None:
        return None
    validate_graph(config)
    if _node_kind(nodes[target]) in ('startEvent', 'start'):
        return [*path, target]
    # A return may revisit earlier nodes. The new forward path must still be acyclic.
    try:
        return [*path, *_follow_route(config, nodes, data, target)]
    except HTTPException as error:
        if error.status_code == 409:
            raise _approval_route_error(f'驳回后无法继续。{error.detail}', 409) from error
        raise


def _previous_return_node(nodes, edges, path):
    # Keep the route of the current round. Revisiting an earlier node rewinds
    # that route without removing any visits from the recorded history.
    active_route = {}
    for node in path:
        if node in active_route:
            while next(reversed(active_route)) != node:
                active_route.popitem()
        else:
            active_route[node] = None
    connections = {(edge.get('source') or edge.get('fromId'), edge.get('target') or edge.get('toId'))
                   for edge in edges}
    route = list(active_route)
    for source, target in zip(reversed(route[:-1]), reversed(route[1:])):
        if (source, target) not in connections:
            return None
        if _node_kind(nodes[source]) in (*APPROVAL_NODE_TYPES, 'startEvent', 'start'):
            return source
    return None


def _follow_route(config, nodes, data, current, *, path=None, reject_at=None):
    path = list(path or [])
    visited = set(path)
    visited.discard(reject_at)
    outgoing = {}
    for edge in config.get('edges') or []:
        outgoing.setdefault(edge.get('source') or edge.get('fromId'), []).append(edge)
    while current:
        if current in visited:
            if reject_at is not None:
                raise _approval_route_error('驳回路径回到了已处理的节点，请检查连线', 409)
            raise HTTPException(409, '流程存在循环，无法启动审批')
        path.append(current)
        visited.add(current)
        if _node_kind(nodes[current]) in ('endEvent', 'end'):
            return path
        routes = sorted(outgoing.get(current, []), key=lambda e: (e.get('priority', 999), str(e.get('id', ''))))
        selected = None
        defaults = []
        for edge in routes:
            outcome = edge.get('approvalOutcome') or 'approve'
            if (outcome == 'reject') != (current == reject_at):
                continue
            if edge.get('isDefault'):
                defaults.append(edge)
                continue
            condition = _condition(edge)
            if condition:
                condition = dict(condition)
                actual = data.get(condition.get('field') or condition.get('sourceField'))
                if isinstance(actual, bool) and str(condition.get('value')).lower() in {'true', 'false'}:
                    condition['value'] = str(condition['value']).lower() == 'true'
            if condition is None or matches(condition, data):
                selected = edge
                break
        if selected is None and defaults:
            selected = defaults[0]
        if selected is None:
            if reject_at is not None:
                raise _approval_route_error(f'驳回路径的节点 {current} 没有符合条件的后续连线', 409)
            raise HTTPException(409, f'流程节点 {current} 没有符合条件的后续路径')
        current = selected.get('target') or selected.get('toId')
    raise HTTPException(409, '流程没有有效结束节点')
