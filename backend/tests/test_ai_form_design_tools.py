"""AI design tools must retain HTTP contracts and explicit service routing."""
import inspect
import pytest
from fastapi import HTTPException
from app.services.ai.form_configuration_tools import (
    FORM_DESIGN_TOOLS, form_design_request_model, execute_form_design_tool,
)
from app.services.ai.tool_registry import get_tool
from app.services.ai.tool_handlers import TOOL_HANDLERS


def sample(schema):
    if '$ref' in schema:
        raise AssertionError('unexpected reference')
    if 'anyOf' in schema:
        return sample(next(s for s in schema['anyOf'] if s.get('type') != 'null'))
    kind = schema.get('type')
    if kind == 'integer': return 1
    if kind == 'boolean': return True
    if kind == 'object':
        return {key: sample(schema['properties'][key]) for key in schema.get('required', [])}
    return 'example'


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', FORM_DESIGN_TOOLS)
async def test_registered_tools_delegate_validated_arguments(operation, monkeypatch):
    from app.services import form_admin, form_fields, form_layouts, form_versions
    module_name, function, body_model, id_key = FORM_DESIGN_TOOLS[operation]
    module = {'form_admin': form_admin, 'form_fields': form_fields, 'form_layouts': form_layouts,
              'form_versions': form_versions}[module_name]
    real_function = getattr(module, function)
    schema = form_design_request_model(operation).model_json_schema()
    def resolve(value):
        if isinstance(value, dict):
            if '$ref' in value: return resolve(schema['$defs'][value['$ref'].split('/')[-1]])
            return {k: resolve(v) for k,v in value.items() if k != '$defs'}
        if isinstance(value, list): return [resolve(v) for v in value]
        return value
    payload = sample(resolve(schema))
    seen = {}
    async def delegate(**kwargs):
        inspect.signature(real_function).bind(**kwargs)
        seen.update(kwargs)
        return {'data': 'delegated'}
    monkeypatch.setattr(module, function, delegate)
    user = {'is_admin': True, 'tenant_id': 1}
    assert await execute_form_design_tool(operation, None, user=user, payload=payload) == {'data': 'delegated'}
    assert seen['user'] is user
    if body_model: assert type(seen['body']).__name__ == body_model
    tool = get_tool(operation)
    assert operation in TOOL_HANDLERS
    assert tool.handler_key == operation
    assert tool.side_effect == ('read' if operation.startswith('forms.list_') else 'configuration_write')


@pytest.mark.asyncio
async def test_rejects_non_admin_and_invalid_resource():
    with pytest.raises(HTTPException) as error:
        await execute_form_design_tool('forms.publish', None, user={'is_admin': False}, payload={'form_id': 1})
    assert error.value.status_code == 403
    for payload in ({'form_id': -1}, {'form_id': 1, 'function': 'delete_all'}, {'form_id': 1}):
        with pytest.raises(HTTPException) as error:
            await execute_form_design_tool('forms.update_field', None, user={'is_admin': True}, payload=payload)
        assert error.value.status_code == 422

from tests.test_record_service import environment


@pytest.mark.asyncio
async def test_layout_save_matches_http_and_rejects_other_tenant(environment):
    db, _, form, user, client = environment
    user['is_admin'] = True
    payload = {'form_id': form.id, 'layout_type': 'form',
               'body': {'layout_type': 'form', 'config': {'items': [], 'columns': 2}}}
    result = await execute_form_design_tool('forms.save_layout', db, user=user, payload=payload)
    response = await client.get(f'/forms/{form.id}/layouts')
    assert response.status_code == 200
    assert result['data'] in response.json()['data']
    with pytest.raises(HTTPException) as error:
        await execute_form_design_tool('forms.save_layout', db,
            user={**user, 'tenant_id': 99999}, payload=payload)
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_role_lookup_resolves_permission_target_without_user_membership(environment, monkeypatch):
    from app.models.relational import Role
    from app.services.ai import tool_handlers
    from app.services.ai.tool_envelope import tool_execution_envelope

    db, factory, _, user, _ = environment
    db.add_all([
        Role(id=2, tenant_id=1, name='viewer', label='只读观察员'),
        Role(id=3, tenant_id=2, name='viewer', label='只读观察员'),
    ])
    await db.commit()
    monkeypatch.setattr(tool_handlers, 'db_session', factory)

    async def query(payload):
        result = await tool_execution_envelope.execute_tool(
            tool_name='platform.identity_settings.query', payload=payload,
            current_user={**user, 'is_admin': True}, settings={'domains': ['low-code']},
        )
        assert result['status'] == 'completed', result
        return result['result']

    for name in ['只读观察员', 'viewer']:
        assert await query({'subject': 'roles', 'role_name': name, 'limit': 1}) == {
            'items': [{'id': 2, 'name': 'viewer', 'label': '只读观察员'}],
            'count': 1, 'subject': 'roles',
        }
    assert (await query({'subject': 'roles', 'role_name': 'viewer'}))['count'] == 1
    assert (await query({'subject': 'roles', 'role_name': '不存在'}))['items'] == []
    users = await query({'subject': 'users', 'limit': 1})
    assert users['subject'] == 'users'
    assert users['items'][0]['username'] == 'user1'


def test_form_write_tools_describe_native_fields_and_keep_seed_copies_aligned():
    import json
    from pathlib import Path

    from app.services.ai.agent_definition import REGISTRY_SEED_DIR
    from app.services.ai.agent_validation import agent_validation_service
    from app.services.ai.tool_registry import to_openai_function
    from app.services.form_schemas import FormFieldCreate

    source = json.loads((REGISTRY_SEED_DIR / 'tools.json').read_text(encoding='utf-8'))
    bundled = Path(__file__).resolve().parents[1] / 'app/services/ai/assets/tools.json'
    packaged = json.loads(bundled.read_text(encoding='utf-8'))
    for operation in ('forms.create_form_definition', 'forms.add_form_field'):
        assert source[operation] == packaged[operation]
        schema = to_openai_function(get_tool(operation))['function']['parameters']
        assert set(schema['properties']['fields']['items']['properties']) == set(FormFieldCreate.model_fields)
    create = 'forms.create_form_definition'
    schema = source[create]['input_schema']
    assert {'form', 'fields', 'workflow'} == schema['properties'].keys()
    assert 'application_id' in schema['properties']['form']['properties']
    assert {'application_binding', 'workflow_draft_id'} <= source[create]['output_schema'].keys()
    assert not agent_validation_service.validate_tool_payload(
        tool_name=create,
        payload={'form': {'name': '登记', 'code': 'entry'}, 'fields': ['bad field']},
    ).valid


def test_stored_builtin_form_contracts_refresh_without_resetting_user_settings():
    from app.services.ai.agent_definition import _load_registry_seed
    from app.services.ai.agent_registry import _refresh_stored_input_schemas

    name = 'forms.create_form_definition'
    query = 'platform.form_settings.query'
    seed = _load_registry_seed('tools.json')
    stored = {
        name: {
            **seed[name], 'input_schema': {'form': 'object', 'fields': 'array', 'menu': 'object'},
            'title': '团队表单工具', 'enabled': False,
            'output_schema': {'form': 'object', 'fields': 'array', 'route_path': 'string'},
        },
        query: {**seed[query], 'input_schema': {'subject': 'forms|fields|layouts', 'limit': 'integer'}},
    }
    _refresh_stored_input_schemas(stored)
    assert stored[name]['input_schema'] == seed[name]['input_schema']
    assert stored[name]['output_schema'] == seed[name]['output_schema']
    assert stored[name]['title'] == '团队表单工具'
    assert stored[name]['enabled'] is False
    assert stored[query]['input_schema'] == seed[query]['input_schema']
    stored[query]['input_schema'] = {'custom_id': 'integer'}
    _refresh_stored_input_schemas(stored)
    assert stored[query]['input_schema'] == {'custom_id': 'integer'}


@pytest.mark.asyncio
async def test_form_lookup_uses_application_menu_data_sources_and_reads_saved_layouts(environment, monkeypatch):
    from app.models.relational import (
        Application, ApplicationForm, ApplicationMenuNode, ComponentPage, ComponentPageVersion, Form, FormLayout,
    )
    from app.services.ai import tool_handlers
    from app.services.ai.tool_envelope import tool_execution_envelope

    db, factory, form, user, _ = environment
    db.add_all([
        Application(id=10, tenant_id=1, name='维修', code='repair'),
        Application(id=11, tenant_id=2, name='其他租户', code='other'),
        Form(id=10, tenant_id=1, name='维修 页面默认来源', code='repair-source'),
        Form(id=11, tenant_id=1, name='维修 组件来源', code='repair-widget'),
        Form(id=12, tenant_id=1, name='维修 旧版来源', code='repair-older'),
        Form(id=13, tenant_id=1, name='维修 菜单', code='repair-menu'),
        Form(id=14, tenant_id=2, name='维修 其他租户数据', code='repair-foreign'),
        ComponentPage(id=10, tenant_id=1, code='repair-page', published_version=2),
        ComponentPage(id=11, tenant_id=1, code='unpublished', published_version=0),
    ])
    await db.flush()
    db.add_all([
        ApplicationForm(tenant_id=1, application_id=10, form_id=form.id),
        ApplicationMenuNode(tenant_id=1, application_id=10, node_type='form', title='旧表单入口', form_id=13),
        ApplicationMenuNode(tenant_id=1, application_id=10, node_type='page', title='维修页', route_path='/pages/repair-page'),
        ApplicationMenuNode(tenant_id=1, application_id=10, node_type='page', title='未发布', route_path='/pages/unpublished'),
        ComponentPageVersion(tenant_id=1, page_id=10, version=1, definition={'sourceFormId': 12}),
        ComponentPageVersion(tenant_id=1, page_id=10, version=2,
            definition={'sourceFormId': 10, 'widgets': [{'dataBinding': {'formId': 11}}, {'dataBinding': {'formId': 14}}]}),
        FormLayout(tenant_id=1, form_id=form.id, layout_type='form', config={'items': []}),
    ])
    await db.commit()
    monkeypatch.setattr(tool_handlers, 'db_session', factory)
    context = tool_handlers.ToolHandlerContext(
        tool_name='platform.form_settings.query', current_user={**user, 'is_admin': True}, settings={},
    )

    result = await tool_execution_envelope.execute_tool(
        tool_name=context.tool_name, payload={'application_id': 10},
        current_user=context.current_user, settings={'domains': ['low-code']},
    )
    assert result['status'] == 'completed', result
    scoped = result['result']
    assert scoped['application_id'] == 10
    assert {item['id'] for item in scoped['items']} == {form.id, 10, 11, 13}
    assert (await tool_handlers._platform_query({'application_id': 10, 'limit': 1}, context))['has_more']
    empty = await tool_handlers._platform_query({'application_id': 10, 'form_name': '不存在'}, context)
    assert scoped['application_name'] == empty['application_name']
    assert {key: value for key, value in empty.items() if key != 'application_name'} == {
        'application_id': 10, 'count': 0, 'has_more': False, 'items': [], 'subject': 'forms',
    }
    layouts = await tool_handlers._platform_query({'subject': 'layouts', 'form_code': form.code}, context)
    assert layouts['subject'] == 'layouts'
    assert layouts['items'][0]['layouts'][0]['config'] == {'items': []}
    with pytest.raises(HTTPException) as error:
        await tool_handlers._platform_query({'application_id': 11}, context)
    assert error.value.status_code == 404
