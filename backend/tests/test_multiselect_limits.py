from types import SimpleNamespace
import json
import pytest
from fastapi import HTTPException
from app.services.form_control_validation import validate, design_errors
from tests.test_record_service import environment


def multi_field(**settings):
    return SimpleNamespace(field_name='status', label='状态', field_type='enum', ui_config={'controlType':'select', 'typeSettings':{'selectionMode':'multiple', **settings}})


@pytest.mark.parametrize('value', [None, '', [], ['a']])
def test_minimum_applies_to_empty_and_incomplete_submissions(value):
    with pytest.raises(HTTPException, match='至少选择 2 项'):
        validate(value, multi_field(minSelections=2))
    validate(value, multi_field(minSelections=2), partial=True)


def test_maximum_always_applies_and_counts_cannot_be_faked_with_duplicates():
    field = multi_field(minSelections=1, maxSelections=2)
    validate(['a'], field)
    validate(['a', 'b'], field)
    for partial in [True, False]:
        with pytest.raises(HTTPException, match='最多选择 2 项'): validate(['a', 'b', 'c'], field, partial=partial)
    with pytest.raises(HTTPException, match='重复选择'): validate(['a', 'a'], field)
    validate(None, multi_field())
    validate('a', SimpleNamespace(field_name='f', label='字段', ui_config={'controlType':'select','typeSettings':{'selectionMode':'single','minSelections':2}}))


def config(**settings):
    return {'formDesignerControls':[{'id':'c', 'controlType':'select','fieldKey':'status', 'name':'状态', 'dataSourceKind':'static', 'optionSource':'["a","b","c"]', 'typeSettings':{'selectionMode':'multiple', **settings}}]}


@pytest.mark.parametrize('settings,expected', [
    ({'minSelections':3,'maxSelections':2}, '不能大于'),
    ({'minSelections':4}, '候选选项'),
    ({'maxSelections':0}, '最多选择需要'),
    ({'minSelections':-1}, '最少选择需要'),
    ({'maxSelections':1.5}, '整数'),
    ({'minSelections':True}, '整数'),
    ({'maxVisibleTags':0}, '显示标签数'),
    ({'tagCollapse':'bad'}, '折叠方式'),
])
def test_invalid_designs_are_rejected(settings, expected):
    assert any(expected in error for error in design_errors(config(**settings), [{'field_name':'status','field_type':'enum'}]))


@pytest.mark.asyncio
async def test_limits_survive_publish_and_enforce_create_edit_and_clear(environment, monkeypatch):
    from unittest.mock import AsyncMock
    from sqlalchemy import select
    from app.api import forms
    from app.models.relational import FormField
    db, _, form, user, client = environment
    monkeypatch.setattr(forms,'write_audit_log',AsyncMock())
    user['is_admin']=True
    field=await db.scalar(select(FormField).where(FormField.form_id==1,FormField.field_name=='status'))
    field.field_type='enum'
    form.config=config(minSelections=2,maxSelections=2,tagCollapse='fixed',maxVisibleTags=1)
    await db.commit()
    response=await client.post('/forms/1/publish'); assert response.status_code==200,response.text
    await db.refresh(form); await db.refresh(field)
    response=await client.get('/forms/1?schema=published&scope=designer')
    saved=next(item for item in response.json()['data']['fields'] if item['field_name']=='status')
    assert saved['ui_config']['typeSettings']['maxVisibleTags']==1
    for value in [None, [], ['a'], ['a','b','c']]:
        response=await client.post('/forms/1/records',json={'data':{'title':'Limit test','status':value}})
        assert response.status_code==422,response.text
    response=await client.post('/forms/1/records',json={'data':{'title':'Limit test','status':['a','b']}})
    assert response.status_code==200,response.text
    record_id=response.json()['data']['id']
    response=await client.get(f'/forms/1/records/{record_id}')
    assert response.json()['data']['data']['status']==['a','b']
    response=await client.put(f'/forms/1/records/{record_id}',json={'data':{'status':[]}})
    assert response.status_code==422,response.text
