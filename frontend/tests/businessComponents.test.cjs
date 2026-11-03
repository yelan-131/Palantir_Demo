const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/pages/ComponentPages/businessComponents.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {resolveListView,emptyFilterValue}=context.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const view={filters:[],table:{columns:[{fieldName:'name',enabled:true,sortable:true,sortOrder:1},{fieldName:'qty',enabled:true,sortable:true,sortOrder:2},{fieldName:'secret',enabled:false,sortOrder:3}],pageSize:20,rowClickAction:'detail',toolbarActions:['refresh'],rowActions:['detail']}};
test('separate components keep field boundaries while configuring independent toolbar presentation',()=>{
 const a=resolveListView(view,{columns:['qty','secret','name'],toolbarActions:['create','refresh'],rowActions:['edit','detail'],rowClick:'edit',pageSize:5});
 assert.deepEqual(plain(a.table.columns.map(column=>column.fieldName)),['qty','name']);
 assert.deepEqual(plain(a.table.toolbarActions),['create','refresh']);
 assert.deepEqual(plain(a.table.rowActions),['detail']);
 assert.equal(a.table.rowClickAction,'none');
 assert.equal(a.table.pageSize,5);
 assert.equal(view.table.pageSize,20);
 assert.deepEqual(plain(resolveListView(view,{})),view);
});
test('sort bindings must belong to an available sortable published column',()=>{
 assert.equal(resolveListView(view,{defaultSort:{field:'secret',order:'asc'}}).table.defaultSort,undefined);
 assert.deepEqual(plain(resolveListView(view,{defaultSort:{field:'qty',order:'desc'}}).table.defaultSort),{fieldName:'qty',order:'descend'});
});
test('required filter checks preserve numeric zero and reject empty date ranges',()=>{
 assert.equal(emptyFilterValue(0),false);assert.equal(emptyFilterValue(false),false);
 for(const value of [null,undefined,'','   ',[],[null,undefined],['2026-10-24',null]])assert.equal(emptyFilterValue(value),true);
 assert.equal(emptyFilterValue(['2026-10-24','2026-10-25']),false);
});

test('clearing filters produces explicit empty control values so defaults cannot return',()=>{
 const values=context.exports.clearedFilterValues([{id:'text',controlType:'text'},{id:'date',controlType:'dateRange'},{id:'quantity',controlType:'number'}]);
 assert.deepEqual(plain(values),{text:'',date:null,quantity:null});
 assert.equal(Object.hasOwn(values,'quantity'),true);
});

test('toolbar groups merge matching server groups independently of source toolbar presentation',()=>{
 const groups=[{id:'a',name:'A',roleIds:[],actions:['create','refresh']},{id:'b',name:'B',roleIds:[],actions:['refresh','export']}];
 assert.deepEqual(plain(resolveListView(view,{toolbarGroups:groups}).table.toolbarActions),['create','refresh','export']);
 assert.deepEqual(plain(resolveListView(view,{toolbarGroups:[],toolbarActions:['refresh']}).table.toolbarActions),[]);
});

test('display groups merge columns in order, preserve explicit empties and source field boundaries',()=>{
 const groups=[{columns:['qty','secret']},{columns:['name','qty']}];
 const result=resolveListView(view,{displayGroups:groups});
 assert.deepEqual(plain(result.table.columns.map(column=>column.fieldName)),['qty','name']);
 assert.deepEqual(plain(resolveListView(view,{displayGroups:[],columns:['name']}).table.columns),[]);
});

test('filter button permissions preserve legacy behavior and merge projected groups',()=>{
 const actions=context.exports.filterButtonActions;
 assert.deepEqual(plain(actions()),['query','reset']);
 assert.deepEqual(plain(actions({toolbarGroups:[]})),[]);
 assert.deepEqual(plain(actions({toolbarGroups:[{actions:['reset']},{actions:['query','reset']},{actions:['create']}]})),['reset','query']);
});

test('display sorting follows visible matching groups and removes disabled default sorting',()=>{
 const sorted={...view,table:{...view.table,defaultSort:{fieldName:'name',order:'ascend'}}};
 const resolved=resolveListView(sorted,{displayGroups:[{columns:['name','qty'],sortableColumns:['qty']}]});
 assert.deepEqual(plain(resolved.table.columns.map(column=>[column.fieldName,column.sortable])),[['name',false],['qty',true]]);
 assert.equal(resolved.table.defaultSort,undefined);
 assert.deepEqual(plain(resolveListView(view,{displayGroups:[{columns:['name'],sortableColumns:['qty']}]}).table.columns.map(column=>column.sortable)),[false]);
 const merged=resolveListView(view,{displayGroups:[{columns:['name'],sortableColumns:[]},{columns:['name','qty'],sortableColumns:['qty']}]});
 assert.deepEqual(plain(merged.table.columns.map(column=>[column.fieldName,column.sortable])),[['name',false],['qty',true]]);
});

test('each display audience uses its own default sort and ordered matching groups choose the first valid one',()=>{
 const first={columns:['name'],sortableColumns:['name'],defaultSort:{field:'name',order:'asc'},inheritDefaultSort:false};
 const second={columns:['qty'],sortableColumns:['qty'],defaultSort:{field:'qty',order:'desc'},inheritDefaultSort:false};
 assert.deepEqual(plain(resolveListView(view,{displayGroups:[first]}).table.defaultSort),{fieldName:'name',order:'ascend'});
 assert.deepEqual(plain(resolveListView(view,{displayGroups:[second]}).table.defaultSort),{fieldName:'qty',order:'descend'});
 assert.deepEqual(plain(resolveListView(view,{displayGroups:[first,second]}).table.defaultSort),{fieldName:'name',order:'ascend'});
 assert.deepEqual(plain(resolveListView(view,{displayGroups:[{...first,sortableColumns:[]},second]}).table.defaultSort),{fieldName:'qty',order:'descend'});
 const source={...view,table:{...view.table,defaultSort:{fieldName:'name',order:'ascend'}}};
 assert.equal(resolveListView(source,{displayGroups:[{columns:['name'],sortableColumns:['name'],defaultSort:null,inheritDefaultSort:false}]}).table.defaultSort,undefined);
 assert.deepEqual(plain(resolveListView(source,{displayGroups:[{columns:['name']}]}).table.defaultSort),{fieldName:'name',order:'ascend'});
});

test('display groups independently resolve page size and empty prompts with ordered fallback',()=>{
 const a={columns:['name'],pageSize:5,emptyText:'暂无我的申请'};
 const b={columns:['qty'],pageSize:50,emptyText:'暂无待办'};
 const resolve=context.exports.resolveListPresentation;
 assert.equal(resolveListView(view,{displayGroups:[a]}).table.pageSize,5);
 assert.equal(resolveListView(view,{displayGroups:[b]}).table.pageSize,50);
 assert.deepEqual(plain(resolve({displayGroups:[a,b]})),{pageSize:5,emptyText:'暂无我的申请'});
 assert.deepEqual(plain(resolve({displayGroups:[{pageSize:null,emptyText:' '},b],pageSize:20,emptyText:'旧提示'})),{pageSize:50,emptyText:'暂无待办'});
 assert.deepEqual(plain(resolve({displayGroups:[{}],pageSize:10,emptyText:'旧提示'})),{pageSize:10,emptyText:'旧提示'});
});

test('audience imports only merge subjects without changing fields or buttons',()=>{
 const group={id:'current',name:'A',roleIds:[1],userIds:[2],orgUnitIds:[],actions:['query'],columns:['title']};
 const before=plain(group);
 const patch=context.exports.mergePermissionAudience(group,[{id:'other',roleIds:[1,3],userIds:[4],orgUnitIds:[5],actions:['reset'],columns:['qty']}]);
 assert.deepEqual(plain(patch),{roleIds:[1,3],userIds:[2,4],orgUnitIds:[5]});
 assert.deepEqual(plain({...group,...patch}).actions,['query']);
 assert.deepEqual(plain({...group,...patch}).columns,['title']);
 assert.deepEqual(plain(group),before);
});
