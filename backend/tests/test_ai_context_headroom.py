"""Protect new conversations and growing form drafts from fixed-context bloat."""
import copy
import json
from unittest.mock import AsyncMock

import pytest

from app.services.ai.context_builder import estimate_tokens
from app.services.ai.harness_runtime import PlatformBridge, harness_options
from app.services.ai.page_controls import page_control_model_result
from app.services.ai.settings import merge_ai_settings

USER = {'tenant_id': 1, 'sub': 'context-regression', 'is_admin': True, 'roles': ['admin']}


@pytest.mark.parametrize('native', [False, True])
def test_new_business_window_leaves_room_for_context_and_tool_results(monkeypatch, tmp_path, native):
    from app.services.ai.harness_runtime import BRIDGES
    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    settings = merge_ai_settings({'apiKey': 'test-key', 'contextPolicy': {'maxContextTokens': 12000}})
    bridge = PlatformBridge(USER, settings, {'pageControlsSupported': True}, event_sink=AsyncMock())
    bridge.native_designer_task = native
    monkeypatch.setitem(BRIDGES, 'test', bridge)
    prompt = harness_options(settings, USER, token='test')['env']['DSH_SYSTEM_PROMPT']
    fixed = estimate_tokens(prompt + json.dumps(bridge.available_tools(), ensure_ascii=False))
    # A fresh window must reserve substantial room for the request, draft and results.
    assert fixed < 11000, fixed
    assert '工具参数以当前 MCP 工具的 inputSchema 为准' in prompt


def test_large_designer_receipt_preserves_draft_but_does_not_repeat_rules():
    state = {'draft_id': 'draft-test', 'saved': False, 'published': False, 'fields': [
        {'field_name': f'field_{i}', 'label': f'字段{i}', 'field_type': 'string', 'required': True,
         'settings': {'description': '详细配置' * 1000}, 'encoding': {'prefix': 'TEST'}} for i in range(20)]}
    result = {'status': 'completed', 'result': state, 'message': '草稿已更新，未保存或发布'}
    original = copy.deepcopy(result)
    compact = page_control_model_result(result)
    assert result == original
    assert compact['result']['field_count'] == 20
    assert [f['field_name'] for f in compact['result']['fields']] == [f'field_{i}' for i in range(20)]
    assert compact['result']['saved'] is False and compact['result']['published'] is False
    assert len(json.dumps(compact, ensure_ascii=False)) < 4000
    failure = {'status': 'blocked', 'result': state, 'message': '字段校验失败'}
    assert page_control_model_result(failure) is failure


@pytest.mark.asyncio
async def test_twenty_fields_complete_in_one_tool_call_and_keep_full_browser_state(monkeypatch):
    from types import SimpleNamespace
    from app.services.ai import page_controls, harness_runtime
    from app.services.ai.harness_runtime import tool_alias
    settings = merge_ai_settings({'apiKey': 'test-key'})
    monkeypatch.setattr(harness_runtime, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(harness_runtime, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(page_controls, 'decide_ai_permission', lambda *a, **k: SimpleNamespace(allowed=True))
    db = AsyncMock(); db.scalar.return_value = None
    manager = AsyncMock(); manager.__aenter__.return_value = db
    monkeypatch.setattr(page_controls, 'db_session', lambda: manager)
    bridge = PlatformBridge(USER, settings, {'pageControlsSupported': True})
    operations, fields = [], []
    async def sink(event, action):
        if event != 'ui.action':
            return
        operations.append(action['action'])
        if action['action'] == 'add_field':
            fields.append(action['field'])
        bridge.page_actions[action['id']].set_result({'ok': True, 'state': {
            'draft_id': action['draft_id'], 'fields': list(fields), 'saved': False, 'published': False}})
    bridge.event_sink = sink
    result = await bridge.call_tool(tool_alias('ui.form_designer'), {'action': 'draft_new', 'draft': {
        'name': '上下文验收表', 'code': 'context_acceptance', 'fields': [
            {'field_name': f'field_{i}', 'label': f'字段{i}', 'field_type': 'string',
             'settings': {'rows': 5}} for i in range(20)]}})
    assert result['status'] == 'completed'
    assert operations == ['draft_new'] + ['add_field'] * 20 + ['review']
    assert bridge.calls == 1 and not bridge.page_actions
    assert len(bridge.context['designerContext']['fields']) == 20
    assert bridge.context['designerContext']['fields'][-1]['settings']['rows'] == 5
    assert result['result']['field_count'] == 20
    assert 'settings' not in result['result']['fields'][-1]
    assert result['result']['saved'] is False
    db.commit.assert_not_awaited()
