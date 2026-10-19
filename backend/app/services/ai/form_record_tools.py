"""Agent record tools using the shared business record service."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import allowed_form_fields


async def query_form_records(
    session: AsyncSession,
    *,
    user: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    from app.services.records import resolve_form, list_records, runtime_fields
    form = await resolve_form(session, user, form_id=payload.get("form_id") or payload.get("formId"), form_code=payload.get("form_code") or payload.get("formCode"))
    limit = max(1, min(int(payload.get("limit") or 20), 100))
    status = payload.get("status")
    result = await list_records(form.id, session, user, page_size=limit)
    records = result["data"]
    if status:
        # Apply status before limit, so matching records are never lost.
        from app.services.records import authorized_records
        records = [row for row in await authorized_records(session, user, form) if row["status"] == str(status)]
        records.sort(key=lambda row: row["id"], reverse=True)
        records = records[:limit]
    fields = await runtime_fields(session, form)
    visible = await allowed_form_fields(user, form.id, "view", fields, session)
    from app.services.form_rules import relation, archive_options
    schema, reference_options = [], {}
    for field in fields:
        if field.field_name not in visible or field.archived:
            continue
        schema.append({'field_name': field.field_name, 'label': field.label, 'field_type': field.field_type,
                       'required': field.required, 'enum_values': field.enum_values, 'ui_config': field.ui_config})
        if relation(field):
            options = await archive_options(session, user, field, payload.get('data') or {})
            reference_options[field.field_name] = [{'id': option['id'], 'label': option['label']} for option in options]
    return {"form": {"id": form.id, "name": form.name, "code": form.code},
            "records": records, "record_count": len(records), "visible_fields": sorted(visible),
            'fields': schema, 'reference_options': reference_options}


async def get_form_record(
    session: AsyncSession,
    *,
    user: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    from app.services.records import resolve_form, get_record, runtime_fields
    form = await resolve_form(session, user, form_id=payload.get("form_id") or payload.get("formId"), form_code=payload.get("form_code") or payload.get("formCode"))
    record_id = payload.get("record_id") or payload.get("recordId")
    if not record_id:
        raise HTTPException(422, "record_id is required")
    result = await get_record(form.id, int(record_id), session, user)
    fields = await runtime_fields(session, form)
    visible = await allowed_form_fields(user, form.id, "view", fields, session)
    return {"form": {"id": form.id, "name": form.name, "code": form.code}, "record": result["data"], "visible_fields": sorted(visible)}


async def prepare_record_update(session, *, user, payload):
    from app.services import records
    from app.services.form_rules import evaluate
    form = await records.resolve_form(session, user, form_id=payload.get('form_id'), form_code=payload.get('form_code'))
    record_id = payload.get('record_id')
    patch = payload.get('data')
    if not record_id or not isinstance(patch, dict) or not patch:
        raise HTTPException(422, '修改记录必须指定 record_id 和非空 data；不能新建记录代替修改')
    current = (await records.get_record(form.id, int(record_id), session, user))['data']
    await records.require_form_permission(session, user, form.id, 'edit')
    await records.require_record_permission(session, user, form, 'edit', current)
    fields = await records.runtime_fields(session, form)
    names = {f.field_name for f in fields if not f.archived}
    if set(patch) - names:
        raise HTTPException(422, '包含未知字段')
    allowed = await allowed_form_fields(user, form.id, 'edit', fields, session, record_data=records.policy_data(current))
    visible = await allowed_form_fields(user, form.id, 'view', fields, session, record_data=records.policy_data(current))
    if set(patch) - allowed or set(patch) - visible:
        raise HTTPException(403, '无权修改或查看指定字段')
    await evaluate(session, user, fields, patch, existing=current['data'], enforce=True)
    return {'form_code': form.code, 'record_id': int(record_id), 'data': patch,
            'expected_values': {key: current['data'].get(key) for key in patch}}


async def update_form_record(session, *, user, payload):
    from app.services import records
    from app.api.forms import DynamicRecordUpdate
    form = await records.resolve_form(session, user, form_id=payload.get('form_id'), form_code=payload.get('form_code'))
    receipt_run = None
    if payload.get('_execution_run_id'):
        from sqlalchemy import select
        from app.models.relational import AIAgentRun
        from .run_recovery import receipts
        from .agent_items import extract_confirmation_payload
        receipt_run = await session.scalar(select(AIAgentRun).where(AIAgentRun.run_id == payload['_execution_run_id'],
            AIAgentRun.tenant_id == user['tenant_id']).with_for_update())
        if receipt_run is not None:
            owner = extract_confirmation_payload(receipt_run.items or []).get('user')
            if owner != str(user.get('sub') or user.get('username') or user.get('uid')):
                raise HTTPException(403, '确认操作不属于当前用户')
            for receipt in receipts(receipt_run.items):
                result = receipt['payload']
                if receipt.get('action_key', '0') == payload.get('_execution_action_key', '0'):
                    return result
            if receipt_run.status != 'confirmed':
                raise HTTPException(409, '操作尚未确认或已结束')
    patch, expected = payload.get('data'), payload.get('expected_values')
    if not isinstance(patch, dict) or not patch or not isinstance(expected, dict) or set(expected) != set(patch):
        raise HTTPException(422, '缺少已确认的原值，请重新准备修改操作')
    record_id = int(payload['record_id'])
    # Lock and compare inside the same transaction as the common update service.
    # Re-check the AI read/edit boundary after confirmation as permissions may
    # have changed since the proposal was prepared (including field visibility).
    await prepare_record_update(session, user=user, payload=payload)
    current = await records.read_raw(session, form, record_id, lock=True)
    if any(current['data'].get(key) != value for key, value in expected.items()):
        raise HTTPException(409, '待修改字段已发生变化，请重新读取并确认后再修改')
    result = await records.update_record(form.id, record_id, DynamicRecordUpdate(data=patch), session, user,
        defer_commit=receipt_run is not None)
    output = {'form_code': form.code, 'form_name': form.name, 'record_id': record_id,
            'operation': 'update', 'record': result['data']}
    if receipt_run is not None:
        receipt_run.items = [*(receipt_run.items or []), {'type': 'tool_result',
            'id': f"receipt-{payload.get('_execution_action_key', '0')}", 'execution_receipt': True,
            'action_key': payload.get('_execution_action_key', '0'),
            'tool': 'forms.update_record', 'status': 'completed', 'payload': output}]
        await session.commit()
    return output
