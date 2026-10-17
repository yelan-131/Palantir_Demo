const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/pages/SystemAdmin/assemblyPersistence.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {persistForm,persistApplication,propertyError}=context.exports;
const response=data=>({data:{data}});
test('property saves merge latest designer config and preserve field labels and lifecycle',async()=>{
 let sent;
 const latest={id:7,status:'published',fields:[{field_name:'part_no',label:'物料编号'}],config:{viewConfigDraft:{columns:['part_no']},custom:'new designer value'}};
 const saved=await persistForm({getPlatformForm:async()=>response(latest),updatePlatformForm:async(id,payload)=>{sent=payload;return response({id,...payload});}}, {id:'7',status:'draft',config:{custom:'stale'}},{name:'更名',category:'interaction',status:'disabled'});
 assert.equal(sent.config.custom,'new designer value');
 assert.equal(sent.config.viewConfigDraft,latest.config.viewConfigDraft);
 assert.equal(saved.fields[0].label,'物料编号');
 assert.equal(sent.status,'published');
 assert.equal(sent.fields,undefined);
});
test('new form stays draft until the explicit publish operation',async()=>{
 let payload;
 const saved=await persistForm({createPlatformForm:async data=>{payload=data;return response({id:8,...data});}},{id:'draft-1',status:'draft'},{name:'看板',code:'test-board',category:'analytics',status:'published'});
 assert.equal(payload.status,'draft'); assert.equal(payload.config.assemblyKind,'analysis');assert.equal(saved.id,8);
});
test('failed save rejects instead of reporting a local success',async()=>{
 const error=new Error('database unavailable');
 await assert.rejects(persistApplication({adminCreateApplication:async()=>{throw error;}},{id:-1,name:'test',code:'test',status:'draft',default_route:'/'},{name:'test'}),/database unavailable/);
 await assert.rejects(persistForm({createPlatformForm:async()=>response({})},{id:'draft-1',status:'draft'},{}),/有效编号/);
});
test('application create returns permanent id and subsequent publish updates that record',async()=>{
 let updates=0;
 const api={adminCreateApplication:async data=>response({id:10,...data}),adminUpdateApplication:async(id,data)=>{updates++;assert.equal(id,10);return response({id,...data});}};
 const saved=await persistApplication(api,{id:-1,status:'draft',default_route:'/'},{name:'应用',code:'app'});
 const published=await persistApplication(api,saved,{name:'应用',code:'app'},'published');
 assert.equal(updates,1);assert.equal(published.status,'published');
});
test('publish blocking messages are shown from backend',()=>assert.equal(propertyError({response:{data:{detail:{message:'Publish blocked'}}}},'fallback'),'Publish blocked'));
