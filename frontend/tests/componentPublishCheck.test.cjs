const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/pages/ComponentPages/publishCheck.ts'), 'utf8');
const context = {exports: {}};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, context);
const {normalizePublishCheck} = context.exports;
const draft = {widgets: [{id: 'metric'}, {id: 'chart'}, {id: 'list'}]};
const plain = value => JSON.parse(JSON.stringify(value));

test('preview issues retain known component targets and surface errors from unknown IDs', () => {
  const result = normalizePublishCheck(draft, {
    errors: ['缺少分组字段', '页面权限无效'],
    widgetErrors: {chart: ['缺少分组字段', '缺少分组字段'], metric: ['选择来源'], removed: ['来源读取失败']},
    widgetTargets: {chart: 'interaction'},
  });

  assert.deepEqual(plain(result), {
    errors: ['来源读取失败', '页面权限无效'],
    widgets: [
      {id: 'chart', errors: ['缺少分组字段'], target: 'interaction'},
      {id: 'metric', errors: ['选择来源'], target: 'data'},
    ],
  });
});

test('schema validation paths resolve widget indices against the checked draft', () => {
  const result = normalizePublishCheck(draft, [
    {loc: ['body', 'definition', 'widgets', 1, 'dimension'], msg: '缺少分组字段'},
    {loc: ['body', 'definition', 'widgets', 2, 'customHeight'], msg: '高度超出范围'},
    {loc: ['body', 'definition', 'title'], msg: '页面名称不能为空'},
    {loc: ['body', 'definition', 'widgets', 9, 'id'], msg: '组件不存在'},
  ]);

  assert.deepEqual(plain(result), {
    errors: ['definition / title：页面名称不能为空', 'definition / widgets / 9 / id：组件不存在'],
    widgets: [
      {id: 'chart', errors: ['缺少分组字段'], target: 'data'},
      {id: 'list', errors: ['高度超出范围'], target: 'appearance'},
    ],
  });
});

test('non-structured failures stay visible and a clean validation stays empty', () => {
  assert.deepEqual(plain(normalizePublishCheck(draft, '源数据不可用', '源数据不可用')), {
    errors: ['源数据不可用'], widgets: [],
  });
  assert.deepEqual(plain(normalizePublishCheck(draft, {widgetErrors: {chart: []}})), {
    errors: [], widgets: [],
  });
});

test('filter target errors point to Data while chart targets stay in interaction', () => {
  const definition = {widgets:[{id:'filter',type:'record-filter'},{id:'chart',type:'chart'}]};
  const result = normalizePublishCheck(definition, [0,1].map(index=>({
    loc:['body','definition','widgets',index,'targetWidgetIds'], msg:'目标无效',
  })));
  assert.deepEqual(plain(result.widgets).map(({target})=>target), ['data','interaction']);
});
