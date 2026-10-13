"""Personal workflow inbox membership and record/instance identity regressions."""
import asyncio
import json
import uuid
from datetime import datetime
from types import SimpleNamespace

from app.api.workflow import _personal_workflow_views, _workflow_business_dataset


def test_pending_is_current_node_task_not_admin_visibility():
    inst = SimpleNamespace(status='pending', initiator_id=7)
    approvals = [SimpleNamespace(approver_id=2, node_id='old', action=None, acted_at=None),
                 SimpleNamespace(approver_id=3, node_id='now', action=None, acted_at=None)]
    state = {'current_node': 'now'}
    assert _personal_workflow_views(inst, approvals, {'uid': 2, 'is_admin': True}, state) == []
    assert _personal_workflow_views(inst, approvals, {'uid': 3}, state) == ['pending']
    assert _personal_workflow_views(inst, approvals, {'uid': 7}, state) == ['initiated']


def test_processed_requires_real_acted_approve_or_reject():
    inst = SimpleNamespace(status='pending', initiator_id=7)
    approvals = [SimpleNamespace(approver_id=2, node_id='old', action='skipped', acted_at=datetime.now()),
                 SimpleNamespace(approver_id=3, node_id='old', action='approve', acted_at=datetime.now()),
                 SimpleNamespace(approver_id=4, node_id='old', action='reject', acted_at=None)]
    assert _personal_workflow_views(inst, approvals, {'uid': 2}, {}) == []
    assert _personal_workflow_views(inst, approvals, {'uid': 3}, {}) == ['processed']
    assert _personal_workflow_views(inst, approvals, {'uid': 4}, {}) == []


def test_linked_submissions_are_not_duplicated_or_overwritten_by_old_round():
    from app.core.db import db_session
    from app.database import init_db
    from app.models.relational import Form, DynamicRecord, WorkflowDef, WorkflowInstance, WorkflowApproval, User, WorkflowBinding
    uid = 90000000 + uuid.uuid4().int % 1000000
    code = f'inbox-{uuid.uuid4().hex}'
    async def run():
        await init_db()
        async with db_session() as db:
            db.add(User(id=uid, tenant_id=1, username=code, hashed_password='unused', is_active=True))
            form = Form(tenant_id=1, name=code, code=code, status='published')
            definition = WorkflowDef(tenant_id=1, name=code, status='published', config=json.dumps({'steps': [{'name': 'Review', 'node_id': 'review', 'type': 'approval'}]}))
            db.add_all([form, definition]); await db.flush()
            record = DynamicRecord(tenant_id=1, form_id=form.id, data={'title':'latest'}, status='draft', created_by=uid)
            db.add(record); await db.flush()
            db.add(WorkflowBinding(tenant_id=1, form_id=form.id, workflow_id=definition.id, enabled=True, trigger_action='submit'))
            state = json.dumps({'current_node':'review', 'current_step':0, 'resource_type':'dynamic_record',
                                'resource_id':record.id, 'variables':{'form_id':form.id,'record_id':record.id}})
            old = WorkflowInstance(tenant_id=1, workflow_id=definition.id, title='Old submission', initiator_id=uid,
                                   status='rejected', form_data='{}', workflow_state=state)
            latest = WorkflowInstance(tenant_id=1, workflow_id=definition.id, title='Latest submission', initiator_id=uid,
                                      status='pending', form_data='{}', workflow_state=state)
            db.add_all([old, latest]); await db.flush()
            db.add_all([WorkflowApproval(instance_id=old.id, approver_id=uid, node_id='review', action='reject', acted_at=datetime.now()),
                        WorkflowApproval(instance_id=latest.id, approver_id=uid, node_id='review')])
            await db.flush()
            dataset = await _workflow_business_dataset(db, {'uid':uid, 'tenant_id':1, 'is_admin':True})
            items = [item for item in dataset['items'] if (item.get('form') or {}).get('id') == form.id]
            assert len(items) == 2
            assert {item['workflow']['id'] for item in items} == {old.id, latest.id}
            newest = next(item for item in items if item['workflow']['id'] == latest.id)
            assert newest['views'] == ['pending','initiated']
            assert newest['can_approve'] is True
            older = next(item for item in items if item['workflow']['id'] == old.id)
            assert older['views'] == ['initiated','processed']
            assert older['can_approve'] is False
            payload = next(item for item in dataset['forms'] if item['id'] == form.id)
            assert payload['runtime_submission_available'] is True
            assert payload['route_path'] == f'/program/{code}'
            # A non-participant admin sees no personal task, but can follow an explicit permitted source.
            other = {'uid': uid + 2000000, 'tenant_id':1, 'is_admin':True}
            unrelated = await _workflow_business_dataset(db, other)
            assert not [item for item in unrelated['items'] if (item.get('form') or {}).get('id') == form.id]
            source = await _workflow_business_dataset(db, other, source_form_id=form.id, source_record_id=record.id)
            source_items = [item for item in source['items'] if (item.get('form') or {}).get('id') == form.id]
            assert len(source_items) == 2
            assert all(item['views'] == [] and item['can_approve'] is False for item in source_items)
            await db.rollback()
    asyncio.run(run())
