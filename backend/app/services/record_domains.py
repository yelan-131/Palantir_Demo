"""Enforce domain boundaries for generic form writes as well as dedicated pages."""
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import HTTPException


def prepare_domain_create(code, data, user):
    if code == 'alert-center':
        from app.services.alert_service import is_material_request
        if is_material_request(data):
            raise HTTPException(422, '料号申请请在独立入口登记')
    if code == 'material-application':
        if any(key in data for key in ('migration_marker', 'source_form_id', 'source_record_id', 'source_payload', 'approval_source')):
            raise HTTPException(403, '历史来源信息只能由迁移程序写入')
        data = {key: value for key, value in data.items() if key in ('part_no', 'title')}
        data.update(request_no='MATREQ-' + uuid4().hex[:16].upper(),
                    applicant=str(user.get('sub') or user.get('uid') or ''),
                    applied_at=datetime.now(timezone.utc).isoformat(),
                    status='待提交', process_status='未提交')
    return data


def validate_domain_update(code, data):
    if code == 'material-application' and set(data) & {'status', 'process_status', 'request_no', 'applicant', 'applied_at', 'source_payload', 'source_form_id', 'source_record_id', 'migration_marker', 'approval_source', 'resolution', 'current_node', 'current_handler', 'interaction_log'}:
        raise HTTPException(403, '申请状态、审批和历史来源信息不能通过表单编辑改写')
    if code == 'alert-center':
        from app.services.alert_service import is_material_request
        if is_material_request(data):
            raise HTTPException(422, '料号申请请在独立入口登记')
        if set(data) & {'status', 'owner', 'resolution', 'completed_at', 'interaction_log'}:
            raise HTTPException(422, '告警状态与处置信息请通过告警中心操作，不能直接修改')


def protect_migrated_request(code, data):
    if code == 'material-application' and data.get('migration_marker') == 'alert-material-split-v1':
        raise HTTPException(403, '历史申请快照不可修改或删除，请在原审批流程中处理')
