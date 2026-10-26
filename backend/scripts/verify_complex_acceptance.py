"""Complex approval acceptance against the existing local UAT application.

Copies only the dedicated acceptance form, retaining all 13 configured controls
and permissions. No existing production business configuration is changed.
"""
import copy
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / 'outputs/business-acceptance-20261026.json'
CODE = 'uat-complex-20261026'


def main():
    report = json.loads(REPORT.read_text())
    creds = json.loads(Path('/private/tmp/manufoundry-uat-20261026-credentials.json').read_text())
    entities = report['entities']
    ids = {key.rsplit('_', 1)[1]: value for key, value in entities['users'].items()}
    org = entities['orgs']['uat_20261026_dept_a']
    clients = {}
    run = {'id': uuid4().hex[:8], 'environment': report['environment'], 'checks': [], 'records': []}
    report.setdefault('complex_runs', []).append(run)

    def save():
        run['summary'] = {'passed': sum(c['passed'] for c in run['checks']),
                          'failed': sum(not c['passed'] for c in run['checks'])}
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')

    def check(name, actual, expected):
        passed = actual == expected
        run['checks'].append(dict(name=name, actual=actual, expected=expected, passed=passed))
        print(('PASS ' if passed else 'FAIL ') + name + ('' if passed else f': {actual!r} != {expected!r}'), flush=True)
        save()

    def req(who, method, path, **kw):
        return clients[who].request(method, path, **kw)

    def call(who, method, path, payload=None):
        r = req(who, method, path, json=payload)
        r.raise_for_status()
        result = r.json()
        return result.get('data', result)

    def step(node, groups):
        return {'type': 'approval', 'name': node, 'node_id': node,
                'assignee_rules': [{'type': 'user', 'value': [str(ids[x]) for x in members], 'approvalMode': mode}
                                   for mode, members in groups]}

    try:
        for who in ['admin', 'a', 'b', 'c', 'd', 'e', 'f', 'g']:
            clients[who] = httpx.Client(base_url=report['environment'], trust_env=False, timeout=60)
            login = req(who, 'POST', '/auth/login', json={
                'username': 'admin' if who == 'admin' else creds['users'][who],
                'password': os.environ['UAT_ADMIN_PASSWORD'] if who == 'admin' else creds['password'],
                'tenant_id': report['tenant_id']})
            login.raise_for_status()
            check(f'{who}: independent real account login', login.json()['user']['is_admin'], who == 'admin')
        source = entities['forms']['uat-request-20261026']
        forms = call('admin', 'GET', '/forms')
        target = next((f for f in forms if f['code'] == CODE), None)
        if not target:
            target = call('admin', 'POST', f'/forms/{source}/copy', {'code': CODE, 'name': '复杂流程申请（验收测试）'})
        fid = target['id']
        entities['forms'][CODE] = fid
        run['form_id'] = fid
        aid = entities['applications']['uat-business-20261026']
        call('admin', 'PUT', f'/forms/applications/{aid}/forms', {'form_id': fid, 'enabled': True, 'sort_order': 30})
        menus = call('admin', 'GET', f'/forms/applications/{aid}/menu-nodes')
        if not any(n.get('form_id') == fid for n in menus):
            call('admin', 'POST', f'/forms/applications/{aid}/menu-nodes', {
                'title': '复杂流程申请（验收测试）', 'node_type': 'form', 'form_id': fid, 'sort_order': 30})
        target = call('admin', 'GET', f'/forms/{fid}?schema=draft&scope=designer')
        check('Copied form retains thirteen configured fields', len(target['fields']), 13)
        call('admin', 'POST', f'/forms/{fid}/publish')
        check('Admin may configure form even when settings toolbar is hidden',
              call('admin', 'GET', f'/forms/{fid}?schema=published&scope=list')['runtime_permissions']['configure'], True)
        check('Applicant cannot update form design', req('a', 'PUT', f'/forms/{fid}', json={'name': '不应成功'}).status_code, 403)
        check('Outsider cannot access copied form', req('g', 'GET', f'/forms/{fid}').status_code, 403)

        config = {'domainCode': f'form-approval:{fid}', 'steps': [
            {'type': 'start', 'name': '提交', 'node_id': 'start'},
            step('混合组审：或签与会签成员重叠', [('orSign', ['d', 'e']), ('countersign', ['d', 'e'])]),
            step('复核：E再次处理新节点', [('single', ['e'])]),
            step('终审：D再次处理新节点', [('single', ['d'])]),
            {'type': 'end', 'name': '结束', 'node_id': 'end'}]}
        definition = call('admin', 'POST', '/workflow/definitions', {
            'name': f'复杂组审批验收-{run["id"]}', 'status': 'published', 'config': config})
        wid = definition['id']; run['workflow_id'] = wid
        for binding in call('admin', 'GET', f'/forms/{fid}/workflow-bindings'):
            if binding['enabled']:
                call('admin', 'PUT', f'/forms/{fid}/workflow-bindings/{binding["id"]}', {'enabled': False})
        call('admin', 'POST', f'/forms/{fid}/workflow-bindings', {'workflow_id': wid})
        current = call('admin', 'GET', f'/forms/{fid}?schema=draft&scope=designer')
        call('admin', 'PUT', f'/forms/{fid}', {'config': {**current['config'], 'workflowDesigner': {
            'draftWorkflowId': wid, 'publishedWorkflowId': wid, 'publishedVersion': definition.get('version', 1)}}})
        call('admin', 'POST', f'/forms/{fid}/publish')
        save()

        def draft(label, who='a'):
            payload = {'title': f'【复杂验收】{label}-{run["id"]}', 'applicant_id': str(ids[who]),
                       'org_unit_id': org, 'request_type': 'data_access', 'priority': 'urgent',
                       'data_categories': ['production', 'quality'], 'requested_scope': 'department',
                       'estimated_rows': 10000, 'contains_sensitive': True,
                       'expected_date': (date.today() + timedelta(days=4)).isoformat(),
                       'purpose': '虚构申请：验证复杂组审批与跨节点身份、版本、并发和权限。', 'secret': '复杂验收内部备注'}
            row = call(who, 'POST', f'/forms/{fid}/records', {'data': payload})
            path = f'/forms/{fid}/records/{row["id"]}'
            run['records'].append({'id': row['id'], 'label': label, 'owner': who}); save()
            return path

        def submit(path, status='draft', who='a'):
            row = call(who, 'POST', path + '/submit', {'expected_status': status})
            run['records'][-1]['workflow_id'] = row['_approval']['workflow_id']; save()
            return row['_approval']['workflow_id']

        def detail(instance):
            return call('admin', 'GET', f'/workflow/instances/{instance}')

        def act(who, instance, action='approve', comment='【复杂验收】真实登录账号处理'):
            return req(who, 'POST', f'/workflow/instances/{instance}/{action}', json={'comment': comment})

        def status(path):
            return call('a', 'GET', path)['status']

        def set_config(new_config):
            return call('admin', 'PUT', f'/workflow/definitions/{wid}', {
                'name': f'复杂组审批验收-{run["id"]}', 'status': 'published', 'config': new_config})

        path = draft('重叠成员三节点全程'); instance = submit(path)
        check('Mixed group starts with D and E pending', sorted(detail(instance)['workflow_state']['current_assignee_ids']), sorted([ids['d'], ids['e']]))
        check('Applicant cannot act on mixed group', act('a', instance).status_code, 403)
        check('Observer cannot act on mixed group', act('f', instance).status_code, 403)
        check('D approves overlapping groups once', act('d', instance).status_code, 200)
        check('One approval cannot satisfy countersign', detail(instance)['current_step'], 1)
        check('E remains required despite satisfied or-sign', detail(instance)['workflow_state']['current_assignee_ids'], [ids['e']])
        check('Duplicate D approval rejected', act('d', instance).status_code, 409)
        check('E completes mixed stage', act('e', instance).status_code, 200)
        check('Same E can receive a different next node', detail(instance)['workflow_state']['current_assignee_ids'], [ids['e']])
        check('D cannot skip ahead into final node', act('d', instance).status_code, 403)
        check('E handles second node', act('e', instance).status_code, 200)
        check('Record remains pending before final node', status(path), 'pending')
        check('D completes final node', act('d', instance).status_code, 200)
        check('Source record reaches approved', status(path), 'approved')
        check('Terminal approval rejected', act('d', instance).status_code, 409)
        approvals = detail(instance)['approvals']
        check('Four actor actions preserve node-specific history', sum(a['action'] == 'approve' for a in approvals), 4)

        path = draft('会签中驳回并重新提交'); instance = submit(path)
        check('First countersigner approves before rejection', act('d', instance).status_code, 200)
        check('Blank rejection reason blocked', act('e', instance, 'reject', '').status_code, 422)
        check('Other countersigner may reject entire node', act('e', instance, 'reject', '【复杂验收】补充证明材料').status_code, 200)
        check('Rejected source status synchronized', status(path), 'rejected')
        check('Rejected workflow cannot be revived by approver', act('d', instance).status_code, 409)
        check('Owner may modify rejected application', req('a', 'PUT', path, json={'data': {'purpose': '【复杂验收】已补充材料'}}).status_code, 200)
        replacement = submit(path, 'rejected')
        check('Resubmission creates a fresh workflow', replacement != instance, True)
        check('Original rejected history retained', detail(instance)['status'], 'rejected')
        for actor in ['d', 'e', 'e', 'd']:
            check(f'Resubmission approval by {actor} at step {detail(replacement)["current_step"]}', act(actor, replacement).status_code, 200)
        check('Resubmitted record approved', status(path), 'approved')

        path = draft('旧版本在途'); old_instance = submit(path)
        old_version = detail(old_instance)['workflow_version']
        simpler = {'domainCode': f'form-approval:{fid}', 'steps': [
            {'type': 'start', 'node_id': 'start'}, step('新版独立D审批', [('single', ['d'])]), {'type': 'end', 'node_id': 'end'}]}
        new_version = set_config(simpler)['version']
        check('Definition publication creates new version', new_version > old_version, True)
        path2 = draft('新版本新申请'); new_instance = submit(path2)
        check('New application uses current published version', detail(new_instance)['workflow_version'], new_version)
        check('Old application stays pinned to original version', detail(old_instance)['workflow_version'], old_version)
        check('Old instance D approval still needs E', act('d', old_instance).status_code, 200)
        check('Old instance did not take simplified one-step path', detail(old_instance)['status'], 'pending')
        check('New instance can complete single stage', act('d', new_instance).status_code, 200)
        check('New version source approved', status(path2), 'approved')
        for actor in ['e', 'e', 'd']:
            check(f'Old pinned route {actor} at step {detail(old_instance)["current_step"]}', act(actor, old_instance).status_code, 200)
        check('Old version source eventually approved', status(path), 'approved')

        sibling = {'domainCode': f'form-approval:{fid}', 'steps': [
            {'type': 'start', 'node_id': 'start'}, step('任意一人同意', [('orSign', ['d', 'e'])]),
            step('D独立复核', [('single', ['d'])]), step('D与E联合终审', [('countersign', ['d', 'e'])]),
            {'type': 'end', 'node_id': 'end'}]}
        set_config(sibling)
        path = draft('或签兄弟关闭不影响后续会签'); instance = submit(path)
        check('E satisfies or-sign group', act('e', instance).status_code, 200)
        first = [a for a in detail(instance)['approvals'] if a['node_id'] == '任意一人同意' and a['approver_id'] == ids['d']]
        check('Only sibling D task is marked skipped', [a['action'] for a in first], ['skipped'])
        check('D receives next review despite skipped earlier task', detail(instance)['workflow_state']['current_assignee_ids'], [ids['d']])
        check('E cannot act for D at second node', act('e', instance).status_code, 403)
        check('D handles second node', act('d', instance).status_code, 200)
        check('Final node assigns both reviewers again', sorted(detail(instance)['workflow_state']['current_assignee_ids']), sorted([ids['d'], ids['e']]))
        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(lambda actor: act(actor, instance), ['d', 'e']))
        check('Concurrent distinct countersigners both succeed', sorted(r.status_code for r in result), [200, 200])
        check('Concurrent countersign finalizes exactly once', status(path), 'approved')

        # Leave a deliberately pending complex record for actual browser approval.
        set_config(config)
        path = draft('浏览器多人审批'); instance = submit(path)
        run['browser_pending'] = {'record_path': path, 'instance_id': instance,
                                  'record_id': int(path.rsplit('/', 1)[1]), 'form_code': CODE}
        for who, expected in [('a', 200), ('f', 200), ('g', 403), ('c', 403)]:
            check(f'{who}: current complex record read scope', req(who, 'GET', path).status_code, expected)
        f_detail = call('f', 'GET', f'/workflow/instances/{instance}')
        check('Observer cannot read internal note in complex workflow', 'secret' in f_detail['form_data'], False)
        check('Complex form keeps view-only observer restriction', req('f', 'PUT', path, json={'data': {'title': '非法修改'}}).status_code, 403)
        check('Copied form preserves original thirteen published controls', len(call('admin', 'GET', f'/forms/{fid}?schema=published&scope=designer')['fields']), 13)
        save()
        print('SUMMARY ' + json.dumps(run['summary']), flush=True)
    finally:
        for client in clients.values():
            client.close()
        save()


if __name__ == '__main__':
    main()
