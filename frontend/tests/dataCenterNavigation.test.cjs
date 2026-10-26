const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadConfig(name) {
  const context = { exports: {}, URLSearchParams };
  const source = fs.readFileSync(path.join(__dirname, `../src/config/${name}.ts`), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const navigation = loadConfig('navigation');
const { dataWorkspaceSelection } = loadConfig('dataCenter');

test('settings expose five data workspaces with the same destinations as search', () => {
  const entries = navigation.visibleNavigationEntries('data', true);
  assert.deepEqual(Array.from(entries, entry => entry.label), ['数据接入', '数据资产', '基础数据', '对象与关系', '知识库']);
  const group = navigation.settingsNavigationGroups(true).find(group => group.key === 'settings-data');
  assert.deepEqual(Array.from(group.entries, entry => entry.path), Array.from(entries, entry => entry.path));
});

test('legacy data and admin links open the correct tab while preserving filters', () => {
  for (const prefix of ['/data-center', '/admin']) {
    for (const [legacy, target, parameter, value] of [
      ['pipelines', 'sources', 'tab', 'pipelines'],
      ['entities', 'assets', 'view', 'entities'],
      ['graph', 'objects', 'view', 'graph'],
    ]) {
      const destination = navigation.dataCenterDestination(`${prefix}/${legacy}`, '?filter=active&view=old');
      const url = new URL(destination, 'http://localhost');
      assert.equal(url.pathname, `/data-center/${target}`);
      assert.equal(url.searchParams.get(parameter), value);
      assert.equal(url.searchParams.get('filter'), 'active');
      assert.equal(navigation.settingsDestinationKey(`${prefix}/${legacy}`), `/data-center/${target}`);
    }
  }
  assert.equal(navigation.settingsDestinationKey('/pipeline'), '/data-center/sources');
  assert.equal(navigation.settingsDestinationKey('/ontology'), '/data-center/assets');
  assert.equal(navigation.dataCenterDestination('/admin/identity'), undefined);
});

test('canonical workspace links do not redirect repeatedly', () => {
  for (const url of ['/data-center/sources?tab=pipelines', '/data-center/assets?view=mapping', '/data-center/objects?view=graph']) {
    const [pathname, search] = url.split('?');
    assert.equal(navigation.dataCenterDestination(pathname, `?${search}`), url);
  }
});

test('ordinary users keep entity and graph access without gaining configuration access', () => {
  assert.equal(dataWorkspaceSelection('assets', null, false).activeKey, 'entities');
  assert.equal(dataWorkspaceSelection('objects', null, false).activeKey, 'graph');
  for (const [workspace, tab] of [['assets', 'data'], ['assets', 'mapping'], ['objects', 'ontology']]) {
    const result = dataWorkspaceSelection(workspace, tab, false);
    assert.equal(result.forbidden, true);
    assert.ok(result.tabs.every(tab => !tab.adminOnly));
  }
  assert.equal(dataWorkspaceSelection('assets', 'entities', false).forbidden, false);
  assert.equal(dataWorkspaceSelection('objects', 'graph', false).forbidden, false);
  const paths = Array.from(navigation.visibleNavigationEntries('data', false), entry => entry.path);
  assert.ok(paths.includes('/data-center/assets') && paths.includes('/data-center/objects'));
  assert.ok(!paths.includes('/data-center/reference') && !paths.includes('/data-center/knowledge'));
});

test('admin defaults and invalid tabs resolve to a visible workspace page', () => {
  assert.equal(dataWorkspaceSelection('sources', null, true).activeKey, 'connections');
  assert.equal(dataWorkspaceSelection('assets', null, true).activeKey, 'data');
  assert.equal(dataWorkspaceSelection('objects', null, true).activeKey, 'ontology');
  assert.equal(dataWorkspaceSelection('assets', 'invalid', false).activeKey, 'entities');
});
