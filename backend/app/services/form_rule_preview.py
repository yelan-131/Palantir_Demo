"""Shared form rule preview contracts for HTTP and tool callers."""
from __future__ import annotations
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import current_tenant_id, current_user_id, require_admin
from app.services.form_runtime import _field_proxy_from_payload
from app.services.form_schemas import (
    DesignerRulePreviewRequest,
    FormRulePreviewRequest,
)
from app.services.form_definition import (
    _apply_designer_field_settings,
    _field_payload,
)


async def evaluate_form_rules(form_id: int, body: FormRulePreviewRequest, db: AsyncSession, user: dict):
    from app.services import records
    from app.services.form_rules import evaluate, accessible_fields
    from app.models.relational import Form
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, 'Form not found')
    scope = 'edit' if body.record_id is not None else 'create'
    await records.require_form_permission(db, user, form_id, scope)
    existing = None
    if body.record_id is not None:
        result = await records.get_record(form_id, body.record_id, db, user)
        existing = result['data']['data']
        raw = await records.read_raw(db, form, body.record_id)
        await records.require_record_permission(db, user, form, 'edit', raw)
        existing = raw['data']
    else:
        await records.require_record_permission(db, user, form, 'create', {'data': body.data, 'created_by': current_user_id(user)})
    fields = await accessible_fields(db, user, form, scope, {**(existing or {}), **body.data})
    names = {field.field_name for field in fields}
    if set(body.data) - names:
        raise HTTPException(403, 'Field permission denied')
    from app.services.field_policies import presentation
    _, prior = await presentation(db, user, fields, existing or {})
    incoming = {key: value for key, value in body.data.items() if existing is None or not prior.get(key, {}).get('masked')}
    result = await evaluate(db, user, fields, incoming, existing=existing)
    safe, policies = await presentation(db, user, fields, result['data'])
    if existing is None:
        safe = {key: value for key, value in result['data'].items() if policies.get(key, {}).get('visible') is not False}
        policies = {key: {**value, 'masked': False} for key, value in policies.items()}
    return {'data': {'data': {key: value for key, value in safe.items() if key in names}, 'states': {key: {**value, **policies.get(key, {})} for key, value in result['states'].items()}}}


async def preview_designer_rules(form_id: int, body: DesignerRulePreviewRequest, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import Form, FormField
    from app.services.form_rules import evaluate
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, 'Form not found')
    fields = (await db.scalars(select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == form.tenant_id))).all()
    payloads = _apply_designer_field_settings({'formDesignerControls': body.controls}, [_field_payload(field) for field in fields])
    from app.services.form_calculations import design_errors as calculation_errors
    errors = calculation_errors(payloads)
    if errors:
        raise HTTPException(422, '；'.join(errors))
    if body.validate_only:
        return {'data': {'data': {}, 'states': {}}}
    result = await evaluate(db, user, [_field_proxy_from_payload(field) for field in payloads], body.data, existing=body.data if body.mask_record else None)
    from app.services.field_policies import presentation
    safe, policies = await presentation(db, user, [_field_proxy_from_payload(field) for field in payloads], result['data'])
    if not body.mask_record:
        safe = result['data']
        policies = {key: {**value, 'masked': False} for key, value in policies.items()}
    return {'data': {'data': safe, 'states': {key: {**value, **policies.get(key, {})} for key, value in result['states'].items()}}}


async def preview_form_reference_options(form_id: int, field_name: str, body: DesignerRulePreviewRequest, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import Form, FormField
    from app.services.form_rules import archive_options
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, 'Form not found')
    fields = (await db.scalars(select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == form.tenant_id))).all()
    payloads = _apply_designer_field_settings({'formDesignerControls': body.controls}, [_field_payload(field) for field in fields])
    field = next((_field_proxy_from_payload(field) for field in payloads if field['field_name'] == field_name), None)
    if not field:
        raise HTTPException(404, 'Field not found')
    if body.page is not None or body.query or body.selected is not None:
        from app.services.option_search import search
        return await search(db, user, field, body.data, keyword=body.query, page=body.page or 1, page_size=body.page_size, selected=body.selected, context_fields={item['field_name'] for item in payloads})
    options = await archive_options(db, user, field, body.data)
    return {'data': [{'id': option['id'], 'label': option['label']} for option in options]}


async def preview_option_search_schema(form_id: int, field_name: str, body: DesignerRulePreviewRequest, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import Form, FormField
    from app.services.option_search import schema
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, 'Form not found')
    fields = (await db.scalars(select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == form.tenant_id))).all()
    payloads = _apply_designer_field_settings({'formDesignerControls': body.controls}, [_field_payload(item) for item in fields])
    field = next((_field_proxy_from_payload(item) for item in payloads if item['field_name'] == field_name), None)
    if not field:
        raise HTTPException(404, 'Field not found')
    return {'data': await schema(db, user, field)}

