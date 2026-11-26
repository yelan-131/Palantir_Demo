"""Real database contracts across HTTP routes, shared services, and AI tools."""
from contextlib import asynccontextmanager
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import func, inspect, select, text

from tests.test_record_service import environment
from app.api import forms
from app.models.relational import Application, ApplicationMenuNode, Form, FormAction, FormField, FormLayout, FormVersion, WorkflowBinding, WorkflowDef, WorkflowDefVersion
from app.services import form_creation, form_fields, form_versions, form_layouts
from app.services.ai.low_code_tools import execute_add_form_field, execute_create_form_definition
from app.services.ai.form_configuration_tools import execute_form_configuration_tool
from app.services.ai import tool_handlers


async def column_names(db, table_name):
    connection = await db.connection()
    return await connection.run_sync(lambda sync: {column['name'] for column in inspect(sync).get_columns(table_name)})


@pytest.fixture(autouse=True)
def local_audit(monkeypatch):
    async def audit(**kwargs):
        pass
    # Audit storage has its own connection in production. Keep these tests isolated.
    monkeypatch.setattr(form_fields, 'write_audit_log', audit)
    monkeypatch.setattr(form_versions, 'write_audit_log', audit)
    monkeypatch.setattr(forms, 'write_audit_log', audit)
    monkeypatch.setattr(form_creation, 'write_audit_log', audit)
    monkeypatch.setattr('app.services.ai.low_code_tools.write_audit_log', audit)


@pytest.mark.asyncio
async def test_ui_and_ai_share_normalization_and_physical_storage(environment):
    db, _, form, user, client = environment
    user['is_admin'] = True
    response = await client.post('/forms/1/fields', json={
        'field_name': 'ui_count', 'label': 'UI', 'field_type': 'int',
        'validation': {'custom': True}})
    assert response.status_code == 200, response.text
    result = await execute_add_form_field(db, user=user, payload={
        'form_id': 1, 'fields': [{'field_name': 'ai_count', 'label': 'AI',
            'field_type': 'int', 'validation': {'custom': True}, 'default_value': '3'}]})
    ui = response.json()['data']; ai = result['fields'][0]
    assert ui['field_type'] == ai['field_type'] == 'integer'
    assert ui['validation'] == ai['validation'] == {'custom': True}
    assert ai['default_value'] == '3'
    if form.storage_mode == 'physical_table':
        columns = await column_names(db, 't1_business_contract')
        assert {'ui_count', 'ai_count'} <= columns


@pytest.mark.asyncio
async def test_field_limit_is_enforced_for_ui_and_whole_ai_batch(environment, monkeypatch):
    db, _, _, user, client = environment
    user['is_admin'] = True
    monkeypatch.setattr('app.services.field_limits.DEFAULT_FORM_FIELDS', 5)
    with pytest.raises(HTTPException) as error:
        await execute_add_form_field(db, user=user, payload={'form_id': 1, 'fields': [
            {'field_name': 'first', 'label': 'First'}, {'field_name': 'second', 'label': 'Second'}]})
    assert error.value.status_code == 422
    assert await db.scalar(select(func.count()).select_from(FormField)) == 4
    response = await client.post('/forms/1/fields', json={'field_name': 'last', 'label': 'Last'})
    assert response.status_code == 200
    response = await client.post('/forms/1/fields', json={'field_name': 'over', 'label': 'Over'})
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('fields,expected', [
    ([{'field_name': 'dup'}, {'field_name': 'dup'}], 409),
    ([{'field_name': 'good'}, {'field_name': 'bad', 'field_type': 'unknown'}], 422),
    ([{'field_name': 'good'}, 42], 422),
    ([{'field_name': 'good'}, {'field_name': 'bad', 'validation': {'maxBytes': -1}}], 422),
])
async def test_invalid_batches_never_leave_partial_fields(environment, fields, expected):
    db, _, _, user, _ = environment
    with pytest.raises(HTTPException) as error:
        await execute_add_form_field(db, user={**user, 'is_admin': True}, payload={'form_id': 1, 'fields': fields})
    assert error.value.status_code == expected
    assert await db.scalar(select(func.count()).select_from(FormField)) == 4


@pytest.mark.asyncio
async def test_ai_layout_sync_remains_idempotent_and_does_not_publish(environment):
    db, _, form, user, _ = environment
    db.add_all([FormLayout(tenant_id=1, form_id=1, layout_type='list', config={'columns': []}),
        FormLayout(tenant_id=1, form_id=1, layout_type='form', config={'sections': []})])
    await db.commit()
    result = await execute_add_form_field(db, user={**user, 'is_admin': True}, payload={
        'form_id': 1, 'fields': [{'field_name': 'new_field', 'label': 'New'}]})
    assert result['changed_layouts'] == ['form', 'list']
    layouts = (await form_layouts.list_form_layouts(1, db, user))['data']
    assert next(row for row in layouts if row['layout_type'] == 'list')['config']['columns'][0]['field_name'] == 'new_field'
    assert form.status == 'published'
    with pytest.raises(HTTPException) as error:
        await execute_add_form_field(db, user={**user, 'is_admin': True}, payload={
            'form_id': 1, 'fields': [{'field_name': 'new_field', 'label': 'New'}]})
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_configuration_tools_use_same_routes_and_dispatch_registry(environment, monkeypatch):
    db, _, _, user, client = environment
    user['is_admin'] = True
    @asynccontextmanager
    async def session():
        yield db
    monkeypatch.setattr(tool_handlers, 'db_session', session)
    for tool, route in [('forms.list_versions', '/forms/1/versions'),
                        ('forms.get_layouts', '/forms/1/layouts'),
                        ('forms.preview_publish', '/forms/1/publish/preview')]:
        response = await client.get(route)
        assert response.status_code == 200, response.text
        result = await tool_handlers.dispatch_tool_handler(tool, {'form_id': 1}, current_user=user, settings={})
        assert result == response.json()
    response = await client.post('/forms/1/rules/evaluate', json={'data': {'title': 'Test'}})
    result = await execute_form_configuration_tool('forms.evaluate_rules', db, user=user,
        payload={'form_id': 1, 'data': {'title': 'Test'}})
    assert response.status_code == 200 and result == response.json()


@pytest.mark.asyncio
async def test_designer_publish_commits_form_and_workflow_together(environment):
    from app.services.workflow_definitions import WorkflowDefCreate, stage_workflow_definition
    from tests.test_record_service import seed

    db, _, form, user, client = environment
    user['is_admin'] = True
    existing = await seed(db, 'Existing record')
    form_id = form.id
    workflow = await stage_workflow_definition(db, WorkflowDefCreate(name='Approval', config={
        'formId': form_id,
        'nodes': [{'id': 'start', 'type': 'start'}, {'id': 'end', 'type': 'end'}],
        'edges': [{'source': 'start', 'target': 'end'}],
        'triggerBindings': [{'action': 'update', 'enabled': True, 'label': 'Update'}],
    }), user)
    workflow_id = workflow.id
    form.config = {'workflowDesigner': {'draftWorkflowId': workflow_id}}
    await db.commit()
    response = await client.post(f'/forms/{form_id}/publish')
    assert response.status_code == 200, response.text
    initial_version = response.json()['data']['version']
    field = await client.post(f'/forms/{form_id}/fields', json={
        'field_name': 'organization', 'label': '分发组织', 'required': True,
    })
    assert field.status_code == 200, field.text
    form_url = f'/forms/{form_id}'
    draft_config = dict(form.config)
    update = await client.put(form_url, json={'config': {
        **draft_config, 'formDesignerControls': [{
            'id': 'status-input', 'fieldKey': 'status', 'controlType': 'text',
            'rules': {'required': {'enabled': True}},
        }],
    }})
    assert update.status_code == 200, update.text

    request = {'workflow_draft_id': workflow_id}
    blocked = await client.post(f'/forms/{form_id}/publish', json=request)
    assert blocked.status_code == 409, blocked.text
    failures = [item for item in blocked.json()['detail']['report']['items'] if item['level'] == 'blocking']
    assert [(item['field_name'], item['type']) for item in failures] == [('status', 'required_field_missing')]
    await db.refresh(workflow)
    await db.refresh(form)
    assert workflow.status == 'draft'
    assert form.config['workflowDesigner'] == {'draftWorkflowId': workflow_id}
    assert await db.scalar(select(func.count()).select_from(WorkflowBinding)) == 0
    assert await db.scalar(select(func.count()).select_from(WorkflowDefVersion)) == 1
    assert await db.scalar(select(func.count()).select_from(FormVersion)) == 1

    update = await client.put(form_url, json={'config': draft_config})
    assert update.status_code == 200, update.text
    published = await client.post(f'/forms/{form_id}/publish', json=request)
    assert published.status_code == 200, published.text
    result = published.json()['data']
    assert result['version'] == initial_version + 1
    assert result['snapshot']['form']['config']['workflowDesigner']['publishedWorkflowId'] == workflow_id
    binding, = result['snapshot']['workflow_bindings']
    await db.refresh(workflow)
    assert workflow.status == 'published'
    assert binding['workflow_id'] == workflow_id
    assert binding['config']['workflowVersion'] == workflow.version
    assert await db.scalar(select(func.count()).select_from(WorkflowDefVersion)) == 2
    stored = await client.get(f"/forms/{form_id}/records/{existing['id']}")
    assert stored.status_code == 200, stored.text
    assert stored.json()['data']['data'].get('organization') is None

    records_url = f'/forms/{form_id}/records'
    missing = await client.post(records_url, json={'data': {'title': 'New record'}})
    assert missing.status_code == 422, missing.text
    assert '分发组织' in missing.json()['detail']
    valid = await client.post(records_url, json={'data': {'title': 'New record', 'organization': 'A'}})
    assert valid.status_code == 200, valid.text


@pytest.mark.asyncio
async def test_services_and_tools_enforce_admin_and_tenant_boundaries(environment):
    db, _, _, user, _ = environment
    for actor, expected in [(user, 403), ({**user, 'is_admin': True, 'tenant_id': 2}, 404)]:
        with pytest.raises(HTTPException) as error:
            await form_fields.add_form_fields(1, [{'field_name': 'extra'}], db, actor)
        assert error.value.status_code == expected
        with pytest.raises(HTTPException) as error:
            await execute_form_configuration_tool('forms.list_versions', db, user=actor, payload={'form_id': 1})
        assert error.value.status_code == expected
    with pytest.raises(HTTPException) as error:
        await execute_form_configuration_tool('forms.get_version', db,
            user={**user, 'is_admin': True}, payload={'form_id': 1})
    assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_ai_creation_uses_shared_field_schema_and_storage(environment):
    db, _, _, user, _ = environment
    user['is_admin'] = True
    app = Application(tenant_id=user['tenant_id'], code='ai_draft_app', name='Draft app', status='published')
    db.add(app)
    await db.flush()
    payload = {
        'form': {'code': 'ai_shared_contract', 'name': 'Shared contract',
                 'status': 'published', 'application_id': app.id},
        'menu': {'create': True},
        'fields': [{'field_name': 'quantity', 'label': 'Quantity', 'field_type': 'int',
            'default_value': '2', 'validation': {'custom': True}}],
        'workflow': {'name': 'Shared creation workflow', 'config': {'nodes': [], 'edges': []}},
        '_execution_run_id': 'confirm-shared-creation',
        '_execution_action_key': '0',
    }
    result = await execute_create_form_definition(db, user=user, payload=payload)
    form_id = result['form']['id']
    created = await db.get(Form, form_id)
    try:
        assert result['form']['status'] == created.status == 'draft'
        assert result['route_path'] == f'/studio/business-data/{form_id}/design?tab=form'
        assert result['application_binding']['application_id'] == app.id
        assert result['application_binding']['application_name'] == 'Draft app'
        actions = await db.scalars(select(FormAction.action_key).where(FormAction.form_id == form_id))
        assert set(actions) == {'create', 'edit', 'delete', 'export'}
        workflow = await db.get(WorkflowDef, result['workflow_draft_id'])
        assert workflow.status == 'draft'
        assert json.loads(workflow.config)['formId'] == form_id
        assert await execute_create_form_definition(db, user=user, payload=payload) == result
        with pytest.raises(HTTPException) as conflict:
            await execute_create_form_definition(db, user=user, payload={
                **payload, 'form': {**payload['form'], 'name': 'Different form'},
            })
        assert conflict.value.status_code == 409
        assert await db.scalar(select(FormVersion.id).where(FormVersion.form_id == form_id)) is None
        assert await db.scalar(select(ApplicationMenuNode.id).where(ApplicationMenuNode.form_id == form_id)) is None
        assert created.config['viewConfigMeta']['publishedVersion'] == 0
        field = await db.scalar(select(FormField).where(FormField.form_id == form_id))
        assert field.field_type == 'integer' and field.default_value == '2'
        assert field.validation == {'custom': True}
        columns = await column_names(db, created.table_name)
        assert 'quantity' in columns
        published = await form_versions.publish_form(form_id, db, user)
        assert published['data']['version'] == 1
        assert created.status == 'published'
    finally:
        # This test creates a physical table outside the shared fixture schema.
        # Remove it before the next fixture rebuilds the referenced users table.
        table_name = created.table_name
        assert table_name == 't1_business_ai_shared_contract'
        await db.rollback()
        await db.execute(text('DROP TABLE IF EXISTS t1_business_ai_shared_contract'))
        await db.commit()


@pytest.mark.asyncio
async def test_initial_designer_save_rolls_back_and_retries_with_the_same_code(environment, monkeypatch):
    db, factory, _, user, client = environment
    from app.services import workflow_definitions

    user['is_admin'] = True
    original = workflow_definitions.stage_workflow_definition

    async def fail_after_workflow_insert(*args):
        await original(*args)
        raise HTTPException(503, 'Interrupted initial save')

    code = 'atomic_designer_contract'
    table_name = f't1_business_{code}'
    request = {
        'name': 'Atomic draft', 'code': code, 'storage_mode': 'dynamic',
        'designer_draft': {
            'draft_id': 'a' * 32,
            'fields': [{'field_name': 'quantity', 'label': 'Quantity', 'field_type': 'integer', 'default_value': '2'}],
            'layout': {'sections': [{'fields': [{'fieldName': 'quantity'}]}]},
            'view': {'table': {'columns': [{'fieldName': 'quantity'}]}},
            'workflow': {'name': 'Atomic draft workflow', 'config': {'nodes': [], 'edges': []}},
        },
    }
    monkeypatch.setattr(workflow_definitions, 'stage_workflow_definition', fail_after_workflow_insert)
    failed = await client.post('/forms', json=request)
    assert failed.status_code == 503, failed.text
    async with factory() as session:
        assert await session.scalar(select(Form.id).where(Form.code == code)) is None
        assert await session.scalar(select(WorkflowDef.id).where(WorkflowDef.name == 'Atomic draft workflow')) is None
        connection = await session.connection()
        assert not await connection.run_sync(lambda sync: inspect(sync).has_table(table_name))

    monkeypatch.setattr(workflow_definitions, 'stage_workflow_definition', original)
    try:
        saved = await client.post('/forms', json=request)
        assert saved.status_code == 200, saved.text
        form = saved.json()['data']
        assert form['status'] == 'draft'
        retried = await client.post('/forms', json=request)
        assert retried.status_code == 200 and retried.json()['data']['id'] == form['id']
        duplicate = await client.post('/forms', json={
            **request, 'designer_draft': {**request['designer_draft'], 'draft_id': 'b' * 32},
        })
        assert duplicate.status_code == 409
        async with factory() as session:
            field = await session.scalar(select(FormField).where(FormField.form_id == form['id']))
            assert field.field_name == 'quantity' and field.default_value == '2'
            layouts = {row.layout_type: row.config for row in await session.scalars(
                select(FormLayout).where(FormLayout.form_id == form['id']))}
            assert layouts['form'] == request['designer_draft']['layout']
            assert layouts['view']['draft'] == request['designer_draft']['view']
            definitions = list(await session.scalars(select(WorkflowDef).where(WorkflowDef.name == 'Atomic draft workflow')))
            assert len(definitions) == 1
            workflow = definitions[0]
            assert workflow.id == form['config']['workflowDesigner']['draftWorkflowId']
            assert workflow.status == 'draft' and json.loads(workflow.config)['formId'] == form['id']
            assert await session.scalar(select(WorkflowDefVersion.id).where(WorkflowDefVersion.workflow_id == workflow.id))
            assert await session.scalar(select(FormVersion.id).where(FormVersion.form_id == form['id'])) is None
    finally:
        await db.rollback()
        await db.execute(text('DROP TABLE IF EXISTS t1_business_atomic_designer_contract'))
        await db.commit()


def test_new_tools_are_registered_and_allowed_by_inspection_skill():
    from app.services.ai.agent_registry import load_seed_registry, validate_registry_payload
    skills, tools = load_seed_registry()
    validate_registry_payload(skills, tools)
    for name in skills['low_code.inspect_form']['allowed_tools']:
        assert tools[name]['side_effect'] == 'read'
        assert tools[name]['permission_check'] == 'config'
        assert tools[name]['handler_key'] in tool_handlers.TOOL_HANDLERS
