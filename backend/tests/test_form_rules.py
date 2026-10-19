from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.form_rules import evaluate


def field(name, ui=None, required=False):
    return SimpleNamespace(field_name=name, label=name, field_type='string', ui_config=ui or {},
                           required=required, archived=False, validation=None, enum_values=None, default_value=None)


@pytest.mark.asyncio
async def test_conditional_designer_rules_and_chained_calculation_are_authoritative():
    fields = [field('name'), field('batch'),
              field('display', {'computed': {'expression': "name + '-' + batch"}}),
              field('next', {'computed': {'expression': "display + '-END'"}}),
              field('reason', {'rules': {
                  'visible': {'enabled': True, 'conditions': {'sourceField': 'batch', 'operator': 'equals', 'value': 'bad'}},
                  'required': {'enabled': True, 'conditions': {'sourceField': 'batch', 'operator': 'equals', 'value': 'bad'}}}})]
    result = await evaluate(None, {}, fields, {'name': '物料', 'batch': 'good', 'display': 'forged', 'reason': 'stale'}, enforce=True)
    assert result['data']['next'] == '物料-good-END'
    assert result['data']['reason'] is None and result['states']['reason']['visible'] is False
    with pytest.raises(HTTPException):
        await evaluate(None, {}, fields, {'name': '物料', 'batch': 'bad'}, enforce=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('expression', ["__import__('os').system('echo unsafe')", 'name.__class__', 'name * 1000000', 'unknown + name', 'display + name'])
async def test_invalid_or_cyclic_expressions_fail_without_execution(expression):
    with pytest.raises(HTTPException) as error:
        await evaluate(None, {}, [field('name'), field('display', {'computed': {'expression': expression}})], {'name': 'test'})
    assert error.value.status_code == 422


def test_harness_creation_contract_exposes_native_executable_rules():
    from app.services.ai.agent_definition import load_action_contracts
    from app.services.ai.low_code_tools import validate_field_rule_definitions
    contract = load_action_contracts()['low_code.create_form_definition']
    assert 'ui_config' in contract['field_schema']
    rules = contract['field_rules']
    assert rules['reference']['relation_config']['backfill']
    assert rules['automatic_code']['encodingRule']['segments']
    assert rules['conditional']['requiredWhen']
    validate_field_rule_definitions([{'field_type': 'string', 'ui_config': rules['concatenation']}])
    validate_field_rule_definitions([{'field_type': 'string', 'ui_config': rules['automatic_code']}])
    with pytest.raises(HTTPException):
        validate_field_rule_definitions([{'field_type': 'string', 'ui_config': {'automatic_code': rules['automatic_code']}}])


def test_incomplete_ai_relation_is_rejected_before_confirmation():
    from app.services.ai.agent_validation import agent_validation_service
    from app.services.ai.low_code_tools import validate_field_rule_definitions
    fields = [{'field_name': 'material', 'field_type': 'relation'}]
    with pytest.raises(HTTPException):
        validate_field_rule_definitions(fields)
    result = agent_validation_service.validate_tool_payload(tool_name='forms.create_form_definition',
        payload={'form': {'name': '产成品', 'code': 'finished'}, 'fields': fields})
    assert not result.valid
    assert any(issue.code == 'invalid_field_rules' for issue in result.errors)
    validate_field_rule_definitions([{'field_type': 'relation', 'ui_config': {'relation_config': {
        'target_form_code': 'material_archive', 'label_field': 'name'}}}])
