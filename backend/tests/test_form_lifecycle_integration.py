"""Real isolated SQLite business form lifecycle, never developer data."""
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import forms, workflow
from app.api.deps import get_current_user, get_db
from app.models.relational import (
    Base, Tenant, User, Role, UserRole, Form, FormField, FormPermission,
    WorkflowDefVersion, WorkflowInstance,
)
from app.services.form_approval_config import save_approval_settings


@pytest.mark.asyncio
@pytest.mark.parametrize('storage', ['dynamic', 'physical_table'])
async def test_business_draft_rejection_resubmit_approval_and_personal_history(tmp_path, monkeypatch, storage):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / (storage + ".db")}')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add(Tenant(id=1, name='isolated', slug='isolated'))
            db.add(Role(id=1, tenant_id=1, name='business', label='Business'))
            for uid, name in [(1, 'applicant'), (2, 'reviewer'), (3, 'unrelated')]:
                db.add(User(id=uid, tenant_id=1, username=name, hashed_password='test', is_active=True))
                db.add(UserRole(tenant_id=1, user_id=uid, role_id=1))
            form = Form(id=1, tenant_id=1, name='Business', code='business', status='published',
                storage_mode=storage, table_name='isolated_business_records' if storage == 'physical_table' else None)
            db.add(form)
            db.add(FormField(tenant_id=1, form_id=1, field_name='title', label='Title', field_type='string', required=True))
            db.add(FormField(tenant_id=1, form_id=1, field_name='status', label='Business state', field_type='string'))
            db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action='*', effect='allow'))
            await db.commit()
            settings = await save_approval_settings(db, 1, 1, 1, {
                'enabled': True, 'stages': [{'name': 'Review', 'approver_ids': [2], 'approval_mode': 'single'}]})
            await db.commit()
            actor = {'uid': 1, 'tenant_id': 1, 'is_admin': False}
            applicant = dict(actor)
            reviewer = {'uid': 2, 'tenant_id': 1, 'is_admin': False}
            outsider = {'uid': 3, 'tenant_id': 1, 'is_admin': False}
            app = FastAPI()
            app.include_router(forms.router, prefix='/forms')
            async def current_user():
                return actor
            async def database():
                yield db
            app.dependency_overrides[get_current_user] = current_user
            app.dependency_overrides[get_db] = database
            # Generic audit used to open another session; isolate it from the fixture.
            monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
            monkeypatch.setattr(workflow, 'write_audit_log', AsyncMock())
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
                response = await client.post('/forms/1/records', json={'data': {'status': 'Open'}})
                assert response.status_code == 200, response.text
                record = response.json()['data']
                record_id = record['id']
                path = f'/forms/1/records/{record_id}'
                assert record['status'] == 'draft'
                assert record['_approval']['can_edit'] and record['_approval']['can_submit']
                assert not (await db.scalars(select(WorkflowInstance))).all()
                incomplete = await client.post(path + '/submit', json={'expected_status': 'draft'})
                assert incomplete.status_code == 422, incomplete.text
                draft_dataset = await workflow._workflow_business_dataset(db, applicant)
                drafts = [item for item in draft_dataset['items'] if (item.get('form') or {}).get('id') == 1]
                assert len(drafts) == 1 and drafts[0]['status'] == 'draft'
                actor['tenant_id'] = 2
                assert (await client.get(path)).status_code == 404
                actor.update(applicant)
                forged = await client.put(path, json={'status': 'approved'})
                assert forged.status_code == 409, forged.text
                null_status = await client.put(path, json={'status': None, 'data': {'title': 'Temporary'}})
                assert null_status.status_code == 200, null_status.text
                assert null_status.json()['data']['status'] == 'draft'
                denial = FormPermission(tenant_id=1, form_id=1, role_id=1, action='edit', effect='deny')
                db.add(denial)
                await db.commit()
                read_only = (await client.get(path)).json()['data']['_approval']
                assert not read_only['can_edit'] and not read_only['can_submit']
                assert (await client.post(path + '/submit', json={'expected_status': 'draft'})).status_code == 403
                await db.delete(denial)
                await db.commit()

                actor.update(outsider)
                denied = await client.put(path, json={'data': {'title': 'Impersonation'}})
                assert denied.status_code == 403, denied.text
                denied = await client.post(path + '/submit', json={'expected_status': 'draft'})
                assert denied.status_code == 403, denied.text
                actor.update(applicant)
                edited = await client.put(path, json={'data': {'title': 'First submission'}})
                assert edited.status_code == 200, edited.text
                response = await client.post(path + '/submit', json={'expected_status': 'draft'})
                assert response.status_code == 200, response.text
                submitted = response.json()['data']
                assert submitted['status'] == 'pending'
                first_id = submitted['_approval']['workflow_id']
                assert first_id
                duplicate = await client.post(path + '/submit', json={'expected_status': 'draft'})
                assert duplicate.status_code == 409, duplicate.text
                assert len((await db.scalars(select(WorkflowInstance))).all()) == 1
                frozen = await client.put(path, json={'data': {'title': 'Tampered pending'}})
                assert frozen.status_code == 409, frozen.text

                # A configuration change affects the resubmission only.
                await save_approval_settings(db, 1, 1, 1, {'enabled': True, 'expected_version': settings['version'],
                    'stages': [{'name': 'New review', 'approver_ids': [2, 3], 'approval_mode': 'countersign'}]})
                await db.commit()
                first = await db.get(WorkflowInstance, first_id)
                assert first.workflow_version == 1
                with pytest.raises(HTTPException) as error:
                    await workflow._act_on_step(first_id, workflow.StepApprovalRequest(comment='Unauthorized'), 'approve', user=outsider, db=db)
                assert error.value.status_code == 403
                with pytest.raises(HTTPException) as error:
                    await workflow._act_on_step(first_id, workflow.StepApprovalRequest(comment='  '), 'reject', user=reviewer, db=db)
                assert error.value.status_code == 422
                await workflow._act_on_step(first_id, workflow.StepApprovalRequest(comment='Please correct title'), 'reject', user=reviewer, db=db)
                await db.commit()
                rejected = (await client.get(path)).json()['data']
                assert rejected['status'] == 'rejected'
                assert rejected['_approval']['can_edit'] and rejected['_approval']['can_submit']
                stale = await client.post(path + '/submit', json={'expected_status': 'draft'})
                assert stale.status_code == 409, stale.text
                revised = await client.put(path, json={'data': {'title': 'Corrected'}})
                assert revised.status_code == 200, revised.text
                response = await client.post(path + '/submit', json={'expected_status': 'rejected'})
                assert response.status_code == 200, response.text
                second_id = response.json()['data']['_approval']['workflow_id']
                assert second_id != first_id
                second = await db.get(WorkflowInstance, second_id)
                assert second.workflow_version == 2
                assert (await db.get(WorkflowInstance, first_id)).status == 'rejected'
                assert json.loads(first.form_data)['title'] == 'First submission'
                assert json.loads(second.form_data)['title'] == 'Corrected'
                dataset = await workflow._workflow_business_dataset(db, applicant)
                mine = [item for item in dataset['items'] if (item.get('form') or {}).get('id') == 1]
                assert len(mine) == 2
                latest = next(item for item in mine if item['workflow']['id'] == second_id)
                assert latest['id'] == f'record:1:{record_id}'
                processed = await workflow._workflow_business_dataset(db, reviewer)
                assert [item['workflow']['id'] for item in processed['items'] if 'processed' in item['views']] == [first_id]
                await workflow._act_on_step(second_id, workflow.StepApprovalRequest(comment='First signer accepted'), 'approve', user=reviewer, db=db)
                await db.commit()
                waiting = (await client.get(path)).json()['data']
                assert waiting['status'] == 'pending' and not waiting['_approval']['can_edit']
                await workflow._act_on_step(second_id, workflow.StepApprovalRequest(comment='Accepted'), 'approve', user=outsider, db=db)
                await db.commit()
                final = (await client.get(path)).json()['data']
                assert final['status'] == 'approved'
                assert final['data']['status'] == 'Open'
                assert not final['_approval']['can_edit'] and not final['_approval']['can_submit']
                history = final['_approval']['history']
                assert [event['action'] for event in history].count('submit') == 2
                assert [event['action'] for event in history].count('reject') == 1
                assert [event['action'] for event in history].count('approve') == 2
                assert len((await db.scalars(select(WorkflowDefVersion))).all()) == 2
                assert (await client.put(path, json={'data': {'title': 'Approved tamper'}})).status_code == 409
                assert (await client.delete(path)).status_code == 409
    finally:
        await engine.dispose()
