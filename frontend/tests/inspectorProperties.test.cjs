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
 assert.deepEqual(keys('record-list',true,true),['basic','data','form','flow']);
 assert.deepEqual(keys('record-list',false),['basic','data']);
 assert.deepEqual(keys('workspace',true),['basic']);
});
test('context-menu source editing retains source tabs so users can switch and exit',()=>{
 assert.deepEqual(keys('metric',true,true),['basic','data','form','flow']);
 assert.deepEqual(keys(undefined,false,true),['form','flow']);
});
const presentation=load('../src/pages/ComponentPages/presentation.ts');
const icons=load('../src/components/Icon/ant.tsx');
const inspector=load('../src/components/PropertyInspector/index.tsx',name=>name.endsWith('.css')?{}:name==='@/components/Icon/ant'?icons:require(name));
const Settings=load('../src/pages/ComponentPages/PresentationSettings.tsx',name=>name==='@/components/PropertyInspector'?inspector:name==='./presentation'?presentation:require(name)).default;
const marker=name=>React.createElement('span',{'data-test-property':name},name);
function render(header={}, recordList=false){return renderToStaticMarkup(React.createElement(Settings,{recordList,resolved:presentation.resolvePresentation({},{presentation:{header}}),onChange:()=>{},layout:marker('layout'),titleSettings:marker('title-options'),descriptionSettings:marker('description-options'),actionSettings:marker('button-options')}));}
test('header text and button settings live beside their visibility controls',()=>{
 const html=render();for(const name of ['layout','title-options','description-options','button-options'])assert.ok(html.includes(`data-test-property="${name}"`));
 assert.ok(html.includes('布局与容器'));assert.ok(html.includes('容器跟随页面'));
 const hiddenTitle=render({titleVisible:false});assert.ok(!hiddenTitle.includes('data-test-property="title-options"'));assert.ok(hiddenTitle.includes('data-test-property="button-options"'));
 const hiddenActions=render({actionsVisible:false});assert.ok(!hiddenActions.includes('data-test-property="button-options"'));
 const hiddenHeader=render({visible:false});for(const name of ['title-options','description-options','button-options'])assert.ok(!hiddenHeader.includes(`data-test-property="${name}"`));
});

test('business lists omit the internal title option while retaining content presentation controls', () => {
 assert.ok(render().includes('内容内标题'));
 const html = render({}, true);
 assert.ok(!html.includes('内容内标题'));
 for (const name of ['内容密度', '内容间距', '内部展示', '内容分隔线', '内容溢出']) assert.ok(html.includes(name));
});

test('the header follow switch copies current defaults on disable and clears only the header on enable', () => {
 const page = {style: {componentDefaults: {header: {padding: 24, actionsVisible: false}}}};
 const container = {radius: 8};
 const updates = [];
 const headerSwitch = value => {
  const tree = Settings({value, resolved: presentation.resolvePresentation(page, {presentation: value}), onChange: next => updates.push(next)});
  const header = tree.props.children.find(group => group?.props.title === '标题与操作区');
  return header.props.children.find(row => row?.props.label === '跟随页面').props.children.props;
 };
 const following = headerSwitch({container});
 assert.equal(following.checked, true);
 following.onChange(false);
 assert.equal(updates[0].header.padding, 24);
 assert.equal(updates[0].header.actionsVisible, false);
 assert.equal(updates[0].container, container);
 const independent = headerSwitch(updates[0]);
 assert.equal(independent.checked, false);
 independent.onChange(true);
 assert.equal(updates[1].header, null);
 assert.equal(updates[1].container, container);
});
