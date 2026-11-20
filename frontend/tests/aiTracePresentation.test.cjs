const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInThisContext } = require('node:vm');
const ts = require('typescript');

function loadPresentationModule(path, imports = {}) {
  const source = readFileSync(join(__dirname, '../src', path), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInThisContext('(function(exports, require) {' + js + '\n})')(exports, name => imports[name]);
  return exports;
}

const { buildTracePresentation, getTraceQueryContext } = loadPresentationModule(
  'components/AiChatWidget/tracePresentation.ts',
  { '../../pages/AccountCenter/aiRegistryHelp': loadPresentationModule('pages/AccountCenter/aiRegistryHelp.ts') },
);

const tool = 'platform.form_settings.query';
const call = (id, toolCallId, queryContext) => ({ id, toolCallId, queryContext, tool, kind: 'tool', content: `调用 ${tool}` });
const result = (id, toolCallId, changes) => ({ id, toolCallId, tool, kind: 'result', content: '旧版显示文本', ...changes });

test('correlates concurrent invocations of the same tool and preserves call order', () => {
  const trace = buildTracePresentation([
    call('first-start', 'first', '按表单编码查找'),
    call('second-start', 'second', '列出表单'),
    { id: 'note', kind: 'note', content: '模型步骤' },
    result('second-end', 'second', { resultCount: 6, summary: 'Result count: 6' }),
    result('first-end', 'first', { status: 'failed', error: '403: Form permission denied' }),
  ]);

  assert.deepEqual(trace.rows.map(row => row.kind), ['tool', 'tool', 'note']);
  assert.equal(trace.rows[0].title, '查表单和字段');
  assert.equal(trace.rows[0].statusLabel, '执行失败');
  assert.equal(trace.rows[0].queryContext, '按表单编码查找');
  assert.equal(trace.rows[0].detail, '403: Form permission denied');
  assert.equal(trace.rows[1].queryContext, '列出表单');
  assert.equal(trace.rows[1].resultCount, 6);
  assert.equal(trace.rows[1].detail, undefined);
});

test('restores an adjacent legacy pair and keeps a zero count without displaying it twice', () => {
  const { rows } = buildTracePresentation([
    call('start', undefined, '按表单名称查找'),
    result('end', undefined, { summary: 'Result count: 0' }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'start');
  assert.equal(rows[0].queryContext, '按表单名称查找');
  assert.equal(rows[0].statusLabel, '已完成');
  assert.equal(rows[0].resultCount, 0);
  assert.equal(rows[0].detail, undefined);
});

test('keeps legacy invocations separate when ordering alone cannot associate their results', () => {
  const { rows } = buildTracePresentation([
    call('first-start'),
    call('second-start'),
    result('first-end', undefined, { resultCount: 0 }),
    result('second-end', undefined, { resultCount: 6 }),
    call('third-start'),
    { id: 'note', kind: 'note', content: '其他步骤' },
    result('third-end', undefined, { resultCount: 7 }),
  ]);

  assert.deepEqual(rows.map(row => row.id), [
    'first-start', 'second-start', 'first-end', 'second-end', 'third-start', 'note', 'third-end',
  ]);
});

test('uses fixed query filter descriptions without copying the supplied argument values', () => {
  assert.equal(getTraceQueryContext(tool, { form_code: 'fixture_work_order' }), '按表单编码查找');
  assert.equal(getTraceQueryContext(tool, { form_name: 'confidential' }), '按表单名称查找');
  assert.equal(getTraceQueryContext(tool, { form_id: 5, form_code: 'ignored' }), '按表单 ID 查找');
  assert.equal(getTraceQueryContext(tool, { application_id: 2 }), '按应用列出表单');
  assert.equal(getTraceQueryContext(tool, {}), '列出表单');
  assert.equal(getTraceQueryContext('forms.get_record', {}), undefined);
});

test('projects six named results from a legacy form list and indicates additional entries', () => {
  const records = Array.from({ length: 7 }, (_, index) => ({
    name: `测试表单 ${index + 1}`,
    code: `fixture_form_${index + 1}`,
    fields: [{ label: '私有字段', token: 'private-token' }],
    attachments: [{ url: 'https://example.invalid/file' }],
  }));
  const { rows } = buildTracePresentation([
    call('start', undefined, '列出表单'),
    result('end', undefined, { resultCount: 7, resultPayload: { items: records } }),
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].resultPreview, {
    items: records.slice(0, 6).map(({ name, code }) => ({ label: name, secondary: code })),
    remaining: 1,
  });
});

test('omits result previews for empty, failed and unknown tool responses', () => {
  const resultPayload = { items: [{ name: '测试表单', password: 'secret' }] };
  const { rows } = buildTracePresentation([
    result('empty', undefined, { resultCount: 0, resultPayload }),
    result('failure', undefined, { status: 'failed', resultPayload }),
    result('unknown', undefined, { tool: 'fixture.unknown', resultPayload }),
  ]);

  assert.ok(rows.every(row => row.resultPreview === undefined));
});

test('lists safe record identifiers without projecting record data', () => {
  const record = { id: 51, data: { contact: 'private', password: 'secret' } };
  const { rows } = buildTracePresentation([
    result('record', undefined, { tool: 'forms.get_record', resultPayload: { record } }),
    result('records', undefined, { tool: 'forms.query_records', resultPayload: { records: [record, { id: 'invalid' }] } }),
  ]);

  for (const row of rows) {
    assert.deepEqual(row.resultPreview, { items: [{ label: '记录 #51' }], remaining: 0 });
  }
});

test('keeps a skill usage item distinct from a correlated tool invocation', () => {
  const { rows } = buildTracePresentation([
    call('start', 'first'),
    { id: 'skill', kind: 'skill', skillId: 'review-operations', content: '审阅业务记录', status: 'completed' },
    result('end', 'first', { resultCount: 1 }),
  ]);

  assert.deepEqual(rows.map(row => row.kind), ['tool', 'skill']);
  assert.equal(rows[1].content, '审阅业务记录');
  assert.equal(rows[1].skillId, 'review-operations');
  assert.equal(rows[1].statusLabel, '已完成');
});
