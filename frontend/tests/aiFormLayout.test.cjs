const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInThisContext } = require('node:vm');
const ts = require('typescript');

function load(name, imports = {}, dir = '../src/utils') {
  const source = readFileSync(join(__dirname, dir, name + '.ts'), 'utf8');
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

test('a field already saved in the field library can be placed directly into a newly created tab', () => {
  const batch = [
    { op: 'add', control_id: 'business', control_type: 'tabs', properties: { layout: { tabs: [{ id: 'home', label: '家用' }] } } },
    { op: 'move', field_name: 'home_sales_org', parent_id: 'business', slot_id: 'home' },
  ];
  const makeField = name => name === 'home_sales_org' ? { id: 'field-home', controlType: 'field', fieldKey: name } : undefined;
  const next = applyAiLayoutOperations(fields, batch, create, makeField);
  assert.equal(next.length, 4);
  assert.equal(next.find(control => control.id === 'field-home').slotId, 'home');
  assert.equal(applyAiLayoutOperations(next, [batch[1]], create, makeField).filter(control => control.fieldKey === 'home_sales_org').length, 1);
  assert.throws(() => applyAiLayoutOperations(fields, batch, create, () => undefined), { name: 'Error', message: /字段不在/ });
  assert.equal(fields.length, 2);
});

test('the designer restores independently saved tabs without dropping existing field settings', () => {
  const fieldModel = {
    makeAiLayoutControl: create,
    makeFieldControl: field => ({ ...create('field', 'new-' + field.key), source: 'field', fieldKey: field.key, name: field.name }),
    normalizeControlRules: rules => rules || {},
  };
  const { restoreDesignerLayout } = load('designerLayout', { '@/utils/formLayout': layout, './fieldModel': fieldModel }, '../src/pages/FormSettings');
  const library = [{ key: 'material_code', name: '物料编码' }, { key: 'home_sales_org', name: '家用销售组织' }];
  const old = [{ ...fieldModel.makeFieldControl(library[0]), id: 'code', placeholder: '原占位文字' },
    { ...create('divider', 'hidden'), source: 'component', rules: { visible: { enabled: false } } }];
  const baseline = layout.buildRuntimeLayout(old, () => ({}));
  const stored = { ...baseline, nodes: [{
    id: 'business', kind: 'tabs', layout: { tabs: [{ id: 'home', label: '家用' }] },
    children: [
      { id: 'code', kind: 'field', fieldName: 'material_code', slotId: 'home' },
      { id: 'org', kind: 'field', fieldName: 'home_sales_org', slotId: 'home' },
    ],
  }] };
  const restored = restoreDesignerLayout(library, old, baseline, stored);
  assert.equal(restored.find(control => control.id === 'code').placeholder, '原占位文字');
  assert.equal(restored.find(control => control.id === 'org').parentId, 'business');
  assert.equal(restored.find(control => control.id === 'org').slotId, 'home');
  assert.equal(restored.find(control => control.id === 'hidden').rules.visible.enabled, false);
  assert.equal(restoreDesignerLayout(library, old, baseline, baseline).length, old.length);
});
