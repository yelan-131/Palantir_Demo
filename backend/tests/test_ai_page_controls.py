import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.services.ai.page_controls import PageControlRequest


@pytest.mark.parametrize('payload', [
    {'action': 'confirm_draft', 'draft_id': 'a' * 32},
    {'action': 'open'}, {'action': 'set_field_properties', 'form_id': 1},
    {'action': 'set_field_properties', 'form_id': 1, 'field_name': 'qty', 'properties': {'min': 20, 'max': 1}},
    {'action': 'set_field_properties', 'form_id': 1, 'field_name': 'qty', 'properties': {'role': 'admin'}},
    {'action': 'run_script', 'form_id': 1}, {'action': 'open', 'form_id': 0},
])
def test_only_explicit_existing_page_actions_are_accepted(payload):
    with pytest.raises(ValidationError):
        PageControlRequest.model_validate(payload)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation,outcome', [('open', 'ui_page'), ('select_field', 'ui_page'), ('preview', 'ui_page'), ('set_field_properties', 'ui_draft')])
async def test_page_call_waits_for_real_browser_receipt_and_does_not_write(monkeypatch, operation, outcome):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    db = AsyncMock()
    db.scalar.side_effect = [SimpleNamespace(id=7), SimpleNamespace(field_name='quantity')]
    manager = AsyncMock(); manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    received = asyncio.Event()
    async def sink(event, action):
        assert event == 'ui.action'
        received.set()
        assert not bridge.page_actions[action['id']].done()
    bridge.event_sink = sink
    task = asyncio.create_task(mod.call_page_control(bridge, {'action': operation,
        'form_id': 7, 'field_name': 'quantity', 'properties': {'label': '新名称'}}))
    await received.wait()
    assert not task.done()
    future = next(iter(bridge.page_actions.values()))
    future.set_result({'ok': True, 'state': {'label': '新名称', 'saved': False, 'published': False}})
    result = await task
    assert result['status'] == 'completed' and result['result']['saved'] is False
    assert bridge.configuration_outcome['status'] == outcome
    assert not bridge.page_actions
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_page_receipts_are_bound_to_current_user_and_tenant(monkeypatch):
    from app.api import ai_assistant as api
    from app.services.ai.harness_runtime import PlatformBridge, BRIDGES
    from app.services.ai.page_controls import PageControlResult
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'owner'}, settings={}, context={})
    future = asyncio.get_running_loop().create_future()
    bridge.page_actions['action-test'] = future
    monkeypatch.setitem(BRIDGES, 'test-page-token', bridge)
    monkeypatch.setattr(api, '_normalize_user', AsyncMock(side_effect=lambda user: user))
    for user in [{'tenant_id': 1, 'sub': 'other'}, {'tenant_id': 2, 'sub': 'owner'}]:
        with pytest.raises(HTTPException) as failure:
            await api.receive_page_action_result('action-test', PageControlResult(ok=True), user)
        assert failure.value.status_code == 404 and not future.done()
    result = await api.receive_page_action_result('action-test', PageControlResult(ok=True), {'tenant_id': 1, 'sub': 'owner'})
    assert result['ok'] and future.result()['ok']


@pytest.mark.asyncio
async def test_missing_ui_connection_cannot_be_used_as_a_backdoor():
    from app.services.ai.harness_runtime import PlatformBridge, tool_alias
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    result = await bridge.call_tool(tool_alias('ui.form_designer'), {'action': 'open', 'form_id': 1})
    assert result['status'] == 'blocked'
    assert bridge.calls == 0


DRAFT = {'name': '入库单', 'code': 'new_inbound', 'fields': [
    {'field_name': 'material', 'label': '物料'},
    {'field_name': 'quantity', 'label': '数量', 'field_type': 'decimal', 'required': True},
]}


@pytest.mark.parametrize('draft', [
    {**DRAFT, 'fields': []},
    {**DRAFT, 'code': '../overwrite'},
    {**DRAFT, 'fields': [DRAFT['fields'][0], DRAFT['fields'][0]]},
    {**DRAFT, 'fields': [{'field_name': 'bad-key', 'label': '字段'}]},
    {**DRAFT, 'fields': [{'field_name': 'qty', 'label': ' ', 'field_type': 'integer'}]},
])
def test_new_draft_rejects_invalid_definition(draft):
    with pytest.raises(ValidationError):
        PageControlRequest.model_validate({'action': 'draft_new', 'draft': draft})


@pytest.mark.asyncio
@pytest.mark.parametrize('existing', [False, True])
async def test_new_draft_checks_collision_and_never_creates_database_rows(monkeypatch, existing):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    db = AsyncMock()
    db.scalar.return_value = SimpleNamespace(id=7) if existing else None
    manager = AsyncMock(); manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    operations = []
    async def sink(event, action):
        operations.append(action['action'])
        assert action['form_id'] == 0
        if action['action'] == 'draft_new':
            assert action['draft']['name'] == '入库单'
        bridge.page_actions[action['id']].set_result({'ok': True, 'state': {
            'draft_id': action['draft_id'], 'saved': False, 'fields': DRAFT['fields']}})
    bridge.event_sink = AsyncMock(side_effect=sink)
    result = await mod.call_page_control(bridge, {'action': 'draft_new', 'draft': DRAFT})
    assert result['status'] == ('validation_failed' if existing else 'completed')
    db.commit.assert_not_awaited()
    db.execute.assert_not_awaited()
    db.add.assert_not_called()
    if existing:
        bridge.event_sink.assert_not_awaited()
    else:
        assert operations == ['draft_new', 'add_field', 'add_field', 'review']
        assert bridge.configuration_outcome['status'] == 'ui_draft'
        assert bridge.context['designerContext']['draft_id']
        # A following tool call in this same turn can preview the new draft.
        result = await mod.call_page_control(bridge, {'action': 'preview', 'draft_id': bridge.context['designerContext']['draft_id']})
        assert result['status'] == 'completed'


@pytest.mark.asyncio
async def test_new_draft_cannot_address_another_pages_draft(monkeypatch):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    bridge.event_sink = AsyncMock()
    result = await mod.call_page_control(bridge, {'action': 'preview', 'draft_id': 'a' * 32})
    assert result['status'] == 'blocked'
    bridge.event_sink.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_native_field_step_stops_without_final_review(monkeypatch):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    db = AsyncMock(); db.scalar.return_value = None
    manager = AsyncMock(); manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    operations = []
    async def sink(event, action):
        operations.append(action['action'])
        bridge.page_actions[action['id']].set_result({'ok': action['action'] != 'add_field', 'error': '画布未能加入字段'})
    bridge.event_sink = sink
    result = await mod.call_page_control(bridge, {'action': 'draft_new', 'draft': DRAFT})
    assert result['status'] == 'blocked'
    assert operations == ['draft_new', 'add_field']
    assert not bridge.configuration_outcome and not bridge.page_actions
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_append_field_uses_current_draft_and_keeps_prior_fields(monkeypatch):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    context = {'designerContext': {'draft_id': 'a' * 32, 'fields': DRAFT['fields']}}
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context=context)
    new_field = {'field_name': 'return_date', 'label': '退料日期', 'field_type': 'date'}
    async def sink(event, action):
        if action['action'] == 'add_field':
            assert action['field']['field_name'] == 'return_date'
        else:
            assert action['action'] == 'review'
        bridge.page_actions[action['id']].set_result({'ok': True, 'state': {'fields': DRAFT['fields'] + [new_field]}})
    bridge.event_sink = AsyncMock(side_effect=sink)
    result = await mod.call_page_control(bridge, {'action': 'add_field', 'draft_id': 'a' * 32, 'new_field': new_field})
    assert result['status'] == 'completed'
    assert len(bridge.context['designerContext']['fields']) == 3
    bridge.event_sink.reset_mock()
    duplicate = await mod.call_page_control(bridge, {'action': 'add_field', 'draft_id': 'a' * 32, 'new_field': new_field})
    assert duplicate['status'] == 'validation_failed'
    bridge.event_sink.assert_not_awaited()


@pytest.mark.parametrize('new_field', [
    {'field_name': 'urgency', 'label': '紧急程度', 'field_type': 'enum'},
    {'field_name': 'urgency', 'label': '紧急程度', 'field_type': 'enum', 'options': [{'label': '普通', 'value': 'one'}, {'label': '紧急', 'value': 'one'}]},
    {'field_name': 'code', 'label': '单号', 'field_type': 'code', 'readonly': False},
    {'field_name': 'name', 'label': '名称', 'encoding': {'prefix': 'X'}},
    {'field_name': 'note', 'label': '备注', 'presentation': {'fontSize': 999}},
    {'field_name': 'note', 'label': '备注', 'settings': {'script': 'run()'}},
])
def test_rich_native_fields_reject_invalid_rules(new_field):
    with pytest.raises(ValidationError):
        PageControlRequest.model_validate({'action': 'add_field', 'draft_id': 'a' * 32, 'new_field': new_field})


@pytest.mark.asyncio
@pytest.mark.parametrize('fail_step', [None, 'add_field'])
async def test_rich_plan_drives_native_steps_and_reviews_only_after_success(monkeypatch, fail_step):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={
        'designerContext': {'draft_id': 'a' * 32, 'fields': DRAFT['fields']}})
    changes = [
        {'field_name': 'quantity', 'properties': {'width': 'third', 'settings': {'precision': 2}, 'presentation': {'labelFontSize': 16}}},
        {'new_field': {'field_name': 'ticket_no', 'label': '单号', 'field_type': 'code', 'encoding': {'prefix': 'BX'}}},
        {'new_field': {'field_name': 'urgency', 'label': '紧急程度', 'field_type': 'enum', 'options': [{'label': '一般', 'value': 'normal'}, {'label': '紧急', 'value': 'urgent'}]}},
        {'new_field': {'field_name': 'photos', 'label': '现场照片', 'field_type': 'attachment', 'settings': {'maxFiles': 3, 'fileTypes': '图片'}}},
        {'new_field': {'field_name': 'stopped', 'label': '是否停机', 'field_type': 'boolean'}},
    ]
    operations = []
    fields = list(DRAFT['fields'])
    async def sink(event, action):
        operations.append(action['action'])
        assert action['form_id'] == 0 and action['draft_id'] == 'a' * 32
        if action.get('field'):
            assert action['field'].get('min') is not None or 'min' not in action['field']
            fields.append(action['field'])
        bridge.page_actions[action['id']].set_result({'ok': action['action'] != fail_step,
            'error': '页面执行失败' if action['action'] == fail_step else None, 'state': {'fields': fields}})
    bridge.event_sink = sink
    result = await mod.call_page_control(bridge, {'action': 'configure_fields', 'draft_id': 'a' * 32, 'changes': changes})
    assert result['status'] == ('blocked' if fail_step else 'completed')
    assert not bridge.page_actions
    if fail_step:
        assert operations == ['set_field_properties', 'add_field'] and not bridge.configuration_outcome
    else:
        assert operations == ['set_field_properties', 'add_field', 'add_field', 'add_field', 'add_field', 'review']
        assert bridge.configuration_outcome['status'] == 'ui_draft'
        assert bridge.context['designerContext']['fields'][-1]['field_type'] == 'boolean'
