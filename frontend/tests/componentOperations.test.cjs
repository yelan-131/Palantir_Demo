const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/ComponentPages', name + '.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: key => dependencies[key] });
  return exports;
}

const { applyComponentOperations, newComponent } = load('componentOperations', { './model': load('model') });
const fields = id => id === 7 || id === 8 ? ['status'] : undefined;
const initial = () => ({
  title: '巡检', sourceFormId: 7, filterFields: ['status'], roleIds: [],
  widgets: [{ id: 'records', type: 'record-list', title: '巡检记录', appearance: { radius: 4 }, width: 24 }],
});

test('add, style, rename and link components in one editable draft without altering its input', () => {
  const page = initial();
  const draft = applyComponentOperations(page, [
    { action: 'add', widget_id: 'summary', widget_type: 'metric' },
    { action: 'add', widget_id: 'conditions', widget_type: 'chart' },
    { action: 'edit', widget_id: 'conditions', interaction: { targetWidgetIds: ['records', 'summary'] } },
    { action: 'edit', widget_id: 'records',
      properties: { title: '当班记录', showFilters: true, filterFields: ['status'] },
      appearance: { titleColor: '#264c64' },
      list_settings: { pageSize: 20 }, filter_settings: { queryMode: 'change' } },
  ], fields);
  assert.equal(page.widgets.length, 1);
  assert.equal(page.widgets[0].title, '巡检记录');
  assert.equal(draft.widgets[0].appearance.radius, 4);
  assert.equal(draft.widgets[0].appearance.titleColor, '#264c64');
  assert.equal(draft.widgets[0].listSettings.pageSize, 20);
  assert.equal(draft.widgets[0].filterSettings.queryMode, 'change');
  assert.equal(draft.widgets[0].showFilters, true);
  assert.equal(draft.widgets[2].targetWidgetIds.join(','), 'records,summary');
});

test('an invalid link rejects the entire batch without partially changing the page', () => {
  const page = initial();
  assert.throws(() => applyComponentOperations(page, [
    { action: 'add', widget_id: 'conditions', widget_type: 'chart' },
    { action: 'edit', widget_id: 'conditions', properties: { dataBinding: { formId: 8 } },
      interaction: { targetWidgetIds: ['records'] } },
  ], fields), /同一业务来源/);
  assert.equal(page.widgets.length, 1);
});

test('the page editor creates an unconfigured standalone filter without broadening automation add types', () => {
  const created = newComponent(initial(), 'conditions', 'record-filter');
  assert.equal(created.title, '联动筛选');
  assert.equal(created.standaloneFilter, true);
  assert.equal(created.filterFields.length, 0);
  assert.equal(created.targetWidgetIds.length, 0);
  assert.equal(created.filterSettings.showKeyword, false);
  assert.equal(created.showFilters, undefined);
  assert.throws(() => applyComponentOperations(initial(), [
    { action: 'add', widget_id: 'conditions', widget_type: 'record-filter' },
  ], fields), /不支持此组件类型/);
});

test('editing a standalone filter accepts valid same-source links and rejects unrelated properties', () => {
  const page = initial();
  page.widgets.push(
    { id: 'conditions', type: 'record-filter', targetWidgetIds: [] },
    { id: 'foreign', type: 'metric', dataBinding: { formId: 8 } },
  );
  const draft = applyComponentOperations(page, [{
    action: 'edit', widget_id: 'conditions', properties: { filterFields: ['status'] },
    interaction: { targetWidgetIds: ['records'] }, filter_settings: { queryMode: 'change' },
  }], fields);
  const filter = draft.widgets[1];
  assert.equal(filter.standaloneFilter, true);
  assert.deepEqual(filter.filterFields, ['status']);
  assert.deepEqual(filter.targetWidgetIds, ['records']);
  assert.equal(filter.filterSettings.queryMode, 'change');
  assert.deepEqual(page.widgets[1].targetWidgetIds, []);

  assert.throws(() => applyComponentOperations(page, [{
    action: 'edit', widget_id: 'conditions', interaction: { targetWidgetIds: ['foreign'] },
  }], fields), /同一业务来源/);
  assert.throws(() => applyComponentOperations(page, [{
    action: 'edit', widget_id: 'conditions', properties: { chartType: 'line' },
  }], fields), /联动筛选只支持修改/);
});
