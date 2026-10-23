from copy import deepcopy

import pytest

from app.services.reference_data_defaults import default_dictionaries, merge_reference_data


def test_initialization_is_idempotent_and_preserves_custom_and_disabled_values():
    existing = {'dictionaries': [{'id': 'custom-priority', 'dictCode': 'priority',
        'dictName': '自定义优先级', 'options': [{'value': 'high', 'label': '加急', 'enabled': False}, {'value': 'custom', 'label': '特批', 'enabled': True}]}],
        'masterData': [{'id': 'custom-master', 'code': 'equipment', 'fields': [{'name': 'name', 'label': '资产名称'}], 'records': [{'id': '10', 'name': '人工修订'}]}], 'customSetting': True}
    original = deepcopy(existing)
    masters = [{'id': 'builtin', 'code': 'equipment', 'fields': [{'name': 'name', 'label': '设备名称'}, {'name': 'model', 'label': '型号'}],
        'records': [{'id': '10', 'name': '原名称'}, {'id': '11', 'name': '新设备'}]}]
    payload = merge_reference_data(existing, masters)
    priority = payload['dictionaries'][0]
    assert priority['dictName'] == '自定义优先级'
    assert priority['options'][:2] == original['dictionaries'][0]['options']
    assert payload['masterData'][0]['records'] == [{'id': '10', 'name': '人工修订'}, {'id': '11', 'name': '新设备'}]
    assert payload['masterData'][0]['fields'][0]['label'] == '资产名称'
    assert payload['customSetting'] is True
    assert existing == original
    assert merge_reference_data(payload, masters) == payload


def test_defaults_have_unique_stable_codes_and_nonempty_options():
    dictionaries = default_dictionaries()
    assert len({item['dictCode'] for item in dictionaries}) == len(dictionaries)
    for item in dictionaries:
        assert item['options']
        assert len({option['value'] for option in item['options']}) == len(item['options'])
        assert all(option['label'] and option['enabled'] for option in item['options'])


def test_invalid_existing_data_is_not_silently_replaced():
    with pytest.raises(ValueError):
        merge_reference_data({'dictionaries': None}, [])
    with pytest.raises(ValueError):
        merge_reference_data({'dictionaries': [{'dictCode': 'a'}, {'dictCode': 'a'}]}, [])
