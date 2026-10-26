"""Thin adapters from AI payloads to the same services used by form routes."""
from __future__ import annotations

from pydantic import BaseModel, Field, ValidationError
from fastapi import HTTPException

from app.api.deps import require_admin
from app.services import form_layouts, form_rule_preview, form_versions
from app.services.form_schemas import FormRulePreviewRequest


class FormToolRequest(BaseModel):
    form_id: int = Field(gt=0)
    version_number: int | None = Field(default=None, gt=0)
    record_id: int | None = Field(default=None, gt=0)
    data: dict = Field(default_factory=dict)


async def execute_form_configuration_tool(operation, session, *, user, payload):
    """Explicit allowlist: tools cannot choose arbitrary service functions."""
    await require_admin(user)
    try:
        request = FormToolRequest.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    arguments = {"form_id": request.form_id, "db": session, "user": user}
    if operation == "forms.preview_publish":
        return await form_versions.preview_form_publish(**arguments)
    if operation == "forms.list_versions":
        return await form_versions.list_form_versions(**arguments)
    if operation == "forms.get_version":
        if request.version_number is None:
            raise HTTPException(422, "version_number is required")
        return await form_versions.get_form_version(**arguments, version_number=request.version_number)
    if operation == "forms.get_layouts":
        return await form_layouts.list_form_layouts(**arguments)
    if operation == "forms.evaluate_rules":
        body = FormRulePreviewRequest(data=request.data, record_id=request.record_id)
        return await form_rule_preview.evaluate_form_rules(**arguments, body=body)
    raise HTTPException(422, "Unsupported form configuration operation")
