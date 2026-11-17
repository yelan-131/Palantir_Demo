"""Alert record reads shared by the alert routes and workflows."""
from __future__ import annotations

from fastapi import HTTPException


async def _records(db, form, fields, visible, record_id=None, lock=False, *, user=None):
    from app.services.records import read_raw, iter_raw, authorized_records, require_record_permission, project_record
    if record_id is not None:
        try:
            record = await read_raw(db, form, record_id, lock=lock)
        except HTTPException as exc:
            if exc.status_code == 404:
                return []
            raise
        if user is not None:
            await require_record_permission(db, user, form, "view", record)
            record = await project_record(db, user, form, record, fields)
        records = [record]
    elif user is not None:
        records = await authorized_records(db, user, form, decorate=False)
    else:
        records = [record async for record in iter_raw(db, form)]
    records.sort(key=lambda record: record["id"], reverse=True)
    if visible is not None:
        records = [{**record, "data": {key: value for key, value in record["data"].items() if key in visible}} for record in records]
    return records
