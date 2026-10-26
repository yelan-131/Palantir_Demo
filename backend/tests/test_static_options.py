from tests.test_record_service import environment

import pytest
from app.services.static_options import parse_options, option_errors
from app.services.form_control_validation import design_errors
from app.api.forms import _apply_designer_field_settings


def test_structured_options_preserve_labels_types_and_punctuation():
    choices = parse_options('[{"label":"启用，正常", "value":1},{"label":"停用", "value":"off/hold"}]')
    assert choices == [{'label': '启用，正常', 'value': 1}, {'label': '停用', 'value': 'off/hold'}]
    assert parse_options('启用、停用') == ['启用', '停用']
    assert not option_errors(choices)
    assert option_errors([{'label': '', 'value': ''}])
    assert option_errors([1, '1'])
    with pytest.raises(ValueError): parse_options('[{"label":"缺少值"}]')


def setup_control(source, **settings):
    control = {'id': 'c', 'name': '状态', 'fieldKey': 'status', 'controlType': 'select', 'dataSourceKind': 'static', 'optionSource': source, 'typeSettings': settings}
    fields = [{'field_name': 'status', 'label': '状态', 'field_type': 'enum', 'enum_values': {'values': [{'label': '旧名称', 'value': 'on'}]}, 'ui_config': {}}]
    return {'formDesignerControls': [control]}, fields


def test_labels_and_codes_survive_publish_mapping_and_clear():
    config, fields = setup_control('[{"label":"新名称", "value":"on"}]')
    mapped = _apply_designer_field_settings(config, fields)
    assert mapped[0]['enum_values']['values'] == [{'label': '新名称', 'value': 'on'}]
    assert not design_errors(config, mapped)
    legacy, fields = setup_control('on')
    assert _apply_designer_field_settings(legacy, fields)[0]['enum_values']['values'][0]['label'] == '旧名称'
    empty, fields = setup_control('[]')
    assert _apply_designer_field_settings(empty, fields)[0]['enum_values']['values'] == []
    assert any('至少添加' in error for error in design_errors(empty, fields))


@pytest.mark.parametrize('source,settings,expected', [
    ('[{"label":"A","value":"a"},{"label":"B","value":"a"}]', {}, '重复'),
    ('["a"]', {'selectionMode':'single','displayMode':'tags'}, '标签'),
    ('["a"]', {'selectionMode':'single','allowCreateOption':True}, '临时项'),
    ('["a"]', {'selectionMode':'multiple','displayMode':'radio','allowCreateOption':True}, '临时项'),
])
def test_invalid_configuration_is_blocked(source, settings, expected):
    config, fields = setup_control(source, **settings)
    assert any(expected in error for error in design_errors(config, fields))


def test_default_must_be_an_option_code_and_reference_modes_are_restricted():
    config, fields = setup_control('[{"label":"启用","value":"on"}]')
    fields[0]['default_value'] = '启用'
    assert any('默认值' in error for error in design_errors(config, fields))
    fields[0]['default_value'] = 'on'
    assert not design_errors(config, fields)
    config['formDesignerControls'][0].update(dataSourceKind='businessForm', typeSettings={'selectionMode':'multiple'})
    assert any('仅支持单选' in error for error in design_errors(config, fields))


@pytest.mark.asyncio
async def test_publish_and_record_read_use_stable_option_codes(environment, monkeypatch):
    import json
    from unittest.mock import AsyncMock
    from app.api import forms
    from app.models.relational import FormField
    from sqlalchemy import select
    db, _, form, user, client = environment
    monkeypatch.setattr(forms, 'write_audit_log', AsyncMock())
    user['is_admin'] = True
    field = await db.scalar(select(FormField).where(FormField.form_id == form.id, FormField.field_name == 'status'))
    field.field_type = 'enum'
    choices = [{'label': '正常，启用', 'value': 'enabled'}, {'label': '停用', 'value': 'disabled'}]
    config, _ = setup_control(json.dumps(choices))
    form.config = config
    await db.commit()
    response = await client.post('/forms/1/publish')
    assert response.status_code == 200, response.text
    await db.refresh(form)
    await db.refresh(field)
    response = await client.get('/forms/1?schema=published&scope=designer')
    published = next(item for item in response.json()['data']['fields'] if item['field_name'] == 'status')
    assert published['enum_values']['values'] == choices
    response = await client.post('/forms/1/records', json={'data': {'title': '选项测试', 'status': 'enabled'}})
    assert response.status_code == 200, response.text
    record_id = response.json()['data']['id']
    response = await client.get(f'/forms/1/records/{record_id}')
    assert response.json()['data']['data']['status'] == 'enabled'
