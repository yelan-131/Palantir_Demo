"""Form definition, action, permission, and workflow binding administration."""
from __future__ import annotations

import copy
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.identifiers import assert_safe_identifier
from app.core.principal import current_tenant_id, current_user_id
from app.core.audit import write_audit_log
from app.services.form_engine import _ensure_physical_form_table, _physical_table_name_for_form, _validate_physical_table_name
from app.services.form_runtime import _latest_form_version
from app.services.form_schemas import FormUpdate, FormCopy, FormActionCreate, FormActionUpdate, FormPermissionCreate, FormPermissionUpdate, WorkflowBindingCreate, WorkflowBindingUpdate
from app.services.form_definition import _uid, _ensure_form_permission, _validate_field_name, _form_payload, _action_payload, _permission_payload, _workflow_binding_payload


async def copy_form(*, form_id: int, body: FormCopy, db: AsyncSession, user: dict):
    """Copy design metadata atomically; business records and versions stay separate."""
    from app.models.relational import Form, FormField, FormLayout, FormAction, FormPermission

    tenant_id = current_tenant_id(user)
    source = await db.get(Form, form_id)
    if not source or source.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    if await db.scalar(select(Form.id).where(Form.tenant_id == tenant_id, Form.code == body.code)):
        raise HTTPException(409, "Form code already exists")
    config = copy.deepcopy(source.config or {})
    config.pop("publishedSchemaVersion", None)
    config.pop("publishedAt", None)
    if config.get("viewConfigMeta"):
        config["viewConfigMeta"] = {"status": "draft"}
    target = Form(
        tenant_id=tenant_id, name=body.name, code=body.code,
        description=source.description, model_id=source.model_id,
        storage_mode="physical_table", status="draft", owner_id=_uid(user), config=config,
        table_name=_physical_table_name_for_form(tenant_id, body.code, config),
    )
    db.add(target)
    await db.flush()
    copied_fields = []
    for model in (FormField, FormLayout, FormAction, FormPermission):
        rows = (await db.scalars(select(model).where(
            model.tenant_id == tenant_id, model.form_id == form_id,
        ))).all()
        for row in rows:
            values = {column.name: copy.deepcopy(getattr(row, column.name))
                      for column in model.__table__.columns
                      if column.name not in {"id", "form_id", "created_at", "updated_at"}}
            cloned = model(form_id=target.id, **values)
            db.add(cloned)
            if model is FormField:
                copied_fields.append(cloned)
    await db.flush()
    await _ensure_physical_form_table(db, target, copied_fields)
    await db.commit()
    await db.refresh(target)
    await write_audit_log(
        tenant_id=tenant_id, user_id=current_user_id(user), action="create",
        resource_type="form", resource_id=target.id,
        new_values={"copied_from": form_id, "code": body.code},
    )
    return {"data": _form_payload(target, fields=copied_fields)}


async def update_form(*, form_id: int, body: FormUpdate, db: AsyncSession, user: dict):
    from app.models.relational import Form

    tenant_id = current_tenant_id(user)
    updates = body.model_dump(exclude_unset=True, exclude={"expected_token"})
    from app.services.field_uniqueness import lock
    from app.services.application_menus import form_edit_token, check_edit_token
    await lock(db, tenant_id)
    form = await db.scalar(select(Form).where(
        Form.id == form_id, Form.tenant_id == tenant_id,
    ).with_for_update().execution_options(populate_existing=True))
    if not form:
        raise HTTPException(404, "Form not found")
    check_edit_token(body.expected_token, form_edit_token(form))
    if 'config' in updates:
        await db.refresh(form)
        current_config = form.config or {}
        analytics_meta = current_config.get('analyticsDesignMeta') or {}
        if (analytics_meta.get('managedBy') == 'analytics-editor'
                and (isinstance(current_config.get('analyticsDesign'), dict)
                     or await _latest_form_version(db, tenant_id, form_id) is not None)):
            incoming_config = updates['config'] or {}
            if any(incoming_config.get(key) != current_config.get(key)
                   for key in ('analyticsDesign', 'analyticsDesignDraft', 'analyticsDesignMeta')):
                raise HTTPException(409, '看板配置已由看板编辑器管理，请重新加载表单设置；修改看板请从看板编辑器操作')
    old_values = _form_payload(form)
    if updates.get("table_name"):
        _validate_physical_table_name(tenant_id, updates["table_name"])
    for key, value in updates.items():
        setattr(form, key, value)
    await db.commit()
    await db.refresh(form)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="update",
        resource_type="form",
        resource_id=form.id,
        old_values=old_values,
        new_values=updates,
    )
    return {"data": _form_payload(form)}


async def delete_form(*, form_id: int, db: AsyncSession, user: dict):
    from app.models.relational import ApplicationForm, ApplicationMenuNode, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    if form.status not in {"draft"}:
        raise HTTPException(409, "Only draft forms can be deleted")

    binding_count = await db.scalar(
        select(func.count(ApplicationForm.id)).where(
            ApplicationForm.form_id == form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    ) or 0
    menu_binding_count = await db.scalar(
        select(func.count(ApplicationMenuNode.id)).where(
            ApplicationMenuNode.form_id == form_id,
            ApplicationMenuNode.tenant_id == tenant_id,
        )
    ) or 0
    if binding_count or menu_binding_count:
        raise HTTPException(409, "Form is bound to an application menu")

    old_values = _form_payload(form)
    await db.delete(form)
    await db.commit()
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="delete",
        resource_type="form",
        resource_id=form_id,
        old_values=old_values,
        new_values={"deleted": True},
    )
    return {"data": {"id": form_id, "deleted": True}}


async def list_form_actions(*, form_id: int, db: AsyncSession, user: dict):
    from app.models.relational import Form, FormAction

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    actions = (await db.execute(
        select(FormAction)
        .where(FormAction.form_id == form_id, FormAction.tenant_id == tenant_id)
        .order_by(FormAction.sort_order, FormAction.id)
    )).scalars().all()
    return {"data": [_action_payload(action) for action in actions]}


async def create_form_action(*, form_id: int, body: FormActionCreate, db: AsyncSession, user: dict):
    from app.models.relational import Form, FormAction

    tenant_id = current_tenant_id(user)
    assert_safe_identifier(body.action_key)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    action = FormAction(tenant_id=tenant_id, form_id=form_id, **body.dict())
    db.add(action)
    await db.commit()
    await db.refresh(action)
    return {"data": _action_payload(action)}


async def update_form_action(*, form_id: int, action_id: int, body: FormActionUpdate, db: AsyncSession, user: dict):
    from app.models.relational import FormAction

    tenant_id = current_tenant_id(user)
    action = await db.get(FormAction, action_id)
    if not action or action.form_id != form_id or action.tenant_id != tenant_id:
        raise HTTPException(404, "Action not found")
    for key, value in body.dict(exclude_unset=True).items():
        setattr(action, key, value)
    await db.commit()
    await db.refresh(action)
    return {"data": _action_payload(action)}


async def delete_form_action(*, form_id: int, action_id: int, db: AsyncSession, user: dict):
    from app.models.relational import FormAction

    tenant_id = current_tenant_id(user)
    action = await db.get(FormAction, action_id)
    if not action or action.form_id != form_id or action.tenant_id != tenant_id:
        raise HTTPException(404, "Action not found")
    await db.delete(action)
    await db.commit()
    return {"ok": True}


async def list_form_permissions(*, form_id: int, db: AsyncSession, user: dict):
    from app.models.relational import Form, FormPermission

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    permissions = (await db.execute(
        select(FormPermission).where(FormPermission.form_id == form_id, FormPermission.tenant_id == tenant_id).order_by(FormPermission.id)
    )).scalars().all()
    return {"data": [_permission_payload(permission) for permission in permissions]}


async def create_form_permission(*, form_id: int, body: FormPermissionCreate, db: AsyncSession, user: dict):
    from app.models.relational import Form, FormField, FormPermission, Role

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    role = await db.get(Role, body.role_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    if not role or role.tenant_id != tenant_id:
        raise HTTPException(404, "Role not found")
    if body.field_name:
        _validate_field_name(body.field_name)
        existing_field = await db.scalar(
            select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id, FormField.field_name == body.field_name)
        )
        if not existing_field:
            raise HTTPException(404, "Field not found")
    permission = FormPermission(tenant_id=tenant_id, form_id=form_id, **body.dict())
    db.add(permission)
    await db.commit()
    await db.refresh(permission)
    return {"data": _permission_payload(permission)}


async def update_form_permission(*, form_id: int, permission_id: int, body: FormPermissionUpdate, db: AsyncSession, user: dict):
    from app.models.relational import FormField, FormPermission

    tenant_id = current_tenant_id(user)
    permission = await db.get(FormPermission, permission_id)
    if not permission or permission.form_id != form_id or permission.tenant_id != tenant_id:
        raise HTTPException(404, "Permission not found")
    updates = body.dict(exclude_unset=True)
    if updates.get("field_name"):
        _validate_field_name(updates["field_name"])
        existing_field = await db.scalar(
            select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id, FormField.field_name == updates["field_name"])
        )
        if not existing_field:
            raise HTTPException(404, "Field not found")
    for key, value in updates.items():
        setattr(permission, key, value)
    await db.commit()
    await db.refresh(permission)
    return {"data": _permission_payload(permission)}


async def delete_form_permission(*, form_id: int, permission_id: int, db: AsyncSession, user: dict):
    from app.models.relational import FormPermission

    tenant_id = current_tenant_id(user)
    permission = await db.get(FormPermission, permission_id)
    if not permission or permission.form_id != form_id or permission.tenant_id != tenant_id:
        raise HTTPException(404, "Permission not found")
    await db.delete(permission)
    await db.commit()
    return {"ok": True}


async def list_workflow_bindings(*, form_id: int, db: AsyncSession, user: dict):
    from app.models.relational import Form, WorkflowBinding

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    bindings = (await db.execute(
        select(WorkflowBinding).where(WorkflowBinding.form_id == form_id, WorkflowBinding.tenant_id == tenant_id).order_by(WorkflowBinding.id)
    )).scalars().all()
    return {"data": [_workflow_binding_payload(binding) for binding in bindings]}


async def create_workflow_binding(*, form_id: int, body: WorkflowBindingCreate, db: AsyncSession, user: dict):
    from app.models.relational import Form, WorkflowBinding, WorkflowDef

    tenant_id = current_tenant_id(user)
    assert_safe_identifier(body.trigger_action)
    form = await db.get(Form, form_id)
    wf = await db.get(WorkflowDef, body.workflow_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    if not wf or wf.tenant_id != tenant_id:
        raise HTTPException(404, "Workflow definition not found")
    binding = WorkflowBinding(tenant_id=tenant_id, form_id=form_id, **body.dict())
    db.add(binding)
    await db.commit()
    await db.refresh(binding)
    return {"data": _workflow_binding_payload(binding)}


async def update_workflow_binding(*, form_id: int, binding_id: int, body: WorkflowBindingUpdate, db: AsyncSession, user: dict):
    from app.models.relational import WorkflowBinding, WorkflowDef

    tenant_id = current_tenant_id(user)
    binding = await db.get(WorkflowBinding, binding_id)
    if not binding or binding.form_id != form_id or binding.tenant_id != tenant_id:
        raise HTTPException(404, "Workflow binding not found")
    updates = body.dict(exclude_unset=True)
    if updates.get("workflow_id") is not None:
        wf = await db.get(WorkflowDef, updates["workflow_id"])
        if not wf or wf.tenant_id != tenant_id:
            raise HTTPException(404, "Workflow definition not found")
    if updates.get("trigger_action"):
        assert_safe_identifier(updates["trigger_action"])
    for key, value in updates.items():
        setattr(binding, key, value)
    await db.commit()
    await db.refresh(binding)
    return {"data": _workflow_binding_payload(binding)}


async def delete_workflow_binding(*, form_id: int, binding_id: int, db: AsyncSession, user: dict):
    from app.models.relational import WorkflowBinding

    tenant_id = current_tenant_id(user)
    binding = await db.get(WorkflowBinding, binding_id)
    if not binding or binding.form_id != form_id or binding.tenant_id != tenant_id:
        raise HTTPException(404, "Workflow binding not found")
    await db.delete(binding)
    await db.commit()
    return {"ok": True}
