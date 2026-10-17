const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/viewConfig.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { makeDefaultViewConfig, normalizeViewConfig, getViewTabs, updateActiveView } = context.exports;
const fields = [{ fieldName: 'code', label: '编码', searchable: true }, { fieldName: 'name', label: '名称' }];
const json = (value) => JSON.parse(JSON.stringify(value));

test('existing configuration becomes one public default tab without data loss', () => {
  const original = makeDefaultViewConfig(fields);
  const normalized = normalizeViewConfig(original, fields);
  assert.deepEqual(json(getViewTabs(normalized)[0].filters), json(original.filters));
  assert.equal(getViewTabs(normalized)[0].audience.mode, 'everyone');
});

test('editing one tab preserves the other tab and canonical root after reload', () => {
  const original = makeDefaultViewConfig(fields);
  const first = getViewTabs(original)[0];
  const second = { ...structuredClone(first), id: 'warehouse', name: '仓储视图', audience: { mode: 'restricted', roleIds: [2], userIds: [5], orgIds: [] } };
  const config = { ...original, tabs: [first, second] };
  const updated = updateActiveView(config, 'warehouse', (current) => ({ ...current, filters: [], table: { ...current.table, columns: current.table.columns.slice(1), pageSize: 60 } }));
  const reloaded = normalizeViewConfig(json(updated), fields);
  assert.equal(reloaded.tabs[1].filters.length, 0);
  assert.equal(reloaded.tabs[1].table.columns.length, 1);
  assert.equal(reloaded.tabs[1].table.pageSize, 60);
  assert.deepEqual(json(reloaded.tabs[1].audience), json(second.audience));
  assert.deepEqual(json(reloaded.filters), json(original.filters));
  assert.equal(reloaded.table.columns.length, 2);
  assert.equal(config.tabs[1].table.columns.length, 2);
});

test('editing the default tab updates compatibility root while retaining restricted tab', () => {
  const original = makeDefaultViewConfig(fields);
  const first = getViewTabs(original)[0];
  const config = { ...original, tabs: [first, { ...structuredClone(first), id: 'private', name: '私有' }] };
  const updated = updateActiveView(config, 'default', (current) => ({ ...current, filters: [] }));
  assert.equal(updated.filters.length, 0);
  assert.equal(updated.tabs[0].filters.length, 0);
  assert.equal(updated.tabs[1].filters.length, 1);
});
