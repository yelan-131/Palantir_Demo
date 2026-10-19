const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/pages/DynamicPage/index.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mapPlatformField');
const context = {};
vm.createContext(context);
vm.runInContext(ts.transpileModule(fn.getText(ast), {}).outputText, context);

test('AI-created relation metadata works in both object and legacy string form', () => {
  const relation = { target_model: 'test_archive', label_field: 'name' };
  for (const config of [relation, JSON.stringify(relation)]) {
    const field = context.mapPlatformField({ field_name: 'archive', field_type: 'relation', ui_config: { relation_config: config } });
    assert.deepEqual(JSON.parse(field.relation_config), relation);
  }
});

test('automatic encoding is generated while manual or disabled encoding stays editable', () => {
  const field = { field_type: 'string', ui_config: { businessType: 'code', encodingRule: { enabled: true } } };
  assert.equal(context.mapPlatformField(field).generated_code, true);
  for (const rule of [{ enabled: false }, { generationMode: 'manual' }, { allowManualOverride: true }]) {
    assert.equal(context.mapPlatformField({ ...field, ui_config: { businessType: 'code', encodingRule: rule } }).generated_code, false);
  }
  assert.equal(context.mapPlatformField({ field_type: 'string' }).generated_code, false);
});

test('editing datetime records preserves time while date fields stay date-only', () => {
  const payloadFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'formFieldsToPayload');
  context.dayjs = require('dayjs');
  vm.runInContext(ts.transpileModule(payloadFunction.getText(ast), {}).outputText, context);
  const value = context.dayjs('2026-10-19T22:43:23');
  const payload = context.formFieldsToPayload({ inbound_date: value, date: value }, [
    { field_name: 'inbound_date', field_type: 'datetime' }, { field_name: 'date', field_type: 'date' },
  ]);
  assert.equal(payload.inbound_date, '2026-10-19T22:43:23');
  assert.equal(payload.date, '2026-10-19');
});
