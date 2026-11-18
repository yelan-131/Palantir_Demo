from unittest.mock import AsyncMock

import pytest

from app.services.ai import agent_registry, application_navigation as nav
from app.services.ai import harness_runtime as runtime
from app.services.ai.schemas import AgentRequest
from app.services.ai.settings import merge_ai_settings


@pytest.mark.parametrize("message, expected", [
    ("帮我打开生产态势应用🤔", (nav.TOOL, {"application": "生产态势应用"})),
    ("我要打开一个应用", (nav.TOOL, {})),
    ("打开生产态势应用里的 OEE 趋势报表", (nav.PAGE_TOOL, {"application": "生产态势应用", "page": "OEE 趋势报表"})),
    ("打开当前应用的生产总览", (nav.PAGE_TOOL, {"page": "生产总览"})),
    ("打开表单设计器", None),
    ("不要打开生产态势应用", None),
    ("打开生产态势应用，然后给我查数据", None),
])
def test_explicit_navigation_selects_the_matching_tool(message, expected):
    assert nav.explicit_navigation_request(message) == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("page, ack, expected", [
    (False, {"ok": True, "state": {"application_id": 1, "application_name": "生产态势"}}, "已打开「生产态势」。"),
    (True, {"ok": True, "state": {"application_id": 1, "application_name": "生产态势", "page_name": "生产总览"}}, "已打开「生产总览」。"),
    (False, {"ok": False, "error": "没找到可访问的应用。"}, "没找到可访问的应用。"),
    (True, {"ok": True, "state": {"application_id": 1, "application_name": "生产态势"}}, "工作台未确认已进入菜单页。"),
])
async def test_workbench_navigation_waits_for_browser_receipt(monkeypatch, page, ack, expected):
    settings = merge_ai_settings({"aiEnabled": True, "agentMode": "readonly", "rolePolicies": []})
    monkeypatch.setattr(runtime, "settings_snapshot", lambda: settings)
    monkeypatch.setattr(runtime, "run_sdk", AsyncMock(side_effect=AssertionError("standalone navigation is local")))
    user = {"tenant_id": 1, "sub": "navigation-test", "is_admin": True}
    commands = []

    async def event_sink(name, command):
        if name != "ui.action":
            return
        commands.append(command)
        bridge = next(bridge for bridge in runtime.BRIDGES.values() if command["id"] in bridge.page_actions)
        bridge.page_actions[command["id"]].set_result(ack)

    message = "打开生产态势应用里的生产总览" if page else "打开生产态势应用"
    response = await runtime.harness_runtime.run(
        AgentRequest(message=message, context={"pageControlsSupported": True}), user=user, event_sink=event_sink,
    )
    assert response.answer == expected
    assert not response.requires_confirmation
    assert [command["action"] for command in commands] == ["open_page" if page else "open_application"]
    assert not any("route" in command for command in commands)


def test_both_tools_are_discoverable_only_in_connected_workbench():
    settings = merge_ai_settings({"aiEnabled": True, "rolePolicies": []})
    user = {"tenant_id": 1, "sub": "navigation-test", "is_admin": True}
    for context, expected in [({}, False), ({"pageControlsSupported": True}, True),
                              ({"pageControlsSupported": True, "surface": "knowledge"}, False)]:
        bridge = runtime.PlatformBridge(user, settings, context, event_sink=AsyncMock())
        definitions = bridge.tool_definitions()
        assert (nav.TOOL in definitions) is expected
        assert (nav.PAGE_TOOL in definitions) is expected


@pytest.mark.asyncio
@pytest.mark.parametrize("tool, args, action", [
    (nav.TOOL, {"application": "production-dashboard"}, "open_application"),
    (nav.PAGE_TOOL, {"page": "生产总览"}, "open_page"),
])
async def test_model_can_invoke_each_navigation_tool(monkeypatch, tool, args, action):
    settings = merge_ai_settings({"aiEnabled": True, "rolePolicies": []})
    monkeypatch.setattr(runtime, "load_persisted_ai_settings", AsyncMock())
    monkeypatch.setattr(runtime, "settings_snapshot", lambda: settings)
    skills, tools = agent_registry.load_seed_registry()
    monkeypatch.setattr(agent_registry, "load_agent_registry", AsyncMock(return_value={"skills": skills, "tools": tools}))
    user = {"tenant_id": 1, "sub": "navigation-test", "is_admin": True}

    async def event_sink(name, value):
        if name == "ui.action":
            assert value["action"] == action
            bridge.page_actions[value["id"]].set_result({"ok": True, "state": {
                "application_id": 1, "application_name": "生产态势", "page_name": "生产总览",
            }})

    bridge = runtime.PlatformBridge(user, settings, {"pageControlsSupported": True}, event_sink=event_sink)
    result = await bridge.call_tool(runtime.tool_alias(tool), args)
    assert result["status"] == "completed"
    assert not bridge.pending
