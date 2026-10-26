"""Editable create-time defaults: literal parts and references, never executable code."""
import math
import json
import copy
from fastapi import HTTPException
from app.services.field_limits import max_bytes, byte_size


def rule_errors(rule, names, target):
    if not isinstance(rule, dict) or rule.get('mode') not in {'fixed', 'template'}:
        return ['默认值规则类型无效']
    if 'enabled' in rule and not isinstance(rule['enabled'], bool):
        return ['默认值启用状态无效']
    if rule.get('enabled') is False:
        return []
    conditions = rule.get('conditions', [])
    if not isinstance(conditions, list) or len(conditions) > 20:
        return ['默认值触发条件必须为列表且不能超过 20 项']
    for condition in conditions:
        if not isinstance(condition, dict) or condition.get('sourceField') not in names or condition.get('sourceField') == target:
            return ['默认值条件引用了不存在的字段或自身']
        operator = condition.get('operator')
        if operator not in {'eq', 'ne', 'contains', 'gte', 'lte', 'isEmpty', 'notEmpty'}:
            return ['默认值触发条件运算符无效']
        if operator not in {'isEmpty', 'notEmpty'} and (not isinstance(condition.get('value'), str) or not condition['value'].strip()):
            return ['请完整填写默认值触发条件']
    if rule['mode'] == 'fixed':
        return []
    parts = rule.get('parts')
    if not isinstance(parts, list) or not 1 <= len(parts) <= 20:
        return ['默认值拼接需要 1～20 个片段']
    errors = []
    for part in parts:
        if not isinstance(part, dict) or part.get('kind') not in {'text', 'field'} or not isinstance(part.get('value'), str):
            errors.append('默认值片段无效')
            continue
        if part['kind'] == 'text' and len(part['value']) > 4096:
            errors.append('默认值固定文字过长')
        if part['kind'] == 'field' and (part['value'] not in names or part['value'] == target):
            errors.append('默认值引用了不存在的字段或自身')
    return errors


def apply_defaults(fields, data, existing=None):
    if existing is not None:
        return set()
    by_name = {field.field_name: field for field in fields}
    done, visiting, generated = set(), set(), set()

    def resolve(name):
        if name in done:
            return
        if name in visiting:
            raise HTTPException(422, '默认值拼接存在循环引用')
        field = by_name[name]
        rule = (getattr(field, 'ui_config', None) or {}).get('defaultRule')
        if isinstance(rule, dict) and rule.get('enabled') is False:
            done.add(name)
            return
        if rule is not None:
            errors = rule_errors(rule, by_name, name)
            if errors:
                raise HTTPException(422, f'字段「{field.label}」：{errors[0]}')
        # Explicit user input always wins over a default, including zero/false.
        if data.get(name) not in (None, ''):
            done.add(name)
            return
        visiting.add(name)
        if rule and rule.get('conditions'):
            from app.services.form_rules import matches
            for condition in rule['conditions']:
                resolve(condition['sourceField'])
            if not all(matches(condition, data) for condition in rule['conditions']):
                visiting.remove(name)
                done.add(name)
                return
        if rule and rule.get('mode') == 'template':
            if field.field_type not in {'string', 'text', 'code'}:
                raise HTTPException(422, '拼接默认值需要文本字段')
            pieces = []
            for part in rule['parts']:
                value = part['value']
                if part['kind'] == 'field':
                    source = by_name[value]
                    if source.field_type == 'json' or (getattr(source, 'ui_config', None) or {}).get('computed'):
                        raise HTTPException(422, '默认值拼接仅支持引用普通字段')
                    resolve(value)
                    value = data.get(value)
                    if value in (None, ''):
                        visiting.remove(name)
                        return
                    value = str(value).lower() if isinstance(value, bool) else str(value)
                pieces.append(value)
            data[name] = ''.join(pieces)
            generated.add(name)
        elif data.get(name) in (None, '') and getattr(field, 'default_value', None) not in (None, ''):
            value = field.default_value
            try:
                if field.field_type in {'int', 'integer'}:
                    value = int(value)
                elif field.field_type in {'number', 'decimal', 'float'}:
                    value = float(value)
                    if not math.isfinite(value):
                        raise ValueError()
                elif field.field_type == 'boolean':
                    if str(value).lower() not in {'true', 'false', '1', '0'}:
                        raise ValueError()
                    value = str(value).lower() in {'true', '1'}
                elif field.field_type == 'json' or (getattr(field, 'ui_config', None) or {}).get('typeSettings', {}).get('selectionMode') == 'multiple':
                    value = json.loads(value) if isinstance(value, str) else copy.deepcopy(value)
            except (ValueError, TypeError, OverflowError):
                raise HTTPException(422, f'字段「{field.label}」默认值与字段类型不符')
            data[name] = value
            generated.add(name)
        limit = max_bytes(field)
        if name in generated and limit and byte_size(data[name]) > limit:
            raise HTTPException(422, f'字段「{field.label}」默认值超过 {limit} 字节')
        visiting.remove(name)
        done.add(name)

    for name in by_name:
        resolve(name)
    return generated
