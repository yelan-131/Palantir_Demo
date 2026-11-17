from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.services.ai import component_page_controls as mod


@pytest.mark.parametrize('arguments', [
    {'action': 'save'},
    {'action': 'apply', 'operations': [{'action': 'add', 'widget_id': 'filters', 'widget_type': 'record-filter'}]},
    {'action': 'apply', 'operations': [{'action': 'edit', 'widget_id': 'records'}]},
    {'action': 'apply', 'operations': [{'action': 'edit', 'widget_id': 'records', 'properties': {'roleIds': [1]}}]},
    {'action': 'apply', 'operations': [{'action': 'edit', 'widget_id': 'records', 'appearance': {'titleFontSize': 100}}]},
])
def test_component_tool_rejects_writes_to_storage_and_invalid_edits(arguments):
    with pytest.raises(ValidationError):
        mod.component_request_model().model_validate(arguments)


@pytest.mark.asyncio
async def test_component_tool_targets_current_browser_page_and_waits_for_receipt():
    bridge = SimpleNamespace(user={'is_admin': True}, settings={}, page_actions={},
                             context={'componentPageContext': {'code': 'inspection'}, 'pageControlsSupported': True})

    async def sink(event, action):
        assert event == 'ui.action'
        assert action['page_code'] == 'inspection'
        assert action['operations'][0]['appearance'] == {'showTitle': False}
        bridge.page_actions[action['id']].set_result({'ok': True, 'state': {'saved': False}})

    bridge.event_sink = AsyncMock(side_effect=sink)
    result = await mod.call_component_page(bridge, {'action': 'apply', 'operations': [
        {'action': 'edit', 'widget_id': 'records', 'appearance': {'showTitle': False}},
    ]})
    assert result['status'] == 'completed'
    assert result['result']['saved'] is False
    assert not bridge.page_actions
    bridge.user = {'is_admin': False}
    assert (await mod.call_component_page(bridge, {'action': 'inspect'}))['status'] == 'blocked'
    assert bridge.event_sink.await_count == 1


@pytest.mark.asyncio
async def test_harness_exposes_five_registered_tools_and_honors_individual_disabling(monkeypatch):
    from app.services.ai import agent_registry, harness_runtime
    from app.services.ai.tool_registry import ToolDefinition

    definitions = mod.registry_definitions()
    active = {name: ToolDefinition(**definition) for name, definition in definitions.items()}
    monkeypatch.setattr(harness_runtime, 'tool_registry', lambda: active)
    monkeypatch.setattr('app.services.ai.tool_registry.get_tool', active.get)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock(return_value=dict(zip(('skills', 'tools'), agent_registry.load_seed_registry()))))
    monkeypatch.setattr(harness_runtime, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(harness_runtime, 'settings_snapshot', lambda: {})
    bridge = harness_runtime.PlatformBridge(
        user={'tenant_id': 1, 'is_admin': True}, settings={},
        context={'componentPageContext': {'code': 'inspection'}, 'pageControlsSupported': True},
        event_sink=AsyncMock(),
    )
    describe = harness_runtime.tool_alias(harness_runtime.DESCRIBE_TOOL)
    invoke = harness_runtime.tool_alias(harness_runtime.INVOKE_TOOL)
    assert {describe, invoke} <= {tool['name'] for tool in bridge.available_tools()}

    discovered = await bridge.call_tool(describe, {})
    assert discovered['status'] == 'completed'
    assert {tool['name'] for tool in discovered['tools']} & mod.TOOL_DETAILS.keys() == definitions.keys()

    appearance = 'ui.component_page.update_appearance'
    described = await bridge.call_tool(describe, {'name': appearance})
    assert described['status'] == 'completed'
    active.pop(appearance)
    discovered = await bridge.call_tool(describe, {})
    assert discovered['status'] == 'completed'
    assert {tool['name'] for tool in discovered['tools']} & mod.TOOL_DETAILS.keys() == definitions.keys() - {appearance}
    result = await bridge.call_tool(invoke, {
        'name': appearance,
        'arguments': {'widget_id': 'records', 'appearance': {'showTitle': False}},
    })
    assert result['status'] == 'blocked'
    bridge.event_sink.assert_not_awaited()


def test_split_tool_only_accepts_its_own_operation():
    assert mod.tool_arguments('ui.component_page.add', {'widget_id': 'chart', 'widget_type': 'chart'}) == {
        'action': 'apply', 'operations': [{'action': 'add', 'widget_id': 'chart', 'widget_type': 'chart'}],
    }
    with pytest.raises(ValidationError):
        mod.tool_arguments('ui.component_page.update_properties', {'widget_id': 'chart', 'appearance': {'showTitle': False}})
