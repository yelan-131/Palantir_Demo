"""Opt-in HTTP acceptance run using dedicated, visible test entities.

Targets the user's existing environment, never edits existing business roles,
forms or records. Keeps the test application for inspection. Credentials are
written only to a mode-0600 temporary file; results contain no passwords/tokens.
"""
import json
import os
from pathlib import Path
import secrets
import sys

import httpx

PREFIX = 'uat_20261026'
APP_CODE = 'uat-business-20261026'
ROOT = Path(__file__).resolve().parents[2]
RESULT = ROOT.parent / 'outputs' / 'business-acceptance-20261026.json'
CREDENTIALS = Path('/private/tmp/manufoundry-uat-20261026-credentials.json')
BASE = os.environ.get('UAT_BASE_URL', 'http://127.0.0.1:13000/api/v1')


def main():
    admin = httpx.Client(base_url=BASE, trust_env=False, timeout=60)
    login = admin.post('/auth/login', json={'username': os.environ.get('UAT_ADMIN_USER', 'admin'),
                       'password': os.environ['UAT_ADMIN_PASSWORD']})
    login.raise_for_status()
    tenant_id = login.json()['user']['tenant_id']
    report = json.loads(RESULT.read_text()) if RESULT.exists() else {'environment': BASE, 'tenant_id': tenant_id, 'entities': {}, 'checks': []}
    assert report['environment'] == BASE and report['tenant_id'] == tenant_id
    entities = report['entities']
    def persist():
        RESULT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    def api(method, path, payload=None, client=admin):
        response = client.request(method, path, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f'{method} {path}: HTTP {response.status_code}: {response.text[:700]}')
        result = response.json()
        return result.get('data', result)
    def ensure(kind, code, list_path, create_path, payload, key='code'):
        rows = api('GET', list_path)
        existing = next((row for row in rows if row.get(key) == code), None)
        row = existing or api('POST', create_path, payload)
        entities.setdefault(kind, {})[code] = row['id']
        persist()
        return row['id']

    roles = {name: ensure('roles', f'{PREFIX}_{name}', '/admin/roles', '/admin/roles', {
        'name': f'{PREFIX}_{name}', 'label': f'验收测试·{label}', 'description': '仅用于流程与权限验收，勿关联现有业务账号'}, 'name')
        for name, label in [('applicant', '申请人'), ('approver', '审批人'), ('observer', '只读观察'), ('outsider', '无应用权限')]}
    orgs = {name: ensure('orgs', f'{PREFIX}_{name}', '/admin/org-units', '/admin/org-units', {
        'code': f'{PREFIX}_{name}', 'name': f'验收测试·{label}', 'description': '流程与权限验收测试部门'})
        for name, label in [('dept_a', '部门甲'), ('dept_b', '部门乙')]}
    if CREDENTIALS.exists():
        credentials = json.loads(CREDENTIALS.read_text())
    else:
        credentials = {'password': 'Uat-2026!' + secrets.token_urlsafe(12), 'users': {}}
        CREDENTIALS.touch(mode=0o600)
        CREDENTIALS.write_text(json.dumps(credentials))
    people = [('a', '申请人A', 'applicant', 'dept_a'), ('b', '申请人B', 'applicant', 'dept_a'),
              ('c', '申请人C', 'applicant', 'dept_b'), ('d', '一级审批D', 'approver', 'dept_a'),
              ('e', '二级审批E', 'approver', 'dept_a'), ('f', '只读观察F', 'observer', 'dept_a'),
              ('g', '无权限G', 'outsider', 'dept_a'), ('disabled', '停用测试', 'applicant', 'dept_a')]
    users = {}
    tenant = api('GET', f'/platform/tenants/{tenant_id}')
    old_user_limit = (tenant.get('limits') or {}).get('users', 50)
    current_users = api('GET', '/admin/users')
    needed = sum(not any(row['username'] == f'{PREFIX}_{name}' for row in current_users) for name, *_ in people)
    expanded = isinstance(old_user_limit, int) and old_user_limit > 0 and len(current_users) + needed > old_user_limit
    if expanded:
        api('PUT', f'/platform/tenants/{tenant_id}', {'limits': {'users': len(current_users) + needed}})
        report['temporary_quota'] = {'original_effective_users': old_user_limit, 'temporary_users': len(current_users) + needed, 'restored': False}
        persist()
    try:
        for name, label, role, org in people:
            username = f'{PREFIX}_{name}'
            users[name] = ensure('users', username, '/admin/users', '/admin/users', {
                'username': username, 'display_name': f'验收测试·{label}', 'password': credentials['password'],
                'role_ids': [roles[role]], 'org_unit_ids': [orgs[org]], 'primary_org_unit_id': orgs[org]}, 'username')
            credentials['users'][name] = username
            CREDENTIALS.write_text(json.dumps(credentials))
    finally:
        if expanded:
            api('PUT', f'/platform/tenants/{tenant_id}', {'limits': {'users': old_user_limit}})
            report['temporary_quota']['restored'] = True
            persist()
    aid = ensure('applications', APP_CODE, '/admin/applications', '/admin/applications', {
        'name': '流程与权限验收（测试）', 'code': APP_CODE, 'description': '专用测试应用：三人申请、两级审批、只读及无权限边界；全部为虚构测试数据',
        'icon': 'ExperimentOutlined', 'status': 'published', 'default_route': '/dynamic/uat-request-20261026', 'sort_order': 900})
    api('PUT', f'/admin/applications/{aid}/bindings', {'role_ids': [roles[x] for x in ['applicant', 'approver', 'observer']]})
    fields = [('title', '申请事项', 'string'), ('org_unit_id', '所属部门ID', 'integer'), ('secret', '内部备注', 'string')]
    view = {'filters': [], 'table': {'columns': [{'id': name, 'fieldName': name, 'label': label, 'enabled': True,
             'sortable': True, 'renderType': 'text', 'emptyText': '—', 'sortOrder': i} for i, (name, label, _) in enumerate(fields)],
             'pageSize': 20, 'density': 'middle', 'rowClickAction': 'detail', 'toolbarActions': ['create', 'refresh'], 'rowActions': ['detail', 'edit', 'submit']}}
    forms = {}
    for code, label in [('uat-request-20261026', '业务申请（验收测试）'), ('uat-restricted-20261026', '审批专属表（验收测试）')]:
        fid = ensure('forms', code, '/forms', '/forms', {'name': label, 'code': code, 'application_id': aid,
                     'description': '虚构验收数据；不关联正式业务', 'config': {'assemblyKind': 'business'}})
        forms[code] = fid
        current = api('GET', f'/forms/{fid}?schema=draft&scope=designer')
        for index, (name, field_label, kind) in enumerate(fields):
            if not any(field['field_name'] == name for field in current['fields']):
                api('POST', f'/forms/{fid}/fields', {'field_name': name, 'label': field_label, 'field_type': kind,
                    'required': name == 'title', 'searchable': name == 'title', 'sortable': True, 'sort_order': index})
        restricted = code.startswith('uat-restricted')
        design = {}
        for role in ['applicant', 'approver', 'observer', 'outsider']:
            can_view = role == 'approver' if restricted else role != 'outsider'
            can_write = role == 'applicant' and not restricted
            actions = {action: False for action in ['view', 'create', 'edit', 'delete', 'import', 'export', 'saveDraft', 'submit', 'approve']}
            actions.update(view=can_view, create=can_write, edit=can_write, saveDraft=can_write, submit=can_write,
                           approve=role == 'approver', export=role == 'observer' and not restricted)
            role_fields = {name: {'visible': not (role == 'observer' and name == 'secret'), 'editable': can_write,
                                 'exportable': name != 'secret'} for name, _, _ in fields}
            design[f'{PREFIX}_{role}'] = {'actions': actions, 'fields': role_fields,
                'data': {'scope': 'assigned' if role == 'applicant' else 'org' if role == 'observer' else 'all'}}
        current = api('GET', f'/forms/{fid}?schema=draft&scope=designer')
        api('PUT', f'/forms/{fid}', {'config': {**current.get('config', {}), 'assemblyKind': 'business',
            'viewConfigDraft': view, 'permissionDesignDraft': {'roles': design}}})
        api('POST', f'/forms/{fid}/publish')
        nodes = api('GET', f'/forms/applications/{aid}/menu-nodes')
        if not any(node.get('form_id') == fid for node in nodes):
            api('POST', f'/forms/applications/{aid}/menu-nodes', {'title': label, 'form_id': fid, 'default_entry': not restricted,
                'config': {'permission_mode': 'custom', 'role_ids': [roles['approver']]} if restricted else {}})
    fid = forms['uat-request-20261026']
    restricted_id = forms['uat-restricted-20261026']
    settings = api('GET', f'/forms/{fid}/approval-settings')
    api('PUT', f'/forms/{fid}/approval-settings', {'enabled': True, 'replace_existing': False, 'expected_version': settings.get('version'),
        'stages': [{'name': '一级审核', 'approver_ids': [users['d']], 'approval_mode': 'single'},
                   {'name': '二级审批', 'approver_ids': [users['e']], 'approval_mode': 'single'}]})
    print(f'Test application ready in existing environment: id={aid}; request form={fid}; restricted form={restricted_id}', flush=True)

    clients = {}
    for name, username in credentials['users'].items():
        client = httpx.Client(base_url=BASE, trust_env=False, timeout=60)
        api('POST', '/auth/login', {'username': username, 'password': credentials['password'], 'tenant_id': tenant_id}, client)
        clients[name] = client
    report['checks'] = []
    def check(name, actual, expected):
        passed = actual == expected
        report['checks'].append({'name': name, 'passed': passed, 'actual': actual, 'expected': expected})
        print(('PASS ' if passed else 'FAIL ') + name + ('' if passed else f' (actual={actual!r}, expected={expected!r})'), flush=True)
        persist()
    for who in ['a', 'b', 'c', 'd', 'e', 'f']:
        check(f'{who}: visible test app', aid in [row['id'] for row in api('GET', '/applications', client=clients[who])], True)
    response = clients['g'].get('/applications')
    check('g: empty application list returns 200', response.status_code, 200)
    check('g: direct app URL denied', clients['g'].get(f'/applications/{aid}').status_code, 403)
    check('g: direct form URL denied', clients['g'].get(f'/forms/{fid}').status_code, 403)
    for who in ['a', 'b', 'c', 'f']:
        menu = api('GET', f'/applications/{aid}/menus', client=clients[who])
        check(f'{who}: restricted menu hidden', any(row.get('form_id') == restricted_id for row in menu), False)
        check(f'{who}: restricted form denied', clients[who].get(f'/forms/{restricted_id}').status_code, 403)
    records = {}
    for who in ['a', 'b', 'c']:
        row = api('POST', f'/forms/{fid}/records', {'data': {'title': f'【验收测试】{who.upper()}申请-20261026',
            'org_unit_id': orgs['dept_b' if who == 'c' else 'dept_a'], 'secret': f'虚构测试备注-{who}'}}, clients[who])
        records[who] = {'record_id': row['id']}
        entities['records'] = records
        persist()
    for who in ['a', 'b', 'c']:
        visible = api('GET', f'/forms/{fid}/records', client=clients[who])
        # api() returns data list; all test-only records must be scoped to their creator.
        check(f'{who}: only own applicant records', all(row.get('created_by') == users[who] for row in visible), True)
    check('a: cannot read B record', clients['a'].get(f'/forms/{fid}/records/{records["b"]["record_id"]}').status_code, 403)
    check('f: cannot create', clients['f'].post(f'/forms/{fid}/records', json={'data': {'title': 'Should never save'}}).status_code, 403)
    observer = api('GET', f'/forms/{fid}/records', client=clients['f'])
    check('f: same-department A/B visible, C hidden', {row['id'] for row in observer} == {records[x]['record_id'] for x in ['a', 'b']}, True)
    check('f: secret fields removed', all('secret' not in row['data'] for row in observer), True)
    exported = clients['f'].get(f'/forms/{fid}/records-export')
    check('f: export allowed', exported.status_code, 200)
    check('f: export contains neither C nor secret values', 'C申请' not in exported.text and '虚构测试备注' not in exported.text, True)
    for who in ['a', 'b', 'c']:
        path = f'/forms/{fid}/records/{records[who]["record_id"]}'
        submitted = api('POST', path + '/submit', {'expected_status': 'draft'}, clients[who])
        wid = submitted['_approval']['workflow_id']; records[who]['workflow_id'] = wid; persist()
        check(f'{who}: duplicate submission blocked', clients[who].post(path + '/submit', json={'expected_status': 'draft'}).status_code, 409)
        check(f'{who}: cannot edit pending', clients[who].put(path, json={'data': {'title': 'Forbidden edit'}}).status_code, 409)
        endpoint = f'/workflow/instances/{wid}/approve'
        check(f'{who}: cannot self approve or forge reviewer', clients[who].post(endpoint, json={'comment': 'Test forge', 'user_id': users['d']}).status_code, 403)
        check(f'{who}: E cannot approve early', clients['e'].post(endpoint, json={'comment': 'Premature'}).status_code, 403)
        check(f'{who}: F cannot approve', clients['f'].post(endpoint, json={'comment': 'Observer'}).status_code, 403)
        if who == 'c':
            check('C: D rejects', clients['d'].post(f'/workflow/instances/{wid}/reject', json={'comment': '【验收测试】退回补充说明'}).status_code, 200)
            check('C: rejected state visible', api('GET', path, client=clients['c'])['status'], 'rejected')
            api('PUT', path, {'data': {'title': '【验收测试】C申请-已补充说明'}}, clients['c'])
            submitted = api('POST', path + '/submit', {'expected_status': 'rejected'}, clients['c'])
            old_wid = wid; wid = submitted['_approval']['workflow_id']; records[who]['previous_workflow_id'] = old_wid
            records[who]['workflow_id'] = wid; persist()
            check('C: resubmit creates new workflow', wid != old_wid, True)
            endpoint = f'/workflow/instances/{wid}/approve'
        check(f'{who}: D approves first stage', clients['d'].post(endpoint, json={'comment': '【验收测试】一级通过'}).status_code, 200)
        check(f'{who}: still pending after first stage', api('GET', path, client=clients[who])['status'], 'pending')
        # Leave A pending at stage E so the user can also inspect a real pending task.
        if who != 'a':
            check(f'{who}: E approves final stage', clients['e'].post(endpoint, json={'comment': '【验收测试】二级通过'}).status_code, 200)
            check(f'{who}: approved result visible', api('GET', path, client=clients[who])['status'], 'approved')
            check(f'{who}: finalized workflow cannot act again', clients['e'].post(endpoint, json={'comment': 'Duplicate'}).status_code, 409)
    # Reproduce application/form-menu mismatch on test menu only; restore it immediately.
    nodes = api('GET', f'/forms/applications/{aid}/menu-nodes')
    node = next(row for row in nodes if row.get('form_id') == restricted_id)
    original = node.get('config') or {}
    try:
        api('PUT', f'/forms/applications/{aid}/menu-nodes/{node["id"]}', {'config': {'permission_mode': 'inherit'}})
        menu = api('GET', f'/applications/{aid}/menus', client=clients['a'])
        check('Denied form should not appear as inherited menu', any(row.get('form_id') == restricted_id for row in menu), False)
    finally:
        api('PUT', f'/forms/applications/{aid}/menu-nodes/{node["id"]}', {'config': original})
    try:
        api('PUT', f'/admin/users/{users["disabled"]}', {'is_active': False})
        response = clients['disabled'].get(f'/forms/{fid}/records')
        check('Disabled user existing session must be denied', response.status_code in [401, 403], True)
    finally:
        # This is a dedicated test account. Leave it disabled after the assertion.
        api('PUT', f'/admin/users/{users["disabled"]}', {'is_active': False})
    try:
        api('PUT', f'/admin/users/{users["b"]}', {'role_ids': []})
        check('B: role revocation takes effect in existing session', clients['b'].get(f'/forms/{fid}/records').status_code, 403)
    finally:
        api('PUT', f'/admin/users/{users["b"]}', {'role_ids': [roles['applicant']]})
    report['summary'] = {'passed': sum(row['passed'] for row in report['checks']),
                         'failed': sum(not row['passed'] for row in report['checks'])}
    persist()
    print(json.dumps(report['summary']), flush=True)
    for client in clients.values():
        client.post('/auth/logout'); client.close()
    admin.post('/auth/logout'); admin.close()


if __name__ == '__main__':
    main()
