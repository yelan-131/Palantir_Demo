import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
import json
import socket
import uuid

import pytest
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services.ai.settings import merge_ai_settings, mask_settings, settings_snapshot, settings_to_provider_config


def catalog():
    return {
        'modelServices': [
            {'id': 'chat-server', 'name': '对话服务', 'baseUrl': 'https://chat.example/v1', 'apiKey': 'chat-secret', 'retryCount': 0, 'models': [{'id': 'same-model', 'inputTypes': ['text'], 'maxTokens': 128, 'contextWindow': 8000}]},
            {'id': 'reason-server', 'name': '推理和文档服务', 'baseUrl': 'https://reason.example/v1', 'apiKey': 'reason-secret', 'retryCount': 1, 'streamIdleTimeoutMs': 12000, 'models': [{'id': 'same-model', 'inputTypes': ['text', 'image'], 'maxTokens': 256, 'contextWindow': 16000, 'reasoningEffort': 'low'}]},
        ],
        'modelAssignments': {'chat': {'serviceId': 'chat-server', 'modelId': 'same-model'}, 'reasoning': {'serviceId': 'reason-server', 'modelId': 'same-model'}, 'document': {'serviceId': 'reason-server', 'modelId': 'same-model'}},
        'harnessPolicy': {'compaction': {'enabled': False}},
    }


def test_legacy_migration_and_masked_credentials_are_service_scoped():
    legacy = {**settings_snapshot(), 'apiKey': 'legacy-secret', 'baseUrl': 'https://legacy.example/v1'}
    public = mask_settings(legacy)
    assert 'legacy-secret' not in json.dumps(public)
    migrated = merge_ai_settings(public, existing=legacy)
    assert settings_to_provider_config(migrated).api_key == 'legacy-secret'
    settings = merge_ai_settings(catalog())
    public = mask_settings(settings)
    assert 'chat-secret' not in json.dumps(public) and 'reason-secret' not in json.dumps(public)
    assert settings_to_provider_config(merge_ai_settings(public, existing=settings), purpose='reasoning').api_key == 'reason-secret'
    public['modelServices'][1]['baseUrl'] = 'https://changed.example/v1'
    changed = merge_ai_settings(public, existing=settings)
    assert settings_to_provider_config(changed).api_key == 'chat-secret'
    assert settings_to_provider_config(changed, purpose='reasoning').api_key == ''


def test_purpose_resolution_fallback_and_native_parameters():
    from app.services.ai.harness_runtime import harness_options
    settings = merge_ai_settings(catalog())
    user = {'tenant_id': 1, 'sub': 'catalog-tests'}
    chat = harness_options(settings, user, purpose='chat')
    reason = harness_options(settings, user, purpose='reasoning')
    assert chat['env']['MF_DSH_KEY'] == 'chat-secret'
    assert reason['env']['MF_DSH_KEY'] == 'reason-secret'
    assert chat['max_tokens'] == 128 and reason['max_tokens'] == 256
    route = json.loads(reason['env']['MF_DSH_PROVIDER_CONFIG'])['providers']['manufoundry']
    assert route['baseURL'] == 'https://reason.example/v1'
    assert route['models'][0]['contextWindow'] == 16000
    assert route['retryPolicy']['maxRetries'] == 1 and route['streamIdleTimeoutMs'] == 12000
    assert reason['reasoning_effort'] == 'low'
    assert settings['memoryPolicy']['enabled'] is False and settings['compactionPolicy']['enabled'] is False
    settings['modelAssignments']['reasoning'] = None
    assert settings_to_provider_config(settings, purpose='reasoning').base_url == 'https://chat.example/v1'
    settings['modelAssignments']['document'] = None
    assert settings_to_provider_config(settings, purpose='document').vision_model == 'disabled'


def test_retired_summary_flag_cannot_disable_native_compaction():
    settings = merge_ai_settings({'compactionPolicy': {'enabled': False}}, existing={})
    assert settings['harnessPolicy']['compaction']['enabled'] is True
    settings = merge_ai_settings({'harnessPolicy': {'compaction': {'enabled': False}}}, existing=settings)
    assert settings['harnessPolicy']['compaction']['enabled'] is False


@pytest.mark.parametrize('mutation', ['missing-service', 'missing-model', 'text-document', 'duplicate-id', 'bad-url', 'bad-limit'])
def test_invalid_catalog_never_silently_falls_back(mutation):
    data = catalog()
    if mutation == 'missing-service': data['modelServices'].pop()
    if mutation == 'missing-model': data['modelAssignments']['chat']['modelId'] = 'removed'
    if mutation == 'text-document': data['modelAssignments']['document']['serviceId'] = 'chat-server'
    if mutation == 'duplicate-id': data['modelServices'][1]['id'] = 'chat-server'
    if mutation == 'bad-url': data['modelServices'][0]['baseUrl'] = 'file:///secret'
    if mutation == 'bad-limit': data['modelServices'][0]['models'][0]['contextWindow'] = 64
    with pytest.raises(ValueError): merge_ai_settings(data)


@pytest.mark.asyncio
async def test_catalog_persist_encrypt_reload_and_update(monkeypatch):
    import app.core.db as db
    import app.services.ai.settings as mod
    from app.models.relational import SystemSetting
    from app.services.ai.credential_store import PREFIX
    monkeypatch.setenv('AI_SETTINGS_ENCRYPTION_KEY', 'catalog-isolated-encryption-test-key-12345678')
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as conn:
        await conn.run_sync(SystemSetting.__table__.create)
    @asynccontextmanager
    async def session_scope():
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
    monkeypatch.setattr(db, 'db_session', session_scope)
    original = deepcopy(mod.AI_SYSTEM_SETTINGS)
    try:
        saved = await mod.save_persisted_ai_settings(catalog())
        async with session_scope() as session:
            stored = (await session.scalar(select(SystemSetting))).value
            assert all(s['apiKey'].startswith(PREFIX) for s in stored['modelServices'])
            assert 'reason-secret' not in json.dumps(stored) and 'chat-secret' not in json.dumps(stored)
        public = mask_settings(saved)
        public['modelServices'][1]['models'][0]['maxTokens'] = 384
        await mod.save_persisted_ai_settings(public)
        reloaded = await mod.load_persisted_ai_settings(strict=True)
        assert settings_to_provider_config(reloaded, purpose='reasoning').api_key == 'reason-secret'
        from app.services.ai.model_catalog import resolve_model_settings
        assert resolve_model_settings(reloaded, 'reasoning')['maxTokens'] == 384
    finally:
        mod.AI_SYSTEM_SETTINGS.clear(); mod.AI_SYSTEM_SETTINGS.update(original)
        await engine.dispose()


@pytest.mark.asyncio
async def test_real_sdk_and_document_requests_reach_separate_services(monkeypatch, tmp_path):
    from app.services.ai.harness_runtime import run_sdk
    from app.services.ai.ocr_service import vision_extract_markdown
    from app.api.ai_assistant import _test_catalog_settings
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    calls = []
    servers, tasks, sockets = [], [], []
    urls = []
    for label in ('chat', 'reason'):
        app = FastAPI()
        def endpoint_for(service_name):
            async def model(request: Request):
                body = await request.json()
                calls.append((service_name, request.headers.get('authorization'), body))
                if not body.get('stream'):
                    return {'model': body['model'], 'choices': [{'message': {'content': 'document OK'}}]}
                async def stream():
                    for delta, finish in [({'role': 'assistant', 'content': service_name + ' OK'}, None), ({}, 'stop')]:
                        yield 'data: ' + json.dumps({'id': 'test', 'object': 'chat.completion.chunk', 'created': 0, 'model': body['model'], 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}) + '\n\n'
                    yield 'data: [DONE]\n\n'
                return StreamingResponse(stream(), media_type='text/event-stream')
            return model
        app.post('/v1/chat/completions')(endpoint_for(label))
        sock = socket.socket(); sock.bind(('127.0.0.1', 0)); sockets.append(sock)
        urls.append(f'http://127.0.0.1:{sock.getsockname()[1]}/v1')
        server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off'))
        servers.append(server); tasks.append(asyncio.create_task(server.serve(sockets=[sock])))
    try:
        for _ in range(200):
            if all(s.started for s in servers): break
            await asyncio.sleep(.01)
        data = catalog()
        for service, url in zip(data['modelServices'], urls): service['baseUrl'] = url
        settings = merge_ai_settings(data)
        user = {'tenant_id': 1, 'sub': 'catalog-test'}
        result = await run_sdk(settings, user, 'reply OK', uuid.uuid4().hex, purpose='chat')
        assert 'chat OK' in result.final_response
        result = await run_sdk(settings, user, 'reply OK', uuid.uuid4().hex, purpose='reasoning')
        assert 'reason OK' in result.final_response
        import base64
        pixel = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
        result = await asyncio.to_thread(vision_extract_markdown, 'test.png', pixel, settings_data=settings)
        assert result['markdown'] == 'document OK'
        assert [c[0] for c in calls[:3]] == ['chat', 'reason', 'reason']
        assert calls[0][1] == 'Bearer chat-secret' and calls[1][1] == calls[2][1] == 'Bearer reason-secret'
        assert calls[0][2]['max_tokens'] == 128 and calls[1][2]['max_tokens'] == calls[2][2]['max_tokens'] == 256
        assert calls[1][2]['reasoning_effort'] == 'low'
        assert calls[2][2]['messages'][0]['content'][1]['type'] == 'image_url'
        assert (await _test_catalog_settings(settings, {'purpose': 'reasoning'}, user))['ok']
        assert (await _test_catalog_settings(settings, {'purpose': 'document'}, user))['ok']
        assert (await _test_catalog_settings(settings, {'serviceId': 'chat-server'}, user))['ok']
    finally:
        for server in servers: server.should_exit = True
        await asyncio.gather(*tasks)


@pytest.mark.asyncio
@pytest.mark.parametrize('purpose, expected', [('chat', 'chat-secret'), ('reasoning', 'reason-secret')])
async def test_agent_execution_uses_the_selected_purpose(monkeypatch, tmp_path, purpose, expected):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from app.services.ai import harness_runtime as runtime, agent_registry
    from app.services.ai.schemas import AgentRequest
    settings = merge_ai_settings(catalog())
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    monkeypatch.setattr(runtime, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock())
    monkeypatch.setattr(runtime.PlatformBridge, 'available_tools', lambda _: [])
    selected = []
    async def capture(effective, user, *_args, **kwargs):
        options = runtime.harness_options(effective, user, purpose=kwargs['purpose'])
        selected.append(options['env']['MF_DSH_KEY'])
        return SimpleNamespace(finish_reason='completed', final_response='OK', session_id='test')
    monkeypatch.setattr(runtime, 'run_sdk', capture)
    result = await runtime.HarnessRuntime().run(AgentRequest(message='hello', context={'_model_purpose': purpose}), user={'tenant_id': 1, 'sub': 'route-test', 'is_admin': True, 'roles': ['admin']})
    assert result.answer == 'OK' and selected == [expected]


@pytest.mark.asyncio
async def test_retired_memory_never_reads_writes_or_purges_even_with_old_enabled_settings():
    from unittest.mock import AsyncMock
    from app.services.ai.memory import MemoryService
    session = AsyncMock()
    service = MemoryService()
    old = {'memoryPolicy': {'enabled': True}, 'compactionPolicy': {'enabled': True}}
    assert await service.retrieve_context(session, tenant_id=1, settings=old) == []
    assert await service.compact_conversation(session, conversation=None, settings=old) is None
    assert await service.maybe_compact_conversation(session, conversation=None, settings=old, force=True) is None
    assert await service.append_turn_memory(session, conversation=None, run=None, user_message=None, assistant_message=None, evidence=[]) is None
    await service.purge_expired(session, old)
    session.execute.assert_not_called()
    session.add.assert_not_called()
