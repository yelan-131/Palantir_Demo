"""Shared metric versions, authoritative bindings and atomic dashboard propagation."""
from __future__ import annotations

import ast
import copy
import hashlib
import json
import re
import uuid
from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.api.deps import current_tenant_id, current_user_id
from app.models.relational import AnalyticsSharedMetric, AnalyticsSharedMetricVersion, Form, FormVersion
from app.services.analytics_runtime import AnalyticsError, design_errors, parse_expression, source_errors
from app.services.field_uniqueness import lock
from app.services.records import change_audit, runtime_fields

METRIC_FIELDS = ('name', 'expression', 'format', 'threshold', 'description', 'unit')


class SharedMetricDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    source: str = Field(min_length=1, max_length=200)
    expression: str = Field(min_length=1, max_length=512)
    format: str = 'number'
    unit: str = Field(default='', max_length=20)
    description: str = Field(default='', max_length=500)
    threshold: str = Field(default='', max_length=200)

    @field_validator('name', 'source', 'expression')
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError('名称、来源和公式不能为空')
        return value.strip()

    @field_validator('format')
    @classmethod
    def valid_format(cls, value):
        if value not in {'number', 'percent', 'currency', 'duration'}:
            raise ValueError('不支持的指标格式')
        return value


class SharedMetricWrite(BaseModel):
    definition: SharedMetricDefinition
    expectedRevision: str = Field(min_length=1, max_length=128)


class SharedMetricPublish(SharedMetricWrite):
    impactToken: str = Field(min_length=1, max_length=128)
    note: str = Field(default='', max_length=500)


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def revision(metric):
    return _hash([metric.id, metric.revision, metric.published_version, metric.draft])


async def _metric(db, tenant_id, metric_id):
    metric = await db.scalar(select(AnalyticsSharedMetric).where(
        AnalyticsSharedMetric.tenant_id == tenant_id, AnalyticsSharedMetric.id == metric_id))
    if metric is None:
        raise HTTPException(404, '共享指标不存在')
    return metric


async def _source(db, tenant_id, source):
    condition = Form.id == int(source) if str(source).isdigit() else Form.code == source
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, condition))
    if form is None:
        raise HTTPException(422, '指标来源表单不存在或不属于当前租户')
    return form


async def normalize_definition(db, tenant_id, body: SharedMetricDefinition):
    source = await _source(db, tenant_id, body.source)
    fields = [field for field in await runtime_fields(db, source) if not field.archived]
    try:
        root = parse_expression(body.expression, {field.field_name for field in fields})
    except AnalyticsError as exc:
        raise HTTPException(422, str(exc)) from exc
    functions = {id(node.func) for node in ast.walk(root) if isinstance(node, ast.Call)}
    names = {node.id for node in ast.walk(root) if isinstance(node, ast.Name) and id(node) not in functions}
    numeric = lambda field: bool(re.search(r'number|int|float|decimal|numeric|double|currency', field.field_type))
    definition = body.model_dump()
    definition.update(source=source.code, sourceFormId=source.id, sourceName=source.name,
        dimensions=[field.field_name for field in fields if field.field_name in names and not numeric(field)],
        measures=[field.field_name for field in fields if field.field_name in names and numeric(field)])
    return definition


async def metric_payload(db, metric, *, history=False):
    versions = (await db.scalars(select(AnalyticsSharedMetricVersion).where(
        AnalyticsSharedMetricVersion.tenant_id == metric.tenant_id,
        AnalyticsSharedMetricVersion.metric_id == metric.id).order_by(AnalyticsSharedMetricVersion.version.desc()))).all()
    published = next((item for item in versions if item.version == metric.published_version), None)
    result = {'id': metric.id, 'draft': copy.deepcopy(metric.draft),
        'published': copy.deepcopy(published.definition) if published else None,
        'publishedVersion': metric.published_version, 'revision': revision(metric),
        'updatedAt': metric.updated_at.isoformat() if metric.updated_at else None}
    if history:
        result['versions'] = [{'version': item.version, 'definition': copy.deepcopy(item.definition),
            'publishedAt': item.published_at.isoformat(), 'note': item.note} for item in versions]
    return result


async def list_metrics(db, user):
    rows = (await db.scalars(select(AnalyticsSharedMetric).where(
        AnalyticsSharedMetric.tenant_id == current_tenant_id(user)).order_by(AnalyticsSharedMetric.updated_at.desc(), AnalyticsSharedMetric.id))).all()
    return {'items': [await metric_payload(db, row) for row in rows]}


async def get_metric(db, user, metric_id):
    return await metric_payload(db, await _metric(db, current_tenant_id(user), metric_id), history=True)


async def create_metric(db, user, body):
    tenant_id = current_tenant_id(user)
    await lock(db, tenant_id)
    definition = await normalize_definition(db, tenant_id, body)
    row = AnalyticsSharedMetric(id=str(uuid.uuid4()), tenant_id=tenant_id, draft=definition,
        revision=1, published_version=0, created_by=current_user_id(user))
    db.add(row)
    await change_audit(db, tenant_id=tenant_id, user_id=current_user_id(user), action='create',
        resource_type='analytics_shared_metric', new_values={'metricId': row.id, 'definition': definition})
    await db.commit()
    await db.refresh(row)
    return await metric_payload(db, row, history=True)


async def save_metric(db, user, metric_id, body):
    tenant_id = current_tenant_id(user)
    await lock(db, tenant_id)
    row = await _metric(db, tenant_id, metric_id)
    await db.refresh(row)
    if revision(row) != body.expectedRevision:
        raise HTTPException(409, '指标已被其他编辑更新，请重新加载后再保存')
    definition = await normalize_definition(db, tenant_id, body.definition)
    row.draft = definition
    row.revision += 1
    await change_audit(db, tenant_id=tenant_id, user_id=current_user_id(user), action='save_draft',
        resource_type='analytics_shared_metric', new_values={'metricId': row.id, 'definition': definition})
    await db.commit()
    await db.refresh(row)
    return await metric_payload(db, row, history=True)


def _matches_source(dataset, definition):
    return dataset.get('sourceType') == 'businessForm' and str(dataset.get('source')) in {
        definition['source'], str(definition['sourceFormId'])}


def bind_definition(metric, definition, shared_id, version):
    return {key: copy.deepcopy(definition.get(key, '')) for key in METRIC_FIELDS} | {
        'id': metric['id'], 'datasetId': metric.get('datasetId'),
        'sharedMetricId': shared_id, 'sharedMetricVersion': version}


async def hydrate_design(db, tenant_id, design, *, require_current=False):
    """Resolve immutable definitions; a client cannot override a shared formula."""
    refs = [item for item in design.get('metrics') or [] if item.get('sharedMetricId')]
    if not refs:
        return copy.deepcopy(design), []
    ids = {item['sharedMetricId'] for item in refs if isinstance(item.get('sharedMetricId'), str)}
    versions = (await db.scalars(select(AnalyticsSharedMetricVersion).where(
        AnalyticsSharedMetricVersion.tenant_id == tenant_id, AnalyticsSharedMetricVersion.metric_id.in_(ids)))).all()
    lookup = {(item.metric_id, item.version): item.definition for item in versions}
    current = dict((await db.execute(select(AnalyticsSharedMetric.id, AnalyticsSharedMetric.published_version).where(
        AnalyticsSharedMetric.tenant_id == tenant_id, AnalyticsSharedMetric.id.in_(ids)))).all())
    result, errors = copy.deepcopy(design), []
    datasets = {item['id']: item for item in result.get('datasets') or []}
    for index, metric in enumerate(result.get('metrics') or []):
        shared_id = metric.get('sharedMetricId')
        if not shared_id:
            continue
        number = metric.get('sharedMetricVersion')
        definition = lookup.get((shared_id, number)) if isinstance(shared_id, str) and type(number) is int else None
        dataset = datasets.get(metric.get('datasetId'))
        error = None
        if definition is None:
            error = '共享指标版本不存在或不可用'
        elif require_current and current.get(shared_id) != number:
            error = '共享指标已更新，请从指标库重新引用最新版本'
        elif not dataset or not _matches_source(dataset, definition):
            error = '共享指标与组件数据集来源不一致'
        elif not set(definition['dimensions'] + definition['measures']).issubset(set((dataset.get('dimensions') or []) + (dataset.get('measures') or []))):
            error = '数据集缺少共享指标所需字段，请重新引用指标'
        if error:
            errors.append(f'指标「{metric.get("name") or metric.get("id")}」：{error}')
            metric['expression'] = '0 / 0'  # Fail closed, never execute a forged local formula.
        else:
            result['metrics'][index] = bind_definition(metric, definition, shared_id, number)
    return result, errors


def _references(design, shared_id):
    if not isinstance(design, dict):
        return [], []
    values = design.get('metrics')
    if not isinstance(values, list):
        return [], []
    metrics = [item for item in values if isinstance(item, dict) and item.get('sharedMetricId') == shared_id and item.get('id')]
    ids = {item['id'] for item in metrics}
    widgets = [{'id': item['id'], 'title': item.get('title') or item['id'], 'type': item.get('type')}
        for item in (design.get('widgets') if isinstance(design.get('widgets'), list) else [])
        if isinstance(item, dict) and item.get('id') and isinstance(item.get('metricIds'), list) and any(isinstance(value, str) and value in ids for value in item['metricIds'])]
    return metrics, widgets


def patch_references(design, shared_id, number, definition):
    result = copy.deepcopy(design)
    datasets = {item['id']: item for item in result.get('datasets') or []}
    for index, metric in enumerate(result.get('metrics') or []):
        if metric.get('sharedMetricId') != shared_id:
            continue
        dataset = datasets.get(metric.get('datasetId'))
        if not dataset or not _matches_source(dataset, definition):
            raise HTTPException(422, '共享指标来源变更与引用看板的数据集不兼容')
        for key in ('dimensions', 'measures'):
            dataset[key] = list(dict.fromkeys((dataset.get(key) or []) + definition[key]))
        result['metrics'][index] = bind_definition(metric, definition, shared_id, number)
    return result


async def _reference_rows(db, tenant_id, shared_id):
    forms = (await db.scalars(select(Form).where(Form.tenant_id == tenant_id).order_by(Form.id).execution_options(populate_existing=True))).all()
    latest = select(FormVersion.form_id, func.max(FormVersion.version).label('number')).where(
        FormVersion.tenant_id == tenant_id, FormVersion.status.in_(['published', 'active'])).group_by(FormVersion.form_id).subquery()
    versions = (await db.scalars(select(FormVersion).join(latest,
        (FormVersion.form_id == latest.c.form_id) & (FormVersion.version == latest.c.number)).where(
        FormVersion.tenant_id == tenant_id).execution_options(populate_existing=True))).all()
    by_form = {item.form_id: item for item in versions}
    rows, references, signatures = [], [], []
    for form in forms:
        version = by_form.get(form.id)
        config = form.config or {}
        live_config = (((version.snapshot or {}).get('form') or {}).get('config') or {}) if version else config
        states = []
        for state, design in [('published', live_config.get('analyticsDesign')), ('draft', config.get('analyticsDesignDraft'))]:
            metrics, widgets = _references(design, shared_id)
            if metrics:
                references.append({'formId': form.id, 'programId': form.code, 'boardName': form.name,
                    'state': state, 'version': version.version if state == 'published' and version else None,
                    'widgets': widgets, 'metricCount': len(metrics)})
                states.append((state, design))
        if states:
            rows.append((form, version, states))
            signatures.append([form.id, config, version.id if version else None])
    counts = {f'{state}Boards': len({item['formId'] for item in references if item['state'] == state}) for state in ('published', 'draft')}
    counts.update({f'{state}Charts': sum(len(item['widgets']) for item in references if item['state'] == state) for state in ('published', 'draft')})
    return rows, {'references': references, 'counts': counts}, signatures


async def references(db, user, metric_id):
    tenant_id = current_tenant_id(user)
    await _metric(db, tenant_id, metric_id)
    _, result, _ = await _reference_rows(db, tenant_id, metric_id)
    return result


async def impact(db, user, metric_id, body, *, include_plan=False):
    from app.services.analytics_data import load_data
    from app.services.analytics_editor import _legacy_runtime_snapshot
    tenant_id = current_tenant_id(user)
    row = await _metric(db, tenant_id, metric_id)
    await db.refresh(row)
    if revision(row) != body.expectedRevision:
        raise HTTPException(409, '指标已更新，请重新加载后检查影响')
    definition = await normalize_definition(db, tenant_id, body.definition)
    current = await db.scalar(select(AnalyticsSharedMetricVersion).where(
        AnalyticsSharedMetricVersion.tenant_id == tenant_id, AnalyticsSharedMetricVersion.metric_id == row.id,
        AnalyticsSharedMetricVersion.version == row.published_version))
    rows, result, signatures = await _reference_rows(db, tenant_id, row.id)
    number, errors, plan = row.published_version + 1, [], []
    for form, version, states in rows:
        board_plan = {'form': form, 'version': version}
        for state, design in states:
            try:
                canonical, ref_errors = await hydrate_design(db, tenant_id, design)
                updated = patch_references(canonical, row.id, number, definition)
                if state == 'published':
                    snapshot = copy.deepcopy(version.snapshot) if version else await _legacy_runtime_snapshot(db, form)
                    board_errors = ref_errors + design_errors(updated)
                    board_errors += await source_errors(db, tenant_id, form, updated, snapshot.get('fields') or [])
                    if not board_errors:
                        board_errors += (await load_data(db, tenant_id, form, updated, user=user, resolve_shared=False))['errors']
                    if board_errors:
                        errors.extend(f'{form.name}：{error}' for error in board_errors)
                    board_plan.update(published=updated, snapshot=snapshot)
                else:
                    board_plan['draft'] = updated
            except HTTPException as exc:
                errors.append(f'{form.name}（{"线上" if state == "published" else "草稿"}）：{exc.detail}')
        plan.append(board_plan)
    unchanged = bool(current and current.definition == definition)
    result.update(definition=definition, nextVersion=number, unchanged=unchanged, errors=list(dict.fromkeys(errors)),
        impactToken=_hash([revision(row), definition, signatures]))
    if include_plan:
        return row, result, plan
    return result


async def publish_metric(db, user, metric_id, body):
    tenant_id = current_tenant_id(user)
    await lock(db, tenant_id)
    row, checked, plan = await impact(db, user, metric_id, body, include_plan=True)
    if checked['impactToken'] != body.impactToken:
        raise HTTPException(409, '引用关系或看板配置已变化，请重新检查影响后发布')
    if checked['errors']:
        raise HTTPException(422, {'message': '共享指标发布检查未通过', 'errors': checked['errors']})
    if checked['unchanged']:
        raise HTTPException(409, '指标口径与已发布版本一致，无需重复发布')
    now, definition, number = datetime.now(), checked['definition'], checked['nextVersion']
    timestamp = now.isoformat()
    published_boards = []
    try:
        for item in plan:
            form, previous = item['form'], item['version']
            config = copy.deepcopy(form.config or {})
            if 'draft' in item:
                config['analyticsDesignDraft'] = item['draft']
            meta = copy.deepcopy(config.get('analyticsDesignMeta') or {})
            if 'published' in item:
                snapshot = copy.deepcopy(item['snapshot'])
                if previous is None:
                    db.add(FormVersion(tenant_id=tenant_id, form_id=form.id, version=1, status='published',
                        snapshot=copy.deepcopy(snapshot), impact_report={'scope': 'analytics', 'note': '共享指标更新前的看板基线'},
                        published_by=current_user_id(user), published_at=now))
                board_version = previous.version + 1 if previous else 2
                config.update(analyticsDesign=item['published'], publishedSchemaVersion=board_version, publishedAt=timestamp)
                meta.update(publishedVersion=board_version, publishedAt=timestamp, managedBy='analytics-editor')
                frozen_meta = {**meta, 'status': 'published'}
                snapshot['form']['config'].update(analyticsDesign=copy.deepcopy(item['published']),
                    analyticsDesignDraft=copy.deepcopy(item['published']), analyticsDesignMeta=frozen_meta,
                    publishedSchemaVersion=board_version, publishedAt=timestamp)
                note = f'共享指标「{definition["name"]}」更新至 v{number}'
                db.add(FormVersion(tenant_id=tenant_id, form_id=form.id, version=board_version, status='published',
                    snapshot=snapshot, impact_report={'scope': 'analytics', 'note': note, 'sharedMetricId': row.id,
                        'sharedMetricVersion': number}, published_by=current_user_id(user), published_at=now))
                published_boards.append({'programId': form.code, 'version': board_version})
            if 'draft' in item:
                meta.update(draftSavedAt=timestamp, draftVersion=int(meta.get('draftVersion') or 0) + 1)
            meta['managedBy'] = 'analytics-editor'
            meta['status'] = 'draft' if config.get('analyticsDesignDraft', config.get('analyticsDesign')) != config.get('analyticsDesign') else 'published'
            config['analyticsDesignMeta'] = meta
            form.config = config
            await change_audit(db, tenant_id=tenant_id, user_id=current_user_id(user), action='shared_metric_update',
                resource_type='form_analytics', resource_id=form.id,
                new_values={'metricId': row.id, 'metricVersion': number, 'publishedVersion': meta.get('publishedVersion')})
        db.add(AnalyticsSharedMetricVersion(tenant_id=tenant_id, metric_id=row.id, version=number,
            definition=copy.deepcopy(definition), note=body.note.strip() or None,
            published_by=current_user_id(user), published_at=now))
        row.draft, row.published_version, row.revision = copy.deepcopy(definition), number, row.revision + 1
        await change_audit(db, tenant_id=tenant_id, user_id=current_user_id(user), action='publish',
            resource_type='analytics_shared_metric', new_values={'metricId': row.id, 'version': number,
                'definition': definition, 'impact': checked['counts'], 'boards': published_boards})
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(row)
    return {**await metric_payload(db, row, history=True), 'updatedBoards': published_boards, 'impact': checked['counts']}
