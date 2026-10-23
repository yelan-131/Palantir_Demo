const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/config/navigation.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {}, URLSearchParams };
vm.runInNewContext(code, context);
const { NAVIGATION_ENTRIES, visibleNavigationEntries, navigationAreaForPath } = context.exports;

test('backend tools are administrator-only and have no duplicate navigation paths', () => {
  const entries = visibleNavigationEntries('admin', true);
  assert.ok(entries.length > 3);
  assert.equal(visibleNavigationEntries('admin', false).length, 0);
  assert.ok(entries.every(entry => entry.adminOnly && entry.group && navigationAreaForPath(entry.path) === 'admin'));
  assert.equal(new Set(NAVIGATION_ENTRIES.map(entry => entry.path)).size, NAVIGATION_ENTRIES.length);
});

test('backend navigation omits the removed overview and preserves data links', () => {
  assert.equal(NAVIGATION_ENTRIES.some(entry => entry.path === '/admin/overview'), false);
  assert.ok(visibleNavigationEntries('data', false).some(entry => entry.path === '/data-center/sources'));
  assert.equal(navigationAreaForPath('/data-sources'), 'data');
});


test('settings categories separate personal, application, data and privileged configuration', () => {
  const groups = context.exports.settingsNavigationGroups(true);
  const paths = groups.flatMap(group => group.entries.map(entry => entry.path));
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(groups.find(group => group.key === 'settings-personal').entries.some(entry => entry.path.startsWith('/data-center')), false);
  assert.ok(groups.find(group => group.key === 'settings-personal').entries.some(entry => entry.path === '/account-center?tab=preferences'));
  assert.ok(groups.find(group => group.key === 'settings-data').entries.every(entry => entry.path.startsWith('/data-center/')));
  const memberGroups = context.exports.settingsNavigationGroups(false);
  assert.equal(memberGroups.some(group => ['settings-platform', 'settings-advanced'].includes(group.key)), false);
  assert.ok(memberGroups.flatMap(group => group.entries).every(entry => !entry.adminOnly));
});

test('settings selection follows canonical data routes and distinguishes work preferences', () => {
  const key = context.exports.settingsDestinationKey;
  assert.equal(key('/admin/sources'), '/data-center/sources');
  assert.equal(key('/admin/identity'), '/admin/identity');
  assert.equal(key('/account-center', '?tab=preferences'), '/account-center?tab=preferences');
  assert.equal(key('/account-center'), '/account-center');
  assert.equal(key('/form-settings/12'), '/studio/applications');
});
