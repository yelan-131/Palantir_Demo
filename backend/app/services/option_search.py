"""Declarative option search: allowlisted fields, narrowed ranges, stable paging."""
from decimal import Decimal, InvalidOperation
from fastapi import HTTPException
from sqlalchemy import String, cast, or_

MODES = {'contains', 'prefix', 'exact'}
OPERATORS = {'eq', 'ne', 'isEmpty', 'notEmpty'}


def settings(field):
    return ((getattr(field, 'ui_config', None) or {}).get('typeSettings') or {}).get('search') or {}


def validate(spec, available=None, context_fields=None):
    if not isinstance(spec, dict) or spec.get('match', 'contains') not in MODES:
        raise HTTPException(422, '搜索匹配方式无效')
    fields = spec.get('fields') or []
    filters = spec.get('filters') or []
    if not isinstance(fields, list) or len(fields) > 8 or any(not isinstance(name, str) for name in fields):
        raise HTTPException(422, '请选择最多 8 个搜索字段')
    if not isinstance(filters, list) or len(filters) > 20:
        raise HTTPException(422, '候选范围最多配置 20 个条件')
    for item in filters:
        if not isinstance(item, dict) or not isinstance(item.get('field'), str) or item.get('operator', 'eq') not in OPERATORS:
            raise HTTPException(422, '候选范围条件无效')
        if item.get('source', 'fixed') not in {'fixed', 'field'}:
            raise HTTPException(422, '候选范围取值方式无效')
        if item.get('source') == 'field' and not isinstance(item.get('sourceField'), str):
            raise HTTPException(422, '请选择候选范围引用的表单字段')
        if isinstance(item.get('value'), (dict, list)):
            raise HTTPException(422, '候选范围条件值必须为简单值')
        if available is not None and item['field'] not in available:
            raise HTTPException(403, '候选范围字段不可访问或已删除')
        if context_fields is not None and item.get('source') == 'field' and item['sourceField'] not in context_fields:
            raise HTTPException(403, '候选范围引用的表单字段不可访问或已删除')
    if available is not None and any(name not in available for name in fields):
        raise HTTPException(403, '搜索字段不可访问或已删除')


def text(value):
    return '' if value is None else str(value).lower() if isinstance(value, bool) else str(value)


def expected(item, data):
    return data.get(item.get('sourceField')) if item.get('source') == 'field' else item.get('value')


def range_matches(values, spec, data):
    for item in spec.get('filters') or []:
        value = values.get(item['field']); op = item.get('operator', 'eq')
        if op in {'isEmpty', 'notEmpty'}:
            if (value in (None, '')) != (op == 'isEmpty'): return False
            continue
        wanted = expected(item, data)
        # A missing dependency never expands the candidate range.
        if wanted in (None, ''): return False
        if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
            try: equal = Decimal(str(value)) == Decimal(str(wanted))
            except InvalidOperation: equal = False
        else: equal = text(value) == text(wanted)
        if equal != (op == 'eq'): return False
    return True


def match_fields(values, fields, keyword, mode):
    query = keyword.casefold()
    def hit(value):
        value = text(value).casefold()
        return value == query if mode == 'exact' else value.startswith(query) if mode == 'prefix' else query in value
    return [name for name in fields if hit(values.get(name))]


def filter_options(options, available, spec, data, keyword='', default_field='label'):
    validate(spec, available)
    fields = spec.get('fields') or [default_field]
    result = []
    for option in options:
        values = option['data']
        if not range_matches(values, spec, data): continue
        matched = match_fields(values, fields, keyword, spec.get('match', 'contains')) if keyword else []
        if keyword and not matched: continue
        result.append({**option, 'matchedFields': matched})
    return result


def sql_query(query, model, available, spec, data, keyword, default_field):
    validate(spec, available)
    for item in spec.get('filters') or []:
        column = getattr(model, item['field']); op = item.get('operator', 'eq')
        if op == 'isEmpty': query = query.where(or_(column.is_(None), cast(column, String) == ''))
        elif op == 'notEmpty': query = query.where(column.is_not(None), cast(column, String) != '')
        else:
            value = expected(item, data)
            if value in (None, ''): return query.where(False)
            try:
                python_type = column.type.python_type
                if python_type in (int, float, Decimal):
                    number = Decimal(str(value))
                    if not number.is_finite() or python_type is int and number != number.to_integral_value(): raise ValueError()
                    typed_value = python_type(number)
                else: typed_value = text(value)
            except (ValueError, TypeError, InvalidOperation):
                raise HTTPException(422, '候选范围条件值与字段类型不符')
            clause = column == typed_value if python_type in (int, float, Decimal) else cast(column, String) == typed_value
            query = query.where(clause if op == 'eq' else or_(column.is_(None), ~clause))
    if keyword:
        escaped = keyword.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        mode = spec.get('match', 'contains')
        pattern = escaped if mode == 'exact' else escaped + '%' if mode == 'prefix' else '%' + escaped + '%'
        query = query.where(or_(*[cast(getattr(model, name), String).ilike(pattern, escape='\\') for name in spec.get('fields') or [default_field]]))
    return query


async def schema(db, user, field):
    from app.services.form_rules import relation, ARCHIVES, accessible_fields
    from app.services import records
    ref = relation(field)
    if not ref:
        return {'kind': 'static', 'fields': [{'value': 'label', 'label': '选项文字'}], 'defaultField': 'label'}
    kind = ref.get('source_kind')
    if kind in {'dictionary', 'externalApi'}:
        return {'kind': kind, 'fields': [{'value': 'label', 'label': '显示文字'}, {'value': 'value', 'label': '选项编码'}], 'defaultField': 'label', 'note': '在接口本次返回的最多 1000 项中搜索。' if kind == 'externalApi' else '仅包含字典中已启用的选项。'}
    source = ref.get('target_form_code') or ref.get('target_model') or ref.get('target_table')
    if source in ARCHIVES:
        attrs = ARCHIVES[source][1]
        label = ref.get('label_field', 'name')
        if source == 'users' and label == 'name': label = 'display_name'
        if source == 'roles' and label == 'name': label = 'label'
        labels = {'id':'记录 ID','name':'名称','model':'型号','manufacturer':'制造商','status':'状态','line_id':'产线 ID','workshop_id':'车间 ID','username':'账号','display_name':'显示名称','code':'编码','label':'显示名称','material_type':'物料类型','specs':'规格型号','unit':'计量单位','location':'地区','rating':'评级','lead_time_days':'交期天数'}
        return {'kind': 'archive', 'fields': [{'value': name, 'label': labels.get(name,name)} for name in sorted(attrs)], 'defaultField': label}
    target = await records.resolve_form(db, user, form_code=source)
    await records.require_form_permission(db, user, target.id, 'view')
    fields = await accessible_fields(db, user, target)
    allowed = [{'value': item.field_name, 'label': item.label or item.field_name} for item in fields if item.field_type != 'json']
    allowed = [{'value': 'id', 'label': '记录 ID'}, *allowed]
    return {'kind': 'businessForm', 'fields': allowed, 'defaultField': ref.get('label_field', 'name')}


async def search(db, user, field, data, *, keyword='', page=1, page_size=20, selected=None, context_fields=None):
    from app.services.form_rules import archive_options, relation
    info = await schema(db, user, field)
    available = {item['value'] for item in info['fields']}
    spec = settings(field)
    validate(spec, available, context_fields)
    if not relation(field):
        raw = getattr(field, 'enum_values', None) or {}
        raw = raw.get('values', raw) if isinstance(raw, dict) else raw
        if isinstance(raw, dict): raw = [{'value': key, 'label': value} for key, value in raw.items()]
        options = [{'id': item.get('value'), 'label': str(item.get('label', item.get('value'))), 'data': {'label': str(item.get('label', item.get('value')))}} if isinstance(item, dict) else {'id': item, 'label': str(item), 'data': {'label': str(item)}} for item in raw] if isinstance(raw, list) else []
        options = filter_options(options, available, spec, data, keyword)
        if selected is not None: options = [option for option in options if str(option['id']) == str(selected)]
        offset = (page - 1) * page_size
        rows = options[offset:offset + page_size + 1]
    else:
        rows = await archive_options(db, user, field, data, selected=selected, search={'keyword': keyword, 'page': page, 'page_size': page_size})
    return {'data': [{'id': item['id'], 'label': item['label'], 'matchedFields': item.get('matchedFields') or []} for item in rows[:page_size]], 'page': page, 'page_size': page_size, 'has_more': len(rows) > page_size}
