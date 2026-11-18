"""Project prepared configuration into a browser-only workbench preview."""

import uuid

from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import Form, FormField
from .low_code_tools import _slugify
from .tenant_context import require_tenant_id


PREVIEW_TOOLS = {
    "forms.create_form_definition", "forms.add_form_field", "forms.save_workflow_draft",
    "pages.create", "pages.save_draft",
}


def _field(raw, *, proposed=False):
    name = raw.get("field_name") or raw.get("name")
    if not name:
        return None
    return {"name": _slugify(str(name)), "label": raw.get("label") or name,
            "type": raw.get("field_type") or "string", "required": bool(raw.get("required")),
            "options": raw.get("enum_values"), "proposed": proposed}


def merge_proposed_fields(previous, current, preview):
    fields = {}
    for raw in [*(previous.get("fields") or []), *(current.get("fields") or [])]:
        field = _field(raw, proposed=True)
        if field:
            fields[field["name"]] = raw
    updated = {**current, "fields": list(fields.values())}
    base = [field for field in preview["fields"] if not field.get("proposed")]
    return updated, {**preview, "fields": [*base, *(_field(raw, proposed=True) for raw in fields.values())]}


async def build_workbench_preview(tool, arguments, user):
    stage = {"id": uuid.uuid4().hex}
    if tool.startswith("pages."):
        definition = arguments["definition"]
        return {**stage, "kind": "page", "pageCode": arguments.get("page_code"),
                "title": definition["title"], "definition": definition}
    if tool == "forms.create_form_definition":
        form = arguments.get("form") or {}
        title = form.get("name") or arguments.get("name")
        if not title:
            return None
        fields = [_field(raw, proposed=True) for raw in arguments.get("fields") or []]
        return {**stage, "kind": "form", "title": title, "formCode": form.get("code"),
                "fields": [field for field in fields if field]}

    tenant_id = require_tenant_id(user)
    form_id = arguments.get("form_id") or arguments.get("formId")
    form_code = arguments.get("form_code") or arguments.get("formCode")
    async with db_session() as session:
        form = await session.scalar(select(Form).where(
            Form.tenant_id == tenant_id, Form.id == form_id if form_id else Form.code == form_code,
        ))
        if form is None:
            return None
        fields = (await session.scalars(select(FormField).where(
            FormField.form_id == form.id, FormField.tenant_id == tenant_id, FormField.archived.is_(False),
        ).order_by(FormField.sort_order, FormField.id))).all()
        base = [{"name": field.field_name, "label": field.label, "type": field.field_type,
                 "required": field.required, "options": field.enum_values} for field in fields]
    target = {**stage, "formId": form.id, "formCode": form.code, "title": form.name, "fields": base}
    if tool == "forms.save_workflow_draft":
        return {**target, "kind": "workflow", "design": arguments["design"]}
    additions = [_field(raw, proposed=True) for raw in arguments.get("fields") or []]
    return {**target, "kind": "form", "fields": [*base, *(field for field in additions if field)]}
