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

test('component bindings override legacy defaults and reload their query',()=>{
 const {widgetSourceId,pageDataSignature}=context.exports;
 const page={sourceFormId:1,filterFields:[],widgets:[{id:'list',type:'record-list'}]};
 assert.equal(widgetSourceId(page,page.widgets[0]),1);
 const changed=plain(page);changed.widgets[0].dataBinding={formId:20};
 assert.equal(widgetSourceId(changed,changed.widgets[0]),20);
 assert.notEqual(pageDataSignature(page),pageDataSignature(changed));
 assert.equal(widgetSourceId({widgets:[]}),undefined);
});
test('switching one component source clears its stale fields and incompatible links only',()=>{
 const {bindWidgetSource}=context.exports;
 const page={sourceFormId:1,filterFields:['title'],widgets:[
  {id:'one',type:'record-list',listSettings:{columns:['title'],pageSize:25},dimension:'title'},
  {id:'two',type:'record-list',listSettings:{columns:['qty']}},
  {id:'filter',type:'record-filter',targetWidgetIds:['one','two']}
 ]};
 const next=bindWidgetSource(page,'one',20);
 assert.deepEqual(plain(next.widgets[0].dataBinding),{formId:20});
 assert.equal(next.widgets[0].listSettings.columns,null);
 assert.equal(next.widgets[0].listSettings.pageSize,25);
 assert.equal(next.widgets[0].dimension,undefined);
 assert.deepEqual(plain(next.widgets[1].listSettings.columns),['qty']);
 assert.deepEqual(plain(next.widgets[2].targetWidgetIds),['one']);
 assert.equal(next.widgets[2].dataBinding.formId,20);
 assert.deepEqual(page.widgets[2].targetWidgetIds,['one','two']);
 assert.deepEqual(plain(next.filterFields),['title']);
});

test('list filter creation binds the selected source and scopes queries to that list',()=>{
 const {ensureListFilter}=context.exports;
 const page={sourceFormId:1,filterFields:[],widgets:[{id:'other',type:'record-list'},{id:'list',type:'record-list',title:'申请',dataBinding:{formId:20},showFilters:true}]};
 const result=ensureListFilter(page,'list','filter');
 assert.equal(result.created,true);
 assert.deepEqual(plain(result.definition.widgets.map(item=>item.id)),['other','filter','list']);
 assert.deepEqual(plain(result.definition.widgets[1].dataBinding),{formId:20});
 assert.deepEqual(plain(result.definition.widgets[1].targetWidgetIds),['list']);
 assert.equal(result.definition.widgets[2].showFilters,false);
 assert.equal(page.widgets.length,2);
 const reused=ensureListFilter(result.definition,'list','another');
 assert.equal(reused.created,false);
 assert.equal(reused.filterId,'filter');
 assert.equal(reused.definition,result.definition);
});
test('unbound, unrelated and full pages cannot gain an invalid automatic filter',()=>{
 const {ensureListFilter}=context.exports;
 assert.equal(ensureListFilter({widgets:[{id:'list',type:'record-list'}]},'list','f'),undefined);
 assert.equal(ensureListFilter({sourceFormId:1,widgets:[{id:'metric',type:'metric'}]},'metric','f'),undefined);
 const widgets=Array.from({length:30},(_,i)=>({id:String(i),type:'record-list',title:String(i)}));
 assert.equal(ensureListFilter({sourceFormId:1,widgets},'1','f'),undefined);
});

test('filter and chart contributions intersect without losing another source on clear',()=>{
 const {componentQuery}=context.exports;
 const page={sourceFormId:1,widgets:[
  {id:'filter',type:'record-filter',targetWidgetIds:['total','list']},
  {id:'a',type:'chart',dimension:'status',targetWidgetIds:['total','list']},
  {id:'b',type:'chart',dimension:'status',targetWidgetIds:['total']},
  {id:'foreign',type:'record-filter',dataBinding:{formId:2},targetWidgetIds:['total']},
  {id:'total',type:'metric'},{id:'list',type:'record-list'},
 ]};
 const values={filter:{search:'A',filters:[{field:'qty',op:'gte',value:0}]},foreign:{search:'secret',filters:[]}};
 const combined=componentQuery(page,values,{a:'open',b:'closed'},'total');
 assert.equal(combined.search,'A');
 assert.equal(combined.filters.length,3);
 assert.deepEqual(plain(combined.filters.slice(1).map(c=>c.value)),['open','closed']);
 const afterClear=componentQuery(page,values,{b:'closed'},'total');
 assert.equal(afterClear.filters.length,2);
 assert.equal(afterClear.filters[1].value,'closed');
 assert.equal(componentQuery(page,values,{b:'closed'},'list').filters.length,1);
});
test('required filters block metrics and binding/configuration changes reload aggregate data',()=>{
 const {componentQuery,pageDataSignature}=context.exports;
 const page={sourceFormId:1,filterFields:[],widgets:[{id:'f',type:'record-filter',targetWidgetIds:['m'],filterSettings:{requiredFields:['title']}},{id:'m',type:'metric'}]};
 assert.equal(componentQuery(page,{}, {},'m').ready,false);
 const next=plain(page);next.widgets[0].targetWidgetIds=[];
 assert.equal(componentQuery(next,{}, {},'m').ready,true);
 assert.notEqual(pageDataSignature(page),pageDataSignature(next));
});

test('changing list source synchronizes linked filters and clears old field references',()=>{
 const page={sourceFormId:1,widgets:[{id:'list',type:'record-list',dataBinding:{formId:1}},{id:'filter',type:'record-filter',dataBinding:{formId:1},targetWidgetIds:['list'],filterFields:['old'],filterSettings:{requiredFields:['old']}}]};
 const next=context.exports.bindWidgetSource(page,'list',2);
 assert.equal(next.widgets[1].dataBinding.formId,2);
 assert.deepEqual(plain(next.widgets[1].targetWidgetIds),['list']);
 assert.equal(next.widgets[1].filterFields,null);
 assert.deepEqual(plain(next.widgets[1].filterSettings.requiredFields),[]);
 assert.equal(page.widgets[1].dataBinding.formId,1);
});
test('configure linked filter repairs a stale source rather than creating a duplicate',()=>{
 const page={widgets:[{id:'list',type:'record-list',dataBinding:{formId:2}},{id:'filter',type:'record-filter',dataBinding:{formId:1},targetWidgetIds:['list']}]};
 const result=context.exports.ensureListFilter(page,'list','new');
 assert.equal(result.filterId,'filter');
 assert.equal(result.definition.widgets.length,2);
 assert.equal(result.definition.widgets[1].dataBinding.formId,2);
 assert.deepEqual(plain(result.definition.widgets[1].targetWidgetIds),['list']);
});

test('switching a source clears filter schemes with references to its old fields',()=>{
 const value={title:'page',sourceFormId:1,filterFields:[],roleIds:[],widgets:[{id:'filter',type:'record-filter',title:'F',width:24,aggregate:'count',filterFields:['old'],filterSettings:{schemes:[{id:'scheme',name:'old',groups:[{columns:['old']}]}],requiredFields:['old']}}]};
 const next=context.exports.bindWidgetSource(value,'filter',2);
 assert.equal(next.widgets[0].filterSettings.schemes,null);
 assert.equal(next.widgets[0].filterFields,null);
 assert.equal(value.widgets[0].filterSettings.schemes.length,1);
});
