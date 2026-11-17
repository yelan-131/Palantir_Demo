"""Shared form versions contracts for HTTP and tool callers."""
from __future__ import annotations
import copy
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.principal import current_tenant_id, current_user_id, ensure_admin
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
    ensure_admin(user)
    from app.models.relational import Form
    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, 'Form not found')
    report, _snapshot = await _build_publish_preview(db, tenant_id, form)
    return {'data': {'form_id': form_id, **report}}


async def publish_form(form_id: int, db: AsyncSession, user: dict, *, defer_commit: bool = False):
    ensure_admin(user)
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


def _form_version_summary(version) -> dict:
    snapshot = version.snapshot or {}
    fields = snapshot.get('fields') if isinstance(snapshot.get('fields'), list) else []
    layouts = snapshot.get('layouts') if isinstance(snapshot.get('layouts'), list) else []
    return {
        'id': version.id,
        'tenant_id': getattr(version, 'tenant_id', None),
        'form_id': version.form_id,
        'version': version.version,
        'status': version.status,
        'field_count': len(fields),
        'layout_count': len(layouts),
        'published_by': version.published_by,
        'published_at': version.published_at.isoformat() if version.published_at else None,
        'created_at': version.created_at.isoformat() if version.created_at else None,
        'updated_at': version.updated_at.isoformat() if version.updated_at else None,
    }


_FIELD_RESTORE = ('label', 'field_type', 'required', 'visible_in_list', 'visible_in_form', 'searchable', 'sortable', 'archived', 'default_value', 'enum_values', 'validation', 'ui_config', 'sort_order')


def _published_config_as_draft(snapshot: dict) -> dict:
    config = copy.deepcopy(((snapshot or {}).get('form') or {}).get('config') or {})
    config['viewConfigDraft'] = copy.deepcopy(config.get('viewConfig') or {})
    config['permissionDesignDraft'] = copy.deepcopy(config.get('permissionDesign') or {'roles': {}})
    if 'analyticsDesign' in config:
        config['analyticsDesignDraft'] = copy.deepcopy(config['analyticsDesign'])
    meta = dict(config.get('workflowDesigner') or {})
    meta.pop('draftWorkflowId', None)
    config['workflowDesigner'] = meta
    return config


async def _restore_fields(db, form, snapshot: dict):
    from app.models.relational import FormField
    from sqlalchemy import select
    current = (await db.scalars(select(FormField).where(FormField.form_id == form.id, FormField.tenant_id == form.tenant_id))).all()
    by_id = {field.id: field for field in current}
    by_name = {field.field_name: field for field in current}
    for payload in snapshot.get('fields') or []:
        if not isinstance(payload, dict) or not payload.get('field_name'):
            continue
        field = by_id.get(payload.get('id')) or by_name.get(payload['field_name'])
        if field is None:
            field = FormField(tenant_id=form.tenant_id, form_id=form.id, field_name=str(payload['field_name']), label=str(payload.get('label') or payload['field_name']))
            db.add(field)
            by_name[field.field_name] = field
        for key in _FIELD_RESTORE:
            if key in payload:
                setattr(field, key, payload[key])


async def _restore_layouts(db, form, snapshot: dict):
    from app.models.relational import FormLayout
    from sqlalchemy import select
    current = (await db.scalars(select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.tenant_id == form.tenant_id))).all()
    by_type = {layout.layout_type: layout for layout in current}
    for payload in snapshot.get('layouts') or []:
        if not isinstance(payload, dict) or not payload.get('layout_type'):
            continue
        layout = by_type.get(payload['layout_type'])
        if layout is None:
            layout = FormLayout(tenant_id=form.tenant_id, form_id=form.id, layout_type=str(payload['layout_type']), config=payload.get('config') or {})
            db.add(layout)
            by_type[layout.layout_type] = layout
        else:
            layout.config = payload.get('config') or {}


async def restore_form_draft(form_id: int, db: AsyncSession, user: dict, version_number: int | None = None):
    ensure_admin(user)
    from app.models.relational import Form, FormVersion
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, 'Form not found')
    if version_number is None:
        version = await _latest_form_version(db, form.tenant_id, form_id)
    else:
        version = await db.scalar(select(FormVersion).where(FormVersion.form_id == form_id, FormVersion.tenant_id == form.tenant_id, FormVersion.version == version_number, FormVersion.status.in_(['published', 'active'])))
    if not version:
        raise HTTPException(409 if version_number is None else 404, '当前没有可恢复的已发布版本' if version_number is None else 'Form version not found')
    snapshot = version.snapshot or {}
    await _restore_fields(db, form, snapshot)
    await _restore_layouts(db, form, snapshot)
    form.config = _published_config_as_draft(snapshot)
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
    return {'data': [_form_version_summary(version) for version in versions]}


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

