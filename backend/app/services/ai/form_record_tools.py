"""Read-only Agent tools using the shared business record service."""

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
    return {"form": {"id": form.id, "name": form.name, "code": form.code},
            "records": records, "record_count": len(records), "visible_fields": sorted(visible)}


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
