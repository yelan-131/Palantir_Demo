"""Approval notifications exercised against isolated databases, never live data."""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import forms, workflow, notifications
from app.api.deps import get_current_user, get_db
from app.models.relational import Base, Tenant, User, Role, UserRole, Form, FormField, FormPermission, Notification, WorkflowInstance
from app.services.form_approval_config import save_approval_settings


@asynccontextmanager
async def isolated_flow(tmp_path, monkeypatch, storage='dynamic', stages=None):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / (storage + ".db")}')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add_all([Tenant(id=1, name='isolated', slug='isolated'), Tenant(id=2, name='other', slug='other')])
            db.add(Role(id=1, tenant_id=1, name='business', label='Business'))
            for uid in range(1, 5):
                db.add(User(id=uid, tenant_id=1 if uid < 4 else 2, username=f'user{uid}', hashed_password='test', is_active=True))
                if uid < 4:
                    db.add(UserRole(tenant_id=1, user_id=uid, role_id=1))
            db.add(Form(id=1, tenant_id=1, name='Business', code='business', status='published', storage_mode=storage,
                        table_name='isolated_business_records' if storage == 'physical_table' else None))
            db.add(FormField(tenant_id=1, form_id=1, field_name='title', label='Title', field_type='string', required=True))
            db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='*', effect='allow'))
            await db.commit()
            await save_approval_settings(db, 1, 1, 1, {'enabled': True, 'stages': stages or [
                {'name': 'Review', 'approver_ids': [2, 3], 'approval_mode': 'countersign'}]})
            await db.commit()
            actor = {'uid': 1, 'tenant_id': 1, 'is_admin': False}
            app = FastAPI()
            app.include_router(forms.router, prefix='/forms')
            app.include_router(notifications.router, prefix='/notifications')
            async def database():
                yield db
            async def current_user():
                return actor
            async def execute_in_fixture(fn):
                return await fn(db)
            app.dependency_overrides[get_current_user] = current_user
            app.dependency_overrides[get_db] = database
            monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
            monkeypatch.setattr(workflow, 'write_audit_log', AsyncMock())
            monkeypatch.setattr(notifications, '_try_db', execute_in_fixture)
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
                yield db, actor, client
    finally:
        await engine.dispose()


async def all_notifications(db):
    return list((await db.scalars(select(Notification).order_by(Notification.id))).all())


async def draft_and_submit(client):
    draft = await client.post('/forms/1/records', json={'data': {'title': 'Application'}})
    assert draft.status_code == 200, draft.text
    path = f"/forms/1/records/{draft.json()['data']['id']}"
    submitted = await client.post(path + '/submit', json={'expected_status': 'draft'})
    assert submitted.status_code == 200, submitted.text
    return path, submitted.json()['data']['_approval']['workflow_id']


@pytest.mark.asyncio
@pytest.mark.parametrize('storage', ['dynamic', 'physical_table'])
async def test_submission_rejection_resubmission_countersign_notifications(tmp_path, monkeypatch, storage):
    async with isolated_flow(tmp_path, monkeypatch, storage) as (db, actor, client):
        draft = await client.post('/forms/1/records', json={'data': {}})
        assert draft.status_code == 200, draft.text
        path = f"/forms/1/records/{draft.json()['data']['id']}"
        assert await all_notifications(db) == []
        invalid = await client.post(path + '/submit', json={'expected_status': 'draft'})
        assert invalid.status_code == 422
        assert await all_notifications(db) == []
        assert (await client.put(path, json={'data': {'title': 'First request'}})).status_code == 200
        submitted = await client.post(path + '/submit', json={'expected_status': 'draft'})
        assert submitted.status_code == 200, submitted.text
        first_id = submitted.json()['data']['_approval']['workflow_id']
        pending = await all_notifications(db)
        assert sorted(n.user_id for n in pending) == [2, 3]
        for note in pending:
            assert note.tenant_id == 1 and note.resource_type == 'workflow_instance' and note.resource_id == first_id
            assert parse_qs(urlparse(note.link).query)['instance_id'] == [str(first_id)]
        assert (await client.post(path + '/submit', json={'expected_status': 'draft'})).status_code == 409
        assert len(await all_notifications(db)) == 2
        reviewer = {'uid': 2, 'tenant_id': 1, 'is_admin': False}
        with pytest.raises(HTTPException):
            await workflow._act_on_step(first_id, workflow.StepApprovalRequest(comment=''), 'reject', user=reviewer, db=db)
        assert len(await all_notifications(db)) == 2
        await workflow._act_on_step(first_id, workflow.StepApprovalRequest(comment='Please correct'), 'reject', user=reviewer, db=db)
        await db.commit()
        result_notes = [n for n in await all_notifications(db) if n.user_id == 1]
        assert len(result_notes) == 1 and result_notes[0].resource_id == first_id
        actor['uid'] = 2
        stale_feed = (await client.get('/notifications')).json()['data']
        assert all(note['actionable'] is False for note in stale_feed)
        actor['uid'] = 1
        applicant_feed = (await client.get('/notifications')).json()['data']
        assert applicant_feed[0]['category'] == 'result'
        assert parse_qs(urlparse(applicant_feed[0]['target_url']).query)['tab'] == ['initiated']
        assert 'Please correct' in result_notes[0].content
        assert (await client.put(path, json={'data': {'title': 'Corrected'}})).status_code == 200
        resubmitted = await client.post(path + '/submit', json={'expected_status': 'rejected'})
        assert resubmitted.status_code == 200, resubmitted.text
        second_id = resubmitted.json()['data']['_approval']['workflow_id']
        assert second_id != first_id
        assert sorted(n.user_id for n in await all_notifications(db) if n.resource_id == second_id) == [2, 3]
        await workflow._act_on_step(second_id, workflow.StepApprovalRequest(comment='First signature'), 'approve', user=reviewer, db=db)
        await db.commit()
        assert len([n for n in await all_notifications(db) if n.user_id == 1]) == 1
        await workflow._act_on_step(second_id, workflow.StepApprovalRequest(comment='Accepted'), 'approve',
                                    user={'uid': 3, 'tenant_id': 1, 'is_admin': False}, db=db)
        await db.commit()
        results = [n for n in await all_notifications(db) if n.user_id == 1]
        assert len(results) == 2 and results[-1].resource_id == second_id
        assert parse_qs(urlparse(results[-1].link).query)['instance_id'] == [str(second_id)]
        with pytest.raises(HTTPException) as exc:
            await workflow._act_on_step(second_id, workflow.StepApprovalRequest(comment='Again'), 'approve', user=reviewer, db=db)
        assert exc.value.status_code == 409
        assert len([n for n in await all_notifications(db) if n.user_id == 1]) == 2


@pytest.mark.asyncio
async def test_next_stage_notifies_new_assignee_and_rollback_emits_no_result(tmp_path, monkeypatch):
    stages = [{'name': 'First', 'approver_ids': [2], 'approval_mode': 'single'},
              {'name': 'Second', 'approver_ids': [3], 'approval_mode': 'single'}]
    async with isolated_flow(tmp_path, monkeypatch, stages=stages) as (db, actor, client):
        _, instance_id = await draft_and_submit(client)
        assert [n.user_id for n in await all_notifications(db)] == [2]
        await workflow._act_on_step(instance_id, workflow.StepApprovalRequest(comment='First accepted'), 'approve',
                                    user={'uid': 2, 'tenant_id': 1, 'is_admin': False}, db=db)
        await db.commit()
        assert [n.user_id for n in await all_notifications(db)] == [2, 3]
        await workflow._act_on_step(instance_id, workflow.StepApprovalRequest(comment='Final accepted'), 'approve',
                                    user={'uid': 3, 'tenant_id': 1, 'is_admin': False}, db=db)
        await db.rollback()
        assert [n.user_id for n in await all_notifications(db)] == [2, 3]
        instance = await db.get(WorkflowInstance, instance_id)
        assert instance.status not in {'approved', 'completed'}
        await workflow._act_on_step(instance_id, workflow.StepApprovalRequest(comment='Final accepted'), 'approve',
                                    user={'uid': 3, 'tenant_id': 1, 'is_admin': False}, db=db)
        await db.commit()
        assert [n.user_id for n in await all_notifications(db)] == [2, 3, 1]


@pytest.mark.asyncio
async def test_real_notification_unread_counts_and_recipient_tenant_isolation(tmp_path, monkeypatch):
    async with isolated_flow(tmp_path, monkeypatch) as (db, actor, client):
        _, instance_id = await draft_and_submit(client)
        db.add(Notification(tenant_id=2, user_id=2, title='Other tenant', type='info', is_read=False))
        await db.commit()
        actor['uid'] = 2
        mine = await client.get('/notifications', params={'page_size': 1})
        assert mine.status_code == 200, mine.text
        body = mine.json()
        assert body['total'] == 1 and body['unread_count'] == 1
        assert body['data'][0]['resource_id'] == instance_id
        assert body['data'][0]['actionable'] is True
        assert parse_qs(urlparse(body['data'][0]['target_url']).query)['instance_id'] == [str(instance_id)]
        own_id = body['data'][0]['id']
        other_id = next(n.id for n in await all_notifications(db) if n.tenant_id == 1 and n.user_id == 3)
        assert (await client.get('/notifications', params={'user_id': 3})).status_code == 403
        assert (await client.post(f'/notifications/{other_id}/read')).status_code == 404
        assert (await client.post('/notifications/read-all', json={'user_id': 3})).status_code == 403
        assert (await client.post(f'/notifications/{own_id}/read')).status_code == 200
        read_page = (await client.get('/notifications', params={'is_read': 'true'})).json()
        assert read_page['total'] == 1 and read_page['unread_count'] == 0
        assert (await client.get('/notifications/unread-count')).json()['unread_count'] == 0
        actor['tenant_id'] = 2
        assert (await client.post(f'/notifications/{own_id}/read')).status_code == 404
        actor.update(uid=2, tenant_id=1, is_admin=True)
        assert (await client.post(f'/notifications/{other_id}/read')).status_code == 404


@pytest.mark.asyncio
async def test_notification_helper_dedupes_stage_and_terminal_result_in_transaction(tmp_path, monkeypatch):
    from app.services.approval_notifications import notify_pending, notify_result
    async with isolated_flow(tmp_path, monkeypatch) as (db, actor, client):
        _, instance_id = await draft_and_submit(client)
        initial = await all_notifications(db)
        initial[0].is_read = True
        await db.commit()
        await notify_pending(db, 1, [2, 2, 3, 4, 999], 'Application', instance_id)
        await notify_pending(db, 1, [2, 3], 'Application', instance_id)
        await db.commit()
        assert sorted(n.user_id for n in await all_notifications(db)) == [2, 3]
        inst = await db.get(WorkflowInstance, instance_id)
        await notify_result(db, inst)
        assert len(await all_notifications(db)) == 2
        reviewer = {'uid': 2, 'tenant_id': 1, 'is_admin': False}
        await workflow._act_on_step(instance_id, workflow.StepApprovalRequest(comment='Declined'), 'reject', user=reviewer, db=db)
        await notify_result(db, inst, action='reject', comment='Declined')
        await notify_result(db, inst, action='reject', comment='Repeated')
        await db.commit()
        assert sorted(n.user_id for n in await all_notifications(db)) == [1, 2, 3]
        await notify_pending(db, 1, [2, 3], 'Old closed task', instance_id)
        assert len(await all_notifications(db)) == 3


@pytest.mark.asyncio
async def test_failed_next_stage_rolls_back_approval_and_notifications(tmp_path, monkeypatch):
    from app.models.relational import WorkflowApproval
    stages = [{'name': 'First', 'approver_ids': [2], 'approval_mode': 'single'},
              {'name': 'Second', 'approver_ids': [3], 'approval_mode': 'single'}]
    async with isolated_flow(tmp_path, monkeypatch, stages=stages) as (db, actor, client):
        _, instance_id = await draft_and_submit(client)
        third = await db.get(User, 3)
        third.is_active = False
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            async with db.begin_nested():
                await workflow._act_on_step(instance_id, workflow.StepApprovalRequest(comment='Accepted'), 'approve',
                                            user={'uid': 2, 'tenant_id': 1, 'is_admin': False}, db=db)
        assert exc.value.status_code == 409
        assert [n.user_id for n in await all_notifications(db)] == [2]
        approval = await db.scalar(select(WorkflowApproval).where(WorkflowApproval.instance_id == instance_id))
        assert approval.action is None


@pytest.mark.asyncio
async def test_same_approver_in_two_stages_gets_fresh_next_stage_reminder(tmp_path, monkeypatch):
    stages = [{'name': 'First', 'approver_ids': [2], 'approval_mode': 'single'},
              {'name': 'Second', 'approver_ids': [2], 'approval_mode': 'single'}]
    async with isolated_flow(tmp_path, monkeypatch, stages=stages) as (db, actor, client):
        _, instance_id = await draft_and_submit(client)
        first_note = (await all_notifications(db))[0]
        first_note.is_read = True
        await db.commit()
        await workflow._act_on_step(instance_id, workflow.StepApprovalRequest(comment='First accepted'), 'approve',
                                    user={'uid': 2, 'tenant_id': 1, 'is_admin': False}, db=db)
        await db.commit()
        notes = await all_notifications(db)
        assert len(notes) == 2 and [n.user_id for n in notes] == [2, 2]
        assert notes[0].is_read is True and notes[1].is_read is False
        assert notes[0].link != notes[1].link
        actor['uid'] = 2
        feed = (await client.get('/notifications')).json()
        assert feed['unread_count'] == 1
        assert feed['data'][0]['actionable'] is True
        old_metadata = next(item for item in feed['data'] if item['id'] == first_note.id)
        assert old_metadata['actionable'] is False and old_metadata['can_approve'] is False
        assert 'tab=processed' in old_metadata['target_url']


def test_notification_navigation_preserves_legacy_stage_compatibility():
    from types import SimpleNamespace
    from app.services.approval_notifications import notification_navigation
    context = {7: {'can_approve': True, 'views': ['pending', 'processed'],
                   'raw_status': 'pending', 'notification_stage': 'second'}}
    old = SimpleNamespace(type='approval', resource_type='workflow_instance', resource_id=7,
                          link='/workflow?tab=pending&instance_id=7&node_id=first')
    metadata = notification_navigation(old, context)
    assert metadata['actionable'] is False and metadata['can_approve'] is False
    assert 'tab=processed' in metadata['target_url']
    old.link = '/workflow?tab=pending'
    assert notification_navigation(old, context)['actionable'] is True
    old.link = '/workflow?tab=pending&instance_id=7&node_id=second'
    assert notification_navigation(old, context)['actionable'] is True
