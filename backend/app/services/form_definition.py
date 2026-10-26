"""Shared form definition contracts for HTTP and tool callers."""
from __future__ import annotations
import json
import copy
from typing import Optional
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api._model_driven_shared import assert_safe_identifier
from app.core.permissions import has_form_permission
from app.api.form_engine import _field_allowed_values, _field_value_is_compatible, _is_anonymous_reader
from app.services.form_runtime import _latest_form_version, _field_proxy_from_payload




INITIAL_FORM_VERSION = 1


def _uid(user: dict) -> Optional[int]:
    uid = user.get("uid")
    return int(uid) if isinstance(uid, int) and uid > 0 else None


async def _ensure_form_permission(
    db: AsyncSession,
    user: dict,
    form_id: int,
    action: str,
) -> None:
    if action == "view" and _is_anonymous_reader(user):
        return
    if not await has_form_permission(user, form_id, action, db):
        raise HTTPException(403, "Form permission denied")


def _validate_field_name(field_name: str) -> None:
    assert_safe_identifier(field_name)


FIELD_TYPE_ALIASES = {
    "string": "string",
    "text": "text",
    "longText": "text",
    "long_text": "text",
    "number": "number",
    "integer": "integer",
    "int": "integer",
    "decimal": "decimal",
    "float": "float",
    "boolean": "boolean",
    "bool": "boolean",
    "date": "date",
    "datetime": "datetime",
    "enum": "enum",
    "select": "enum",
    "person": "string",
    "relation": "relation",
    "attachment": "json",
    "json": "json",
    "code": "string",
}


def _normalize_field_type(field_type: Optional[str]) -> str:
    raw = (field_type or "string").strip()
    normalized = FIELD_TYPE_ALIASES.get(raw, FIELD_TYPE_ALIASES.get(raw.lower()))
    if normalized:
        return normalized
    raise HTTPException(422, f"Unsupported field_type: {field_type}")


def _normalize_form_field_data(
    data: dict,
    *,
    current_field_type: Optional[str] = None,
    current_ui_config: Optional[dict] = None,
) -> dict:
    normalized = dict(data)
    business_type = normalized.pop("business_type", None)
    control_type = normalized.pop("control_type", None)
    data_source = normalized.pop("data_source", None)
    encoding_rule = normalized.pop("encoding_rule", None)
    ui_config_input = normalized.pop("ui_config", None)

    explicit_type = normalized.get("field_type")
    effective_type = _normalize_field_type(explicit_type or current_field_type)
    if explicit_type is not None or current_field_type is None:
        normalized["field_type"] = effective_type

    validation = normalized.get("validation")
    if isinstance(validation, dict) and "maxBytes" in validation:
        limit = validation["maxBytes"]
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1073741823:
            raise HTTPException(422, "字段字节上限必须为 1 至 1073741823 之间的整数")
        if effective_type not in {"string", "text", "enum", "code"}:
            raise HTTPException(422, "此字段类型不支持文本字节上限")

    ui_config = dict(current_ui_config or {})
    ui_config_touched = False
    if ui_config_input is not None:
        ui_config.update(ui_config_input or {})
        ui_config_touched = True
    if control_type is not None:
        ui_config["controlType"] = control_type
        ui_config_touched = True
    if data_source is not None:
        ui_config["dataSource"] = data_source
        ui_config_touched = True
    if business_type is not None:
        ui_config["businessType"] = business_type
        ui_config_touched = True

    ui_config_adds_encoding = isinstance(ui_config_input, dict) and "encodingRule" in ui_config_input
    uses_encoding = (
        business_type == "code"
        or control_type == "code"
        or ui_config.get("businessType") == "code"
        or ui_config.get("controlType") == "code"
        or encoding_rule is not None
        or ui_config_adds_encoding
    )
    if uses_encoding:
        ui_config["businessType"] = "code"
        ui_config["controlType"] = ui_config.get("controlType") or "code"
        if encoding_rule is not None:
            ui_config["encodingRule"] = encoding_rule
            ui_config_touched = True
        elif ui_config.get("autoNumber") and not ui_config.get("encodingRule"):
            ui_config["encodingRule"] = {"enabled": True, "template": ui_config["autoNumber"]}
            ui_config_touched = True
        ui_config_touched = True
    elif business_type is not None or control_type is not None:
        ui_config.pop("encodingRule", None)
        ui_config.pop("autoNumber", None)
        ui_config_touched = True

    if ui_config_touched:
        normalized["ui_config"] = ui_config or None
    return normalized


def _form_payload(form, *, fields: Optional[list] = None, applications: Optional[list] = None) -> dict:
    config = form.config or {}
    payload = {
        "id": form.id,
        "tenant_id": getattr(form, "tenant_id", None),
        "name": form.name,
        "code": form.code,
        "description": form.description,
        "model_id": form.model_id,
        "table_name": form.table_name,
        "storage_mode": form.storage_mode,
        "status": form.status,
        "owner_id": form.owner_id,
        "config": config,
        "permission_design": _permission_design_from_config(config),
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
    }
    if fields is not None:
        payload["fields"] = [_field_payload(field) for field in fields]
    if applications is not None:
        payload["applications"] = applications
    return payload


def _field_payload(field) -> dict:
    ui_config = field.ui_config or {}
    legacy_code_field = field.field_type == "code"
    storage_type = "string" if legacy_code_field else field.field_type
    business_type = ui_config.get("businessType") or ("code" if legacy_code_field or ui_config.get("encodingRule") else storage_type)
    control_type = ui_config.get("controlType") or ("code" if business_type == "code" else None)
    return {
        "id": field.id,
        "form_id": field.form_id,
        "meta_field_id": field.meta_field_id,
        "field_name": field.field_name,
        "label": field.label,
        "field_type": storage_type,
        "business_type": business_type,
        "control_type": control_type,
        "data_source": ui_config.get("dataSource") or ui_config.get("relation"),
        "encoding_rule": ui_config.get("encodingRule"),
        "required": field.required,
        "visible_in_list": field.visible_in_list,
        "visible_in_form": field.visible_in_form,
        "searchable": field.searchable,
        "sortable": field.sortable,
        "archived": field.archived,
        "default_value": field.default_value,
        "enum_values": field.enum_values,
        "validation": field.validation,
        "ui_config": ui_config,
        "sort_order": field.sort_order,
    }


def _permission_design_from_config(config: Optional[dict]) -> dict:
    permission_design = (config or {}).get("permissionDesign")
    return permission_design if isinstance(permission_design, dict) else {}


def _form_version_payload(version) -> dict:
    return {
        "id": version.id,
        "tenant_id": getattr(version, "tenant_id", None),
        "form_id": version.form_id,
        "version": version.version,
        "status": version.status,
        "snapshot": version.snapshot or {},
        "impact_report": version.impact_report or {},
        "published_by": version.published_by,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "updated_at": version.updated_at.isoformat() if version.updated_at else None,
    }


def _field_cfg_value(field, key: str, default=None):
    return field.get(key, default) if isinstance(field, dict) else getattr(field, key, default)


def _field_cfg_name(field) -> str:
    return str(_field_cfg_value(field, "field_name") or "")


def _field_cfg_label(field) -> str:
    return str(_field_cfg_value(field, "label") or _field_cfg_name(field))


def _field_cfg_is_active(field) -> bool:
    return not bool(_field_cfg_value(field, "archived", False))


def _field_cfg_allowed_values(field) -> Optional[set[str]]:
    proxy = type("FieldProxy", (), {})()
    proxy.enum_values = _field_cfg_value(field, "enum_values")
    return _field_allowed_values(proxy)


def _field_cfg_value_is_compatible(field, value) -> bool:
    proxy = type("FieldProxy", (), {})()
    proxy.field_type = _field_cfg_value(field, "field_type", "string")
    proxy.enum_values = _field_cfg_value(field, "enum_values")
    proxy.validation = _field_cfg_value(field, "validation")
    return _field_value_is_compatible(proxy, value)


def _record_field_impact(rows: list[dict], field) -> dict:
    field_name = _field_cfg_name(field)
    required = bool(_field_cfg_value(field, "required", False))
    total = len(rows)
    filled = 0
    missing_required = 0
    incompatible = 0
    for row in rows:
        values = row or {}
        value = values.get(field_name)
        if value not in (None, ""):
            filled += 1
        if required and value in (None, ""):
            missing_required += 1
        if not _field_cfg_value_is_compatible(field, value):
            incompatible += 1
    return {
        "record_count": total,
        "filled_count": filled,
        "missing_required_count": missing_required,
        "incompatible_count": incompatible,
    }


def _apply_designer_field_settings(config: dict, fields: list[dict]) -> list[dict]:
    """Publish UI rules with the schema; never rewrite storage definitions.

    Explicit False must override legacy defaults. Draft storage metadata stays
    independent so saving a designer draft cannot affect the published runtime.
    """
    controls = config.get("formDesignerControls") or []
    controls_by_id = {item.get("id"): item for item in controls if isinstance(item, dict) and item.get("id")}
    controls_by_field = {item.get("fieldKey"): item for item in controls
                         if isinstance(item, dict) and item.get("fieldKey")}
    view = config.get("viewConfigDraft") or config.get("viewConfig") or {}
    views = view.get("tabs") if isinstance(view, dict) else None
    views = views if isinstance(views, list) and views else [view]
    column_lists = [(current.get("table") or {}).get("columns") for current in views if isinstance(current, dict)]
    has_column_config = any(isinstance(columns, list) for columns in column_lists)
    visible_columns = {item.get("fieldName") for columns in column_lists if isinstance(columns, list)
                       for item in columns if isinstance(item, dict) and item.get("enabled", True) is not False}
    sortable_columns={item.get('fieldName') for columns in column_lists if isinstance(columns,list) for item in columns if isinstance(item,dict) and item.get('enabled',True) and item.get('sortable')}
    result = []
    for original in fields:
        field = copy.deepcopy(original)
        control = controls_by_field.get(field.get("field_name"))
        if control:
            ui = dict(field.get('ui_config') or {})
            ui['rules'] = copy.deepcopy(control.get('rules') or {})
            ui['typeSettings'] = copy.deepcopy(control.get('typeSettings') or {})
            if 'computed' in control:
                if control['computed'] is None:
                    ui.pop('computed', None)
                else:
                    from app.services.form_calculations import validate_rule
                    validate_rule(control['computed'])
                    ui['computed'] = copy.deepcopy(control['computed'])
                    if control['computed'].get('precision') is None:
                        ui['typeSettings'].pop('precision', None)
                    else:
                        ui['typeSettings']['precision'] = control['computed']['precision']
            if 'defaultRule' in control:
                if not isinstance(control.get('defaultRule'), dict):
                    raise HTTPException(422, '默认值规则配置无效')
                if control['defaultRule'].get('mode') == 'template' or 'enabled' in control['defaultRule'] or control['defaultRule'].get('conditions'):
                    ui['defaultRule'] = copy.deepcopy(control['defaultRule'])
                else:
                    ui.pop('defaultRule', None)
            # Ignore storageMaxBytes in old control drafts: storage budgets
            # belong to schema policy, never to presentation settings.
            ui['placeholder'] = control.get('placeholder') or ''
            ui['helpText'] = control.get('helpText') or ''
            ui['label'] = control.get('name') or field.get('label')
            ancestors = []
            seen = {control.get('id')}
            parent = controls_by_id.get(control.get('parentId'))
            while parent and parent.get('id') not in seen:
                seen.add(parent.get('id'))
                ancestors.append(copy.deepcopy(parent.get('rules') or {}))
                parent = controls_by_id.get(parent.get('parentId'))
            ui['layoutAncestors'] = ancestors
            kind=control.get('controlType')
            if kind=='field':
                business=field.get('business_type') or ui.get('businessType')
                kind={'attachment':'upload','longText':'textarea','person':'relation','number':'number','date':'datetime','datetime':'datetime','enum':'select','code':'code','relation':'relation'}.get(business) or ui.get('controlType')
                if not kind or kind=='field': kind={'enum':'select','boolean':'switch','date':'datetime','datetime':'datetime','text':'textarea','int':'number','integer':'number','float':'number','decimal':'number','number':'number'}.get(field.get('field_type'),'text')
            if kind: ui['controlType']=kind
            if kind in {'select', 'relation'} and control.get('dataSourceKind') == 'static':
                ui['controlType'] = 'select'
            field['label'] = control.get('name') or field.get('label')
            if ui.get('controlType')=='select' and control.get('dataSourceKind','static')=='static' and 'optionSource' in control:
                from app.services.static_options import parse_options
                try:
                    choices = parse_options(control.get('optionSource'))
                except ValueError as exc:
                    raise HTTPException(422, str(exc))
                raw=field.get('enum_values') or {};current=raw.get('values',raw) if isinstance(raw,dict) else raw
                old=[str(item.get('value')) if isinstance(item,dict) else str(item) for item in current] if isinstance(current,list) else list(current) if isinstance(current,dict) else []
                # Preserve legacy labels when an unchanged old list is resaved.
                if str(control.get('optionSource') or '').lstrip().startswith('[') or choices!=old:
                    field['enum_values']={'values': choices}

            assignments = control.get('assignmentRules') or []
            ui['assignmentRules']=copy.deepcopy(assignments)
            ui['assignmentRulesEnabled'] = control.get('assignmentRulesEnabled', True)
            ref = {} if control.get('dataSourceKind') == 'static' else ui.get('relation_config') or {}
            if isinstance(ref, str):
                ref = json.loads(ref)
            if control.get('dataSourceKind') in {'masterData', 'businessForm', 'organization'} and control.get('optionSource'):
                source = control['optionSource']
                aliases = {'material_master': 'materials', 'supplier_master': 'suppliers'}
                ref.pop('target_form_code',None);ref.pop('target_table',None);ref.pop('source_kind',None);ref.pop('source_id',None);ref.pop('source_code',None)
                ref['target_model'] = aliases.get(source, source)
                ref['label_field']=control.get('referenceLabelField') or ref.get('label_field') or 'name'
            if control.get('dataSourceKind') in {'dictionary','externalApi'}:
                source_kind=control['dataSourceKind']
                ref={'source_kind':source_kind,'source_code':control.get('optionSource')} if source_kind=='dictionary' else {'source_kind':source_kind,'source_id':control.get('optionSource'),'items_path':control.get('referenceItemsPath','data'),'value_field':control.get('referenceValueField') or 'id','label_field':control.get('referenceLabelField') or 'name'}
                field['enum_values']=None  # The referenced source is authoritative, not old inline choices.
            if 'assignmentRules' in control and ref:
                ref['backfill'] = {
                    item['targetField']: item['sourceAttribute'].removeprefix('record.') for item in assignments if ui['assignmentRulesEnabled'] is not False
                    if item.get('targetField') and str(item.get('sourceAttribute','')).startswith('record.')}
            if control.get('dataSourceKind') == 'static':ui.pop('relation_config',None)
            if ref:
                ui['relation_config'] = ref
                ui['controlType']='relation'
            field['ui_config'] = ui
            required = (control.get("rules") or {}).get("required") or {}
            if isinstance(required, dict) and isinstance(required.get("enabled"), bool):
                field["required"] = required["enabled"] and all((parent.get("visible") or {}).get("enabled") is not False for parent in ancestors)
        if has_column_config:
            field["visible_in_list"] = field.get("field_name") in visible_columns
            field["sortable"] = field.get("field_name") in sortable_columns
        result.append(field)
    return result


async def _form_snapshot(db: AsyncSession, tenant_id: int, form) -> dict:
    from app.models.relational import FormAction, FormField, FormLayout, FormPermission, WorkflowBinding

    fields = (await db.execute(
        select(FormField).where(FormField.form_id == form.id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    layouts = (await db.execute(
        select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.tenant_id == tenant_id).order_by(FormLayout.layout_type)
    )).scalars().all()
    actions = (await db.execute(
        select(FormAction).where(FormAction.form_id == form.id, FormAction.tenant_id == tenant_id).order_by(FormAction.sort_order, FormAction.id)
    )).scalars().all()
    permissions = (await db.execute(
        select(FormPermission).where(FormPermission.form_id == form.id, FormPermission.tenant_id == tenant_id).order_by(FormPermission.id)
    )).scalars().all()
    bindings = (await db.execute(
        select(WorkflowBinding).where(WorkflowBinding.form_id == form.id, WorkflowBinding.tenant_id == tenant_id).order_by(WorkflowBinding.id)
    )).scalars().all()
    field_payloads = _apply_designer_field_settings(form.config or {}, [_field_payload(field) for field in fields])
    # Designer changes stay in the draft until this snapshot is published.
    controls = (form.config or {}).get("formDesignerControls") or []
    rules_by_field = {control.get("fieldKey"): control["encodingRule"] for control in controls
                      if isinstance(control, dict) and isinstance(control.get("encodingRule"), dict)}
    for field_payload in field_payloads:
        rule = rules_by_field.get(field_payload.get("field_name"))
        if rule is not None:
            field_payload["encoding_rule"] = rule
            field_payload["ui_config"] = {**(field_payload.get("ui_config") or {}), "encodingRule": rule}
    return {
        "form": _form_payload(form),
        "fields": field_payloads,
        "layouts": [_layout_payload(layout) for layout in layouts],
        "actions": [_action_payload(action) for action in actions],
        "permissions": [_permission_payload(permission) for permission in permissions],
        "workflow_bindings": [_workflow_binding_payload(binding) for binding in bindings],
    }


def _promote_snapshot_config(snapshot: dict, published_at: str, version: int) -> dict:
    promoted = {**snapshot}
    form_payload = {**(promoted.get("form") or {})}
    config = {**(form_payload.get("config") or {})}
    draft_view = config.get("viewConfigDraft")
    if draft_view is not None:
        config["viewConfig"] = draft_view
    if isinstance(config.get('permissionDesignDraft'),dict):config['permissionDesign']=copy.deepcopy(config['permissionDesignDraft'])
    draft_analytics = config.get("analyticsDesignDraft")
    if draft_analytics is not None:
        config["analyticsDesign"] = draft_analytics
        analytics_meta = {**(config.get("analyticsDesignMeta") or {})}
        analytics_meta.update(publishedVersion=version, publishedAt=published_at, status="published")
        config["analyticsDesignMeta"] = analytics_meta
    view_meta = {**(config.get("viewConfigMeta") or {})}
    if view_meta:
        view_meta["publishedVersion"] = version
        view_meta["publishedAt"] = published_at
        view_meta["status"] = "published"
        config["viewConfigMeta"] = view_meta
    config["publishedSchemaVersion"] = version
    config["publishedAt"] = published_at
    form_payload["status"] = "published"
    form_payload["config"] = config
    promoted["form"] = form_payload
    return promoted


def _publish_impact_report(latest_version, next_version: int, draft_snapshot: dict, record_rows: list[dict]) -> dict:
    previous_fields = {
        _field_cfg_name(field): field
        for field in ((latest_version.snapshot or {}).get("fields", []) if latest_version else [])
        if _field_cfg_name(field)
    }
    draft_fields = {
        _field_cfg_name(field): field
        for field in draft_snapshot.get("fields", [])
        if _field_cfg_name(field)
    }
    items: list[dict] = []

    for field_name, field in draft_fields.items():
        if not _field_cfg_is_active(field):
            continue
        previous = previous_fields.get(field_name)
        impact = _record_field_impact(record_rows, field)
        if previous is None:
            if _field_cfg_value(field, "required", False) and impact["missing_required_count"] > 0:
                items.append({
                    "level": "blocking",
                    "type": "new_required_field_missing",
                    "field_name": field_name,
                    "label": _field_cfg_label(field),
                    "detail": "New required field would make existing records invalid",
                    "affected_count": impact["missing_required_count"],
                })
            else:
                items.append({
                    "level": "info",
                    "type": "field_added",
                    "field_name": field_name,
                    "label": _field_cfg_label(field),
                    "detail": "Field will be available in the next published schema",
                    "affected_count": 0,
                })
            continue

        if _field_cfg_value(previous, "field_type") != _field_cfg_value(field, "field_type") and impact["incompatible_count"] > 0:
            items.append({
                "level": "blocking",
                "type": "field_type_incompatible",
                "field_name": field_name,
                "label": _field_cfg_label(field),
                "detail": "Type change is incompatible with existing record values",
                "affected_count": impact["incompatible_count"],
            })
        if not _field_cfg_value(previous, "required", False) and _field_cfg_value(field, "required", False) and impact["missing_required_count"] > 0:
            items.append({
                "level": "blocking",
                "type": "required_field_missing",
                "field_name": field_name,
                "label": _field_cfg_label(field),
                "detail": "Required change would make existing records invalid",
                "affected_count": impact["missing_required_count"],
            })

        old_allowed = _field_cfg_allowed_values(previous)
        new_allowed = _field_cfg_allowed_values(field)
        if old_allowed and new_allowed and not old_allowed.issubset(new_allowed):
            invalid = sum(1 for row in record_rows if row.get(field_name) not in (None, "") and str(row.get(field_name)) not in new_allowed)
            if invalid:
                items.append({
                    "level": "blocking",
                    "type": "enum_values_narrowed",
                    "field_name": field_name,
                    "label": _field_cfg_label(field),
                    "detail": "Enum choices no longer include values already used by records",
                    "affected_count": invalid,
                })

    for field_name, previous in previous_fields.items():
        draft = draft_fields.get(field_name)
        if draft is None or not _field_cfg_is_active(draft):
            filled = _record_field_impact(record_rows, previous)["filled_count"]
            if filled:
                items.append({
                    "level": "warning",
                    "type": "field_archived_with_data",
                    "field_name": field_name,
                    "label": _field_cfg_label(previous),
                    "detail": "Archived or removed field has historical values; data will be retained but hidden from new forms",
                    "affected_count": filled,
                })

    blocking_count = sum(1 for item in items if item["level"] == "blocking")
    warning_count = sum(1 for item in items if item["level"] == "warning")
    return {
        "next_version": next_version,
        "latest_version": latest_version.version if latest_version else None,
        "record_count": len(record_rows),
        "blocking_count": blocking_count,
        "warning_count": warning_count,
        "items": items,
    }


async def _build_publish_preview(db:AsyncSession,tenant_id:int,form)->tuple[dict,dict]:
    from app.services.form_option_sources import read_snapshot
    async with read_snapshot():return await _build_publish_preview_inner(db,tenant_id,form)


async def _build_publish_preview_inner(db: AsyncSession, tenant_id: int, form) -> tuple[dict, dict]:
    from app.models.relational import DynamicRecord, FormField

    latest = await _latest_form_version(db, tenant_id, form.id)
    next_version = (latest.version + 1) if latest else INITIAL_FORM_VERSION
    snapshot = await _form_snapshot(db, tenant_id, form)
    from app.services.records import iter_raw
    rows=[record['data'] async for record in iter_raw(db,form)]
    report = _publish_impact_report(latest, next_version, snapshot, rows)
    from app.services.form_control_validation import design_errors
    errors=design_errors(form.config or {},snapshot['fields'])
    analytics_design = (form.config or {}).get('analyticsDesignDraft', (form.config or {}).get('analyticsDesign'))
    if analytics_design is not None:
        from app.services.analytics_metric_library import hydrate_design
        analytics_design, shared_errors = await hydrate_design(db, tenant_id, analytics_design, require_current=True)
        errors += shared_errors
        snapshot['form']['config']['analyticsDesignDraft'] = analytics_design
        from app.services.analytics_runtime import design_errors as analytics_errors
        errors += analytics_errors(analytics_design)
        from app.services.analytics_runtime import source_errors as analytics_source_errors
        errors += await analytics_source_errors(db, tenant_id, form, analytics_design, snapshot['fields'])

    from app.services.field_policies import design_errors as policy_errors
    errors+=policy_errors(snapshot['fields'])
    if not errors:
        from app.services.form_rules import relation,archive_options
        for payload in snapshot['fields']:
            field=_field_proxy_from_payload(payload)
            if relation(field):
                try:await archive_options(db,{'tenant_id':tenant_id,'is_admin':True},field,{})
                except HTTPException as exc:errors.append(f'「{field.label}」关联配置不可用：{exc.detail}')
    if not errors:
        from app.services.field_uniqueness import publish_errors
        errors+=await publish_errors(db,form,[_field_proxy_from_payload(field) for field in snapshot['fields']])
    report['items'].extend({'level':'blocking','type':'control_configuration','detail':error,'affected_count':0} for error in errors)
    report['blocking_count']+=len(errors)
    return report, snapshot


def _layout_payload(layout) -> dict:
    return {
        "id": layout.id,
        "form_id": layout.form_id,
        "layout_type": layout.layout_type,
        "config": layout.config or {},
        "created_at": layout.created_at.isoformat() if layout.created_at else None,
        "updated_at": layout.updated_at.isoformat() if layout.updated_at else None,
    }


def _action_payload(action) -> dict:
    return {
        "id": action.id,
        "form_id": action.form_id,
        "action_key": action.action_key,
        "label": action.label,
        "action_type": action.action_type,
        "config": action.config or {},
        "enabled": action.enabled,
        "sort_order": action.sort_order,
    }


def _permission_payload(permission) -> dict:
    return {
        "id": permission.id,
        "form_id": permission.form_id,
        "role_id": permission.role_id,
        "action": permission.action,
        "effect": permission.effect,
        "field_name": permission.field_name,
    }


def _workflow_binding_payload(binding) -> dict:
    return {
        "id": binding.id,
        "form_id": binding.form_id,
        "workflow_id": binding.workflow_id,
        "trigger_action": binding.trigger_action,
        "enabled": binding.enabled,
        "config": binding.config or {},
    }

