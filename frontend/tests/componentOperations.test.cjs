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

const { applyComponentOperations } = load('componentOperations', { './model': load('model') });
const fields = id => id === 7 || id === 8 ? ['status'] : undefined;
const initial = () => ({
  title: '巡检', sourceFormId: 7, filterFields: ['status'], roleIds: [],
  widgets: [{ id: 'records', type: 'record-list', title: '巡检记录', appearance: { radius: 4 }, width: 24 }],
});

test('add, style, rename and link components in one editable draft without altering its input', () => {
  const page = initial();
  const draft = applyComponentOperations(page, [
    { action: 'add', widget_id: 'summary', widget_type: 'metric' },
    { action: 'add', widget_id: 'conditions', widget_type: 'record-filter' },
    { action: 'edit', widget_id: 'conditions', properties: { filterFields: ['status'] },
      filter_settings: { queryMode: 'change' }, interaction: { targetWidgetIds: ['records', 'summary'] } },
    { action: 'edit', widget_id: 'records', properties: { title: '当班记录' }, appearance: { titleColor: '#264c64' },
      list_settings: { pageSize: 20 } },
  ], fields);
  assert.equal(page.widgets.length, 1);
  assert.equal(page.widgets[0].title, '巡检记录');
  assert.equal(draft.widgets[0].appearance.radius, 4);
  assert.equal(draft.widgets[0].appearance.titleColor, '#264c64');
  assert.equal(draft.widgets[0].listSettings.pageSize, 20);
  assert.equal(draft.widgets[2].filterSettings.queryMode, 'change');
  assert.equal(draft.widgets[2].targetWidgetIds.join(','), 'records,summary');
});

test('an invalid link rejects the entire batch without partially changing the page', () => {
  const page = initial();
  assert.throws(() => applyComponentOperations(page, [
    { action: 'add', widget_id: 'conditions', widget_type: 'record-filter' },
    { action: 'edit', widget_id: 'conditions', properties: { dataBinding: { formId: 8 } },
      interaction: { targetWidgetIds: ['records'] } },
  ], fields), /同一业务来源/);
  assert.equal(page.widgets.length, 1);
});
