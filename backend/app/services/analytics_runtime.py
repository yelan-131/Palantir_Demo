"""Bounded, non-evaluating analytics expressions over permission-projected records."""
from __future__ import annotations

from app.services.analytics_dataset_range import filter_dataset_range, validate_range

import ast
import math
import re
from collections import defaultdict


class AnalyticsError(ValueError):
    pass


AGGREGATES = {'sum', 'avg', 'min', 'max', 'count', 'count_distinct', 'count_if'}


def parse_expression(expression: str, fields: set[str]):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 512:
        raise AnalyticsError('指标公式不能为空且不能超过 512 字符')
    expression = re.sub(r'\bcount\s*\(\s*\*\s*\)', 'count()', expression, flags=re.I)
    try:
        tree = ast.parse(expression, mode='eval')
    except (SyntaxError, RecursionError) as exc:
        raise AnalyticsError('公式语法无效，请使用 sum(actual) / sum(target) 等聚合表达式') from exc
    nodes = list(ast.walk(tree))
    if len(nodes) > 80:
        raise AnalyticsError('指标公式过于复杂')
    allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load,
               ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.UAdd, ast.Call,
               ast.Compare, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
               ast.BoolOp, ast.And, ast.Or, ast.Not)
    function_names = {id(node.func) for node in nodes if isinstance(node, ast.Call)}
    for node in nodes:
        if not isinstance(node, allowed):
            raise AnalyticsError('公式包含不支持的操作')
        if isinstance(node, ast.Constant) and (not isinstance(node.value, (str, int, float, bool)) or isinstance(node.value, str) and len(node.value) > 128):
            raise AnalyticsError('公式常量无效')
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in AGGREGATES or node.keywords:
                raise AnalyticsError('仅支持 count、sum、avg、min、max、count_distinct、count_if')
            if len(node.args) != (0 if node.func.id == 'count' and not node.args else 1):
                raise AnalyticsError('聚合函数参数数量无效')
            if node.func.id != 'count_if' and node.args and not isinstance(node.args[0], ast.Name):
                raise AnalyticsError('聚合函数参数必须是字段名')
            if any(isinstance(child, ast.Call) for arg in node.args for child in ast.walk(arg)):
                raise AnalyticsError('不支持嵌套聚合函数')
        if isinstance(node, ast.Name) and id(node) not in function_names and node.id not in fields:
            raise AnalyticsError(f'公式字段不可用：{node.id}')
    return tree.body


def number(value):
    if value in (None, ''):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise AnalyticsError('指标字段包含非数值内容') from exc
    if not math.isfinite(result):
        raise AnalyticsError('指标字段包含非有限数值')
    return result


def calculate(expression: str, rows: list[dict], fields: set[str], format: str = 'number'):
    root = parse_expression(expression, fields)

    def visit(node, row=None):
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            if row is not None:
                return row.get(node.id)
            return sum(number(item.get(node.id)) or 0 for item in rows)
        if isinstance(node, ast.Call):
            name = node.func.id
            if name == 'count_if':
                return sum(bool(visit(node.args[0], item)) for item in rows)
            values = [item.get(node.args[0].id) for item in rows] if node.args else []
            values = [value for value in values if value is not None and value != '']
            if name == 'count':
                return len(values) if node.args else len(rows)
            if name == 'count_distinct':
                return len({str(value) for value in values})
            values = [number(value) for value in values]
            if name == 'sum':
                return sum(values)
            if not values:
                return None
            return {'avg': lambda: sum(values) / len(values), 'min': lambda: min(values), 'max': lambda: max(values)}[name]()
        if isinstance(node, ast.UnaryOp):
            value = visit(node.operand, row)
            if isinstance(node.op, ast.Not):
                return not value
            return None if value is None else -value if isinstance(node.op, ast.USub) else +value
        if isinstance(node, ast.BoolOp):
            values = [bool(visit(child, row)) for child in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.Compare):
            left = visit(node.left, row)
            for op, child in zip(node.ops, node.comparators):
                right = visit(child, row)
                if isinstance(op, ast.Eq): result = left == right
                elif isinstance(op, ast.NotEq): result = left != right
                elif left is None or right is None: result = False
                elif isinstance(op, ast.Lt): result = left < right
                elif isinstance(op, ast.LtE): result = left <= right
                elif isinstance(op, ast.Gt): result = left > right
                else: result = left >= right
                if not result: return False
                left = right
            return True
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left, row), visit(node.right, row)
            if left is None or right is None: return None
            left, right = number(left), number(right)
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
            if isinstance(node.op, ast.Mult): return left * right
            return left / right if right else None
        raise AnalyticsError('不支持的公式')

    try:
        value = visit(root)
        if value is None: return None
        value = float(value) * (100 if format == 'percent' else 1)
        if not math.isfinite(value): raise AnalyticsError('计算结果不是有限数值')
        return round(value, 4)
    except AnalyticsError:
        raise
    except (TypeError, ValueError, OverflowError, ZeroDivisionError) as exc:
        raise AnalyticsError('公式运算类型无效') from exc


def design_errors(design):
    if not isinstance(design, dict): return ['看板配置必须是对象']
    datasets, metrics, widgets = (design.get(key) or [] for key in ('datasets', 'metrics', 'widgets'))
    errors = []
    for name, items in [('数据集', datasets), ('指标', metrics), ('组件', widgets)]:
        ids = [item.get('id') for item in items if isinstance(item, dict)]
        if len(ids) != len(items) or not all(ids) or len(ids) != len(set(ids)):
            errors.append(f'{name} ID 缺失或重复')
    if not datasets or not metrics or not widgets: errors.append('看板至少需要一个数据集、指标和组件')
    dataset_map = {item['id']: item for item in datasets if isinstance(item, dict) and item.get('id')}
    metric_map = {item['id']: item for item in metrics if isinstance(item, dict) and item.get('id')}
    widget_map = {item['id']: item for item in widgets if isinstance(item, dict) and item.get('id')}
    for dataset in dataset_map.values():
        try: validate_range(dataset.get('rangeFilters', []), set((dataset.get('dimensions') or []) + (dataset.get('measures') or [])))
        except ValueError as exc: errors.append(f'数据集「{dataset.get("name")}」：{exc}')
        if dataset.get('sourceType') != 'businessForm': errors.append(f'数据集「{dataset.get("name") or dataset["id"]}」暂仅支持业务表单来源')
        if not str(dataset.get('source') or '').strip(): errors.append('业务表单来源不能为空')
        if dataset.get('refreshMode') not in {'realtime', 'scheduled', 'manual'}: errors.append('刷新策略无效')
        interval = dataset.get('refreshInterval', 60)
        if not isinstance(interval, (int, float)) or not 10 <= interval <= 86400: errors.append('定时刷新间隔必须为 10–86400 秒')
    for metric in metric_map.values():
        dataset = dataset_map.get(metric.get('datasetId'))
        if not dataset: errors.append(f'指标「{metric.get("name")}」的数据集不存在'); continue
        try: parse_expression(metric.get('expression'), set((dataset.get('dimensions') or []) + (dataset.get('measures') or [])))
        except AnalyticsError as exc: errors.append(f'指标「{metric.get("name")}」：{exc}')
    for widget in widget_map.values():
        dataset = dataset_map.get(widget.get('datasetId'))
        if not dataset: errors.append(f'组件「{widget.get("title")}」的数据集不存在'); continue
        if widget.get('type') not in {'metric-card', 'detail-table'} and widget.get('dimension') not in (dataset.get('dimensions') or []): errors.append(f'组件「{widget.get("title")}」需要有效维度')
        if not widget.get('metricIds'): errors.append(f'组件「{widget.get("title")}」缺少指标')
        for metric_id in widget.get('metricIds') or []:
            if metric_id not in metric_map or metric_map[metric_id].get('datasetId') != widget.get('datasetId'): errors.append(f'组件「{widget.get("title")}」的指标不属于所选数据集')
    for link in design.get('interactions') or []:
        if link.get('sourceWidgetId') not in widget_map or link.get('targetWidgetId') not in widget_map or link.get('sourceWidgetId') == link.get('targetWidgetId'):
            errors.append('联动需要两个不同且存在的组件')
        else:
            source, target = widget_map[link['sourceWidgetId']], widget_map[link['targetWidgetId']]
            target_dataset = dataset_map.get(target.get('datasetId')) or {}
            if link.get('action') in {'filter', 'drilldown'} and source.get('dimension') not in (target_dataset.get('dimensions') or []):
                errors.append('联动来源维度必须在目标数据集中存在')
        if link.get('action') not in {'filter', 'drilldown', 'navigate'}: errors.append('联动动作无效')
    dimensions = {field for dataset in dataset_map.values() for field in dataset.get('dimensions') or []}
    for field in design.get('globalFilters') or []:
        if ('date' if field == 'dateRange' else field) not in dimensions: errors.append(f'全局筛选字段不可用：{field}')

    return errors


def filter_rows(rows, filters):
    return [row for row in rows if all(value in (None, '') or
            (isinstance(value, list) and len(value) == 2 and str(value[0]) <= str(row.get('date' if key == 'dateRange' else key) or '')[:10] <= str(value[1])) or
            (not isinstance(value, list) and str(row.get(key, '')) == str(value))
            for key, value in filters.items())]


def build_data(design, datasets, fields_by_dataset, filters=None, widget_filters=None, limit=500):
    filters, widget_filters = filters or {}, widget_filters or {}
    metrics = {item['id']: item for item in design.get('metrics') or []}
    metric_values, errors, widget_data = {}, [], {}
    scoped = {}
    dataset_map = {item['id']: item for item in design.get('datasets') or []}
    for key, rows in datasets.items():
        try:
            scoped[key] = filter_dataset_range(rows, dataset_map.get(key, {}).get('rangeFilters', []), fields_by_dataset.get(key, set()))
        except ValueError as exc:
            scoped[key] = []
            errors.append(f'数据集「{dataset_map.get(key, {}).get("name") or key}」：{exc}')
    filtered = {key: filter_rows(rows, {field: value for field, value in filters.items() if ('date' if field == 'dateRange' else field) in fields_by_dataset.get(key, set())}) for key, rows in scoped.items()}
    def values(rows, ids, dataset_id):
        result = {}
        for key in ids:
            metric = metrics.get(key)
            if not metric or metric.get('datasetId') != dataset_id: continue
            if dataset_id not in datasets:
                result[key] = None
                continue
            try: result[key] = calculate(metric.get('expression'), rows, fields_by_dataset.get(dataset_id, set()), metric.get('format'))
            except AnalyticsError as exc:
                result[key] = None
                message = f'指标「{metric.get("name")}」：{exc}'
                if message not in errors: errors.append(message)
        return result
    for dataset_id, rows in filtered.items():
        metric_values.update(values(rows, list(metrics), dataset_id))
    for widget in design.get('widgets') or []:
        dataset_id = widget.get('datasetId')
        rows = filter_rows(filtered.get(dataset_id, []), widget_filters.get(widget['id'], {}))
        ids, dimension = widget.get('metricIds') or [], widget.get('dimension')
        groups = defaultdict(list)
        if dimension and dimension in fields_by_dataset.get(dataset_id, set()):
            for row in rows: groups[str(row.get(dimension) if row.get(dimension) is not None else '未填写')].append(row)
        series = [{'name': name, **values(group, ids, dataset_id)} for name, group in sorted(groups.items())]
        if widget.get('type') == 'rank-table': series.sort(key=lambda point: point.get(ids[0]) or 0 if ids else 0, reverse=True)
        widget_data[widget['id']] = {'metricValues': values(rows, ids, dataset_id), 'series': series[:limit], 'rows': rows[:limit], 'total': len(rows), 'truncated': len(series) > limit or len(rows) > limit}
    options = {key: sorted({str(row[key]) for rows in scoped.values() for row in rows if key in row and row[key] is not None})[:500] for key in design.get('globalFilters') or [] if key != 'dateRange'}
    return {'metricValues': metric_values, 'widgets': widget_data, 'filterOptions': options, 'errors': errors}


async def source_errors(db, tenant_id, form, design, draft_fields):
    """Check references against real tenant-scoped metadata before publication."""
    from sqlalchemy import select
    from app.models.relational import Form
    from app.services.records import runtime_fields

    errors = []
    for dataset in design.get('datasets') or []:
        if dataset.get('sourceType') != 'businessForm':
            continue
        source = str(dataset.get('source') or '')
        if source in {form.code, str(form.id)}:
            fields = {field['field_name'] for field in draft_fields if not field.get('archived')}
        else:
            source_form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == source))
            if source_form is None and source.isdigit():
                source_form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.id == int(source)))
            if source_form is None:
                errors.append(f'数据集「{dataset.get("name")}」的来源表单不存在')
                continue
            fields = {field.field_name for field in await runtime_fields(db, source_form) if not field.archived}
        declared = set((dataset.get('dimensions') or []) + (dataset.get('measures') or []))
        if declared - fields:
            errors.append(f'数据集「{dataset.get("name")}」存在无效字段：' + '、'.join(sorted(declared - fields)))
    return errors
