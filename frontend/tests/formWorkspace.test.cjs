const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(compile(fs.readFileSync(path.join(__dirname, '../src/pages/DynamicPage/workspaceState.ts'), 'utf8')), context);
const { reconcilePublishedViewState, canConfigureWorkspace } = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const filter = (id, fieldName = id, extra = {}) => ({ id, fieldName, controlType: 'text', operator: 'contains', enabled: true, ...extra });
const column = (fieldName, extra = {}) => ({ fieldName, enabled: true, sortable: true, ...extra });
const view = (filters = [], columns = []) => ({ filters, table: { columns } });

test('publishing preserves matching filters, keyword, zero values and a valid sort', () => {
  const previous = view([filter('name'), filter('quantity', 'quantity', { controlType: 'number' })], [column('quantity')]);
  const next = view([filter('name'), filter('quantity', 'quantity', { controlType: 'number' })], [column('quantity')]);
  const values = { keyword: '物料', name: '钢板', quantity: 0 };
  const result = reconcilePublishedViewState(previous, next, values, { field: 'quantity', order: 'asc' });
  assert.deepEqual(plain(result), { filterValues: values, sortState: { field: 'quantity', order: 'asc' } });
  assert.notEqual(result.filterValues, values);
});

test('regenerated filter ids retain user input only when the field and operator are equivalent', () => {
  const dateRange = [{ day: 1 }, { day: 2 }];
  const previous = view([filter('old', 'created_at', { controlType: 'dateRange', operator: 'between' })]);
  const next = view([filter('new', 'created_at', { controlType: 'dateRange', operator: 'between' })]);
  const result = reconcilePublishedViewState(previous, next, { old: dateRange }, {});
  assert.equal(result.filterValues.new, dateRange);
  assert.equal(result.filterValues.old, undefined);
});

test('removed, hidden and repurposed filters cannot leak old values into the refreshed schema', () => {
  const previous = view([filter('removed'), filter('disabled'), filter('repurposed'), filter('changed-type'), filter('changed-op')]);
  const next = view([filter('disabled', 'disabled', { enabled: false }), filter('repurposed', 'different-field'), filter('changed-type', 'changed-type', { controlType: 'number' }), filter('changed-op', 'changed-op', { operator: 'equals' })]);
  const result = reconcilePublishedViewState(previous, next, { removed: 'old', disabled: 'old', repurposed: 'old', 'changed-type': 'old', 'changed-op': 'old' }, {});
  assert.deepEqual(plain(result.filterValues), {});
});

test('deleted or disabled sort columns are discarded, including a removed view', () => {
  const previous = view([], [column('stock')]);
  for (const next of [null, view(), view([], [column('stock', { sortable: false })]), view([], [column('stock', { enabled: false })])]) {
    assert.deepEqual(plain(reconcilePublishedViewState(previous, next, {}, { field: 'stock', order: 'desc' }).sortState), {});
  }
});

test('administrator design access is independent of business toolbar visibility and respects read-only permission', () => {
  assert.equal(canConfigureWorkspace(true, true), true);
  assert.equal(canConfigureWorkspace(false, true), false);
  assert.equal(canConfigureWorkspace(true, false), false);
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/DynamicPage/index.tsx'), 'utf8');
  assert.match(source, /canConfigureWorkspace\(Boolean\(user\?\.is_admin\), canRunAction\('configure'\)\)/);
});

test('runtime normalization rejects published default sorting on unavailable columns', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/DynamicPage/index.tsx'), 'utf8');
  const ast = ts.createSourceFile('dynamic.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['isRecord', 'normalizeRuntimeViewConfig'].includes(node.name?.text));
  const scope = {};
  vm.runInNewContext(compile(functions.map(node => node.getText(ast)).join('\n')), scope);
  const fields = [{ field_name: 'name', label: '名称' }];
  const config = { filters: [filter('gone', 'removed')], table: { columns: [column('name')], defaultSort: { fieldName: 'removed', order: 'ascend' } } };
  const result = scope.normalizeRuntimeViewConfig(config, fields);
  assert.equal(result.table.defaultSort, undefined);
  assert.equal(result.filters.length, 0);
  config.table.defaultSort.fieldName = 'name';
  assert.equal(scope.normalizeRuntimeViewConfig(config, fields).table.defaultSort.fieldName, 'name');
});
