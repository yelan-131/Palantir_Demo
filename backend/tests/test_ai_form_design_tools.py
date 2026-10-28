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
    from app.services import form_fields, form_layouts, form_versions
    from app.api import forms
    module_name, function, body_model, id_key = FORM_DESIGN_TOOLS[operation]
    module = {'routes': forms, 'form_fields': form_fields, 'form_layouts': form_layouts,
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
