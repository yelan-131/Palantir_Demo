"""Aggregate plain chart metrics and filter values without retaining every record."""
from __future__ import annotations

import math
import re
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import select, text

from app.core.identifiers import assert_safe_identifier
from app.core.permissions import allowed_form_fields, evaluate_form_permission
from app.models.relational import Form
from app.services.analytics_runtime import design_errors
from app.services.field_policies import has_presentation_rules
from app.services.form_engine.naming import _uses_physical_form_table
from app.services.records import iter_raw, project_record, record_allowed, runtime_fields

_MEASURE = re.compile(r'(sum|avg|min|max|count_distinct)\(([A-Za-z_]\w*)\)')


def plain_metric(expression):
    text_value = str(expression or '').strip()
    if text_value in {'count()', 'count(*)'}:
        return 'count', None
    match = _MEASURE.fullmatch(text_value)
    return (match.group(1), match.group(2)) if match else None


class _Accumulator:
    def __init__(self, kind, field):
        self.kind = kind
        self.field = field
        self.count = 0
        self.numbers = 0
        self.total = 0.0
        self.low = None
        self.high = None
        self.distinct = set()
        self.error = None

    def add(self, row):
        self.count += 1
        if self.kind == 'count':
            return
        value = row.get(self.field)
        if value in (None, ''):
            return
        if self.kind == 'count_distinct':
            self.distinct.add(str(value))
            return
        try:
            number = float(value)
        except (TypeError, ValueError):
            self.error = '指标字段包含非数值内容'
            return
        if not math.isfinite(number):
            self.error = '指标字段包含非有限数值'
            return
        self.numbers += 1
        self.total += number
        self.low = number if self.low is None else min(self.low, number)
        self.high = number if self.high is None else max(self.high, number)

    def value(self, number_format):
        if self.error:
            return None
        if self.kind == 'count':
            raw = self.count
        elif self.kind == 'count_distinct':
            raw = len(self.distinct)
        elif not self.numbers:
            return None
        elif self.kind == 'sum':
            raw = self.total
        elif self.kind == 'avg':
            raw = self.total / self.numbers
        elif self.kind == 'min':
            raw = self.low
        else:
            raw = self.high
        scaled = float(raw) * (100 if number_format == 'percent' else 1)
        if not math.isfinite(scaled):
            self.error = '计算结果不是有限数值'
            return None
        return round(scaled, 4)


def _plain_design(design, filters, widget_filters):
    metrics = design.get('metrics') or []
    if not metrics or not design.get('datasets') or not design.get('widgets'):
        return False
    if any(item.get('sharedMetricId') or plain_metric(item.get('expression')) is None for item in metrics):
        return False
    if any(item.get('sourceType') != 'businessForm' or item.get('rangeFilters') for item in design.get('datasets') or []):
        return False
    groups = [filters, *(widget_filters or {}).values()]
    return not any(isinstance(value, list) for group in groups for value in group.values())


def _matches(row, filters):
    for key, value in filters.items():
        if value in (None, ''):
            continue
        field = 'date' if key == 'dateRange' else key
        if str(row.get(field, '')) != str(value):
            return False
    return True


def _json_text(dialect, field):
    assert_safe_identifier(field)
    if dialect == 'postgresql':
        return f"data ->> '{field}'"
    return f"json_extract(data, '$.{field}')"


async def _sql_distinct_allowed(db, user, form, fields):
    if user.get('is_admin') is not True or form.code == 'alert-center' or _uses_physical_form_table(form):
        return False
    if has_presentation_rules(fields):
        return False
    decision = await evaluate_form_permission(user, form.id, 'view', db)
    return bool(decision['allowed'])


async def _iter_visible(db, user, form, names, *, statistics=False):
    from app.services.designer_permissions import allow_statistics
    cache = {}
    fields = await runtime_fields(db, form, cache=cache)
    if statistics:
        await allow_statistics(db, user, form)
    async for record in iter_raw(db, form, fields=fields):
        if form.code == 'alert-center':
            from app.services.alert_service import is_material_request
            if is_material_request(record['data']):
                continue
        if not await record_allowed(db, user, form, 'view', record, cache=cache):
            continue
        data = (await project_record(db, user, form, record, fields, cache=cache)).get('data') or {}
        yield {name: data[name] for name in names if name in data}


async def _require_view(db, user, form):
    decision = await evaluate_form_permission(user, form.id, 'view', db)
    if not decision['allowed']:
        raise HTTPException(403, 'Form permission denied')


async def distinct_values(db, user, form, names, *, limit=500):
    await _require_view(db, user, form)
    fields = await runtime_fields(db, form)
    if names and await _sql_distinct_allowed(db, user, form, fields):
        dialect = db.bind.dialect.name
        found = {}
        for name in names:
            column = _json_text(dialect, name)
            rows = (await db.execute(text(
                f"SELECT DISTINCT {column} AS value FROM dynamic_records "
                "WHERE tenant_id = :tenant AND form_id = :form_id AND deleted_at IS NULL "
                f"AND {column} IS NOT NULL AND {column} != '' ORDER BY value LIMIT :limit"
            ), {'tenant': form.tenant_id, 'form_id': form.id, 'limit': limit})).all()
            found[name] = [str(row.value) for row in rows]
        return found
    found = {name: set() for name in names}
    async for row in _iter_visible(db, user, form, names):
        for name in names:
            if row.get(name) is not None:
                found[name].add(str(row[name]))
    return {name: sorted(values)[:limit] for name, values in found.items()}


def _source_query(tenant_id, source):
    query = select(Form).where(Form.tenant_id == tenant_id, Form.code == source)
    if str(source).isdigit():
        query = select(Form).where(Form.tenant_id == tenant_id, (Form.code == source) | (Form.id == int(source)))
    return query


async def load_plain(db, tenant_id, form, design, *, user, filters, widget_filters, limit, resolve_shared):
    widget_filters = widget_filters or {}
    if resolve_shared and any(item.get('sharedMetricId') for item in design.get('metrics') or []):
        return None
    if not _plain_design(design, filters, widget_filters):
        return None
    if any(key not in set(design.get('globalFilters') or []) for key in filters):
        raise HTTPException(422, '筛选字段未配置为全局筛选器')
    metrics = {item['id']: (*plain_metric(item.get('expression')), item.get('format'), item.get('name'), item.get('datasetId')) for item in design['metrics']}
    prepared = []
    for dataset in design.get('datasets') or []:
        source_key = str(dataset.get('source') or '')
        source = form if source_key in {str(form.id), form.code} else await db.scalar(_source_query(tenant_id, source_key))
        if source is None:
            return None
        if not (await evaluate_form_permission(user, source.id, 'view', db))['allowed']:
            return None
        fields = await runtime_fields(db, source)
        visible = await allowed_form_fields(user, source.id, 'view', fields, db)
        declared = set((dataset.get('dimensions') or []) + (dataset.get('measures') or []))
        if declared - visible:
            return None
        labels = {field.field_name: field.label or field.field_name for field in fields if field.field_name in declared & visible}
        prepared.append((dataset, source, labels, declared & visible))
    widget_fields = {item['id']: set((item.get('dimensions') or []) + (item.get('measures') or [])) for item, *_ in prepared}
    for widget_id, conditions in widget_filters.items():
        widget = next((item for item in design.get('widgets') or [] if item.get('id') == widget_id), None)
        if widget is None or any(key not in widget_fields.get(widget.get('datasetId'), set()) for key in conditions):
            raise HTTPException(422, '组件筛选字段不可用')

    metric_values, widgets, options, labels, sources = {}, {}, defaultdict(set), {}, {}
    errors = [item for item in design_errors(design) if item]
    for dataset, source, label_map, names in prepared:
        dataset_id = dataset['id']
        labels[dataset_id] = label_map
        sources[dataset_id] = source.code
        overall = {metric_id: _Accumulator(kind, field) for metric_id, (kind, field, _, _, metric_dataset) in metrics.items() if metric_dataset == dataset_id}
        widget_groups = {}
        widget_filtered = {}
        totals = defaultdict(int)
        samples = defaultdict(list)
        for widget in design.get('widgets') or []:
            if widget.get('datasetId') != dataset_id:
                continue
            ids = [metric_id for metric_id in widget.get('metricIds') or [] if metric_id in metrics and metrics[metric_id][4] == dataset_id]
            widget_groups[widget['id']] = defaultdict(lambda ids=ids: {metric_id: _Accumulator(*metrics[metric_id][:2]) for metric_id in ids})
            if widget_filters.get(widget['id']):
                widget_filtered[widget['id']] = {metric_id: _Accumulator(*metrics[metric_id][:2]) for metric_id in ids}
        async for row in _iter_visible(db, user, source, names, statistics=True):
            for name in design.get('globalFilters') or []:
                if name != 'dateRange' and name in names and row.get(name) is not None:
                    options[name].add(str(row[name]))
            if not _matches(row, filters):
                continue
            for accumulator in overall.values():
                accumulator.add(row)
            for widget in design.get('widgets') or []:
                if widget.get('datasetId') != dataset_id or not _matches(row, widget_filters.get(widget['id'], {})):
                    continue
                totals[widget['id']] += 1
                if len(samples[widget['id']]) < limit:
                    samples[widget['id']].append({key: row.get(key) for key in names})
                dimension = widget.get('dimension')
                if dimension and dimension in names:
                    bucket = widget_groups[widget['id']]['未填写' if row.get(dimension) is None else str(row.get(dimension))]
                    for accumulator in bucket.values():
                        accumulator.add(row)
                if widget['id'] in widget_filtered:
                    for accumulator in widget_filtered[widget['id']].values():
                        accumulator.add(row)
        for metric_id, accumulator in overall.items():
            metric_values[metric_id] = accumulator.value(metrics[metric_id][2])
            if accumulator.error:
                errors.append(f'指标「{metrics[metric_id][3]}」：{accumulator.error}')
                metric_values[metric_id] = None
        for widget in design.get('widgets') or []:
            if widget.get('datasetId') != dataset_id:
                continue
            ids = [metric_id for metric_id in widget.get('metricIds') or [] if metric_id in overall or metric_id in widget_filtered.get(widget['id'], {})]
            dimension = widget.get('dimension')
            series = []
            if dimension and dimension in names:
                for name, bucket in sorted(widget_groups[widget['id']].items()):
                    series.append({'name': name, **{metric_id: accumulator.value(metrics[metric_id][2]) for metric_id, accumulator in bucket.items()}})
                if widget.get('type') == 'rank-table' and ids:
                    series.sort(key=lambda point: point.get(ids[0]) or 0, reverse=True)
            values = widget_filtered.get(widget['id'])
            metric_map = {metric_id: accumulator.value(metrics[metric_id][2]) for metric_id, accumulator in values.items()} if values else {metric_id: metric_values.get(metric_id) for metric_id in ids}
            widgets[widget['id']] = {'metricValues': metric_map, 'series': series[:limit], 'rows': samples[widget['id']], 'total': totals[widget['id']], 'truncated': totals[widget['id']] > limit or len(series) > limit}
    return {'metricValues': metric_values, 'widgets': widgets, 'filterOptions': {key: sorted(value)[:500] for key, value in options.items()}, 'errors': list(dict.fromkeys(errors)), 'widgetErrors': {}, 'datasetSources': sources, 'fieldLabels': labels}
