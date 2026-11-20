from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import ai_assistant as api
from app.core import db as db_module
from app.models.relational import AIAgentRun, AIConversation, Base, DynamicRecord, Form, FormField, Tenant, User
from app.services.ai import agent_registry, settings as ai_settings
from app.services.ai.agent_items import confirmation_item, extract_confirmation_payload
from app.services.ai.confirmations import create_confirmation_payload


FORM_CODE = 'receiving_review'
FORM_NAME = '到货验收'
FORM_ID = 17
ARCHIVE_FORM_ID = 18
RECORD_ID = 23
SUPPLIER_ID = 101
OTHER_SUPPLIER_ID = 102
RUN_ID = 'receiving-review-run'
RUN_URL = f'/api/v1/ai/agent-runs/{RUN_ID}'
DRAFT_TOOL = 'forms.create_dynamic_record_draft'
UPDATE_TOOL = 'forms.update_record'


@pytest_asyncio.fixture
async def review_environment(monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite://')
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(db_module, 'AsyncSessionLocal', factory)
        async with factory.begin() as db:
            db.add(Tenant(id=1, name='验收环境', slug='review'))
            db.add(User(id=1, tenant_id=1, username='record-review-owner', hashed_password='unused'))
            db.add(Form(id=FORM_ID, tenant_id=1, code=FORM_CODE, name=FORM_NAME, status='published'))
            db.add(Form(id=ARCHIVE_FORM_ID, tenant_id=1, code='review_suppliers', name='供应商档案', status='published'))
            db.add_all([
                FormField(tenant_id=1, form_id=FORM_ID, field_name='quantity', label='数量',
                          field_type='integer', required=True, validation={'min': 1}),
                FormField(tenant_id=1, form_id=FORM_ID, field_name='memo', label='说明', field_type='string'),
                FormField(tenant_id=1, form_id=FORM_ID, field_name='reference', label='外部编号',
                          field_type='string', ui_config={'controlType': 'readonly-text'}),
                FormField(tenant_id=1, form_id=FORM_ID, field_name='supplier', label='供应商', field_type='relation',
                          ui_config={'relation_config': {'target_form_code': 'review_suppliers', 'label_field': 'name'}}),
                FormField(tenant_id=1, form_id=ARCHIVE_FORM_ID, field_name='name', label='名称', field_type='string'),
                DynamicRecord(id=SUPPLIER_ID, tenant_id=1, form_id=ARCHIVE_FORM_ID, data={'name': '甲方供应商'}),
                DynamicRecord(id=OTHER_SUPPLIER_ID, tenant_id=1, form_id=ARCHIVE_FORM_ID, data={'name': '乙方供应商'}),
            ])

        settings = ai_settings.merge_ai_settings({
            'aiEnabled': True, 'agentMode': 'confirm', 'rolePolicies': [], 'auditEnabled': False,
        })
        skills, tools = agent_registry.load_seed_registry()
        monkeypatch.setattr(api, 'AI_SYSTEM_SETTINGS', settings)
        monkeypatch.setattr(ai_settings, 'AI_SYSTEM_SETTINGS', settings)
        monkeypatch.setattr(api, '_load_effective_ai_settings', AsyncMock())
        monkeypatch.setattr(api, 'load_agent_registry', AsyncMock(return_value={'skills': skills, 'tools': tools}))

        owner = {'tenant_id': 1, 'uid': 1, 'sub': 'record-review-owner', 'is_admin': True}
        app = FastAPI()
        app.include_router(api.router, prefix='/api/v1/ai')
        app.dependency_overrides[api.get_current_user] = lambda: owner
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            yield client, factory, owner
    finally:
        await engine.dispose()


async def seed_proposal(factory, owner, tool, **payload):
    conversation_id = 'receiving-review-conversation'
    actions = [{
        'skill': tool,
        'title': '到货验收记录',
        'mode': 'confirmed_write',
        'risk_level': 'medium',
        'requires_confirmation': True,
        'payload': {**payload, '_harness_tool': tool, '_contract': {'tool': tool}},
    }]
    confirmation = create_confirmation_payload(user=owner, actions=actions)
    async with factory.begin() as db:
        db.add(AIConversation(tenant_id=1, conversation_id=conversation_id, user_id=owner['sub'], title='到货验收'))
        db.add(AIAgentRun(
            tenant_id=1, run_id=RUN_ID, conversation_id=conversation_id, input_message='准备到货验收',
            mode='agentic', status='waiting_confirmation', risk_level='medium', requires_confirmation=True,
            items=[confirmation_item(confirmation_payload=confirmation, run_id=RUN_ID)],
            actions=actions, confirmation_payload=confirmation,
        ))
    return confirmation['confirmation_token']


async def read_business_data(factory):
    async with factory() as db:
        rows = (await db.scalars(select(DynamicRecord).where(DynamicRecord.form_id == FORM_ID))).all()
    return [row.data for row in rows]


async def read_proposal(factory):
    async with factory() as db:
        run = await db.scalar(select(AIAgentRun).where(AIAgentRun.run_id == RUN_ID))
        return run.status, run.confirmation_payload


async def revise(client, token, data):
    return await client.post(f'{RUN_URL}/record-review/revise', json={
        'confirmation_token': token, 'edits': [{'action_index': 0, 'data': data}],
    })


async def confirm(client, token):
    return await client.post(f'{RUN_URL}/confirm', json={'confirmation_token': token, 'confirmed': True})


@pytest.mark.asyncio
async def test_revising_a_record_draft_changes_the_proposal_before_writing(review_environment):
    client, factory, owner = review_environment
    token = await seed_proposal(factory, owner, DRAFT_TOOL, form_code=FORM_CODE,
                                data={'quantity': 2, 'memo': '初稿', 'supplier': SUPPLIER_ID, 'reference': None})

    detail = await client.post(f'{RUN_URL}/record-review', json={'confirmation_token': token, 'action_index': 0})
    assert detail.status_code == 200, detail.text
    details = detail.json()
    assert details['form_id'] == FORM_ID
    assert details['form_name'] == FORM_NAME
    fields = {field['name']: field for field in details['fields']}
    assert fields['quantity']['kind'] == 'number'
    assert fields['quantity']['value'] == 2
    assert fields['quantity']['required'] is True
    assert fields['memo']['kind'] == 'text'
    assert fields['memo']['value'] == '初稿'
    assert fields['supplier']['kind'] == 'relation'
    assert fields['supplier']['value'] == SUPPLIER_ID
    assert fields['supplier']['display_value'] == '甲方供应商'
    assert fields['reference']['readonly'] is True

    changed_data = {'quantity': 6, 'memo': '已清点', 'supplier': OTHER_SUPPLIER_ID}
    revised = await revise(client, token, changed_data)
    assert revised.status_code == 200, revised.text
    assert revised.json()['run_id'] == RUN_ID
    assert revised.json()['requires_confirmation'] is True
    new_confirmation = extract_confirmation_payload(revised.json()['items'])
    new_token = new_confirmation['confirmation_token']
    assert new_token != token
    _, proposal = await read_proposal(factory)
    assert proposal['actions'][0]['payload']['data'] == {**changed_data, 'reference': None}
    assert await read_business_data(factory) == []

    stale = await confirm(client, token)
    assert stale.status_code in {404, 409}, stale.text
    assert await read_business_data(factory) == []
    result = await confirm(client, new_token)
    assert result.status_code == 200, result.text
    assert result.json()['data']['status'] == 'completed', result.text
    assert await read_business_data(factory) == [changed_data]


@pytest.mark.asyncio
async def test_revising_an_update_preserves_its_original_conflict_check(review_environment):
    client, factory, owner = review_environment
    async with factory.begin() as db:
        db.add(DynamicRecord(id=RECORD_ID, tenant_id=1, form_id=FORM_ID, data={'quantity': 3, 'memo': '原值'}))
    token = await seed_proposal(factory, owner, UPDATE_TOOL, form_code=FORM_CODE, record_id=RECORD_ID,
                                data={'quantity': 6}, expected_values={'quantity': 3})
    revised = await revise(client, token, {'quantity': 9})
    assert revised.status_code == 200, revised.text
    _, proposal = await read_proposal(factory)
    assert proposal['actions'][0]['payload']['expected_values'] == {'quantity': 3}
    assert proposal['actions'][0]['payload']['data'] == {'quantity': 9}
    assert await read_business_data(factory) == [{'quantity': 3, 'memo': '原值'}]

    async with factory.begin() as db:
        record = await db.get(DynamicRecord, RECORD_ID)
        record.data = {**record.data, 'quantity': 4}
    result = await confirm(client, proposal['confirmation_token'])
    assert result.status_code == 200, result.text
    assert result.json()['data']['status'] == 'failed', result.text
    assert await read_business_data(factory) == [{'quantity': 4, 'memo': '原值'}]


@pytest.mark.asyncio
async def test_rejects_revision_if_the_proposal_baseline_is_already_stale(review_environment):
    client, factory, owner = review_environment
    async with factory.begin() as db:
        db.add(DynamicRecord(id=RECORD_ID, tenant_id=1, form_id=FORM_ID, data={'quantity': 4}))
    token = await seed_proposal(factory, owner, UPDATE_TOOL, form_code=FORM_CODE, record_id=RECORD_ID,
                                data={'quantity': 6}, expected_values={'quantity': 3})
    detail = await client.post(f'{RUN_URL}/record-review', json={'confirmation_token': token, 'action_index': 0})
    assert detail.status_code == 409, detail.text
    rejected = await revise(client, token, {'quantity': 9})
    assert rejected.status_code == 409, rejected.text
    status, proposal = await read_proposal(factory)
    assert status == 'waiting_confirmation'
    assert proposal['confirmation_token'] == token
    assert proposal['actions'][0]['payload']['expected_values'] == {'quantity': 3}
    assert await read_business_data(factory) == [{'quantity': 4}]


@pytest.mark.asyncio
async def test_rejects_invalid_fields_and_foreign_users_without_replacing_the_proposal(review_environment):
    client, factory, owner = review_environment
    original = {'quantity': 2, 'supplier': SUPPLIER_ID, 'reference': None}
    token = await seed_proposal(factory, owner, DRAFT_TOOL, form_code=FORM_CODE, data=original)
    for data, expected_status in (
        ({'unknown_field': '不允许'}, 403),
        ({'reference': '不能修改'}, 403),
        ({'quantity': '不是数字'}, 422),
        ({'supplier': 999}, 422),
    ):
        rejected = await revise(client, token, data)
        assert rejected.status_code == expected_status, rejected.text

    owner['is_admin'] = False
    rejected = await revise(client, token, {'quantity': 5})
    assert rejected.status_code == 403, rejected.text

    owner['is_admin'] = True
    owner['sub'] = 'different-user'
    detail = await client.post(f'{RUN_URL}/record-review', json={'confirmation_token': token, 'action_index': 0})
    assert detail.status_code == 404, detail.text
    rejected = await revise(client, token, {'quantity': 5})
    assert rejected.status_code == 404, rejected.text
    assert await read_business_data(factory) == []
    status, proposal = await read_proposal(factory)
    assert status == 'waiting_confirmation'
    assert proposal['confirmation_token'] == token
    assert proposal['actions'][0]['payload']['data'] == original
