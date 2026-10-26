const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/ComponentPages/model.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, context);
const plain = value => JSON.parse(JSON.stringify(value));
const {moveWidget, listFilters, retainFilters} = context.exports;

test('dragging preserves component identities and configuration without mutating the saved page', () => {
  const page = {widgets: [{id:'list',width:24},{id:'chart',dimension:'status'},{id:'metric',aggregate:'sum',measure:'qty'}]};
  const next = moveWidget(page, 'metric', 'list');
  assert.deepEqual(plain(next.widgets.map(widget=>widget.id)), ['metric','list','chart']);
  assert.equal(next.widgets[0].measure, 'qty');
  assert.equal(page.widgets[0].id, 'list');
  assert.equal(moveWidget(page, 'missing', 'chart'), page);
});
test('page filters become exact backend list conditions without dropping zero values', () => {
  assert.deepEqual(plain(listFilters({status:'待处理',qty:'0',empty:''})), [{field:'status',op:'equals',value:'待处理'},{field:'qty',op:'equals',value:'0'}]);
});
test('removed filter bindings cannot survive a newly published page definition', () => {
  assert.deepEqual(plain(retainFilters({status:'审批中',secret:'value'},['status'])), {status:'审批中'});
});
test('live preview reuses results for presentation edits but reloads changed statistics',()=>{
 const {pageDataSignature}=context.exports;
 const original={sourceFormId:1,filterFields:['status'],widgets:[{id:'chart',type:'chart',aggregate:'count',dimension:'status',width:12}]};
 const next=plain(original);next.title='新标题';next.style={componentGap:20};next.widgets[0].height=400;next.widgets[0].interaction='none';next.widgets[0].width=24;
 assert.equal(pageDataSignature(next),pageDataSignature(original));
 next.widgets[0].aggregate='sum';next.widgets[0].measure='qty';
 assert.notEqual(pageDataSignature(next),pageDataSignature(original));
});
test('detached filters target only linked lists and reset without removing global conditions', () => {
 const {linkedListQuery}=context.exports;
 const widgets=[{id:'f1',type:'record-filter',targetWidgetIds:['one']},{id:'f2',type:'record-filter',targetWidgetIds:['one','two']}];
 const values={f1:{search:'WO',filters:[{field:'qty',op:'gte',value:0}]},f2:{search:'',filters:[{field:'status',op:'equals',value:'执行中'}]}};
 assert.deepEqual(plain(linkedListQuery(widgets,values,'two')),{ready:true,...values.f2});
 assert.equal(linkedListQuery(widgets,values,'one').filters.length,2);
 assert.deepEqual(plain(linkedListQuery(widgets,values,'unlinked')),{ready:true,search:'',filters:[]});
 values.f1={search:'',filters:[]};
 assert.deepEqual(plain(linkedListQuery(widgets,values,'one')),{ready:true,...values.f2});
});
test('dashboard presentation keeps results while percent-format calculations reload them',()=>{
 const {pageDataSignature}=context.exports;
 const original={sourceFormId:1,filterFields:[],widgets:[{id:'chart',type:'chart',aggregate:'avg',measure:'qty',dimension:'status'}]};
 const next=plain(original);next.style={chartPalette:'business',filterTheme:'panel',refreshInterval:60};
 Object.assign(next.widgets[0],{chartType:'pie',appearance:{palette:'warning',showLabels:true,radius:12},unit:'件',threshold:'红色 > 100',interaction:'drilldown'});
 assert.equal(pageDataSignature(next),pageDataSignature(original));
 next.widgets[0].format='percent';
 assert.notEqual(pageDataSignature(next),pageDataSignature(original));
});

test('linked lists wait for required filters and can proceed after valid submission',()=>{
 const {linkedListQuery}=context.exports;
 const widgets=[{id:'f',type:'record-filter',targetWidgetIds:['list'],filterSettings:{requiredFields:['name']}}];
 assert.equal(linkedListQuery(widgets,{},'list').ready,false);
 assert.equal(linkedListQuery(widgets,{f:{ready:false,search:'',filters:[]}},'list').ready,false);
 assert.equal(linkedListQuery(widgets,{f:{ready:true,search:'',filters:[{field:'name',op:'equals',value:'A'}]}},'list').ready,true);
});
