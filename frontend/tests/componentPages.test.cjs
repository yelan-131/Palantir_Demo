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

test('business data design selects the matching editable component and prefers its record list', () => {
 const {businessDataComponent} = context.exports;
 const definition = {sourceFormId:6, widgets:[
   {id:'unrelated',type:'record-list',dataBinding:{formId:2}},
   {id:'filter',type:'record-filter'},
   {id:'metric',type:'metric'},
   {id:'records',type:'record-list'},
 ]};
 assert.equal(businessDataComponent(definition,6)?.id,'records');
 assert.equal(businessDataComponent(definition,2)?.id,'unrelated');
 assert.equal(businessDataComponent(definition,9),undefined);
 assert.equal(businessDataComponent(definition,9,true)?.id,'unrelated');
});

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
test('canvas and widget business menus resolve different sources and reject a removed widget',()=>{
 const {contextSourceId}=context.exports;
 const page={sourceFormId:1,widgets:[{id:'chart',dataBinding:{formId:20}},{id:'list'}]};
 assert.equal(contextSourceId(page),1);
 assert.equal(contextSourceId(page,'chart'),20);
 assert.equal(contextSourceId(page,'list'),1);
 assert.equal(contextSourceId(page,'removed'),undefined);
 assert.equal(contextSourceId({...page,sourceFormId:null}),undefined);
});
test('switching one list source clears its stale fields and keeps the shared filter with the other list',()=>{
 const {bindWidgetSource,mergeListFilters,widgetSourceId}=context.exports;
 const page={sourceFormId:1,filterFields:['title'],widgets:[
  {id:'one',type:'record-list',listSettings:{columns:['title'],sortableColumns:['title'],pageSize:25},dimension:'title'},
  {id:'two',type:'record-list',listSettings:{columns:['qty'],sortableColumns:['qty']}},
  {id:'filter',type:'record-filter',targetWidgetIds:['one','two'],filterFields:['title']}
 ]};
 const next=bindWidgetSource(page,'one',20);
 assert.deepEqual(plain(next.widgets[0].dataBinding),{formId:20});
 assert.equal(next.widgets[0].listSettings.columns,null);
 assert.equal(next.widgets[0].listSettings.sortableColumns,null);
 assert.equal(next.widgets[0].listSettings.pageSize,25);
 assert.equal(next.widgets[0].dimension,undefined);
 assert.deepEqual(plain(next.widgets[1].listSettings.columns),['qty']);
 assert.deepEqual(plain(next.widgets[1].listSettings.sortableColumns),['qty']);
 assert.deepEqual(plain(next.widgets[2].targetWidgetIds),['two']);
 assert.equal(widgetSourceId(next,next.widgets[2]),1);
 assert.deepEqual(plain(next.widgets[2].filterFields),['title']);
 assert.equal(next.widgets[2].standaloneFilter,true);
 assert.equal(mergeListFilters(next).definition,next);
 assert.deepEqual(page.widgets[2].targetWidgetIds,['one','two']);
 assert.deepEqual(plain(next.filterFields),['title']);
});

test('a dedicated filter becomes part of its list without losing its configuration',()=>{
 const {mergeListFilters}=context.exports;
 const filter={id:'filter',type:'record-filter',targetWidgetIds:['list'],filterFields:['title'],
  filterSettings:{queryMode:'change',schemes:[{id:'scheme',name:'查询',groups:[{columns:['title']}]}]}};
 const list={id:'list',type:'record-list',title:'申请',showFilters:false};
 const page={sourceFormId:1,widgets:[filter,list]};
 const result=mergeListFilters(page);
 assert.equal(result.merged.get('filter'),'list');
 assert.deepEqual(plain(result.definition.widgets),[{...list,showFilters:true,filterFields:filter.filterFields,filterSettings:filter.filterSettings}]);
 assert.equal(page.widgets.length,2);
 assert.equal(mergeListFilters(result.definition).definition,result.definition);
});

test('removing a redundant filter preserves an explicitly configured list',()=>{
 const {mergeListFilters}=context.exports;
 const filter={id:'filter',type:'record-filter',targetWidgetIds:['list'],filterFields:['old']};
 const list={id:'list',type:'record-list',showFilters:true,filterFields:['current']};
 const result=mergeListFilters({sourceFormId:1,widgets:[filter,list]});
 assert.equal(result.merged.get('filter'),'list');
 assert.equal(result.definition.widgets.length,1);
 assert.equal(result.definition.widgets[0],list);
});

test('published pages display one list filter while retaining the stored legacy layout',()=>{
 const {pagePresentation}=context.exports;
 const publishedDefinition={sourceFormId:1,widgets:[
  {id:'filter',type:'record-filter',targetWidgetIds:['list'],filterFields:['title']},
  {id:'list',type:'record-list',showFilters:false},
 ]};
 const state={publishedVersion:1,publishedDefinition};
 const visible=pagePresentation(state,false,false).definition;
 assert.deepEqual(plain(visible.widgets),[{id:'list',type:'record-list',showFilters:true,filterFields:['title']}]);
 assert.equal(publishedDefinition.widgets.length,2);
});

test('standalone, shared, restricted and different-source filters retain their separate identity',()=>{
 const {mergeListFilters}=context.exports;
 const list={id:'list',type:'record-list'};
 const filter={id:'filter',type:'record-filter',targetWidgetIds:['list']};
 for(const overrides of [{standaloneFilter:true},{targetWidgetIds:['list','metric']},{roleIds:[2]},{accessGroups:[]},{dataBinding:{formId:2}}]){
  const page={sourceFormId:1,widgets:[list,{...filter,...overrides}]};
  assert.equal(mergeListFilters(page).definition,page);
 }
 const page={sourceFormId:1,widgets:[list,filter,{...filter,id:'second'}]};
 assert.equal(mergeListFilters(page).definition,page);
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

test('the first eligible target supplies a standalone filter source and restricts further choices',()=>{
 const {setSharedFilterTargets,sharedFilterTargetOptions}=context.exports;
 const filter={id:'filter',type:'record-filter',standaloneFilter:true,filterFields:[],filterSettings:{showKeyword:false},targetWidgetIds:[]};
 const page={widgets:[
  filter,
  {id:'details',type:'record-list',dataBinding:{formId:1}},
  {id:'summary',type:'metric',dataBinding:{formId:2}},
  {id:'trend',type:'chart',dataBinding:{formId:2}},
  {id:'unbound',type:'metric'},
  {id:'workspace',type:'workspace',dataBinding:{formId:1}},
 ]};
 const choices = (definition,widget)=>Array.from(sharedFilterTargetOptions(definition,widget),target=>target.id);
 assert.deepEqual(choices(page,filter),['details','summary','trend']);
 const selected=setSharedFilterTargets(page,'filter',['unbound','trend','details','trend','summary','workspace']);
 const updated=selected.widgets[0];
 assert.deepEqual(plain(updated.dataBinding),{formId:2});
 assert.deepEqual(plain(updated.targetWidgetIds),['trend','summary']);
 assert.deepEqual(choices(selected,updated),['summary','trend']);
 assert.equal(setSharedFilterTargets(selected,'filter',['details']),selected);
 assert.equal(setSharedFilterTargets(selected,'details',['summary']),selected);
 assert.deepEqual(filter.targetWidgetIds,[]);
});

test('editing same-source targets preserves legacy filter fields and schemes until choosing a different source',()=>{
 const {setSharedFilterTargets,sharedFilterTargetOptions}=context.exports;
 const filter={id:'filter',type:'record-filter',filterFields:['status'],targetWidgetIds:['list'],
  filterSettings:{requiredFields:['status'],schemes:[{id:'scheme',groups:[{id:'group',columns:['status']}]}]}};
 const page={sourceFormId:1,widgets:[
  filter,{id:'list',type:'record-list'},{id:'same',type:'metric'},{id:'other',type:'metric',dataBinding:{formId:2}},
 ]};
 const sameSource=setSharedFilterTargets(page,'filter',['same']);
 const sameFilter=sameSource.widgets[0];
 assert.equal(sameFilter.standaloneFilter,true);
 assert.deepEqual(plain(sameFilter.dataBinding),{formId:1});
 assert.equal(sameFilter.filterFields,filter.filterFields);
 assert.equal(sameFilter.filterSettings,filter.filterSettings);
 assert.equal(sameSource.widgets[1],page.widgets[1]);

 const cleared=setSharedFilterTargets(sameSource,'filter',[]);
 assert.equal(cleared.widgets[0].dataBinding,sameFilter.dataBinding);
 assert.equal(cleared.widgets[0].filterSettings,filter.filterSettings);
 assert.deepEqual(Array.from(sharedFilterTargetOptions(cleared,cleared.widgets[0]),target=>target.id),['list','same','other']);

 const replaced=setSharedFilterTargets(cleared,'filter',['other']);
 const newFilter=replaced.widgets[0];
 assert.deepEqual(plain(newFilter.dataBinding),{formId:2});
 assert.deepEqual(plain(newFilter.targetWidgetIds),['other']);
 assert.deepEqual(plain(newFilter.filterFields),[]);
 assert.deepEqual(plain(newFilter.filterSettings.requiredFields),[]);
 assert.equal(newFilter.filterSettings.schemes,null);
 assert.equal(replaced.sourceFormId,1);
 assert.deepEqual(filter.targetWidgetIds,['list']);
});

test('canvas queries preserve the first filter while a second filter is configured for another source',()=>{
 const {canvasDataDefinition,componentQuery,pageDataSignature,pendingSharedFilter}=context.exports;
 const first={id:'first',type:'record-filter',standaloneFilter:true,dataBinding:{formId:1},
  filterFields:['status'],filterSettings:{showKeyword:false},targetWidgetIds:['summary']};
 const legacy={id:'legacy',type:'record-filter',dataBinding:{formId:1},targetWidgetIds:['summary']};
 const summary={id:'summary',type:'metric',dataBinding:{formId:1}};
 const details={id:'details',type:'record-list',dataBinding:{formId:2}};
 const workspace={id:'workspace',type:'workspace',dataBinding:{formId:2}};
 const original={filterFields:[],widgets:[first,legacy,summary,details,workspace]};
 const second={id:'second',type:'record-filter',standaloneFilter:true,filterFields:[],
  filterSettings:{showKeyword:false},targetWidgetIds:[]};
 const bound={...second,dataBinding:{formId:2}};
 const fields={...bound,filterFields:['category']};
 const pendingStages=[
  [second,'source'],
  [bound,'fields'],
  [fields,'targets'],
  [{...fields,targetWidgetIds:['summary','workspace','second']},'targets'],
  [{...fields,targetWidgetIds:['details','summary']},'targets'],
 ];
 for (const [filter,reason] of pendingStages) {
  const draft={...original,widgets:[...original.widgets,filter]};
  assert.equal(pendingSharedFilter(draft,filter),reason);
  const queryDefinition=canvasDataDefinition(draft);
  assert.equal(pageDataSignature(queryDefinition),pageDataSignature(original));
  assert.equal(queryDefinition.widgets[0],first);
  assert.equal(queryDefinition.widgets[1],legacy);
  assert.equal(draft.widgets.at(-1),filter);
 }

 const published={...original,widgets:[...original.widgets,{...fields,targetWidgetIds:['details']}]};
 assert.equal(canvasDataDefinition(published),published);
 const applied={
  first:{search:'',filters:[{field:'status',op:'equals',value:'active'}]},
  second:{search:'',filters:[{field:'category',op:'equals',value:'raw'}]},
 };
 assert.deepEqual(plain(componentQuery(published,applied,{},'summary').filters),applied.first.filters);
 assert.deepEqual(plain(componentQuery(published,applied,{},'details').filters),applied.second.filters);
});

test('canvas queries leave existing fallback, keyword and scheme-based filter definitions alone',()=>{
 const {canvasDataDefinition,pendingSharedFilter}=context.exports;
 const details={id:'details',type:'record-list'};
 const filter={id:'filter',type:'record-filter',targetWidgetIds:['details']};
 for(const widget of [
  {...filter,filterFields:[],filterSettings:{showKeyword:false}},
  {...filter,standaloneFilter:true,filterFields:null,filterSettings:{showKeyword:false}},
  {...filter,standaloneFilter:true,filterFields:[],filterSettings:{showKeyword:true}},
  {...filter,standaloneFilter:true,filterFields:[],filterSettings:{showKeyword:false,
   schemes:[{id:'scheme',name:'按状态',groups:[{id:'group',columns:['status']}]}]}},
 ]) {
  const definition={sourceFormId:1,widgets:[details,widget]};
  assert.equal(pendingSharedFilter(definition,widget),undefined);
  assert.equal(canvasDataDefinition(definition),definition);
 }
});

test('rebinding a chart leaves the other cards queryable until its new dimension is configured',()=>{
 const {bindWidgetSource,canvasDataDefinition,pendingDataCard}=context.exports;
 const chart={id:'chart',type:'chart',dataBinding:{formId:1},dimension:'status'};
 const metric={id:'metric',type:'metric',dataBinding:{formId:1}};
 const definition={widgets:[chart,metric]};
 const rebound=bindWidgetSource(definition,'chart',2);
 assert.equal(pendingDataCard(rebound,rebound.widgets[0]),'dimension');
 assert.deepEqual(Array.from(canvasDataDefinition(rebound).widgets),[metric]);
 assert.equal(definition.widgets[0].dimension,'status');
 assert.equal(rebound.widgets.length,2);

 const configured={...rebound,widgets:[{...rebound.widgets[0],dimension:'category'},metric]};
 assert.equal(pendingDataCard(configured,configured.widgets[0]),undefined);
 assert.equal(canvasDataDefinition(configured),configured);
});

test('canvas omits unconfigured cards and projects only links unaffected by those omissions',()=>{
 const {canvasDataDefinition,pendingDataCard}=context.exports;
 const pendingChart={id:'pending',type:'chart',dataBinding:{formId:1}};
 const unboundList={id:'unbound-list',type:'record-list'};
 const unboundMetric={id:'unbound-metric',type:'metric'};
 const summary={id:'summary',type:'metric',dataBinding:{formId:1}};
 const chart={id:'chart',type:'chart',dataBinding:{formId:1},dimension:'old-field',targetWidgetIds:['pending','summary','removed']};
 const filter={id:'filter',type:'record-filter',dataBinding:{formId:1},targetWidgetIds:['pending','summary'],
  standaloneFilter:true,filterFields:['status'],filterSettings:{showKeyword:false}};
 const dependent={id:'dependent',type:'record-filter',dataBinding:{formId:1},targetWidgetIds:['pending']};
 const definition={widgets:[pendingChart,unboundList,unboundMetric,summary,chart,filter,dependent]};
 assert.equal(pendingDataCard(definition,unboundList),'source');
 assert.equal(pendingDataCard(definition,unboundMetric),'source');
 const effective=canvasDataDefinition(definition);
 assert.deepEqual(Array.from(effective.widgets,widget=>widget.id),['summary','chart','filter']);
 assert.equal(effective.widgets[0],summary);
 assert.deepEqual(plain(effective.widgets[1].targetWidgetIds),['summary','removed']);
 assert.equal(effective.widgets[1].dimension,'old-field');
 assert.deepEqual(plain(effective.widgets[2].targetWidgetIds),['summary']);
 assert.deepEqual(filter.targetWidgetIds,['pending','summary']);
 assert.deepEqual(chart.targetWidgetIds,['pending','summary','removed']);
 assert.equal(definition.widgets.at(-1),dependent);
});

test('submitted filter conditions survive unrelated edits and are dropped only when their own configuration changes',()=>{
 const {retainWidgetFilterQueries,widgetFilterSignature}=context.exports;
 const first={id:'first',type:'record-filter',dataBinding:{formId:1},filterFields:['status'],targetWidgetIds:['summary']};
 const second={id:'second',type:'record-filter',dataBinding:{formId:2},filterFields:['category'],targetWidgetIds:['details']};
 const original={widgets:[first]};
 const firstQuery={signature:widgetFilterSignature(original,first),query:{search:'',filters:[{field:'status',op:'equals',value:'active'}]}};
 const single={first:firstQuery};
 const pending={...second,filterFields:[],targetWidgetIds:[]};
 assert.equal(retainWidgetFilterQueries({widgets:[first,pending]},single),single);
 const complete={widgets:[first,second]};
 assert.equal(retainWidgetFilterQueries(complete,single),single);

 const secondQuery={signature:widgetFilterSignature(complete,second),query:{search:'',filters:[{field:'category',op:'equals',value:'raw'}]}};
 const submitted={first:firstQuery,second:secondQuery};
 const retargeted={widgets:[first,{...second,targetWidgetIds:['different-list']}]};
 assert.equal(retainWidgetFilterQueries(retargeted,submitted),submitted);
 for (const changed of [
  {widgets:[first]},
  {widgets:[first,{...second,dataBinding:{formId:3}}]},
  {widgets:[first,{...second,filterFields:['group']}]},
  {widgets:[first,{...second,filterSettings:{requiredFields:['category']}}]},
 ]) {
  const retained=retainWidgetFilterQueries(changed,submitted);
  assert.equal(retained.first,firstQuery);
  assert.deepEqual(Object.keys(retained),['first']);
  assert.equal(submitted.second,secondQuery);
 }
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

test('changing the sole target of an explicit standalone filter only removes the incompatible link',()=>{
 const filter={id:'filter',type:'record-filter',standaloneFilter:true,dataBinding:{formId:1},targetWidgetIds:['list'],
  filterFields:['old'],filterSettings:{requiredFields:['old']}};
 const original={widgets:[{id:'list',type:'record-list',dataBinding:{formId:1}},filter]};
 const next=context.exports.bindWidgetSource(original,'list',2);
 assert.deepEqual(plain(next.widgets[1]),{...filter,targetWidgetIds:[]});
 assert.deepEqual(filter.targetWidgetIds,['list']);
});

test('switching a source clears filter schemes with references to its old fields',()=>{
 const value={title:'page',sourceFormId:1,filterFields:[],roleIds:[],widgets:[{id:'filter',type:'record-filter',title:'F',width:24,aggregate:'count',filterFields:['old'],filterSettings:{schemes:[{id:'scheme',name:'old',groups:[{columns:['old']}]}],requiredFields:['old']}}]};
 const next=context.exports.bindWidgetSource(value,'filter',2);
 assert.equal(next.widgets[0].filterSettings.schemes,null);
 assert.deepEqual(plain(next.widgets[0].filterFields),[]);
 assert.equal(next.widgets[0].standaloneFilter,true);
 assert.equal(value.widgets[0].filterSettings.schemes.length,1);
});

test('explicitly selecting the existing inherited filter source preserves fields and links',()=>{
 const filter={id:'filter',type:'record-filter',targetWidgetIds:['list'],filterFields:['status'],
  filterSettings:{requiredFields:['status']}};
 const value={sourceFormId:1,widgets:[filter,{id:'list',type:'record-list'}]};
 const next=context.exports.bindWidgetSource(value,'filter',1);
 assert.deepEqual(plain(next.widgets[0]),{...filter,dataBinding:{formId:1},standaloneFilter:true});
});

test('leaving an unpublished populated editor returns to saved admin preview without publishing drafts',()=>{
 const saved={title:'专用零部件表单',widgets:[{id:'records',type:'record-list'}]};
 const pending={...saved,title:'未保存修改'};
 const state={code:'parts',publishedVersion:0,definition:saved};
 const {pagePresentation}=context.exports;
 assert.equal(pagePresentation(state,true,false).definition,saved);
 assert.equal(pagePresentation(state,true,false).draftPreview,true);
 assert.equal(pagePresentation(state,true,false).startEditing,false);
 assert.equal(pagePresentation(state,true,true,pending).definition,pending);
 assert.equal(pagePresentation(state,false,false).definition,undefined);
 const published={title:'线上页面',widgets:[]};
 assert.equal(pagePresentation({...state,publishedVersion:1,publishedDefinition:published},true,false).definition,published);
 assert.equal(pagePresentation({...state,definition:{...saved,widgets:[]}},true,false).startEditing,true);
});
