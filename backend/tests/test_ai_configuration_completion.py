from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

@pytest.fixture
def runtime(monkeypatch):
    from app.services.ai import harness_runtime as mod, agent_registry
    from app.services.ai.settings import merge_ai_settings
    settings = merge_ai_settings({'apiKey': 'test-key', 'agentMode': 'confirm', 'chatModel': 'test',
        'reasoningModel': 'test', 'contextPolicy': {'maxContextTokens': 24000}})
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock(return_value=dict(zip(('skills', 'tools'), agent_registry.load_seed_registry()))))
    monkeypatch.setattr(mod, 'load_persisted_ai_settings', AsyncMock())
    return mod, settings


USER = {'tenant_id': 1, 'sub': 'completion-test', 'is_admin': True, 'roles': ['admin']}


def result(text='已准备好配置', finish='completed'):
    return SimpleNamespace(final_response=text, finish_reason=finish, session_id='test',
        events=[{'type': 'assistant/message', 'data': {'usage': {'totalTokens': 10}}}])


def proposal():
    from app.services.ai.schemas import SkillAction
    return SkillAction(skill='forms.create_form_definition', title='新建表单', risk_level='high',
        payload={'form': {'name': '入库单', 'code': 'inbound'}, 'fields': []}, requires_confirmation=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('has_pending', [False, True])
async def test_output_limit_preserves_prepared_actions_without_retry(runtime, monkeypatch, has_pending):
    mod, settings = runtime
    from app.services.ai.schemas import AgentRequest
    async def run(*args, **kwargs):
        if has_pending:
            mod.BRIDGES[kwargs['token']].pending.append(proposal())
        return result('截断的回复', finish='max-tokens')
    runner = AsyncMock(side_effect=run)
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message='帮我创建入库表单'), user=USER)
    assert runner.await_count == 1
    assert response.requires_confirmation is has_pending
    assert len(response.actions) == int(has_pending)
    if has_pending:
        assert response.risk_level == 'high'
        assert '后续操作可能尚未生成' in response.answer
    else:
        assert str(settings['maxTokens']) in response.answer
        assert response.items[-1]['status'] == 'failed'


@pytest.mark.asyncio
@pytest.mark.parametrize('message,answer', [
    ('刚才那张表有哪些必填项？', '产品编码和产品名称。'),
    ('帮我看看有哪些已经发布的应用。', '生产巡检。'),
    ('你好，回一句你好。', '你好。'),
    ('帮我把新品登记弄到 MDM 里。', '找到了两个可能的应用，请选择。'),
])
async def test_conversation_does_not_force_write_or_retry(runtime, monkeypatch, message, answer):
    mod, settings = runtime
    from app.services.ai.schemas import AgentRequest
    settings['agentMode'] = 'draft'
    runner = AsyncMock(return_value=result(answer))
    monkeypatch.setattr(mod, 'run_sdk', runner)

    response = await mod.HarnessRuntime().run(AgentRequest(
        message=message, context={'pageControlsSupported': True, 'designerContext': {'form_id': 5}},
    ), user=USER, event_sink=AsyncMock())

    runner.assert_awaited_once()
    assert response.answer == answer
    assert not response.actions


@pytest.mark.asyncio
async def test_deferred_tool_requires_discovery_and_live_permission(runtime, monkeypatch):
    mod, settings = runtime
    from app.services.ai.schemas import AgentRequest
    settings['domains'] = ['low-code']
    name = 'forms.publish_to_menu'

    async def run(*args, **kwargs):
        bridge = mod.BRIDGES[kwargs['token']]
        tools = {tool['name'] for tool in bridge.available_tools()}
        assert mod.tool_alias(name) not in tools
        assert mod.tool_alias('platform.application_settings.query') in tools
        invoke = {'name': name, 'arguments': {'form_id': 5, 'application_id': 2}}
        platform_call = AsyncMock(return_value={'status': 'waiting_confirmation'})
        monkeypatch.setattr(bridge, '_call_platform_tool', platform_call)
        assert (await bridge.call_tool(mod.tool_alias(name), invoke['arguments']))['status'] == 'blocked'
        assert (await bridge.call_tool(mod.tool_alias(mod.INVOKE_TOOL), invoke))['status'] == 'blocked'
        description = await bridge.call_tool(mod.tool_alias(mod.DESCRIBE_TOOL), {'name': name})
        assert description['tool']['inputSchema']['required'] == ['form_id', 'application_id']
        assert (await bridge.call_tool(mod.tool_alias(mod.INVOKE_TOOL), invoke))['status'] == 'waiting_confirmation'
        settings['agentMode'] = 'draft'
        assert (await bridge.call_tool(mod.tool_alias(mod.INVOKE_TOOL), invoke))['status'] == 'blocked'
        platform_call.assert_awaited_once_with(mod.tool_alias(name), invoke['arguments'])
        return result('等你确认后挂载。')

    monkeypatch.setattr(mod, 'run_sdk', run)
    response = await mod.HarnessRuntime().run(AgentRequest(message='把这张表放进 MDM。'), user=USER)
    assert response.answer == '等你确认后挂载。'


@pytest.mark.asyncio
async def test_page_receipt_survives_output_limit(runtime, monkeypatch):
    mod, settings = runtime
    from app.services.ai.schemas import AgentRequest
    settings['domains'] = ['low-code']

    async def run(*args, **kwargs):
        bridge = mod.BRIDGES[kwargs['token']]
        description = await bridge.call_tool(mod.tool_alias(mod.DESCRIBE_TOOL), {'name': 'ui.form_designer'})
        assert 'draft_new' in description['tool']['inputSchema']['properties']['action']['enum']
        bridge.configuration_outcome = {'status': 'ui_draft', 'reason': '已更新草稿'}
        return result('', finish='max-tokens')

    monkeypatch.setattr(mod, 'run_sdk', run)
    response = await mod.HarnessRuntime().run(AgentRequest(
        message='帮我搭个新品登记表。', context={'pageControlsSupported': True},
    ), user=USER, event_sink=AsyncMock())
    assert response.answer == '已更新草稿'
