"""Thin adapters from AI payloads to the same services used by form routes."""
from __future__ import annotations

from pydantic import BaseModel, Field, ValidationError, create_model, ConfigDict
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


# Explicit service mapping, never a function name supplied by the model.
# (module, function, request body model, resource id parameter)
FORM_DESIGN_TOOLS = {
    "forms.update_field": ("form_fields", "update_form_field", "FormFieldUpdate", "field_id"),
    "forms.archive_field": ("form_fields", "archive_form_field", None, "field_id"),
    "forms.save_layout": ("form_layouts", "upsert_form_layout", "FormLayoutUpsert", "layout_type"),
    "forms.publish": ("form_versions", "publish_form", None, None),
    "forms.restore_draft": ("form_versions", "restore_form_draft", None, None),
    "forms.update_definition": ("routes", "update_form", "FormUpdate", None),
    "forms.copy": ("routes", "copy_form", "FormCopy", None),
    "forms.delete": ("routes", "delete_form", None, None),
}
for resource, singular, model, id_key in (
    ("actions", "form_action", "FormAction", "action_id"),
    ("permissions", "form_permission", "FormPermission", "permission_id"),
    ("workflow_bindings", "workflow_binding", "WorkflowBinding", "binding_id"),
):
    for verb, suffix in (("list", None), ("create", "Create"), ("update", "Update"), ("delete", None)):
        function = f"{verb}_{singular}" if verb != "list" else {
            "actions": "list_form_actions", "permissions": "list_form_permissions",
            "workflow_bindings": "list_workflow_bindings",
        }[resource]
        FORM_DESIGN_TOOLS[f"forms.{verb}_{resource}"] = (
            "routes", function, model + suffix if suffix else None,
            id_key if verb in {"update", "delete"} else None,
        )


def form_design_request_model(operation):
    from app.services import form_schemas
    _, _, body_model, id_key = FORM_DESIGN_TOOLS[operation]
    fields = {"form_id": (int, Field(gt=0))}
    if id_key:
        fields[id_key] = (str, Field(min_length=1)) if id_key == "layout_type" else (int, Field(gt=0))
    if body_model:
        fields["body"] = (getattr(form_schemas, body_model), ...)
    return create_model("FormDesignRequest", __config__=ConfigDict(extra="forbid"), **fields)


async def execute_form_design_tool(operation, session, *, user, payload):
    await require_admin(user)
    if operation not in FORM_DESIGN_TOOLS:
        raise HTTPException(422, "Unsupported form design operation")
    try:
        request = form_design_request_model(operation).model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    module_name, function, body_model, id_key = FORM_DESIGN_TOOLS[operation]
    if module_name == "routes":
        from app.api import forms as module
    else:
        from app.services import form_fields, form_layouts, form_versions
        module = {"form_fields": form_fields, "form_layouts": form_layouts,
                  "form_versions": form_versions}[module_name]
    arguments = {"form_id": request.form_id, "db": session, "user": user}
    if id_key:
        arguments[id_key] = getattr(request, id_key)
    if body_model:
        arguments["body"] = request.body
    return await getattr(module, function)(**arguments)
