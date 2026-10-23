const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
function load(file){const context={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/pages/AppPrograms',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);return context.exports;}
const {widgetAppearance}=load('analyticsWidgetAppearance.ts');
const {analyticsDataSignature}=load('analyticsExploration.ts');
test('existing snapshots inherit page presentation and preserve pie and line defaults',()=>{
 const line=widgetAppearance({type:'line'},{chartPalette:'business',cardRadius:12});
 assert.equal(line.palette,'business');assert.equal(line.radius,12);assert.equal(line.height,280);assert.equal(line.showLabels,false);assert.equal(line.smooth,false);
 assert.equal(widgetAppearance({type:'pie'}).showLabels,true);
});
test('widget overrides remain local, and presentation edits do not invalidate business results',()=>{
 const board={style:{chartPalette:'business'},metrics:[{id:'qty',expression:'sum(actual) / 1000',sharedMetricId:'shared',sharedMetricVersion:2}],widgets:[{id:'one',type:'line'},{id:'two',type:'line'}]};
 const before=analyticsDataSignature(board);
 board.widgets[0].appearance={palette:'warning',showLegend:false,showLabels:true,smooth:true,height:360,radius:16,subtitle:'千件'};
 assert.equal(widgetAppearance(board.widgets[0],board.style).palette,'warning');
 assert.equal(widgetAppearance(board.widgets[1],board.style).palette,'business');
 assert.equal(analyticsDataSignature(board),before);
 assert.equal(board.metrics[0].sharedMetricVersion,2);
});
test('invalid optional legacy appearance values fall back without crashing or breaking layout',()=>{
 const result=widgetAppearance({type:'bar',appearance:{palette:'__proto__',height:Infinity,radius:-9,subtitle:{bad:true},showLegend:'false'}},{chartPalette:'missing'});
 assert.equal(result.palette,'manufacturing');assert.equal(result.height,280);assert.equal(result.radius,0);assert.equal(result.subtitle,'');assert.equal(result.showLegend,true);
 assert.equal(widgetAppearance({type:'line',appearance:{height:9999,radius:100}}).height,640);
});
