const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const path=require('node:path');
function load(file,require){const context={exports:{},require};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,context);return context.exports;}
const view=load('../src/utils/viewConfig.ts');
const business=load('../src/pages/ComponentPages/businessComponents.ts');
const dayjs=require('dayjs');
const {sourceFilterConfig,recordMetadataFilterConfig,filterValueToPayload}=load('../src/pages/ComponentPages/filterControls.ts',name=>({
 'dayjs':dayjs,'./businessComponents':business,'@/utils/viewConfig':view,
})[name]);
const plain=value=>JSON.parse(JSON.stringify(value));
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

test('choice presentation preserves compatible defaults and queries multivalue fields by membership',()=>{
 const field={field_name:'priority',label:'紧急程度',field_type:'enum',controlType:'select'};
 const multi=sourceFilterConfig(field,0,{defaultValue:'normal'},'checkbox');
 assert.equal(multi.operator,'in');
 assert.deepEqual(Array.from(multi.defaultValue),['normal']);
 const single=sourceFilterConfig({...field,typeSettings:{selectionMode:'multiple'}},0,{defaultValue:['urgent']},'radio');
 assert.equal(single.operator,'in');
 assert.equal(single.defaultValue,'urgent');
 assert.equal(sourceFilterConfig(field,0,undefined,'dropdown').operator,'equals');
});

test('record metadata conditions use the service operators and personnel IDs',()=>{
 for (const [field,controlType,value] of [
   ['_record_id','number',42],['_created_by','select',6],['_updated_by','select',7],
 ]) {
   const filter=recordMetadataFilterConfig(field,3);
   assert.equal(filter.controlType,controlType);
   assert.equal(filter.sortOrder,3);
   assert.deepEqual(plain(filterValueToPayload(filter,value)),{field,op:'equals',value});
   assert.equal(filterValueToPayload(filter,undefined),null);
 }
 assert.equal(recordMetadataFilterConfig('code',0),undefined);
});

test('record timestamp filters include the selected local day and preserve business date payloads',()=>{
 const previousTZ=process.env.TZ;
 process.env.TZ='Asia/Shanghai';
 try {
   const sameDay=[dayjs('2026-11-25'),dayjs('2026-11-25')];
   for (const field of ['_created_at','_updated_at']) {
     const filter=recordMetadataFilterConfig(field,0);
     assert.deepEqual(plain(filterValueToPayload(filter,sameDay)),{
       field,op:'between',value:['2026-11-24T16:00:00.000Z','2026-11-25T16:00:00.000Z'],endExclusive:true,
     });
     assert.equal(filterValueToPayload(filter,null),null);
   }
   const filter=sourceFilterConfig({field_name:'received_at',label:'收货日期',field_type:'date',typeSettings:{dateMode:'range'}},0);
   assert.deepEqual(plain(filterValueToPayload(filter,sameDay)),{
     field:'received_at',op:'between',value:['2026-11-25','2026-11-25'],
   });
 } finally {
   if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;
 }
});
