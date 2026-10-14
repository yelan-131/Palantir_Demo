"""Published form schema and normalized record payload shared by storage adapters."""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _record_payload(record, *, visible_fields: Optional[set[str]] = None) -> dict:
    data = record.data or {}
    if visible_fields is not None:
        data = {key: value for key, value in data.items() if key in visible_fields}
    return {
        "id": record.id,
        "form_id": record.form_id,
        "model_id": record.model_id,
        "schema_version": getattr(record, "schema_version", 1),
        "data": data,
        "status": record.status,
        "created_by": record.created_by,
        "updated_by": record.updated_by,
        "deleted_at": record.deleted_at.isoformat() if record.deleted_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


async def _latest_form_version(db: AsyncSession, tenant_id: int, form_id: int):
    from app.models.relational import FormVersion

    return await db.scalar(
        select(FormVersion)
        .where(FormVersion.form_id == form_id, FormVersion.tenant_id == tenant_id, FormVersion.status.in_(["published", "active"]))
        .order_by(FormVersion.version.desc(), FormVersion.id.desc())
        .limit(1)
    )


def _field_proxy_from_payload(payload: dict):
    proxy = type("PublishedField", (), {})()
    for key, default in {
        "id": None,
        "form_id": None,
        "meta_field_id": None,
        "field_name": "",
        "label": "",
        "field_type": "string",
        "required": False,
        "visible_in_list": True,
        "visible_in_form": True,
        "searchable": False,
        "sortable": False,
        "archived": False,
        "default_value": None,
        "enum_values": None,
        "validation": None,
        "ui_config": None,
        "business_type": None,
        "control_type": None,
        "encoding_rule": None,
        "sort_order": 0,
    }.items():
        setattr(proxy, key, payload.get(key, default))
    return proxy


async def _runtime_form_fields(db: AsyncSession, tenant_id: int, form_id: int) -> list:
    from app.models.relational import FormField

    version = await _latest_form_version(db, tenant_id, form_id)
    if version:
        return [
            _field_proxy_from_payload(field)
            for field in (version.snapshot or {}).get("fields", [])
            if isinstance(field, dict)
        ]
    return (await db.execute(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
