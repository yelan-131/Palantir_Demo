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

test('a chat connection that ends during a tool call rejects without a result', async () => {
  const frames = [
    'event: run.accepted\ndata: {"status":"accepted"}\n\n',
    'event: item.created\ndata: {"type":"tool_call","status":"running"}\n\n',
  ];
  const api = loadApi(async () => ({ ok: true, body: { getReader: () => ({
    read: async () => frames.length
      ? { done: false, value: new TextEncoder().encode(frames.shift()) }
      : { done: true },
  }) } }));
  const events = [];
  await assert.rejects(api.streamAgentChat({ message: 'test' }, event => events.push(event)), /连接已中断/);
  assert.deepEqual(events.map(event => event.event), ['run.accepted', 'item.created']);
});

test('a backend run failure is delivered even if there is no answer', async () => {
  const frame = new TextEncoder().encode('event: run.failed\ndata: {"detail":"权限不足"}\n\n');
  const api = loadApi(async () => ({ ok: true, body: { getReader: () => {
    let sent = false;
    return { read: async () => {
      if (sent) return { done: true };
      sent = true;
      return { done: false, value: frame };
    } };
  } } }));
  const events = [];
  await api.streamAgentChat({ message: 'test' }, event => events.push(event));
  assert.equal(events[0].data.detail, '权限不足');
});

test('a confirmation stream ending before its result triggers durable status recovery', async () => {
  const api = loadApi(async () => ({ ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } }));
  await assert.rejects(api.streamConfirmAgentRun('run-1', { confirmed: true }, () => {}), /连接已中断/);
});

test('confirmation delivers the saved receipt before a streamed follow-up and lets the browser detach', async () => {
  const frames = [
    'event: run.completed\ndata: {"run":{"status":"completed"}}\n\n',
    'event: continuation.run.accepted\ndata: {"status":"accepted"}\n\n',
  ];
  const controller = new AbortController();
  const events = [];
  const api = loadApi(async (_, options) => ({ ok: true, body: { getReader: () => ({
    read: async () => {
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return { done: false, value: new TextEncoder().encode(frames.shift()) };
    },
  }) } }));

  await assert.rejects(api.streamConfirmAgentRun('run-1', { confirmed: true }, event => {
    events.push(event.event);
    if (event.event === 'continuation.run.accepted') controller.abort();
  }, controller.signal), { name: 'AbortError' });
  assert.deepEqual(events, ['run.completed', 'continuation.run.accepted']);
});

test('restoring a confirmation subscribes without sending a new message or resubmitting the card', async () => {
  const controller = new AbortController();
  let request;
  const frames = ['event: continuation.answer.completed\ndata: {"answer":"下一步已准备好"}\n\n',
    'event: confirmation.finished\ndata: {}\n\n'];
  const api = loadApi(async (url, options) => {
    request = { url, options };
    return { ok: true, body: { getReader: () => ({ read: async () => frames.length
      ? { done: false, value: new TextEncoder().encode(frames.shift()) }
      : { done: true } }) } };
  });
  const events = [];
  await api.resumeAgentConfirmation('chat-1', 'run-1', event => events.push(event), controller.signal);
  assert.equal(request.url, '/api/v1/ai/agent/conversations/chat-1/confirmations/run-1/stream');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.body, undefined);
  assert.equal(request.options.signal, controller.signal);
  assert.equal(events[0].data.answer, '下一步已准备好');
  assert.equal(events[1].event, 'confirmation.finished');
});

test('continuing a saved receipt sends neither a message nor a confirmation token', async () => {
  let request;
  const api = loadApi(async (url, options) => {
    request = { url, options };
    return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } };
  });
  await api.continueSavedAgentConfirmation('chat-1', 'run-1', () => {}, new AbortController().signal);
  assert.equal(request.url, '/api/v1/ai/agent/conversations/chat-1/confirmations/run-1/continue');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {});
});
