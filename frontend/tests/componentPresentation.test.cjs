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

test('business frames apply container settings and use theme colors when following the page', () => {
 const frameSource = fs.readFileSync(path.join(__dirname, '../src/pages/ComponentPages/WidgetFrame.tsx'), 'utf8');
 const frameExports = {};
 vm.runInNewContext(ts.transpileModule(frameSource, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText, {
  exports: frameExports,
  require(name) {
   if (name === 'react') return {useLayoutEffect() {}, useRef: () => ({current: null}), useState: initial => [initial]};
   if (name === '@/theme/ThemeCardProvider') return {CanonThemeScope: 'theme'};
   return name.endsWith('.css') ? {} : require(name);
  },
 });
 const page = {style: {componentDefaults: {container: {surface: 'soft', padding: 24, border: 'light', shadow: 'soft'}}}};
 const frame = (container, header, content) => {
  const presentation = resolvePresentation(page, {type: 'record-list', presentation: {container, header, content}});
  return frameExports.default({presentation, heading: '产成品', canon: true}).props.children.props;
 };
 const own = frame({surface: 'card', background: '#123456', border: 'strong', shadow: 'none', radius: 4, padding: 0});
 assert.equal(own['data-surface'], 'card');
 assert.equal(own.style['--widget-background'], '#123456');
 assert.equal(own.style['--widget-border'], 'var(--canon-border-strong)');
 assert.equal(own.style['--widget-shadow'], 'none');
 assert.equal(own.style['--widget-radius'], '4px');
 assert.equal(own.style['--widget-padding'], '0px');
 const follow = frame(null);
 assert.equal(follow['data-surface'], 'soft');
 assert.equal(follow.style['--widget-background'], 'var(--canon-canvas)');
 assert.equal(follow.style['--widget-border'], 'var(--canon-border)');
 assert.notEqual(follow.style['--widget-shadow'], 'none');
 assert.equal(follow.style['--widget-padding'], '24px');
 const plain = frame({surface: 'plain', background: '#123456'});
 assert.equal(plain.style['--widget-background'], 'transparent');
 assert.equal(plain.style['--widget-border'], 'transparent');
 assert.equal(plain.style['--widget-shadow'], 'none');
 assert.equal(plain.style['--widget-padding'], '24px');
 const customSections = frame(null, {padding: 0}, {gap: 30, density: 'comfortable', innerSurface: 'soft', separators: false, overflow: 'hidden'});
 assert.equal(customSections.style['--widget-header-padding'], '0px');
 assert.equal(customSections.style['--widget-gap'], '30px');
 assert.equal(customSections['data-density'], 'comfortable');
 assert.equal(customSections['data-inner-surface'], 'soft');
 assert.equal(customSections['data-separators'], false);
 assert.equal(customSections.children[2].props.style.overflow, 'hidden');
});
