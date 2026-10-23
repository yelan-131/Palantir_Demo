const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/design-preview/unified-form/model.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { initialDesign, createField, moveField, validateRecord } = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('initial material schema has stable business keys, required identity and correct types', () => {
  assert.deepEqual(plain(initialDesign.fields.map(field => field.key)), ['material_code', 'material_name', 'material_type', 'spec_model', 'unit', 'safety_stock', 'status']);
  assert.equal(initialDesign.fields[0].readonly, true);
  assert.deepEqual(plain(initialDesign.fields.filter(field => field.required).map(field => field.key)), ['material_code', 'material_name']);
  assert.equal(initialDesign.fields.find(field => field.key === 'safety_stock').type, 'number');
});

test('new fields have unique identities and isolated editable options without crypto', () => {
  const a = createField('select'); const b = createField('select');
  assert.notEqual(a.id, b.id); assert.notEqual(a.key, b.key);
  a.options.push('额外选项'); assert.equal(b.options.length, 2);
  assert.equal(createField('textarea').width, 100);
  assert.equal(createField('number').required, false);
});

test('moving a field works in both directions, preserves original content and ignores invalid ids', () => {
  const fields = initialDesign.fields.slice(0, 3);
  const original = fields.map(field => field.id);
  assert.deepEqual(plain(moveField(fields, fields[0].id, fields[2].id).map(field => field.id)), [original[1], original[2], original[0]]);
  assert.deepEqual(plain(moveField(fields, fields[2].id, fields[0].id).map(field => field.id)), [original[2], original[0], original[1]]);
  assert.deepEqual(fields.map(field => field.id), original);
  assert.equal(moveField(fields, 'missing', fields[0].id), fields);
  assert.equal(moveField(fields, fields[0].id, fields[0].id), fields);
});

test('validation handles required text, zero, invalid numbers, stock limits and option changes', () => {
  const valid = { material_code: 'MAT-001', material_name: '冷轧钢板', material_type: '原材料', unit: '吨', safety_stock: 0, status: '启用' };
  assert.deepEqual(plain(validateRecord(initialDesign, valid)), {});
  assert.equal(validateRecord(initialDesign, { ...valid, material_name: '  ' }).material_name, '请填写物料名称');
  assert.equal(validateRecord(initialDesign, { ...valid, safety_stock: -1 }).safety_stock, '安全库存不能小于 0');
  for (const value of ['abc', Infinity, NaN]) assert.ok(validateRecord(initialDesign, { ...valid, safety_stock: value }).safety_stock);
  assert.equal(validateRecord(initialDesign, { ...valid, unit: '不存在的单位' }).unit, '请重新选择计量单位');
  const noUnitOptions = { ...initialDesign, fields: initialDesign.fields.map(field => field.key === 'unit' ? { ...field, options: [] } : field) };
  assert.equal(validateRecord(noUnitOptions, valid).unit, '请重新选择计量单位');
  assert.equal(validateRecord(initialDesign, { ...valid, safety_stock: '' }).safety_stock, undefined);
});

test('hidden fields do not block use mode, including when their old value is invalid', () => {
  const design = { ...initialDesign, fields: initialDesign.fields.map(field => ({ ...field, hidden: true })) };
  assert.deepEqual(plain(validateRecord(design, { safety_stock: 'invalid' })), {});
});
