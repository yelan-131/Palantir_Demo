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
test('separate components narrow fields and actions without granting capabilities',()=>{
 const a=resolveListView(view,{columns:['qty','secret','name'],toolbarActions:['create','refresh'],rowActions:['edit','detail'],rowClick:'edit',pageSize:5});
 assert.deepEqual(plain(a.table.columns.map(column=>column.fieldName)),['qty','name']);
 assert.deepEqual(plain(a.table.toolbarActions),['refresh']);
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
