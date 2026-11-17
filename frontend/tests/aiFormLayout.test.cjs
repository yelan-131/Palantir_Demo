const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInThisContext } = require('node:vm');
const ts = require('typescript');

function load(name, imports = {}) {
  const source = readFileSync(join(__dirname, '../src/utils', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInThisContext('(function(exports, require) {' + js + '\n})')(exports, path => imports[path]);
  return exports;
}

const layout = load('formLayout');
const { applyAiLayoutOperations, describeAiLayout } = load('aiFormLayout', { './formLayout': layout });
const create = (controlType, id) => ({ controlType, id, name: controlType, width: 'full', rules: { visible: { enabled: true } } });
const fields = [
  { id: 'original-code', controlType: 'field', fieldKey: 'material_code', rules: { required: { enabled: true } } },
  { id: 'original-name', controlType: 'field', fieldKey: 'material_name' },
];

test('new and existing fields can be placed in the native layout without recreating their bindings', () => {
  const next = applyAiLayoutOperations(fields, [
    { op: 'add', control_id: 'group', control_type: 'container' },
    { op: 'add', control_id: 'columns', control_type: 'two-columns', parent_id: 'group', slot_id: 'body', properties: { layout: { columns: 3 } } },
    { op: 'add', control_id: 'tabs', control_type: 'tabs', properties: { layout: { tabs: [{ id: 'basic', label: 'Basic' }] } } },
    { op: 'add', control_id: 'divider', control_type: 'divider', parent_id: 'tabs', slot_id: 'basic' },
    { op: 'move', field_name: 'material_code', parent_id: 'columns', slot_id: '2' },
    { op: 'move', control_id: 'original-name', parent_id: 'tabs', slot_id: 'basic', before_id: 'divider' },
    { op: 'update', control_id: 'tabs', properties: { layout: { tabs: [{ id: 'basic', label: 'Renamed' }] } } },
    { op: 'update', control_id: 'divider', properties: { name: 'Details', visible: false } },
  ], create);

  const byId = Object.fromEntries(describeAiLayout(next).map(control => [control.control_id, control]));
  assert.equal(byId['original-code'].field_name, 'material_code');
  assert.equal(byId['original-code'].slot_id, '2');
  assert.equal(next.find(item => item.id === 'original-code').rules.required.enabled, true);
  assert.equal(byId['original-name'].parent_id, 'tabs');
  assert.ok(next.findIndex(item => item.id === 'original-name') < next.findIndex(item => item.id === 'divider'));
  assert.equal(byId.tabs.slots[0].label, 'Renamed');
  assert.equal(byId.divider.name, 'Details');
  assert.equal(byId.divider.visible, false);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].parentId, undefined);
});

test('invalid later changes leave the original layout intact', () => {
  const initial = applyAiLayoutOperations(fields, [
    { op: 'add', control_id: 'columns', control_type: 'two-columns' },
    { op: 'move', field_name: 'material_code', parent_id: 'columns', slot_id: '1' },
  ], create);
  const previous = JSON.stringify(initial);
  for (const invalid of [
    { op: 'move', control_id: 'columns', parent_id: 'columns' },
    { op: 'move', control_id: 'original-name', parent_id: 'columns', slot_id: 'missing' },
    { op: 'update', control_id: 'columns', properties: { layout: { columns: 2, ratios: [1, 1, 1] } } },
    { op: 'move', control_id: 'columns', before_id: 'original-code' },
    { op: 'add', control_id: 'table', control_type: 'readonly-table' },
  ]) {
    assert.throws(() => applyAiLayoutOperations(initial, [
      { op: 'update', control_id: 'columns', properties: { name: 'Changed' } },
      invalid,
    ], create));
    assert.equal(JSON.stringify(initial), previous);
  }
});
