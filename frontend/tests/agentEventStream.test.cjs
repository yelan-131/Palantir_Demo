const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApi(fetch) {
  const client = { interceptors: { request: { use() {} }, response: { use() {} } } };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/api.ts'), 'utf8').replaceAll('import.meta.env', '({})');
  const context = { exports: {}, require: () => ({ __esModule: true, default: { create: () => client } }), localStorage: { getItem: () => 'unit-test-token' }, fetch, TextDecoder, Uint8Array, console };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context);
  return context.exports;
}

test('stream preserves native progress and completion across frame boundaries', async () => {
  const events = [];
  let request;
  const frames = ['event: harness.progress\ndata: {"phase":"compaction/', 'end"}\n\nevent: answer.completed\ndata: {"answer":"OK"}\n\n'];
  const api = loadApi(async (url, options) => {
    request = { url, options };
    return { ok: true, body: { getReader: () => ({ read: async () => frames.length ? { done: false, value: new TextEncoder().encode(frames.shift()) } : { done: true } }) } };
  });
  await api.streamAgentChat({ message: 'test' }, event => events.push(event));
  assert.equal(request.url, '/api/v1/ai/agent/stream');
  assert.equal(request.options.headers.Authorization, 'Bearer unit-test-token');
  assert.equal(events[0].event, 'harness.progress');
  assert.equal(events[0].data.phase, 'compaction/end');
  assert.equal(events[1].data.answer, 'OK');
});

test('stop generation aborts the actual fetch instead of hiding its UI', async () => {
  let receivedSignal;
  const api = loadApi(async (_, options) => new Promise((resolve, reject) => {
    receivedSignal = options.signal;
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const controller = new AbortController();
  const request = api.streamAgentChat({ message: 'test' }, () => {}, controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(receivedSignal, controller.signal);
});

test('stream decodes Chinese split inside UTF-8 bytes and flushes its final frame', async () => {
  const bytes = new TextEncoder().encode('event: harness.progress\r\ndata: {"text":"压缩完成"}\r\n\r\nevent: answer.completed\r\ndata: {"answer":"完成"}');
  const events = [];
  let offset = 0;
  const api = loadApi(async () => ({ ok: true, body: { getReader: () => ({
    read: async () => offset < bytes.length
      ? { done: false, value: bytes.slice(offset, ++offset) }
      : { done: true },
  }) } }));
  await api.streamAgentChat({ message: 'test' }, event => events.push(event));
  assert.equal(events.length, 2);
  assert.equal(events[0].data.text, '压缩完成');
  assert.equal(events[1].data.answer, '完成');
});

test('HTTP failures propagate without reporting a successful answer', async () => {
  const events = [];
  const api = loadApi(async () => ({ ok: false, status: 401, body: null }));
  await assert.rejects(api.streamAgentChat({ message: 'test' }, event => events.push(event)), /401/);
  assert.equal(events.length, 0);
});

test('a confirmation stream ending before its result triggers durable status recovery', async () => {
  const api = loadApi(async () => ({ ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } }));
  await assert.rejects(api.streamConfirmAgentRun('run-1', { confirmed: true }, () => {}), /连接已中断/);
});
