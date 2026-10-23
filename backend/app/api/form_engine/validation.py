"""Record/status/field-value validation for form storage paths."""
from __future__ import annotations

from typing import Optional
from datetime import date, datetime

from fastapi import HTTPException

# Statuses a client may set on a record. Mirrors the workflow view vocabulary
# (RECORD_STATUS_TO_VIEW_TAB) plus the storage defaults; anything else is a
# typo or an attempt to invent states the UI cannot render.
ALLOWED_RECORD_STATUSES = {
    "active",
    "archived",
    "draft",
    "pending",
    "submitted",
    "reviewing",
    "running",
    "in_progress",
    "processing",
    "approved",
    "done",
    "completed",
    "closed",
    "returned",
    "rejected",
}


def _validate_record_status(status: Optional[str]) -> None:
    if status is None:
        return
    if str(status).lower() not in ALLOWED_RECORD_STATUSES:
        raise HTTPException(422, f"Invalid record status: {status}")


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


def _field_max_bytes(field) -> Optional[int]:
    from app.services.field_limits import max_bytes
    return max_bytes(field)


def _validate_record_data(fields: list, data: dict, *, partial: bool = False) -> None:
    from app.services.field_limits import byte_size, DEFAULT_RECORD_BYTES
    if byte_size(data) > DEFAULT_RECORD_BYTES:
        raise HTTPException(422, '单条表单记录不能超过系统上限 2 MiB')
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
            if field.required and data.get(field.field_name) in (None, "", [])
        ]
        if missing:
            raise HTTPException(422, f"Missing required field(s): {', '.join(missing)}")

    for name, value in data.items():
        if value in (None, ""):
            continue
        field = by_name[name]
        limit = _field_max_bytes(field)
        from app.services.field_limits import byte_size
        if limit is not None and byte_size(value) > limit:
            raise HTTPException(422, f"字段「{field.label or name}」不能超过 {limit} 字节（UTF-8）")
        field_type = (field.field_type or "string").lower()
        if field_type in {"number", "decimal", "float"} and (not isinstance(value, (int, float)) or isinstance(value, bool)):
            raise HTTPException(422, f"Field {name} must be a number")
        if field_type in {"integer", "int"} and (not isinstance(value, int) or isinstance(value, bool)):
            raise HTTPException(422, f"Field {name} must be an integer")
        if field_type in {"integer", "int"} and not -(2 ** 31) <= value <= 2 ** 31 - 1:
            raise HTTPException(422, f"字段「{field.label or name}」超出 32 位整数范围")
        if field_type == "boolean" and not isinstance(value, bool):
            raise HTTPException(422, f"Field {name} must be a boolean")
        if field_type in {"date", "datetime"} and not isinstance(value, str):
            raise HTTPException(422, f"Field {name} must be an ISO date string")
        if field_type in {"date", "datetime"}:
            try:
                date.fromisoformat(value) if field_type == "date" else datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as exc:
                raise HTTPException(422, f"Field {name} must be an ISO date string") from exc
        if field_type == "code" and not isinstance(value, str):
            raise HTTPException(422, f"Field {name} must be a code string")
        if field_type == "enum":
            allowed = _field_allowed_values(field)
            settings = (getattr(field, 'ui_config', None) or {}).get('typeSettings') or {}
            values = value if isinstance(value, list) and (settings.get('selectionMode') == 'multiple' or settings.get('displayMode') == 'tags') else [value]
            if allowed and not settings.get('allowCreateOption') and any(str(item) not in allowed for item in values):
                raise HTTPException(422, f"Field {name} must be one of: {', '.join(sorted(allowed))}")


def _merged_record_data(existing: Optional[dict], patch: Optional[dict]) -> dict:
    return {**(existing or {}), **(patch or {})}


def _field_value_is_compatible(field, value) -> bool:
    if value in (None, ""):
        return True
    limit = _field_max_bytes(field)
    from app.services.field_limits import byte_size
    if limit is not None and byte_size(value) > limit:
        return False
    field_type = (field.field_type or "string").lower()
    if field_type in {"number", "decimal", "float"}:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field_type in {"integer", "int"}:
        return isinstance(value, int) and not isinstance(value, bool) and -(2 ** 31) <= value <= 2 ** 31 - 1
    if field_type == "boolean":
        return isinstance(value, bool)
    if field_type in {"date", "datetime"}:
        return isinstance(value, str)
    if field_type == "code":
        return isinstance(value, str)
    if field_type == "enum":
        allowed = _field_allowed_values(field)
        ui=getattr(field,'ui_config',None) or {};settings=ui.get('typeSettings') or {}
        values=value if isinstance(value,list) and (settings.get('selectionMode')=='multiple' or settings.get('displayMode')=='tags') else [value]
        return settings.get('allowCreateOption') or not allowed or all(str(item) in allowed for item in values)
    return True
