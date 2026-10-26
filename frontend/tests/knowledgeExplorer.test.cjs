const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/knowledgeExplorer.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { explorerDefaults, normalizeExplorerPreferences, explorerStorageKey, moveExplorerDocument, removeExplorerFolder, sortExplorerDocuments } = context.exports;
const folder = { id: 'quality', name: '质量改进', icon: 'project', color: 'success' };
const data = [{ id: 'a', title: 'A 文档', updatedAt: '2026-10-20' }, { id: 'b', title: 'B 文档', updatedAt: '2026-10-24' }, { id: 'c', title: 'C 文档', updatedAt: 'invalid' }];

test('directory preferences recover safely and do not retain invalid folder references', () => {
  const result = normalizeExplorerPreferences({ grouping: 'other', sort: 'unknown', wrapTitles: 'true', favorites: ['a', 'a', null], folders: [folder, folder, { id: 'bad:id', name: 'bad' }], assignments: { a: 'quality', b: 'missing' } });
  assert.equal(result.grouping, 'type');
  assert.equal(result.sort, 'manual');
  assert.equal(result.wrapTitles, false);
  assert.equal(result.folders.length, 1);
  assert.equal(JSON.stringify(result.favorites), '["a"]');
  assert.equal(JSON.stringify(result.assignments), '{"a":"quality"}');
  assert.equal(normalizeExplorerPreferences(null).folders.length, 0);
  assert.notEqual(explorerStorageKey(1, 2), explorerStorageKey(1, 3));
  assert.notEqual(explorerStorageKey(1, 2), explorerStorageKey(2, 2));
});

test('moving between personal folders preserves all document references and never mutates input', () => {
  const preferences = { ...explorerDefaults(), folders: [folder], favorites: ['b'] };
  const original = JSON.stringify(preferences);
  const moved = moveExplorerDocument(preferences, 'b', 'quality', ['a', 'b', 'c'], 'a');
  assert.equal(moved.assignments.b, 'quality');
  assert.equal(JSON.stringify(moved.order), '["b","a","c"]');
  assert.equal(JSON.stringify(preferences), original);
  assert.equal(moved.grouping, 'custom');
  const unfiled = moveExplorerDocument(moved, 'b', '', ['a', 'b', 'c']);
  assert.equal(unfiled.assignments.b, undefined);
  assert.equal(JSON.stringify(unfiled.order), '["a","c","b"]');
  assert.equal(moveExplorerDocument(preferences, 'a', 'missing', ['a']), preferences);
  const removed = removeExplorerFolder(moved, 'quality');
  assert.equal(removed.folders.length, 0);
  assert.equal(removed.assignments.b, undefined);
  assert.equal(JSON.stringify(removed.favorites), '["b"]');
  assert.equal(new Set(removed.order).size, 3);
});

test('name, recency and manual ordering remain deterministic without changing source data', () => {
  const original = JSON.stringify(data);
  const prefs = explorerDefaults();
  assert.equal(sortExplorerDocuments(data, { ...prefs, sort: 'recent' }).map(doc => doc.id).join(','), 'b,a,c');
  assert.equal(sortExplorerDocuments(data, { ...prefs, sort: 'name' }).map(doc => doc.id).join(','), 'a,b,c');
  assert.equal(sortExplorerDocuments(data, { ...prefs, order: ['c', 'b'] }).map(doc => doc.id).join(','), 'c,b,a');
  assert.equal(JSON.stringify(data), original);
});
