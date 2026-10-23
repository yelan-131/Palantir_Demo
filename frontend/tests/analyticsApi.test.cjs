const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/AppPrograms/analyticsApi.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const loadApi = (getAppProgramData, api = {}) => {
  const context = {exports: {}, require: name => {
    assert.equal(name, '@/services/api');
    return {default: api, getAppProgramData};
  }};
  vm.runInNewContext(compiled, context);
  return context.exports;
};
const query = {filters: {category: '贴片'}, widget_filters: {removedWidget: {subject: 'SMT-03'}}};

test('an older viewing tab recovers the new published design after its filter or linked widget is removed', async () => {
  for (const detail of ['筛选字段未配置为全局筛选器', '组件筛选字段不可用']) {
    const calls = [];
    const updated = {data: {analyticsDesign: {globalFilters: [], widgets: [{id: 'newWidget'}]}, analyticsData: {widgets: {newWidget: {total: 4}}}}};
    const {loadPublishedAnalytics} = loadApi(async (...args) => {
      calls.push(args);
      if (calls.length === 1) throw {response: {status: 422, data: {detail}}};
      return updated;
    });
    assert.equal(await loadPublishedAnalytics('production-overview', query), updated);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
      ['production-overview', 500, {filters: JSON.stringify(query.filters), widget_filters: JSON.stringify(query.widget_filters)}],
      ['production-overview', 500, {filters: '{}', widget_filters: '{}'}],
    ]);
    assert.deepEqual(query.filters, {category: '贴片'}, 'the request must not mutate the viewing tab state');
  }
});

test('history reads stay read-only and publishing a restored design carries its revision and release note', async () => {
  const calls = [];
  const api = loadApi(undefined, {
    get: async (...args) => { calls.push(['get', ...args]); return {data: {items: [], total: 0}}; },
    post: async (...args) => { calls.push(['post', ...args]); return {data: {publishedVersion: 4}}; },
  });
  await api.listAnalyticsVersions('board / one', 20);
  await api.getAnalyticsVersion('board / one', 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call[0] === 'get'), 'reading and selecting versions must not publish or restore server state');
  const design = {widgets: [{id: 'historical-widget'}]};
  await api.publishAnalyticsDesign('board / one', design, 'current-server-revision', '恢复 v1 配置');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get', '/dashboard/programs/board%20%2F%20one/analytics/versions', {params: {offset: 20, limit: 20}}],
    ['get', '/dashboard/programs/board%20%2F%20one/analytics/versions/1'],
    ['post', '/dashboard/programs/board%20%2F%20one/analytics/publish', {design, expectedRevision: 'current-server-revision', note: '恢复 v1 配置'}],
  ]);
});

test('unrelated errors remain visible and an unsuccessful recovery is never retried again', async () => {
  for (const error of [
    {response: {status: 403, data: {detail: '组件筛选字段不可用'}}},
    {response: {status: 422, data: {detail: '筛选条件格式无效'}}},
    new Error('network unavailable'),
  ]) {
    let calls = 0;
    const {loadPublishedAnalytics} = loadApi(async () => { calls++; throw error; });
    await assert.rejects(loadPublishedAnalytics('production-overview', query), cause => cause === error);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const error = {response: {status: 422, data: {detail: '组件筛选字段不可用'}}};
  const {loadPublishedAnalytics} = loadApi(async () => { calls++; throw error; });
  await assert.rejects(loadPublishedAnalytics('production-overview', query), cause => cause === error);
  assert.equal(calls, 2);
});

test('shared publishing carries the checked impact token and independent library revision',async()=>{
 const calls=[];
 const api=loadApi(undefined,{post:async(...args)=>{calls.push(args);return {data:{}};}});
 const definition={name:'数量',source:'production',expression:'sum(actual)'};
 await api.checkSharedMetricImpact('metric / one',definition,'metric-revision');
 await api.publishSharedAnalyticsMetric('metric / one',definition,'metric-revision','checked-references','统一统计范围');
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
 ['/dashboard/analytics/metrics/metric%20%2F%20one/impact',{definition,expectedRevision:'metric-revision'}],
 ['/dashboard/analytics/metrics/metric%20%2F%20one/publish',{definition,expectedRevision:'metric-revision',impactToken:'checked-references',note:'统一统计范围'}],
 ]);
});
