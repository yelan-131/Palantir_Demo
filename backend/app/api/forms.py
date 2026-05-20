"""Platform form configuration and dynamic record APIs.

These endpoints are the first database-backed layer for application-owned
low-code forms. Creating fields updates metadata only; it does not execute
DDL against business tables.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import get_current_user, get_db

router = APIRouter()


class FormCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    application_id: Optional[int] = None
    model_id: Optional[int] = None
    table_name: Optional[str] = None
    storage_mode: str = "dynamic"
    status: str = "draft"
    config: dict = Field(default_factory=dict)


class FormUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[int] = None
    table_name: Optional[str] = None
    storage_mode: Optional[str] = None
    status: Optional[str] = None
    config: Optional[dict] = None


class ApplicationFormUpsert(BaseModel):
    form_id: int
    alias: Optional[str] = None
    enabled: bool = True
    default_view: str = "list"
    data_scope: Optional[str] = None
    allow_create: bool = True
    allow_edit: bool = True
    allow_delete: bool = True
    allow_export: bool = False
    sort_order: int = 0


class FormFieldCreate(BaseModel):
    field_name: str
    label: str
    field_type: str = "string"
    required: bool = False
    visible_in_list: bool = True
    visible_in_form: bool = True
    searchable: bool = False
    sortable: bool = False
    default_value: Optional[str] = None
    enum_values: Optional[dict] = None
    validation: Optional[dict] = None
    ui_config: Optional[dict] = None
    sort_order: int = 0


class FormFieldUpdate(BaseModel):
    label: Optional[str] = None
    field_type: Optional[str] = None
    required: Optional[bool] = None
    visible_in_list: Optional[bool] = None
    visible_in_form: Optional[bool] = None
    searchable: Optional[bool] = None
    sortable: Optional[bool] = None
    archived: Optional[bool] = None
    default_value: Optional[str] = None
    enum_values: Optional[dict] = None
    validation: Optional[dict] = None
    ui_config: Optional[dict] = None
    sort_order: Optional[int] = None


class DynamicRecordCreate(BaseModel):
    data: dict
    status: str = "active"


class DynamicRecordUpdate(BaseModel):
    data: Optional[dict] = None
    status: Optional[str] = None


class MenuNodeCreate(BaseModel):
    parent_id: Optional[int] = None
    node_type: str = "form"
    title: str
    icon: Optional[str] = None
    form_id: Optional[int] = None
    route_path: Optional[str] = None
    visible: bool = True
    default_entry: bool = False
    sort_order: int = 0


class MenuNodeUpdate(BaseModel):
    parent_id: Optional[int] = None
    node_type: Optional[str] = None
    title: Optional[str] = None
    icon: Optional[str] = None
    form_id: Optional[int] = None
    route_path: Optional[str] = None
    visible: Optional[bool] = None
    default_entry: Optional[bool] = None
    sort_order: Optional[int] = None


class FormLayoutUpsert(BaseModel):
    layout_type: str = "list"
    config: dict = Field(default_factory=dict)


class FormActionCreate(BaseModel):
    action_key: str
    label: str
    action_type: str = "builtin"
    config: dict = Field(default_factory=dict)
    enabled: bool = True
    sort_order: int = 0


class FormActionUpdate(BaseModel):
    label: Optional[str] = None
    action_type: Optional[str] = None
    config: Optional[dict] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class FormPermissionCreate(BaseModel):
    role_id: int
    action: str
    effect: str = "allow"
    field_name: Optional[str] = None


class FormPermissionUpdate(BaseModel):
    action: Optional[str] = None
    effect: Optional[str] = None
    field_name: Optional[str] = None


class WorkflowBindingCreate(BaseModel):
    workflow_id: int
    trigger_action: str = "submit"
    enabled: bool = True
    config: dict = Field(default_factory=dict)


class WorkflowBindingUpdate(BaseModel):
    trigger_action: Optional[str] = None
    enabled: Optional[bool] = None
    config: Optional[dict] = None


def _uid(user: dict) -> Optional[int]:
    uid = user.get("uid")
    return int(uid) if isinstance(uid, int) and uid > 0 else None


def _validate_form_code(code: str) -> None:
    assert_safe_identifier(code)


def _validate_field_name(field_name: str) -> None:
    assert_safe_identifier(field_name)


def _form_payload(form, *, fields: Optional[list] = None, applications: Optional[list] = None) -> dict:
    payload = {
        "id": form.id,
        "name": form.name,
        "code": form.code,
        "description": form.description,
        "model_id": form.model_id,
        "table_name": form.table_name,
        "storage_mode": form.storage_mode,
        "status": form.status,
        "owner_id": form.owner_id,
        "config": form.config or {},
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
    }
    if fields is not None:
        payload["fields"] = [_field_payload(field) for field in fields]
    if applications is not None:
        payload["applications"] = applications
    return payload


def _field_payload(field) -> dict:
    return {
        "id": field.id,
        "form_id": field.form_id,
        "meta_field_id": field.meta_field_id,
        "field_name": field.field_name,
        "label": field.label,
        "field_type": field.field_type,
        "required": field.required,
        "visible_in_list": field.visible_in_list,
        "visible_in_form": field.visible_in_form,
        "searchable": field.searchable,
        "sortable": field.sortable,
        "archived": field.archived,
        "default_value": field.default_value,
        "enum_values": field.enum_values,
        "validation": field.validation,
        "ui_config": field.ui_config,
        "sort_order": field.sort_order,
    }


def _application_form_payload(binding) -> dict:
    return {
        "id": binding.id,
        "application_id": binding.application_id,
        "form_id": binding.form_id,
        "alias": binding.alias,
        "enabled": binding.enabled,
        "default_view": binding.default_view,
        "data_scope": binding.data_scope,
        "allow_create": binding.allow_create,
        "allow_edit": binding.allow_edit,
        "allow_delete": binding.allow_delete,
        "allow_export": binding.allow_export,
        "sort_order": binding.sort_order,
        "form": _form_payload(binding.form) if getattr(binding, "form", None) else None,
    }


def _record_payload(record) -> dict:
    return {
        "id": record.id,
        "form_id": record.form_id,
        "model_id": record.model_id,
        "data": record.data or {},
        "status": record.status,
        "created_by": record.created_by,
        "updated_by": record.updated_by,
        "deleted_at": record.deleted_at.isoformat() if record.deleted_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


def _field_allowed_values(field) -> Optional[set[str]]:
    values = field.enum_values
    if not values:
        return None
    if isinstance(values, list):
        return {str(value) for value in values}
    if isinstance(values, dict):
        raw = values.get("values") if "values" in values else values
        if isinstance(raw, list):
            return {str(value.get("value", value)) if isinstance(value, dict) else str(value) for value in raw}
        return {str(key) for key in raw.keys()} if isinstance(raw, dict) else None
    return None


def _validate_record_data(fields: list, data: dict, *, partial: bool = False) -> None:
    if not fields:
        return
    active_fields = [field for field in fields if not field.archived]
    by_name = {field.field_name: field for field in active_fields}
    unknown = sorted(set(data.keys()) - set(by_name.keys()))
    if unknown:
        raise HTTPException(422, f"Unknown field(s): {', '.join(unknown)}")

    if not partial:
        missing = [
            field.label or field.field_name
            for field in active_fields
            if field.required and data.get(field.field_name) in (None, "")
        ]
        if missing:
            raise HTTPException(422, f"Missing required field(s): {', '.join(missing)}")

    for name, value in data.items():
        if value in (None, ""):
            continue
        field = by_name[name]
        field_type = (field.field_type or "string").lower()
        if field_type in {"number", "decimal", "float"} and not isinstance(value, (int, float)):
            raise HTTPException(422, f"Field {name} must be a number")
        if field_type in {"integer", "int"} and not isinstance(value, int):
            raise HTTPException(422, f"Field {name} must be an integer")
        if field_type == "boolean" and not isinstance(value, bool):
            raise HTTPException(422, f"Field {name} must be a boolean")
        if field_type in {"date", "datetime"} and not isinstance(value, str):
            raise HTTPException(422, f"Field {name} must be an ISO date string")
        if field_type == "enum":
            allowed = _field_allowed_values(field)
            if allowed and str(value) not in allowed:
                raise HTTPException(422, f"Field {name} must be one of: {', '.join(sorted(allowed))}")


def _record_matches_search(record, fields: list, search: Optional[str]) -> bool:
    if not search:
        return True
    needle = search.lower()
    searchable_names = [field.field_name for field in fields if field.searchable and not field.archived]
    names = searchable_names or [field.field_name for field in fields if not field.archived]
    values = record.data or {}
    return any(needle in str(values.get(name, "")).lower() for name in names)


async def _ensure_application_form_binding(db: AsyncSession, application_id: int, form_id: int) -> None:
    from app.models.relational import ApplicationForm

    existing = await db.scalar(
        select(ApplicationForm).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == form_id,
        )
    )
    if existing:
        if not existing.enabled:
            existing.enabled = True
        return
    db.add(ApplicationForm(application_id=application_id, form_id=form_id))


def _menu_node_payload(node) -> dict:
    return {
        "id": node.id,
        "application_id": node.application_id,
        "parent_id": node.parent_id,
        "node_type": node.node_type,
        "title": node.title,
        "icon": node.icon,
        "form_id": node.form_id,
        "route_path": node.route_path,
        "visible": node.visible,
        "default_entry": node.default_entry,
        "sort_order": node.sort_order,
    }


def _layout_payload(layout) -> dict:
    return {
        "id": layout.id,
        "form_id": layout.form_id,
        "layout_type": layout.layout_type,
        "config": layout.config or {},
        "created_at": layout.created_at.isoformat() if layout.created_at else None,
        "updated_at": layout.updated_at.isoformat() if layout.updated_at else None,
    }


def _action_payload(action) -> dict:
    return {
        "id": action.id,
        "form_id": action.form_id,
        "action_key": action.action_key,
        "label": action.label,
        "action_type": action.action_type,
        "config": action.config or {},
        "enabled": action.enabled,
        "sort_order": action.sort_order,
    }


def _permission_payload(permission) -> dict:
    return {
        "id": permission.id,
        "form_id": permission.form_id,
        "role_id": permission.role_id,
        "action": permission.action,
        "effect": permission.effect,
        "field_name": permission.field_name,
    }


def _workflow_binding_payload(binding) -> dict:
    return {
        "id": binding.id,
        "form_id": binding.form_id,
        "workflow_id": binding.workflow_id,
        "trigger_action": binding.trigger_action,
        "enabled": binding.enabled,
        "config": binding.config or {},
    }


@router.get("")
async def list_forms(
    application_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import ApplicationForm, Form

    query = select(Form).order_by(Form.created_at.desc(), Form.id.desc())
    if application_id is not None:
        query = query.join(ApplicationForm, ApplicationForm.form_id == Form.id).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.enabled.is_(True),
        )
    forms = (await db.execute(query)).scalars().all()
    return {"data": [_form_payload(form) for form in forms]}


@router.post("")
async def create_form(
    body: FormCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Application, ApplicationForm, Form, FormAction, FormLayout

    _validate_form_code(body.code)
    if body.table_name:
        assert_safe_identifier(body.table_name)

    existing = await db.scalar(select(Form).where(Form.code == body.code))
    if existing:
        raise HTTPException(409, "Form code already exists")

    if body.application_id is not None:
        app = await db.get(Application, body.application_id)
        if not app:
            raise HTTPException(404, "Application not found")

    form = Form(
        name=body.name,
        code=body.code,
        description=body.description,
        model_id=body.model_id,
        table_name=body.table_name,
        storage_mode=body.storage_mode,
        status=body.status,
        owner_id=_uid(user),
        config=body.config,
    )
    db.add(form)
    await db.flush()

    if body.application_id is not None:
        db.add(ApplicationForm(application_id=body.application_id, form_id=form.id))

    db.add(FormLayout(form_id=form.id, layout_type="list", config={"columns": []}))
    db.add(FormLayout(form_id=form.id, layout_type="form", config={"sections": []}))
    for idx, (key, label) in enumerate([("create", "Create"), ("edit", "Edit"), ("delete", "Delete"), ("export", "Export")]):
        db.add(FormAction(form_id=form.id, action_key=key, label=label, sort_order=idx))

    await db.commit()
    await db.refresh(form)
    return {"data": _form_payload(form)}


@router.get("/applications/{application_id}/forms")
async def list_application_form_bindings(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload
    from app.models.relational import Application, ApplicationForm

    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    bindings = (await db.execute(
        select(ApplicationForm)
        .options(selectinload(ApplicationForm.form))
        .where(ApplicationForm.application_id == application_id)
        .order_by(ApplicationForm.sort_order, ApplicationForm.id)
    )).scalars().all()
    return {"data": [_application_form_payload(binding) for binding in bindings]}


@router.put("/applications/{application_id}/forms")
async def upsert_application_form_binding(
    application_id: int,
    body: ApplicationFormUpsert,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload
    from app.models.relational import Application, ApplicationForm, Form

    if not await db.get(Application, application_id):
        raise HTTPException(404, "Application not found")
    if not await db.get(Form, body.form_id):
        raise HTTPException(404, "Form not found")
    binding = await db.scalar(
        select(ApplicationForm)
        .options(selectinload(ApplicationForm.form))
        .where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == body.form_id,
        )
    )
    values = body.dict()
    if binding is None:
        binding = ApplicationForm(application_id=application_id, **values)
        db.add(binding)
    else:
        for key, value in values.items():
            setattr(binding, key, value)
    await db.commit()
    await db.refresh(binding)
    return {"data": _application_form_payload(binding)}


@router.delete("/applications/{application_id}/forms/{form_id}")
async def delete_application_form_binding(
    application_id: int,
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import ApplicationForm

    await db.execute(
        delete(ApplicationForm).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == form_id,
        )
    )
    await db.commit()
    return {"ok": True}


@router.get("/applications/{application_id}/menu-nodes")
async def list_application_menu_nodes(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Application, ApplicationMenuNode

    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    nodes = (await db.execute(
        select(ApplicationMenuNode)
        .where(ApplicationMenuNode.application_id == application_id)
        .order_by(ApplicationMenuNode.sort_order, ApplicationMenuNode.id)
    )).scalars().all()
    return {"data": [_menu_node_payload(node) for node in nodes]}


@router.post("/applications/{application_id}/menu-nodes")
async def create_application_menu_node(
    application_id: int,
    body: MenuNodeCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Application, ApplicationMenuNode, Form

    app = await db.get(Application, application_id)
    if not app:
        raise HTTPException(404, "Application not found")
    if body.form_id is not None and not await db.get(Form, body.form_id):
        raise HTTPException(404, "Form not found")
    if body.parent_id is not None and not await db.get(ApplicationMenuNode, body.parent_id):
        raise HTTPException(404, "Parent menu node not found")

    values = body.dict()
    if values.get("form_id") and not values.get("route_path"):
        values["route_path"] = f"/dynamic/{values['form_id']}"
    node = ApplicationMenuNode(application_id=application_id, **values)
    db.add(node)
    if body.form_id is not None:
        await _ensure_application_form_binding(db, application_id, body.form_id)
    await db.commit()
    await db.refresh(node)
    return {"data": _menu_node_payload(node)}


@router.put("/applications/{application_id}/menu-nodes/{node_id}")
async def update_application_menu_node(
    application_id: int,
    node_id: int,
    body: MenuNodeUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import ApplicationMenuNode, Form

    node = await db.get(ApplicationMenuNode, node_id)
    if not node or node.application_id != application_id:
        raise HTTPException(404, "Menu node not found")
    updates = body.dict(exclude_unset=True)
    if "form_id" in updates and updates["form_id"] is not None and not await db.get(Form, updates["form_id"]):
        raise HTTPException(404, "Form not found")
    if "parent_id" in updates and updates["parent_id"] is not None and not await db.get(ApplicationMenuNode, updates["parent_id"]):
        raise HTTPException(404, "Parent menu node not found")
    if updates.get("form_id") and not updates.get("route_path"):
        updates["route_path"] = f"/dynamic/{updates['form_id']}"
    for key, value in updates.items():
        setattr(node, key, value)
    if node.form_id is not None:
        await _ensure_application_form_binding(db, application_id, node.form_id)
    await db.commit()
    await db.refresh(node)
    return {"data": _menu_node_payload(node)}


@router.delete("/applications/{application_id}/menu-nodes/{node_id}")
async def delete_application_menu_node(
    application_id: int,
    node_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import ApplicationMenuNode

    node = await db.get(ApplicationMenuNode, node_id)
    if not node or node.application_id != application_id:
        raise HTTPException(404, "Menu node not found")
    await db.delete(node)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}")
async def get_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Application, ApplicationForm, Form, FormField

    form = await db.get(Form, form_id)
    if not form:
        raise HTTPException(404, "Form not found")
    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    app_rows = await db.execute(
        select(Application, ApplicationForm)
        .join(ApplicationForm, ApplicationForm.application_id == Application.id)
        .where(ApplicationForm.form_id == form_id)
        .order_by(ApplicationForm.sort_order)
    )
    applications = [
        {
            "id": app.id,
            "name": app.name,
            "code": app.code,
            "alias": binding.alias,
            "enabled": binding.enabled,
            "sort_order": binding.sort_order,
        }
        for app, binding in app_rows.fetchall()
    ]
    return {"data": _form_payload(form, fields=fields, applications=applications)}


@router.put("/{form_id}")
async def update_form(
    form_id: int,
    body: FormUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form

    form = await db.get(Form, form_id)
    if not form:
        raise HTTPException(404, "Form not found")
    updates = body.dict(exclude_unset=True)
    if updates.get("table_name"):
        assert_safe_identifier(updates["table_name"])
    for key, value in updates.items():
        setattr(form, key, value)
    await db.commit()
    await db.refresh(form)
    return {"data": _form_payload(form)}


@router.post("/{form_id}/fields")
async def create_form_field(
    form_id: int,
    body: FormFieldCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormField

    _validate_field_name(body.field_name)
    form = await db.get(Form, form_id)
    if not form:
        raise HTTPException(404, "Form not found")
    existing = await db.scalar(
        select(FormField).where(FormField.form_id == form_id, FormField.field_name == body.field_name)
    )
    if existing:
        raise HTTPException(409, "Field already exists on this form")

    field = FormField(form_id=form_id, **body.dict())
    db.add(field)
    await db.commit()
    await db.refresh(field)
    return {"data": _field_payload(field)}


@router.put("/{form_id}/fields/{field_id}")
async def update_form_field(
    form_id: int,
    field_id: int,
    body: FormFieldUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import FormField

    field = await db.get(FormField, field_id)
    if not field or field.form_id != form_id:
        raise HTTPException(404, "Field not found")
    for key, value in body.dict(exclude_unset=True).items():
        setattr(field, key, value)
    await db.commit()
    await db.refresh(field)
    return {"data": _field_payload(field)}


@router.delete("/{form_id}/fields/{field_id}")
async def archive_form_field(
    form_id: int,
    field_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import FormField

    field = await db.get(FormField, field_id)
    if not field or field.form_id != form_id:
        raise HTTPException(404, "Field not found")
    field.archived = True
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/layouts")
async def list_form_layouts(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormLayout

    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    layouts = (await db.execute(
        select(FormLayout).where(FormLayout.form_id == form_id).order_by(FormLayout.layout_type)
    )).scalars().all()
    return {"data": [_layout_payload(layout) for layout in layouts]}


@router.put("/{form_id}/layouts/{layout_type}")
async def upsert_form_layout(
    form_id: int,
    layout_type: str,
    body: FormLayoutUpsert,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormLayout

    assert_safe_identifier(layout_type)
    if body.layout_type != layout_type:
        raise HTTPException(400, "layout_type path and body must match")
    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    layout = await db.scalar(
        select(FormLayout).where(FormLayout.form_id == form_id, FormLayout.layout_type == layout_type)
    )
    if layout is None:
        layout = FormLayout(form_id=form_id, layout_type=layout_type, config=body.config)
        db.add(layout)
    else:
        layout.config = body.config
    await db.commit()
    await db.refresh(layout)
    return {"data": _layout_payload(layout)}


@router.get("/{form_id}/actions")
async def list_form_actions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormAction

    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    actions = (await db.execute(
        select(FormAction)
        .where(FormAction.form_id == form_id)
        .order_by(FormAction.sort_order, FormAction.id)
    )).scalars().all()
    return {"data": [_action_payload(action) for action in actions]}


@router.post("/{form_id}/actions")
async def create_form_action(
    form_id: int,
    body: FormActionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormAction

    assert_safe_identifier(body.action_key)
    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    action = FormAction(form_id=form_id, **body.dict())
    db.add(action)
    await db.commit()
    await db.refresh(action)
    return {"data": _action_payload(action)}


@router.put("/{form_id}/actions/{action_id}")
async def update_form_action(
    form_id: int,
    action_id: int,
    body: FormActionUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import FormAction

    action = await db.get(FormAction, action_id)
    if not action or action.form_id != form_id:
        raise HTTPException(404, "Action not found")
    for key, value in body.dict(exclude_unset=True).items():
        setattr(action, key, value)
    await db.commit()
    await db.refresh(action)
    return {"data": _action_payload(action)}


@router.delete("/{form_id}/actions/{action_id}")
async def delete_form_action(
    form_id: int,
    action_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import FormAction

    action = await db.get(FormAction, action_id)
    if not action or action.form_id != form_id:
        raise HTTPException(404, "Action not found")
    await db.delete(action)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/permissions")
async def list_form_permissions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormPermission

    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    permissions = (await db.execute(
        select(FormPermission).where(FormPermission.form_id == form_id).order_by(FormPermission.id)
    )).scalars().all()
    return {"data": [_permission_payload(permission) for permission in permissions]}


@router.post("/{form_id}/permissions")
async def create_form_permission(
    form_id: int,
    body: FormPermissionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, FormField, FormPermission, Role

    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    if not await db.get(Role, body.role_id):
        raise HTTPException(404, "Role not found")
    if body.field_name:
        _validate_field_name(body.field_name)
        existing_field = await db.scalar(
            select(FormField).where(FormField.form_id == form_id, FormField.field_name == body.field_name)
        )
        if not existing_field:
            raise HTTPException(404, "Field not found")
    permission = FormPermission(form_id=form_id, **body.dict())
    db.add(permission)
    await db.commit()
    await db.refresh(permission)
    return {"data": _permission_payload(permission)}


@router.put("/{form_id}/permissions/{permission_id}")
async def update_form_permission(
    form_id: int,
    permission_id: int,
    body: FormPermissionUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import FormField, FormPermission

    permission = await db.get(FormPermission, permission_id)
    if not permission or permission.form_id != form_id:
        raise HTTPException(404, "Permission not found")
    updates = body.dict(exclude_unset=True)
    if updates.get("field_name"):
        _validate_field_name(updates["field_name"])
        existing_field = await db.scalar(
            select(FormField).where(FormField.form_id == form_id, FormField.field_name == updates["field_name"])
        )
        if not existing_field:
            raise HTTPException(404, "Field not found")
    for key, value in updates.items():
        setattr(permission, key, value)
    await db.commit()
    await db.refresh(permission)
    return {"data": _permission_payload(permission)}


@router.delete("/{form_id}/permissions/{permission_id}")
async def delete_form_permission(
    form_id: int,
    permission_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import FormPermission

    permission = await db.get(FormPermission, permission_id)
    if not permission or permission.form_id != form_id:
        raise HTTPException(404, "Permission not found")
    await db.delete(permission)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/workflow-bindings")
async def list_workflow_bindings(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, WorkflowBinding

    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    bindings = (await db.execute(
        select(WorkflowBinding).where(WorkflowBinding.form_id == form_id).order_by(WorkflowBinding.id)
    )).scalars().all()
    return {"data": [_workflow_binding_payload(binding) for binding in bindings]}


@router.post("/{form_id}/workflow-bindings")
async def create_workflow_binding(
    form_id: int,
    body: WorkflowBindingCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form, WorkflowBinding, WorkflowDef

    assert_safe_identifier(body.trigger_action)
    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    if not await db.get(WorkflowDef, body.workflow_id):
        raise HTTPException(404, "Workflow definition not found")
    binding = WorkflowBinding(form_id=form_id, **body.dict())
    db.add(binding)
    await db.commit()
    await db.refresh(binding)
    return {"data": _workflow_binding_payload(binding)}


@router.put("/{form_id}/workflow-bindings/{binding_id}")
async def update_workflow_binding(
    form_id: int,
    binding_id: int,
    body: WorkflowBindingUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import WorkflowBinding

    binding = await db.get(WorkflowBinding, binding_id)
    if not binding or binding.form_id != form_id:
        raise HTTPException(404, "Workflow binding not found")
    updates = body.dict(exclude_unset=True)
    if updates.get("trigger_action"):
        assert_safe_identifier(updates["trigger_action"])
    for key, value in updates.items():
        setattr(binding, key, value)
    await db.commit()
    await db.refresh(binding)
    return {"data": _workflow_binding_payload(binding)}


@router.delete("/{form_id}/workflow-bindings/{binding_id}")
async def delete_workflow_binding(
    form_id: int,
    binding_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import WorkflowBinding

    binding = await db.get(WorkflowBinding, binding_id)
    if not binding or binding.form_id != form_id:
        raise HTTPException(404, "Workflow binding not found")
    await db.delete(binding)
    await db.commit()
    return {"ok": True}


@router.get("/{form_id}/records")
async def list_dynamic_records(
    form_id: int,
    include_deleted: bool = False,
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, Form, FormField

    if not await db.get(Form, form_id):
        raise HTTPException(404, "Form not found")
    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    query = select(DynamicRecord).where(DynamicRecord.form_id == form_id)
    if not include_deleted:
        query = query.where(DynamicRecord.deleted_at.is_(None))
    query = query.order_by(DynamicRecord.created_at.desc(), DynamicRecord.id.desc())
    records = (await db.execute(query)).scalars().all()
    matched = [record for record in records if _record_matches_search(record, fields, search)]
    total = len(matched)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "data": [_record_payload(record) for record in matched[start:end]],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/{form_id}/records")
async def create_dynamic_record(
    form_id: int,
    body: DynamicRecordCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, Form, FormField

    form = await db.get(Form, form_id)
    if not form:
        raise HTTPException(404, "Form not found")
    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    _validate_record_data(fields, body.data)
    record = DynamicRecord(
        form_id=form_id,
        model_id=form.model_id,
        data=body.data,
        status=body.status,
        created_by=_uid(user),
        updated_by=_uid(user),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return {"data": _record_payload(record)}


@router.put("/{form_id}/records/{record_id}")
async def update_dynamic_record(
    form_id: int,
    record_id: int,
    body: DynamicRecordUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord, FormField

    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
    updates = body.dict(exclude_unset=True)
    if "data" in updates and updates["data"] is not None:
        fields = (await db.execute(
            select(FormField).where(FormField.form_id == form_id).order_by(FormField.sort_order, FormField.id)
        )).scalars().all()
        merged = {**(record.data or {}), **updates["data"]}
        _validate_record_data(fields, merged)
    for key, value in updates.items():
        setattr(record, key, value)
    record.updated_by = _uid(user)
    await db.commit()
    await db.refresh(record)
    return {"data": _record_payload(record)}


@router.delete("/{form_id}/records/{record_id}")
async def delete_dynamic_record(
    form_id: int,
    record_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import DynamicRecord

    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
    record.deleted_at = datetime.now()
    record.updated_by = _uid(user)
    await db.commit()
    return {"ok": True}
