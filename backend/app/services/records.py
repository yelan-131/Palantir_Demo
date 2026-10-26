"""Shared business record boundary for UI, AI, dashboards and workflow.

Writes reuse the existing encoding, quota and domain/workflow contracts.
Legacy forms helpers are imported lazily while the configuration API remains
backwards compatible; storage and authorization are owned by this service.
"""
from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.deps import current_tenant_id, current_user_id
from app.api.form_engine import (
    _apply_record_encoding_rules,
    _apply_record_filters_query,
    _apply_record_search_query,
    _apply_record_sort_query,
    _assert_unique_code_values,
    _ensure_filter_fields_visible,
    _ensure_physical_form_table,
    _ensure_production_record_query_supported,
    _ensure_sort_field_allowed,
    _get_physical_record,
    _list_physical_records,
    _merged_record_data,
    _parse_record_filters,
    _physical_column_name,
    _physical_record_payload,
    _physical_write_payload,
    _record_matches_filters,
    _record_matches_search,
    _runtime_visible_field_names,
    _sql_current_timestamp,
    _uses_physical_form_table,
    _validate_record_data,
    _validate_record_status,
    _visible_field_subset,
)
from app.api._model_driven_shared import assert_safe_identifier
from app.core.permissions import evaluate_form_permission, allowed_form_fields
from app.models.relational import Form, DynamicRecord, AuditLog
from app.services.form_runtime import _latest_form_version, _runtime_form_fields, _record_payload
from app.services.record_domains import prepare_domain_create, validate_domain_update, protect_migrated_request
from app.services.tenant_onboarding import assert_tenant_quota


async def create_record(form_id, body, db, user, *, defer_commit=False, draft=False, source="business"):
    from app.api.forms import _start_form_workflows
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await require_form_permission(db, user, form_id, "create")
    _validate_record_status(body.status)
    validate_business_keys(body.data)
    from app.services.form_application_lifecycle import enabled, audit as lifecycle_audit, decorate
    managed_draft = await enabled(db, form)
    if managed_draft or draft:
        from app.services.designer_permissions import require_action
        await require_action(db,user,form,'saveDraft')
    if managed_draft and body.status not in {None, 'active', 'draft'}:
        raise HTTPException(409, '新申请只能保存为草稿，请通过提交操作发起审批')
    record_status = 'draft' if managed_draft or draft else body.status
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    await require_record_permission(db, user, form, "create", {"data": body.data, "created_by": current_user_id(user)})
    editable_fields = await allowed_form_fields(user, form_id, "create", fields, db,
        record_data=policy_data({"data": body.data, "created_by": current_user_id(user)}))
    input_data = prepare_domain_create(form.code, dict(body.data or {}), user)
    unknown = set(body.data or {}) - {field.field_name for field in fields if not field.archived}
    if unknown:
        raise HTTPException(422, f"Unknown field(s): {', '.join(sorted(unknown))}")
    denied_input = set(body.data or {}) - editable_fields
    if denied_input:
        raise HTTPException(403, f"Field permission denied: {', '.join(sorted(denied_input))}")
    from app.services.form_rules import evaluate
    rule_result = await evaluate(db, user, fields, input_data, enforce=True, partial=managed_draft or draft)
    input_data = rule_result['data']
    if _uses_physical_form_table(form):
        await _ensure_physical_form_table(db, form, fields)
    record_data = await _apply_record_encoding_rules(db, tenant_id, form, fields, input_data)
    generated_fields = rule_result['derived'] | {key for key, value in record_data.items() if input_data.get(key) != value}
    _validate_record_data(rule_result['fields'], record_data, partial=managed_draft or draft)
    from app.services.field_uniqueness import enforce as enforce_uniqueness
    await enforce_uniqueness(db,form,fields,record_data)
    await require_record_permission(db, user, form, "create", {"data": record_data, "created_by": current_user_id(user)})
    if _uses_physical_form_table(form):
        payload = _physical_write_payload(fields, record_data, editable_fields | generated_fields)
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        # Physical records share the dynamicRecords quota; count this form's
        # live rows so the physical path cannot bypass tenant limits.
        physical_count = int(await db.scalar(
            text(f"SELECT COUNT(*) FROM {table_name} WHERE tenant_id = :tenant_id AND deleted_at IS NULL"),
            {"tenant_id": tenant_id},
        ) or 0)
        await assert_tenant_quota(db, tenant_id, "dynamicRecords", extra_count=physical_count)
        physical_values = {_physical_column_name(key): value for key, value in payload.items()}
        columns = ["tenant_id", "record_status", "created_by", "updated_by", *physical_values.keys()]
        for column in columns:
            assert_safe_identifier(column)
        params = {
            "tenant_id": tenant_id,
            "record_status": record_status,
            "created_by": current_user_id(user),
            "updated_by": current_user_id(user),
            **physical_values,
        }
        column_sql = ", ".join(columns)
        value_sql = ", ".join(f":{column}" for column in columns)
        row = (await db.execute(
            text(f"INSERT INTO {table_name} ({column_sql}) VALUES ({value_sql}) RETURNING *"),
            params,
        )).first()
        result = _physical_record_payload(row, form, fields)
        workflow_instances = [] if managed_draft or draft else await _start_form_workflows(
            db,
            tenant_id=tenant_id,
            form=form,
            record_payload=result,
            user=user,
            trigger_action="submit",
        )
        if managed_draft:
            await lifecycle_audit(db, form, result["id"], user, "draft", status="draft")
            await decorate(db, form, result, user)
        await creation_audit(db, defer_commit,
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="physical_record",
            resource_id=result["id"],
            new_values={**result, "workflow_instances": workflow_instances, "source": source},
        )
        return {"data": await project_record(db, user, form, {**result, "workflow_instances": workflow_instances}, fields)}

    await assert_tenant_quota(db, tenant_id, "dynamicRecords")
    denied_fields = sorted(set(record_data.keys()) - editable_fields - generated_fields)
    if denied_fields:
        raise HTTPException(403, f"Field permission denied: {', '.join(denied_fields)}")
    latest_version = await _latest_form_version(db, tenant_id, form_id)
    record = DynamicRecord(
        tenant_id=tenant_id,
        form_id=form_id,
        model_id=form.model_id,
        data=record_data,
        schema_version=latest_version.version if latest_version else 1,
        status=record_status,
        created_by=current_user_id(user),
        updated_by=current_user_id(user),
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    record_result = _record_payload(record)
    workflow_instances = [] if managed_draft or draft else await _start_form_workflows(
        db,
        tenant_id=tenant_id,
        form=form,
        record_payload=record_result,
        user=user,
        trigger_action="submit",
    )
    if managed_draft:
        await lifecycle_audit(db, form, record.id, user, "draft", status="draft")
        await decorate(db, form, record_result, user)
    await creation_audit(db, defer_commit,
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create",
        resource_type="dynamic_record",
        resource_id=record.id,
        new_values={**record_result, "workflow_instances": workflow_instances, "source": source},
    )
    return {"data": await project_record(db, user, form, {**record_result, "workflow_instances": workflow_instances}, fields)}


async def update_record(form_id, record_id, body, db, user, *, defer_commit=False):
    from app.api.forms import _protect_pending_form_record
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    cache = {('form', form_id): form}
    await require_form_permission(db, user, form_id, "edit", cache=cache)
    from app.services.form_application_lifecycle import locked_record, guard_edit, decorate, metadata, audit as lifecycle_audit
    fields = await runtime_fields(db, form, cache=cache)
    locked = await read_raw(db, form, record_id, lock=True, fields=fields)
    await require_record_permission(db, user, form, "edit", locked, cache=cache)
    tracked = await guard_edit(db, form, locked, user, body.status, cache=cache)
    if tracked:
        from app.services.designer_permissions import require_action
        await require_action(db,user,form,'saveDraft',cache=cache)
    await _protect_pending_form_record(db, tenant_id, form_id, record_id)
    _validate_record_status(body.status)
    validate_business_keys(body.data or {})
    validate_domain_update(form.code, body.data or {})
    if form.code == "material-application":
        raise HTTPException(409, "料号申请请通过专用入口修改")
    editable = await allowed_form_fields(user, form_id, 'edit', fields, db, record_data=policy_data(locked), cache=cache)
    unknown = set(body.data or {}) - {field.field_name for field in fields if not field.archived}
    if unknown:
        raise HTTPException(422, f"Unknown field(s): {', '.join(sorted(unknown))}")
    denied = set(body.data or {}) - editable
    if denied:
        raise HTTPException(403, f"Field permission denied: {', '.join(sorted(denied))}")
    from app.services.form_rules import evaluate
    from app.services.field_policies import protect_update
    await protect_update(db,user,fields,body.data or {},locked.get('data') or {},cache=cache)
    expected=getattr(body,'expected_values',None)
    if expected is not None:
        from app.services.field_policies import presentation
        _,policies=await presentation(db,user,fields,locked.get('data') or {},cache=cache)
        if any(policies.get(key,{}).get('masked') for key in expected): raise HTTPException(403,'不能比较脱敏字段的原值')
        if any(locked['data'].get(key)!=value for key,value in expected.items()): raise HTTPException(409,'记录已被其他人修改，请刷新后确认最新内容再保存')
    rule_result = await evaluate(db, user, fields, body.data or {}, existing=locked.get('data') or {},
                                 enforce=True, partial=bool(tracked and tracked['status'] in {'draft', 'rejected'}), cache=cache)
    rule_patch = {key: value for key, value in rule_result['data'].items()
                  if key in (body.data or {}) or value != (locked.get('data') or {}).get(key)}
    from app.services.field_uniqueness import enforce as enforce_uniqueness
    await enforce_uniqueness(db,form,fields,rule_result['data'],exclude_record_id=record_id)
    body = body.copy(update={'data': rule_patch})
    if _uses_physical_form_table(form):
        editable_fields = editable
        updates = body.dict(exclude_unset=True, exclude={'expected_values'})
        if tracked or updates.get("status") is None:
            updates.pop("status", None)
        data_updates = updates.get("data") or {}
        merged = _merged_record_data(locked['data'], data_updates)
        await require_record_permission(db, user, form, "edit", {**locked, "data": merged}, cache=cache)
        _validate_record_data(rule_result['fields'], merged, partial=bool(tracked and tracked["status"] in {"draft", "rejected"}))
        await _assert_unique_code_values(db, tenant_id, form, fields, data_updates, exclude_record_id=record_id)
        payload = _physical_write_payload(fields, data_updates, editable_fields | rule_result['derived'])
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        assignments = []
        params = {"id": record_id, "tenant_id": tenant_id, "updated_by": current_user_id(user)}
        if "status" in updates and updates["status"] is not None:
            assignments.append("record_status = :record_status")
            params["record_status"] = updates["status"]
        for key, value in payload.items():
            column_name = _physical_column_name(key)
            param_name = f"field_{column_name}"
            assignments.append(f"{column_name} = :{param_name}")
            params[param_name] = value
        assignments.extend(["updated_by = :updated_by", f"updated_at = {_sql_current_timestamp()}"])
        row = (await db.execute(
            text(f"UPDATE {table_name} SET {', '.join(assignments)} WHERE id = :id AND tenant_id = :tenant_id AND deleted_at IS NULL RETURNING *"),
            params,
        )).first()
        if not row:
            raise HTTPException(404, "Record not found")
        if tracked:
            await lifecycle_audit(db, form, record_id, user, "edit", status=locked["status"])
        result = _physical_record_payload(row, form, fields)
        await change_audit(db,
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="update",
            resource_type="physical_record",
            resource_id=record_id,
            new_values={"form_id": form.id, **updates},
        )
        if not defer_commit:
            await db.commit()
        return {"data": await decorate(db, form, await project_record(db, user, form, result, fields, cache=cache), user, cache=cache)}

    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.tenant_id != tenant_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
    protect_migrated_request(form.code, record.data or {})
    updates = body.dict(exclude_unset=True, exclude={'expected_values'})
    if tracked or updates.get("status") is None:
        updates.pop("status", None)
    if updates.get("data") is None:
        updates.pop("data", None)
    if "data" in updates:
        editable_fields = editable
        denied_fields = sorted(set(updates["data"].keys()) - editable_fields - rule_result['derived'])
        if denied_fields:
            raise HTTPException(403, f"Field permission denied: {', '.join(denied_fields)}")
        merged = _merged_record_data(record.data, updates["data"])
        await require_record_permission(db, user, form, "edit", {**locked, "data": merged}, cache=cache)
        _validate_record_data(rule_result['fields'], merged, partial=bool(tracked and tracked["status"] in {"draft", "rejected"}))
        await _assert_unique_code_values(db, tenant_id, form, fields, updates["data"], exclude_record_id=record_id)
        updates["data"] = merged
    for key, value in updates.items():
        setattr(record, key, value)
    record.updated_by = current_user_id(user)
    if tracked:
        await lifecycle_audit(db, form, record_id, user, "edit", status=record.status)
    await db.flush()
    await change_audit(db,
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="update",
        resource_type="dynamic_record",
        resource_id=record.id,
        new_values={"form_id": form.id, **updates},
    )
    if not defer_commit:
        await db.commit()
    await db.refresh(record)
    return {"data": await decorate(db, form, await project_record(db, user, form, _record_payload(record), fields, cache=cache), user, cache=cache)}


async def delete_record(form_id, record_id, db, user):
    from app.api.forms import _protect_pending_form_record
    from app.models.relational import DynamicRecord, Form

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await require_form_permission(db, user, form_id, "delete")
    from app.services.form_application_lifecycle import locked_record, guard_edit
    locked = await read_raw(db, form, record_id, lock=True)
    await require_record_permission(db, user, form, "delete", locked)
    await guard_edit(db, form, locked, user)
    await _protect_pending_form_record(db, tenant_id, form_id, record_id)
    if form.code == "material-application":
        raise HTTPException(403, "料号申请和审批记录不可通过通用表单删除")
    if _uses_physical_form_table(form):
        fields = await _runtime_form_fields(db, tenant_id, form_id)
        await _ensure_physical_form_table(db, form, fields)
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        row = (await db.execute(
            text(f"UPDATE {table_name} SET deleted_at = {_sql_current_timestamp()}, updated_by = :updated_by, updated_at = {_sql_current_timestamp()} WHERE id = :id AND tenant_id = :tenant_id AND deleted_at IS NULL RETURNING id"),
            {"id": record_id, "tenant_id": tenant_id, "updated_by": current_user_id(user)},
        )).first()
        if not row:
            raise HTTPException(404, "Record not found")
        await change_audit(db,
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="delete",
            resource_type="physical_record",
            resource_id=record_id,
            old_values={"form_id": form.id, "data": locked["data"], "status": locked["status"]},
        )
        await db.commit()
        return {"ok": True}

    record = await db.get(DynamicRecord, record_id)
    if not record or record.form_id != form_id or record.tenant_id != tenant_id or record.deleted_at is not None:
        raise HTTPException(404, "Record not found")
    protect_migrated_request(form.code, record.data or {})
    record.deleted_at = datetime.now()
    record.updated_by = current_user_id(user)
    await change_audit(db,
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="delete",
        resource_type="dynamic_record",
        resource_id=record.id,
        old_values={"form_id": form.id, "data": locked["data"], "status": locked["status"]},
    )
    await db.commit()
    return {"ok": True}


async def resolve_form(db, user, *, form_id=None, form_code=None):
    tenant_id = current_tenant_id(user)
    query = select(Form).where(Form.tenant_id == tenant_id)
    query = query.where(Form.id == int(form_id)) if form_id else query.where(Form.code == str(form_code))
    form = await db.scalar(query)
    if form is None:
        raise HTTPException(404, "Form not found")
    return form


async def runtime_fields(db, form, *, cache=None):
    key = ('runtime_fields', form.tenant_id, form.id)
    if cache is not None and key in cache:
        return cache[key]
    fields = await _runtime_form_fields(db, form.tenant_id, form.id)
    if cache is not None:cache[key] = fields
    return fields


def policy_data(record):
    return {**(record.get("data") or {}), "created_by": record.get("created_by"),
            "updated_by": record.get("updated_by"), "record_id": record.get("id")}


async def record_allowed(db, user, form, action, record, *, cache=None):
    if form.tenant_id != current_tenant_id(user):
        return False
    decision = await evaluate_form_permission(user, form.id, action, db,
        record_data=policy_data(record), cache=cache)
    if not decision["allowed"] or user.get("is_admin"):
        return bool(decision["allowed"])
    from app.services.designer_permissions import row_allowed
    if not await row_allowed(db,user,form,record,cache=cache):return False
    grants = [item for item in decision.get("matched", []) if item.get("effect") == "allow"]
    from app.core.permissions import get_user_org_ids
    for grant in grants:
        scope = grant.get("data_scope") or "all"
        if scope in {"all", "current_app", "tenant"}:
            return True
        if scope in {"self", "own"} and record.get("created_by") == current_user_id(user):
            return True
        if scope in {"own_org", "org_tree"}:
            orgs = await get_user_org_ids(user, db, include_descendants=scope == "org_tree")
            value = (record.get("data") or {}).get("org_unit_id")
            if str(value) in {str(org) for org in orgs}:
                return True
        if scope in {"condition", "selected_orgs"}:
            from app.models.relational import RolePermission
            permission = await db.get(RolePermission, grant["id"]) if grant.get("source") == "role_permission" else None
            if permission is not None and permission.condition_json:
                # Conditions have already been evaluated with this row.
                return True
    return False


async def require_record_permission(db, user, form, action, record, *, cache=None):
    if not await record_allowed(db, user, form, action, record, cache=cache):
        raise HTTPException(403, "Record permission denied")


async def project_record(db, user, form, record, fields=None, *, cache=None):
    fields = fields if fields is not None else await runtime_fields(db, form, cache=cache)
    visible = await allowed_form_fields(user, form.id, "view", fields, db, record_data=policy_data(record), cache=cache)
    from app.services.form_rules import states
    state = states([field for field in fields if not field.archived], record.get('data') or {})
    from app.services.field_policies import presentation
    safe,policies=await presentation(db,user,fields,record.get('data') or {},cache=cache)
    from app.services.workflow_field_policy import current_policy
    node_policy = await current_policy(db, user, form, record.get('id'), cache=cache)
    visible = set(visible) - {key for key, flags in node_policy.items() if isinstance(flags, dict) and flags.get('visible') is False}
    return {**record, "data": {key: value for key, value in safe.items() if key in visible},
            'field_states': {key: {**value,**policies.get(key,{})} for key, value in state.items() if key in visible}}


async def read_raw(db, form, record_id, *, lock=False, include_deleted=False, fields=None):
    """Internal read for an already tenant-validated form; never return to clients directly."""
    if _uses_physical_form_table(form):
        table = str(form.table_name)
        assert_safe_identifier(table)
        fields = fields if fields is not None else await runtime_fields(db, form)
        await _ensure_physical_form_table(db, form, fields)
        deleted = "" if include_deleted else " AND deleted_at IS NULL"
        suffix = " FOR UPDATE" if lock and db.bind.dialect.name != "sqlite" else ""
        row = (await db.execute(text(f"SELECT * FROM {table} WHERE id=:id AND tenant_id=:tenant{deleted}{suffix}"),
            {"id": record_id, "tenant": form.tenant_id})).first()
        if row is None:
            raise HTTPException(404, "Record not found")
        return _physical_record_payload(row, form, fields)
    query = select(DynamicRecord).where(DynamicRecord.id == record_id,
        DynamicRecord.form_id == form.id, DynamicRecord.tenant_id == form.tenant_id)
    if not include_deleted:
        query = query.where(DynamicRecord.deleted_at.is_(None))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = await db.scalar(query)
    if row is None:
        raise HTTPException(404, "Record not found")
    return _record_payload(row)


async def get_record(form_id, record_id, db, user, *, include_deleted=False):
    cache = {}
    form = await resolve_form(db, user, form_id=form_id)
    fields = await runtime_fields(db, form, cache=cache)
    record = await read_raw(db, form, record_id, include_deleted=include_deleted, fields=fields)
    await require_record_permission(db, user, form, "view", record, cache=cache)
    from app.services.form_application_lifecycle import decorate
    return {"data": await decorate(db, form, await project_record(db, user, form, record, cache=cache), user, cache=cache)}


async def iter_raw(db, form, *, include_deleted=False, fields=None):
    """Scan in bounded batches so permission filtering happens before pagination/counts."""
    fields = fields if fields is not None else await runtime_fields(db, form)
    if _uses_physical_form_table(form):
        table = str(form.table_name)
        assert_safe_identifier(table)
        await _ensure_physical_form_table(db, form, fields)
    cursor = 0
    while True:
        if _uses_physical_form_table(form):
            deleted = "" if include_deleted else " AND deleted_at IS NULL"
            rows = (await db.execute(text(f"SELECT * FROM {table} WHERE tenant_id=:tenant AND id>:cursor{deleted} ORDER BY id LIMIT 200"),
                {"tenant": form.tenant_id, "cursor": cursor})).all()
            batch = [_physical_record_payload(row, form, fields) for row in rows]
        else:
            query = select(DynamicRecord).where(DynamicRecord.tenant_id == form.tenant_id,
                DynamicRecord.form_id == form.id, DynamicRecord.id > cursor).order_by(DynamicRecord.id).limit(200)
            if not include_deleted:
                query = query.where(DynamicRecord.deleted_at.is_(None))
            batch = [_record_payload(row) for row in (await db.scalars(query)).all()]
        if not batch:
            break
        for record in batch:
            yield record
        cursor = batch[-1]["id"]
        if len(batch) < 200:
            break


async def authorized_records(db, user, form, *, include_deleted=False, decorate=True, statistics=False,
                             cache=None, raw_records=None):
    if form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, "Form not found")
    cache = cache if cache is not None else {}
    decision = await evaluate_form_permission(user, form.id, "view", db, cache=cache)
    if not decision["allowed"]:
        raise HTTPException(403, "Form permission denied")
    if statistics:
        from app.services.designer_permissions import allow_statistics
        await allow_statistics(db,user,form)
    fields = await runtime_fields(db, form, cache=cache)
    result = []
    async for record in iter_raw(db, form, include_deleted=include_deleted, fields=fields):
        if raw_records is not None:
            raw_records[(form.id, record['id'])] = record
        if not await record_allowed(db, user, form, "view", record, cache=cache):
            continue
        record = await project_record(db, user, form, record, fields, cache=cache)
        result.append(record)
    if decorate:
        from app.services.form_application_lifecycle import decorate_records
        await decorate_records(db, form, result, user, cache=cache)
    return result


async def list_records(form_id, db, user, *, include_deleted=False, search=None, filters_json=None,
    sort_field=None, sort_order="desc", cursor_after_id=None, cursor_before_id=None,
    include_total=True, page=1, page_size=20):
    if page < 1 or not 1 <= page_size <= 1000 or sort_order not in {"asc", "desc"}:
        raise HTTPException(422, "Invalid pagination or sort order")
    if cursor_after_id is not None and cursor_before_id is not None:
        raise HTTPException(400, "Use only one cursor direction")
    form = await resolve_form(db, user, form_id=form_id)
    from app.services.field_policies import has_presentation_rules
    has_policies=has_presentation_rules(await runtime_fields(db,form))
    if user.get("is_admin") and not has_policies and not (_uses_physical_form_table(form) and (cursor_after_id is not None or cursor_before_id is not None)):
        return await _list_admin_records(form_id, db, user, include_deleted=include_deleted, search=search,
            filters_json=filters_json, sort_field=sort_field, sort_order=sort_order,
            cursor_after_id=cursor_after_id, cursor_before_id=cursor_before_id,
            include_total=include_total, page=page, page_size=page_size)
    cache = {}
    fields = await runtime_fields(db, form, cache=cache)
    visible = await allowed_form_fields(user, form.id, "view", fields, db, cache=cache)
    filters = _parse_record_filters(filters_json)
    _ensure_filter_fields_visible(filters, visible)
    _ensure_sort_field_allowed(sort_field, fields, visible)
    query_fields = _visible_field_subset(fields, visible)
    from app.config import settings
    if settings.IS_PRODUCTION and search and not any(field.searchable for field in query_fields):
        raise HTTPException(400, "Query is not indexed for production dynamic records")
    if settings.IS_PRODUCTION:
        from app.api.form_engine import _queryable_field_names
        if any(str(item.get("field") or "") not in _queryable_field_names(query_fields) for item in filters):
            raise HTTPException(400, "Field is not indexed for filtering")
    records = await authorized_records(db, user, form, include_deleted=include_deleted, decorate=False, cache=cache)
    matches = []
    for record in records:
        # Filter only the projected row: hidden values cannot affect search/counts.
        row = SimpleNamespace(data=record["data"])
        if _record_matches_search(row, query_fields, search) and _record_matches_filters(row, query_fields, filters):
            matches.append(record)
    matches.sort(key=lambda row: row["id"], reverse=True)
    if sort_field:
        field = next(field for field in fields if field.field_name == sort_field)
        numeric = str(field.field_type).lower() in {"number", "integer", "int", "decimal", "float"} and not any((row.get('field_states') or {}).get(sort_field,{}).get('masked') for row in matches)
        def sort_value(row):
            value = row["data"].get(sort_field)
            return (value is None, float(value or 0) if numeric else str(value or ""))
        matches.sort(key=sort_value, reverse=sort_order == "desc")
    cursor_mode = cursor_after_id is not None or cursor_before_id is not None
    total = len(matches) if include_total and not cursor_mode else None
    if cursor_after_id is not None:
        matches = [row for row in matches if row["id"] < cursor_after_id]
    if cursor_before_id is not None:
        matches = [row for row in matches if row["id"] > cursor_before_id]
    start = 0 if cursor_mode else (page - 1) * page_size
    rows = matches[start:start + page_size]
    has_more = len(matches) > start + page_size
    from app.services.form_application_lifecycle import decorate_records
    await decorate_records(db, form, rows, user, cache=cache)
    return {"data": rows, "total": total, "page": page, "page_size": page_size,
        "has_more": has_more, "next_cursor": rows[-1]["id"] if has_more and rows else None}


async def change_audit(db, *, action, resource_type, resource_id=None, old_values=None,
    new_values=None, user_id=None, tenant_id=None):
    db.add(AuditLog(action=action, resource_type=resource_type, resource_id=resource_id,
        tenant_id=tenant_id, user_id=user_id,
        old_values=json.dumps(old_values, ensure_ascii=False, default=str) if old_values is not None else None,
        new_values=json.dumps(new_values, ensure_ascii=False, default=str) if new_values is not None else None))
    await db.flush()


async def creation_audit(db, defer_commit, **values):
    await change_audit(db, **values)
    if not defer_commit:
        await db.commit()


async def set_record_status(db, form, record, status, user):
    """Workflow-only transition after its own approver/instance checks; same transaction."""
    if form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, "Form not found")
    _validate_record_status(status)
    previous = record.get("status")
    if _uses_physical_form_table(form):
        table = str(form.table_name)
        assert_safe_identifier(table)
        await db.execute(text(f"UPDATE {table} SET record_status=:status, updated_by=:uid, updated_at=CURRENT_TIMESTAMP WHERE id=:id AND tenant_id=:tenant AND deleted_at IS NULL"),
            {"status": status, "uid": current_user_id(user), "id": record["id"], "tenant": form.tenant_id})
    else:
        row = await db.scalar(select(DynamicRecord).where(DynamicRecord.id == record["id"],
            DynamicRecord.form_id == form.id, DynamicRecord.tenant_id == form.tenant_id, DynamicRecord.deleted_at.is_(None)))
        if row is None:
            raise HTTPException(404, "Record not found")
        row.status, row.updated_by = status, current_user_id(user)
    record["status"] = status
    await change_audit(db, tenant_id=form.tenant_id, user_id=current_user_id(user), action="status_transition",
        resource_type="physical_record" if _uses_physical_form_table(form) else "dynamic_record", resource_id=record["id"],
        old_values={"form_id": form.id, "status": previous}, new_values={"form_id": form.id, "status": status, "source": "workflow"})


async def write_fields(db, form, record, changes, *, user, system=False):
    """Transactional domain write; system=True is only for validated workflow transitions."""
    if form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, "Form not found")
    fields = await runtime_fields(db, form)
    validate_business_keys(changes)
    _validate_record_data(fields, changes, partial=True)
    from app.api.form_engine import _assert_unique_code_values
    await _assert_unique_code_values(db, form.tenant_id, form, fields, changes, exclude_record_id=record["id"])
    merged = {**record["data"], **changes}
    from app.services.field_policies import protect_update
    from app.services.field_uniqueness import enforce as enforce_uniqueness
    if not system: await protect_update(db,user,fields,changes,record['data'])
    await enforce_uniqueness(db,form,fields,merged,exclude_record_id=record['id'])
    if not system:
        await require_record_permission(db, user, form, "edit", record)
        await require_record_permission(db, user, form, "edit", {**record, "data": merged})
        allowed = await allowed_form_fields(user, form.id, "edit", fields, db, record_data=policy_data(record))
        if set(changes) - allowed:
            raise HTTPException(403, "Field permission denied")
    before = dict(record["data"])
    if _uses_physical_form_table(form):
        from app.api.form_engine import _physical_write_payload
        values = _physical_write_payload(fields, changes, set(changes))
        table = str(form.table_name)
        assert_safe_identifier(table)
        assignments, params = [], {"id": record["id"], "tenant": form.tenant_id, "actor": current_user_id(user)}
        for index, (name, value) in enumerate(values.items()):
            column = _physical_column_name(name)
            assignments.append(f"{column}=:value{index}")
            params[f"value{index}"] = value
        assignments += ["updated_by=:actor", "updated_at=CURRENT_TIMESTAMP"]
        changed = await db.execute(text(f"UPDATE {table} SET {', '.join(assignments)} WHERE id=:id AND tenant_id=:tenant AND deleted_at IS NULL RETURNING id"), params)
        if changed.first() is None:
            raise HTTPException(404, "Record not found")
    else:
        row = await db.scalar(select(DynamicRecord).where(DynamicRecord.id == record["id"],
            DynamicRecord.form_id == form.id, DynamicRecord.tenant_id == form.tenant_id, DynamicRecord.deleted_at.is_(None)))
        if row is None:
            raise HTTPException(404, "Record not found")
        row.data, row.updated_by = merged, current_user_id(user)
    record["data"] = merged
    await change_audit(db, action="update", tenant_id=form.tenant_id, user_id=current_user_id(user),
        resource_type="physical_record" if _uses_physical_form_table(form) else "dynamic_record", resource_id=record["id"],
        old_values={"form_id": form.id, "data": before}, new_values={"form_id": form.id, "data": changes, "source": "workflow" if system else "domain_action"})


async def _list_admin_records(form_id, db, user, *, include_deleted=False, search=None, filters_json=None,
    sort_field=None, sort_order="desc", cursor_after_id=None, cursor_before_id=None,
    include_total=True, page=1, page_size=20):
    from sqlalchemy import func
    from app.models.relational import DynamicRecord, Form

    from app.services.form_application_lifecycle import decorate
    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await require_form_permission(db, user, form_id, "view")
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    visible_fields = await _runtime_visible_field_names(user, form_id, fields, db)
    if _uses_physical_form_table(form):
        if cursor_after_id is not None or cursor_before_id is not None:
            raise HTTPException(400, "Cursor pagination is not supported for physical form tables")
        result = await _list_physical_records(
            db,
            form,
            fields,
            visible_fields,
            include_deleted=include_deleted,
            search=search,
            filters_json=filters_json,
            sort_field=sort_field,
            sort_order=sort_order,
            include_total=include_total,
            page=page,
            page_size=page_size,
        )
        for record in result["data"]:
            await decorate(db, form, record, user)
        return result
    query_fields = _visible_field_subset(fields, visible_fields)
    db_filters = [DynamicRecord.form_id == form_id, DynamicRecord.tenant_id == tenant_id]
    if not include_deleted:
        db_filters.append(DynamicRecord.deleted_at.is_(None))

    parsed_filters = _parse_record_filters(filters_json)
    _ensure_filter_fields_visible(parsed_filters, visible_fields)
    _ensure_sort_field_allowed(sort_field, fields, visible_fields)
    query = select(DynamicRecord).where(*db_filters)
    query, search_pushed = _apply_record_search_query(query, DynamicRecord, query_fields, search)
    query, filters_pushed = _apply_record_filters_query(query, DynamicRecord, query_fields, parsed_filters)
    _ensure_production_record_query_supported(search, parsed_filters, search_pushed, filters_pushed)
    if cursor_mode := (cursor_after_id is not None or cursor_before_id is not None):
        if (search and not search_pushed) or (parsed_filters and not filters_pushed):
            raise HTTPException(400, "Cursor pagination requires indexed search and filters")
    if search and not search_pushed:
        query = select(DynamicRecord).where(*db_filters)
    if parsed_filters and not filters_pushed:
        query = select(DynamicRecord).where(*db_filters)

    if cursor_after_id is not None and cursor_before_id is not None:
        raise HTTPException(400, "Use only one cursor direction")
    if cursor_after_id is not None:
        query = query.where(DynamicRecord.id < cursor_after_id)
    if cursor_before_id is not None:
        query = query.where(DynamicRecord.id > cursor_before_id)

    query = _apply_record_sort_query(query, DynamicRecord, sort_field, sort_order)
    if not search and not parsed_filters and not cursor_mode:
        total = None
        if include_total:
            total = await db.scalar(select(func.count(DynamicRecord.id)).where(*db_filters))
        result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
        return {
            "data": [await decorate(db, form, _record_payload(record, visible_fields=visible_fields), user) for record in result.scalars().all()],
            "total": int(total or 0) if total is not None else None,
            "page": page,
            "page_size": page_size,
            "has_more": bool(total is not None and page * page_size < total),
            "next_cursor": None,
        }

    if cursor_mode or ((search or parsed_filters) and search_pushed and filters_pushed):
        total = None
        if include_total and not cursor_mode:
            count_query = select(func.count(DynamicRecord.id)).where(*db_filters)
            count_query, _ = _apply_record_search_query(count_query, DynamicRecord, query_fields, search)
            count_query, _ = _apply_record_filters_query(count_query, DynamicRecord, query_fields, parsed_filters)
            total = await db.scalar(count_query)
        result = await db.execute(query.offset(0 if cursor_mode else (page - 1) * page_size).limit(page_size + 1))
        rows = result.scalars().all()
        page_rows = rows[:page_size]
        next_cursor = page_rows[-1].id if len(rows) > page_size and page_rows else None
        return {
            "data": [await decorate(db, form, _record_payload(record, visible_fields=visible_fields), user) for record in page_rows],
            "total": int(total) if total is not None else None,
            "page": page,
            "page_size": page_size,
            "has_more": len(rows) > page_size,
            "next_cursor": next_cursor,
        }

    records = (await db.execute(query)).scalars().all()
    matched = [
        record
        for record in records
        if _record_matches_search(record, query_fields, search)
        and _record_matches_filters(record, query_fields, parsed_filters)
    ]
    total = len(matched)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "data": [await decorate(db, form, _record_payload(record, visible_fields=visible_fields), user) for record in matched[start:end]],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def require_form_permission(db, user, form_id, action, *, cache=None):
    if not (await evaluate_form_permission(user, form_id, action, db, cache=cache))["allowed"]:
        raise HTTPException(403, "Form permission denied")


def validate_business_keys(data):
    reserved = {"id", "tenant_id", "record_status", "created_by", "updated_by",
        "source_dynamic_record_id", "deleted_at", "created_at", "updated_at"}
    denied = [key for key in data if _physical_column_name(key) in reserved]
    if denied:
        raise HTTPException(403, f"Record metadata cannot be written as business fields: {', '.join(sorted(denied))}")
