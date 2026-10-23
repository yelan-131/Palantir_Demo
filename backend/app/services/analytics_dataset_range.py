"""Bounded dataset conditions, evaluated only after permission projection."""
from decimal import Decimal, InvalidOperation

OPERATORS = {'eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'}


def validate_range(conditions, fields=None):
    if not isinstance(conditions, list) or len(conditions) > 20:
        raise ValueError('数据集范围最多配置 20 个条件')
    for condition in conditions:
        if not isinstance(condition, dict):
            raise ValueError('数据集范围条件格式无效')
        field, operator = condition.get('field'), condition.get('operator')
        if not isinstance(field, str) or not 1 <= len(field) <= 200 or not isinstance(operator, str) or operator not in OPERATORS:
            raise ValueError('数据集范围字段或比较方式无效')
        if fields is not None and field not in fields:
            raise ValueError(f'范围字段未声明或不可见：{field}')
        if operator not in {'isEmpty', 'notEmpty'}:
            value = condition.get('value')
            if not isinstance(value, str) or not value.strip() or len(value) > 500:
                raise ValueError('数据集范围比较值不能为空，且不能超过 500 字符')


def filter_dataset_range(rows, conditions, fields):
    validate_range(conditions, fields)

    def matches(row, condition):
        actual = row.get(condition['field'])
        operator, expected = condition['operator'], condition.get('value', '')
        empty = actual is None or actual == ''
        if operator == 'isEmpty': return empty
        if operator == 'notEmpty': return not empty
        if empty: return False
        if isinstance(actual, (dict, list)): return False
        if operator == 'contains': return expected.casefold() in str(actual).casefold()
        if isinstance(actual, (int, float)) and not isinstance(actual, bool):
            try:
                left, right = Decimal(str(actual)), Decimal(expected)
                if not left.is_finite() or not right.is_finite(): return False
            except InvalidOperation:
                return False
        else:
            left, right = str(actual), expected
        if operator == 'eq': return left == right
        if operator == 'ne': return left != right
        if operator == 'gt': return left > right
        if operator == 'gte': return left >= right
        if operator == 'lt': return left < right
        return left <= right

    return [row for row in rows if all(matches(row, item) for item in conditions)]
