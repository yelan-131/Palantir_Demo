"""Round-two HTTP tests on the existing, dedicated acceptance application.

Does not change form definitions or existing user roles. Creates only marked
test records; credentials stay outside the repository. All HTTP clients use
the original environment saved by the first acceptance run.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / 'outputs' / 'business-acceptance-20261026.json'


def main():
    report = json.loads(REPORT.read_text())
    creds = json.loads(Path('/private/tmp/manufoundry-uat-20261026-credentials.json').read_text())
    entities = report['entities']; fid = entities['forms']['uat-request-20261026']; restricted = entities['forms']['uat-restricted-20261026']
    uid = {key.rsplit('_', 1)[1]: value for key, value in entities['users'].items()}
    org = entities['orgs']['uat_20261026_dept_a']
    run = {'run_id': uuid4().hex[:8], 'environment': report['environment'], 'checks': [], 'records': [], 'limitations': []}
    report.setdefault('followup_runs', []).append(run)
    clients = {}
    def save():
        run['summary'] = {'passed': sum(x['passed'] for x in run['checks']), 'failed': sum(not x['passed'] for x in run['checks'])}
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    def check(name, actual, expected, severity='P2'):
        passed = actual == expected
        run['checks'].append({'name': name, 'passed': passed, 'actual': actual, 'expected': expected, 'severity_if_failed': severity})
        print(('PASS ' if passed else 'FAIL ') + name + (f' ({actual!r}; expected {expected!r})' if not passed else ''), flush=True)
        save()
    def api(who, method, path, **kwargs):
        return clients[who].request(method, path, **kwargs)
    def data(who, path):
        response = api(who, 'GET', path); response.raise_for_status()
        value = response.json(); return value.get('data', value)
    def new_draft(label):
        response = api('a', 'POST', f'/forms/{fid}/records', json={'data': {
            'title': f'【验收测试·二轮】{label}-{run["run_id"]}', 'org_unit_id': org,
            'applicant_id': str(uid['a']), 'request_type': 'data_access', 'priority': 'normal',
            'data_categories': ['production'], 'requested_scope': 'department', 'estimated_rows': 10,
            'expected_date': (date.today() + timedelta(days=3)).isoformat(), 'contains_sensitive': False,
            'purpose': '虚构数据，用于多人流程与权限验收。', 'secret': '二轮内部测试备注'}})
        response.raise_for_status(); row = response.json()['data']
        run['records'].append({'form_id': fid, 'record_id': row['id'], 'purpose': label}); save()
        return row['id'], f'/forms/{fid}/records/{row["id"]}'
    try:
        for who in ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'admin']:
            client = httpx.Client(base_url=report['environment'], trust_env=False, timeout=60)
            payload = {'username': 'admin' if who == 'admin' else creds['users'][who],
                       'password': os.environ['UAT_ADMIN_PASSWORD'] if who == 'admin' else creds['password'], 'tenant_id': report['tenant_id']}
            response = client.post('/auth/login', json=payload); response.raise_for_status(); clients[who] = client
        # Current UI /workflow/business-items is protected; legacy instance APIs
        # must enforce the same boundary. Fetch only known synthetic instances.
        wid = entities['records']['a']['workflow_id']
        public_detail = data('admin', f'/workflow/instances/{wid}')
        workflow_id = public_detail['workflow_id']
        for who in ['g', 'c']:
            response = api(who, 'GET', f'/workflow/instances/{wid}')
            check(f'{who}: direct workflow detail must reject unrelated user', response.status_code in [403, 404], True, 'P1')
            response = api(who, 'GET', '/workflow/instances', params={'workflow_id': workflow_id})
            allowed = response.status_code in [403, 404] or response.status_code == 200 and all(
                who == 'c' and row['initiator_id'] == uid['c'] for row in response.json().get('data', []))
            check(f'{who}: legacy workflow list must not expose other applications', allowed, True, 'P1')
        response = api('f', 'GET', f'/workflow/instances/{wid}')
        snapshot_secret = response.status_code == 200 and bool((response.json().get('form_data') or {}).get('secret'))
        check('Observer: workflow snapshot must not disclose hidden internal notes', snapshot_secret, False, 'P1')
        response = api('g', 'GET', '/workflow/business-items', params={'source_form_id': fid})
        check('Outsider: current inbox contains no protected test records', response.status_code == 200 and response.json()['data']['items'] == [], True, 'P1')

        # Seed only a test-only restricted record. No schema/configuration change.
        response = api('admin', 'POST', f'/forms/{restricted}/records', json={'data': {
            'title': f'【验收测试·二轮】审批专属记录-{run["run_id"]}', 'source_request_id': str(entities['records']['a']['record_id']),
            'reviewer_id': str(uid['d']), 'org_unit_id': org, 'review_result': 'pending', 'risk_level': 'low',
            'secret': '仅用于验证审批专属表隔离', 'conditions': '仅供验收，不产生真实业务授权'}})
        response.raise_for_status(); rr = response.json()['data']['id']; rp = f'/forms/{restricted}/records/{rr}'
        run['records'].append({'form_id': restricted, 'record_id': rr, 'purpose': '审批专属数据隔离'}); save()
        for who in ['a', 'b', 'c', 'f', 'g']:
            for suffix in ['', '/records', f'/records/{rr}', '/records-export']:
                response = api(who, 'GET', f'/forms/{restricted}{suffix}')
                check(f'{who}: restricted form {suffix or "metadata"} denied', response.status_code in [403, 404], True, 'P1')
        for who in ['d', 'e']:
            check(f'{who}: reviewer reads restricted record', api(who, 'GET', rp).status_code, 200)
            check(f'{who}: readonly reviewer cannot modify restricted record', api(who, 'PUT', rp, json={'data': {'secret': 'Forbidden edit'}}).status_code, 403)
        response = api('a', 'POST', f'/forms/{restricted}/fields/source_request_id/options', json={'data': {}})
        check('Applicant cannot bypass restricted form through relation options', response.status_code, 403, 'P1')

        # Existing test attachment is attached to an A-owned approved test record.
        attached = entities['control_validation_record']; rid = attached['record_id']
        row = data('a', f'/forms/{fid}/records/{rid}')
        attachment = row['data']['attachments'][0]
        file_path = f'/forms/{fid}/fields/attachments/files/{attachment["id"]}'
        for who, permitted in [('a', True), ('b', False), ('c', False), ('d', True), ('f', True), ('g', False)]:
            response = api(who, 'GET', file_path, params={'record_id': rid})
            check(f'{who}: attachment download respects record scope', response.status_code == 200 if permitted else response.status_code in [403, 404], True, 'P1')
        check('Non-owner cannot download attachment without record authorization', api('f', 'GET', file_path).status_code, 403, 'P1')
        wrong_rid = entities['default_validation_draft']['record_id']
        check('Cannot bind known file ID to an unrelated record', api('a', 'GET', file_path, params={'record_id': wrong_rid}).status_code, 403, 'P1')
        response = api('a', 'GET', file_path, params={'record_id': rid})
        check('Downloaded evidence has expected test-only content', '仅用于字段控件验收' in response.content.decode('utf8'), True)
        check('Download prevents MIME sniffing', response.headers.get('x-content-type-options'), 'nosniff')
        for query in [
            {'filters': json.dumps([{'field': 'secret', 'op': 'contains', 'value': '虚构'}])},
            {'sort_field': 'secret', 'sort_order': 'asc'},
        ]:
            response = api('f', 'GET', f'/forms/{fid}/records', params=query)
            check('Observer cannot infer hidden field through filter/sort ' + next(iter(query)), response.status_code in [403, 422], True, 'P1')
        response = api('f', 'GET', f'/forms/{fid}/records', params={'search': '虚构测试备注'})
        check('Keyword search cannot infer hidden internal notes', response.status_code == 200 and response.json()['total'] == 0, True, 'P1')
        filtered = api('a', 'GET', f'/forms/{fid}/records', params={'filters': json.dumps([{'field': 'request_type', 'op': 'equals', 'value': 'data_access'}])})
        check('Published dropdown filter accepts its configured field', filtered.status_code, 200)
        if filtered.status_code == 200:
            check('Filtered rows match requested type', all(row['data'].get('request_type') == 'data_access' for row in filtered.json()['data']), True)

        notes = data('d', '/notifications')
        if notes:
            note = notes[0]['id']
            check('Another user cannot mark reviewer notification read', api('a', 'POST', f'/notifications/{note}/read').status_code in [403, 404], True, 'P1')
        check('Cannot fetch another users notification feed', api('a', 'GET', '/notifications', params={'user_id': uid['d']}).status_code, 403, 'P1')
        check('Cannot read all notifications on behalf of another user', api('a', 'POST', '/notifications/read-all', json={'user_id': uid['d']}).status_code, 403, 'P1')

        # Real overlapping requests on the existing PostgreSQL-backed service.
        rid, path = new_draft('并发提交与审批')
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: api('a', 'POST', path + '/submit', json={'expected_status': 'draft'}), range(2)))
        check('Concurrent submit creates exactly one successful submission', sum(r.status_code == 200 for r in responses), 1, 'P1')
        check('Concurrent repeated submission is rejected with conflict', sorted(r.status_code for r in responses), [200, 409])
        successes = [r.json()['data'] for r in responses if r.status_code == 200]
        if successes:
            wid2 = successes[0]['_approval']['workflow_id']; run['records'][-1]['workflow_id'] = wid2; save()
            endpoint = f'/workflow/instances/{wid2}/approve'
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: api('d', 'POST', endpoint, json={'comment': '【验收测试】并发一级审批'}), range(2)))
            check('Concurrent duplicate approval advances once', sum(r.status_code == 200 for r in results), 1, 'P1')
            check('Concurrent duplicate approval returns only success/denial/conflict', all(r.status_code in [200, 403, 409] for r in results), True)
            check('After concurrent first stage, record still pending second reviewer', data('a', path)['status'], 'pending', 'P1')
            check('Final reviewer can complete after concurrency', api('e', 'POST', endpoint, json={'comment': '【验收测试】并发后终审'}).status_code, 200)
            check('Concurrency did not duplicate submit history', sum(x['action'] == 'submit' for x in data('a', path)['_approval']['history']), 1, 'P1')
        rid, path = new_draft('过期编辑冲突')
        check('First edit using expected value succeeds', api('a', 'PUT', path, json={'data': {'estimated_rows': 11}, 'expected_values': {'estimated_rows': 10}}).status_code, 200)
        check('Stale second editor cannot overwrite first edit', api('a', 'PUT', path, json={'data': {'estimated_rows': 12}, 'expected_values': {'estimated_rows': 10}}).status_code, 409, 'P1')
        check('First editor value is preserved', data('a', path)['data']['estimated_rows'], 11)
        pending_wid = entities['records']['a']['workflow_id']
        check('Unrelated user cannot cancel pending test workflow', api('b', 'POST', f'/workflow/instances/{pending_wid}/cancel').status_code, 403, 'P1')
        cancellation = api('a', 'POST', f'/workflow/instances/{pending_wid}/cancel')
        check('Managed form cancellation follows current explicit prohibition', cancellation.status_code, 409)
        run['limitations'].append('受管表单申请的撤回接口明确返回409；如业务需要申请人撤回，当前尚未支持。')
        print(json.dumps(run['summary']), flush=True)
    finally:
        save()
        for client in clients.values():
            try:
                client.post('/auth/logout')
            finally:
                client.close()


if __name__ == '__main__':
    main()
