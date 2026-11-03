const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const path=require('node:path');
function load(file,require){const context={exports:{},require};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;}
const view=load('../src/utils/viewConfig.ts');
const {sourceFilterConfig}=load('../src/pages/ComponentPages/filterControls.ts',()=>view);
test('source controls override text storage and legacy text filter presets',()=>{
 const field={field_name:'request_type',label:'申请类型',field_type:'string',controlType:'select'};
 assert.equal(sourceFilterConfig(field,0,{id:'old',controlType:'text',operator:'contains'}).controlType,'select');
 assert.equal(sourceFilterConfig(field,0).operator,'equals');
 assert.equal(sourceFilterConfig({...field,typeSettings:{selectionMode:'multiple'}},0).operator,'in');
});
test('date and personnel fields retain their source control semantics',()=>{
 assert.equal(sourceFilterConfig({field_name:'person',label:'联系人',field_type:'integer',relation_config:'{}'},0).controlType,'relation');
 assert.equal(sourceFilterConfig({field_name:'date',label:'日期',field_type:'string',controlType:'datetime',typeSettings:{dateMode:'date'}},0).controlType,'date');
 assert.equal(sourceFilterConfig({field_name:'date',label:'日期',field_type:'string',controlType:'datetime',typeSettings:{dateMode:'range'}},0).operator,'between');
 assert.equal(sourceFilterConfig({field_name:'flag',label:'是否',field_type:'boolean',controlType:'switch'},0).controlType,'select');
});
