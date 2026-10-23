const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {}, Intl, Date };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/FormSettings/versionUtils.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { sortVersions, filterVersions, formatVersionTime, getVersionFields, summarizeVersion, compareVersions } = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => JSON.parse(JSON.stringify(value));
const field = (key, label = key) => ({ id: 1, field_name: key, label, field_type: 'string', required: false, sort_order: 0 });
const snapshot = (fields = []) => ({ form: { config: {} }, fields, layouts: [], permissions: [], workflow_bindings: [] });

test('numeric ordering and version search use real records without mutating input', () => {
  const versions = [{ id: 3, version: 3 }, { id: 12, version: 12 }, { id: 1, version: 1 }];
  assert.deepEqual(plain(sortVersions(versions).map(item => item.version)), [12, 3, 1]);
  assert.deepEqual(versions.map(item => item.version), [3, 12, 1]);
  assert.deepEqual(plain(filterVersions(versions, ' V12 ').map(item => item.id)), [12]);
  assert.equal(filterVersions(versions, '99').length, 0);
});

test('dates preserve naive timestamps, convert explicit offsets, and reject missing or invalid dates', () => {
  for (const value of [null, undefined, '', 'not-a-date', '2026-02-30T12:00:00', '2026-10-23T25:00:00']) assert.equal(formatVersionTime(value), '未记录');
  assert.equal(formatVersionTime('2026-10-23T08:21:00.123456'), '2026-10-23 08:21');
  assert.equal(formatVersionTime('2026-10-23'), '2026-10-23');
  assert.equal(formatVersionTime('2026-10-23Z'), '未记录');
  assert.equal(formatVersionTime('2026-10-23 08:21:00'), '2026-10-23 08:21');
  assert.equal(formatVersionTime('2026-10-23T08:21:00Z'), '2026-10-23 16:21');
  assert.equal(formatVersionTime('2026-10-23T08:21:00+08:00'), '2026-10-23 08:21');
});

test('field list and summary come from snapshots and tolerate missing legacy content', () => {
  const value = snapshot([{ ...field('b', '数量'), sort_order: 2, required: true }, { ...field('a', '编码'), business_type: 'code', sort_order: 1 }]);
  value.form.config.viewConfig = { tabs: [{ id: 'all' }, { id: 'active' }] };
  value.form.config.analyticsDesign = { widgets: [{ id: 'count' }] };
  assert.deepEqual(plain(getVersionFields(value).map(item => [item.key, item.name, item.type, item.required])), [['a', '编码', 'code', false], ['b', '数量', 'string', true]]);
  assert.equal(summarizeVersion(value).requiredFieldCount, 1);
  assert.equal(summarizeVersion(value).viewCount, 2);
  assert.equal(summarizeVersion(value).analyticsWidgetCount, 1);
  assert.equal(getVersionFields({ fields: [null, 'invalid', {}] }).length, 0);
  assert.equal(summarizeVersion(undefined).fieldCount, 0);
});

test('field comparison identifies additions, removals and definition changes', () => {
  const previous = snapshot([field('code', '编码'), field('old', '旧字段')]);
  const current = snapshot([{ ...field('code', '编码'), required: true }, field('new', '新字段')]);
  const change = compareVersions(current, previous)[0];
  assert.deepEqual(plain(change.added), ['新字段']);
  assert.deepEqual(plain(change.removed), ['旧字段']);
  assert.deepEqual(plain(change.modified), ['编码']);
  assert.equal(change.changed, true);
  assert.deepEqual(plain(compareVersions(current)), []);
});

test('metadata-only updates and object key order do not fabricate changes', () => {
  const previous = snapshot([field('code')]);
  previous.form.config.viewConfig = { table: { columns: [] }, filters: [] };
  previous.form.config.formLayout = { sections: [], meta: { version: 1 } };
  previous.layouts = [{ id: 1, layout_type: 'form', config: { sections: [] }, updated_at: '2025-01-01' }];
  const current = clone(previous);
  current.fields[0].updated_at = '2026-10-23';
  current.fields[0].id = 9;
  current.form.config.viewConfig = { filters: [], table: { columns: [] } };
  current.form.config.formLayout.meta.version = 2;
  current.form.config.viewConfigMeta = { draftVersion: 2, publishedAt: '2026-10-23' };
  current.layouts[0].updated_at = '2026-10-23';
  assert.equal(compareVersions(current, previous).some(item => item.changed), false);
});

test('each configuration section is compared independently with backend workflow key', () => {
  const previous = snapshot([field('code')]);
  const current = clone(previous);
  current.form.config.formLayout = { sections: [{ id: 'basic' }] };
  current.form.config.viewConfig = { table: { columns: [{ fieldName: 'code' }] } };
  current.workflow_bindings = [{ id: 1, workflow_id: 9, trigger_action: 'submit', enabled: true, config: { workflowVersion: 2 } }];
  current.permissions = [{ role_id: 3, action: 'read', effect: 'allow' }];
  current.form.config.analyticsDesign = { widgets: [{ id: 'total' }] };
  assert.deepEqual(plain(compareVersions(current, previous).filter(item => item.changed).map(item => item.key)), ['layout', 'views', 'workflow', 'permissions', 'analytics']);
  const changedWorkflow = clone(current);
  changedWorkflow.workflow_bindings[0].config.workflowVersion = 3;
  assert.deepEqual(plain(compareVersions(changedWorkflow, current).filter(item => item.changed).map(item => item.key)), ['workflow']);
});

test('legacy layout payloads and unordered permission records remain comparable', () => {
  const previous = snapshot();
  previous.layouts = [{ layout_type: 'view', config: { published: { table: { columns: [] } }, meta: { draftVersion: 2 } } }];
  previous.permissions = [{ id: 1, role_id: 3, action: 'read' }, { id: 2, role_id: 4, action: 'edit' }];
  previous.workflow_bindings = [{ workflow_id: 3 }];
  const current = clone(previous);
  current.permissions.reverse();
  current.workflowBindings = current.workflow_bindings;
  delete current.workflow_bindings;
  current.layouts[0].config.meta.draftVersion = 3;
  assert.equal(compareVersions(current, previous).some(item => item.changed), false);
  assert.equal(summarizeVersion(current).workflowCount, 1);
  current.layouts[0].config.published.table.columns.push({ fieldName: 'code' });
  assert.deepEqual(plain(compareVersions(current, previous).filter(item => item.changed).map(item => item.key)), ['views']);
});
