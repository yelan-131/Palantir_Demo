"""Real database contracts across HTTP routes, shared services, and AI tools."""
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException
from sqlalchemy import func, inspect, select, text

from tests.test_record_service import environment
from app.api import forms
from app.models.relational import Form, FormField, FormLayout
from app.services import form_fields, form_versions, form_layouts
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
    result = await execute_create_form_definition(db, user={**user, 'is_admin': True}, payload={
        'form': {'code': 'ai_shared_contract', 'name': 'Shared contract'},
        'fields': [{'field_name': 'quantity', 'label': 'Quantity', 'field_type': 'int',
            'default_value': '2', 'validation': {'custom': True}}]})
    form_id = result['form']['id']
    created = await db.get(Form, form_id)
    try:
        field = await db.scalar(select(FormField).where(FormField.form_id == form_id))
        assert field.field_type == 'integer' and field.default_value == '2'
        assert field.validation == {'custom': True}
        columns = await column_names(db, created.table_name)
        assert 'quantity' in columns
    finally:
        # This test creates a physical table outside the shared fixture schema.
        # Remove it before the next fixture rebuilds the referenced users table.
        table_name = created.table_name
        assert table_name == 't1_business_ai_shared_contract'
        await db.rollback()
        await db.execute(text('DROP TABLE IF EXISTS t1_business_ai_shared_contract'))
        await db.commit()


def test_new_tools_are_registered_and_allowed_by_inspection_skill():
    from app.services.ai.agent_registry import load_seed_registry, validate_registry_payload
    skills, tools = load_seed_registry()
    validate_registry_payload(skills, tools)
    for name in skills['low_code.inspect_form']['allowed_tools']:
        assert tools[name]['side_effect'] == 'read'
        assert tools[name]['permission_check'] == 'config'
        assert name in tool_handlers.TOOL_HANDLERS
