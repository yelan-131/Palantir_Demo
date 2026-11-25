const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {runInNewContext} = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const source = readFileSync(join(__dirname, '../src/pages/ComponentPages', file), 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }});
  const exports = {};
  runInNewContext(outputText, {exports, require:specifier=>imports[specifier]});
  return exports;
}

const businessComponents = load('businessComponents.ts');
const model = load('model.ts', {'./businessComponents':businessComponents});
const {planWidgetSourceChange, widgetSourceChangeImpact} = load('widgetSourceImpact.ts', {'./model':model});
const page = widgets => ({title:'生产总览',sourceFormId:1,filterFields:[],roleIds:[],widgets});
const plain = value => JSON.parse(JSON.stringify(value));

test('an unconfigured card can switch immediately and selecting its current source is a no-op',()=>{
  const definition = page([{id:'fresh',type:'metric',title:'新指标',aggregate:'count',format:'number'}]);
  const proposal = planWidgetSourceChange(definition,'fresh',2);
  assert.deepEqual(Array.from(proposal.impacts),[]);
  assert.equal(proposal.definition.widgets[0].dataBinding.formId,2);
  assert.equal(proposal.definition.widgets[0].format,'number');
  assert.equal(definition.widgets[0].dataBinding,undefined);
  assert.equal(planWidgetSourceChange(definition,'fresh',1).definition,definition);

  const newChart = {...page([{id:'chart',type:'chart',title:'新图表',aggregate:'count',dimension:'prefilled'}]),sourceFormId:undefined};
  const chartProposal = planWidgetSourceChange(newChart,'chart',2);
  assert.deepEqual(Array.from(chartProposal.impacts),[]);
  assert.equal(chartProposal.definition.widgets[0].dataBinding.formId,2);
});

test('a configured chart reports reset statistics and names its removed incoming and outgoing links',()=>{
  const definition = page([
    {id:'chart',type:'chart',title:'趋势',aggregate:'sum',dimension:'day',measure:'qty',expression:'sum(qty)',sharedMetricId:'m1',targetWidgetIds:['list']},
    {id:'list',type:'record-list',title:'明细'},
    {id:'filter',type:'record-filter',title:'状态筛选',standaloneFilter:true,targetWidgetIds:['chart','list']},
  ]);
  const before = plain(definition);
  const proposal = planWidgetSourceChange(definition,'chart',2);
  assert.deepEqual(Array.from(proposal.impacts),[
    '重置「趋势」的分组字段、统计口径、自定义公式、共享指标引用',
    '移除「趋势」到「明细」的联动',
    '移除「状态筛选」到「趋势」的联动',
  ]);
  assert.deepEqual(plain(proposal.definition.widgets[2].targetWidgetIds),['list']);
  assert.deepEqual(plain(definition),before);
});

test('a source change reports an old list filter that follows the list and drops source-dependent settings',()=>{
  const definition = page([
    {id:'list',type:'record-list',title:'明细',listSettings:{columns:['qty'],defaultSort:{field:'qty',order:'desc'},displayGroups:[{id:'ops',columns:['qty']}]}, filterFields:['status']},
    {id:'filter',type:'record-filter',title:'旧筛选',targetWidgetIds:['list'],filterFields:['qty'],filterSettings:{requiredFields:['qty'],schemes:[{id:'main',groups:[]}]}},
  ]);
  const proposal = planWidgetSourceChange(definition,'list',2);
  assert.deepEqual(Array.from(proposal.impacts),[
    '重置「明细」的显示列、排序设置、显示权限组、筛选字段',
    '同步切换「旧筛选」的业务来源并重置筛选字段、必填筛选条件、筛选方案',
  ]);
  assert.deepEqual(plain(proposal.definition.widgets[1].targetWidgetIds),['list']);
  assert.equal(proposal.definition.widgets[1].dataBinding.formId,2);
});

test('a target-inferred source change reports retained filter fields that will reset',()=>{
  const before = page([
    {id:'filter',type:'record-filter',title:'条件',targetWidgetIds:[],filterFields:['status'],filterSettings:{requiredFields:['status']}},
    {id:'list',type:'record-list',title:'质检明细',dataBinding:{formId:2}},
  ]);
  const after = model.setSharedFilterTargets(before,'filter',['list']);
  assert.deepEqual(Array.from(widgetSourceChangeImpact(before,after,'filter')),['重置「条件」的筛选字段、必填筛选条件']);
  assert.equal(after.widgets[0].dataBinding.formId,2);
  assert.deepEqual(plain(after.widgets[0].targetWidgetIds),['list']);
});
