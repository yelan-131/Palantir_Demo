const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/AppPrograms/analyticsExploration.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, context);
const {analyticsFieldLabel, formatAnalyticsValue, removeAnalyticsWidgetFilter, analyticsDrilldownQuery, analyticsDataSignature} = context.exports;

test('published source labels replace generic labels without confusing datasets with different semantics', () => {
  const data = {fieldLabels: {production: {category:'班次', subject:'产线'}, products: {category:'物料类别'}}};
  assert.equal(analyticsFieldLabel(data,'category','production'), '班次');
  assert.equal(analyticsFieldLabel(data,'category','products'), '物料类别');
  assert.equal(analyticsFieldLabel(data,'category'), '品类');
  assert.equal(analyticsFieldLabel(data,'subject'), '产线');
  assert.equal(analyticsFieldLabel(undefined,'dateRange'), '日期范围');
});

test('drilldown preserves global and target filters, overrides the clicked dimension, and leaves sibling widgets intact', () => {
  const query = {filters:{category:'早班'},widget_filters:{detail:{status:'预警',subject:'原产线'},other:{date:'2026-06-01'}}};
  const before = JSON.stringify(query);
  const next = analyticsDrilldownQuery(query,'detail','subject','新产线');
  assert.deepEqual(JSON.parse(JSON.stringify(next)), {filters:{category:'早班'},widget_filters:{detail:{status:'预警',subject:'新产线'},other:{date:'2026-06-01'}}});
  next.filters.category = '中班';
  next.widget_filters.detail.subject = '再选产线';
  assert.equal(JSON.stringify(query),before);
});

test('removing the last linked condition drops its group without resetting other widget conditions', () => {
  const filters = {chart:{category:'早班',subject:'A'},other:{subject:'B'}};
  const next = removeAnalyticsWidgetFilter(filters,'chart','subject');
  assert.deepEqual(JSON.parse(JSON.stringify(next)),{chart:{category:'早班'},other:{subject:'B'}});
  assert.deepEqual(JSON.parse(JSON.stringify(removeAnalyticsWidgetFilter(next,'chart','category'))),{other:{subject:'B'}});
  assert.equal(filters.chart.subject,'A');
});

test('custom units apply to numbers while standard formats and missing values retain their meaning', () => {
  assert.equal(formatAnalyticsValue(4400,{unit:'件'}),'4,400 件');
  assert.equal(formatAnalyticsValue(94.62,{format:'percent',unit:'件'}),'94.62%');
  assert.equal(formatAnalyticsValue(30,{format:'duration',unit:'分钟'}),'30 秒');
  assert.equal(formatAnalyticsValue(null,{unit:'件'}),'—');
});

test('presentation edits retain matching results while formula and dataset changes invalidate them', () => {
  const design = {datasets:[{id:'source',source:'form-a',dimensions:['date'],measures:['qty']}],metrics:[{id:'qty',datasetId:'source',expression:'sum(qty)',format:'number'}],widgets:[{id:'trend',type:'bar',metricIds:['qty'],datasetId:'source',dimension:'date'}]};
  const copy = JSON.parse(JSON.stringify(design));
  copy.widgets[0].title='新标题'; copy.widgets[0].width='wide'; copy.metrics[0].unit='件'; copy.style={cardRadius:10};
  assert.equal(analyticsDataSignature(copy),analyticsDataSignature(design));
  copy.metrics[0].expression='avg(qty)';
  assert.notEqual(analyticsDataSignature(copy),analyticsDataSignature(design));
  copy.metrics[0].expression='sum(qty)'; copy.datasets[0].source='form-b';
  assert.notEqual(analyticsDataSignature(copy),analyticsDataSignature(design));
});

test('shared identity and pinned version changes invalidate authoritative metric results',()=>{
 const design={metrics:[{id:'alias',datasetId:'source',expression:'sum(qty)',sharedMetricId:'company-qty',sharedMetricVersion:1}]};
 const next=JSON.parse(JSON.stringify(design));next.metrics[0].sharedMetricVersion=2;
 assert.notEqual(analyticsDataSignature(next),analyticsDataSignature(design));
 next.metrics[0].sharedMetricVersion=1;next.metrics[0].sharedMetricId='another-library-metric';
 assert.notEqual(analyticsDataSignature(next),analyticsDataSignature(design));
});

test('dataset range changes invalidate previous totals and rows even when field bindings stay the same', () => {
  const original = {datasets:[{id:'d',sourceType:'businessForm',source:'production',dimensions:['status'],measures:['actual']}],metrics:[],widgets:[]};
  const narrowed = {...original,datasets:[{...original.datasets[0],rangeFilters:[{field:'status',operator:'eq',value:'正常'}]}]};
  assert.notEqual(analyticsDataSignature(original), analyticsDataSignature(narrowed));
  assert.notEqual(analyticsDataSignature(narrowed), analyticsDataSignature({...narrowed,datasets:[{...narrowed.datasets[0],rangeFilters:[]}]}));
});
