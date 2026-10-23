const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/AppPrograms/analyticsEditorState.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, context);
const {normalizeAnalyticsDesign, sameAnalyticsDesign, moveAnalyticsWidget} = context.exports;

test('draft normalization preserves explicit deletions and does not share nested data with published design', () => {
  const published = {widgets: [], datasets: [{id:'data', dimensions:['date']}], style:{cardRadius:8}};
  const draft = normalizeAnalyticsDesign(published);
  draft.datasets[0].dimensions.push('subject');
  draft.style.cardRadius = 12;
  assert.equal(draft.widgets.length, 0);
  assert.deepEqual(published.datasets[0].dimensions, ['date']);
  assert.equal(published.style.cardRadius, 8);
});

test('JSON storage object ordering is not a change; widget ordering is', () => {
  assert.equal(sameAnalyticsDesign({style:{radius:8,gap:12}}, {style:{gap:12,radius:8}}), true);
  assert.equal(sameAnalyticsDesign({widgets:[{id:'a'},{id:'b'}]}, {widgets:[{id:'b'},{id:'a'}]}), false);
});

test('moving a component preserves all binding identities and the original published order', () => {
  const design = {widgets:[{id:'a',datasetId:'source'},{id:'b'},{id:'c'}], interactions:[{sourceWidgetId:'a',targetWidgetId:'b',action:'filter'}]};
  const moved = moveAnalyticsWidget(design, 'a', 'c');
  assert.deepEqual(Array.from(moved.widgets, item=>item.id), ['b','c','a']);
  assert.deepEqual(design.widgets.map(item=>item.id), ['a','b','c']);
  assert.equal(moved.widgets[2].datasetId, 'source');
  assert.deepEqual(moved.interactions, design.interactions);
  assert.equal(moveAnalyticsWidget(design, 'missing','b'), design);
});

test('applying an isolated dataset keeps sibling changes and cleans only obsolete bindings', () => {
  const {applyAnalyticsDataset} = context.exports;
  const current = {style:{cardRadius:12},datasets:[{id:'d',dimensions:['status'],source:'a'},{id:'other',dimensions:['status'],source:'b'}],
    metrics:[{id:'sum',datasetId:'d',expression:'sum(actual)'},{id:'sibling',datasetId:'other'},{id:'removed',datasetId:'d'}],
    widgets:[{id:'w',datasetId:'d',dimension:'status',metricIds:['sum','removed']},{id:'other-w',datasetId:'other',dimension:'status',metricIds:['sibling']}],
    globalFilters:['status'],interactions:[{sourceWidgetId:'w',targetWidgetId:'other-w',action:'filter'}]};
  const updated = applyAnalyticsDataset(current,{id:'d',source:'a',dimensions:[],measures:['actual'],rangeFilters:[{field:'actual',operator:'gt',value:'0'}]},[{id:'sum',datasetId:'d',expression:'sum(actual)/1000'},{id:'new',datasetId:'d',expression:'count(*)'}]);
  assert.deepEqual(Array.from(updated.metrics, item=>item.id),['sum','sibling','new']);
  assert.equal(updated.widgets[0].id,'w');
  assert.deepEqual(Array.from(updated.widgets[0].metricIds),['sum']);
  assert.equal(updated.widgets[0].dimension,undefined);
  assert.equal(updated.widgets[1].dimension,'status');
  assert.deepEqual(Array.from(updated.globalFilters),['status']);
  assert.equal(updated.interactions.length,0);
  assert.equal(updated.style.cardRadius,12);
  assert.equal(updated.datasets[0].rangeFilters[0].value,'0');
  assert.deepEqual(current.widgets[0].metricIds,['sum','removed']);
  assert.equal(current.metrics[0].expression,'sum(actual)');
});
