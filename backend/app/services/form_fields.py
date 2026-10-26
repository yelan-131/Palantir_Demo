"""Shared form fields contracts for HTTP and tool callers."""
from __future__ import annotations
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import current_tenant_id, current_user_id, require_admin
from app.core.audit import write_audit_log
from app.api.form_engine import _dynamic_record_field_impact, _ensure_physical_form_table
from app.services.form_schemas import (
    FormFieldCreate,
    FormFieldUpdate,
)
from app.services.form_definition import (
    _field_payload,
    _normalize_form_field_data,
    _validate_field_name,
)


async def add_form_fields(form_id: int, fields: list[dict], db: AsyncSession, user: dict,
                          *, sync_layouts: bool = False, audit_action: str = "create_field",
                          defer_commit: bool = False):
    """Validate and add an entire batch atomically for both UI and AI callers.

    Acquire the form lock before counting fields or checking names. Validate the
    complete batch before touching metadata, physical storage, or layouts.
    The caller owns rollback on a database error, as with other form services.
    """
    from pydantic import ValidationError
    from app.models.relational import Form, FormField, FormLayout
    from app.services.field_limits import DEFAULT_FORM_FIELDS
    from app.services.form_layouts import append_field_to_layouts

    await require_admin(user)
    tenant_id = current_tenant_id(user)
    form = await db.scalar(select(Form).where(
        Form.id == form_id, Form.tenant_id == tenant_id).with_for_update())
    if form is None:
        raise HTTPException(404, "Form not found")
    if not isinstance(fields, list) or not fields:
        raise HTTPException(422, "At least one field is required")
    existing = (await db.scalars(select(FormField).where(
        FormField.form_id == form_id, FormField.tenant_id == tenant_id))).all()
    if sum(not field.archived for field in existing) + len(fields) > DEFAULT_FORM_FIELDS:
        raise HTTPException(422, f"表单字段数量不能超过系统上限 {DEFAULT_FORM_FIELDS} 个")
    names = {field.field_name for field in existing}
    next_order = max((field.sort_order or 0 for field in existing), default=0) + 1
    normalized = []
    for index, raw in enumerate(fields):
        if not isinstance(raw, dict):
            raise HTTPException(422, "每个字段必须是一个对象")
        data = dict(raw)
        data.setdefault("field_name", f"field_{next_order + index}")
        data.setdefault("label", data["field_name"])
        data.setdefault("sort_order", next_order + index)
        try:
            data = FormFieldCreate.model_validate(data).model_dump()
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from exc
        _validate_field_name(data["field_name"])
        if data["field_name"] in names:
            raise HTTPException(409, f"Field already exists on this form: {data['field_name']}")
        names.add(data["field_name"])
        normalized.append(_normalize_form_field_data(data))
    created = [FormField(tenant_id=tenant_id, form_id=form_id, **data) for data in normalized]
    db.add_all(created)
    await db.flush()
    await _ensure_physical_form_table(db, form, created)
    changed_layouts = set()
    if sync_layouts:
        layouts = (await db.scalars(select(FormLayout).where(
            FormLayout.form_id == form_id, FormLayout.tenant_id == tenant_id))).all()
        for field in created:
            changed_layouts.update(append_field_to_layouts(layouts, field))
    if not defer_commit:
        await db.commit()
    for field in created:
        await db.refresh(field)
    if not defer_commit:
        await write_audit_log(tenant_id=tenant_id, user_id=current_user_id(user),
            action=audit_action, resource_type="form", resource_id=form_id,
            new_values=normalized[0] if len(normalized) == 1 else {"fields": normalized})
    return {"fields": [_field_payload(field) for field in created],
            "changed_layouts": sorted(changed_layouts)}


async def create_form_field(form_id: int, body: FormFieldCreate, db: AsyncSession, user: dict):
    result = await add_form_fields(form_id, [body.model_dump()], db, user)
    return {"data": result["fields"][0]}


async def update_form_field(form_id: int, field_id: int, body: FormFieldUpdate, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import Form, FormField
    tenant_id = current_tenant_id(user)
    field = await db.get(FormField, field_id)
    if not field or field.form_id != form_id or field.tenant_id != tenant_id:
        raise HTTPException(404, 'Field not found')
    updates = _normalize_form_field_data(body.dict(exclude_unset=True), current_field_type=field.field_type, current_ui_config=field.ui_config)
    if field.archived and updates.get('archived') is False:
        from app.services.field_limits import DEFAULT_FORM_FIELDS
        await db.execute(select(Form.id).where(Form.id == form_id, Form.tenant_id == tenant_id).with_for_update())
        count = await db.scalar(select(func.count()).select_from(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id, FormField.archived.is_(False)))
        if count >= DEFAULT_FORM_FIELDS:
            raise HTTPException(422, f'表单字段数量不能超过系统上限 {DEFAULT_FORM_FIELDS} 个')
    old_values = _field_payload(field)
    changed = False
    for key, value in updates.items():
        if getattr(field, key) != value:
            changed = True
        setattr(field, key, value)
    impact = await _dynamic_record_field_impact(db, tenant_id, form_id, field) if changed else None
    if updates.get('required') is True and impact and impact['missing_required_count']:
        raise HTTPException(409, f"Cannot require field with {impact['missing_required_count']} existing record(s) missing a value")
    if {'field_type', 'enum_values', 'validation'}.intersection(updates) and impact and impact['incompatible_count']:
        raise HTTPException(409, f"有 {impact['incompatible_count']} 条已有记录不符合字段类型、选项或字节上限，请先调整数据")
    await db.commit()
    await db.refresh(field)
    await write_audit_log(tenant_id=tenant_id, user_id=current_user_id(user), action='update_field', resource_type='form', resource_id=form_id, old_values=old_values, new_values=updates)
    payload = {'data': _field_payload(field)}
    if impact:
        payload['impact'] = impact
    return payload


async def archive_form_field(form_id: int, field_id: int, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import FormField
    tenant_id = current_tenant_id(user)
    field = await db.get(FormField, field_id)
    if not field or field.form_id != form_id or field.tenant_id != tenant_id:
        raise HTTPException(404, 'Field not found')
    impact = await _dynamic_record_field_impact(db, tenant_id, form_id, field)
    field.archived = True
    await db.commit()
    await write_audit_log(tenant_id=tenant_id, user_id=current_user_id(user), action='archive_field', resource_type='form', resource_id=form_id, old_values={'field_name': field.field_name, 'archived': False}, new_values={'field_name': field.field_name, 'archived': True, 'impact': impact})
    return {'ok': True, 'impact': impact}

