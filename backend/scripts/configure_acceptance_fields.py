"""Configure realistic controls on the dedicated acceptance forms via HTTP."""
import copy
import json
import os
from datetime import date, timedelta
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / 'outputs' / 'business-acceptance-20261026.json'
PREFIX = 'uat_20261026'


def rules(required=False):
    return {key: {'enabled': enabled} for key, enabled in {
        'visible': True, 'readonly': False, 'required': required, 'unique': False,
        'masked': False, 'copyable': True, 'optionSort': False}.items()}


def field(name, label, storage, control, section, *, settings=None, options=None, source=None,
          default=None, required=False, help_text='', listed=False, business=None):
    return dict(name=name, label=label, storage=storage, control=control, section=section,
                settings=settings or {}, options=options, source=source, default=default,
                required=required, help=help_text, listed=listed, business=business)


SELECT = {'selectionMode': 'single', 'displayMode': 'dropdown', 'allowClear': True, 'allowCreateOption': False}
TEXT = {'maxLength': 100, 'trimMode': 'trim', 'textFormat': 'plain'}
LONG = {'maxLength': 1000, 'rows': 4, 'trimMode': 'trim', 'textFormat': 'plain'}
UPLOAD = {'maxFiles': 3, 'maxFileSize': 10, 'fileTypes': '.pdf,.png,.jpg,.docx,.xlsx,.txt'}

REQUEST = [
    field('title', '申请主题', 'string', 'text', 'basic', settings=TEXT, required=True,
          help_text='简要说明申请事项，最多100字', listed=True),
    field('applicant_id', '业务联系人', 'string', 'relation', 'basic', source='users', business='person',
          settings={**SELECT, 'displayMode': 'search'}, help_text='从组织用户中选择联系人；实际发起人由登录身份记录', listed=True),
    field('org_unit_id', '申请部门', 'integer', 'relation', 'basic', source='org_units', business='relation',
          settings={**SELECT, 'displayMode': 'search'}, required=True, help_text='选择组织部门，用于部门数据范围校验', listed=True),
    field('request_type', '申请类型', 'enum', 'select', 'basic', settings=SELECT, default='data_access',
          options=[('data_access', '数据访问'), ('data_export', '数据导出'), ('data_correction', '数据更正')], listed=True),
    field('priority', '紧急程度', 'enum', 'select', 'basic', settings={**SELECT, 'displayMode': 'radio'}, default='normal',
          options=[('normal', '普通'), ('urgent', '紧急'), ('critical', '加急')], listed=True),
    field('expected_date', '期望完成日期', 'date', 'datetime', 'basic', settings={'dateMode': 'date', 'defaultDate': 'none', 'disablePast': True},
          help_text='只能选择今天或之后的日期', listed=True, business='date'),
    field('data_categories', '申请数据类别', 'json', 'select', 'scope', business='enum',
          settings={**SELECT, 'selectionMode': 'multiple', 'displayMode': 'tags', 'minSelections': 1, 'maxSelections': 3, 'tagCollapse': 'responsive'},
          options=[('production', '生产数据'), ('quality', '质量数据'), ('equipment', '设备数据'), ('inventory', '库存数据')],
          help_text='可多选，最多3类'),
    field('requested_scope', '申请使用范围', 'enum', 'select', 'scope', settings=SELECT, default='department',
          options=[('personal', '本人业务'), ('department', '本部门业务'), ('cross_department', '跨部门业务')], listed=True,
          help_text='业务申请信息；实际可见数据仍受角色权限限制'),
    field('estimated_rows', '预计数据量', 'integer', 'number', 'scope', settings={'min': 1, 'max': 1000000, 'precision': 0, 'unit': '条', 'thousandSeparator': True},
          help_text='1～1,000,000条，仅允许整数', listed=True),
    field('contains_sensitive', '是否涉及敏感数据', 'boolean', 'switch', 'scope', default='false',
          settings={'defaultChecked': False, 'checkedText': '涉及', 'uncheckedText': '不涉及'}, listed=True),
    field('purpose', '申请用途与说明', 'text', 'textarea', 'description', settings=LONG, business='longText',
          help_text='说明业务目的、使用方式及必要性，最多1000字'),
    field('attachments', '申请证明材料', 'json', 'upload', 'description', settings=UPLOAD, business='attachment',
          help_text='最多3个附件，每个不超过10MB；支持PDF、图片、Word、Excel和文本'),
    field('secret', '内部补充备注', 'string', 'textarea', 'description', settings={**LONG, 'maxLength': 500, 'rows': 3}, business='longText',
          help_text='只读观察人员不可查看或导出此字段'),
]

REVIEW = [
    field('title', '审批事项', 'string', 'text', 'basic', settings=TEXT, required=True, listed=True),
    field('source_request_id', '关联业务申请', 'string', 'relation', 'basic', source='uat-request-20261026', business='relation',
          settings={**SELECT, 'displayMode': 'search'}, help_text='从已授权的业务申请中选择来源记录', listed=True),
    field('reviewer_id', '审核人员', 'string', 'relation', 'basic', source='users', business='person', settings={**SELECT, 'displayMode': 'search'}, listed=True),
    field('org_unit_id', '审核部门', 'integer', 'relation', 'basic', source='org_units', business='relation', settings={**SELECT, 'displayMode': 'search'}, listed=True),
    field('review_result', '审核结论', 'enum', 'select', 'decision', settings={**SELECT, 'displayMode': 'radio'}, default='pending',
          options=[('pending', '待审核'), ('approve', '同意'), ('revise', '补充材料'), ('reject', '不同意')], listed=True),
    field('risk_level', '数据风险等级', 'enum', 'select', 'decision', settings=SELECT, default='low',
          options=[('low', '低风险'), ('medium', '中风险'), ('high', '高风险')], listed=True),
    field('reviewed_at', '审核时间', 'datetime', 'datetime', 'decision', business='datetime',
          settings={'dateMode': 'datetime', 'defaultDate': 'none', 'disablePast': False}, listed=True),
    field('secret', '内部审批意见', 'string', 'textarea', 'decision', settings=LONG, business='longText', help_text='审批专属信息，不向申请人或观察人员开放'),
    field('conditions', '使用限制与整改要求', 'text', 'textarea', 'decision', settings=LONG, business='longText',
          help_text='填写数据用途限制、保留期限或补充材料要求'),
    field('evidence', '审核依据附件', 'json', 'upload', 'decision', settings=UPLOAD, business='attachment', help_text='最多3个文件，每个不超过10MB'),
]


def main():
    report = json.loads(REPORT.read_text())
    c = httpx.Client(base_url=report['environment'], trust_env=False, timeout=60)
    login = c.post('/auth/login', json={'username': 'admin', 'password': os.environ['UAT_ADMIN_PASSWORD']}); login.raise_for_status()
    def call(method, path, payload=None, client=c):
        response = client.request(method, path, json=payload)
        if method == 'GET' and response.status_code == 503:
            report.setdefault('transient_http_errors', []).append({'path': path, 'status': 503, 'stage': 'field-publication'})
            REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
            response = client.request(method, path, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f'{method} {path}: {response.status_code}: {response.text[:1400]}')
        value = response.json(); return value.get('data', value)
    configured = []
    for code, definitions, sections in [
        ('uat-request-20261026', REQUEST, {'basic': '申请基本信息', 'scope': '数据范围与使用需求', 'description': '用途说明与证明材料'}),
        ('uat-restricted-20261026', REVIEW, {'basic': '审批来源与处理人', 'decision': '审核结论与依据'}),
    ]:
        fid = report['entities']['forms'][code]
        form = call('GET', f'/forms/{fid}?schema=draft&scope=designer')
        existing = {f['field_name']: f for f in form['fields']}
        controls = []; nodes = []; flattened = []
        for key, label in sections.items():
            controls.append({'id': f'group-{key}', 'source': 'component', 'controlType': 'container', 'name': label,
                             'width': 'full', 'layout': {'gap': 16, 'collapsible': False}, 'rules': rules()})
            nodes.append({'id': f'group-{key}', 'kind': 'container', 'label': label, 'width': 'full', 'layout': {'gap': 16}, 'children': []})
        for index, d in enumerate(definitions):
            ui = {'controlType': d['control'], 'typeSettings': d['settings'], 'helpText': d['help'], 'placeholder': f'请选择{d["label"]}' if d['control'] in ['select', 'relation', 'datetime'] else f'请输入{d["label"]}'}
            if d['business']: ui['businessType'] = d['business']
            choices = [{'value': v, 'label': label} for v, label in d['options']] if d['options'] else None
            payload = {'label': d['label'], 'field_type': d['storage'], 'business_type': d['business'], 'control_type': d['control'],
                       'required': d['required'], 'visible_in_list': d['listed'], 'visible_in_form': True,
                       'searchable': d['name'] == 'title', 'sortable': d['listed'] and d['control'] not in ['relation', 'switch'],
                       'sort_order': index, 'ui_config': ui, 'default_value': d['default']}
            if choices: payload['enum_values'] = {'values': choices}
            if d['name'] in existing:
                # Existing stored values keep their storage types.
                assert existing[d['name']]['field_type'] == d['storage']
                call('PUT', f'/forms/{fid}/fields/{existing[d["name"]]["id"]}', payload)
            else:
                call('POST', f'/forms/{fid}/fields', {'field_name': d['name'], **payload})
            width = 'full' if d['control'] in ['textarea', 'upload'] else 'half'
            control = {'id': f'field-{d["name"]}', 'source': 'field', 'fieldKey': d['name'], 'controlType': d['control'],
                       'name': d['label'], 'width': width, 'parentId': f'group-{d["section"]}', 'slotId': 'body',
                       'placeholder': ui['placeholder'], 'helpText': d['help'], 'typeSettings': d['settings'], 'rules': rules(d['required'])}
            if choices: control.update(dataSourceKind='static', optionSource=json.dumps(choices, ensure_ascii=False))
            if d['source']:
                control.update(dataSourceKind='businessForm' if d['source'].startswith('uat-') else 'organization',
                               optionSource=d['source'], referenceValueField='id',
                               referenceLabelField='title' if d['source'].startswith('uat-') else 'display_name' if d['source'] == 'users' else 'name')
            controls.append(control)
            next(node for node in nodes if node['id'] == f'group-{d["section"]}')['children'].append({
                'id': control['id'], 'kind': 'field', 'fieldName': d['name'], 'label': d['label'], 'width': width, 'slotId': 'body'})
            flattened.append({'fieldName': d['name'], 'label': d['label'], 'width': width, 'colSpan': 2 if width == 'full' else 1,
                              'controlType': d['control'], 'required': d['required'], 'placeholder': ui['placeholder'], 'helpText': d['help']})
        form = call('GET', f'/forms/{fid}?schema=draft&scope=designer')
        config = copy.deepcopy(form['config'])
        design = copy.deepcopy(config.get('permissionDesignDraft') or config['permissionDesign'])
        for name, role in design['roles'].items():
            editable = name == f'{PREFIX}_applicant' and code == 'uat-request-20261026'
            for d in definitions:
                visible = not (name == f'{PREFIX}_observer' and d['name'] == 'secret')
                role.setdefault('fields', {})[d['name']] = {'visible': visible, 'editable': editable, 'exportable': visible and d['name'] != 'secret'}
        columns = [{'id': d['name'], 'fieldName': d['name'], 'label': d['label'], 'enabled': True,
                    'sortable': d['control'] not in ['relation', 'switch'], 'renderType': 'tag' if d['control'] == 'select' else 'date' if d['control'] == 'datetime' else 'number' if d['control'] == 'number' else 'text',
                    'emptyText': '—', 'sortOrder': i} for i, d in enumerate(definitions) if d['listed']]
        filters = [{'id': d['name'], 'fieldName': d['name'], 'label': d['label'], 'controlType': 'select', 'operator': 'equals', 'enabled': True, 'advanced': False, 'sortOrder': i}
                   for i, d in enumerate(definitions) if d['name'] in ['request_type', 'priority', 'review_result', 'risk_level']]
        config.update(formDesignerControls=controls, formLayout={'version': 2, 'nodes': nodes, 'sections': [{'id': 'business-info', 'title': '业务信息', 'fields': flattened}]},
                      permissionDesignDraft=design, canvasSettings={'gap': 16},
                      viewConfigDraft={'filters': filters, 'table': {'columns': columns, 'pageSize': 20, 'density': 'middle', 'rowClickAction': 'detail',
                                       'toolbarActions': ['create', 'refresh'], 'rowActions': ['detail', 'edit', 'submit']}})
        call('PUT', f'/forms/{fid}', {'config': config})
        preview = call('GET', f'/forms/{fid}/publish/preview')
        print(f'Publish preview {fid}: blockers={preview["blocking_count"]}, warnings={preview["warning_count"]}', flush=True)
        result = call('POST', f'/forms/{fid}/publish')
        live = call('GET', f'/forms/{fid}?schema=published&scope=designer')
        for d in definitions:
            actual = next(f for f in live['fields'] if f['field_name'] == d['name'])
            assert actual['ui_config']['controlType'] == d['control'], (d['name'], actual)
            assert actual['ui_config']['typeSettings'] == d['settings'], d['name']
        configured.append({'form_id': fid, 'code': code, 'field_count': len(definitions), 'published_version': result.get('version'),
                           'fields': [{'name': d['name'], 'label': d['label'], 'control': d['control']} for d in definitions]})
        print(f'Published form {fid}: {len(definitions)} configured controls', flush=True)
    report['configured_fields'] = configured
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    c.post('/auth/logout'); c.close()


if __name__ == '__main__':
    main()
