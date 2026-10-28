from copy import deepcopy
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.services.ai.configuration_review import ConfigurationReviewEdit, edit_form_proposal
from app.services.ai.context_builder import estimate_tokens, fit_context_to_budget


def action():
    return {'skill': 'forms.create_form_definition', 'payload': {
        '_harness_tool': 'forms.create_form_definition',
        '_contract': {'tool': 'forms.create_form_definition'},
        'form': {'name': '入库单', 'code': 'inbound', 'application_id': 7},
        'fields': [{'field_name': 'quantity', 'label': '数量', 'field_type': 'integer',
                    'required': False, 'ui_config': {'min': 1}}],
        'menu': {'create': False}}}


def edit(**changes):
    return ConfigurationReviewEdit(**({'confirmation_token': 'old', 'action_index': 0,
        'form_name': '入库验收单', 'fields': [{'index': 0, 'label': '入库数量', 'required': True}]} | changes))


def test_edit_preserves_codes_rules_and_other_configuration():
    original = action()
    before = deepcopy(original)
    updated = edit_form_proposal(original, edit())
    assert original == before
    assert updated['payload']['form'] == {'name': '入库验收单', 'code': 'inbound', 'application_id': 7}
    assert updated['payload']['fields'][0] == {**original['payload']['fields'][0], 'label': '入库数量', 'required': True}
    assert updated['payload']['menu'] == original['payload']['menu']


@pytest.mark.parametrize('changes', [
    {'form_name': ' '}, {'fields': [{'index': 2, 'label': '不存在', 'required': True}]},
    {'fields': [{'index': 0, 'label': ' ', 'required': True}]},
    {'fields': [{'index': 0, 'label': 'a', 'required': True}, {'index': 0, 'label': 'b', 'required': False}]},
])
def test_invalid_edits_are_rejected(changes):
    with pytest.raises(HTTPException) as failure:
        edit_form_proposal(action(), edit(**changes))
    assert failure.value.status_code == 422


def test_context_trimming_keeps_complete_current_draft():
    draft = {'collected_slots': action()['payload']}
    context = {'configurationDraft': draft, 'recentMessages': ['旧消息' * 2000] * 10, 'semanticContext': {'records': ['数据' * 5000]}}
    before = deepcopy(context)
    result = fit_context_to_budget(context, estimate_tokens({'configurationDraft': draft}) + 50)
    assert result['configurationDraft'] == draft
    assert estimate_tokens(result) <= estimate_tokens({'configurationDraft': draft}) + 50
    assert context == before
    with pytest.raises(ValueError, match='草稿超过'):
        fit_context_to_budget(context, 10)


@pytest.mark.asyncio
async def test_revision_rotates_nonce_and_rejects_stale_or_foreign_requests(monkeypatch):
    from app.services.ai import configuration_review as mod
    from app.services.ai.agent_items import confirmation_item, extract_confirmation_payload
    from app.services.ai.run_recovery import restore_run
    user = {'tenant_id': 1, 'sub': 'owner'}
    confirmation = {'confirmation_token': 'old', 'user': 'owner', 'actions': [action()],
                    'expires_at': (datetime.now() + timedelta(minutes=10)).isoformat()}
    row = SimpleNamespace(run_id='review-test', tenant_id=1, items=[confirmation_item(confirmation_payload=confirmation)],
                          confirmation_payload=confirmation, actions=[], status='waiting_confirmation', evidence=[],
                          risk_level='high', answer='', mode='agent', conversation_id='review-conversation')
    db = AsyncMock()
    db.scalar.side_effect = lambda query: row if query.column_descriptions[0]['entity'].__name__ == 'AIAgentRun' else None
    manager = AsyncMock()
    manager.__aenter__.return_value = db
    monkeypatch.setattr(mod, 'db_session', lambda: manager)
    monkeypatch.setattr(mod, 'decide_tool_permission', lambda *args: SimpleNamespace(allowed=True))
    monkeypatch.setattr(mod.agent_validation_service, 'validate_tool_payload', lambda **kwargs: SimpleNamespace(valid=True))
    result = await mod.revise_configuration('review-test', edit(), user, {})
    current = extract_confirmation_payload(result['items'])
    assert current['confirmation_token'] != 'old'
    assert row.status == 'waiting_confirmation'
    assert restore_run(row)['actions'][0]['payload']['form']['name'] == '入库验收单'
    db.commit.assert_awaited_once()
    for request_user, expected in [(user, 409), ({'tenant_id': 1, 'sub': 'other'}, 404)]:
        with pytest.raises(HTTPException) as failure:
            await mod.revise_configuration('review-test', edit(), request_user, {})
        assert failure.value.status_code == expected
    row.status = 'confirmed'
    with pytest.raises(HTTPException) as failure:
        await mod.revise_configuration('review-test', edit(confirmation_token=current['confirmation_token']), user, {})
    assert failure.value.status_code == 409


@pytest.mark.asyncio
async def test_harness_receives_complete_proposal_on_adjustment(monkeypatch):
    from app.services.ai import harness_runtime as mod, agent_registry
    from app.services.ai.schemas import AgentRequest
    from app.services.ai.settings import merge_ai_settings
    settings = merge_ai_settings({'apiKey': 'test-only-key', 'agentMode': 'confirm', 'chatModel': 'test', 'reasoningModel': 'test', 'contextPolicy': {'maxContextTokens': 24000}})
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock())
    runner = AsyncMock(return_value=SimpleNamespace(finish_reason='completed', final_response='OK', session_id='test'))
    monkeypatch.setattr(mod, 'run_sdk', runner)
    pending = {'skill': 'forms.create_form_definition', 'collected_slots': action()['payload']}
    await mod.HarnessRuntime().run(AgentRequest(message='改成必填', context={'pendingActionState': pending}),
        user={'tenant_id': 1, 'sub': 'test', 'is_admin': True, 'roles': ['admin']})
    import json
    prompt = runner.call_args.args[2]
    assert json.dumps(pending, ensure_ascii=False) in prompt


@pytest.mark.asyncio
async def test_persisted_edit_survives_reload_and_requires_new_confirmation():
    import uuid
    from sqlalchemy import select
    from app.database import init_db
    from app.core.db import db_session
    from app.models.relational import AIAgentRun, AIConversation, Form
    from app.services.ai.agent_items import confirmation_item, extract_confirmation_payload
    from app.services.ai.agent_registry import seed_agent_registry_from_files
    from app.services.ai.confirmations import create_confirmation_payload
    from app.services.ai.configuration_review import revise_configuration
    from app.services.ai.run_recovery import read_run, claim_confirmation
    from app.services.ai.settings import settings_snapshot
    from app.services.ai.tool_executor import AgentToolExecutor
    await init_db()
    await seed_agent_registry_from_files()
    user = {'tenant_id': 1, 'sub': 'review-owner', 'is_admin': True, 'roles': ['admin']}
    settings = settings_snapshot()
    settings.update(aiEnabled=True, qaEnabled=True, assistEnabled=True, agentMode='confirm')
    settings.pop('domains', None)
    proposal = action()
    code = 'review_' + uuid.uuid4().hex[:8]
    proposal['payload']['form'] = {'name': '入库单', 'code': code}
    conversation_id, run_id = uuid.uuid4().hex, uuid.uuid4().hex
    confirmation = create_confirmation_payload(user=user, actions=[proposal], risk_level='high')
    token = confirmation['confirmation_token']
    async with db_session() as db:
        db.add(AIConversation(tenant_id=1, conversation_id=conversation_id, user_id=user['sub'], title='配置编辑测试'))
        await db.flush()
        db.add(AIAgentRun(tenant_id=1, run_id=run_id, conversation_id=conversation_id, input_message='建表',
            status='waiting_confirmation', mode='agent', requires_confirmation=True, risk_level='high',
            items=[confirmation_item(confirmation_payload=confirmation)]))
        await db.commit()
    await revise_configuration(run_id, edit(confirmation_token=token), user, settings)
    restored = await read_run(run_id, user)
    updated = extract_confirmation_payload(restored['items'])
    assert restored['actions'][0]['payload']['form']['name'] == '入库验收单'
    async with db_session() as db:
        assert await db.scalar(select(Form).where(Form.code == code)) is None
    with pytest.raises(HTTPException):
        await claim_confirmation(run_id, token, user)
    claimed, replay = await claim_confirmation(run_id, updated['confirmation_token'], user)
    assert not replay
    executed = await AgentToolExecutor().execute_confirmed_run(claimed, current_user=user, settings=settings,
        persist_ai_draft=AsyncMock(), update_ai_draft_status=AsyncMock(), audit_ai_event=None)
    assert executed['status'] == 'completed', executed['tool_results']
    async with db_session() as db:
        created = await db.scalar(select(Form).where(Form.code == code))
        assert created.name == '入库验收单'


def test_native_designer_target_survives_context_trimming():
    designer = {'draft_id': 'a' * 32, 'form_id': None, 'fields': [
        {'field_name': 'quantity', 'label': '数量', 'required': True}]}
    protected = {'designerContext': designer, 'pageControlsSupported': True}
    context = {**protected, 'recent_messages': ['history' * 1000], 'evidence': {'long': 'x' * 10000}}
    result = fit_context_to_budget(context, estimate_tokens(protected) + 50)
    assert result['designerContext'] == designer and result['pageControlsSupported'] is True
