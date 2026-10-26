"""Shared form versions contracts for HTTP and tool callers."""
from __future__ import annotations
import copy
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import current_tenant_id, current_user_id, require_admin
from app.core.audit import write_audit_log
from app.services.form_runtime import _latest_form_version
from app.services.form_definition import (
    _build_publish_preview,
    _ensure_form_permission,
    _form_payload,
    _form_version_payload,
    _permission_payload,
    _promote_snapshot_config,
    _uid,
)


async def preview_form_publish(form_id: int, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import Form
    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, 'Form not found')
    report, _snapshot = await _build_publish_preview(db, tenant_id, form)
    return {'data': {'form_id': form_id, **report}}


async def publish_form(form_id: int, db: AsyncSession, user: dict, *, defer_commit: bool = False):
    await require_admin(user)
    from app.models.relational import Form, FormVersion
    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, 'Form not found')
    from app.services.field_uniqueness import lock
    await lock(db, tenant_id)
    await db.refresh(form)
    report, snapshot = await _build_publish_preview(db, tenant_id, form)
    if report['blocking_count'] > 0:
        raise HTTPException(409, {'message': 'Publish blocked by incompatible form changes', 'report': report})
    now = datetime.now()
    published_at = now.isoformat()
    snapshot = _promote_snapshot_config(snapshot, published_at, report['next_version'])
    from app.services.designer_permissions import sync_published
    await sync_published(db, form, snapshot['form']['config'])
    from app.models.relational import FormPermission
    snapshot['permissions'] = [_permission_payload(row) for row in (await db.scalars(select(FormPermission).where(FormPermission.tenant_id == tenant_id, FormPermission.form_id == form_id))).all()]
    version = FormVersion(tenant_id=tenant_id, form_id=form.id, version=report['next_version'], status='published', snapshot=snapshot, impact_report=report, published_by=_uid(user), published_at=now)
    form.status = 'published'
    form.config = (snapshot.get('form') or {}).get('config') or form.config
    db.add(version)
    if defer_commit:
        await db.flush()
    else:
        await db.commit()
    await db.refresh(version)
    if not defer_commit:
        await write_audit_log(tenant_id=tenant_id, user_id=current_user_id(user), action='publish', resource_type='form', resource_id=form.id, new_values={'version': version.version, 'impact_report': report})
    return {'data': _form_version_payload(version)}


async def restore_form_draft(form_id: int, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import Form, FormField
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, 'Form not found')
    version = await _latest_form_version(db, form.tenant_id, form_id)
    if not version:
        raise HTTPException(409, '当前没有可恢复的已发布版本')
    config = copy.deepcopy(((version.snapshot or {}).get('form') or {}).get('config') or {})
    config['viewConfigDraft'] = copy.deepcopy(config.get('viewConfig') or {})
    config['permissionDesignDraft'] = copy.deepcopy(config.get('permissionDesign') or {'roles': {}})
    if 'analyticsDesign' in config:
        config['analyticsDesignDraft'] = copy.deepcopy(config['analyticsDesign'])
    meta = config.get('workflowDesigner') or {}
    meta.pop('draftWorkflowId', None)
    config['workflowDesigner'] = meta
    for payload in (version.snapshot or {}).get('fields', []):
        field = await db.get(FormField, payload.get('id')) if payload.get('id') else None
        if field and field.form_id == form_id and (field.tenant_id == form.tenant_id):
            field.default_value = payload.get('default_value')
    form.config = config
    await db.commit()
    await db.refresh(form)
    return {'data': _form_payload(form)}


async def list_form_versions(form_id: int, db: AsyncSession, user: dict):
    from app.models.relational import Form, FormVersion
    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, 'Form not found')
    await _ensure_form_permission(db, user, form_id, 'view')
    versions = (await db.execute(select(FormVersion).where(FormVersion.form_id == form_id, FormVersion.tenant_id == tenant_id).order_by(FormVersion.version.desc(), FormVersion.id.desc()))).scalars().all()
    return {'data': [_form_version_payload(version) for version in versions]}


async def get_form_version(form_id: int, version_number: int, db: AsyncSession, user: dict):
    from app.models.relational import Form, FormVersion
    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, 'Form not found')
    await _ensure_form_permission(db, user, form_id, 'view')
    version = await db.scalar(select(FormVersion).where(FormVersion.form_id == form_id, FormVersion.tenant_id == tenant_id, FormVersion.version == version_number))
    if not version:
        raise HTTPException(404, 'Form version not found')
    return {'data': _form_version_payload(version)}

