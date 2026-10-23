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


def test_container_ancestors_publish_and_enforce_visibility_and_readonly_without_changing_storage():
    from app.api.forms import _apply_designer_field_settings
    from app.services.form_runtime import _field_proxy_from_payload
    from app.services.form_rules import states
    controls = [
        {'id':'group','source':'component','controlType':'container','rules':{'visible':{'enabled':True,'conditions':{'sourceField':'mode','operator':'equals','value':'show'}}}},
        {'id':'tabs','source':'component','controlType':'tabs','parentId':'group','rules':{'readonly':{'enabled':True}}},
        {'id':'field','source':'field','fieldKey':'name','parentId':'tabs','rules':{'required':{'enabled':True}}},
    ]
    original = {'field_name':'name','field_type':'string','required':False,'validation':{'maxBytes':64},'ui_config':{'custom':'preserve'}}
    saved = _apply_designer_field_settings({'formDesignerControls':controls},[original])[0]
    assert saved['validation'] == {'maxBytes':64} and saved['field_type'] == 'string'
    assert saved['ui_config']['custom'] == 'preserve' and len(saved['ui_config']['layoutAncestors']) == 2
    proxy = _field_proxy_from_payload(saved)
    hidden = states([proxy],{'mode':'hide'})['name']
    assert not hidden['visible'] and not hidden['required']
    shown = states([proxy],{'mode':'show'})['name']
    assert shown['visible'] and shown['required'] and shown['readonly']
    # Bad cyclic legacy references terminate safely.
    controls[0]['parentId'] = 'tabs'
    cyclic = _apply_designer_field_settings({'formDesignerControls':controls},[original])[0]
    assert len(cyclic['ui_config']['layoutAncestors']) == 2

@pytest.mark.asyncio
async def test_editor_assignments_resolve_chains_and_option_labels_and_clear_removed_rules():
    fields=[field('copy2'),field('copy1',{'assignmentRules':[{'targetField':'copy2','sourceAttribute':'self.value'}]}),field('source',{'assignmentRules':[{'targetField':'copy1','sourceAttribute':'self.option_label'}]})]
    fields[-1].enum_values={'values':[{'value':'a','label':'显示名称'}]}
    result=await evaluate(None,{},fields,{'source':'a','copy1':'forged','copy2':'forged'},enforce=True)
    assert result['data']['copy1']==result['data']['copy2']=='显示名称'
    assert result['states']['copy1']['readonly'] and result['states']['copy2']['readonly']
    fields[-1].ui_config['assignmentRules']=[]
    result=await evaluate(None,{},fields,{'source':'a','copy1':'manual'},enforce=True)
    assert result['data']['copy2']=='manual' and not result['states']['copy1']['readonly']
    fields[0].ui_config={'assignmentRules':[{'targetField':'copy1','sourceAttribute':'self.value'}]}
    with pytest.raises(HTTPException,match='') as exc:await evaluate(None,{},fields,{'source':'a'},enforce=True)
    assert '循环' in exc.value.detail


@pytest.mark.asyncio
async def test_assignment_toggle_preserves_mappings_and_stops_writes_when_disabled():
    mapping = [{'id': 'copy', 'sourceAttribute': 'self.value', 'targetField': 'target'}]
    source = field('source', {'assignmentRules': mapping, 'assignmentRulesEnabled': False})
    target = field('target')
    result = await evaluate(None, {}, [source, target], {'source': '新值', 'target': '手填值'}, enforce=True)
    assert result['data']['target'] == '手填值' and 'target' not in result['derived']
    source.ui_config['assignmentRulesEnabled'] = True
    active = await evaluate(None, {}, [source, target], {'source': '新值'}, enforce=True)
    assert active['data']['target'] == '新值'
    assert source.ui_config['assignmentRules'] == mapping


def test_disabled_assignment_mapping_survives_publishing_without_relation_backfill():
    from app.api.forms import _apply_designer_field_settings
    mapping = [{'id': 'copy', 'sourceAttribute': 'record.name', 'targetField': 'target'}]
    saved = _apply_designer_field_settings({'formDesignerControls': [{
        'fieldKey': 'source', 'controlType': 'relation', 'assignmentRules': mapping,
        'assignmentRulesEnabled': False, 'dataSourceKind': 'businessForm', 'optionSource': 'materials'
    }]}, [{'field_name': 'source', 'field_type': 'string', 'ui_config': {}}])[0]
    assert saved['ui_config']['assignmentRules'] == mapping
    assert saved['ui_config']['assignmentRulesEnabled'] is False
    assert saved['ui_config']['relation_config']['backfill'] == {}
