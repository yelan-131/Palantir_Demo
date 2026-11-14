const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(relative,resolve=require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:resolve});return exports;}
const {inspectorTabs}=load('../src/pages/ComponentPages/inspectorCapabilities.ts');
const keys=(type,business,open)=>Array.from(inspectorTabs(type,business,open),tab=>tab.key);
test('component tabs expose editing capabilities rather than irrelevant disabled entries',()=>{
 for(const type of ['metric','chart','record-filter'])assert.deepEqual(keys(type,true),['basic','data']);
 assert.deepEqual(keys('record-list',true),['basic','data','form','flow']);
 assert.deepEqual(keys('record-list',false),['basic','data']);
 assert.deepEqual(keys('workspace',true),['basic']);
});
test('context-menu source editing retains source tabs so users can switch and exit',()=>{
 assert.deepEqual(keys('metric',true,true),['basic','data','form','flow']);
});
const presentation=load('../src/pages/ComponentPages/presentation.ts');
const inspector=load('../src/components/PropertyInspector/index.tsx',name=>name.endsWith('.css')?{}:require(name));
const Settings=load('../src/pages/ComponentPages/PresentationSettings.tsx',name=>name==='@/components/PropertyInspector'?inspector:name==='./presentation'?presentation:require(name)).default;
const marker=name=>React.createElement('span',{'data-test-property':name},name);
function render(header={}){return renderToStaticMarkup(React.createElement(Settings,{resolved:presentation.resolvePresentation({},{presentation:{header}}),onChange:()=>{},layout:marker('layout'),titleSettings:marker('title-options'),descriptionSettings:marker('description-options'),actionSettings:marker('button-options')}));}
test('header text and button settings live beside their visibility controls',()=>{
 const html=render();for(const name of ['layout','title-options','description-options','button-options'])assert.ok(html.includes(`data-test-property="${name}"`));
 assert.ok(html.includes('布局与容器'));assert.ok(html.includes('容器继承'));
 const hiddenTitle=render({titleVisible:false});assert.ok(!hiddenTitle.includes('data-test-property="title-options"'));assert.ok(hiddenTitle.includes('data-test-property="button-options"'));
 const hiddenActions=render({actionsVisible:false});assert.ok(!hiddenActions.includes('data-test-property="button-options"'));
 const hiddenHeader=render({visible:false});for(const name of ['title-options','description-options','button-options'])assert.ok(!hiddenHeader.includes(`data-test-property="${name}"`));
});
