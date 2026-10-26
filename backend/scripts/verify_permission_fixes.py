"""Recheck confirmed permission failures without rebuilding acceptance data."""
import json
import os
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / 'outputs' / 'business-acceptance-20261026.json'


def main():
    report = json.loads(REPORT.read_text())
    creds = json.loads(Path('/private/tmp/manufoundry-uat-20261026-credentials.json').read_text())
    entities = report['entities']; app_id = entities['applications']['uat-business-20261026']
    form_id = entities['forms']['uat-request-20261026']; private_id = entities['forms']['uat-restricted-20261026']
    disabled_id = entities['users']['uat_20261026_disabled']; wid = entities['records']['a']['workflow_id']
    clients = {}; checks = []
    def check(name, actual, expected):
        checks.append({'name': name, 'actual': actual, 'expected': expected, 'passed': actual == expected})
        print(('PASS ' if actual == expected else 'FAIL ') + name, flush=True)
    def login(who):
        client = httpx.Client(base_url=report['environment'], trust_env=False, timeout=60)
        response = client.post('/auth/login', json={'username': 'admin' if who == 'admin' else creds['users'][who],
            'password': os.environ['UAT_ADMIN_PASSWORD'] if who == 'admin' else creds['password'], 'tenant_id': report['tenant_id']})
        response.raise_for_status(); clients[who] = client; return client
    admin = login('admin')
    try:
        for who in ['a', 'c', 'f', 'g']:
            login(who)
        response = clients['g'].get('/applications')
        check('No application grants returns successful empty list', response.status_code == 200 and response.json()['data'] == [], True)
        response = clients['g'].get('/forms')
        check('No form grants returns successful empty list', response.status_code == 200 and response.json()['data'] == [], True)
        for who in ['g', 'c']:
            check(who + ': protected workflow detail denied', clients[who].get(f'/workflow/instances/{wid}').status_code in [403, 404], True)
        detail = admin.get(f'/workflow/instances/{wid}'); detail.raise_for_status()
        for who in ['g', 'c']:
            response = clients[who].get('/workflow/instances', params={'workflow_id': detail.json()['workflow_id']})
            permitted = response.status_code == 200 and all(row['initiator_id'] == entities['users']['uat_20261026_c']
                for row in response.json()['data']) if who == 'c' else response.status_code == 200 and response.json()['data'] == []
            check(who + ': workflow list contains only authorized records', permitted, True)
        response = clients['f'].get(f'/workflow/instances/{wid}'); response.raise_for_status()
        check('Observer workflow snapshot excludes hidden notes', 'secret' not in response.json()['form_data'], True)
        check('Observer workflow state excludes hidden notes', 'secret' not in (response.json()['variables'] or {}), True)
        nodes = admin.get(f'/forms/applications/{app_id}/menu-nodes').json()['data']
        node = next(n for n in nodes if n.get('form_id') == private_id)
        try:
            admin.put(f'/forms/applications/{app_id}/menu-nodes/{node["id"]}', json={'config': {'permission_mode': 'inherit'}}).raise_for_status()
            response = clients['a'].get(f'/applications/{app_id}/menus'); response.raise_for_status()
            check('Inherited menu respects denied form permission', all(n.get('form_id') != private_id for n in response.json()['data']), True)
        finally:
            admin.put(f'/forms/applications/{app_id}/menu-nodes/{node["id"]}', json={'config': node.get('config') or {}}).raise_for_status()
        try:
            admin.put(f'/admin/users/{disabled_id}', json={'is_active': True}).raise_for_status()
            client = login('disabled')
            check('Test account access before disabling', client.get(f'/forms/{form_id}/records').status_code, 200)
            admin.put(f'/admin/users/{disabled_id}', json={'is_active': False}).raise_for_status()
            check('Disabled account existing cookie rejected', client.get(f'/forms/{form_id}/records').status_code, 401)
        finally:
            admin.put(f'/admin/users/{disabled_id}', json={'is_active': False}).raise_for_status()
        for fid in [form_id, private_id]:
            response = admin.get(f'/forms/{fid}/publish/preview')
            check(f'Form {fid} publish preview available', response.status_code, 200)
        report['permission_fix_retest'] = {'environment': report['environment'], 'checks': checks,
            'summary': {'passed': sum(c['passed'] for c in checks), 'failed': sum(not c['passed'] for c in checks)}}
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report['permission_fix_retest']['summary']), flush=True)
    finally:
        for client in clients.values():
            try:
                client.post('/auth/logout')
            finally:
                client.close()


if __name__ == '__main__':
    main()
