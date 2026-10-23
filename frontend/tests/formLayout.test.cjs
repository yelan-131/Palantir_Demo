const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const ctx={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/utils/formLayout.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const {normalizeLayout,placeLayoutControl,unwrapLayoutControl,cloneLayoutSubtree,buildRuntimeLayout,layoutSlots,getControlPresentation,getControlColumnSpan}=ctx.exports;
const rules={visible:{enabled:true},readonly:{enabled:false}};
const group={id:'g',controlType:'container',name:'基础信息',width:'full',rules};
const field={id:'f',controlType:'field',fieldKey:'name',name:'姓名',width:'half',rules};
const asJSON=x=>JSON.parse(JSON.stringify(x));
const payload=(c,readonly)=>({fieldName:c.fieldKey,readonly,required:false});
test('legacy fields stay at root and malformed/cyclic references cannot hide fields',()=>{
 assert.equal(normalizeLayout([field])[0].parentId,undefined);
 const clean=normalizeLayout([{...group,parentId:'h'},{...group,id:'h',parentId:'g'},{...field,parentId:'missing'}]);
 assert.equal(clean.find(x=>x.id==='f').parentId,undefined);
 assert.equal(buildRuntimeLayout(clean,payload).sections[0].fields.length,1);
});
test('move into slots, move out, reorder and prevent moving ancestor into descendants',()=>{
 let controls=placeLayoutControl([group,field], 'f','g');assert.equal(controls[1].parentId,'g');assert.equal(controls[1].slotId,'body');
 assert.equal(placeLayoutControl(controls,'g','f'),controls);
 controls=placeLayoutControl(controls,'f');assert.equal(controls.find(c=>c.id==='f').parentId,undefined);
 controls=placeLayoutControl([...controls,{...group,id:'h',parentId:'g',slotId:'body'}],'g','h');assert.equal(controls.find(c=>c.id==='g').parentId,undefined);
});
test('columns and tabs preserve slot assignment through JSON save/reload, shrinking rehomes children',()=>{
 const columns={...group,controlType:'two-columns',layout:{columns:3,ratios:[1,2,1]}};
 let controls=placeLayoutControl([columns,field],'f','g','2');controls=normalizeLayout(asJSON(controls));assert.equal(controls[1].slotId,'2');
 controls=normalizeLayout(controls.map(c=>c.id==='g'?{...c,layout:{columns:2}}:c));assert.equal(controls[1].slotId,'0');
 const tabs={...group,controlType:'tabs',layout:{tabs:[{id:'a',label:'基本'},{id:'b',label:'附加'}]}};
 controls=placeLayoutControl([tabs,field],'f','g','b');
 controls=normalizeLayout(controls.map(c=>c.id==='g'?{...c,layout:{tabs:[{id:'a',label:'基本'}]}}:c));assert.equal(controls[1].slotId,'a');
 assert.equal(layoutSlots(tabs)[1].label,'附加');
});
test('copy preserves a nested subtree with new identities; removing a container unwraps every child',()=>{
 const controls=[group,{...group,id:'h',parentId:'g',slotId:'body'}, {...field,parentId:'h',slotId:'body'}];let index=0;
 const copy=cloneLayoutSubtree(controls,'g',()=>`copy-${++index}`);
 assert.equal(copy.length,3);assert.equal(copy[1].parentId,copy[0].id);assert.equal(copy[2].parentId,copy[1].id);assert.notEqual(copy[2].id,'f');
 copy[0].rules.visible.enabled=false;assert.equal(controls[0].rules.visible.enabled,true);
 const unwrapped=unwrapLayoutControl(controls,'g');assert.equal(unwrapped.length,2);assert.equal(unwrapped[0].parentId,undefined);assert.equal(unwrapped[1].parentId,'h');
});
test('runtime tree and compatibility field list preserve group order and ancestor readonly/visibility',()=>{
 const controls=[{...group,rules:{visible:{enabled:true},readonly:{enabled:true}}},{...field,parentId:'g',slotId:'body'}];
 const runtime=buildRuntimeLayout(controls,payload);assert.equal(runtime.version,2);assert.equal(runtime.nodes[0].label,'基础信息');assert.equal(runtime.nodes[0].children[0].fieldName,'name');assert.equal(runtime.sections[0].fields[0].readonly,true);
 const hidden=buildRuntimeLayout([{...group,rules:{visible:{enabled:false}}},controls[1]],payload);assert.equal(hidden.nodes.length,0);assert.equal(hidden.sections[0].fields.length,0);
});

test('presentation defaults and invalid legacy values are normalized without changing inputs',()=>{
 const defaults={startNewRow:false,labelPosition:'top',labelAlign:'left',labelWidth:96,spacingAfter:0};
 for(const value of [undefined,null,'invalid',[],{}])assert.deepEqual(asJSON(getControlPresentation(value)),defaults);
 const invalid={startNewRow:'true',labelPosition:'bottom',labelAlign:'center',labelWidth:NaN,spacingAfter:Infinity};
 assert.deepEqual(asJSON(getControlPresentation(invalid)),defaults);
 assert.deepEqual(asJSON(getControlPresentation({startNewRow:true,labelPosition:'left',labelAlign:'right',labelWidth:1000,spacingAfter:100})),{startNewRow:true,labelPosition:'left',labelAlign:'right',labelWidth:240,spacingAfter:48});
 const small={labelWidth:20,spacingAfter:-5};assert.equal(getControlPresentation(small).labelWidth,64);assert.equal(getControlPresentation(small).spacingAfter,0);assert.equal(small.labelWidth,20);
 assert.equal(normalizeLayout([field])[0].presentation,undefined);
 assert.deepEqual(asJSON(normalizeLayout([{...field,presentation:invalid}])[0].presentation),defaults);
 for(const [width,span] of [['quarter',3],['third',4],['half',6],['threeQuarter',9],['full',12],[undefined,12],['invalid',12]])assert.equal(getControlColumnSpan(width),span);
});

test('presentation survives save/reload, subtree copies and publishing in tree and legacy payloads',()=>{
 const presentation={startNewRow:true,labelPosition:'left',labelAlign:'right',labelWidth:128,spacingAfter:24};
 const controls=[{...group,presentation:{startNewRow:true,spacingAfter:12}},{...field,parentId:'g',slotId:'body',presentation}];
 const reloaded=normalizeLayout(asJSON(controls));
 let next=0;const copied=cloneLayoutSubtree(reloaded,'g',()=>`presentation-${++next}`);
 assert.deepEqual(asJSON(copied[1].presentation),presentation);
 copied[1].presentation.labelWidth=180;assert.equal(reloaded[1].presentation.labelWidth,128);
 const runtime=buildRuntimeLayout(reloaded,payload);const published=asJSON(runtime);
 assert.equal(published.nodes[0].presentation.spacingAfter,12);
 assert.deepEqual(published.nodes[0].children[0].presentation,presentation);
 assert.deepEqual(published.sections[0].fields[0].presentation,presentation);
 runtime.sections[0].fields[0].presentation.labelWidth=200;
 assert.equal(runtime.nodes[0].children[0].presentation.labelWidth,128);
 assert.equal(presentation.labelWidth,128);
});

test('tabs, columns and dividers publish their own placement without overriding child labels',()=>{
 const controls=[{...group,controlType:'tabs',presentation:{spacingAfter:8}},{...field,parentId:'g',slotId:'tab-1',presentation:{labelPosition:'left'}},{id:'columns',controlType:'two-columns',presentation:{startNewRow:true}},{id:'divider',controlType:'divider',presentation:{spacingAfter:16}}];
 const runtime=buildRuntimeLayout(controls,payload);
 assert.equal(runtime.nodes[0].presentation.spacingAfter,8);
 assert.equal(runtime.nodes[0].children[0].presentation.spacingAfter,0);
 assert.equal(runtime.nodes[0].children[0].presentation.labelPosition,'left');
 assert.equal(runtime.nodes[1].presentation.startNewRow,true);
 assert.equal(runtime.nodes[2].presentation.spacingAfter,16);
});

test('runtime renderer keeps width, start-row and label settings without dropping help or validation',()=>{
 const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {Form,Input}=require('antd');
 const rendererContext={exports:{},require:name=>name==='@/utils/formLayout'?ctx.exports:name==='./style.css'?{}:require(name)};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/components/FormLayout/index.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,rendererContext);
 const nodes=buildRuntimeLayout([{...field,presentation:{startNewRow:true,labelPosition:'left',labelAlign:'right',labelWidth:140,spacingAfter:20}}],payload).nodes;
 const html=renderToStaticMarkup(React.createElement(Form,{layout:'vertical'},React.createElement(rendererContext.exports.default,{nodes,renderField:()=>React.createElement(Form.Item,{label:'姓名',help:'请填写姓名',extra:'辅助说明',validateStatus:'error'},React.createElement(Input))})));
 assert.match(html,/runtime-layout-width-half is-start-new-row runtime-layout-field runtime-label-left runtime-label-align-right/);
 assert.match(html,/--layout-span:6/);assert.match(html,/--runtime-label-width:140px/);assert.match(html,/margin-bottom:20px/);
 // Ant's error list mounts after a debounced client effect; SSR retains its help state.
 assert.match(html,/ant-form-item-with-help/);assert.match(html,/辅助说明/);assert.match(html,/ant-form-item-has-error/);
 assert.doesNotMatch(html,/grid-column-start:/);
});

test('appearance overrides are optional, bounded and survive copy and publish with a two-thirds field',()=>{
 const appearance={borderRadius:12,fontSize:16,labelFontSize:15,controlHeight:40};
 const original={...field,width:'twoThird',presentation:appearance};
 const reloaded=normalizeLayout(asJSON([original]));
 const copy=cloneLayoutSubtree(reloaded,'f',()=> 'copied')[0];
 const published=asJSON(buildRuntimeLayout(reloaded,payload));
 assert.equal(getControlColumnSpan('third')+getControlColumnSpan('twoThird'),12);
 assert.equal(published.nodes[0].width,'twoThird');
 for(const [key,value] of Object.entries(appearance)) {
  assert.equal(copy.presentation[key],value);
  assert.equal(published.nodes[0].presentation[key],value);
  assert.equal(published.sections[0].fields[0].presentation[key],value);
 }
 assert.equal(getControlPresentation({borderRadius:99,fontSize:2,labelFontSize:99,controlHeight:100}).borderRadius,24);
 assert.equal(getControlPresentation({fontSize:2}).fontSize,10);
 assert.equal(getControlPresentation({labelFontSize:99}).labelFontSize,24);
 assert.equal(getControlPresentation({controlHeight:100}).controlHeight,64);
 const inherited=ctx.exports.getControlAppearance({fontSize:NaN,borderRadius:null});
 assert.deepEqual(asJSON(inherited.style),{});
 assert.equal(inherited.className,'form-control-presentation');
 const overridden=ctx.exports.getControlAppearance(appearance);
 assert.match(overridden.className,/has-borderRadius/);
 assert.equal(overridden.style['--field-fontSize'],'16px');
 assert.equal(original.presentation.borderRadius,12);
});

test('published field rendering receives all appearance overrides while unconfigured siblings inherit theme',()=>{
 const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {Form,Input}=require('antd');
 const rendererContext={exports:{},require:name=>name==='@/utils/formLayout'?ctx.exports:name==='./style.css'?{}:require(name)};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/components/FormLayout/index.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,rendererContext);
 const nodes=buildRuntimeLayout([{...field,width:'twoThird',presentation:{borderRadius:0,fontSize:18,labelFontSize:16,controlHeight:44}},{...field,id:'other',fieldKey:'other',width:'third'}],payload).nodes;
 const html=renderToStaticMarkup(React.createElement(Form,null,React.createElement(rendererContext.exports.default,{nodes,renderField:node=>React.createElement(Form.Item,{label:node.label},React.createElement(Input))})));
 assert.match(html,/runtime-layout-width-twoThird/);
 for(const css of ['--layout-span:8','--field-borderRadius:0px','--field-fontSize:18px','--field-labelFontSize:16px','--field-controlHeight:44px'])assert.ok(html.includes(css),css);
 assert.equal((html.match(/has-borderRadius/g)||[]).length,1);
});

test('explicit input width is bounded, published and removable without changing layout occupancy',()=>{
 const appearance=ctx.exports.getControlAppearance({controlWidth:240});
 assert.equal(appearance.style['--field-controlWidth'],'240px');
 assert.equal(getControlPresentation({controlWidth:5000}).controlWidth,1600);
 assert.equal(getControlPresentation({controlWidth:1}).controlWidth,80);
 const saved=asJSON(buildRuntimeLayout([{...field,width:'twoThird',presentation:{controlWidth:240,controlHeight:40,labelPosition:'left'}}],payload));
 assert.equal(saved.nodes[0].presentation.controlWidth,240);assert.equal(saved.nodes[0].width,'twoThird');
 assert.equal(ctx.exports.getControlAppearance({controlWidth:undefined}).style['--field-controlWidth'],undefined);
});
