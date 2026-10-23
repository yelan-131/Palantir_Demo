"""Conditional schemes must select and compose independently, including published snapshots."""
from types import SimpleNamespace
from copy import deepcopy

import pytest
from fastapi import HTTPException

from app.api.form_engine.encoding import _code_sequence_from_value, _render_code_template, _select_encoding_rule, _sequence_period_key


def scheme(identifier, kind, extra=False):
    parts = [{'type': 'fixed', 'value': kind, 'length': 1, 'padding': 'none'},
             {'type': 'field', 'sourceField': 'category', 'length': 2, 'padding': 'truncate'}]
    if extra:
        parts += [{'type': 'fixed', 'value': '-', 'length': 1},
                  {'type': 'fixed', 'value': 'X', 'length': 1}]
    parts += [{'type': 'sequence', 'length': 3, 'resetCycle': 'never'}]
    return {'id': identifier, 'name': identifier, 'enabled': True, 'segments': parts,
            'conditions': [{'sourceField': 'category', 'operator': 'eq', 'value': kind}]}


def test_different_conditions_select_three_and_five_segments():
    a, b = scheme('a', 'A'), scheme('b', 'B', True)
    rules = {'rules': [a, b]}
    for data, expected in [({'category': 'A'}, 'AA001'), ({'category': 'B'}, 'BB-X001')]:
        selected = _select_encoding_rule(rules, data)
        assert _render_code_template(selected, 1, data) == expected
    assert _sequence_period_key(a) != _sequence_period_key(b)
    with pytest.raises(HTTPException) as error:
        _select_encoding_rule(rules, {'category': 'C'})
    assert error.value.status_code == 422


def test_all_conditions_and_unconditional_rule_conflict():
    first = scheme('first', 'A')
    first['conditions'].append({'sourceField': 'amount', 'operator': 'gte', 'value': '10'})
    fallback = scheme('fallback', 'F')
    fallback['conditions'] = []
    assert _select_encoding_rule({'rules': [first, fallback]}, {'category': 'A', 'amount': 9})['id'] == 'fallback'
    with pytest.raises(HTTPException) as error:
        _select_encoding_rule({'rules': [first, fallback]}, {'category': 'A', 'amount': 10})
    assert error.value.status_code == 422
    assert '编码规则冲突' in error.value.detail
    assert 'first、fallback' in error.value.detail
    first['enabled'] = False
    assert _select_encoding_rule({'rules': [first, fallback]}, {'category': 'A', 'amount': 10})['id'] == 'fallback'


@pytest.mark.parametrize('reverse', [False, True])
def test_overlapping_rules_rejected_regardless_of_order(reverse):
    a, b = scheme('原料编码', 'A'), scheme('供应商编码', 'A')
    b['conditions'] = [{'sourceField': 'supplier', 'operator': 'eq', 'value': '甲公司'}]
    rules = [a, b] if not reverse else [b, a]
    with pytest.raises(HTTPException) as error:
        _select_encoding_rule({'rules': rules}, {'category': 'A', 'supplier': '甲公司'})
    assert error.value.status_code == 422
    assert all(name in error.value.detail for name in ['原料编码', '供应商编码'])
    assert _select_encoding_rule({'rules': rules}, {'category': 'A', 'supplier': '乙公司'})['id'] == '原料编码'


@pytest.mark.asyncio
async def test_conflict_does_not_allocate_sequence(monkeypatch):
    from unittest.mock import AsyncMock
    from app.api.form_engine import sequences
    allocate = AsyncMock()
    monkeypatch.setattr(sequences, '_allocate_code_sequence', allocate)
    field = SimpleNamespace(field_name='code', archived=False,
        ui_config={'businessType': 'code', 'encodingRule': {'rules': [scheme('a', 'A'), scheme('b', 'A')]}})
    with pytest.raises(HTTPException, match='编码规则冲突'):
        await sequences._apply_record_encoding_rules(None, 1, SimpleNamespace(id=1), [field], {'category': 'A'})
    allocate.assert_not_awaited()


def test_composition_sequence_start_step_and_source_validation():
    rule = scheme('start', 'A')
    rule['segments'][-1].update(sequenceStart=10, sequenceStep=5)
    assert _render_code_template(rule, 2, {'category': 'A'}) == 'AA015'
    assert _code_sequence_from_value('AA015', rule) == 2
    assert _code_sequence_from_value('BB-X001', rule) == 0
    with pytest.raises(HTTPException):
        _render_code_template(rule, 1, {})
    legacy = {'template': 'AL-{seq:3}', 'sequenceLength': 3}
    assert _select_encoding_rule(legacy, {}) == legacy
    assert _render_code_template(legacy, 2) == 'AL-002'


@pytest.mark.asyncio
async def test_snapshot_rules_and_runtime_counters(tmp_path):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.relational import Base, Tenant, Form, FormField, FormVersion
    from app.api.forms import _form_snapshot
    from app.services.form_runtime import _runtime_form_fields
    from app.api.form_engine.sequences import _apply_record_encoding_rules
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "encoding.db"}')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add(Tenant(id=1, name='encoding', slug='encoding'))
            rules = {'enabled': True, 'rules': [scheme('a', 'A'), scheme('b', 'B', True)]}
            form = Form(id=1, tenant_id=1, name='encoding', code='encoding', config={
                'formDesignerControls': [{'fieldKey': 'code', 'encodingRule': deepcopy(rules)}]})
            field = FormField(tenant_id=1, form_id=1, field_name='code', label='Code', field_type='string',
                              ui_config={'businessType': 'code', 'encodingRule': {'template': 'OLD-{seq}'}})
            db.add_all([form, field]); await db.commit()
            snapshot = await _form_snapshot(db, 1, form)
            assert snapshot['fields'][0]['encoding_rule'] == rules
            assert field.ui_config['encodingRule']['template'] == 'OLD-{seq}'
            db.add(FormVersion(tenant_id=1, form_id=1, version=1, snapshot=snapshot))
            await db.commit()
            runtime_fields = await _runtime_form_fields(db, 1, 1)
            runtime_field = runtime_fields[0]
            for category, expected in [('A', 'AA001'), ('B', 'BB-X001'), ('A', 'AA002'), ('B', 'BB-X002')]:
                result = await _apply_record_encoding_rules(db, 1, form, [runtime_field], {'category': category})
                assert result['code'] == expected
    finally:
        await engine.dispose()


def test_disabling_all_rules_skips_generation():
    a = scheme('a', 'A')
    a['enabled'] = False
    assert _select_encoding_rule({'enabled': True, 'rules': [a]}, {'category': 'A'}) == {'enabled': False}


@pytest.mark.parametrize('padding', ['none', 'leftZero', 'rightZero'])
@pytest.mark.parametrize('segment,data', [
    ({'type': 'fixed', 'value': 'MAT-'}, {}),
    ({'type': 'field', 'sourceField': 'category'}, {'category': 'ABCD'}),
    ({'type': 'sequence', 'sequenceStart': 1000}, {}),
])
def test_overlong_segments_rejected_without_explicit_truncation(padding, segment, data):
    rule = {'segments': [{**segment, 'length': 3, 'padding': padding}]}
    with pytest.raises(HTTPException) as error:
        _render_code_template(rule, 1, data)
    assert error.value.status_code == 422
    assert '超过配置的 3 位' in error.value.detail


@pytest.mark.parametrize('padding,expected', [
    ('none', 'A'), ('leftZero', '00A'), ('rightZero', 'A00'), ('truncate', 'A'),
])
def test_short_segments_follow_selected_padding(padding, expected):
    rule = {'segments': [{'type': 'fixed', 'value': 'A', 'length': 3, 'padding': padding}]}
    assert _render_code_template(rule, 1) == expected


def test_explicit_truncation_and_exact_length():
    assert _render_code_template({'segments': [{'type': 'fixed', 'value': 'MAT-', 'length': 3, 'padding': 'truncate'}]}, 1) == 'MAT'
    assert _render_code_template({'segments': [{'type': 'fixed', 'value': 'MAT-', 'length': 4}]}, 1) == 'MAT-'
