"""Finite storage budgets shared by validation and published-schema checks."""
import json

DEFAULT_FIELD_BYTES = {'string': 1024, 'code': 1024, 'person': 1024, 'enum': 1024, 'text': 65536, 'json': 1048576}
DEFAULT_FORM_FIELDS = 200
DEFAULT_RECORD_BYTES = 2 * 1024 * 1024


def max_bytes(field):
    configured = (getattr(field, 'validation', None) or {}).get('maxBytes')
    if isinstance(configured, int) and not isinstance(configured, bool) and configured > 0:
        return configured
    return DEFAULT_FIELD_BYTES.get(str(getattr(field, 'field_type', '') or 'string').lower())


def byte_size(value):
    if isinstance(value, str):
        return len(value.encode('utf-8'))
    if isinstance(value, (dict, list)):
        try:
            return len(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8'))
        except (ValueError, TypeError, OverflowError):
            from fastapi import HTTPException
            raise HTTPException(422, '字段数据不是有效 JSON')
    return 0
