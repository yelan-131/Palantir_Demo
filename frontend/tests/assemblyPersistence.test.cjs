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

test('persisted form codes cannot be silently ignored by metadata updates',async()=>{
 let updated=false;
 await assert.rejects(persistForm({getPlatformForm:async()=>response({id:7,code:'original',status:'draft',config:{},fields:[]}),updatePlatformForm:async()=>{updated=true;}},{id:'7',status:'draft'},{name:'Renamed',code:'changed'}),/表单编码不能修改/);
 assert.equal(updated,false);
});

test('new field metadata preserves labels and options while leaving design controls to the designer',()=>{
 const {assemblyFieldPayload}=context.exports;
 const payload=assemblyFieldPayload({label:' 审核结果 ',code:' review_result ',type:'enum',required:true,list:false,options:'待处理\n已完成\n待处理\n'},3);
 assert.equal(payload.label,'审核结果');assert.equal(payload.field_name,'review_result');
 assert.equal(payload.required,undefined);assert.equal(payload.visible_in_list,undefined);assert.equal(payload.sort_order,3);
 assert.deepEqual(JSON.parse(JSON.stringify(payload.enum_values)),{values:['待处理','已完成']});
 assert.throws(()=>assemblyFieldPayload({label:'empty',code:'empty',type:'enum',options:'\n'},0),/至少填写/);
 assert.equal(assemblyFieldPayload({label:'申请人',code:'applicant',type:'person',required:false,list:true},4).field_type,'string');
 assert.equal(assemblyFieldPayload({label:'附件',code:'files',type:'attachment',required:false,list:true},5).field_type,'json');
});
test('creator metadata is not editable through property payloads',async()=>{
 let sent;
 await persistForm({getPlatformForm:async()=>response({id:7,code:'same',owner_id:1,status:'draft',config:{ownerLabel:'legacy owner'},fields:[]}),updatePlatformForm:async(id,payload)=>{sent=payload;return response({id,...payload});}},{id:'7',status:'draft'},{name:'保存',code:'same',creator:'伪造创建人',owner_id:999,owner:'change'});
 assert.equal(sent.owner_id,undefined);assert.equal(sent.creator,undefined);assert.equal(sent.config.ownerLabel,'legacy owner');
});

test('field edits patch exposed properties without replacing designer settings or identifiers',()=>{
 const {assemblyFieldUpdatePayload}=context.exports;
 const current={id:9,field_name:'result',field_type:'enum',enum_values:{values:['旧选项'],source:'manual',custom:true},ui_config:{placeholder:'保留'},validation:{maxLength:20},sort_order:7};
 const patch=assemblyFieldUpdatePayload({label:' 新名称 ',required:true,list:false,options:'新选项\n完成\n新选项'},current);
 assert.equal(patch.label,'新名称');assert.equal(patch.required,undefined);assert.equal(patch.visible_in_list,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(patch.enum_values)),{values:['新选项','完成'],source:'manual',custom:true});
 for(const key of ['field_name','field_type','business_type','ui_config','sort_order','visible_in_form','default_value']) assert.equal(patch[key],undefined);
 assert.equal(assemblyFieldUpdatePayload({label:'名称',required:false,list:true},current).enum_values,undefined);
 assert.throws(()=>assemblyFieldUpdatePayload({label:'名称',required:false,list:true,options:'\n'},current),/至少填写/);
 assert.throws(()=>assemblyFieldUpdatePayload({label:'名称',required:false,list:true},{...current,archived:true}),/已删除/);
});

test('byte size is explicit, persisted and distinct from character limits',()=>{
 const {assemblyFieldPayload,assemblyFieldUpdatePayload,fieldStorageSize}=context.exports;
 const current={field_type:'string',validation:{maxLength:20,maxBytes:64,unique:true},required:true,visible_in_list:false};
 const patch=assemblyFieldUpdatePayload({label:'字段',maxBytes:128,required:false,list:true},current);
 assert.deepEqual(JSON.parse(JSON.stringify(patch.validation)),{maxLength:20,maxBytes:128,unique:true});
 assert.equal(patch.required,undefined);assert.equal(patch.visible_in_list,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(assemblyFieldUpdatePayload({label:'字段',maxBytes:null},current).validation)),{maxLength:20,unique:true});
 assert.equal(assemblyFieldPayload({label:'字段',code:'name',type:'string',maxBytes:255},0).validation.maxBytes,255);
 assert.throws(()=>assemblyFieldPayload({label:'字段',code:'name',type:'string',maxBytes:1.5},0),/字节上限/);
 assert.equal(fieldStorageSize('integer'),'4 字节');assert.equal(fieldStorageSize('decimal'),'8 字节');
 assert.equal(fieldStorageSize('string',255),'最多 255 字节');assert.match(fieldStorageSize('text'),/变长/);
});
