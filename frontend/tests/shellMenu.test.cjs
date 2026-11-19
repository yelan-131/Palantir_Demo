const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/shellMenu.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { normalizeShellMenu, shellMenuAncestors, applicationNavigation, hasApplicationPage, resolveApplicationEntry } = context.exports;

test('group conversion preserves destinations, permissions and nested application menus without mutating input', () => {
  const input = [
    { key: 'data', type: 'group', label: '数据中心', children: [
      { key: 'models', icon: 'existing-icon', children: [{ key: '/model', label: '模型', disabled: true }] },
    ] },
    { type: 'divider' },
    null,
  ];
  const original = JSON.stringify(input);
  const menu = normalizeShellMenu(input, 'fallback-icon');
  assert.equal(menu[0].type, undefined);
  assert.equal(menu[0].icon, 'fallback-icon');
  assert.equal(menu[0].children[0].icon, 'existing-icon');
  assert.equal(menu[0].children[0].children[0].disabled, true);
  assert.equal(menu[1].type, 'divider');
  assert.equal(menu[2], null);
  assert.equal(JSON.stringify(input), original);
  assert.equal(JSON.stringify(shellMenuAncestors(menu, '/model')), '["data","models"]');
  assert.equal(shellMenuAncestors(menu, '/unavailable'), null);
});

test('direct links have no ancestors and empty menus remain safe', () => {
  assert.equal(JSON.stringify(shellMenuAncestors([{ key: '/' }], '/')), '[]');
  assert.equal(JSON.stringify(normalizeShellMenu(undefined, 'icon')), '[]');
});

test('one reachable application page shows the menu, including in a nested group', () => {
  const production = { key: '/production' };
  const quality = { key: '/quality' };
  const group = { key: 'boards', children: [production, { key: 'more-boards', children: [quality] }] };
  assert.equal(hasApplicationPage(undefined), false);
  assert.equal(hasApplicationPage([{ type: 'divider' }, { key: 'no-route' }, { ...quality, disabled: true }]), false);
  assert.equal(hasApplicationPage([production]), true);
  assert.equal(hasApplicationPage([{ key: 'boards', children: [production] }]), true);
  assert.equal(hasApplicationPage([group]), true);
});

test('application navigation keeps home above only the selected application pages', () => {
  const home = { key: '/', label: '我的工作台' };
  const production = [{ key: 'boards', children: [{ key: '/production', label: '生产总览' }] }];
  const quality = [{ key: '/quality', label: '质量总览' }];
  const menu = normalizeShellMenu(applicationNavigation(home, production), 'icon');
  assert.equal(menu[0], home);
  assert.equal(JSON.stringify(shellMenuAncestors(menu, '/production')), '["boards"]');
  const switched = applicationNavigation(home, quality);
  assert.equal(switched[0], home);
  assert.equal(shellMenuAncestors(switched, '/production'), null);
  assert.equal(JSON.stringify(shellMenuAncestors(switched, '/quality')), '[]');
  assert.equal(applicationNavigation(home, [])[0], home);
  assert.equal(applicationNavigation(home, undefined).length, 1);
});

test('application entry opens an accessible default or the first reachable page', () => {
  const pages = [
    { key: '/' },
    { key: '/dynamic/restricted', disabled: true },
    { key: 'master-data', children: [
      { key: '/dynamic/raw-material' },
      { key: '/dynamic/finished-goods' },
    ] },
  ];
  assert.equal(resolveApplicationEntry(pages, '/dynamic/finished-goods'), '/dynamic/finished-goods');
  assert.equal(resolveApplicationEntry(pages, '/'), '/dynamic/raw-material');
  assert.equal(resolveApplicationEntry(pages, '/dynamic/restricted'), '/dynamic/raw-material');
  assert.equal(resolveApplicationEntry(pages, '/pages/unpublished'), '/dynamic/raw-material');
});

test('an application with no reachable pages has no startup route', () => {
  const pages = [
    { key: '/' },
    { key: '/?home=true' },
    { key: '//other-host/page' },
    { key: 'empty-group', children: [] },
    { key: 'disabled-group', disabled: true, children: [{ key: '/pages/hidden' }] },
  ];
  assert.equal(resolveApplicationEntry(pages, '/'), undefined);
  assert.equal(hasApplicationPage(pages), false);
});
