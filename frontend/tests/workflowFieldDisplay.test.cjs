const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
function compile(file, requireFn) {
 const context={exports:{},require:requireFn};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,context);
 return context.exports;
}
const options=compile('../src/utils/formControls.ts');
const {displayWorkflowValue:show}=compile('../src/pages/Workflow/fieldDisplay.ts',()=>options);
test('workflow cards and details display stored enum and multiselect labels',()=>{
 const field={enum_values:{values:[{value:'production',label:'生产数据'},{value:'quality',label:'质量数据'},{value:0,label:'零'}]}};
 assert.equal(show(field,'production'),'生产数据');
 assert.equal(show(field,['production','quality']),'生产数据、质量数据');
 assert.equal(show(field,0),'零');
 assert.equal(show(field,'legacy'),'legacy');
});
test('relation labels come from authorized selected options and retain unresolved or masked values',()=>{
 const field={value_labels:{'33':'申请人A','11':'部门甲'}};
 assert.equal(show(field,33),'申请人A');
 assert.equal(show(field,['11','33']),'部门甲、申请人A');
 assert.equal(show(field,99),'99');
 assert.equal(show(field,'***'),'***');
});
test('boolean captions, empty values, numeric zero and dates remain meaningful',()=>{
 const field={ui_config:{typeSettings:{checkedText:'涉及',uncheckedText:'不涉及'}}};
 assert.equal(show(field,false),'不涉及');
 assert.equal(show(field,true),'涉及');
 assert.equal(show({},false),'否');
 assert.equal(show({},null),'-');
 assert.equal(show({},0),'0');
 assert.equal(show({},'2026-10-30'),'2026-10-30');
});
