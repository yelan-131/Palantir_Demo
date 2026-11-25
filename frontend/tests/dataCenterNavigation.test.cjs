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

test('settings expose one asset workspace alongside reference data, objects and knowledge', () => {
  const entries = navigation.visibleNavigationEntries('data', true);
  assert.deepEqual(Array.from(entries, entry => entry.label), ['数据资产', '基础数据', '对象与关系', '知识库']);
  const group = navigation.settingsNavigationGroups(true).find(group => group.key === 'settings-data');
  assert.deepEqual(Array.from(group.entries, entry => entry.path), Array.from(entries, entry => entry.path));
});

test('legacy data and admin links open the correct tab while preserving filters', () => {
  for (const prefix of ['/data-center', '/admin']) {
    for (const [legacy, target, view] of [
      ['sources', 'assets', 'connections'],
      ['pipelines', 'assets', 'pipelines'],
      ['entities', 'objects', 'browse'],
      ['graph', 'objects', 'graph'],
    ]) {
      const destination = navigation.dataCenterDestination(`${prefix}/${legacy}`, '?filter=active&view=old');
      const url = new URL(destination, 'http://localhost');
      assert.equal(url.pathname, `/data-center/${target}`);
      assert.equal(url.searchParams.get('view'), view);
      assert.equal(url.searchParams.get('filter'), 'active');
      if (legacy === 'graph') assert.equal(url.searchParams.has('graphMode'), false);
      assert.equal(navigation.settingsDestinationKey(`${prefix}/${legacy}`), `/data-center/${target}`);
    }
  }
  assert.equal(navigation.settingsDestinationKey('/pipeline'), '/data-center/assets');
  assert.equal(navigation.settingsDestinationKey('/ontology'), '/data-center/objects');
  assert.equal(navigation.LEGACY_ACCOUNT_SECTIONS['ontology-modeling'], '/data-center/objects?view=ontology');
  assert.equal(navigation.dataCenterDestination('/admin/identity'), undefined);
});

test('moved tabs preserve saved source and mapping filters', () => {
  assert.equal(navigation.dataCenterDestination('/data-center/sources', '?tab=pipelines&sourceId=9'),
    '/data-center/assets?sourceId=9&view=pipelines');
  assert.equal(navigation.dataCenterDestination('/data-center/assets', '?view=mapping&sourceId=9&status=approved'),
    '/data-center/objects?view=ontology&sourceId=9&status=approved&section=mapping&mappingSource=external');
  assert.equal(navigation.dataCenterDestination('/data-center/assets', '?view=entities'), '/data-center/objects?view=browse');
});

test('canonical workspace links do not redirect repeatedly', () => {
  for (const url of [
    '/data-center/assets?view=pipelines',
    '/data-center/objects?view=ontology&section=mapping',
    '/data-center/objects?view=graph',
    '/data-center/objects?view=browse&objectType=3&objectKey=WO-260521-017',
  ]) {
    const [pathname, search] = url.split('?');
    assert.equal(navigation.dataCenterDestination(pathname, `?${search}`), url);
  }
});

test('old knowledge graph bookmarks open the business object graph and preserve the selected record', () => {
  const search = '?view=graph&graphMode=knowledge&objectType=3&objectKey=WO-260521-017';
  for (const pathname of ['/data-center/objects', '/data-center/graph', '/admin/graph', '/graph']) {
    const destination = navigation.LEGACY_ROUTES[pathname] || pathname;
    assert.equal(navigation.dataCenterDestination(destination, search),
      '/data-center/objects?view=graph&objectType=3&objectKey=WO-260521-017');
  }
});

test('ordinary users can open connections and sync tasks, browse objects and explore relationships', () => {
  assert.equal(dataWorkspaceSelection('assets', null, false).activeKey, 'connections');
  assert.equal(dataWorkspaceSelection('objects', null, false).activeKey, 'browse');
  for (const [workspace, tab] of [['assets', 'data'], ['objects', 'ontology']]) {
    const result = dataWorkspaceSelection(workspace, tab, false);
    assert.equal(result.forbidden, true);
    assert.ok(result.tabs.every(tab => !tab.adminOnly));
  }
  assert.deepEqual(Array.from(dataWorkspaceSelection('assets', null, false).tabs, tab => tab.key), ['connections', 'pipelines']);
  assert.equal(dataWorkspaceSelection('objects', 'browse', false).forbidden, false);
  assert.equal(dataWorkspaceSelection('objects', 'graph', false).forbidden, false);
  const paths = Array.from(navigation.visibleNavigationEntries('data', false), entry => entry.path);
  assert.ok(paths.includes('/data-center/assets') && paths.includes('/data-center/objects'));
  assert.ok(!paths.includes('/data-center/reference') && !paths.includes('/data-center/knowledge'));
});

test('admin defaults and invalid tabs resolve to a visible workspace page', () => {
  assert.equal(dataWorkspaceSelection('assets', null, true).activeKey, 'data');
  assert.equal(dataWorkspaceSelection('objects', null, true).activeKey, 'browse');
  assert.equal(dataWorkspaceSelection('assets', 'invalid', false).activeKey, 'connections');
  assert.deepEqual(Array.from(dataWorkspaceSelection('assets', null, true).tabs, tab => tab.key), ['data', 'connections', 'pipelines']);
});
