"""Regression tests for persisted settings at the real execution boundaries."""
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

USER = {'sub': 'settings-audit', 'tenant_id': 1, 'roles': ['admin'], 'is_admin': True}


def test_native_dsh_settings_reach_sdk_adapter_and_compaction(monkeypatch, tmp_path):
    from app.services.ai.settings import merge_ai_settings
    from app.services.ai.harness_runtime import harness_options
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    settings = merge_ai_settings({
        'apiKey': 'test-key', 'chatModel': 'dialogue', 'reasoningModel': 'reasoning',
        'maxTokens': 1024, 'retryCount': 3,
        'harnessPolicy': {'reasoning_effort': 'high', 'contextWindow': 32000,
            'streamIdleTimeoutMs': 45000, 'initialize_timeout_seconds': 15, 'request_timeout_seconds': 120,
            'compaction': {'enabled': True, 'thresholdRatio': .75, 'retainRatio': .15}},
        'compactionPolicy': {'enabled': False},
    })
    options = harness_options(settings, USER)
    route = json.loads(options['env']['MF_DSH_PROVIDER_CONFIG'])['providers']['manufoundry']
    assert options['reasoning_effort'] == 'high' and options['max_tokens'] == 1024
    assert options['initialize_timeout_seconds'] == 15 and options['request_timeout_seconds'] == 120
    assert route['streamIdleTimeoutMs'] == 45000 and route['retryPolicy']['maxRetries'] == 3
    assert route['models'][0]['contextWindow'] == 32000
    assert route['models'][0]['reasoningEfforts'] == {'high': 'high'}
    assert options['env']['MF_DSH_COMPACTION_THRESHOLD_RATIO'] == '0.75'
    assert options['env']['MF_DSH_COMPACTION_RETAIN_RATIO'] == '0.15'
    assert options['env']['MF_DSH_COMPACTION_ENABLED'] == 'true'
    assert harness_options(settings, USER, model='dialogue')['reasoning_effort'] is None
    changed = merge_ai_settings({'harnessPolicy': {'compaction': {'retainRatio': .1}}}, existing=settings)
    assert changed['harnessPolicy']['compaction']['thresholdRatio'] == .75
    assert changed['compactionPolicy']['enabled'] is False


@pytest.mark.parametrize('native', [
    {'initialize_timeout_seconds': 0}, {'request_timeout_seconds': -1},
    {'streamIdleTimeoutMs': 0}, {'contextWindow': 1000}, {'reasoning_effort': 'unknown'},
    {'compaction': {'thresholdRatio': .4, 'retainRatio': .5}},
    {'compaction': {'thresholdRatio': 1.2}}, {'compaction': {'enabled': 'false'}}, {'compaction': {'retainRatio': 0}},
])
def test_invalid_native_dsh_settings_are_rejected(native):
    from app.services.ai.settings import merge_ai_settings
    with pytest.raises(ValueError):
        merge_ai_settings({'maxTokens': 2048, 'harnessPolicy': native})


def test_partial_policy_update_preserves_saved_limits_and_blank_agent_uses_chat():
    from app.services.ai.settings import merge_ai_settings, settings_to_provider_config
    saved = merge_ai_settings({'memoryPolicy': {'enabled': True, 'retentionDays': 7, 'allowedTypes': ['fact']}, 'contextPolicy': {'maxContextTokens': 16000}})
    changed = merge_ai_settings({'memoryPolicy': {'recallLimit': 0}, 'contextPolicy': {'showContextSources': False}}, existing=saved)
    assert changed['memoryPolicy']['retentionDays'] == 7
    assert changed['memoryPolicy']['allowedTypes'] == ['fact']
    assert changed['memoryPolicy']['enabled'] is False
    assert changed['contextPolicy']['maxContextTokens'] == 16000
    deepseek = merge_ai_settings({'provider': 'deepseek', 'chatModel': 'custom-chat', 'reasoningModel': ''})
    assert settings_to_provider_config(deepseek).reasoning_model == 'custom-chat'


@pytest.mark.asyncio
async def test_zero_memory_recall_does_not_query_memories(monkeypatch):
    from app.services.ai.context_builder import ContextBuilder, memory_service
    from app.services.ai.schemas import AgentRequest
    builder = ContextBuilder()
    monkeypatch.setattr(builder, '_recent_messages', AsyncMock(return_value=[]))
    recall = AsyncMock()
    monkeypatch.setattr(memory_service, 'retrieve_context', recall)
    await builder.build(AsyncMock(), request=AgentRequest(message='test'), user=USER, settings={'memoryPolicy': {'enabled': True, 'recallLimit': 0}})
    recall.assert_not_awaited()


def test_budget_covers_semantic_context_and_arbitrary_client_fields():
    from app.services.ai.context_builder import ContextBuilder, estimate_tokens
    payload = {'semantic_context': {'records': [{'text': '中文业务数据' * 10000}]}, 'extra': 'x' * 50000, 'memories': [], 'recent_messages': [], 'evidence': []}
    before = deepcopy(payload)
    trimmed = ContextBuilder()._trim_to_budget(payload, 1000)
    assert estimate_tokens(trimmed) <= 1000
    assert payload == before


@pytest.mark.asyncio
async def test_harness_bounds_final_prompt_and_rejects_oversized_fixed_input(monkeypatch):
    from app.services.ai import harness_runtime as mod, agent_registry
    from app.services.ai.agent_items import agent_response_status
    from app.services.ai.context_builder import estimate_tokens
    from app.services.ai.schemas import AgentRequest
    from app.services.ai.settings import merge_ai_settings
    settings = merge_ai_settings({'apiKey': 'test-only-key', 'agentMode': 'confirm', 'chatModel': 'test', 'reasoningModel': 'test', 'contextPolicy': {'maxContextTokens': 12000}})
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock())
    run = AsyncMock(return_value=SimpleNamespace(finish_reason='completed', final_response='OK', session_id='test'))
    monkeypatch.setattr(mod, 'run_sdk', run)
    request = AgentRequest(message='test', context={'semanticContext': {'records': ['中文' * 50000]}, 'clientExtra': 'x' * 50000})
    response = await mod.HarnessRuntime().run(request, user=USER)
    assert agent_response_status(response) == 'completed'
    prompt = run.call_args.args[2]
    options = mod.harness_options(settings, USER, token='test')
    fixed = options['env']['DSH_SYSTEM_PROMPT'] + json.dumps(mod.PlatformBridge(USER, settings, {}).available_tools(), ensure_ascii=False)
    assert estimate_tokens(fixed + prompt) <= 12000
    run.reset_mock()
    response = await mod.HarnessRuntime().run(AgentRequest(message='中文' * 50000), user=USER)
    assert agent_response_status(response) == 'failed'
    assert '预算' in response.answer
    run.assert_not_awaited()


@pytest.mark.asyncio
async def test_retired_memory_preserves_historical_entries_without_recalling_or_summarizing():
    from app.models.relational import Base, AIMemoryEntry, AIConversation, AIMessage
    from app.services.ai.memory import MemoryService
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    service = MemoryService()
    settings = {'memoryPolicy': {'enabled': True, 'retentionDays': 30, 'allowedTypes': ['fact']}, 'compactionPolicy': {'enabled': True}}
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            now = datetime.utcnow()
            def memory(name, kind='fact', days=0, **extra):
                return AIMemoryEntry(memory_id=name, tenant_id=1, user_key=USER['sub'], key=name, memory_type=kind, summary=name, value={}, status='active', created_at=now-timedelta(days=days), **extra)
            session.add_all([memory('old', days=31), memory('expired', expires_at=now-timedelta(seconds=1)), memory('fact'), memory('summary', 'summary')])
            await session.commit()
            recalled = await service.retrieve_context(session, tenant_id=1, user_key=USER['sub'], settings=settings)
            assert recalled == []
            assert await service.retrieve_context(session, tenant_id=1, user_key=USER['sub'], settings=settings, limit=0) == []
            listed = await service.list_user_memories(session, tenant_id=1, user_key=USER['sub'], settings=settings)
            assert {row['memory_id'] for row in listed} == {'fact', 'summary'}
            await service.purge_expired(session, settings)
            await session.commit()
            assert set((await session.scalars(select(AIMemoryEntry.memory_id))).all()) == {'old', 'expired', 'fact', 'summary'}
            conversation = AIConversation(conversation_id='no-summary', tenant_id=1, user_id=USER['sub'], title='test')
            session.add(conversation)
            session.add_all([AIMessage(message_id=f'm{i}', tenant_id=1, conversation_id='no-summary', role='user', content='test') for i in range(2)])
            await session.commit()
            assert await service.compact_conversation(session, conversation=conversation, settings=settings, tenant_id=1) is None
            settings['memoryPolicy']['allowedTypes'] = ['summary']
            result = await service.compact_conversation(session, conversation=conversation, settings=settings, tenant_id=1)
            assert result is None
    finally:
        await engine.dispose()


def test_forbidden_action_categories_match_tool_and_handler_names():
    from app.services.ai.policies import action_is_forbidden, decide_tool_permission
    from app.services.ai.settings import merge_ai_settings
    settings = merge_ai_settings({'agentMode': 'confirm', 'forbiddenActions': ['auto_order', 'delete_data', 'change_permission', 'publish_config']})
    assert action_is_forbidden(settings, 'custom.delete_record')
    assert action_is_forbidden(settings, 'custom.change_permission')
    assert action_is_forbidden(settings, 'custom.auto_order')
    assert not decide_tool_permission(USER, settings, 'forms.create_form_definition').allowed
    assert decide_tool_permission(USER, settings, 'forms.query_records').allowed


@pytest.mark.asyncio
async def test_context_source_toggle_hides_events_and_history_items(monkeypatch):
    from app.api import ai_assistant as api
    from app.services.ai.schemas import AgentRequest, AgentResponse
    from app.services.ai.settings import merge_ai_settings
    settings = merge_ai_settings({'contextPolicy': {'showContextSources': False}})
    monkeypatch.setattr(api, 'AI_SYSTEM_SETTINGS', settings)
    monkeypatch.setattr(api, '_load_effective_ai_settings', AsyncMock())
    monkeypatch.setattr(api.agent_context_router, 'classify', lambda *_: 'general')
    monkeypatch.setattr(api, 'run_agent', AsyncMock(side_effect=lambda *_args, **_kwargs: AgentResponse(answer='OK')))
    monkeypatch.setattr(api, '_audit_ai_event', lambda *_: None)
    events = AsyncMock()
    result = await api._run_agent_for_user(AgentRequest(message='test'), USER, event_sink=events)
    assert not any(item.get('type') == 'context' for item in result.items)
    assert not any(call.args[0] == 'item.updated' and call.args[1].get('type') == 'context' for call in events.call_args_list)
    settings['contextPolicy']['showContextSources'] = True
    result = await api._run_agent_for_user(AgentRequest(message='test'), USER)
    assert any(item.get('type') == 'context' for item in result.items)


@pytest.mark.asyncio
async def test_credentials_encrypted_in_database_and_masked_update_preserves_key(monkeypatch):
    from app.core import db
    from app.models.relational import Base, SystemSetting
    from app.services.ai import settings as mod
    from app.services.ai.credential_store import PREFIX, protect_credentials, reveal_credentials
    monkeypatch.setenv('AI_SETTINGS_ENCRYPTION_KEY', 'test-encryption-key-for-settings-only-123456')
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    @asynccontextmanager
    async def session_scope():
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
    monkeypatch.setattr(db, 'db_session', session_scope)
    monkeypatch.setattr(mod, '_SYSTEM_SETTINGS_TABLE_ENSURED', True)
    original = mod.settings_snapshot()
    try:
        await mod.save_persisted_ai_settings({'apiKey': 'only-test-secret', 'baseUrl': 'https://test.example/v1', 'harnessPolicy': {'initialize_timeout_seconds': 17, 'streamIdleTimeoutMs': 300000, 'compaction': {'enabled': False, 'thresholdRatio': .7, 'retainRatio': .1}}})
        async with session_scope() as session:
            stored = (await session.scalar(select(SystemSetting))).value
            assert stored['apiKey'].startswith(PREFIX)
            assert 'only-test-secret' not in json.dumps(stored)
        await mod.save_persisted_ai_settings({'apiKey': '********', 'maxTokens': 512})
        reloaded = await mod.load_persisted_ai_settings(strict=True)
        assert reloaded['apiKey'] == 'only-test-secret'
        assert reloaded['harnessPolicy']['initialize_timeout_seconds'] == 17
        assert reloaded['harnessPolicy']['streamIdleTimeoutMs'] == 300000
        assert reloaded['harnessPolicy']['compaction'] == {'enabled': False, 'thresholdRatio': .7, 'retainRatio': .1}
        assert mod.mask_settings(reloaded)['apiKey'] == '********'
        async with session_scope() as session:
            record = await session.scalar(select(SystemSetting))
            record.value = {**record.value, 'apiKey': 'legacy-test-secret'}
            await session.commit()
        assert (await mod.load_persisted_ai_settings(strict=True))['apiKey'] == 'legacy-test-secret'
        async with session_scope() as session:
            assert (await session.scalar(select(SystemSetting))).value['apiKey'].startswith(PREFIX)
        encrypted = protect_credentials({'apiKey': 'test'})
        monkeypatch.setenv('AI_SETTINGS_ENCRYPTION_KEY', 'different-test-key-for-settings-only-123456')
        with pytest.raises(RuntimeError, match='解密失败'):
            reveal_credentials(encrypted)
    finally:
        mod.AI_SYSTEM_SETTINGS.clear()
        mod.AI_SYSTEM_SETTINGS.update(original)
        await engine.dispose()
