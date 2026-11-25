"""Reserved metadata filters shared by dynamic JSON and physical form tables."""

import re
from datetime import datetime, timedelta, timezone

from app.core.production_errors import coded_error


ACTOR_COLUMNS = {'_created_by': 'created_by', '_updated_by': 'updated_by'}
TIME_COLUMNS = {'_created_at': 'created_at', '_updated_at': 'updated_at'}
ID_COLUMNS = {'_record_id': 'id', **ACTOR_COLUMNS}
RECORD_LIST_METADATA_FIELDS = frozenset(ID_COLUMNS.keys() | TIME_COLUMNS.keys())
_ISO_DATE = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}')

MetadataConditions = list[tuple[str, str, int | datetime]]


def _timestamp(value):
    if value in (None, ''):
        return None
    if (not isinstance(value, str) or len(value) > 40 or not _ISO_DATE.fullmatch(value[:10])
            or len(value) > 10 and value[10] not in 'T '):
        raise ValueError('Expected an ISO timestamp')
    timestamp = datetime.fromisoformat(value)
    if timestamp.tzinfo is not None:
        timestamp = timestamp.astimezone(timezone.utc).replace(tzinfo=None)
    return timestamp


def split_record_metadata_filters(filters, *, error_code='RECORD_FILTER_INVALID', status_code=422):
    business = []
    conditions: MetadataConditions = []
    for item in filters:
        field = item.get('field')
        if not isinstance(field, str) or field not in RECORD_LIST_METADATA_FIELDS:
            business.append(item)
            continue
        value = item.get('value')
        op = item.get('op') or 'equals'
        try:
            if field in ID_COLUMNS:
                if op != 'equals':
                    raise ValueError('Expected equals')
                if value in (None, ''):
                    continue
                if isinstance(value, str) and re.fullmatch('[0-9]{1,19}', value):
                    value = int(value)
                if type(value) is not int or not 0 < value <= 2**63 - 1:
                    raise ValueError('Expected a positive record or user ID')
                conditions.append((ID_COLUMNS[field], '=', value))
                continue

            if op != 'between':
                raise ValueError('Expected between')
            if value in (None, ''):
                continue
            if not isinstance(value, list) or len(value) != 2:
                raise ValueError('Expected two range bounds')
            start, end = map(_timestamp, value)
            exclusive = item.get('endExclusive', False)
            if type(exclusive) is not bool:
                raise ValueError('Expected a boolean endExclusive')
            if end is not None and len(value[1]) == 10 and not exclusive:
                end += timedelta(days=1)
                exclusive = True
            if start is not None and end is not None and (start > end or exclusive and start == end):
                raise ValueError('Expected an ordered date range')
            if start is not None:
                conditions.append((TIME_COLUMNS[field], '>=', start))
            if end is not None:
                conditions.append((TIME_COLUMNS[field], '<' if exclusive else '<=', end))
        except (ValueError, OverflowError) as exc:
            raise coded_error(status_code, error_code, f'系统字段筛选参数无效：{field}') from exc
    return business, conditions


def record_metadata_sql(conditions: MetadataConditions, dialect: str) -> tuple[list[str], dict]:
    clauses, params = [], {}
    for index, (column, op, value) in enumerate(conditions):
        name = f'record_metadata_{index}'
        operand = f':{name}'
        if isinstance(value, datetime) and dialect == 'sqlite':
            # SQLite stores generated timestamps at second precision and ORM writes with microseconds.
            # Normalize to the same precision without rounding across an exclusive day boundary.
            column = f"(replace(substr({column}, 1, 19), 'T', ' ') || '.' || substr(substr({column}, 21) || '000000', 1, 6))"
            value = value.isoformat(' ', timespec='microseconds')
        elif isinstance(value, int) and dialect == 'postgresql':
            operand = f'CAST({operand} AS BIGINT)'
        clauses.append(f'{column} {op} {operand}')
        params[name] = value
    return clauses, params
