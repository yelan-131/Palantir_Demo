"""Declarative, database-authoritative rules for previews and every record write.

Expressions use a bounded arithmetic and text formula language; no eval,
SQL identifiers, Python attributes or arbitrary source tables are accepted.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

from app.services.form_calculations import expression_tree, compute, references, validate_rule

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.api.deps import current_tenant_id
from app.core.permissions import allowed_form_fields
from app.models.relational import Material, Supplier, Equipment, ProductionLine, User, OrgUnit, Role

ARCHIVES = {
    'equipment': (Equipment, {'id','name','model','manufacturer','status','line_id'}),
    'production_lines': (ProductionLine, {'id','name','status','workshop_id'}),
    'users': (User, {'id','username','display_name'}),
    'org_units': (OrgUnit, {'id','name','code'}),
    'roles': (Role, {'id','name','label'}),
    'materials': (Material, {'id', 'name', 'material_type', 'specs', 'unit'}),
    'suppliers': (Supplier, {'id', 'name', 'location', 'rating', 'lead_time_days'}),
}


def config(field):
    return getattr(field, 'ui_config', None) or {}


def relation(field):
    value = config(field).get('relation_config') or {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            raise HTTPException(422, f'关联字段 {field.field_name} 配置无效')
    return value


def matches(condition, data):
    if not condition:
        return True
    if not isinstance(condition, dict):
        raise HTTPException(422, '字段条件必须为对象')
    key = condition.get('field') or condition.get('sourceField')
    value = data.get(key)
    expected = condition.get('equals', condition.get('value'))
    op = condition.get('operator', 'equals')
    if op in {'equals', 'eq'}:
        return str(value) == str(expected)
    if op in {'notEquals', 'ne', 'not_equals'}:
        return str(value) != str(expected)
    if op in {'isEmpty', 'is_empty'}:
        return value in (None, '', [])
    if op in {'notEmpty', 'not_empty'}:
        return value not in (None, '', [])
    if op == 'contains':
        return str(expected) in str(value or '')
    if op in {'in', 'notIn'}:
        result = value in (expected if isinstance(expected, list) else str(expected).split(','))
        return result if op == 'in' else not result
    if op in {'gt', 'gte', 'lt', 'lte'}:
        try:
            a, b = float(value), float(expected)
            return {'gt': a > b, 'gte': a >= b, 'lt': a < b, 'lte': a <= b}[op]
        except (TypeError, ValueError):
            return False
    raise HTTPException(422, f'不支持的字段条件运算符：{op}')


def control_rule(rule, data, fallback):
    if not rule:
        return fallback
    groups = rule.get('conditionGroups')
    active = any(all(matches(c, data) for c in group) for group in groups) if groups else matches(rule.get('conditions'), data)
    return bool(rule.get('enabled', fallback)) and active


def states(fields, data):
    result = {}
    from app.api.form_engine.encoding import _is_encoding_field, _encoding_rule_for_field
    for field in fields:
        ui = config(field)
        rules = ui.get('rules') or {}
        ancestors = ui.get('layoutAncestors') or []
        visible = control_rule(rules.get('visible'), data, True) and all(control_rule(parent.get('visible'), data, True) for parent in ancestors if isinstance(parent, dict))
        show_when = (ui.get('visibility') or {}).get('showWhen')
        if show_when:
            visible = visible and matches(show_when, data)
        required = control_rule(rules.get('required'), data, bool(field.required))
        if ui.get('requiredWhen'):
            required = matches(ui['requiredWhen'], data)
        encoding = _encoding_rule_for_field(field) if _is_encoding_field(field) else {}
        generated = bool(_is_encoding_field(field) and encoding.get('enabled', True)
                         and encoding.get('generationMode') != 'manual'
                         and not (encoding.get('allowManualOverride') or encoding.get('allow_manual_override')))
        result[field.field_name] = {'visible': visible, 'required': required and visible and not generated,
            'readonly': ui.get('controlType') in {'readonly-table','readonly-text'} or generated or bool(ui.get('readonly')) or bool(ui.get('computed'))
                        or control_rule(rules.get('readonly'), data, False)
                        or any(control_rule(parent.get('readonly'), data, False) for parent in ancestors if isinstance(parent, dict)), 'generated': generated}
    return result


async def archive_options(db, user, field, data, *, selected=None, search=None):
    ref = relation(field)
    from app.services.option_search import settings as search_settings, validate as validate_search, filter_options, sql_query, range_matches, match_fields
    spec = search_settings(field)
    validate_search(spec)
    keyword = (search or {}).get('keyword', '')
    offset = ((search or {}).get('page', 1) - 1) * (search or {}).get('page_size', 20)
    count = (search or {}).get('page_size', 20) + 1
    if ref.get('source_kind') in {'dictionary','externalApi'}:
        from app.services.form_option_sources import options
        rows = filter_options(await options(db,user,ref,selected=selected), {'label', 'value'}, spec, data, keyword)
        return rows[offset:offset + count] if search else rows
    source = ref.get('target_form_code') or ref.get('target_model') or ref.get('target_table')
    if source not in ARCHIVES:
        # Configured business-form archives use the same row and field scope as
        # normal reads. A model name never becomes a dynamic SQL table name.
        from app.services import records
        target = await records.resolve_form(db, user, form_code=source)
        await records.require_form_permission(db, user, target.id, 'view')
        source_fields = await accessible_fields(db, user, target)
        readable = {field.field_name for field in source_fields}
        searchable = {item.field_name for item in source_fields if item.field_type != 'json'} | {'id'}
        validate_search(spec, searchable)
        label = ref.get('label_field', 'name')
        mapping = (ref.get('backfill') or {}) if config(field).get('assignmentRulesEnabled') is not False else {}
        if label not in readable or any(attr not in readable and attr != 'id' for attr in mapping.values()):
            raise HTTPException(403, '档案来源字段不可访问')
        if selected is not None:
            if isinstance(selected, bool) or not str(selected).isdigit() or int(selected) <= 0:
                raise HTTPException(422, f'{field.label}必须选择有效档案 ID')
            try:
                rows = [(await records.get_record(target.id, int(selected), db, user))['data']]
            except HTTPException as exc:
                if exc.status_code not in {403, 404}:
                    raise
                rows = []
        else:
            rows = await records.authorized_records(db, user, target)
        options = []
        for row in rows:
            if selected is not None and str(row['id']) != str(selected):
                continue
            values = {key: value for key, value in row['data'].items() if key in readable}
            values['id'] = row['id']
            valid = True
            for item in ref.get('filters') or []:
                if item.get('field') not in readable:
                    raise HTTPException(403, '档案筛选字段不可访问')
                expected = data.get(item.get('sourceField')) if item.get('sourceField') else item.get('value')
                if expected in (None, '') or str(values.get(item['field'])) != str(expected):
                    valid = False
            matched = match_fields(values, spec.get('fields') or [label], keyword, spec.get('match', 'contains')) if keyword else []
            if valid and range_matches(values, spec, data) and (not keyword or matched):
                options.append({'id': row['id'], 'label': str(values.get(label) or row['id']), 'data': values, 'matchedFields': matched})
            if len(options) >= (offset + count if search else 200):
                break
        return options[offset:offset + count] if search else options
    model, attributes = ARCHIVES[source]
    label = ref.get('label_field', 'name')
    if source=='users' and label=='name':label='display_name'
    if source=='roles' and label=='name':label='label'
    if label not in attributes:
        raise HTTPException(422, f'档案显示字段不可用：{label}')
    query = select(model).where(model.tenant_id == current_tenant_id(user))
    if source=='users':query=query.where(User.is_active.is_(True))
    if source=='org_units':query=query.where(OrgUnit.status=='active')
    if selected is not None:
        if isinstance(selected, bool) or not str(selected).isdigit() or int(selected) <= 0:
            raise HTTPException(422, f'{field.label}必须选择有效档案 ID')
        query = query.where(model.id == int(selected))
    filters = ref.get('filters') or []
    if ref.get('cascade_from') and ref.get('cascade_field'):
        filters = [*filters, {'field': ref['cascade_from'], 'sourceField': ref['cascade_field']}]
    for item in filters:
        column = item.get('field')
        if column not in attributes:
            raise HTTPException(422, '档案筛选字段不可用')
        value = data.get(item.get('sourceField')) if item.get('sourceField') else item.get('value')
        if value in (None, ''):
            return []
        query = query.where(getattr(model, column) == value)
    try:
        async with db.begin_nested():
            query = sql_query(query, model, attributes, spec, data, keyword, label)
            rows = (await db.scalars(query.order_by(model.id).offset(offset if search else 0).limit(count if search else 200))).all()
    except (ProgrammingError, OperationalError) as exc:
        raise HTTPException(422, f'档案来源 {source} 不可用，请绑定已发布的档案表单') from exc
    return [{'id': row.id, 'label': str(getattr(row,label) or getattr(row,'username',None) or row.id),
             'data': {name: getattr(row, name) for name in attributes},
             'matchedFields': match_fields({name: getattr(row, name) for name in attributes}, spec.get('fields') or [label], keyword, spec.get('match', 'contains')) if keyword else []} for row in rows]


async def evaluate(db, user, fields, incoming, *, existing=None, enforce=False, partial=False):
    fields = [field for field in fields if not field.archived]
    by_name = {field.field_name: field for field in fields}
    data = {**(existing or {}), **incoming}
    from app.services.form_control_validation import normalize, validate
    for field in fields:
        if field.field_name in incoming:
            data[field.field_name] = normalize(data[field.field_name], config(field).get('typeSettings') or {})
    from app.services.form_defaults import apply_defaults
    defaulted = apply_defaults(fields, data, existing)
    derived = set()
    # Validate every reference, even if no backfill is configured. IDs remain
    # tenant-scoped and dependent filters also apply to AI/HTTP writes.
    for field in fields:
        if not relation(field):
            continue
        ref = relation(field)
        mapping = (ref.get('backfill') or {}) if config(field).get('assignmentRulesEnabled') is not False else {}
        if any(target not in by_name for target in mapping):
            raise HTTPException(422, '档案回填引用了不存在的目标字段')
        value = data.get(field.field_name)
        options = await archive_options(db, user, field, data, selected=value) if value not in (None, '') else []
        if value not in (None, '') and not options:
            if enforce:
                raise HTTPException(422, f'{field.label}不存在、不可访问或不满足关联条件')
            data[field.field_name] = None
        elif options:
            data[field.field_name] = str(options[0]['id']) if field.field_type in {'string','text','person','enum','code'} else options[0]['id']
        for target, attr in mapping.items():
            if options and attr not in options[0]['data']:
                raise HTTPException(422, f'档案回填属性不可用：{attr}')
            data[target] = options[0]['data'].get(attr) if options else None
            derived.add(target)
    # Value/option assignments are persisted editor rules, not client-side only.
    assignments={}
    for source in fields:
        if config(source).get('assignmentRulesEnabled') is False: continue
        for rule in config(source).get('assignmentRules') or []:
            target=rule.get('targetField');attr=rule.get('sourceAttribute','')
            if not target or not attr or attr.startswith('record.'):continue
            if target not in by_name or attr not in {'self.value','self.option_value','self.option_label'}:
                raise HTTPException(422,'赋值规则引用了无效字段或属性')
            if relation(by_name[target]):raise HTTPException(422,'不能通过赋值规则改写关联字段，请直接选择关联记录')
            if target in assignments:raise HTTPException(422,'同一字段不能配置多个赋值来源')
            assignments[target]=(source,attr)
    resolved_assignments=set();resolving_assignments=set()
    async def assign(target):
        if target in resolved_assignments:return
        if target in resolving_assignments:raise HTTPException(422,'字段赋值存在循环依赖')
        resolving_assignments.add(target)
        source,attr=assignments[target]
        if source.field_name in assignments:await assign(source.field_name)
        value=data.get(source.field_name)
        if attr=='self.option_label' and value not in (None,''):
            if relation(source):
                options=await archive_options(db,user,source,data,selected=value)
                value=options[0]['label'] if options else None
            else:
                choices=source.enum_values or []
                if isinstance(choices,str):
                    try:choices=json.loads(choices)
                    except (ValueError,TypeError):choices=[]
                if isinstance(choices,dict):choices=choices.get('values',choices)
                if isinstance(choices,dict):value=choices.get(str(value),value)
                elif isinstance(choices,list):value=next((item.get('label',item.get('value')) for item in choices if isinstance(item,dict) and str(item.get('value'))==str(value)),value)
        data[target]=value;derived.add(target)
        resolving_assignments.remove(target);resolved_assignments.add(target)
    for target in assignments:await assign(target)
    expressions = {field.field_name: validate_rule(config(field)['computed'])
                   for field in fields if config(field).get('computed')}
    visiting, done = set(), set()
    def resolve(name):
        if name in done:
            return
        if name in visiting:
            raise HTTPException(422, '字段计算存在循环依赖')
        visiting.add(name)
        dependencies = references(expressions[name])
        for source in dependencies:
            if source not in by_name:
                raise HTTPException(422, f'字段表达式引用未知字段：{source}')
            if source in expressions:
                resolve(source)
        try:
            data[name] = compute(expressions[name], data, config(by_name[name])['computed'])
            value = data[name]
            kind = by_name[name].field_type
            if value is not None:
                if kind in {'int', 'integer'} and not isinstance(value, int):
                    raise HTTPException(422, '计算结果必须为整数，请调整公式或小数位数')
                if kind in {'number', 'decimal', 'float'} and not isinstance(value, (int, float)):
                    raise HTTPException(422, '计算结果必须为数值')
                if kind in {'string', 'text'}:
                    data[name] = str(value)
        except HTTPException as exc:
            raise HTTPException(exc.status_code, f'字段「{by_name[name].label}」{exc.detail}') from exc
        if isinstance(data[name], str) and len(data[name].encode('utf-8')) > 65536:
            raise HTTPException(422, '字段计算结果过长')
        derived.add(name)
        visiting.remove(name)
        done.add(name)
    for name in expressions:
        resolve(name)
    status = states(fields, data)
    from app.services.designer_permissions import field_settings
    role_fields=await field_settings(db,user,fields)
    for name,extra in role_fields.items():
        if extra.get('required') and status[name]['visible'] and not status[name].get('generated'):status[name]['required']=True
        if extra.get('hidden'):status[name]['required']=False
    for name in derived:
        status[name]['readonly'] = True
    for field in fields:
        name, state = field.field_name, status[field.field_name]
        if not state['visible']:
            if name in data:
                data[name] = None
            derived.add(name)
        if enforce and existing is not None and state['generated'] and name in incoming and incoming[name] != existing.get(name):
            raise HTTPException(422, f'字段「{field.label}」的自动编码不能手工修改')
        if enforce and state['readonly'] and not state['generated'] and name not in derived and name not in defaulted and name in incoming:
            expected = (existing or {}).get(name, getattr(field, 'default_value', None))
            if incoming[name] != expected and incoming[name] not in (None, ''):
                raise HTTPException(422, f'字段「{field.label}」为只读，不能直接修改')
        if enforce and state['visible']:
            validate(data.get(name), field, partial=partial)
            ui = config(field)
            if ui.get('controlType') == 'upload' and data.get(name) not in (None, ''):
                from app.services.form_files import validate_value
                from app.api.deps import current_user_id
                data[name] = validate_value(data[name], tenant_id=current_tenant_id(user), form_id=field.form_id, field_name=name,
                    uid=current_user_id(user), rules=ui.get('typeSettings') or {}, existing=(existing or {}).get(name))
        # Configured conditional requirements apply even to AI drafts.
        if enforce and state['required'] and data.get(name) in (None, '', []) and (not partial or config(field).get('requiredWhen')):
            raise HTTPException(422, f'请填写{field.label}')
    validation_fields = []
    for field in fields:
        clone = SimpleNamespace(**{key: getattr(field, key, None) for key in
            ('field_name', 'label', 'field_type', 'archived', 'validation', 'enum_values', 'ui_config')},
            required=status[field.field_name]['required'])
        validation_fields.append(clone)
    return {'data': data, 'states': status, 'derived': derived | defaulted, 'fields': validation_fields}


async def accessible_fields(db, user, form, scope='view', data=None):
    from app.services.form_runtime import _runtime_form_fields
    fields = await _runtime_form_fields(db, current_tenant_id(user), form.id)
    allowed = await allowed_form_fields(user, form.id, scope, fields, db, record_data=data or {})
    return [field for field in fields if field.field_name in allowed]
