"""Shared, permission-projected data loading for published and draft dashboards."""
from __future__ import annotations

import json
import math

from fastapi import HTTPException
from sqlalchemy import select

from app.core.permissions import allowed_form_fields
from app.models.relational import Form
from app.services.analytics_runtime import build_data, design_errors
from app.services.records import authorized_records, runtime_fields


def read_filters(value, nested=False):
    try:
        if isinstance(value, str):
            parsed = json.loads(value) if value else {}
        else:
            parsed = {} if value is None else value
        if not isinstance(parsed, dict) or len(parsed) > 50:
            raise ValueError()
        for group in list(parsed.values()) if nested else [parsed]:
            if not isinstance(group, dict) or len(group) > 50:
                raise ValueError()
            for key, item in group.items():
                if not isinstance(key, str) or len(key) > 200:
                    raise ValueError()
                if isinstance(item, list):
                    if len(item) != 2 or any(not isinstance(part, str) or len(part) > 200 for part in item):
                        raise ValueError()
                elif not isinstance(item, (str, int, float, type(None))):
                    raise ValueError()
                elif isinstance(item, str) and len(item) > 2000 or isinstance(item, float) and not math.isfinite(item):
                    raise ValueError()
        return parsed
    except (ValueError, TypeError):
        raise HTTPException(422, '筛选条件格式无效')


async def load_data(db, tenant_id, form, design, *, user, filters=None, widget_filters=None, limit=500, resolve_shared=True, widget_record_queries=None):
    """Use the same row, statistics and field boundary for every dashboard view."""
    filters, widget_filters = read_filters(filters), read_filters(widget_filters, True)
    shared_errors = []
    widget_rows, widget_query_errors = {}, {}
    if resolve_shared:
        from app.services.analytics_metric_library import hydrate_design
        design, shared_errors = await hydrate_design(db, tenant_id, design)
    dataset_rows, dataset_fields, dataset_errors, dataset_sources, field_labels = {}, {}, [], {}, {}
    for dataset in design.get('datasets') or []:
        dataset_id = dataset.get('id')
        if dataset.get('sourceType') != 'businessForm':
            dataset_errors.append(f'数据集「{dataset.get("name")}」暂不支持此来源类型')
            continue
        source_code = str(dataset.get('source') or '')
        source_form = form if source_code in {str(form.id), form.code} else await db.scalar(
            select(Form).where(Form.tenant_id == tenant_id, Form.code == source_code))
        if source_form is None and source_code.isdigit():
            source_form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.id == int(source_code)))
        if source_form is None:
            dataset_errors.append(f'数据集「{dataset.get("name")}」的业务表单不存在')
            continue
        try:
            source_records = await authorized_records(db, user, source_form, statistics=True)
            source_fields = await runtime_fields(db, source_form)
            visible = await allowed_form_fields(user, source_form.id, 'view', source_fields, db)
            declared = set((dataset.get('dimensions') or []) + (dataset.get('measures') or []))
            dataset_fields[dataset_id] = {field.field_name for field in source_fields if field.field_name in visible} & declared
            field_labels[dataset_id] = {field.field_name: field.label or field.field_name for field in source_fields
                                        if field.field_name in dataset_fields[dataset_id]}
            if declared - dataset_fields[dataset_id]:
                dataset_errors.append(f'数据集「{dataset.get("name")}」的部分字段不存在或不可见：' + '、'.join(sorted(declared - dataset_fields[dataset_id])))
            dataset_rows[dataset_id] = [
                {**{key: value for key, value in (record.get('data') or {}).items() if key in dataset_fields[dataset_id]}, '_recordId': record['id']}
                for record in source_records
            ]
            dataset_sources[dataset_id] = source_form.code
            if widget_record_queries:
                from types import SimpleNamespace
                from app.api.form_engine import _record_matches_search, _record_matches_filters
                query_fields = [field for field in source_fields if field.field_name in visible and not field.archived]
                for widget in design.get('widgets') or []:
                    query = widget_record_queries.get(widget['id'])
                    if widget.get('datasetId') != dataset_id or query is None:
                        continue
                    if any(c.get('field') not in {field.field_name for field in query_fields} for c in query['filters']):
                        widget_rows[widget['id']] = []
                        widget_query_errors[widget['id']] = ['无权使用组件筛选字段']
                        continue
                    matched = {record['id'] for record in source_records
                               if query['ready'] and _record_matches_search(SimpleNamespace(data=record['data']), query_fields, query['search'])
                               and _record_matches_filters(SimpleNamespace(data=record['data']), query_fields, query['filters'])}
                    widget_rows[widget['id']] = [row for row in dataset_rows[dataset_id] if row['_recordId'] in matched]
        except HTTPException as exc:
            if exc.status_code not in {403, 404}:
                raise
            dataset_errors.append(f'数据集「{dataset.get("name")}」无权查看记录或统计')
            dataset_rows.pop(dataset_id, None)
            for widget in design.get('widgets') or []:
                if widget.get('datasetId') == dataset_id:
                    widget_rows[widget['id']] = []
    allowed_filters = set(design.get('globalFilters') or [])
    if any(key not in allowed_filters for key in filters):
        raise HTTPException(422, '筛选字段未配置为全局筛选器')
    widget_map = {item['id']: item for item in design.get('widgets') or []}
    for widget_id, conditions in widget_filters.items():
        widget = widget_map.get(widget_id)
        if not widget or any(key not in dataset_fields.get(widget.get('datasetId'), set()) for key in conditions):
            raise HTTPException(422, '组件筛选字段不可用')
    data = build_data(design, dataset_rows, dataset_fields, filters, widget_filters, limit, widget_rows=widget_rows)
    data['errors'] = list(dict.fromkeys(shared_errors + dataset_errors + design_errors(design) + data['errors']))
    data['widgetErrors'] = widget_query_errors
    for widget_id in widget_query_errors:
        values = data['widgets'][widget_id]['metricValues']
        for metric_id in values:
            values[metric_id] = None
            data['metricValues'][metric_id] = None
    data['datasetSources'] = dataset_sources
    data['fieldLabels'] = field_labels
    return data
