"""Dashboard drafts and atomic publication without publishing unrelated form drafts."""
from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, func, select

from app.api.deps import current_tenant_id, current_user_id
from app.models.relational import Form, FormVersion, User
from app.services.analytics_dataset_range import validate_range
from app.services.analytics_data import load_data
from app.services.analytics_runtime import design_errors, source_errors
from app.services.field_uniqueness import lock
from app.services.form_runtime import _latest_form_version
from app.services.records import change_audit


class AnalyticsDesignRequest(BaseModel):
    design: dict

    @field_validator('design')
    @classmethod
    def check_shape(cls, value):
        # Drafts may be incomplete, but malformed/unbounded structures must never
        # reach the expression and chart evaluators.
        try:
            if len(json.dumps(value, ensure_ascii=False, allow_nan=False)) > 262144:
                raise ValueError('看板配置不能超过 256 KB')
            for key in ('datasets', 'metrics', 'widgets', 'interactions'):
                items = value.get(key, [])
                if not isinstance(items, list) or len(items) > 100 or any(not isinstance(item, dict) for item in items):
                    raise ValueError(f'{key} 必须是最多 100 项的数组')
                for item in items:
                    if key != 'interactions' and (not isinstance(item.get('id'), str) or not 1 <= len(item['id']) <= 200):
                        raise ValueError(f'{key} 中每项必须有字符串 ID')
                    for name in ('datasetId', 'source', 'sourceType', 'refreshMode', 'type', 'dimension', 'format', 'expression', 'description', 'unit', 'sharedMetricId', 'sourceWidgetId', 'targetWidgetId', 'action'):
                        if name in item and not isinstance(item[name], str):
                            raise ValueError(f'{name} 必须是字符串')
                    if 'sharedMetricVersion' in item and (type(item['sharedMetricVersion']) is not int or item['sharedMetricVersion'] < 1):
                        raise ValueError('共享指标版本必须是正整数')
                    if key == 'datasets':
                        validate_range(item.get('rangeFilters', []))
                    for name in ('dimensions', 'measures', 'metricIds'):
                        if name in item and (not isinstance(item[name], list) or len(item[name]) > 200 or any(not isinstance(part, str) or len(part) > 200 for part in item[name])):
                            raise ValueError(f'{name} 必须是字段名称数组')
            filters = value.get('globalFilters', [])
            if not isinstance(filters, list) or len(filters) > 50 or any(not isinstance(item, str) for item in filters):
                raise ValueError('全局筛选必须是字段名称数组')
        except (TypeError, OverflowError, RecursionError) as exc:
            raise ValueError('看板配置格式无效') from exc
        return value


class AnalyticsPreviewRequest(AnalyticsDesignRequest):
    filters: dict = Field(default_factory=dict)
    widget_filters: dict = Field(default_factory=dict)
    limit: int = Field(default=500, ge=1, le=1000)


class AnalyticsWriteRequest(AnalyticsDesignRequest):
    expectedRevision: str = Field(min_length=1, max_length=128)
    note: str | None = Field(default=None, max_length=500)

    @field_validator('note')
    @classmethod
    def clean_note(cls, value):
        if value is None:
            return None
        return value.strip() or None


async def find_form(db, user, program_id):
    form = await db.scalar(select(Form).where(Form.tenant_id == current_tenant_id(user), Form.code == program_id))
    if form is None:
        raise HTTPException(404, '看板表单不存在')
    return form


def editor_payload(form, version):
    config = form.config or {}
    published_config = (((version.snapshot or {}).get('form') or {}).get('config') or {}) if version else config
    published = published_config.get('analyticsDesign')
    design = config.get('analyticsDesignDraft')
    if not isinstance(design, dict):
        design = published if isinstance(published, dict) else {'datasets': [], 'metrics': [], 'widgets': [], 'interactions': [], 'globalFilters': []}
    state = {'draft': config.get('analyticsDesignDraft'), 'published': config.get('analyticsDesign'),
             'meta': config.get('analyticsDesignMeta'), 'version': version.version if version else None,
             'versionId': version.id if version else None, 'publishedSnapshot': published}
    revision = hashlib.sha256(json.dumps(state, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    return {'formId': form.id, 'design': copy.deepcopy(design), 'publishedDesign': copy.deepcopy(published),
            'revision': revision, 'publishedVersion': version.version if version else None,
            'publishedAt': version.published_at.isoformat() if version and version.published_at else
                (published_config.get('analyticsDesignMeta') or {}).get('publishedAt') or published_config.get('publishedAt'),
            'draftSavedAt': (config.get('analyticsDesignMeta') or {}).get('draftSavedAt')}


async def get_editor(db, user, program_id):
    form = await find_form(db, user, program_id)
    return editor_payload(form, await _latest_form_version(db, form.tenant_id, form.id))


def _history_selection(db, form):
    # Project only the analytics branch. Full form snapshots can include field,
    # action and permission configuration unrelated to this editor.
    design = FormVersion.snapshot['form']['config']['analyticsDesign']
    json_type = func.json_typeof(design) if db.get_bind().dialect.name == 'postgresql' else func.json_type(design)
    conditions = (FormVersion.tenant_id == form.tenant_id, FormVersion.form_id == form.id,
                  FormVersion.status.in_(['published', 'active']), json_type == 'object')
    query = select(FormVersion.version, FormVersion.published_at, FormVersion.published_by,
                   FormVersion.impact_report, design.label('design'), User.display_name, User.username).select_from(FormVersion)
    query = query.outerjoin(User, and_(User.id == FormVersion.published_by, User.tenant_id == form.tenant_id))
    return query.where(*conditions), conditions


def _history_payload(row, current_version, *, include_design=False):
    report = row.impact_report if isinstance(row.impact_report, dict) else {}
    note = report.get('note')
    payload = {'version': row.version, 'publishedAt': row.published_at.isoformat() if row.published_at else None,
               'publishedBy': row.published_by, 'publishedByName': row.display_name or row.username,
               'scope': 'analytics' if report.get('scope') == 'analytics' else 'form',
               'note': note[:500] if isinstance(note, str) else None,
               'summary': {key: len(row.design.get(key)) if isinstance(row.design.get(key), list) else 0
                           for key in ('widgets', 'datasets', 'metrics')},
               'current': row.version == current_version}
    if include_design:
        payload['design'] = copy.deepcopy(row.design)
    return payload


async def _current_version_number(db, form):
    return await db.scalar(select(func.max(FormVersion.version)).where(
        FormVersion.tenant_id == form.tenant_id, FormVersion.form_id == form.id,
        FormVersion.status.in_(['published', 'active'])))


async def list_versions(db, user, program_id, *, limit=20, offset=0):
    form = await find_form(db, user, program_id)
    query, conditions = _history_selection(db, form)
    total = await db.scalar(select(func.count()).select_from(FormVersion).where(*conditions))
    rows = (await db.execute(query.order_by(FormVersion.version.desc()).limit(limit).offset(offset))).all()
    current_version = await _current_version_number(db, form)
    return {'items': [_history_payload(row, current_version) for row in rows], 'total': total}


async def get_version(db, user, program_id, version_number):
    form = await find_form(db, user, program_id)
    query, _ = _history_selection(db, form)
    row = (await db.execute(query.where(FormVersion.version == version_number))).first()
    if row is None:
        raise HTTPException(404, '看板版本不存在')
    return _history_payload(row, await _current_version_number(db, form), include_design=True)


async def preview(db, user, program_id, body):
    form = await find_form(db, user, program_id)
    data = await load_data(db, form.tenant_id, form, body.design, user=user,
                           filters=body.filters, widget_filters=body.widget_filters, limit=body.limit)
    return {'analyticsDesign': body.design, 'analyticsData': data, 'analyticsDesignState': 'draft'}


def _published_config_baseline(config):
    """Keep effective config values; never turn a draft key into a live key."""
    result = copy.deepcopy(config or {})
    for key in list(result):
        if key.endswith('Draft') or key.startswith('draft'):
            result.pop(key)
    for key in ('workflowDesigner', 'viewConfigMeta', 'permissionDesignMeta'):
        if not isinstance(result.get(key), dict):
            continue
        result[key] = {name: value for name, value in result[key].items() if not name.startswith('draft')}
        if result[key].get('status') == 'draft':
            result[key].pop('status')
    return result


async def _legacy_runtime_snapshot(db, form):
    """Freeze what an unversioned board already reads, without designer promotion.

    Without a FormVersion, runtime_fields reads FormField directly. Permissions,
    actions and workflow bindings likewise use their current database rows. In
    particular, _form_snapshot is unsuitable here: it applies designer controls
    and draft view columns to those raw fields as part of a full form publish.
    """
    from app.api.forms import (_form_payload, _field_payload, _layout_payload,
                               _action_payload, _permission_payload, _workflow_binding_payload)
    from app.models.relational import FormAction, FormLayout, FormPermission, WorkflowBinding
    from app.services.records import runtime_fields

    snapshot = {'form': _form_payload(form),
                'fields': [_field_payload(field) for field in await runtime_fields(db, form)]}
    snapshot['form']['config'] = _published_config_baseline(form.config)
    for key, model, serializer, order in (
        ('layouts', FormLayout, _layout_payload, (FormLayout.layout_type,)),
        ('actions', FormAction, _action_payload, (FormAction.sort_order, FormAction.id)),
        ('permissions', FormPermission, _permission_payload, (FormPermission.id,)),
        ('workflow_bindings', WorkflowBinding, _workflow_binding_payload, (WorkflowBinding.id,)),
    ):
        rows = (await db.scalars(select(model).where(model.tenant_id == form.tenant_id,
            model.form_id == form.id).order_by(*order))).all()
        snapshot[key] = [serializer(row) for row in rows]
    # Layout envelopes can carry both states; keep only the published branch in
    # history while leaving the live FormLayout row (including its draft) intact.
    for layout in snapshot['layouts']:
        if isinstance(layout.get('config'), dict) and 'draft' in layout['config']:
            layout['config'] = {key: copy.deepcopy(value) for key, value in layout['config'].items() if key != 'draft'}
    return snapshot


async def write_design(db, user, program_id, body, *, publish=False):
    tenant_id = current_tenant_id(user)
    await lock(db, tenant_id)
    form = await find_form(db, user, program_id)
    await db.refresh(form)  # Reload after the lock, including a concurrent legacy editor save.
    version = await _latest_form_version(db, tenant_id, form.id)
    previous = editor_payload(form, version)
    if body.expectedRevision != previous['revision']:
        raise HTTPException(409, '看板已被其他编辑更新，请重新加载后再保存')
    from app.services.analytics_metric_library import hydrate_design
    body.design, shared_errors = await hydrate_design(db, tenant_id, body.design, require_current=True)
    if shared_errors:
        raise HTTPException(422, {'message': '共享指标引用校验失败', 'errors': shared_errors})
    if publish and version is None and not isinstance((form.config or {}).get('analyticsDesign'), dict):
        raise HTTPException(409, '请先在表单设置中完成首次发布，再单独发布看板；当前草稿尚未发布')

    now = datetime.now()
    timestamp = now.isoformat()
    config = copy.deepcopy(form.config or {})
    config['analyticsDesignDraft'] = copy.deepcopy(body.design)
    meta = {**(config.get('analyticsDesignMeta') or {}), 'draftSavedAt': timestamp,
            'managedBy': 'analytics-editor',
            'draftVersion': int((config.get('analyticsDesignMeta') or {}).get('draftVersion') or 0) + 1,
            'status': 'draft'}
    if publish:
        # A legacy board already serves live analytics without version history.
        # Start its history from the actual runtime, not a full-form draft publish.
        snapshot = copy.deepcopy(version.snapshot) if version else await _legacy_runtime_snapshot(db, form)
        # Once versioned, self-source metadata remains the published schema.
        errors = design_errors(body.design)
        errors += await source_errors(db, tenant_id, form, body.design, snapshot.get('fields') or [])
        if not errors:
            data = await load_data(db, tenant_id, form, body.design, user=user)
            errors += data['errors']
        if errors:
            raise HTTPException(422, {'message': '看板配置校验失败', 'errors': list(dict.fromkeys(errors))})
        next_version = version.version + 1 if version else 1
        meta.update(publishedVersion=next_version, publishedAt=timestamp, status='published')
        config['analyticsDesign'] = copy.deepcopy(body.design)
        config['publishedSchemaVersion'] = next_version
        config['publishedAt'] = timestamp
        published_config = copy.deepcopy(snapshot['form'].get('config') or {})
        snapshot['form']['config'] = published_config
        published_config.update(analyticsDesign=copy.deepcopy(body.design), analyticsDesignDraft=copy.deepcopy(body.design),
                                analyticsDesignMeta=copy.deepcopy(meta), publishedSchemaVersion=next_version, publishedAt=timestamp)
        report = {'scope': 'analytics', 'latest_version': version.version if version else None, 'next_version': next_version,
                  'blocking_count': 0, 'warning_count': 0, 'items': [], 'summary': '仅发布看板配置，其他表单草稿保持不变',
                  'note': body.note}
        version = FormVersion(tenant_id=tenant_id, form_id=form.id, version=next_version, status='published',
                              snapshot=snapshot, impact_report=report, published_by=current_user_id(user), published_at=now)
        db.add(version)
    config['analyticsDesignMeta'] = meta
    form.config = config
    await change_audit(db, tenant_id=tenant_id, user_id=current_user_id(user),
                       action='publish' if publish else 'save_draft', resource_type='form_analytics', resource_id=form.id,
                       old_values={'revision': previous['revision']},
                       new_values={'version': version.version if version else None, 'design': body.design})
    await db.commit()
    return editor_payload(form, version)
