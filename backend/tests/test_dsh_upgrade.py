"""Upgrade gates for effective configuration, native events and process shutdown."""
import asyncio
from contextlib import asynccontextmanager
import json
import socket
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn

USER = {'tenant_id': 1, 'sub': 'dsh-upgrade-test', 'is_admin': True}


def test_harness_prompt_anchors_relative_dates_to_tenant_clock():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.services.ai.harness_runtime import harness_options
    from app.services.ai.settings import settings_snapshot
    prompt = harness_options(settings_snapshot(), USER, token='test')['env']['DSH_SYSTEM_PROMPT']
    assert 'Asia/Shanghai' in prompt
    assert datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat() in prompt
    assert '相对日期以此为准' in prompt


def test_preview_and_runtime_share_resolved_parameters(tmp_path, monkeypatch):
    from app.services.ai.harness_parameters import effective_harness_parameters
    from app.services.ai.harness_runtime import harness_options
    from app.services.ai.settings import merge_ai_settings
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    data = merge_ai_settings({'apiKey': 'private-test-only', 'chatModel': 'test', 'reasoningModel': 'test',
        'maxTokens': 256, 'retryCount': 2, 'harnessPolicy': {'contextWindow': 16000},
        'safetyPolicy': {'maxToolSteps': 3, 'toolTimeoutSeconds': 9}})
    preview = effective_harness_parameters(data)
    options = harness_options(data, USER)
    route = json.loads(options['env']['MF_DSH_PROVIDER_CONFIG'])['providers']['manufoundry']
    p = preview['parameters']
    assert route['models'][0]['contextWindow'] == p['contextWindow'] == 16000
    assert options['max_tokens'] == p['maxTokens'] == 256
    assert int(options['env']['MF_DSH_TOOL_TIMEOUT_MS']) == p['mcpTimeoutMs'] == 14000
    assert options['request_timeout_seconds'] == p['executionTimeoutSeconds']
    assert p['executionTimeoutSeconds'] >= p['mcpTimeoutMs'] / 1000
    assert 'private-test-only' not in json.dumps(preview)


def test_native_event_projection_omits_other_sessions_prompts_and_reasoning():
    from app.services.ai.harness_runtime import native_notification_payload
    def notification(kind, data, session='root'):
        return SimpleNamespace(method='session.event', payload={'sessionId': session, 'event': {'type': kind, 'seq': 3, 'data': data}})
    assert native_notification_payload(notification('user/message', {'secret': 'private'}), 'root') is None
    assert native_notification_payload(notification('assistant/message', {}, 'child'), 'root') is None
    projected = native_notification_payload(notification('assistant/message', {'message': {'content': [{'type': 'thinking', 'text': 'private'}, {'type': 'text', 'text': 'answer'}]}, 'usage': {'inputTokens': 8, 'outputTokens': 3, 'secret': 'private'}}), 'root')
    assert projected['text'] == 'answer' and projected['usage'] == {'inputTokens': 8, 'outputTokens': 3}
    assert 'private' not in json.dumps(projected)


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['timeout', 'cancel', 'budget'])
async def test_stopping_runtime_closes_sdk_process(monkeypatch, mode):
    import deepseek_harness
    from app.services.ai import harness_runtime as mod
    started, closed = threading.Event(), threading.Event()
    class Harness:
        def __init__(self, **kwargs): pass
        def start(self): pass
        def start_session(self, session_id): return self
        def __enter__(self): return self
        def __exit__(self, *args): self.close()
        def close(self): closed.set()
        def run(self, *args, **kwargs):
            started.set()
            assert closed.wait(5), 'SDK worker must not survive a stopped request'
            return SimpleNamespace(final_response='stopped', finish_reason='completed', events=[])
    monkeypatch.setattr(deepseek_harness, 'DeepSeekHarness', Harness)
    monkeypatch.setattr(mod, 'harness_options', lambda *args, **kwargs: {'initialize_timeout_seconds': .01, 'request_timeout_seconds': .05})
    bridge = mod.PlatformBridge(USER, {}, {})
    monkeypatch.setitem(mod.BRIDGES, 'test-stop-token', bridge)
    task = asyncio.create_task(mod.run_sdk({}, USER, 'test', 'test', token='test-stop-token'))
    assert await asyncio.to_thread(started.wait, 1)
    if mode == 'cancel':
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
    else:
        if mode == 'budget':
            bridge.stop_reason = '工具预算耗尽'; bridge.stop_event.set()
        with pytest.raises(mod.HarnessRunStopped): await task
    assert closed.is_set()


@pytest.mark.asyncio
async def test_tool_budget_signals_process_stop(monkeypatch):
    from app.services.ai import harness_runtime as mod, agent_registry
    monkeypatch.setattr(mod, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: {'safetyPolicy': {'maxToolSteps': 1}})
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock())
    tool = SimpleNamespace(name='test.query', handler_key='forms.query_records')
    monkeypatch.setattr(mod, 'tool_registry', lambda: {'test.query': tool})
    monkeypatch.setattr(mod, 'decide_tool_permission', lambda *args: SimpleNamespace(allowed=True))
    bridge = mod.PlatformBridge(USER, {}, {}, calls=1)
    result = await bridge.call_tool(mod.tool_alias(tool.name), {})
    assert result['status'] == 'blocked' and bridge.stop_event.is_set() and bridge.calls == 1


@asynccontextmanager
async def model_server(wait_event=None, entered=None, fail_first=False, setup=None):
    calls = []
    app = FastAPI()
    @app.post('/v1/chat/completions')
    async def model(request: Request):
        body = await request.json(); calls.append(body)
        if fail_first and len(calls) == 1:
            return JSONResponse({'error': {'message': 'temporary test outage'}}, status_code=503)
        if entered: entered.set()
        if wait_event: await wait_event.wait()
        async def chunks():
            for delta, finish in [({'role': 'assistant', 'content': 'summary OK'}, None), ({}, 'stop')]:
                yield 'data: ' + json.dumps({'id': 'test', 'object': 'chat.completion.chunk', 'created': 0, 'model': body['model'], 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}], 'usage': {'prompt_tokens': 900, 'completion_tokens': 3, 'total_tokens': 903}}) + '\n\n'
            yield 'data: [DONE]\n\n'
        return StreamingResponse(chunks(), media_type='text/event-stream')
    if setup: setup(app)
    sock = socket.socket(); sock.bind(('127.0.0.1', 0))
    url = f'http://127.0.0.1:{sock.getsockname()[1]}/v1'
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off'))
    task = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        for _ in range(100):
            if server.started: break
            await asyncio.sleep(.01)
        yield url, calls
    finally:
        server.should_exit = True
        await task
        sock.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['openai-compatible', 'deepseek', 'openai', 'glm', 'qwen'])
async def test_provider_selection_reaches_real_sdk_wire(monkeypatch, tmp_path, provider):
    from app.services.ai.harness_runtime import run_sdk
    from app.services.ai.settings import merge_ai_settings
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    async with model_server() as (url, calls):
        data = merge_ai_settings({
            'modelServices': [{'id': 'custom', 'name': 'Custom', 'provider': provider,
                               'baseUrl': url, 'apiKey': 'local-test-key', 'retryCount': 0,
                               'models': [{'id': 'configured-model', 'inputTypes': ['text'],
                                           'maxTokens': 128, 'contextWindow': 8000}]}],
            'modelAssignments': {'chat': {'serviceId': 'custom', 'modelId': 'configured-model'},
                                 'reasoning': None, 'document': None},
        })
        result = await run_sdk(data, USER, 'Reply OK', 'provider-smoke', purpose='chat')
        assert result.finish_reason == 'completed' and result.final_response == 'summary OK'
        assert len(calls) == 1
        assert calls[0]['model'] == 'configured-model' and calls[0]['max_tokens'] == 128


@pytest.mark.asyncio
async def test_real_sdk_emits_usage_and_native_compaction(monkeypatch, tmp_path):
    from app.services.ai.harness_runtime import run_sdk
    from app.services.ai.settings import merge_ai_settings
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    async with model_server() as (url, calls):
        data = merge_ai_settings({'baseUrl': url, 'apiKey': 'local-test-key', 'provider': 'openai-compatible', 'chatModel': 'test-model', 'reasoningModel': 'test-model', 'maxTokens': 128,
            'harnessPolicy': {'contextWindow': 2000, 'request_timeout_seconds': 10, 'compaction': {'enabled': True, 'thresholdRatio': .2, 'retainRatio': .01}}})
        from deepseek_harness import DeepSeekHarness
        from app.services.ai.harness_runtime import harness_options, native_notification_payload
        progress = []
        def execute():
            options = harness_options(data, USER)
            with DeepSeekHarness(**options) as harness:
                harness.run('Business record context: ' + 'record data ' * 500, session_id='compaction-test')
                def collect(notification):
                    payload = native_notification_payload(notification, 'compaction-test')
                    if payload: progress.append(payload)
                result = harness.run('Continue the business record review', session_id='compaction-test', on_notification=collect)
                return result
        result = await asyncio.to_thread(execute)
        assert result.finish_reason == 'completed'
        assert any(payload.get('usage', {}).get('inputTokens') for payload in progress)
        assert any(payload.get('phase') == 'compaction/end' for payload in progress)
        assert len(calls) >= 3  # two conversation calls plus native summarization


def test_effective_preview_requires_admin_and_redacts_keys(monkeypatch):
    from fastapi.testclient import TestClient
    from app.api import ai_assistant as api
    from app.api.deps import get_current_user
    monkeypatch.setattr(api, '_load_effective_ai_settings', AsyncMock())
    app = FastAPI(); app.include_router(api.router, prefix='/ai')
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as client:
        response = client.post('/ai/settings/effective', json={'settings': {'apiKey': 'never-return-this-key', 'chatModel': 'test-model'}})
        assert response.status_code == 200
        assert 'never-return-this-key' not in response.text
        assert len(response.json()['routes']) == 3
        assert response.json()['runtime']['sdkVersion'] == '0.2.1rc2'
        bad = client.post('/ai/settings/effective', json={'settings': {'harnessPolicy': {'compaction': {'headroomTokens': 99999}}}})
        assert bad.status_code == 422
        app.dependency_overrides[get_current_user] = lambda: {'tenant_id': 1, 'sub': 'reader', 'is_admin': False}
        assert client.post('/ai/settings/effective', json={'settings': {}}).status_code == 403


@pytest.mark.asyncio
async def test_cancellation_terminates_real_sdk_runtime(monkeypatch, tmp_path):
    import deepseek_harness
    from app.services.ai.harness_runtime import run_sdk
    from app.services.ai.settings import merge_ai_settings
    entered, release = asyncio.Event(), asyncio.Event()
    original = deepseek_harness.DeepSeekHarness
    instances = []
    def create(**kwargs):
        harness = original(**kwargs); instances.append(harness); return harness
    monkeypatch.setattr(deepseek_harness, 'DeepSeekHarness', create)
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    async with model_server(wait_event=release, entered=entered) as (url, _):
        data = merge_ai_settings({'baseUrl': url, 'apiKey': 'local-test-key', 'chatModel': 'test-model', 'harnessPolicy': {'request_timeout_seconds': 5}})
        task = asyncio.create_task(run_sdk(data, USER, 'cancel this run', 'cancel-test'))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 5)
            process = instances[0].client._proc
            assert process is None or process.poll() is not None
        finally:
            release.set()
            if not task.done():
                task.cancel(); await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_sdk_initialization_failure_still_closes_spawned_process(monkeypatch):
    import deepseek_harness
    from app.services.ai import harness_runtime as mod
    closed = threading.Event()
    class BrokenStartup:
        def __init__(self, **kwargs): pass
        def start(self): raise ValueError('invalid adapter setting')
        def close(self): closed.set()
    monkeypatch.setattr(deepseek_harness, 'DeepSeekHarness', BrokenStartup)
    monkeypatch.setattr(mod, 'harness_options', lambda *args, **kwargs: {'initialize_timeout_seconds': 1, 'request_timeout_seconds': 1})
    with pytest.raises(ValueError, match='invalid adapter setting'):
        await mod.run_sdk({}, USER, 'test', 'init-failure')
    assert closed.is_set()


@pytest.mark.asyncio
@pytest.mark.parametrize('retries', [0, 1])
async def test_real_sdk_retry_policy_controls_wire_attempts(monkeypatch, tmp_path, retries):
    from app.services.ai.harness_runtime import run_sdk
    from app.services.ai.settings import merge_ai_settings
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    async with model_server(fail_first=True) as (url, calls):
        data = merge_ai_settings({'baseUrl': url, 'apiKey': 'local-test-key', 'chatModel': 'test-model', 'retryCount': retries, 'harnessPolicy': {'request_timeout_seconds': 10}})
        events = []
        async def emit(event, payload): events.append(payload)
        result = await run_sdk(data, USER, 'reply OK', 'retry-test', event_sink=emit)
        assert len(calls) == retries + 1
        assert result.finish_reason == ('completed' if retries else 'error')
        assert any(item.get('phase') == 'llm/retry' for item in events) is bool(retries)


@pytest.mark.asyncio
async def test_browser_stream_disconnect_closes_real_sdk(monkeypatch, tmp_path):
    import deepseek_harness
    import httpx
    from app.api import ai_assistant as api
    from app.api.deps import get_current_user
    from app.services.ai.harness_runtime import run_sdk
    from app.services.ai.settings import merge_ai_settings
    from app.services.ai.schemas import AgentResponse
    loop = asyncio.get_running_loop()
    entered, release, closed = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original = deepseek_harness.DeepSeekHarness
    def create(**kwargs):
        harness = original(**kwargs)
        close = harness.close
        def observed_close():
            close(); loop.call_soon_threadsafe(closed.set)
        harness.close = observed_close
        return harness
    monkeypatch.setattr(deepseek_harness, 'DeepSeekHarness', create)
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    def setup(app):
        app.include_router(api.router, prefix='/ai')
        app.dependency_overrides[get_current_user] = lambda: USER
    async with model_server(wait_event=release, entered=entered, setup=setup) as (url, _):
        settings = merge_ai_settings({'baseUrl': url, 'apiKey': 'local-test-key', 'chatModel': 'test-model', 'harnessPolicy': {'request_timeout_seconds': 5}})
        async def execute(body, current_user, event_sink=None):
            result = await run_sdk(settings, current_user, body.message, 'disconnect-test', event_sink=event_sink)
            return AgentResponse(answer=result.final_response)
        monkeypatch.setattr(api, '_run_agent_for_user', execute)
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                async with client.stream('POST', url.replace('/v1', '/ai/agent/stream'), json={'message': 'disconnect test'}) as response:
                    assert response.status_code == 200
                    chunks = response.aiter_bytes()
                    await chunks.__anext__()
                    await asyncio.wait_for(entered.wait(), 5)
                await asyncio.wait_for(closed.wait(), 5)
        finally:
            release.set()
