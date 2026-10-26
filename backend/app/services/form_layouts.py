"""Shared form layouts contracts for HTTP and tool callers."""
from __future__ import annotations
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import current_tenant_id, require_admin
from app.services.form_schemas import (
    FormLayoutUpsert,
)
from app.services.form_definition import (
    _ensure_form_permission,
    _layout_payload,
)


async def list_form_layouts(form_id: int, db: AsyncSession, user: dict):
    from app.models.relational import Form, FormLayout
    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, 'Form not found')
    await _ensure_form_permission(db, user, form_id, 'view')
    layouts = (await db.execute(select(FormLayout).where(FormLayout.form_id == form_id, FormLayout.tenant_id == tenant_id).order_by(FormLayout.layout_type))).scalars().all()
    return {'data': [_layout_payload(layout) for layout in layouts]}


async def upsert_form_layout(form_id: int, layout_type: str, body: FormLayoutUpsert, db: AsyncSession, user: dict):
    await require_admin(user)
    from app.models.relational import Form, FormLayout
    tenant_id = current_tenant_id(user)
    assert_safe_identifier(layout_type)
    if body.layout_type != layout_type:
        raise HTTPException(400, 'layout_type path and body must match')
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, 'Form not found')
    layout = await db.scalar(select(FormLayout).where(FormLayout.form_id == form_id, FormLayout.tenant_id == tenant_id, FormLayout.layout_type == layout_type))
    if layout is None:
        layout = FormLayout(tenant_id=tenant_id, form_id=form_id, layout_type=layout_type, config=body.config)
        db.add(layout)
    else:
        layout.config = body.config
    await db.commit()
    await db.refresh(layout)
    return {'data': _layout_payload(layout)}



def append_field_to_layouts(layouts: list[FormLayout], field: FormField) -> list[str]:
    changed: list[str] = []
    for layout in layouts:
        config = dict(layout.config or {})
        if layout.layout_type == "list":
            columns = list(config.get("columns") or [])
            if field.visible_in_list and not any(item.get("field_name") == field.field_name for item in columns if isinstance(item, dict)):
                columns.append({"field_name": field.field_name, "label": field.label, "width": 160})
                config["columns"] = columns
                layout.config = config
                changed.append("list")
        elif layout.layout_type == "form":
            sections = list(config.get("sections") or [])
            if not sections:
                sections = [{"title": "业务信息", "fields": []}]
            first = dict(sections[0])
            fields = list(first.get("fields") or [])
            already_present = any(
                (item.get("field_name") if isinstance(item, dict) else item) == field.field_name
                for item in fields
            )
            if field.visible_in_form and not already_present:
                fields.append({"field_name": field.field_name, "label": field.label, "col_span": 1})
                first["fields"] = fields
                sections[0] = first
                config["sections"] = sections
                layout.config = config
                changed.append("form")
    return changed
