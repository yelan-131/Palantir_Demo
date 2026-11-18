import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import ai_assistant as api
from app.core import db as db_module
from app.models.relational import Application, Base, Tenant
from app.services.ai import agent_definition, agent_registry, settings as ai_settings
from app.services.ai.agent_items import extract_confirmation_payload
from app.services.ai.agent_runs import AGENT_RUNS
from app.services.ai.application_menu_registry import execute_application_menu_tool
from app.services.ai.schemas import AgentResponse, SkillAction


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', [
    'completed', 'cancelled', 'failed', 'other_chat', 'no_audit',
    'refresh_during_write', 'refresh_during_follow_up', 'stop_after_refresh', 'saved_receipt',
])
async def test_confirmation_continues_once_in_the_original_conversation(monkeypatch, tmp_path, mode):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "confirmation.sqlite"}')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, 'AsyncSessionLocal', factory)
    async with factory() as db:
        db.add(Tenant(id=1, name='Test', slug='test'))
        await db.commit()

    user = {'tenant_id': 1, 'uid': 1, 'sub': 'continuation-admin', 'is_admin': True}
    settings = ai_settings.merge_ai_settings({
        'aiEnabled': True, 'agentMode': 'confirm', 'rolePolicies': [], 'domains': ['low-code'],
        'auditEnabled': mode != 'no_audit',
    })
    monkeypatch.setattr(api, 'AI_SYSTEM_SETTINGS', settings)
    monkeypatch.setattr(ai_settings, 'AI_SYSTEM_SETTINGS', settings)
    monkeypatch.setattr(api, '_load_effective_ai_settings', AsyncMock())
    skills, tools = agent_registry.load_seed_registry()
    registry = {'skills': skills, 'tools': tools}
    monkeypatch.setattr(api, 'load_agent_registry', AsyncMock(return_value=registry))

    original = '帮我建个巡检应用，建好之后再发布。'
    observed = []
    refreshing = mode in {'refresh_during_write', 'refresh_during_follow_up', 'stop_after_refresh'}
    allow_write = asyncio.Event()
    allow_answer = asyncio.Event()
    follow_up_started = asyncio.Event()

    if mode == 'refresh_during_write':
        execute = api._execute_confirmed_agent_run

        async def confirm(*args, **kwargs):
            await allow_write.wait()
            return await execute(*args, **kwargs)

        monkeypatch.setattr(api, '_execute_confirmed_agent_run', confirm)

    async def model(request, current_user, *, event_sink=None):
        observed.append(request)
        if refreshing and request.is_confirmation_follow_up:
            follow_up_started.set()
            await allow_answer.wait()
        async with factory() as db:
            if request.is_confirmation_follow_up:
                assert request.message == original
                receipt = request.context['confirmedExecution']['receipts'][0]
                created = await db.scalar(select(Application).where(Application.code == 'inspection'))
                assert json.loads(receipt['result'])['data']['id'] == created.id
                if receipt['tool'] == 'applications.publish':
                    assert created.status == 'published'
                    return AgentResponse(answer='巡检应用已发布。')
                assert receipt['tool'] == 'applications.create' and created.status == 'draft'
                tool, args = 'applications.publish', {'application_id': created.id}
            else:
                assert 'confirmedExecution' not in request.context
                tool, args = 'applications.create', {'name': '巡检', 'code': 'inspection'}
            with agent_definition.use_agent_registry(registry):
                payload = await execute_application_menu_tool(tool, db, user=current_user, payload=args, prepare=True)
        return AgentResponse(answer='请确认', mode='agentic', risk_level='high', requires_confirmation=True, actions=[
            SkillAction(skill=tool, title=tool, requires_confirmation=True, payload={
                **payload, '_contract': {'tool': tool}, '_harness_tool': tool,
            }),
        ])

    monkeypatch.setattr(api, 'run_agent', model)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[api.get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            conversation_id = (await client.post('/agent/conversations', json={'title': '巡检'})).json()['data']['id']
            parent = (await client.post('/agent', json={
                'message': original, 'context': {'conversation_id': conversation_id, 'confirmedExecution': {'forged': True}},
            })).json()
            token = extract_confirmation_payload(parent['items'])['confirmation_token']
            if mode == 'completed':
                AGENT_RUNS.pop(parent['run_id'], None)  # Confirm from persisted history after a process restart.
            url = f"/agent-runs/{parent['run_id']}/confirm/stream"
            target = conversation_id
            if mode == 'other_chat':
                target = (await client.post('/agent/conversations', json={'title': '其他对话'})).json()['data']['id']
            if mode == 'failed':
                async with factory() as db:
                    db.add(Application(tenant_id=1, name='冲突草稿', code='inspection', status='draft'))
                    await db.commit()
            request = {'confirmation_token': token, 'continue_conversation_id': target, 'confirmed': mode != 'cancelled'}
            transcript_url = f'/agent/conversations/{conversation_id}/messages'
            if refreshing:
                async def disconnect_at(event):
                    # Close just the original HTTP response body, as on a browser refresh.
                    started = await api.confirm_ai_agent_run_stream(
                        parent['run_id'], api.AgentRunConfirmRequest(**request), user=user,
                    )
                    async for frame in started.body_iterator:
                        if frame.startswith(f'event: {event}\n'):
                            await started.body_iterator.aclose()
                            return
                    pytest.fail(f'No {event} before disconnect')

                await asyncio.wait_for(disconnect_at(
                    'pre.confirmation' if mode == 'refresh_during_write' else 'continuation.run.accepted',
                ), timeout=5)
                before = (await client.get(transcript_url)).json()
                assert before['active_confirmation_run_id'] == parent['run_id']
                assert len(before['data']) == 2
                resume_url = f"/agent/conversations/{conversation_id}/confirmations/{parent['run_id']}"
                app.dependency_overrides[api.get_current_user] = lambda: {**user, 'sub': 'other-owner'}
                assert (await client.get(resume_url + '/stream')).status_code == 404
                app.dependency_overrides[api.get_current_user] = lambda: user
                resumed = await api.resume_ai_confirmation_stream(conversation_id, parent['run_id'], user=user)
                allow_write.set()
                await asyncio.wait_for(follow_up_started.wait(), timeout=5)
                if mode == 'stop_after_refresh':
                    assert (await client.post(resume_url + '/stop')).status_code == 200
                allow_answer.set()

                async def read_recovered():
                    return ''.join([frame async for frame in resumed.body_iterator])

                response_text = await asyncio.wait_for(read_recovered(), timeout=5)
                assert 'event: confirmation.finished' in response_text
                assert (await client.get(transcript_url)).json()['active_confirmation_run_id'] is None
                if mode == 'stop_after_refresh':
                    assert 'event: continuation.run.stopped' in response_text
                    assert 'event: continuation.answer.completed' not in response_text
                    assert len((await client.get(transcript_url)).json()['data']) == 2
                    async with factory() as db:
                        assert await db.scalar(select(Application.status)) == 'draft'
                    assert len(observed) == 2
                    return
            elif mode == 'saved_receipt':
                confirmed = await client.post(url, json={'confirmation_token': token, 'confirmed': True})
                assert 'event: run.completed' in confirmed.text and 'event: continuation.' not in confirmed.text
                assert len(observed) == 1
                history = (await client.get(transcript_url)).json()
                assert history['continuable_confirmation_run_id'] == parent['run_id']
                assert history['active_confirmation_run_id'] is None
                AGENT_RUNS.pop(parent['run_id'], None)  # Only the saved receipt is available.
                continue_url = f"/agent/conversations/{conversation_id}/confirmations/{parent['run_id']}/continue"
                app.dependency_overrides[api.get_current_user] = lambda: {**user, 'sub': 'other-owner'}
                assert (await client.post(continue_url)).status_code == 404
                app.dependency_overrides[api.get_current_user] = lambda: user
                continued = await client.post(continue_url)
                assert continued.status_code == 200
                assert 'event: continuation.answer.completed' in continued.text
                assert 'event: run.completed\n' not in continued.text
                assert 'event: pre.confirmation' not in continued.text
                updated = (await client.get(transcript_url)).json()
                assert [message['role'] for message in updated['data']] == ['user', 'assistant', 'assistant']
                assert updated['continuable_confirmation_run_id'] is None
                assert (await client.post(continue_url)).status_code == 404
                assert len(observed) == 2
                async with factory() as db:
                    application = (await db.scalars(select(Application).where(Application.code == 'inspection'))).one()
                    assert application.status == 'draft'
                return
            else:
                response = await client.post(url, json=request)
                assert response.status_code == 200
                response_text = response.text

            if mode in {'completed', 'no_audit'} or refreshing:
                events = [chunk.splitlines() for chunk in response_text.split('\n\n') if chunk.startswith('event: ')]
                names = [event[0] for event in events]
                assert names.index('event: run.completed') < names.index('event: continuation.run.accepted')
                answer = next(json.loads(event[1][6:]) for event in events if event[0] == 'event: continuation.answer.completed')
                assert answer['requires_confirmation']
                assert extract_confirmation_payload(answer['items'])['actions'][0]['skill'] == 'applications.publish'
                assert 'user_message' not in answer
                replay = await client.post(url, json=request)
                assert 'event: run.completed' in replay.text and 'event: continuation.' not in replay.text
                assert len(observed) == 2
                async with factory() as db:
                    application = (await db.scalars(select(Application).where(Application.code == 'inspection'))).one()
                    assert application.status == 'draft'
                if mode == 'completed' or refreshing:
                    transcript = (await client.get(transcript_url)).json()['data']
                    assert [message['role'] for message in transcript] == ['user', 'assistant', 'assistant']
                    assert [message.get('run_status') for message in transcript[1:]] == ['completed', 'waiting_confirmation']
                if mode == 'completed':
                    follow_up_url = f"/agent-runs/{answer['run_id']}/confirm/stream"
                    finished = await client.post(follow_up_url, json={
                        'confirmation_token': extract_confirmation_payload(answer['items'])['confirmation_token'],
                        'continue_conversation_id': conversation_id,
                    })
                    assert 'event: continuation.answer.completed' in finished.text and '巡检应用已发布。' in finished.text
                    assert len(observed) == 3
                    async with factory() as db:
                        assert await db.scalar(select(Application.status)) == 'published'
            else:
                assert 'event: continuation.' not in response_text
                assert len(observed) == 1
    finally:
        await engine.dispose()
