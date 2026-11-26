import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Request
from pydantic import ValidationError

from app.services.ai.page_controls import PageControlRequest


@pytest.mark.parametrize('payload', [
    {'action': 'confirm_draft', 'draft_id': 'a' * 32},
    {'action': 'confirm_layout_draft', 'form_id': 7},
    {'action': 'open'}, {'action': 'set_field_properties', 'form_id': 1},
    {'action': 'set_field_properties', 'form_id': 1, 'field_name': 'qty', 'properties': {'min': 20, 'max': 1}},
    {'action': 'set_field_properties', 'form_id': 1, 'field_name': 'qty', 'properties': {'role': 'admin'}},
    {'action': 'configure_layout', 'form_id': 1},
    {'action': 'inspect_layout', 'form_id': 1, 'layout_operations': [{'op': 'add', 'control_id': 'group', 'control_type': 'container'}]},
    {'action': 'configure_layout', 'form_id': 1, 'layout_operations': [{'op': 'add', 'control_id': 'table', 'control_type': 'editable-table'}]},
    {'action': 'configure_layout', 'form_id': 1, 'layout_operations': [{'op': 'move', 'field_name': 'qty', 'slot_id': 'first'}]},
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
    events = []
    async def sink(event, action):
        events.append((event, action))
        if event == 'ui.action':
            received.set()
            assert not bridge.page_actions[action['id']].done()
    bridge.event_sink = sink
    task = asyncio.create_task(mod.call_page_control(bridge, {'action': operation,
        'form_id': 7, 'field_name': 'quantity', 'properties': {'label': '新名称'}}))
    await received.wait()
    assert not task.done()
    started = events[0][1]
    assert started['type'] == 'page_action' and started['status'] == 'running'
    assert started['item_id'] == events[1][1]['id']
    future = next(iter(bridge.page_actions.values()))
    state = {'label': '新名称', 'saved': False, 'published': False, 'form_id': 7}
    if operation == 'set_field_properties':
        state['layout_review_ready'] = True
    future.set_result({'ok': True, 'state': state})
    result = await task
    assert result['status'] == 'completed' and result['result']['saved'] is False
    assert bridge.configuration_outcome['status'] == outcome
    assert [event for event, _ in events] == ['item.created', 'ui.action', 'item.updated']
    assert bridge.items == [events[-1][1]]
    assert bridge.items[0]['item_id'] == started['item_id']
    assert bridge.items[0]['status'] == 'completed'
    if operation == 'set_field_properties':
        assert bridge.items[0]['payload']['form_layout_review'] == {
            'form_id': 7, 'operation_count': 0, 'field_name': 'quantity',
        }
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
    request = Request({'type': 'http'})
    receipt = PageControlResult(ok=False, error='目标不存在', error_code='AI_FORM_LAYOUT_TARGET_INVALID')
    for user in [{'tenant_id': 1, 'sub': 'other'}, {'tenant_id': 2, 'sub': 'owner'}]:
        with pytest.raises(HTTPException) as failure:
            await api.receive_page_action_result('action-test', receipt, request, user)
        assert failure.value.status_code == 404 and not future.done()
    result = await api.receive_page_action_result('action-test', receipt, request, {'tenant_id': 1, 'sub': 'owner'})
    assert result['ok'] and not future.result()['ok']
    assert request.state.partial_failure == ('AI_FORM_LAYOUT_TARGET_INVALID', 1)
    assert 'AI_FORM_LAYOUT_TARGET_INVALID' in future.result()['error']


@pytest.mark.asyncio
async def test_missing_ui_connection_cannot_be_used_as_a_backdoor(monkeypatch):
    from app.services.ai import agent_registry, harness_runtime
    from app.services.ai.harness_runtime import INVOKE_TOOL, PlatformBridge, tool_alias
    skills, tools = agent_registry.load_seed_registry()
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock(return_value={'skills': skills, 'tools': tools}))
    monkeypatch.setattr(harness_runtime, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(harness_runtime, 'settings_snapshot', dict)
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    bridge.described_tools.add('ui.form_designer')
    result = await bridge.call_tool(tool_alias(INVOKE_TOOL), {'name': 'ui.form_designer',
        'arguments': {'action': 'open', 'form_id': 1}})
    assert result['status'] == 'blocked'
    assert bridge.calls == 0


DRAFT = {'name': '入库单', 'code': 'new_inbound', 'fields': [
    {'field_name': 'material', 'label': '物料'},
    {'field_name': 'quantity', 'label': '数量', 'field_type': 'decimal', 'required': True},
]}


@pytest.mark.asyncio
@pytest.mark.parametrize('allowed', [False, True])
async def test_native_draft_forwards_application_and_field_rules(monkeypatch, allowed):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge

    db = AsyncMock()
    db.scalar.return_value = None
    db.get.return_value = SimpleNamespace(id=3, name='仓储管理', tenant_id=1 if allowed else 2)
    manager = AsyncMock()
    manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    fields = [
        {'field_name': 'source', 'label': '物料档案', 'field_type': 'relation',
         'reference': {'kind': 'masterData', 'source': 'materials', 'label_field': 'name',
                       'backfill': {'material': 'name'}}},
        {'field_name': 'material', 'label': '物料', 'visible_when': {'sourceField': 'source', 'operator': 'notEmpty'}},
        {'field_name': 'quantity', 'label': '数量', 'field_type': 'decimal', 'default_value': 2.5},
        {'field_name': 'total', 'label': '合计', 'field_type': 'decimal',
         'computed': {'expression': 'quantity * 2', 'precision': 2}},
        {'field_name': 'owner', 'label': '人员', 'field_type': 'person',
         'required_when': {'sourceField': 'quantity', 'operator': 'gt', 'value': '0'}},
    ]

    async def dispatch(_bridge, action):
        draft = action['draft']
        assert draft['application_id'] == 3 and draft['application_name'] == '仓储管理'
        for actual, expected in zip(draft['fields'], fields, strict=True):
            assert all(actual.get(key) == value for key, value in expected.items() if key != 'computed')
        assert draft['fields'][3]['computed']['expression'] == 'quantity * 2'
        return {'ok': True, 'state': {'draft_id': action['draft_id'], 'saved': False, 'fields': draft['fields']}}

    send = AsyncMock(side_effect=dispatch)
    monkeypatch.setattr(mod, 'dispatch_page_action', send)
    result = await mod.call_page_control(bridge, {'action': 'draft_new',
        'draft': {**DRAFT, 'application_id': 3, 'fields': fields}})
    assert result['status'] == ('completed' if allowed else 'validation_failed')
    db.commit.assert_not_awaited()
    if allowed:
        payload = mod.page_control_model_result(result)['result']
        assert payload['application_id'] == 3 and payload['application_name'] == '仓储管理'
        send.assert_awaited_once()
    else:
        send.assert_not_awaited()


@pytest.mark.asyncio
async def test_timeout_cancels_browser_queue_without_claiming_an_unsaved_dialog(monkeypatch):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    db = AsyncMock()
    db.scalar.return_value = None
    manager = AsyncMock(); manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    bridge.event_sink = AsyncMock()
    async def timeout(future, timeout):
        future.cancel()
        raise asyncio.TimeoutError()
    monkeypatch.setattr(mod.asyncio, 'wait_for', timeout)
    result = await mod.call_page_control(bridge, {'action': 'draft_new', 'draft': DRAFT})
    calls = bridge.event_sink.await_args_list
    assert [call.args[0] for call in calls] == ['item.created', 'ui.action', 'ui.action.cancel', 'item.updated']
    assert calls[1].args[1]['id'] == calls[2].args[1]['id'] == bridge.items[0]['item_id']
    assert bridge.items[0]['status'] == 'timeout'
    assert result['status'] == 'blocked'
    assert '未检测到' in result['message']
    assert not bridge.page_actions
    db.commit.assert_not_awaited()


@pytest.mark.parametrize('draft', [
    {**DRAFT, 'fields': []},
    {**DRAFT, 'code': '../overwrite'},
    {**DRAFT, 'fields': [DRAFT['fields'][0], DRAFT['fields'][0]]},
    {**DRAFT, 'fields': [{'field_name': 'bad-key', 'label': '字段'}]},
    {**DRAFT, 'fields': [{'field_name': 'qty', 'label': ' ', 'field_type': 'integer'}]},
    {**DRAFT, 'fields': [{**DRAFT['fields'][0], 'field_type': 'relation'}]},
    {**DRAFT, 'fields': [{**DRAFT['fields'][0], 'visible_when': {'sourceField': 'missing', 'value': 'X'}}]},
    {**DRAFT, 'fields': [{**DRAFT['fields'][0], 'computed': {'expression': 'quantity.__class__'}}]},
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
        if event != 'ui.action':
            return
        operations.append(action['action'])
        assert action['form_id'] == 0
        if action['action'] == 'draft_new':
            assert action['draft']['name'] == '入库单'
        bridge.page_actions[action['id']].set_result({'ok': True, 'state': {
            'draft_id': action['draft_id'], 'saved': False, 'fields': DRAFT['fields'], 'review_ready': True}})
    bridge.event_sink = AsyncMock(side_effect=sink)
    result = await mod.call_page_control(bridge, {'action': 'draft_new', 'draft': DRAFT})
    assert result['status'] == ('validation_failed' if existing else 'completed')
    db.commit.assert_not_awaited()
    db.execute.assert_not_awaited()
    db.add.assert_not_called()
    if existing:
        bridge.event_sink.assert_not_awaited()
    else:
        assert operations == ['draft_new']
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
async def test_incomplete_native_field_receipt_stops_without_final_review(monkeypatch):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge
    db = AsyncMock(); db.scalar.return_value = None
    manager = AsyncMock(); manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    operations = []
    async def sink(event, action):
        if event != 'ui.action':
            return
        operations.append(action['action'])
        bridge.page_actions[action['id']].set_result({'ok': True, 'state': {
            'draft_id': action['draft_id'], 'fields': DRAFT['fields'][:1], 'review_ready': True}})
    bridge.event_sink = sink
    result = await mod.call_page_control(bridge, {'action': 'draft_new', 'draft': DRAFT})
    assert result['status'] == 'blocked'
    assert operations == ['draft_new'] and '全部字段' in result['message']
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
        if event != 'ui.action':
            return
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
        if event != 'ui.action':
            return
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



@pytest.mark.asyncio
@pytest.mark.parametrize(('new_form', 'layout_review_ready', 'receipt_form_id'), [
    (True, False, None), (False, True, 7), (False, False, 7), (False, True, 8),
])
async def test_layout_batch_dispatches_once_and_requires_browser_receipt(
    monkeypatch, new_form, layout_review_ready, receipt_form_id,
):
    from app.services.ai import page_controls as mod
    from app.services.ai.harness_runtime import PlatformBridge

    db = AsyncMock()
    db.scalar.return_value = None if new_form else SimpleNamespace(id=7)
    manager = AsyncMock()
    manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_ai_permission', lambda *args, **kwargs: SimpleNamespace(allowed=True))
    bridge = PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings={}, context={})
    operations = [
        {'op': 'add', 'control_id': 'tabs', 'control_type': 'tabs',
         'properties': {'layout': {'tabs': [{'id': 'basic', 'label': '基础信息'}]}}},
        {'op': 'move', 'field_name': 'material', 'parent_id': 'tabs', 'slot_id': 'basic'},
    ]
    received = []

    async def sink(event, action):
        if event != 'ui.action':
            return
        received.append(action)
        payload = action['draft'] if new_form else action
        assert payload['layout_operations'] == operations
        bridge.page_actions[action['id']].set_result({'ok': True, 'state': {
            'draft_id': action.get('draft_id'), 'form_id': receipt_form_id,
            'fields': DRAFT['fields'], 'review_ready': True, 'saved': False, 'published': False,
            'layout_controls': [{'control_id': 'tabs'}], 'layout_operation_count': len(operations),
            'layout_review_ready': layout_review_ready,
        }})

    bridge.event_sink = sink
    request = ({'action': 'draft_new', 'draft': {**DRAFT, 'layout_operations': operations}} if new_form else
               {'action': 'configure_layout', 'form_id': 7, 'layout_operations': operations})
    result = await mod.call_page_control(bridge, request)
    assert len(received) == 1
    db.commit.assert_not_awaited()
    page_action = bridge.items[-1]
    if receipt_form_id == 8:
        assert result['status'] == 'blocked'
        assert page_action['status'] == 'failed'
        assert not page_action['payload']
        return
    assert result['status'] == 'completed'
    assert bridge.configuration_outcome['status'] == 'ui_draft'
    assert mod.page_control_model_result(result)['result']['layout_controls'] == [{'control_id': 'tabs'}]
    if layout_review_ready:
        assert page_action['item_id'] == received[0]['id']
        assert page_action['payload']['form_layout_review'] == {'form_id': 7, 'operation_count': 2}
        assert '确认保存草稿' in result['message']
    else:
        assert not page_action['payload']
        assert '确认保存草稿' not in result['message']
