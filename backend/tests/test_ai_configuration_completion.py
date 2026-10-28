from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.ai.configuration_completion import expects_configuration, REPORT_TOOL


@pytest.mark.parametrize('message,context,expected', [
    ('帮我创建入库表单，包含物料和数量', {}, True),
    ('按上表生成卡片', {}, True),
    ('按方案开始，下拉用默认，加上直接上级', {}, True),
    ('为什么没有生成确认卡片', {}, False),
    ('把数量字段改成必填', {}, True),
    ('帮我配置审批规则', {}, True),
    ('请帮我新建一个表', {}, True),
    ('改成必填', {'pendingActionState': {'skill': 'forms.create_form_definition'}}, True),
    ('Create a form for incoming inspections', {}, True),
    ('帮我创建表单', {'surface': 'knowledge'}, False),
    ('如何创建表单？', {}, False),
    ('这个表单怎么配置？', {}, False),
    ('配置是什么意思', {}, False),
    ('请问如何创建表单？', {}, False),
    ('不要创建表单，先聊一下', {}, False),
    ('取消刚才的配置', {}, False),
    ('Do not create a form', {}, False),
    ('这个页面是干什么的？', {}, False),
    ('你好', {}, False),
])
def test_configuration_intent_does_not_force_consultation_or_cancellation(message, context, expected):
    assert expects_configuration(message, context) is expected


@pytest.fixture
def runtime(monkeypatch):
    from app.services.ai import harness_runtime as mod, agent_registry
    from app.services.ai.settings import merge_ai_settings
    settings = merge_ai_settings({'apiKey': 'test-key', 'agentMode': 'confirm', 'chatModel': 'test',
        'reasoningModel': 'test', 'contextPolicy': {'maxContextTokens': 24000}})
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock())
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
async def test_text_only_completion_recovers_once_and_returns_real_proposal(runtime, monkeypatch):
    mod, settings = runtime
    from app.services.ai.schemas import AgentRequest
    prompts, bridges = [], []
    async def run(*args, **kwargs):
        prompts.append(args[2])
        bridge = mod.BRIDGES[kwargs['token']]
        bridges.append(bridge)
        if len(prompts) == 2:
            bridge.pending.append(proposal())
        return result()
    monkeypatch.setattr(mod, 'run_sdk', run)
    sink = AsyncMock()
    response = await mod.HarnessRuntime().run(AgentRequest(message='帮我创建入库表单'), user=USER, event_sink=sink)
    assert len(prompts) == 2
    assert bridges[0] is bridges[1]  # Retain tool counters and prepared actions.
    assert '唯一一次自动补做' in prompts[1]
    assert response.requires_confirmation and len(response.actions) == 1
    assert response.usage['totalTokens'] == 20
    assert not any(bridge is bridges[0] for bridge in mod.BRIDGES.values())
    assert any(call.args[0] == 'assistant.note' for call in sink.await_args_list)


@pytest.mark.asyncio
async def test_persistent_text_only_reply_cannot_claim_a_card_exists(runtime, monkeypatch):
    mod, _ = runtime
    from app.services.ai.schemas import AgentRequest
    from app.services.ai.agent_items import agent_response_status
    runner = AsyncMock(return_value=result('已生成卡片，已经配置成功'))
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message='帮我创建入库表单'), user=USER)
    assert runner.await_count == 2
    assert not response.requires_confirmation
    assert '配置尚未生成' in response.answer
    assert '已经配置成功' not in response.answer
    assert agent_response_status(response) == 'failed'


@pytest.mark.asyncio
@pytest.mark.parametrize('status,fields', [('needs_clarification', ['审批负责人']), ('blocked', [])])
async def test_structured_missing_information_or_block_stops_repair(runtime, monkeypatch, status, fields):
    mod, _ = runtime
    from app.services.ai.schemas import AgentRequest
    async def run(*args, **kwargs):
        bridge = mod.BRIDGES[kwargs['token']]
        assert any(tool['name'] == mod.tool_alias(REPORT_TOOL) for tool in bridge.available_tools())
        report = await bridge.call_tool(mod.tool_alias(REPORT_TOOL), {'status': status, 'reason': '需要明确审批负责人', 'missing_fields': fields})
        assert report['status'] == 'completed'
        return result('已完成')
    runner = AsyncMock(side_effect=run)
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message='帮我配置审批规则'), user=USER)
    assert runner.await_count == 1
    assert '需要明确审批负责人' in response.answer
    assert not response.requires_confirmation
    assert response.items[-1]['payload']['configuration_status'] == status


@pytest.mark.asyncio
async def test_actual_tool_validation_failure_is_not_retried_or_hidden(runtime, monkeypatch):
    mod, _ = runtime
    from app.services.ai.schemas import AgentRequest
    async def run(*args, **kwargs):
        bridge = mod.BRIDGES[kwargs['token']]
        bridge._call_platform_tool = AsyncMock(return_value={'status': 'validation_failed', 'message': 'Validation failed',
            'issues': [{'message': '数量必须大于 0'}]})
        await bridge.call_tool('test', {})
        return result()
    runner = AsyncMock(side_effect=run)
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message='帮我配置数量字段'), user=USER)
    assert runner.await_count == 1
    assert '数量必须大于 0' in response.answer


@pytest.mark.asyncio
@pytest.mark.parametrize('message,mode', [('如何创建表单', 'qa'), ('帮我创建入库表单', 'pending'), ('帮我创建入库表单', 'error')])
async def test_consultation_existing_card_and_model_failure_do_not_retry(runtime, monkeypatch, message, mode):
    mod, _ = runtime
    from app.services.ai.schemas import AgentRequest
    async def run(*args, **kwargs):
        if mode == 'pending':
            mod.BRIDGES[kwargs['token']].pending.append(proposal())
        return result(finish='error' if mode == 'error' else 'completed')
    runner = AsyncMock(side_effect=run)
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message=message), user=USER)
    assert runner.await_count == 1
    assert response.requires_confirmation == (mode == 'pending')


@pytest.mark.asyncio
async def test_second_attempt_stays_within_context_budget(runtime, monkeypatch):
    mod, settings = runtime
    from app.services.ai.schemas import AgentRequest
    from app.services.ai.context_builder import estimate_tokens
    settings['contextPolicy']['maxContextTokens'] = 24000
    runner = AsyncMock(return_value=result())
    monkeypatch.setattr(mod, 'run_sdk', runner)
    request = AgentRequest(message='帮我创建入库表单', context={'history': '旧消息' * 20000})
    response = await mod.HarnessRuntime().run(request, user=USER)
    assert runner.await_count == 2, response.answer
    for call in runner.await_args_list:
        bridge = mod.PlatformBridge(USER, settings, {}, configuration_expected=True)
        options = mod.harness_options(settings, USER, token='test')
        import json
        fixed = options['env']['DSH_SYSTEM_PROMPT'] + json.dumps(bridge.available_tools(), ensure_ascii=False)
        assert estimate_tokens(fixed + call.args[2]) <= 24000


@pytest.mark.asyncio
async def test_retry_timeout_reports_failure_and_releases_bridge(runtime, monkeypatch):
    import asyncio
    mod, _ = runtime
    from app.services.ai.schemas import AgentRequest
    runner = AsyncMock(side_effect=[result(), asyncio.TimeoutError()])
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message='帮我创建入库表单'), user=USER)
    assert runner.await_count == 2
    assert '超时' in response.answer
    assert not response.requires_confirmation
    assert runner.await_args_list[-1].kwargs['token'] not in mod.BRIDGES


@pytest.mark.asyncio
async def test_report_requires_real_missing_fields_and_shares_tool_budget(runtime):
    mod, settings = runtime
    bridge = mod.PlatformBridge(USER, settings, {}, configuration_expected=True)
    result = await bridge.call_tool(mod.tool_alias(REPORT_TOOL), {'status': 'needs_clarification', 'reason': '缺参数'})
    assert result['status'] == 'validation_failed'
    assert bridge.configuration_outcome is None
    maximum = int(settings['safetyPolicy']['maxToolSteps'])
    bridge.calls = maximum
    result = await bridge.call_tool(mod.tool_alias(REPORT_TOOL), {'status': 'blocked', 'reason': '不可用'})
    assert result['status'] == 'blocked'
    assert bridge.calls == maximum
    assert bridge.stop_event.is_set()


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome', ['ui_page', 'ui_draft'])
async def test_successful_page_control_does_not_trigger_card_repair(runtime, monkeypatch, outcome):
    mod, _ = runtime
    from app.services.ai.schemas import AgentRequest
    from app.services.ai.agent_items import agent_response_status
    async def run(*args, **kwargs):
        mod.BRIDGES[kwargs['token']].configuration_outcome = {'status': outcome, 'reason': '页面操作已完成，未保存或发布。'}
        return result()
    runner = AsyncMock(side_effect=run)
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message='请打开新建表单的设计器'), user=USER)
    assert runner.await_count == 1
    assert response.answer == '页面操作已完成，未保存或发布。'
    assert not response.requires_confirmation
    assert agent_response_status(response) == 'completed'


@pytest.mark.parametrize('message,context,expected', [
    ('帮我新建一个退料登记表，能填物料、数量和备注。', {'pageControlsSupported': True}, True),
    ('数量改叫领用数量，只能填1到100。', {'pageControlsSupported': True, 'designerContext': {'draft_id': 'a' * 32}}, True),
    ('新建一条业务记录', {'pageControlsSupported': True}, False),
    ('创建入库单', {}, False),
    ('帮我新建一个表单', {'pageControlsSupported': True, 'surface': 'knowledge'}, False),
])
def test_only_native_designer_tasks_reduce_tool_scope(message, context, expected):
    from app.services.ai.configuration_completion import expects_native_designer
    assert expects_native_designer(message, context) is expected


@pytest.mark.asyncio
async def test_rich_editor_request_fits_default_context_budget(runtime, monkeypatch):
    mod, settings = runtime
    from app.services.ai.schemas import AgentRequest
    settings['contextPolicy']['maxContextTokens'] = 12000
    async def run(*args, **kwargs):
        bridge = mod.BRIDGES[kwargs['token']]
        assert bridge.native_designer_task
        bridge.configuration_outcome = {'status': 'ui_draft', 'reason': '已更新草稿'}
        return result()
    runner = AsyncMock(side_effect=run)
    monkeypatch.setattr(mod, 'run_sdk', runner)
    response = await mod.HarnessRuntime().run(AgentRequest(message='这张报修单再实用一点，单子能看出是哪天的第几张，费用记到角分，再放几张照片。',
        context={'pageControlsSupported': True, 'designerContext': {'draft_id': 'a' * 32, 'fields': [{'field_name': 'note', 'label': '故障现象'}]}}), user=USER)
    assert runner.await_count == 1, response.answer
    assert response.answer and not response.requires_confirmation
