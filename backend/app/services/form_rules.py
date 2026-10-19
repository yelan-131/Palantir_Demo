"""Declarative, database-authoritative rules for previews and every record write.

Expressions are parsed as a tiny AST (names, literals and addition); no eval,
SQL identifiers, Python attributes or arbitrary source tables are accepted.
"""
from __future__ import annotations

import ast
import json
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.api.deps import current_tenant_id
from app.core.permissions import allowed_form_fields
from app.models.relational import Material, Supplier

ARCHIVES = {
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
        visible = control_rule(rules.get('visible'), data, True)
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
            'readonly': generated or bool(ui.get('readonly')) or bool(ui.get('computed'))
                        or control_rule(rules.get('readonly'), data, False), 'generated': generated}
    return result


def expression_tree(expression):
    if not isinstance(expression, str) or len(expression) > 4096:
        raise HTTPException(422, '字段拼接表达式过长或无效')
    try:
        tree = ast.parse(expression, mode='eval')
    except (SyntaxError, TypeError):
        raise HTTPException(422, '字段拼接表达式无效')
    if sum(1 for _ in ast.walk(tree)) > 100:
        raise HTTPException(422, '字段拼接表达式过长')
    if any(not isinstance(node, (ast.Expression, ast.BinOp, ast.Add, ast.Name, ast.Load, ast.Constant)) for node in ast.walk(tree)):
        raise HTTPException(422, '字段表达式只支持字段名、常量和加法拼接')
    return tree


def compute(node, data):
    if isinstance(node, ast.Expression):
        return compute(node.body, data)
    if isinstance(node, ast.Name):
        return data.get(node.id) if data.get(node.id) is not None else ''
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = compute(node.left, data), compute(node.right, data)
        return str(left) + str(right) if isinstance(left, str) or isinstance(right, str) else left + right
    raise HTTPException(422, '不支持的字段表达式')


async def archive_options(db, user, field, data, *, selected=None):
    ref = relation(field)
    source = ref.get('target_form_code') or ref.get('target_model') or ref.get('target_table')
    if source not in ARCHIVES:
        # Configured business-form archives use the same row and field scope as
        # normal reads. A model name never becomes a dynamic SQL table name.
        from app.services import records
        target = await records.resolve_form(db, user, form_code=source)
        await records.require_form_permission(db, user, target.id, 'view')
        source_fields = await accessible_fields(db, user, target)
        readable = {field.field_name for field in source_fields}
        label = ref.get('label_field', 'name')
        mapping = ref.get('backfill') or {}
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
            if valid:
                options.append({'id': row['id'], 'label': str(values.get(label) or row['id']), 'data': values})
            if len(options) >= 200:
                break
        return options
    model, attributes = ARCHIVES[source]
    label = ref.get('label_field', 'name')
    if label not in attributes:
        raise HTTPException(422, f'档案显示字段不可用：{label}')
    query = select(model).where(model.tenant_id == current_tenant_id(user))
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
            rows = (await db.scalars(query.order_by(model.id).limit(200))).all()
    except (ProgrammingError, OperationalError) as exc:
        raise HTTPException(422, f'档案来源 {source} 不可用，请绑定已发布的档案表单') from exc
    return [{'id': row.id, 'label': str(getattr(row, label)),
             'data': {name: getattr(row, name) for name in attributes}} for row in rows]


async def evaluate(db, user, fields, incoming, *, existing=None, enforce=False, partial=False):
    fields = [field for field in fields if not field.archived]
    by_name = {field.field_name: field for field in fields}
    data = {**(existing or {}), **incoming}
    derived = set()
    # Validate every reference, even if no backfill is configured. IDs remain
    # tenant-scoped and dependent filters also apply to AI/HTTP writes.
    for field in fields:
        if not relation(field):
            continue
        ref = relation(field)
        mapping = ref.get('backfill') or {}
        if any(target not in by_name for target in mapping):
            raise HTTPException(422, '档案回填引用了不存在的目标字段')
        value = data.get(field.field_name)
        options = await archive_options(db, user, field, data, selected=value) if value not in (None, '') else []
        if value not in (None, '') and not options:
            if enforce:
                raise HTTPException(422, f'{field.label}不存在、不可访问或不满足关联条件')
            data[field.field_name] = None
        elif options:
            data[field.field_name] = options[0]['id']
        for target, attr in mapping.items():
            if options and attr not in options[0]['data']:
                raise HTTPException(422, f'档案回填属性不可用：{attr}')
            data[target] = options[0]['data'].get(attr) if options else None
            derived.add(target)
    expressions = {field.field_name: expression_tree(config(field)['computed']['expression'])
                   for field in fields if (config(field).get('computed') or {}).get('expression')}
    visiting, done = set(), set()
    def resolve(name):
        if name in done:
            return
        if name in visiting:
            raise HTTPException(422, '字段计算存在循环依赖')
        visiting.add(name)
        for node in ast.walk(expressions[name]):
            if isinstance(node, ast.Name):
                if node.id not in by_name:
                    raise HTTPException(422, f'字段表达式引用未知字段：{node.id}')
                if node.id in expressions:
                    resolve(node.id)
        dependencies = {node.id for node in ast.walk(expressions[name]) if isinstance(node, ast.Name)}
        data[name] = None if any(data.get(key) in (None, '') for key in dependencies) else compute(expressions[name], data)
        if isinstance(data[name], str) and len(data[name].encode('utf-8')) > 65536:
            raise HTTPException(422, '字段计算结果过长')
        derived.add(name)
        visiting.remove(name)
        done.add(name)
    for name in expressions:
        resolve(name)
    status = states(fields, data)
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
        if enforce and state['readonly'] and not state['generated'] and name not in derived and name in incoming:
            expected = (existing or {}).get(name, getattr(field, 'default_value', None))
            if incoming[name] != expected and incoming[name] not in (None, ''):
                raise HTTPException(422, f'字段「{field.label}」为只读，不能直接修改')
        # Configured conditional requirements apply even to AI drafts.
        if enforce and state['required'] and data.get(name) in (None, '') and (not partial or config(field).get('requiredWhen')):
            raise HTTPException(422, f'请填写{field.label}')
    validation_fields = []
    for field in fields:
        clone = SimpleNamespace(**{key: getattr(field, key, None) for key in
            ('field_name', 'label', 'field_type', 'archived', 'validation', 'enum_values')},
            required=status[field.field_name]['required'])
        validation_fields.append(clone)
    return {'data': data, 'states': status, 'derived': derived, 'fields': validation_fields}


async def accessible_fields(db, user, form, scope='view', data=None):
    from app.services.form_runtime import _runtime_form_fields
    fields = await _runtime_form_fields(db, current_tenant_id(user), form.id)
    allowed = await allowed_form_fields(user, form.id, scope, fields, db, record_data=data or {})
    return [field for field in fields if field.field_name in allowed]
