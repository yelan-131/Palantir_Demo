"""Configuration must control the active Harness and the mandatory tool boundary."""
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest


def test_low_code_scope_controls_both_application_lookup_and_confirmed_creation():
    from app.services.ai.policies import decide_tool_permission
    from app.services.ai.settings import merge_ai_settings
    user = {'tenant_id': 1, 'sub': 'scope-test', 'is_admin': True}
    settings = merge_ai_settings({'agentMode': 'confirm', 'domains': ['quality']})
    tools = ['platform.application_settings.query', 'forms.create_form_definition']
    for tool in tools:
        assert not decide_tool_permission(user, settings, tool).allowed
    opened = merge_ai_settings({'domains': ['quality', 'low-code']}, existing=settings)
    assert decide_tool_permission(user, opened, tools[0]).allowed
    creation = decide_tool_permission(user, opened, tools[1])
    assert creation.allowed and creation.requires_confirmation
from fastapi import HTTPException, FastAPI
from fastapi.testclient import TestClient

USER = {'sub': 'configuration-test', 'uid': 1, 'tenant_id': 1, 'is_admin': True, 'roles': ['admin']}


def config(**changes):
    from app.services.ai.settings import settings_snapshot
    result = settings_snapshot()
    result.update(aiEnabled=True, qaEnabled=True, assistEnabled=True, agentMode='confirm')
    result.pop('domains', None)
    result.update(changes)
    return result


@pytest.mark.parametrize('changes,capability', [({'aiEnabled': False}, 'qa'), ({'agentMode': 'off'}, 'qa'), ({'qaEnabled': False}, 'business_query'), ({'assistEnabled': False}, 'config'), ({'agentMode': 'readonly'}, 'draft')])
def test_disabled_capabilities_are_denied_even_for_admin(changes, capability):
    from app.services.ai.policies import decide_ai_permission
    assert not decide_ai_permission(USER, config(**changes), capability).allowed


def test_admin_role_can_be_disabled_and_draft_mode_cannot_write_configuration():
    from app.services.ai.policies import decide_tool_permission, decide_ai_permission
    settings = config(rolePolicies=[{'role': 'admin', 'enabled': False, 'capabilities': ['qa']}])
    assert not decide_ai_permission(USER, settings, 'qa').allowed
    assert not decide_tool_permission(USER, config(agentMode='draft'), 'forms.create_form_definition').allowed
    assert decide_tool_permission(USER, config(agentMode='draft'), 'forms.create_dynamic_record_draft').allowed
    assert not decide_tool_permission(USER, config(agentMode='readonly'), 'forms.create_dynamic_record_draft').allowed


@pytest.mark.asyncio
async def test_ask_rule_stops_read_handler_until_confirmed(monkeypatch):
    from app.services.ai.tool_envelope import tool_execution_envelope
    settings = config()
    settings['safetyPolicy']['permissionRules'] = [{'action': 'ask', 'tool': 'forms.query_records'}]
    # The mandatory boundary survives removal of the optional hook.
    settings['safetyPolicy']['enabledHooks'] = []
    handler = AsyncMock(return_value={'records': [], 'record_count': 0})
    monkeypatch.setattr(tool_execution_envelope, '_dispatch', handler)
    result = await tool_execution_envelope.execute_tool(tool_name='forms.query_records', payload={'form_code': 'test'}, current_user=USER, settings=settings)
    assert result['status'] == 'waiting_confirmation'
    handler.assert_not_awaited()
    result = await tool_execution_envelope.execute_tool(tool_name='forms.query_records', payload={'form_code': 'test'}, current_user=USER, settings=settings, confirmed=True)
    assert result['status'] == 'completed'
    handler.assert_awaited_once()
    settings['aiEnabled'] = False
    result = await tool_execution_envelope.execute_tool(tool_name='forms.query_records', payload={'form_code': 'test'}, current_user=USER, settings=settings, confirmed=True)
    assert result['status'] == 'failed'
    assert handler.await_count == 1


@pytest.mark.asyncio
async def test_database_save_failure_is_reported_and_does_not_change_effective_settings(monkeypatch):
    from app.api import ai_assistant as api
    from app.services.ai.settings import settings_snapshot
    old = settings_snapshot()
    monkeypatch.setattr(api, 'save_persisted_ai_settings', AsyncMock(side_effect=RuntimeError('DB down')))
    with pytest.raises(HTTPException) as error:
        await api.update_ai_settings(api.AISettingsRequest(settings={'aiEnabled': False}), USER)
    assert error.value.status_code == 503
    assert settings_snapshot() == old


@pytest.mark.asyncio
async def test_connection_test_uses_draft_without_saving(monkeypatch):
    from types import SimpleNamespace
    from app.api import ai_assistant as api
    from app.services.ai import harness_runtime
    monkeypatch.setattr(api, '_load_effective_ai_settings', AsyncMock())
    save = AsyncMock()
    monkeypatch.setattr(api, 'save_persisted_ai_settings', save)
    run = AsyncMock(return_value=SimpleNamespace(finish_reason='completed', final_response='OK'))
    monkeypatch.setattr(harness_runtime, 'run_sdk', run)
    result = await api.test_saved_ai_settings(api.AISettingsRequest(settings={'apiKey': 'test-key', 'baseUrl': 'http://localhost:9000/v1', 'chatModel': 'draft-model'}), USER)
    assert result['ok']
    save.assert_not_awaited()
    assert run.call_args.args[0]['chatModel'] == 'draft-model'
    assert run.call_args_list[0].kwargs['model'] == 'draft-model'
    assert set(result['models']) == {call.kwargs['model'] for call in run.call_args_list}


def test_schema_migration_preserves_secrets_and_has_one_engine():
    from app.services.ai.settings import merge_ai_settings, mask_settings
    saved = merge_ai_settings({'api_key': 'test-key', 'ragEnabled': False, 'safetyPolicy': {'agentLoopMode': 'pipeline'}})
    assert saved['safetyPolicy']['agentLoopMode'] == 'harness'
    assert saved['ragPolicy']['enabled'] is False
    assert 'ragEnabled' not in saved
    assert saved['apiKey'] == 'test-key' and 'api_key' not in saved
    assert mask_settings(saved)['apiKey'] == '********'
    assert merge_ai_settings({'apiKey': '********'}, existing=saved)['apiKey'] == 'test-key'


@pytest.mark.parametrize('change', [{'aiEnabled': 'false'}, {'rolePolicies': 'admin'}, {'maxTokens': 'invalid'}, {'timeoutSeconds': -1}, {'retryCount': 9}, {'agentMode': 'automatic'}, {'ragPolicy': {'similarityThreshold': 2}}, {'contextPolicy': {'maxContextTokens': 0}}])
def test_invalid_settings_are_rejected(change):
    from app.services.ai.settings import merge_ai_settings
    with pytest.raises(ValueError):
        merge_ai_settings(change)


def test_tool_schemas_are_valid_and_writing_handlers_cannot_be_disguised():
    from app.services.ai.tool_registry import _normalize_input_schema
    from app.services.ai.agent_registry import validate_registry_payload, load_seed_registry, AgentRegistryError
    schema = _normalize_input_schema({'form_id': 'integer', 'fields': 'array', 'subject': 'users|roles'})
    assert schema['properties']['form_id'] == {'type': 'integer'}
    assert schema['properties']['fields']['items'] == {}
    assert schema['properties']['subject']['enum'] == ['users', 'roles']
    skills, tools = load_seed_registry()
    tools['forms.create_form_definition']['side_effect'] = 'read'
    with pytest.raises(AgentRegistryError):
        validate_registry_payload(skills, tools)


def test_legacy_chat_and_mcp_require_authorization():
    from app.api.ai_assistant import router
    from app.api.ai_harness import router as mcp_router
    app = FastAPI()
    app.include_router(router, prefix='/ai')
    app.include_router(mcp_router, prefix='/ai')
    with TestClient(app) as client:
        assert client.post('/ai/chat', json={'message': 'hello'}).status_code == 401
        assert client.post('/ai/harness/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}).status_code == 401


@pytest.mark.asyncio
async def test_orchestrator_calls_official_harness_instead_of_legacy_planner(monkeypatch):
    from app.services.ai import orchestrator
    from app.services.ai.schemas import AgentRequest, AgentResponse
    run = AsyncMock(return_value=AgentResponse(answer='Harness'))
    monkeypatch.setattr(orchestrator.harness_runtime, 'run', run)
    result = await orchestrator.run_agent(AgentRequest(message='hello'), USER)
    assert result.answer == 'Harness'
    run.assert_awaited_once()


@pytest.mark.asyncio
async def test_registry_deletion_and_disabling_survive_reload(monkeypatch):
    from app.database import init_db
    from app.services.ai.agent_registry import load_seed_registry, save_agent_registry_payload, load_agent_registry
    from app.services.ai import agent_definition
    # Dedicated SQLite test DB from conftest, never the live database.
    await init_db()
    previous_skills = agent_definition._RUNTIME_SKILL_REGISTRY
    previous_tools = agent_definition._RUNTIME_TOOL_REGISTRY
    try:
        skills, tools = load_seed_registry()
        original_skills, original_tools = deepcopy(skills), deepcopy(tools)
        await save_agent_registry_payload({'skills': skills, 'tools': tools}, seed_import=True)
        skills['low_code.create_form_definition']['enabled'] = False
        tools['forms.create_form_definition']['enabled'] = False
        await save_agent_registry_payload({'skills': skills, 'tools': tools})
        skills.pop('low_code.create_form_definition')
        for skill in skills.values():
            skill['allowed_tools'] = [name for name in skill.get('allowed_tools', []) if name != 'forms.create_form_definition']
            if skill.get('default_tool') == 'forms.create_form_definition':
                skill['default_tool'] = None
        tools.pop('forms.create_form_definition')
        tools['forms.get_record']['enabled'] = False
        await save_agent_registry_payload({'skills': skills, 'tools': tools})
        management = await load_agent_registry(include_disabled=True)
        assert management['tools']['forms.get_record']['enabled'] is False
        reloaded = await load_agent_registry()
        assert 'forms.create_form_definition' not in reloaded['tools']
        assert 'forms.get_record' not in reloaded['tools']
        assert 'low_code.create_form_definition' not in reloaded['skills']
    finally:
        await save_agent_registry_payload({'skills': original_skills, 'tools': original_tools}, seed_import=True)
        agent_definition._RUNTIME_SKILL_REGISTRY = previous_skills
        agent_definition._RUNTIME_TOOL_REGISTRY = previous_tools
        agent_definition.load_skill_registry.cache_clear()
        agent_definition.load_tool_registry.cache_clear()


@pytest.mark.asyncio
async def test_harness_proposal_writes_real_form_only_after_confirmation(monkeypatch):
    import uuid
    from sqlalchemy import select
    from app.database import init_db
    from app.core.db import db_session
    from app.models.relational import Form
    from app.services.ai import harness_runtime as mod
    from app.services.ai.agent_registry import seed_agent_registry_from_files
    from app.services.ai.agent_runs import create_agent_run, confirm_agent_run, AGENT_RUNS
    from app.services.ai.agent_items import extract_confirmation_payload
    from app.services.ai.schemas import AgentRequest, AgentResponse
    from app.services.ai.tool_executor import AgentToolExecutor
    await init_db()
    await seed_agent_registry_from_files()
    settings = config()
    monkeypatch.setattr(mod, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    code = 'harness_form_' + uuid.uuid4().hex[:8]
    bridge = mod.PlatformBridge(user=USER, settings=settings, context={})
    result = await bridge.call_tool(mod.tool_alias('forms.create_form_definition'), {'form': {'name': 'Harness Test', 'code': code}, 'fields': [{'field_name': 'name', 'label': 'Name', 'field_type': 'string'}]})
    assert result['status'] == 'waiting_confirmation'
    async with db_session() as session:
        assert await session.scalar(select(Form).where(Form.code == code)) is None
    response = AgentResponse(answer='Confirm', actions=bridge.pending, requires_confirmation=True, risk_level='high')
    run = create_agent_run(AgentRequest(message='create form'), response, USER)
    token = extract_confirmation_payload(run['items'])['confirmation_token']
    confirmed = confirm_agent_run(run['run_id'], token, USER)
    completed = await AgentToolExecutor().execute_confirmed_run(confirmed, current_user=USER, settings=settings, persist_ai_draft=AsyncMock(), update_ai_draft_status=AsyncMock(), audit_ai_event=None)
    assert completed['status'] == 'completed', completed['tool_results']
    async with db_session() as session:
        assert await session.scalar(select(Form).where(Form.code == code)) is not None
    AGENT_RUNS.pop(run['run_id'], None)


@pytest.mark.asyncio
async def test_confirmation_and_run_are_bound_to_tenant_even_with_same_username():
    from app.services.ai.agent_runs import create_agent_run, confirm_agent_run, cancel_agent_run, AGENT_RUNS
    from app.services.ai.agent_items import extract_confirmation_payload
    from app.services.ai.schemas import AgentRequest, AgentResponse, SkillAction
    from app.services.ai.confirmations import verify_confirmation_token
    user_one = {**USER, 'tenant_id': 1}
    user_two = {**USER, 'tenant_id': 2}
    response = AgentResponse(answer='Confirm', requires_confirmation=True, actions=[SkillAction(skill='forms.create_record_draft', title='Draft', payload={'_contract': {'tool': 'forms.create_dynamic_record_draft'}})])
    run = create_agent_run(AgentRequest(message='Draft'), response, user_one)
    token = extract_confirmation_payload(run['items'])['confirmation_token']
    with pytest.raises(ValueError):
        confirm_agent_run(run['run_id'], token, user_two)
    with pytest.raises(ValueError):
        cancel_agent_run(run['run_id'], user_two)
    with pytest.raises(ValueError):
        verify_confirmation_token(token, user=user_two)
    assert verify_confirmation_token(token, user=user_one)['status'] == 'pending'
    AGENT_RUNS.pop(run['run_id'], None)


@pytest.mark.asyncio
async def test_recovered_confirmation_is_claimed_once_in_database():
    import asyncio
    from app.database import init_db
    from app.api.ai_assistant import _persist_agent_turn, _load_persisted_agent_run_for_confirmation
    from app.services.ai.agent_runs import create_agent_run, AGENT_RUNS
    from app.services.ai.agent_items import extract_confirmation_payload
    from app.services.ai.schemas import AgentRequest, AgentResponse, SkillAction
    await init_db()
    import uuid
    from app.core.db import db_session
    from app.models.relational import AIConversation
    conversation_id = 'recovery-' + uuid.uuid4().hex
    async with db_session() as session:
        session.add(AIConversation(tenant_id=1, conversation_id=conversation_id, user_id=USER['sub'], title='Recovery', status='active', metadata_json={}))
        await session.commit()
    request = AgentRequest(message='Draft confirmation recovery', context={'conversation_id': conversation_id})
    response = AgentResponse(answer='Confirm', requires_confirmation=True, actions=[SkillAction(skill='forms.create_record_draft', title='Draft', payload={'_contract': {'tool': 'forms.create_dynamic_record_draft'}})])
    run = create_agent_run(request, response, USER)
    token = extract_confirmation_payload(run['items'])['confirmation_token']
    await _persist_agent_turn(request, response, USER)
    AGENT_RUNS.pop(run['run_id'], None)
    results = await asyncio.gather(*(_load_persisted_agent_run_for_confirmation(run['run_id'], token, USER) for _ in range(2)), return_exceptions=True)
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, ValueError) for result in results) == 1


def test_credentials_are_not_reused_across_server_origins(monkeypatch):
    from app.services.ai.settings import merge_ai_settings, settings_to_provider_config
    from app.config import settings as environment
    saved = config(apiKey='saved-secret', baseUrl='https://old.example/v1')
    changed = merge_ai_settings({'baseUrl': 'https://new.example/v1', 'apiKey': '********'}, existing=saved)
    assert changed['apiKey'] == ''
    same_origin = merge_ai_settings({'baseUrl': 'https://old.example/v2', 'apiKey': '********'}, existing=saved)
    assert same_origin['apiKey'] == 'saved-secret'
    monkeypatch.setattr(environment, 'AI_API_KEY', 'environment-secret')
    monkeypatch.setattr(environment, 'OPENAI_API_KEY', '')
    monkeypatch.setattr(environment, 'AI_BASE_URL', 'https://old.example/v1')
    assert settings_to_provider_config(changed).api_key == ''
    assert settings_to_provider_config({'baseUrl': 'https://old.example/v1', 'apiKey': ''}).api_key == 'environment-secret'
    assert settings_to_provider_config({'chatModel': 'custom-model', 'reasoningModel': ''}).reasoning_model == 'custom-model'


def test_ocr_enhancement_uses_saved_configuration_and_disable_switches(monkeypatch):
    from types import SimpleNamespace
    from app.services.ai import ocr_service, harness_runtime
    settings = config(baseUrl='https://vision.example/v1', apiKey='test-key', visionModel='configured-vision-model')
    calls = []
    def document_sdk(effective, content):
        calls.append((effective, content))
        assert content[1]['type'] == 'image' and content[1]['mimeType'] == 'image/png'
        return SimpleNamespace(finish_reason='completed', final_response='# Parsed', events=[])
    monkeypatch.setattr(ocr_service, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(harness_runtime, 'run_document_sdk', document_sdk)
    assert ocr_service.vision_extract_markdown('image.png', b'local-test-image')['model'] == 'configured-vision-model'
    assert calls[0][0]['visionModel'] == 'configured-vision-model'
    settings['visionModel'] = 'disabled'
    assert ocr_service.vision_extract_markdown('image.png', b'local-test-image') is None
    settings['visionModel'] = 'configured-vision-model'
    settings['aiEnabled'] = False
    assert ocr_service.vision_extract_markdown('image.png', b'local-test-image') is None
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_unconfigured_harness_run_is_failed_not_completed(monkeypatch):
    from app.services.ai import harness_runtime as runtime_module
    from app.services.ai.agent_items import agent_response_status
    from app.services.ai.agent_runs import create_agent_run
    from app.services.ai.schemas import AgentRequest
    monkeypatch.setattr(runtime_module, 'settings_snapshot', lambda: config(apiKey='', chatModel='local-disabled', rolePolicies=[{'role': 'admin', 'enabled': True, 'capabilities': ['qa']}]))
    request = AgentRequest(message='测试执行')
    user = USER
    response = await runtime_module.HarnessRuntime().run(request, user=user)
    assert agent_response_status(response) == 'failed'
    assert create_agent_run(request=request, response=response, user=user)['status'] == 'failed'
