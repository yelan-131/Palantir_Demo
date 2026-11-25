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
const Settings=load('../src/pages/ComponentPages/PresentationSettings.tsx',name=>name==='@/components/PropertyInspector'?inspector:name==='@/components/Icon/ant'?icons:name==='./presentation'?presentation:require(name)).default;
const marker=name=>React.createElement('span',{'data-test-property':name},name);
function render(header={}, recordList=false){return renderToStaticMarkup(React.createElement(Settings,{recordList,resolved:presentation.resolvePresentation({},{presentation:{header}}),onChange:()=>{},layout:marker('layout'),titleSettings:marker('title-options'),descriptionSettings:React.createElement(React.Fragment,null,marker('description-input'),marker('description-options')),actionSettings:marker('button-options')}));}
test('header text cards include their visibility switches and default to collapsed',()=>{
 const html=render();for(const name of ['layout','title-options','description-input','description-options','button-options'])assert.ok(html.includes(`data-test-property="${name}"`));
 const [,titleCard,descriptionCard]=html.split('class="component-toolbar-group component-text-settings"');
 assert.match(titleCard,/aria-expanded="false".*aria-label="显示标题".*hidden="".*data-test-property="title-options"/);
 assert.match(descriptionCard,/aria-expanded="false".*aria-label="显示说明".*hidden="".*data-test-property="description-input".*data-test-property="description-options"/);
 assert.ok(html.includes('布局与容器'));assert.ok(html.includes('容器跟随页面'));
 const hiddenTitle=render({titleVisible:false});assert.ok(!hiddenTitle.includes('data-test-property="title-options"'));assert.ok(hiddenTitle.includes('data-test-property="button-options"'));
 const hiddenDescription=render({descriptionVisible:false});assert.ok(!hiddenDescription.includes('data-test-property="description-options"'));assert.ok(!hiddenDescription.includes('data-test-property="description-input"'));
 const hiddenActions=render({actionsVisible:false});assert.ok(!hiddenActions.includes('data-test-property="button-options"'));
 const hiddenHeader=render({visible:false});for(const name of ['title-options','description-input','description-options','button-options'])assert.ok(!hiddenHeader.includes(`data-test-property="${name}"`));
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

test('a field override and its reset preserve inheritance for sibling appearance fields', () => {
 const page = {style: {componentDefaults: {container: {background: '#336699', padding: 24}}}};
 let value = {};
 const findRow = (node, label) => {
  if (!React.isValidElement(node)) return undefined;
  if (node.props.label === label) return node;
  return React.Children.toArray(node.props.children).map(child => findRow(child, label)).find(Boolean);
 };
 const control = label => findRow(Settings({
  value,
  resolved: presentation.resolvePresentation(page, {presentation: value}),
  onChange: next => { value = next; },
 }), label).props.children.props;

 const initialRadius = control('圆角');
 assert.equal(initialRadius.onReset, undefined);
 initialRadius.control.props.onChange(0);
 assert.deepEqual(Object.keys(value.container), ['radius']);
 assert.equal(value.container.radius, 0);
 assert.equal(presentation.resolvePresentation(page, {presentation: value}).container.background, '#336699');

 const backgroundActions = control('背景颜色').control.props.children;
 backgroundActions[1].props.onClick();
 assert.equal(value.container.background, null);
 assert.equal(presentation.resolvePresentation(page, {presentation: value}).container.background, null);
 control('背景颜色').onReset();
 assert.equal(presentation.resolvePresentation(page, {presentation: value}).container.background, '#336699');
 assert.equal(value.container.radius, 0);

 control('圆角').onReset();
 assert.equal(value.container, null);
});

const model=load('../src/pages/ComponentPages/model.ts');
const businessComponents=load('../src/pages/ComponentPages/businessComponents.ts');
const widgetSourceImpact=load('../src/pages/ComponentPages/widgetSourceImpact.ts',name=>name==='./model'?model:require(name));
const analyticsAppearance=load('../src/pages/AppPrograms/analyticsWidgetAppearance.ts');
const {default:Inspector,pageSections}=load('../src/pages/ComponentPages/Inspector.tsx', name => {
 if (name==='react') return {...React,useLayoutEffect(){},useRef(){return {current:undefined};},useState(){return [undefined,()=>{}];}};
 if (name==='./PresentationSettings') return Settings;
 if (name==='./presentation') return presentation;
 if (name==='@/components/PropertyInspector') return inspector;
 if (name==='@/components/Icon/ant') return icons;
 if (name==='./inspectorCapabilities') return {inspectorTabs};
 if (name==='./model') return model;
 if (name==='./businessComponents') return businessComponents;
 if (name==='./widgetSourceImpact') return widgetSourceImpact;
 if (name==='../AppPrograms/analyticsWidgetAppearance') return analyticsAppearance;
 if (name==='./ListConfigurationPreview') return {useListConfigurationPreview:()=>undefined};
 if (name==='./ToolbarGroups') return {__esModule:true,default:()=>null,PropertySubgroup:({children})=>children};
 if (name.endsWith('.css')) return {};
 if (['./BusinessProperties','./FilterSchemes','@/components/OptionPicker','@/components/PropertyInspector/InspectorTabs'].includes(name)) return ()=>null;
 return require(name);
});

const collect = node => React.isValidElement(node)
 ? [node,...React.Children.toArray([node.props.children,node.props.actions,node.props.layout,node.props.contentSettings]).flatMap(collect)]
 : [];

function widgetProperties(widget, {tab='basic', neighbors=[], sourceFormId=1, publishedSource, forms=[], onChange}={}) {
 const tree = Inspector({
  panel:'widget', tab, selected:widget.id, definition:{sourceFormId,filterFields:[],roleIds:[],widgets:[widget,...neighbors]},
  fields:[], forms, roles:[], disabled:false, sourceOpen:false, sourceIsBusiness:false, publishedSource, onChange,
 });
 return collect(tree);
}

function pageProperties(definition, overrides={}) {
 return collect(Inspector({
  panel:'style', tab:'basic', definition,
  fields:[], forms:[], roles:[], disabled:false, sourceOpen:false, sourceIsBusiness:false,
  ...overrides,
 }));
}

const pageTabs = properties => properties.find(node => node.props['aria-label'] === '页面设置分类').props;

test('a shared filter edits its fields and only offers same-source query targets', () => {
 const updates = [];
 const properties = widgetProperties({
  id:'filter',type:'record-filter',filterFields:['shift','status'],targetWidgetIds:['total','details','other-source'],
  filterSettings:{requiredFields:['shift'],showKeyword:false},
 }, {
  tab:'data',
  forms:[{id:1,name:'生产总览'}],
  neighbors:[
   {id:'total',type:'metric',title:'合计指标'},
   {id:'details',type:'record-list',title:'生产明细'},
   {id:'chart',type:'chart',title:'产量趋势'},
   {id:'other-filter',type:'record-filter',title:'另一个筛选'},
   {id:'other-source',type:'metric',title:'其他来源',dataBinding:{formId:2}},
  ],
  publishedSource:{form:{fields:[
   {field_name:'shift',label:'班次',searchable:true},
   {field_name:'status',label:'状态',sortable:true},
   {field_name:'unindexed',label:'无索引'},
   {field_name:'archived',label:'已归档',searchable:true,archived:true},
  ]}},
  onChange:definition=>updates.push(definition.widgets[0]),
 });
 const field = label => properties.find(node=>node.props.label===label).props.children.props;
 assert.equal(field('业务来源').children, '生产总览');
 assert.equal(field('业务来源').onChange, undefined);
 assert.deepEqual(Array.from(field('筛选字段').options, option=>option.value), ['shift','status']);
 assert.deepEqual(Array.from(field('目标组件').options, option=>option.value), ['total','details','chart']);
 assert.match(properties.find(node=>node.props.title==='移除此组件？').props.description, /发布页面后，2 个联动组件/);
 field('筛选字段').onChange(['status']);
 assert.deepEqual(updates[0].filterFields, ['status']);
 assert.deepEqual(updates[0].filterSettings.requiredFields, []);
 field('目标组件').onChange(['details']);
 assert.deepEqual(Array.from(updates[1].targetWidgetIds), ['details']);
 assert.equal(updates[1].standaloneFilter, true);
});

test('a new filter offers in-page targets before showing the source and filter fields', () => {
 const updates = [];
 const properties = widgetProperties({id:'filter',type:'record-filter',standaloneFilter:true}, {
  tab:'data',sourceFormId:null,forms:[{id:1,name:'生产数据'},{id:2,name:'质检记录'}],
  neighbors:[
   {id:'details',type:'record-list',title:'生产明细',dataBinding:{formId:1}},
   {id:'quality',type:'chart',title:'缺陷统计',dataBinding:{formId:2}},
   {id:'unbound',type:'metric',title:'未绑定的指标'},
  ],
  onChange:definition=>updates.push(definition.widgets[0]),
 });
 const targets = properties.find(node=>node.props.label==='目标组件').props.children.props;
 assert.deepEqual(Array.from(targets.options,option=>option.label), ['生产明细 · 生产数据','缺陷统计 · 质检记录']);
 assert.ok(!properties.some(node=>['业务来源','筛选字段'].includes(node.props.label)));
 targets.onChange(['quality']);
 assert.equal(updates[0].dataBinding.formId, 2);
 assert.deepEqual(Array.from(updates[0].targetWidgetIds), ['quality']);
});

test('list-only filter fields stop a chart from being added by the target picker or bulk selection', () => {
 const updates = [];
 const properties = widgetProperties({
  id:'filter',type:'record-filter',filterFields:[businessComponents.APPROVAL_STATUS_FIELD],targetWidgetIds:['details'],
 }, {
  tab:'data',neighbors:[
   {id:'details',type:'record-list',title:'明细'},
   {id:'also-details',type:'record-list',title:'另一张明细'},
   {id:'chart',type:'chart',title:'产量图'},
  ],
  onChange:definition=>updates.push(definition.widgets[0]),
 });
 const targets = properties.find(node=>node.props.label==='目标组件').props.children.props;
 assert.equal(targets.options.find(option=>option.value==='chart').disabled, true);
 properties.find(node=>node.props.children==='全选同源组件').props.onClick();
 assert.deepEqual(Array.from(updates[0].targetWidgetIds), ['details','also-details']);
});

test('a formula disables only fallback inputs, leaving grouping editable', () => {
 const chart = {id:'chart',type:'chart',aggregate:'sum',measure:'quantity'};
 for (const formula of [{expression:'sum(quantity)'},{sharedMetricId:'shared',sharedMetricVersion:1},{}]) {
  const active = Boolean(formula.expression || formula.sharedMetricId);
  const properties = widgetProperties({...chart,...formula},{tab:'data'});
  const field = label => properties.find(node => node.props.label === label).props.children.props;
  assert.equal(field(active?'备用统计方式':'统计方式').disabled, active);
  assert.equal(field('数值字段').disabled, active);
  assert.ok(!field('分组字段').disabled);
 }
});

test('rank tables omit palette and chart-only height while series charts retain them', () => {
 const chart = {id:'chart',type:'chart',aggregate:'count'};
 for (const chartType of ['rank-table','bar']) {
  const properties = widgetProperties({...chart,chartType});
  for (const label of ['组件配色','图表高度']) {
   assert.equal(properties.some(node => node.props.label === label), chartType === 'bar');
  }
 }
});

test('component-specific display options share the list content section and access stays last', () => {
 for (const [type, labels] of [
  ['record-list', []],
  ['chart', ['图表类型', '组件配色', '显示格式', '显示单位']],
  ['metric', ['显示格式', '显示单位', '组件配色', '阈值颜色']],
  ['workspace', ['展示模块']],
 ]) {
  const properties = widgetProperties({id:'widget',type,title:'组件'});
  const presentation = properties.find(node => node.type === Settings);
  const groups = Settings(presentation.props).props.children;
  const content = groups.find(node => node?.props.title === '内容');
  const layout = groups.find(node => node?.props.title === '布局与容器');
  for (const label of labels) {
   assert.ok(collect(content).some(node => node.props.label === label), type + ' includes ' + label + ' under 内容');
   assert.ok(!collect(layout).some(node => node.props.label === label), type + ' omits ' + label + ' from layout');
  }
  assert.deepEqual(properties.filter(node => node.type === inspector.PropertyGroup).map(node => node.props.title),
   ['基本信息', ...(type === 'chart' ? ['图表交互'] : []), '组件访问']);
 }
});

test('page Basic uses the existing style tab and places names, layout, theme and defaults in peer groups', () => {
 const definition = {title:'生产总览',filterFields:[],roleIds:[],widgets:[],style:{componentGap:12,gridSize:44}};
 const updates = [];
 const properties = pageProperties(definition, {onChange:next=>updates.push(next)});
 const tabs = pageTabs(properties);
 assert.equal(tabs.activeKey, 'style');
 assert.deepEqual(Array.from(tabs.items, item => item.label), ['基本']);

 const groups = properties.filter(node => node.type === inspector.PropertyGroup);
 const [info, layout, theme] = groups;
 assert.deepEqual(groups.map(node => node.props.title), ['基本信息', '页面布局', '页面主题']);
 assert.notEqual(info.props.defaultOpen, false);
 assert.ok([layout, theme].every(node => node.props.defaultOpen === false));
 assert.deepEqual(collect(layout).filter(node=>node.type===inspector.PropertyRow).map(node=>node.props.label),
  ['组件间距', '方格尺寸', '刷新间隔']);
 assert.equal(collect(info).find(node=>node.props.label==='页面名称').props.children.props.value, definition.title);
 collect(layout).find(node=>node.props.label==='组件间距').props.children.props.onChange(20);
 assert.equal(updates[0].style.componentGap, 20);
 assert.equal(updates[0].style.gridSize, 44);

 const defaults = properties.find(node => node.type === Settings);
 assert.ok(groups.every(group => !collect(group).some(node=>node.type===Settings)));
 const [container, header, content] = Settings(defaults.props).props.children;
 assert.deepEqual([container, header, content].map(group=>group.props.title),
  ['组件默认容器', '组件默认标题与操作区', '组件默认内容']);
 collect(container).find(node=>node.props.label==='内边距').props.children.props.onChange(24);
 assert.equal(updates[1].style.componentDefaults.container.padding, 24);
 assert.equal(updates[1].style.componentGap, 12);
});

test('legacy page source and audience stay editable in Basic compatibility settings', () => {
 const definition = {title:'生产总览',sourceFormId:1,filterFields:['date'],roleIds:[2],widgets:[]};
 const updates = [];
 const properties = pageProperties(definition, {onChange:next=>updates.push(next)});
 assert.deepEqual(Array.from(pageTabs(properties).items, item=>item.label), ['基本', '筛选']);
 assert.ok(properties.some(node=>node.props.label==='筛选器布局'));

 const compatibility = properties.find(node=>node.type===inspector.PropertyGroup && node.props.title==='兼容设置');
 assert.equal(compatibility.props.defaultOpen, false);
 const compatibilityFields = collect(compatibility).filter(node=>node.type===inspector.PropertyRow);
 const source = compatibilityFields.find(node=>node.props.label==='默认业务来源').props.children.props;
 const access = compatibilityFields.find(node=>node.props.label==='页面访问角色').props.children.props;
 assert.equal(source.value, 1);
 assert.deepEqual(access.value, [2]);
 access.onChange([3]);
 assert.deepEqual({...updates[0]}, {...definition,roleIds:[3]});

 const reopened = pageProperties({...definition,sourceFormId:null,roleIds:[],filterFields:[]}, {
  panel:'compatibility', savedPageSource:true, savedPageAccess:true,
 });
 assert.equal(pageTabs(reopened).activeKey, 'style');
 const openGroup = reopened.find(node=>node.type===inspector.PropertyGroup && node.props.title==='兼容设置');
 assert.equal(openGroup.props.defaultOpen, true);
 assert.ok(collect(openGroup).some(node=>node.props.label==='默认业务来源'));
 assert.ok(collect(openGroup).some(node=>node.props.label==='页面访问角色'));
});

test('a page with a default source can add its first global filter through page settings', () => {
 const definition = {title:'生产总览',sourceFormId:1,filterFields:[],roleIds:[],widgets:[]};
 const panels = [];
 const properties = pageProperties(definition, {onPanel:next=>panels.push(next)});
 assert.deepEqual(Array.from(pageTabs(properties).items, item=>item.label), ['基本']);
 assert.ok(!properties.some(node=>node.props.label==='页面访问角色'));
 assert.ok(!pageSections(false).some(item=>item.key==='filters'));
 assert.ok(pageSections(true).some(item=>item.key==='filters'));
 properties.find(node=>node.props.label==='全局筛选').props.children.props.onClick();
 assert.deepEqual(panels, ['filters']);

 const updates = [];
 const filters = pageProperties(definition, {panel:'filters',onChange:next=>updates.push(next)});
 assert.equal(pageTabs(filters).activeKey, 'filters');
 assert.deepEqual(Array.from(pageTabs(filters).items, item=>item.label), ['基本', '筛选']);
 filters.find(node=>node.props.label==='筛选字段').props.children.props.onChange(['date']);
 assert.deepEqual({...updates[0]}, {...definition,filterFields:['date']});
});

test('a chart offers global filter setup only for the page default source', () => {
 const chart = {id:'chart',type:'chart',dimension:'date',dataBinding:{formId:2}};
 for (const sourceFormId of [null, 1, 2]) {
  const properties = widgetProperties(chart, {sourceFormId});
  assert.ok(properties.some(node=>node.props.label==='目标组件'));
  assert.equal(properties.some(node=>node.props.message==='请将分组字段加入全局筛选'), sourceFormId===2);
 }
});
