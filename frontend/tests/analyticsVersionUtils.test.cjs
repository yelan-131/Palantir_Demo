const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/AppPrograms/analyticsVersionUtils.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, context);
const {compareAnalyticsVersions, formatAnalyticsVersionTime} = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('comparison ignores object key order and absent empty defaults without mutating either design', () => {
  const snapshot = {widgets:[{id:'a',title:'产量',type:'bar'}],style:{radius:8,gap:12}};
  const draft = {style:{gap:12,radius:8},widgets:[{type:'bar',title:'产量',id:'a'}],datasets:[],metrics:[],globalFilters:[],interactions:[]};
  const before = JSON.stringify([snapshot,draft]);
  assert.equal(compareAnalyticsVersions(snapshot,draft).changed, false);
  assert.equal(JSON.stringify([snapshot,draft]), before);
});

test('changes are directional from historical snapshot to draft and use identity across renames', () => {
  const snapshot = {widgets:[{id:'same',title:'旧名称',type:'bar'},{id:'removed',title:'已删除',type:'line'}]};
  const draft = {widgets:[{id:'same',title:'新名称',type:'bar'},{id:'added',title:'新增图表',type:'pie'}]};
  const diff = plain(compareAnalyticsVersions(snapshot,draft));
  assert.deepEqual(diff.counts,{added:1,removed:1,modified:1,reordered:0});
  assert.deepEqual(diff.groups[0].changes,[{key:'same',name:'新名称',kind:'modified'},{key:'added',name:'新增图表',kind:'added'},{key:'removed',name:'已删除',kind:'removed'}]);
  assert.equal(compareAnalyticsVersions(draft,snapshot).groups[0].changes.find(change=>change.key==='removed').kind,'added');
});

test('preserved item order changes are reported separately; insertions and removals alone are not reorders', () => {
  const widgets = [{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'C'}];
  const reordered = compareAnalyticsVersions({widgets},{widgets:[widgets[2],widgets[0],widgets[1]]});
  assert.deepEqual(plain(reordered.counts),{added:0,removed:0,modified:0,reordered:1});
  const inserted = compareAnalyticsVersions({widgets},{widgets:[{id:'new',title:'新组件'},widgets[0],widgets[2]]});
  assert.deepEqual(plain(inserted.counts),{added:1,removed:1,modified:0,reordered:0});
});

test('explicit deletion of all entities reports each removed component, dataset and metric', () => {
  const diff = compareAnalyticsVersions({widgets:[{id:'w',title:'图表'}],datasets:[{id:'d',name:'生产明细'}],metrics:[{id:'m',name:'良品率'}]}, {widgets:[],datasets:[],metrics:[]});
  assert.deepEqual(plain(diff.counts),{added:0,removed:3,modified:0,reordered:0});
  assert.deepEqual(plain(diff.groups.map(group=>group.changes[0].name)),['图表','生产明细','良品率']);
});

test('nested fields, filter order, interactions, styles and extension settings all remain visible', () => {
  const snapshot = {datasets:[{id:'data',dimensions:['date','shift']}],globalFilters:['date','shift'],interactions:[{sourceWidgetId:'a',targetWidgetId:'b',action:'filter'}],style:{gap:12},extension:{enabled:true}};
  const draft = {datasets:[{id:'data',dimensions:['shift','date']}],globalFilters:['shift','date'],interactions:[],style:{gap:8},extension:{enabled:false}};
  const diff = plain(compareAnalyticsVersions(snapshot,draft));
  assert.deepEqual(diff.groups.map(group=>group.key),['datasets','settings']);
  assert.deepEqual(diff.groups[1].changes.map(change=>change.key),['globalFilters','style','interactions','extensions']);
  assert.equal(diff.counts.modified,5);
  assert.equal(compareAnalyticsVersions({extension:{enabled:true}},{}).changed,true);
  assert.equal(compareAnalyticsVersions({extension:{a:1,b:2}},{extension:{b:2,a:1}}).changed,false);
});

test('missing or invalid timestamps have an honest fallback; valid timestamps include date and time', () => {
  assert.equal(formatAnalyticsVersionTime(), '时间未记录');
  assert.equal(formatAnalyticsVersionTime(null), '时间未记录');
  assert.equal(formatAnalyticsVersionTime('not-a-date'), '时间未记录');
  assert.match(formatAnalyticsVersionTime('2026-10-23T14:05:00'), /2026\/10\/23\s+14:05/);
});

test('malformed legacy collections cannot crash comparisons or appear compatible', () => {
  for (const bad of [{}, [null], [4], [{id:'bad',title:{nested:true}}], [{id:'bad',metricIds:{}}]]) {
    const diff = compareAnalyticsVersions({widgets:bad}, {widgets:[]});
    assert.equal(diff.changed, true);
    assert.equal(diff.snapshotCompatible, false);
    assert.ok(diff.incompatibleSections.includes('历史版本的组件'));
  }
  const malformed = {datasets:'old-format',metrics:[null],globalFilters:{},interactions:[null],style:[]};
  const diff = compareAnalyticsVersions(malformed, malformed);
  assert.equal(diff.snapshotCompatible, false);
  assert.equal(diff.incompatibleSections.length, 10);
  const validSnapshot = compareAnalyticsVersions({widgets:[]},{widgets:[null]});
  assert.equal(validSnapshot.snapshotCompatible, true);
  assert.ok(validSnapshot.incompatibleSections.includes('当前草稿的组件'));
});
