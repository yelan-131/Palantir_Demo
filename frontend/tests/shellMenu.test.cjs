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
const { normalizeShellMenu, shellMenuAncestors, applicationNavigation } = context.exports;

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
