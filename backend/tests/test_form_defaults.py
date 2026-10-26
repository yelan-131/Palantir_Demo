from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from app.services.form_defaults import apply_defaults
from app.services.field_limits import max_bytes
from app.api.form_engine.validation import _validate_record_data, _field_value_is_compatible
from app.services.form_control_validation import design_errors


def field(name, rule=None, kind='string', default=None, validation=None):
    return SimpleNamespace(field_name=name, label=name, field_type=kind, archived=False, required=False,
        ui_config={'defaultRule': rule} if rule else {}, default_value=default, validation=validation, enum_values=None)


def template(*parts):
    return {'mode': 'template', 'parts': [{'kind': kind, 'value': value} for kind, value in parts]}


def test_json_and_multiselect_defaults_are_typed_and_invalid_json_is_rejected():
    choices = field('choices', kind='json', default='["production", "quality"]')
    enum = field('enum', kind='enum', default='["normal"]')
    enum.ui_config = {'typeSettings': {'selectionMode': 'multiple'}}
    data = {}
    apply_defaults([choices, enum], data)
    assert data == {'choices': ['production', 'quality'], 'enum': ['normal']}
    explicit = {'choices': []}
    apply_defaults([choices], explicit)
    assert explicit['choices'] == []
    with pytest.raises(HTTPException) as error:
        apply_defaults([field('broken', kind='json', default='not JSON')], {})
    assert error.value.status_code == 422


def test_defaults_preserve_zero_false_manual_input_and_editing_and_wait_for_sources():
    fields = [field('name'), field('qty', kind='integer'), field('flag', kind='boolean'),
        field('label', template(('text', 'MAT-'), ('field', 'name'), ('text', '-'), ('field', 'qty'), ('field', 'flag')))]
    data = {'name': '测试', 'qty': 0, 'flag': False}
    assert apply_defaults(fields, data) == {'label'} and data['label'] == 'MAT-测试-0false'
    data['label'] = '人工填写'; apply_defaults(fields, data)
    assert data['label'] == '人工填写'
    editing = {'name': 'new', 'label': ''}
    assert not apply_defaults(fields, editing, existing={}) and editing['label'] == ''
    waiting = {'name': '测试'}; apply_defaults(fields, waiting)
    assert 'label' not in waiting


def test_dependency_order_fixed_types_and_literals_without_code_execution():
    fields = [field('next', template(('field', 'base'), ('text', '-end'))), field('base', default='start'),
        field('number', kind='integer', default='12'), field('flag', kind='boolean', default='false'),
        field('literal', template(('text', "__import__('os').system('bad')")))]
    data = {}; apply_defaults(fields, data)
    assert data['next'] == 'start-end' and data['number'] == 12 and data['flag'] is False
    assert data['literal'] == "__import__('os').system('bad')"


@pytest.mark.parametrize('rule', [template(('field', 'missing')), template(('field', 'name')), {'mode': 'eval'}, {'mode': 'template', 'parts': []}, ['invalid']])
def test_invalid_rules_reject_safely(rule):
    with pytest.raises(HTTPException) as error: apply_defaults([field('name', rule)], {})
    assert error.value.status_code == 422


def test_cycles_and_generated_values_over_cap_are_rejected_at_preview_and_publish():
    with pytest.raises(HTTPException): apply_defaults([field('a', template(('field', 'b'))), field('b', template(('field', 'a')))], {})
    with pytest.raises(HTTPException): apply_defaults([field('a', template(('text', '中文字')), validation={'maxBytes': 8})], {})
    errors = design_errors({'formDesignerControls': [
        {'fieldKey': 'a', 'controlType': 'text', 'defaultRule': template(('field', 'b'))},
        {'fieldKey': 'b', 'controlType': 'text', 'defaultRule': template(('field', 'a'))},
    ]}, [{'field_name': 'a', 'field_type': 'string'}, {'field_name': 'b', 'field_type': 'string'}])
    assert any('循环' in error for error in errors)


def test_default_utf8_json_and_fixed_storage_limits():
    text = field('name'); assert max_bytes(text) == 1024
    _validate_record_data([text], {'name': '中' * 341})
    with pytest.raises(HTTPException): _validate_record_data([text], {'name': '中' * 342})
    assert not _field_value_is_compatible(text, '中' * 342)
    document = field('doc', kind='json'); assert max_bytes(document) == 1048576
    with pytest.raises(HTTPException): _validate_record_data([document], {'doc': {'data': 'x' * 1048576}})
    custom = field('short', validation={'maxBytes': 6}); _validate_record_data([custom], {'short': '中文'})
    with pytest.raises(HTTPException): _validate_record_data([custom], {'short': '中文多'})
    with pytest.raises(HTTPException): _validate_record_data([field('qty', kind='integer')], {'qty': 2 ** 31})


def test_publish_mapping_isolated_and_switching_to_fixed_removes_rule():
    from app.api.forms import _apply_designer_field_settings
    original = {'field_name': 'name', 'field_type': 'string', 'validation': {'custom': True}, 'ui_config': {'other': True}}
    control = {'id': 'name', 'fieldKey': 'name', 'controlType': 'text', 'storageMaxBytes': 2048, 'defaultRule': template(('text', 'PREFIX-'))}
    saved = _apply_designer_field_settings({'formDesignerControls': [control]}, [original])[0]
    assert saved['validation'] == {'custom': True} and saved['ui_config']['defaultRule'] == control['defaultRule']
    assert original['validation'] == {'custom': True} and 'defaultRule' not in original['ui_config']
    cleared = _apply_designer_field_settings({'formDesignerControls': [{**control, 'defaultRule': {'mode': 'fixed'}}]}, [saved])[0]
    assert 'defaultRule' not in cleared['ui_config']
    ignored = _apply_designer_field_settings({'formDesignerControls': [{**control, 'storageMaxBytes': True}]}, [original])[0]
    assert ignored['validation'] == original['validation']


@pytest.mark.asyncio
async def test_rule_engine_default_is_editable_and_never_recomputed_on_record_edit():
    from app.services.form_rules import evaluate
    fields = [field('source'), field('target', template(('field', 'source'), ('text', '-A')))]
    result = await evaluate(None, {}, fields, {'source': '物料'}, enforce=True)
    assert result['data']['target'] == '物料-A' and not result['states']['target']['readonly']
    manual = await evaluate(None, {}, fields, {'source': '物料', 'target': '自定义'}, enforce=True)
    assert manual['data']['target'] == '自定义'
    edited = await evaluate(None, {}, fields, {'source': '新物料'}, existing={'source': '旧物料', 'target': '原值'}, enforce=True)
    assert edited['data']['target'] == '原值'


def test_form_capacity_budget_is_for_actual_record_data_and_not_declared_field_caps():
    from app.services.field_limits import DEFAULT_RECORD_BYTES, DEFAULT_FORM_FIELDS
    # Large potential field budgets do not reserve record storage.
    fields = [field(f'f{i}', kind='json') for i in range(3)]
    _validate_record_data(fields, {f'f{i}': {'value': 'small'} for i in range(3)})
    with pytest.raises(HTTPException, match='') as error:
        _validate_record_data(fields, {f'f{i}': 'x' * (DEFAULT_RECORD_BYTES // 3) for i in range(3)})
    assert '单条表单记录' in error.value.detail
    schema = [{'field_name': f'f{i}', 'field_type': 'string'} for i in range(DEFAULT_FORM_FIELDS)]
    assert not any('字段数量' in item for item in design_errors({}, schema))
    assert any('字段数量' in item for item in design_errors({}, schema + [{'field_name': 'extra', 'field_type': 'string'}]))
    assert not any('字段数量' in item for item in design_errors({}, schema + [{'field_name': 'old', 'field_type': 'string', 'archived': True}]))


def test_disabling_default_preserves_definition_but_stops_fixed_and_template_values():
    from app.api.forms import _apply_designer_field_settings
    fixed_rule = {'mode': 'fixed', 'enabled': False}
    composed_rule = {**template(('text', 'MAT-'), ('field', 'name')), 'enabled': False}
    fields = [field('name'), field('fixed', fixed_rule, default='保留的固定值'), field('composed', composed_rule)]
    data = {'name': '物料'}
    assert not apply_defaults(fields, data) and data == {'name': '物料'}
    fields[1].ui_config['defaultRule']['enabled'] = True
    fields[2].ui_config['defaultRule']['enabled'] = True
    apply_defaults(fields, data)
    assert data['fixed'] == '保留的固定值' and data['composed'] == 'MAT-物料'
    fixed_rule['enabled'] = False
    saved = _apply_designer_field_settings({'formDesignerControls': [
        {'fieldKey': 'fixed', 'controlType': 'text', 'defaultRule': fixed_rule}
    ]}, [{'field_name': 'fixed', 'field_type': 'string', 'default_value': '保留的固定值', 'ui_config': {}}])[0]
    assert saved['ui_config']['defaultRule'] == {'mode': 'fixed', 'enabled': False}
    assert saved['default_value'] == '保留的固定值'


@pytest.mark.parametrize('mode', ['fixed', 'template'])
def test_conditional_defaults_only_fill_when_all_conditions_match(mode):
    rule = {'mode': mode, 'conditions': [
        {'sourceField': 'category', 'operator': 'eq', 'value': 'RAW'},
        {'sourceField': 'quantity', 'operator': 'gte', 'value': '10'},
    ], 'parts': [{'kind': 'text', 'value': '自动预填'}]}
    fields = [field('target', rule, default='自动预填'), field('category'), field('quantity', kind='integer')]
    for category, quantity, matches in [('RAW', 10, True), ('RAW', 9, False), ('FINISHED', 10, False)]:
        data = {'category': category, 'quantity': quantity}
        assert ('target' in apply_defaults(fields, data)) is matches
        assert data.get('target') == ('自动预填' if matches else None)
    manual = {'category': 'RAW', 'quantity': 10, 'target': '人工输入'}
    assert not apply_defaults(fields, manual) and manual['target'] == '人工输入'
    assert not apply_defaults(fields, {'category': 'RAW', 'quantity': 10}, existing={})


def test_conditions_resolve_source_defaults_and_publish_mapping():
    from app.api.forms import _apply_designer_field_settings
    rule = {'mode': 'fixed', 'conditions': [{'sourceField': 'category', 'operator': 'eq', 'value': 'RAW'}]}
    fields = [field('target', rule, default='默认内容'), field('category', default='RAW')]
    data = {}; apply_defaults(fields, data)
    assert data == {'category': 'RAW', 'target': '默认内容'}
    mapped = _apply_designer_field_settings({'formDesignerControls': [{'fieldKey': 'target', 'controlType': 'text', 'defaultRule': rule}]}, [
        {'field_name': 'target', 'field_type': 'string', 'default_value': '默认内容', 'ui_config': {}}
    ])[0]
    assert mapped['ui_config']['defaultRule'] == rule


@pytest.mark.parametrize('conditions', [
    {}, [{'sourceField': 'missing', 'operator': 'eq', 'value': 'x'}],
    [{'sourceField': 'target', 'operator': 'eq', 'value': 'x'}],
    [{'sourceField': 'source', 'operator': 'unsupported', 'value': 'x'}],
    [{'sourceField': 'source', 'operator': 'eq', 'value': ''}],
])
def test_invalid_default_conditions_rejected(conditions):
    fields = [field('source'), field('target', {'mode': 'fixed', 'conditions': conditions}, default='x')]
    with pytest.raises(HTTPException) as error:
        apply_defaults(fields, {})
    assert error.value.status_code == 422


def test_condition_dependency_cycles_block_publish_and_runtime():
    def conditional(source):
        return {'mode': 'fixed', 'conditions': [{'sourceField': source, 'operator': 'notEmpty'}]}
    controls = [{'fieldKey': name, 'controlType': 'text', 'defaultRule': conditional(other)} for name, other in [('a', 'b'), ('b', 'a')]]
    errors = design_errors({'formDesignerControls': controls}, [{'field_name': name, 'field_type': 'string'} for name in ['a', 'b']])
    assert any('循环' in error for error in errors)
    with pytest.raises(HTTPException):
        apply_defaults([field('a', conditional('b'), default='a'), field('b', conditional('a'), default='b')], {})
