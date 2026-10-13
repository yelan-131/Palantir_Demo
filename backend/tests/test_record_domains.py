import pytest
from fastapi import HTTPException
from app.services.record_domains import prepare_domain_create, validate_domain_update, protect_migrated_request

def test_material_registration_cannot_forge_approval():
    result = prepare_domain_create('material-application', {'part_no':'MAT-X', 'title':'新增物料', 'status':'已完成', 'applicant':'other'}, {'sub':'alice'})
    assert result['status'] == '待提交'
    assert result['applicant'] == 'alice'
    assert result['process_status'] == '未提交'
    assert result['request_no'].startswith('MATREQ-')

def test_new_request_cannot_impersonate_history():
    with pytest.raises(HTTPException) as error:
        prepare_domain_create('material-application', {'source_record_id':368}, {'sub':'alice'})
    assert error.value.status_code == 403

def test_generic_alert_write_cannot_bypass_disposition():
    with pytest.raises(HTTPException) as error:
        validate_domain_update('alert-center', {'status':'closed'})
    assert error.value.status_code == 422
    validate_domain_update('unrelated-form', {'status':'closed'})

def test_explicit_request_cannot_enter_generic_alert_form():
    with pytest.raises(HTTPException):
        prepare_domain_create('alert-center', {'title':'新增料号申请：MAT-X'}, {'sub':'alice'})

def test_history_snapshot_is_immutable():
    with pytest.raises(HTTPException):
        protect_migrated_request('material-application', {'migration_marker':'alert-material-split-v1'})
    protect_migrated_request('material-application', {'title':'new'})

def test_generic_request_update_cannot_forge_approval():
    with pytest.raises(HTTPException) as error:
        validate_domain_update('material-application', {'status':'已完成'})
    assert error.value.status_code == 403
