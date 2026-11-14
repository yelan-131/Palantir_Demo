const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const path=require('node:path');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(file,resolve=require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:resolve});return exports;}
const model=load('../src/pages/ComponentPages/model.ts');
const Notice=load('../src/pages/ComponentPages/SourceImpactNotice.tsx',name=>name==='./model'?model:require(name)).default;
const page={sourceFormId:5,widgets:[{id:'a',type:'record-list',title:'默认来源列表'},{id:'b',type:'metric',title:'同源指标',dataBinding:{formId:5}},{id:'c',type:'record-list',title:'其他来源列表',dataBinding:{formId:6}},{id:'d',type:'workspace',title:'账号工作台'}]};
test('impact lists inherited and explicit source consumers without including unrelated components',()=>{
 const original=JSON.stringify(page);const html=renderToStaticMarkup(React.createElement(Notice,{definition:page,sourceId:5,sourceName:'生产 <明细>',mode:'form'}));
 assert.ok(html.includes('生产 &lt;明细&gt;'));assert.ok(html.includes('默认来源列表'));assert.ok(html.includes('同源指标'));assert.ok(html.includes('2 个'));assert.ok(!html.includes('其他来源列表'));assert.ok(!html.includes('账号工作台'));assert.ok(html.includes('来源字段与录入配置'));assert.ok(html.includes('其他页面的引用未统计'));assert.equal(JSON.stringify(page),original);
});
test('workflow editing explains shared flow scope and empty local references remain truthful',()=>{
 const html=renderToStaticMarkup(React.createElement(Notice,{definition:page,sourceId:9,sourceName:'审批来源',mode:'flow'}));assert.ok(html.includes('来源审批流程'));assert.ok(html.includes('0 个'));assert.ok(!html.includes('默认来源列表'));assert.ok(html.includes('分别保存和发布'));
});
