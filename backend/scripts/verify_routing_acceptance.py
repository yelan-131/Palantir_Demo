"""Live gateway routing checks; uses only dedicated UAT workflow definitions."""
import json
import os
import copy
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4
import httpx

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / 'outputs/business-acceptance-20261026.json'


def main():
    report = json.loads(REPORT.read_text())
    credentials = json.loads(Path('/private/tmp/manufoundry-uat-20261026-credentials.json').read_text())
    ids = {k.rsplit('_', 1)[1]: v for k, v in report['entities']['users'].items()}
    clients = {}
    run = {'id': uuid4().hex[:8], 'checks': []}
    report.setdefault('routing_runs', []).append(run)
    def call(who, method, path, payload=None):
        response = clients[who].request(method, path, json=payload)
        response.raise_for_status()
        return response.json()
    def check(name, actual, expected):
        passed = actual == expected
        run['checks'].append(dict(name=name, actual=actual, expected=expected, passed=passed))
        print(('PASS ' if passed else 'FAIL ') + name + ('' if passed else f': {actual!r} != {expected!r}'), flush=True)
        run['summary'] = {'passed': sum(c['passed'] for c in run['checks']), 'failed': sum(not c['passed'] for c in run['checks'])}
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    def node(key, actor):
        return {'id': key, 'type': 'userTask', 'label': key,
                'assigneeRules': [{'type': 'user', 'value': [str(ids[actor])], 'approvalMode': 'single'}]}
    try:
        for who in ['admin', 'a', 'd', 'e']:
            clients[who] = httpx.Client(base_url=report['environment'], trust_env=False, timeout=60)
            call(who, 'POST', '/auth/login', {'username': 'admin' if who == 'admin' else credentials['users'][who],
                 'password': os.environ['UAT_ADMIN_PASSWORD'] if who == 'admin' else credentials['password']})
        config = {'nodes': [{'id': 'start', 'type': 'startEvent', 'label': '申请提交'}, {'id': 'gate', 'type': 'exclusiveGateway', 'label': '数据量是否达到10000条'},
                            node('普通数据D审核', 'd'), node('大量数据E加审', 'e'), node('共同终审D', 'd'),
                            {'id': 'end', 'type': 'endEvent', 'label': '审批完成'}],
                  'edges': [{'id': 'start-gate', 'source': 'start', 'target': 'gate'},
                            {'id': 'default', 'source': 'gate', 'target': '普通数据D审核', 'isDefault': True},
                            {'id': 'large', 'source': 'gate', 'target': '大量数据E加审', 'conditionField': 'estimated_rows',
                             'conditionOperator': 'gte', 'conditionValue': '10000', 'condition': "estimated_rows >= '10000'", 'priority': 1},
                            {'id': 'low-final', 'source': '普通数据D审核', 'target': '共同终审D'},
                            {'id': 'high-final', 'source': '大量数据E加审', 'target': '共同终审D'},
                            {'id': 'final-end', 'source': '共同终审D', 'target': 'end'}]}
        definition = call('admin', 'POST', '/workflow/definitions', {
            'name': f'【复杂验收】条件分流-{run["id"]}', 'status': 'published', 'config': config})
        run['definition_id'] = definition['id']
        for value, who in [(9999, 'd'), (10000, 'e'), (10001, 'e')]:
            started = call('a', 'POST', f'/workflow/definitions/{definition["id"]}/start', {
                'title': f'【复杂验收】分流边界-{value}', 'form_data': {'estimated_rows': value}})
            instance = started['instance_id']; detail = call('admin', 'GET', f'/workflow/instances/{instance}')
            check(f'Value {value} routes only to {who}', detail['workflow_state']['current_assignee_ids'], [ids[who]])
            if detail['workflow_state']['current_assignee_ids'] == [ids[who]]:
                call(who, 'POST', f'/workflow/instances/{instance}/approve', {'comment': '【验收】所选分支通过'})
                after = call('admin', 'GET', f'/workflow/instances/{instance}')
                check(f'Value {value} goes directly to shared final review', after['workflow_state']['current_node'], '共同终审D')
                call('d', 'POST', f'/workflow/instances/{instance}/approve', {'comment': '【验收】终审通过'})
                check(f'Value {value} route finishes without unselected branch', call('admin', 'GET', f'/workflow/instances/{instance}')['status'], 'approved')
        # Bind a real graph to the 13-control complex UAT form. Old pending
        # instances continue on their pinned definition snapshots.
        fid = report['entities']['forms']['uat-complex-20261026']
        bound = report['complex_runs'][-1]['workflow_id']
        linked = copy.deepcopy(config)
        linked['name'] = '复杂申请：数量分流与分组审批'
        linked['domainCode'] = f'form-approval:{fid}'
        high = next(n for n in linked['nodes'] if n['id'] == '大量数据E加审')
        high['label'] = '大量数据：或签与角色会签'
        high['fieldPermissions'] = {'secret': {'visible': False, 'editable': False}}
        high['assigneeRules'] = [
            {'type': 'user', 'value': [str(ids['d']), str(ids['e'])], 'approvalMode': 'orSign'},
            {'type': 'role', 'value': 'uat_20261026_approver', 'approvalMode': 'countersign'}]
        linked['nodes'].append(node('E独立复核', 'e'))
        next(e for e in linked['edges'] if e['id'] == 'high-final')['target'] = 'E独立复核'
        linked['edges'].append({'id': 'review-final', 'source': 'E独立复核', 'target': '共同终审D'})
        positions = {'start': (420, 60), 'gate': (420, 180), '普通数据D审核': (160, 320),
                     '大量数据E加审': (680, 320), 'E独立复核': (680, 460), '共同终审D': (420, 600), 'end': (420, 740)}
        for n in linked['nodes']:
            n['x'], n['y'] = positions[n['id']]
        def publish(body):
            call('admin', 'PUT', f'/workflow/definitions/{bound}', {
                'name': '复杂申请：数量分流、角色会签与独立复核', 'status': 'published', 'config': body})
        publish(linked)
        run['bound_definition_id'] = bound
        run['form_id'] = fid
        run['source_records'] = []
        def new_record(amount, label):
            payload = {'title': f'【条件分流验收】{label}-{run["id"]}', 'org_unit_id': report['entities']['orgs']['uat_20261026_dept_a'],
                'applicant_id': str(ids['a']), 'request_type': 'data_access', 'priority': 'normal',
                'expected_date': (date.today() + timedelta(days=5)).isoformat(), 'data_categories': ['production', 'quality'],
                'requested_scope': 'department', 'estimated_rows': amount, 'contains_sensitive': False,
                'purpose': '虚构数据：通过真实表单提交验证条件分支、角色会签与事务回滚。', 'secret': '分流测试内部备注'}
            row = call('a', 'POST', f'/forms/{fid}/records', {'data': payload})['data']
            path = f'/forms/{fid}/records/{row["id"]}'
            run['source_records'].append({'id': row['id'], 'label': label})
            return path
        for amount in [9999, 10000, 10001]:
            path = new_record(amount, f'边界{amount}')
            row = call('a', 'POST', path + '/submit', {'expected_status': 'draft'})['data']
            instance = row['_approval']['workflow_id']
            detail = call('admin', 'GET', f'/workflow/instances/{instance}')
            expected = [ids['d']] if amount < 10000 else sorted([ids['d'], ids['e']])
            check(f'Form submit {amount} selects correct branch and role members', sorted(detail['workflow_state']['current_assignee_ids']), expected)
            if amount >= 10000:
                check(f'Node visibility {amount}: reviewer cannot read hidden note through source record',
                      'secret' in call('d', 'GET', path)['data']['data'], False)
                check(f'Node visibility {amount}: workflow snapshot also excludes hidden note',
                      'secret' in call('d', 'GET', f'/workflow/instances/{instance}')['form_data'], False)
            first_node = detail['workflow_state']['current_node']
            actors = ['d', 'd'] if amount < 10000 else ['d', 'e', 'e', 'd']
            for i, actor in enumerate(actors):
                before = call('admin', 'GET', f'/workflow/instances/{instance}')
                body = {'comment': f'【条件分流验收】{actor}处理', 'expected_node_id': before['workflow_state']['current_node']}
                call(actor, 'POST', f'/workflow/instances/{instance}/act', {**body, 'action': 'approve'})
                if i == 0 and amount < 10000:
                    replay = clients['d'].post(f'/workflow/instances/{instance}/act', json={**body, 'action': 'approve'})
                    check('Old D page cannot accidentally approve next D node', replay.status_code, 409)
            check(f'Form submit {amount} source record finishes approved', call('a', 'GET', path)['data']['status'], 'approved')
            history = call('admin', 'GET', f'/workflow/instances/{instance}')['approvals']
            absent = '大量数据E加审' if amount < 10000 else '普通数据D审核'
            check(f'Form submit {amount} never created unselected branch tasks', any(a['node_id'] == absent for a in history), False)

        # An unavailable fixed reviewer must roll back submission atomically.
        path = new_record(10000, '审批人停用时禁止提交')
        call('admin', 'PUT', f'/admin/users/{ids["d"]}', {'is_active': False})
        try:
            rejected = clients['a'].post(path + '/submit', json={'expected_status': 'draft'})
            check('Disabled configured approver blocks submission', rejected.status_code, 409)
            saved = call('a', 'GET', path)['data']
            check('Failed submission preserves draft status', saved['status'], 'draft')
            check('Failed submission has no workflow or submit history', saved['_approval']['workflow_id'], None)
        finally:
            call('admin', 'PUT', f'/admin/users/{ids["d"]}', {'is_active': True})
        broken = copy.deepcopy(linked)
        next(n for n in broken['nodes'] if n['id'] == '大量数据E加审')['assigneeRules'] = [
            {'type': 'role', 'value': 'uat_nonexistent_empty_role', 'approvalMode': 'countersign'}]
        publish(broken)
        try:
            rejected = clients['a'].post(path + '/submit', json={'expected_status': 'draft'})
            check('Empty role cannot fall back to applicant', rejected.status_code, 409)
            check('Empty role submission stays draft', call('a', 'GET', path)['data']['status'], 'draft')
        finally:
            publish(linked)
        final_definition = call('admin', 'GET', f'/workflow/definitions/{bound}')
        current = call('admin', 'GET', f'/forms/{fid}?schema=draft&scope=designer')['data']
        call('admin', 'PUT', f'/forms/{fid}', {'config': {**current['config'], 'workflowDesigner': {
            'draftWorkflowId': bound, 'publishedWorkflowId': bound, 'publishedVersion': final_definition['version']}}})
        call('admin', 'POST', f'/forms/{fid}/publish')
        # Cancel only the known synthetic instance from the pre-fix failure.
        for old in report['routing_runs'][:-1]:
            if old.get('summary', {}).get('failed'):
                rows = call('admin', 'GET', f'/workflow/instances?workflow_id={old["definition_id"]}')['data']
                for row in rows:
                    if row['status'] == 'pending':
                        call('admin', 'POST', f'/workflow/instances/{row["id"]}/cancel')
        print('SUMMARY ' + json.dumps(run['summary']), flush=True)
    finally:
        for client in clients.values(): client.close()


if __name__ == '__main__':
    main()
