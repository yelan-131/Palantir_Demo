"""Shared creation and draft staging for the form API and AI tools."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit_log
from app.core.principal import current_tenant_id, current_user_id, ensure_admin
from app.models.relational import Application, ApplicationForm, Form, FormAction, FormLayout
from app.services.field_uniqueness import lock
from app.services.form_definition import _form_payload, _uid
from app.services.form_engine import (
    _ensure_physical_form_table,
    _physical_table_name_for_form,
    _validate_physical_table_name,
)
from app.services.form_fields import add_form_fields
from app.services.form_schemas import FormCreate
from app.services.workflow_definitions import WorkflowDefCreate


def _validate_form_code(code: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", code):
        raise HTTPException(400, f"Invalid form code: {code!r}")


def form_draft_receipt(draft_id: str, payload: dict) -> dict[str, str]:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return {"id": draft_id, "digest": hashlib.sha256(body.encode()).hexdigest()}


async def find_saved_form_draft(db: AsyncSession, user: dict, receipt: dict[str, str]) -> Form | None:
    saved = await db.scalar(select(Form).where(
        Form.tenant_id == current_tenant_id(user),
        Form.owner_id == current_user_id(user),
        Form.config["_designerDraftReceipt"]["id"].as_string() == receipt["id"],
    ))
    if saved is not None and (saved.config or {}).get("_designerDraftReceipt") != receipt:
        raise HTTPException(409, "该草稿已保存，请打开已保存的表单继续编辑")
    return saved


async def stage_form_definition(
    body: FormCreate,
    db: AsyncSession,
    user: dict,
    *,
    fields: list[dict],
    workflow: WorkflowDefCreate | None = None,
    application_alias: str | None = None,
    include_default_actions: bool = True,
) -> Form:
    """Stage the form, storage, binding and actions in the caller's transaction."""
    ensure_admin(user)
    tenant_id = current_tenant_id(user)
    _validate_form_code(body.code)
    config = dict(body.config)
    config.pop("_designerDraftReceipt", None)
    table_name = body.table_name
    storage_mode = body.storage_mode
    if storage_mode == "dynamic" and not table_name:
        storage_mode = "physical_table"
        table_name = _physical_table_name_for_form(tenant_id, body.code, config)
    if table_name:
        _validate_physical_table_name(tenant_id, table_name)

    if body.application_id is not None:
        app = await db.get(Application, body.application_id)
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(404, "Application not found")

    form = Form(
        tenant_id=tenant_id, name=body.name, code=body.code, description=body.description,
        model_id=body.model_id, table_name=table_name, storage_mode=storage_mode,
        status=body.status, owner_id=_uid(user), config=config,
    )
    db.add(form)
    await db.flush()
    if fields:
        await add_form_fields(form.id, fields, db, user, defer_commit=True)
    else:
        await _ensure_physical_form_table(db, form, [])
    if workflow is not None:
        from app.services.workflow_definitions import stage_workflow_definition

        draft = workflow.model_copy(update={
            "status": "draft",
            "config": {
                **(workflow.config or {}),
                "formId": form.id, "formCode": form.code, "formName": form.name,
                "savedAt": datetime.now(timezone.utc).isoformat(),
            },
        })
        definition = await stage_workflow_definition(db, draft, user)
        form.config = {**config, "workflowDesigner": {"draftWorkflowId": definition.id}}
    if body.application_id is not None:
        db.add(ApplicationForm(
            tenant_id=tenant_id, application_id=body.application_id, form_id=form.id, alias=application_alias,
        ))
    if include_default_actions:
        for index, (key, label) in enumerate((
            ("create", "Create"), ("edit", "Edit"), ("delete", "Delete"), ("export", "Export"),
        )):
            db.add(FormAction(tenant_id=tenant_id, form_id=form.id, action_key=key, label=label, sort_order=index))
    return form


async def create_form(body: FormCreate, db: AsyncSession, user: dict) -> dict:
    """Persist the API form or designer draft and its initial configuration."""
    ensure_admin(user)
    tenant_id = current_tenant_id(user)
    _validate_form_code(body.code)
    await lock(db, tenant_id)
    draft = body.designer_draft
    receipt = None
    if draft:
        receipt = form_draft_receipt(draft.draft_id, body.model_dump(mode="json"))
        saved = await find_saved_form_draft(db, user, receipt)
        if saved is not None:
            result = _form_payload(saved)
            await db.rollback()
            return {"data": result}
    if await db.scalar(select(Form.id).where(Form.code == body.code, Form.tenant_id == tenant_id)):
        raise HTTPException(409, "该表单编码已被其他表单占用" if draft else "Form code already exists")

    if draft:
        config = dict(body.config)
        config.update(
            formLayout=draft.layout,
            viewConfigDraft=draft.view,
            viewConfigMeta={
                "draftVersion": 1, "publishedVersion": 0,
                "draftSavedAt": datetime.now(timezone.utc).isoformat(), "status": "draft",
            },
        )
        for key in ("viewConfig", "publishedSchemaVersion", "publishedAt"):
            config.pop(key, None)
        form = await stage_form_definition(
            body.model_copy(update={"config": config, "status": "draft"}), db, user,
            fields=[field.model_dump() for field in draft.fields], workflow=draft.workflow,
        )
        form.config = {**form.config, "_designerDraftReceipt": receipt}
        db.add(FormLayout(
            tenant_id=tenant_id, form_id=form.id, layout_type="view",
            config={"draft": draft.view, "meta": config["viewConfigMeta"]},
        ))
    else:
        form = await stage_form_definition(body, db, user, fields=[])
    db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="list", config={"columns": []}))
    db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="form",
                      config=draft.layout if draft else {"sections": []}))

    await db.commit()
    await db.refresh(form)
    await write_audit_log(
        tenant_id=tenant_id, user_id=current_user_id(user), action="create",
        resource_type="form", resource_id=form.id, new_values=body.model_dump(),
    )
    return {"data": _form_payload(form)}
