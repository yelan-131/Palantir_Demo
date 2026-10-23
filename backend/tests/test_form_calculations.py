"""Formula precision, lazy branches, publication and authoritative recomputation."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.form_calculations import compute, expression_tree, references, validate_rule, design_errors
from app.services.form_rules import evaluate
from app.api.forms import _apply_designer_field_settings


def field(name, kind='number', computed=None):
    return SimpleNamespace(field_name=name, label=name, field_type=kind, required=False,
        archived=False, validation=None, default_value=None, enum_values=None,
        ui_config={'computed': computed} if computed else {})


@pytest.mark.parametrize('expression,data,expected', [
    ('quantity * price', {'quantity': 3, 'price': 19.9}, 59.7),
    ('(amount - discount) / count', {'amount': 100, 'discount': 10, 'count': 3}, 30),
    ('0.1 + 0.2', {}, 0.3),
    ('ROUND(1.005, 2)', {}, 1.01),
    ('ROUND(-1.005, 2)', {}, -1.01),
    ('ABS(-3) + MIN(2, 4) + MAX(2, 4)', {}, 9),
    ('7 % 4', {}, 3),
    ('+price * -2', {'price': 1.25}, -2.5),
    ('IF(quantity >= 10, quantity * price * 0.9, quantity * price)', {'quantity': 10, 'price': 5}, 45),
    ('IF(category == "RAW", 1, 2)', {'category': 'RAW'}, 1),
    ('IF(count == 0, 0, amount / count)', {'count': 0, 'amount': 1}, 0),
    ('COALESCE(missing, fallback, 0)', {'fallback': 12}, 12),
    ('name + "-" + batch', {'name': '物料', 'batch': 'A'}, '物料-A'),
])
def test_formula_results(expression, data, expected):
    assert compute(expression_tree(expression), data) == expected


def test_rounding_empty_policy_and_function_names_are_not_dependencies():
    rule = {'expression': 'ROUND(quantity * price, 2)', 'precision': 1, 'emptyBehavior': 'empty'}
    tree = validate_rule(rule)
    assert references(tree) == {'quantity', 'price'}
    assert compute(tree, {'quantity': 1, 'price': 1.25}, rule) == 1.3
    assert compute(tree, {'quantity': 2}, rule) is None
    assert compute(tree, {'quantity': 2}, {**rule, 'emptyBehavior': 'zero'}) == 0
    assert compute(expression_tree('IF(quantity > 1, 1, 0)'), {}) is None


@pytest.mark.parametrize('expression', [
    '__import__("os")', 'price.__class__', 'price[0]', '[x for x in price]', '2 ** 1000',
    'sum(price)', 'ROUND(1, digits=2)', 'IF(1, 2)', 'lambda: 1', '"a" * 10000000',
    '1 / 0', '1e999', 'ROUND(1, 99)', '1e30 * 10', 'True', '1 < 2',
])
def test_unsafe_or_invalid_operations_fail(expression):
    with pytest.raises(HTTPException) as error:
        compute(expression_tree(expression), {'price': 1})
    assert error.value.status_code == 422


@pytest.mark.parametrize('patch', [{'precision': 7}, {'precision': True}, {'emptyBehavior': 'ignore'}, {'expression': ''}])
def test_invalid_rule_options(patch):
    with pytest.raises(HTTPException): validate_rule({'expression': '1 + 2', **patch})


@pytest.mark.asyncio
async def test_chained_numeric_formulas_recompute_on_create_and_edit_and_ignore_forgery():
    fields = [field('quantity'), field('price'),
        field('total', computed={'expression': 'quantity * price', 'precision': 2}),
        field('taxed', computed={'expression': 'total * 1.13', 'precision': 2})]
    result = await evaluate(None, {}, fields, {'quantity': 3, 'price': 19.9, 'total': 1, 'taxed': 1}, enforce=True)
    assert result['data']['total'] == 59.7 and result['data']['taxed'] == 67.46
    assert result['states']['total']['readonly'] and result['states']['taxed']['readonly']
    edited = await evaluate(None, {}, fields, {'quantity': 4}, existing=result['data'], enforce=True)
    assert edited['data']['total'] == 79.6 and edited['data']['taxed'] == 89.95
    cleared = await evaluate(None, {}, fields, {'price': None}, existing=edited['data'])
    assert cleared['data']['total'] is None and cleared['data']['taxed'] is None


@pytest.mark.asyncio
async def test_unknown_fields_cycles_and_result_types_fail():
    for rules in [
        [field('result', computed={'expression': 'missing + 1'})],
        [field('a', computed={'expression': 'b + 1'}), field('b', computed={'expression': 'a + 1'})],
        [field('result', 'integer', {'expression': '1 / 2'})],
        [field('result', computed={'expression': '"abc"'})],
    ]:
        with pytest.raises(HTTPException): await evaluate(None, {}, rules, {})


def test_publishing_round_trip_and_deleting_rule_preserves_storage():
    rule = {'expression': 'quantity * price', 'precision': 2, 'emptyBehavior': 'zero'}
    fields = [{'field_name': name, 'label': name, 'field_type': 'number', 'ui_config': {'custom': 'keep'}} for name in ['quantity', 'price', 'total']]
    controls = [{'id': 'total', 'fieldKey': 'total', 'computed': rule, 'typeSettings': {'precision': 0}}]
    saved = _apply_designer_field_settings({'formDesignerControls': controls}, fields)
    assert saved[2]['ui_config']['computed'] == rule
    assert saved[2]['ui_config']['typeSettings']['precision'] == 2
    assert saved[2]['ui_config']['custom'] == 'keep' and saved[2]['field_type'] == 'number'
    assert not design_errors(saved)
    controls[0]['computed'] = None
    cleared = _apply_designer_field_settings({'formDesignerControls': controls}, saved)
    assert 'computed' not in cleared[2]['ui_config']


@pytest.mark.parametrize('expression', ['unknown + 1', 'total + 1'])
def test_publish_validation_rejects_missing_or_cyclic_references(expression):
    assert design_errors([{'field_name': 'total', 'field_type': 'number', 'ui_config': {'computed': {'expression': expression}}}])


def test_formula_writers_cannot_conflict_with_defaults_or_assignments():
    calculated = {'field_name': 'total', 'field_type': 'number', 'ui_config': {'computed': {'expression': '1'}}}
    assert design_errors([{**calculated, 'default_value': '1'}])
    source = {'field_name': 'source', 'ui_config': {'assignmentRules': [{'targetField': 'total', 'sourceAttribute': 'self.value'}]}}
    assert design_errors([source, calculated])
