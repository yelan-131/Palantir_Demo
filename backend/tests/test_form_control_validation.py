from types import SimpleNamespace
from io import BytesIO
import pytest
from fastapi import HTTPException, UploadFile
from app.services.form_control_validation import validate,normalize,design_errors
from app.services import form_files

def field(kind,settings,storage='string'):
    return SimpleNamespace(field_name='f',label='字段',field_type=storage,ui_config={'controlType':kind,'typeSettings':settings})

@pytest.mark.parametrize('value,kind,rules',[
    ('x','text',{'minLength':2}),('abcd','text',{'maxLength':3}),('bad','text',{'textFormat':'email'}),
    (0,'number',{'min':1}),(11,'number',{'max':10}),(1.234,'number',{'precision':2}),
    ('2000-01-01','datetime',{'disablePast':True}),
    ('a','select',{'selectionMode':'multiple'}),
    ([{}],'select',{'selectionMode':'multiple'}),
    (['2026-10-22','2026-10-21'],'datetime',{'dateMode':'range'}),
    ([{}],'editable-table',{'columns':[{'key':'qty','label':'数量','type':'number','required':True}]}),
    ([{'qty':'two'}],'editable-table',{'columns':[{'key':'qty','label':'数量','type':'number'}]}),
    ([{},{}],'editable-table',{'maxRows':1}),
])
def test_server_rejects_invalid_designer_values(value,kind,rules):
    with pytest.raises(HTTPException) as error:validate(value,field(kind,rules))
    assert error.value.status_code==422

def test_normalization_and_publish_checks():
    assert normalize(' a b ',{'trimMode':'trimAll','caseMode':'upper'})=='AB'
    controls=[{'controlType':'number','fieldKey':'f','name':'数量','typeSettings':{'min':3,'max':1}}, {'controlType':'text','fieldKey':'f'}]
    errors=design_errors({'formDesignerControls':controls},[{'field_name':'f','field_type':'integer'}])
    assert any('重复绑定' in e for e in errors) and any('最小值' in e for e in errors)
    assert design_errors({'formDesignerControls':[{'controlType':'upload','fieldKey':'f'}]},[{'field_name':'f','field_type':'string'}])
    assert not design_errors({'formDesignerControls':[{'controlType':'upload','fieldKey':'f','typeSettings':{'maxFiles':2}}]},[{'field_name':'f','field_type':'json'}])

@pytest.mark.asyncio
async def test_private_attachment_persistence_and_tenant_and_owner_boundary(tmp_path,monkeypatch):
    monkeypatch.setattr(form_files.settings,'FORM_FILE_STORAGE_DIR',str(tmp_path))
    upload=UploadFile(filename='../验收.txt',file=BytesIO(b'hello'))
    info=await form_files.save(upload,1,2,'evidence',7,{'fileTypes':'txt'})
    assert info['name']=='验收.txt' and info['size']==5 and 'owner_id' not in info
    assert form_files.metadata(1,2,'evidence',info['id'])[1].read_bytes()==b'hello'
    with pytest.raises(HTTPException):form_files.metadata(2,2,'evidence',info['id'])
    with pytest.raises(HTTPException):form_files.metadata(1,2,'evidence','../../etc/passwd')
    with pytest.raises(HTTPException):form_files.validate_value([info],tenant_id=1,form_id=2,field_name='evidence',uid=8,rules={})
    restored=form_files.validate_value([{**info,'name':'forged'}],tenant_id=1,form_id=2,field_name='evidence',uid=8,rules={},existing=[info])
    assert restored[0]['name']=='验收.txt'
    with pytest.raises(HTTPException):form_files.check_file('bad.exe',1,{'fileTypes':'图片 PDF'})
    with pytest.raises(HTTPException):form_files.check_file('a.txt',2*1024*1024,{'maxFileSize':1})
