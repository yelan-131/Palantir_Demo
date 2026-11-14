const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const context={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/pages/ComponentPages/presentation.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
const {resolvePresentation}=context.exports;
test('old serialized appearance retains title visibility, radius, border and density',()=>{
 const r=resolvePresentation({style:{cardRadius:8,cardBorder:'strong',tableDensity:'compact'}},{appearance:{showTitle:false,showSubtitle:false,radius:0,headingStyle:'bar'}});
 assert.equal(r.container.radius,0);assert.equal(r.container.border,'strong');assert.equal(r.header.titleVisible,false);assert.equal(r.header.descriptionVisible,false);assert.equal(r.header.actionsVisible,true);assert.equal(r.content.density,'compact');
});
test('page defaults, partial component overrides, zero and false follow a single precedence',()=>{
 const page={style:{componentDefaults:{container:{padding:24,radius:10},header:{divider:true},content:{gap:18}}}};
 const own={presentation:{container:{padding:0},header:{visible:false},content:{gap:0,separators:false}}};
 const r=resolvePresentation(page,own);assert.equal(r.container.padding,0);assert.equal(r.container.radius,10);assert.equal(r.header.visible,false);assert.equal(r.header.divider,true);assert.equal(r.content.gap,0);assert.equal(r.content.separators,false);
 const reset=resolvePresentation(page,{presentation:{container:null,header:null,content:null}});assert.equal(reset.container.padding,24);assert.equal(reset.header.visible,true);assert.equal(reset.content.gap,18);
});
test('server null defaults never erase legacy settings; automatic background can clear inherited color',()=>{
 const r=resolvePresentation({style:{componentDefaults:{container:{background:'#ffffff',padding:null},header:{visible:null}}}},{appearance:{radius:6},presentation:{container:{background:null}}});
 assert.equal(r.container.background,null);assert.equal(r.container.padding,16);assert.equal(r.container.radius,6);assert.equal(r.header.visible,true);
});
test('workspace content uses the shared plain inner surface without workspace CSS overrides',()=>{
 const r=resolvePresentation({}, {type:'workspace',appearance:{showTitle:false}});assert.equal(r.container.surface,'plain');assert.equal(r.content.innerSurface,'plain');assert.equal(r.header.titleVisible,false);
});
