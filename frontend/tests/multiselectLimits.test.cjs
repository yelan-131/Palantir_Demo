const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,mocks={}) {
 const context={exports:{},require:name=>{if(Object.hasOwn(mocks,name))return mocks[name];if(['./formControls','@/utils/formControls'].includes(name))return load('../src/utils/formControls.ts');return require(name);}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,context);return context.exports;
}
const {selectionCountError,selectionConfigErrors}=load('../src/utils/selectOptions.ts');
test('empty and incomplete input fail minimum; maximum inclusive; single ignores stale limits',()=>{
 for(const value of [undefined,null,[],['a']])assert.equal(selectionCountError(value,{selectionMode:'multiple',minSelections:2}),'至少选择 2 项');
 assert.equal(selectionCountError(['a','b'],{selectionMode:'multiple',minSelections:2,maxSelections:2}),undefined);
 assert.equal(selectionCountError(['a','b','c'],{displayMode:'tags',maxSelections:2}),'最多选择 2 项');
 assert.equal(selectionCountError('a',{selectionMode:'single',minSelections:2}),undefined);
});
test('configuration rejects impossible counts and validates tag settings',()=>{
 for(const settings of [{minSelections:3,maxSelections:2},{minSelections:4},{maxSelections:0},{minSelections:-1},{maxVisibleTags:0},{minSelections:1.5}])assert.ok(selectionConfigErrors({selectionMode:'multiple',...settings},3).length);
 assert.equal(selectionConfigErrors({selectionMode:'multiple',minSelections:4,allowCreateOption:true},3).length,0);
});
function render(settings,value=['a','b']){
 let select,checkbox,next;const warnings=[],stub=()=>null;
 const Widget=load('../src/components/FormWidgets/FieldControl.tsx',{
 '@/utils/uuid':{createUuid:()=> 'test'},'@/components/FieldProtection':{default:({children})=>children,__esModule:true},'@/services/api':{},'@ant-design/icons':{},
 antd:{Button:stub,Checkbox:{Group:props=>{checkbox=props;return null;}},DatePicker:stub,Input:stub,InputNumber:stub,Radio:{Group:stub},Select:props=>{select=props;return null;},Space:stub,Switch:stub,Table:stub,Tooltip:({children})=>children,Upload:stub,message:{warning:text=>warnings.push(text)}}
 }).default;
 renderToStaticMarkup(React.createElement(Widget,{type:'select',settings:{selectionMode:'multiple',...settings},value,options:['a','b','c'],onChange:value=>{next=value;}}));return {select,checkbox,warnings,get next(){return next;}};
}
test('widget limits dropdown, tags and checkbox additions and permits removal',()=>{
 for(const displayMode of ['dropdown','radio','tags']){
 const result=render({maxSelections:2,displayMode,allowCreateOption:displayMode==='tags'}),widget=result.select||result.checkbox;
 assert.equal(widget.options.find(option=>option.value==='c').disabled,true);assert.equal(widget.options.find(option=>option.value==='a').disabled,false);
 widget.onChange(['a','b','c']);assert.equal(result.next,undefined);assert.equal(result.warnings.length,1);
 widget.onChange(['a']);assert.deepEqual(result.next,['a']);
 }
});
test('folding changes only display and retains omitted names',()=>{
 const fixed=render({tagCollapse:'fixed',maxVisibleTags:1,maxSelections:3});assert.equal(fixed.select.maxTagCount,1);
 assert.equal(fixed.select.maxTagPlaceholder([{label:'B'},{label:'C'}]).props.title,'B、C');
 fixed.select.onChange(['a','b','c']);assert.deepEqual(fixed.next,['a','b','c']);
 assert.equal(render({tagCollapse:'responsive'}).select.maxTagCount,'responsive');assert.equal(render({tagCollapse:'none'}).select.maxTagCount,undefined);assert.equal(render({tagCollapse:'fixed'}).select.maxTagCount,3);
});
