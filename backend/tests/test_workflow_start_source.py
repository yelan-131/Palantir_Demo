"""Manually started workflows must not attach to another form's record by a bare id."""
import asyncio
import json
import uuid

from fastapi.testclient import TestClient


def test_untagged_instance_attaches_only_to_a_bound_form():
    from app.api.workflow import _instance_read_view
    from app.services.workflow_views import _workflow_business_dataset
    from app.core.db import db_session
    from app.database import init_db
    from app.models.relational import DynamicRecord, Form, User, WorkflowApproval, WorkflowBinding, WorkflowDef, WorkflowInstance

    owner = 91000000 + uuid.uuid4().int % 1000000
    initiator = owner + 1
    code = f'start-source-{uuid.uuid4().hex}'

    async def run():
        await init_db()
        async with db_session() as db:
            db.add_all([User(id=owner, tenant_id=1, username=code, hashed_password='unused', is_active=True),
                        User(id=initiator, tenant_id=1, username=f'{code}-i', hashed_password='unused', is_active=True)])
            form = Form(tenant_id=1, name=code, code=code, status='published')
            config = json.dumps({'steps': [{'name': 'Review', 'node_id': 'review', 'type': 'approval'}]})
            unrelated = WorkflowDef(tenant_id=1, name=f'{code}-unrelated', status='published', config=config)
            bound = WorkflowDef(tenant_id=1, name=f'{code}-bound', status='published', config=config)
            db.add_all([form, unrelated, bound]); await db.flush()
            record = DynamicRecord(tenant_id=1, form_id=form.id, data={'title': 'owned'}, status='active', created_by=owner)
            db.add(record); await db.flush()
            db.add(WorkflowBinding(tenant_id=1, form_id=form.id, workflow_id=bound.id, enabled=True, trigger_action='submit'))
            state = json.dumps({'current_node': 'review', 'current_step': 0,
                                'resource_type': 'dynamic_record', 'resource_id': record.id, 'variables': {}})
            stray = WorkflowInstance(tenant_id=1, workflow_id=unrelated.id, title='Stray', initiator_id=initiator,
                                     status='pending', form_data=json.dumps({'title': 'foreign'}), workflow_state=state)
            legacy = WorkflowInstance(tenant_id=1, workflow_id=bound.id, title='Legacy', initiator_id=owner,
                                      status='pending', form_data='{}', workflow_state=state)
            db.add_all([stray, legacy]); await db.flush()
            approval = WorkflowApproval(instance_id=stray.id, approver_id=initiator, node_id='review')
            db.add(approval); await db.flush()

            dataset = await _workflow_business_dataset(db, {'uid': owner, 'tenant_id': 1, 'is_admin': True})
            linked = {item['workflow']['id'] for item in dataset['items'] if (item.get('form') or {}).get('id') == form.id}
            assert stray.id not in linked
            assert legacy.id in linked

            view = await _instance_read_view(db, stray, [approval], {'uid': initiator, 'tenant_id': 1})
            assert view is not None and view[0] == {'title': 'foreign'}
            assert await _instance_read_view(db, stray, [approval], {'uid': owner, 'tenant_id': 1}) is None
            await db.rollback()

    asyncio.run(run())


def test_start_requires_readable_source_form_for_record_links():
    from app.main import app
    from tests.test_ready_path_smoke import _admin_headers, _assert_ok

    suffix = uuid.uuid4().hex[:10]
    with TestClient(app) as client:
        headers = _admin_headers()
        form_id = _assert_ok(client.post('/api/v1/forms', headers=headers, json={
            'name': f'Start Source {suffix}', 'code': f'start_source_{suffix}', 'status': 'published'}),
            context='create form')['data']['id']
        _assert_ok(client.post(f'/api/v1/forms/{form_id}/fields', headers=headers, json={
            'field_name': 'title', 'label': '标题', 'field_type': 'string'}), context='create field')
        _assert_ok(client.post(f'/api/v1/forms/{form_id}/publish', headers=headers), context='publish form')
        record_id = _assert_ok(client.post(f'/api/v1/forms/{form_id}/records', headers=headers,
            json={'data': {'title': 'source'}}), context='create record')['data']['id']
        workflow_id = _assert_ok(client.post('/api/v1/workflow/definitions', headers=headers, json={
            'name': f'Start Source {suffix}', 'status': 'published',
            'steps': [{'name': 'Submit', 'type': 'start'}, {'name': 'Approve', 'type': 'approval'}, {'name': 'Done', 'type': 'end'}]}),
            context='create workflow')['id']

        def start(**body):
            return client.post(f'/api/v1/workflow/definitions/{workflow_id}/start', headers=headers,
                               json={'title': f'Start {suffix}', **body})

        assert start(resource_type='dynamic_record', resource_id=record_id).status_code == 422
        assert start(resource_id=record_id, variables={'form_id': form_id, 'record_id': record_id + 1}).status_code == 422
        assert start(resource_type='dynamic_record', variables={'form_id': form_id}).status_code == 422
        assert start(resource_type='dynamic_record', resource_id=record_id, variables={'form_id': 2_000_000_000}).status_code == 404
        assert start(resource_type='dynamic_record', resource_id=2_000_000_000, variables={'form_id': form_id}).status_code == 404
        assert start().status_code < 400
        _assert_ok(start(resource_type='dynamic_record', resource_id=record_id, variables={'form_id': form_id}),
                   context='start linked workflow')
