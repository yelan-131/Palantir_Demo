"""Platform form configuration and dynamic record APIs.

These endpoints configure application-owned low-code forms and delegate
record access to the shared record service. Physical storage creates and
updates form-managed business tables; dynamic storage uses JSON records.
"""
from __future__ import annotations
from app.services.record_domains import prepare_domain_create, validate_domain_update, protect_migrated_request

import json
import copy
import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form as FormParam
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db, require_admin
from app.services.application_menus import lock_application, menu_nodes, require_group_parent, validate_tree
from app.services.applications import _application_to_dict
from app.config import settings
from app.database import DB_TYPE
from app.core.audit import write_audit_log
from app.core.permissions import allowed_form_fields, evaluate_form_permission, get_user_role_ids, has_form_permission
from app.core.production_errors import seed_data_required
from app.services.tenant_onboarding import assert_tenant_quota

# Storage-agnostic form engine (naming/validation/encoding/query/physical/
# sequences) extracted from this module; names are re-imported so existing
# call sites and tests (`from app.api.forms import ...`) keep working.
from app.services.form_engine import (  # noqa: F401  (re-exported names)
    ALLOWED_RECORD_STATUSES,
    ANALYTICS_FORM_KINDS,
    PHYSICAL_FORM_STORAGE_MODES,
    _CODE_ALLOCATION_MAX_ATTEMPTS,
    _allocate_code_sequence,
    _apply_record_encoding_rules,
    _apply_record_filters_query,
    _apply_record_search_query,
    _apply_record_sort_query,
    _assert_unique_code_values,
    _code_sequence_from_value,
    _code_value_exists,
    _coerce_physical_value,
    _date_token_for_rule,
    _dynamic_record_field_impact,
    _encoding_rule_for_field,
    _ensure_filter_fields_visible,
    _ensure_physical_code_indexes,
    _ensure_physical_form_table,
    _ensure_production_record_query_supported,
    _ensure_sort_field_allowed,
    _field_allowed_values,
    _field_value_is_compatible,
    _get_physical_record,
    _is_analysis_form_config,
    _is_anonymous_reader,
    _is_encoding_field,
    _isoformat_value,
    _json_text_expr,
    _list_physical_records,
    _max_dynamic_code_sequence,
    _max_physical_code_sequence,
    _merged_record_data,
    _normalize_sql_type,
    _parse_record_filters,
    _physical_column_name,
    _physical_column_type,
    _physical_filter_clause,
    _physical_record_field_impact,
    _physical_record_payload,
    _physical_table_column_types,
    _physical_table_columns,
    _physical_table_name_for_form,
    _physical_write_payload,
    _queryable_field_names,
    _record_matches_filters,
    _record_matches_search,
    _render_code_template,
    _rule_code_embeds_date,
    _runtime_visible_field_names,
    _sequence_period_key,
    _sortable_field_names,
    _sql_current_timestamp,
    _uses_physical_form_table,
    _validate_physical_table_name,
    _validate_record_data,
    _validate_record_status,
    _visible_field_subset,
)

from app.services.form_runtime import (
    _latest_form_version, _field_proxy_from_payload, _runtime_form_fields, _record_payload,
)


from app.services.form_schemas import (  # noqa: F401; compatibility exports
    FormRulePreviewRequest,
    DesignerRulePreviewRequest,
    FormCreate,
    FormUpdate,
    FormCopy,
    ApplicationFormUpsert,
    FormFieldCreate,
    FormFieldUpdate,
    DynamicRecordCreate,
    DynamicRecordUpdate,
    MenuNodeCreate,
    MenuNodeUpdate,
    FormLayoutUpsert,
    FormActionCreate,
    FormActionUpdate,
    FormPermissionCreate,
    FormPermissionUpdate,
    WorkflowBindingCreate,
    WorkflowBindingUpdate,
    FormApplicationSubmit,
)

from app.services.form_definition import (
    _uid,
    _ensure_form_permission,
    _normalize_field_type,
    _normalize_form_field_data,
    _validate_field_name,
    _form_payload,
    _field_payload,
    _permission_payload,
    _permission_design_from_config,
    _form_version_payload,
    _field_cfg_value,
    _field_cfg_name,
    _field_cfg_label,
    _field_cfg_allowed_values,
    _field_cfg_value_is_compatible,
    _record_field_impact,
    _apply_designer_field_settings,
    _form_snapshot,
    _promote_snapshot_config,
    _publish_impact_report,
    _build_publish_preview,
    _build_publish_preview_inner,
    _layout_payload,
    INITIAL_FORM_VERSION,
    FIELD_TYPE_ALIASES,
)
from app.services.form_workflow_start import (
    _protect_pending_form_record,
    _start_form_workflows,
)
from app.services.application_menu_nodes import (
    _create_application_menu_node,
    _delete_application_menu_node,
    _menu_node_payload,
    _update_application_menu_node,
    paste_application_menu_nodes,
)
from app.services import form_admin as form_admin_service
from app.services.form_published_payload import (
    _published_form_payload,
)

router = APIRouter()


@router.get('/reference-sources')
async def form_reference_sources(db:AsyncSession=Depends(get_db),user:dict=Depends(require_admin)):
    from app.services.form_option_sources import catalog
    return {'data':await catalog(db,current_tenant_id(user))}


@router.post('/{form_id}/rules/evaluate')
async def evaluate_form_rules(form_id: int, body: FormRulePreviewRequest,
                              db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    from app.services.form_rule_preview import evaluate_form_rules as operation
    return await operation(form_id=form_id, body=body, db=db, user=user)


@router.post('/{form_id}/rules/preview')
async def preview_designer_rules(form_id: int, body: DesignerRulePreviewRequest,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.form_rule_preview import preview_designer_rules as operation
    return await operation(form_id=form_id, body=body, db=db, user=user)


@router.post('/{form_id}/fields/{field_name}/options/preview')
async def preview_form_reference_options(form_id:int,field_name:str,body:DesignerRulePreviewRequest,db:AsyncSession=Depends(get_db),user:dict=Depends(require_admin)):
    from app.services.form_rule_preview import preview_form_reference_options as operation
    return await operation(form_id=form_id, field_name=field_name, body=body, db=db, user=user)


@router.post('/{form_id}/fields/{field_name}/options/schema/preview')
async def preview_option_search_schema(form_id: int, field_name: str, body: DesignerRulePreviewRequest,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.form_rule_preview import preview_option_search_schema as operation
    return await operation(form_id=form_id, field_name=field_name, body=body, db=db, user=user)


async def _attachment_field(db, user, form_id, field_name, action):
    from app.models.relational import Form
    from app.services import records
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user): raise HTTPException(404, 'Form not found')
    await records.require_form_permission(db, user, form_id, action)
    fields = await _runtime_form_fields(db, form.tenant_id, form_id)
    permitted = await allowed_form_fields(user, form_id, action, fields, db)
    field = next((item for item in fields if item.field_name == field_name and not item.archived), None)
    if not field or field_name not in permitted: raise HTTPException(403, 'Field permission denied')
    ui = field.ui_config or {}
    if field.field_type != 'json' or (ui.get('controlType') != 'upload' and ui.get('businessType') != 'attachment'):
        raise HTTPException(422, '该字段不是附件字段')
    return form, field


@router.post('/{form_id}/fields/{field_name}/files')
async def upload_form_file(form_id: int, field_name: str, file: UploadFile = File(...), record_id: int | None = None,
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    from app.services import form_files, records
    form, field = await _attachment_field(db, user, form_id, field_name, 'edit' if record_id else 'create')
    if record_id is not None:
        raw=await records.read_raw(db,form,record_id)
        await records.require_record_permission(db,user,form,'edit',raw)
    result = await form_files.save(file, form.tenant_id, form_id, field_name, current_user_id(user), (field.ui_config or {}).get('typeSettings') or {})
    return {'data': result}


@router.get('/{form_id}/fields/{field_name}/files/{file_id}')
async def download_form_file(form_id: int, field_name: str, file_id: str, record_id: int | None = None,
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    from fastapi.responses import FileResponse
    from app.services import form_files, records
    form, _ = await _attachment_field(db, user, form_id, field_name, 'view')
    info, path = form_files.metadata(form.tenant_id, form_id, field_name, file_id)
    if record_id is not None:
        record = await records.get_record(form_id, record_id, db, user)
        values = (record.get('data') or {}).get('data', {}).get(field_name) or []
        if not any(isinstance(item, dict) and item.get('id') == file_id for item in values): raise HTTPException(403, '记录未关联此附件')
    elif info['owner_id'] != current_user_id(user): raise HTTPException(403, '附件尚未授权给当前用户')
    return FileResponse(path, filename=info['name'], media_type='application/octet-stream', headers={'X-Content-Type-Options':'nosniff'})


@router.post('/{form_id}/fields/{field_name}/options')
async def form_reference_options(form_id: int, field_name: str, body: FormRulePreviewRequest,
                                 db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    from app.services import records
    from app.services.form_rules import archive_options, accessible_fields
    from app.models.relational import Form
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != current_tenant_id(user):
        raise HTTPException(404, 'Form not found')
    await records.require_form_permission(db, user, form_id, 'view')
    fields = await accessible_fields(db, user, form)
    if set(body.data) - {field.field_name for field in fields}:
        raise HTTPException(403, 'Field permission denied')
    field = next((field for field in fields if field.field_name == field_name), None)
    if not field:
        raise HTTPException(403, 'Field permission denied')
    if body.page is not None or body.query or body.selected is not None:
        from app.services.option_search import search
        return await search(db, user, field, body.data, keyword=body.query, page=body.page or 1, page_size=body.page_size, selected=body.selected, context_fields={item.field_name for item in fields})
    options = await archive_options(db, user, field, body.data)
    # Only IDs and labels leave this endpoint; backfill attributes are projected
    # through the form's own field permissions by the evaluator.
    return {'data': [{'id': option['id'], 'label': option['label']} for option in options]}

logger = logging.getLogger(__name__)

INITIAL_WORKFLOW_VERSION = "v1"


def _validate_form_code(code: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", code):
        raise HTTPException(400, f"Invalid form code: {code!r}")


def _form_layout_field_names(config: Optional[dict]) -> list[str]:
    if not isinstance(config, dict):
        return []
    layout = config.get("formLayout")
    if not isinstance(layout, dict):
        designer_layout = config.get("formDesignerLayout")
        if isinstance(designer_layout, dict) and isinstance(designer_layout.get("runtime"), dict):
            layout = designer_layout.get("runtime")
    sections = layout.get("sections") if isinstance(layout, dict) else None
    if not isinstance(sections, list):
        return []
    names: list[str] = []
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("fields"), list):
            continue
        for item in section["fields"]:
            if isinstance(item, str):
                field_name = item
            elif isinstance(item, dict):
                field_name = item.get("fieldName") or item.get("field_name")
            else:
                field_name = None
            if field_name:
                names.append(str(field_name))
    return list(dict.fromkeys(names))


async def _scope_runtime_view_tabs(payload: dict, user: dict, db: AsyncSession, scope: str) -> dict:
    if scope not in {'list', 'filters'}:
        return payload
    from app.core.permissions import get_user_org_ids
    from app.services.form_view_tabs import runtime_view_config
    from app.services.form_application_lifecycle import APPROVAL_STATUS_FIELD
    from app.services.records import RECORD_LIST_METADATA_FIELDS

    result = copy.deepcopy(payload)
    config = result.get('config') or {}
    view = config.get('viewConfig')
    roles = await get_user_role_ids(user, db) if isinstance(view, dict) and view.get('tabs') else []
    orgs = await get_user_org_ids(user, db) if isinstance(view, dict) and view.get('tabs') else []
    visible_fields = {field['field_name'] for field in result.get('fields', [])}
    if result.get('runtime_approval_available'):
        visible_fields.add(APPROVAL_STATUS_FIELD)
    config['viewConfig'] = runtime_view_config(view, user_id=user.get('uid'), role_ids=roles, org_ids=orgs,
        is_admin=bool(user.get('is_admin')), visible_fields=visible_fields, display_fields=RECORD_LIST_METADATA_FIELDS)
    result['config'] = config
    return result


def _scoped_form_payload(payload: dict, scope: str) -> dict:
    scope = scope or "designer"
    if scope == "designer":
        return payload
    scoped = copy.deepcopy(payload)
    fields = [field for field in (scoped.get("fields") or []) if not field.get("archived")]
    config = scoped.get("config") if isinstance(scoped.get("config"), dict) else {}
    if scope in {"list", "filters"}:
        view = config.get('viewConfig') or {}
        views = view.get('tabs') if isinstance(view.get('tabs'), list) else [view]
        referenced_names = {item.get('fieldName') for current in views for item in [
            *(current.get('filters') or []), *((current.get('table') or {}).get('columns') or [])
        ] if isinstance(item, dict)}
        scoped["fields"] = [
            field for field in fields
            if scope == "filters" or field.get("visible_in_list") or field.get("searchable") or field.get("sortable") or field.get("field_name") in referenced_names
        ]
        scoped["config"] = {
            "viewConfig": config.get("viewConfig"),
            "viewConfigMeta": config.get("viewConfigMeta"),
            "publishedSchemaVersion": config.get("publishedSchemaVersion"),
            "publishedAt": config.get("publishedAt"),
        }
        scoped.pop("permission_design", None)
        scoped.pop("runtime_field_permissions", None)
        return scoped
    if scope in {"create", "edit"}:
        layout_names = _form_layout_field_names(config)
        field_by_name = {field.get("field_name"): field for field in fields}
        if layout_names:
            scoped["fields"] = [
                field_by_name[name]
                for name in layout_names
                if name in field_by_name
            ]
        else:
            scoped["fields"] = [field for field in fields if field.get("visible_in_form", True)]
        scoped["config"] = {
            "formLayout": config.get("formLayout"),
            "formDesignerLayout": config.get("formDesignerLayout"),
            "canvasSettings": config.get("canvasSettings"),
            "publishedSchemaVersion": config.get("publishedSchemaVersion"),
            "publishedAt": config.get("publishedAt"),
        }
        if config.get("formAppearance"):
            scoped["config"]["formAppearance"] = config["formAppearance"]
        allowed_names = {field.get("field_name") for field in scoped["fields"]}
        field_permissions = scoped.get("runtime_field_permissions")
        if isinstance(field_permissions, dict):
            scoped["runtime_field_permissions"] = {
                name: value for name, value in field_permissions.items() if name in allowed_names
            }
        scoped.pop("permission_design", None)
        return scoped
    return scoped


def _application_form_payload(binding) -> dict:
    return {
        "id": binding.id,
        "application_id": binding.application_id,
        "form_id": binding.form_id,
        "alias": binding.alias,
        "enabled": binding.enabled,
        "default_view": binding.default_view,
        "data_scope": binding.data_scope,
        "allow_create": binding.allow_create,
        "allow_edit": binding.allow_edit,
        "allow_delete": binding.allow_delete,
        "allow_export": binding.allow_export,
        "sort_order": binding.sort_order,
        "form": _form_payload(binding.form) if getattr(binding, "form", None) else None,
    }


async def _runtime_submission_available(db, tenant_id, form_id, trigger_action="submit"):
    from app.models.relational import WorkflowBinding, WorkflowDef
    return bool(await db.scalar(
        select(WorkflowBinding.id).join(WorkflowDef, WorkflowDef.id == WorkflowBinding.workflow_id)
        .where(WorkflowBinding.tenant_id == tenant_id, WorkflowBinding.form_id == form_id,
               WorkflowBinding.enabled.is_(True), WorkflowBinding.trigger_action == trigger_action,
               WorkflowDef.tenant_id == tenant_id, WorkflowDef.status.in_(["published", "active"]))
        .limit(1)
    ))


async def _set_runtime_approval_capabilities(db, form, payload):
    from app.services.form_application_lifecycle import has_approval_history

    can_submit = await _runtime_submission_available(db, form.tenant_id, form.id)
    payload["runtime_submission_available"] = can_submit
    payload["runtime_approval_available"] = (
        can_submit and form.code not in {"material-application", "alert-center"}
    ) or await has_approval_history(db, form)


async def _runtime_permission_summary(user: dict, form_id: int, db: AsyncSession) -> dict:
    actions = ["view", "create", "edit", "delete", "import", "export", "configure", "approve"]
    cache: dict = {}
    summary = {}
    for action in actions:
        decision = await evaluate_form_permission(user, form_id, action, db, cache=cache)
        summary[action] = bool(decision["allowed"])
    from app.models.relational import Form
    from app.services.designer_permissions import role_configs
    form=await db.get(Form,form_id)
    configs=await role_configs(db,user,form) if form else []
    for action in ['saveDraft','submit']:
        summary[action]=not any((value.get('actions') or {}).get(action) is False for value in configs)
    return summary


def _runtime_field_name(field) -> str:
    if isinstance(field, dict):
        return str(field.get("field_name") or "")
    return str(getattr(field, "field_name", "") or "")


async def _runtime_field_permission_summary(user: dict, form, fields: list, db: AsyncSession) -> dict:
    cache: dict = {}
    field_names = [name for name in (_runtime_field_name(field) for field in fields) if name]
    if user.get("is_admin"):
        return {
            name: {"visible": True, "editable": True, "exportable": True, "required": False}
            for name in field_names
        }

    summary: dict[str, dict] = {}
    for name in field_names:
        view = await evaluate_form_permission(user, form.id, "view", db, field_name=name, cache=cache)
        edit = await evaluate_form_permission(user, form.id, "edit", db, field_name=name, cache=cache)
        export = await evaluate_form_permission(user, form.id, "export", db, field_name=name, cache=cache)
        summary[name] = {
            "visible": bool(view["allowed"]),
            "editable": bool(edit["allowed"]),
            "exportable": bool(export["allowed"]),
            "required": False,
        }

    permission_design = _permission_design_from_config(form.config)
    role_configs = permission_design.get("roles") if isinstance(permission_design, dict) else None
    if isinstance(role_configs, dict):
        role_ids = await get_user_role_ids(user, db)
        if role_ids:
            from app.models.relational import Role

            tenant_id = current_tenant_id(user)
            roles = (await db.execute(
                select(Role).where(Role.tenant_id == tenant_id, Role.id.in_(role_ids))
            )).scalars().all()
            role_keys = {role.name for role in roles} | {role.label for role in roles}
            for role_key in role_keys:
                role_config = role_configs.get(role_key)
                fields_config = role_config.get("fields") if isinstance(role_config, dict) else None
                if not isinstance(fields_config, dict):
                    continue
                for name, field_config in fields_config.items():
                    if name in summary and isinstance(field_config, dict):
                        summary[name]["required"] = summary[name]["required"] or bool(field_config.get("required"))
    return summary


def _default_view_config(fields: list[dict]) -> dict:
    visible_fields = [field for field in fields if field.get("visible_in_list", True)]
    searchable_fields = [field for field in fields if field.get("searchable")]
    if not searchable_fields:
        searchable_fields = [
            field
            for index, field in enumerate(visible_fields)
            if index < 4 and field.get("field_type") in {"string", "text", "enum", "date", "datetime", "relation", "code"}
        ][:4]
    return {
        "table": {
            "pageSize": 20,
            "density": "middle",
            "columns": [
                {
                    "id": field["field_name"],
                    "fieldName": field["field_name"],
                    "label": field["label"],
                    "enabled": True,
                    "sortable": bool(field.get("sortable")),
                    "renderType": "tag" if field.get("field_type") == "enum" else "text",
                    "sortOrder": index,
                }
                for index, field in enumerate(visible_fields)
            ],
        },
        "filters": [
            {
                "id": field["field_name"],
                "fieldName": field["field_name"],
                "label": field["label"],
                "enabled": True,
                "operator": "contains" if field.get("field_type") in {"string", "text", "code"} else "equals",
                "advanced": index > 2,
                "sortOrder": index,
            }
            for index, field in enumerate(searchable_fields)
        ],
    }


def _runtime_design_field_payload(field) -> dict:
    if isinstance(field, dict):
        return field
    return _field_payload(field)


def _default_form_layout(fields: list[dict]) -> dict:
    return {
        "sections": [
            {
                "id": "section-business-info",
                "title": "业务信息",
                "fields": [
                    {
                        "fieldName": field["field_name"],
                        "label": field.get("label") or field["field_name"],
                        "colSpan": 2 if field.get("field_type") in {"text", "json"} else 1,
                    }
                    for field in fields
                    if field.get("visible_in_form", True)
                ],
            }
        ],
    }


async def _ensure_agent_business_runtime_design(db: AsyncSession, tenant_id: int, form, fields: list) -> bool:
    from app.models.relational import FormLayout

    config = dict(form.config or {})
    if _is_analysis_form_config(config):
        return False
    if form.storage_mode != "dynamic":
        return False
    if not (config.get("createdByAgent") or str(config.get("source") or "").startswith("agent-low-code")):
        return False

    field_payloads = [_runtime_design_field_payload(field) for field in fields]
    if not field_payloads:
        return False

    changed = False
    has_searchable_field = any(bool(field.get("searchable")) for field in field_payloads)
    if not has_searchable_field:
        for index, field in enumerate(fields):
            payload = field_payloads[index]
            if index < 4 and payload.get("visible_in_list", True) and payload.get("field_type") in {"string", "text", "enum", "date", "datetime", "relation", "code"}:
                payload["searchable"] = True
                if not isinstance(field, dict) and hasattr(field, "searchable"):
                    field.searchable = True
                    changed = True

    view_config = config.get("viewConfig")
    if not isinstance(view_config, dict) or not (view_config.get("table") or {}).get("columns"):
        view_config = _default_view_config(field_payloads)
        config["viewConfig"] = view_config
        config["viewConfigDraft"] = config.get("viewConfigDraft") or view_config
        changed = True
    elif not (view_config.get("filters") or []) and not has_searchable_field:
        next_view_config = _default_view_config(field_payloads)
        if next_view_config.get("filters"):
            view_config = {**view_config, "filters": next_view_config["filters"]}
            config["viewConfig"] = view_config
            config["viewConfigDraft"] = view_config
            changed = True

    if not isinstance(config.get("formLayout"), dict):
        config["formLayout"] = _default_form_layout(field_payloads)
        changed = True

    if "assemblyKind" not in config:
        config["assemblyKind"] = "business"
        changed = True

    meta = dict(config.get("viewConfigMeta") or {})
    if not meta:
        now = datetime.now().isoformat()
        config["viewConfigMeta"] = {
            "draftVersion": 1,
            "publishedVersion": 1,
            "draftSavedAt": now,
            "publishedAt": now,
            "status": "published",
        }
        changed = True

    if changed:
        form.config = config

    layout_configs = {
        "list": {"viewConfig": view_config},
        "view": {"draft": view_config, "published": view_config, "meta": config.get("viewConfigMeta")},
        "form": config["formLayout"],
    }
    for layout_type, layout_config in layout_configs.items():
        existing_layout = await db.scalar(
            select(FormLayout).where(
                FormLayout.form_id == form.id,
                FormLayout.tenant_id == tenant_id,
                FormLayout.layout_type == layout_type,
            )
        )
        if existing_layout is None:
            db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type=layout_type, config=layout_config))
            changed = True
        elif not existing_layout.config:
            existing_layout.config = layout_config
            changed = True

    return changed


@router.get("")
async def list_forms(
    application_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import ApplicationForm, Form, FormField

    tenant_id = current_tenant_id(user)
    query = select(Form).where(Form.tenant_id == tenant_id).order_by(Form.created_at.desc(), Form.id.desc())
    if application_id is not None:
        query = query.join(ApplicationForm, ApplicationForm.form_id == Form.id).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.tenant_id == tenant_id,
            ApplicationForm.enabled.is_(True),
        )
    forms = (await db.execute(query)).scalars().all()
    if not user.get("is_admin") and not _is_anonymous_reader(user):
        visible_forms = []
        for form in forms:
            if await has_form_permission(user, form.id, "view", db):
                visible_forms.append(form)
        forms = visible_forms
    form_ids = [form.id for form in forms]
    fields_by_form: dict[int, list] = {form_id: [] for form_id in form_ids}
    if form_ids:
        field_rows = (await db.execute(
            select(FormField)
            .where(FormField.tenant_id == tenant_id, FormField.form_id.in_(form_ids))
            .order_by(FormField.form_id, FormField.sort_order, FormField.id)
        )).scalars().all()
        for field in field_rows:
            fields_by_form.setdefault(field.form_id, []).append(field)
    return {"data": [_form_payload(form, fields=fields_by_form.get(form.id, [])) for form in forms]}


@router.post("")
async def create_form(
    body: FormCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        return await _create_form(body, db, user)
    except Exception:
        await db.rollback()
        raise


async def _create_form(body: FormCreate, db: AsyncSession, user: dict):
    from app.models.relational import Application, ApplicationForm, Form, FormAction, FormLayout

    tenant_id = current_tenant_id(user)
    _validate_form_code(body.code)
    draft = body.designer_draft
    config = dict(body.config)
    receipt = None
    if draft:
        from app.services.field_uniqueness import lock
        await lock(db, tenant_id)
        payload = json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        receipt = {"id": draft.draft_id, "digest": hashlib.sha256(payload.encode()).hexdigest()}
        config.update(
            formLayout=draft.layout,
            viewConfigDraft=draft.view,
            viewConfigMeta={
                "draftVersion": 1, "publishedVersion": 0,
                "draftSavedAt": datetime.now(timezone.utc).isoformat(), "status": "draft",
            },
        )
        for key in ("viewConfig", "publishedSchemaVersion", "publishedAt"):
            config.pop(key, None)
    # The retry marker is issued by the server only after a complete save.
    config.pop("_designerDraftReceipt", None)
    storage_mode = body.storage_mode
    table_name = body.table_name
    if storage_mode == "dynamic" and not table_name:
        storage_mode = "physical_table"
        table_name = _physical_table_name_for_form(tenant_id, body.code, config)
    if table_name:
        _validate_physical_table_name(tenant_id, table_name)

    existing = await db.scalar(select(Form).where(Form.code == body.code, Form.tenant_id == tenant_id))
    if existing:
        if receipt and existing.owner_id == current_user_id(user):
            saved = (existing.config or {}).get("_designerDraftReceipt")
            if receipt == saved:
                result = _form_payload(existing)
                await db.rollback()
                return {"data": result}
            if isinstance(saved, dict) and receipt["id"] == saved.get("id"):
                raise HTTPException(409, "该草稿已保存，请打开已保存的表单继续编辑")
        raise HTTPException(409, "该表单编码已被其他表单占用" if draft else "Form code already exists")

    if body.application_id is not None:
        app = await db.get(Application, body.application_id)
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(404, "Application not found")

    form = Form(
        tenant_id=tenant_id,
        name=body.name,
        code=body.code,
        description=body.description,
        model_id=body.model_id,
        table_name=table_name,
        storage_mode=storage_mode,
        status="draft" if draft else body.status,
        owner_id=_uid(user),
        config=config,
    )
    db.add(form)
    await db.flush()
    if draft:
        from app.services.form_fields import add_form_fields
        from app.services.workflow_definitions import stage_workflow_definition

        await add_form_fields(
            form.id, [field.model_dump() for field in draft.fields], db, user, defer_commit=True,
        )
        workflow = draft.workflow.model_copy(update={
            "status": "draft",
            "config": {
                **(draft.workflow.config or {}),
                "formId": form.id, "formCode": form.code, "formName": form.name,
                "savedAt": datetime.now(timezone.utc).isoformat(),
            },
        })
        definition = await stage_workflow_definition(db, workflow, user)
        form.config = {**config, "workflowDesigner": {"draftWorkflowId": definition.id},
                       "_designerDraftReceipt": receipt}
        db.add(FormLayout(
            tenant_id=tenant_id, form_id=form.id, layout_type="view",
            config={"draft": draft.view, "meta": config["viewConfigMeta"]},
        ))
    else:
        await _ensure_physical_form_table(db, form, [])

    if body.application_id is not None:
        db.add(ApplicationForm(tenant_id=tenant_id, application_id=body.application_id, form_id=form.id))

    db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="list", config={"columns": []}))
    db.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="form",
                      config=draft.layout if draft else {"sections": []}))
    for idx, (key, label) in enumerate([("create", "Create"), ("edit", "Edit"), ("delete", "Delete"), ("export", "Export")]):
        db.add(FormAction(tenant_id=tenant_id, form_id=form.id, action_key=key, label=label, sort_order=idx))

    await db.commit()
    await db.refresh(form)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create",
        resource_type="form",
        resource_id=form.id,
        new_values=body.dict(),
    )
    return {"data": _form_payload(form)}


@router.post("/{form_id}/copy")
async def copy_form(
    form_id: int,
    body: FormCopy,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Copy design metadata atomically; business records and versions stay separate."""
    return await form_admin_service.copy_form(form_id=form_id, body=body, db=db, user=user)


@router.get("/applications/{application_id}/forms")
async def list_application_form_bindings(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from sqlalchemy.orm import selectinload
    from app.models.relational import Application, ApplicationForm

    tenant_id = current_tenant_id(user)
    app = await db.get(Application, application_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    bindings = (await db.execute(
        select(ApplicationForm)
        .options(selectinload(ApplicationForm.form))
        .where(ApplicationForm.application_id == application_id, ApplicationForm.tenant_id == tenant_id)
        .order_by(ApplicationForm.sort_order, ApplicationForm.id)
    )).scalars().all()
    return {"data": [_application_form_payload(binding) for binding in bindings]}


@router.put("/applications/{application_id}/forms")
async def upsert_application_form_binding(
    application_id: int,
    body: ApplicationFormUpsert,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from sqlalchemy.orm import selectinload
    from app.models.relational import Application, ApplicationForm, Form

    tenant_id = current_tenant_id(user)
    app = await db.get(Application, application_id)
    form = await db.get(Form, body.form_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    binding = await db.scalar(
        select(ApplicationForm)
        .options(selectinload(ApplicationForm.form))
        .where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == body.form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    )
    values = body.dict()
    if binding is None:
        binding = ApplicationForm(tenant_id=tenant_id, application_id=application_id, **values)
        db.add(binding)
    else:
        for key, value in values.items():
            setattr(binding, key, value)
    await db.commit()
    await db.refresh(binding)
    return {"data": _application_form_payload(binding)}


@router.delete("/applications/{application_id}/forms/{form_id}")
async def delete_application_form_binding(
    application_id: int,
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import ApplicationForm

    tenant_id = current_tenant_id(user)
    await db.execute(
        delete(ApplicationForm).where(
            ApplicationForm.application_id == application_id,
            ApplicationForm.form_id == form_id,
            ApplicationForm.tenant_id == tenant_id,
        )
    )
    await db.commit()
    return {"ok": True}


@router.get("/applications/{application_id}/menu-nodes")
async def list_application_menu_nodes(
    application_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.models.relational import Application, ApplicationMenuNode

    tenant_id = current_tenant_id(user)
    app = await db.get(Application, application_id)
    if not app or app.tenant_id != tenant_id:
        raise HTTPException(404, "Application not found")
    nodes = (await db.execute(
        select(ApplicationMenuNode)
        .where(ApplicationMenuNode.application_id == application_id, ApplicationMenuNode.tenant_id == tenant_id)
        .order_by(ApplicationMenuNode.sort_order, ApplicationMenuNode.id)
    )).scalars().all()
    return {"data": [await _menu_node_payload(db, node) for node in nodes]}


@router.post("/applications/{application_id}/menu-nodes")
async def create_application_menu_node(
    application_id: int,
    body: MenuNodeCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.field_uniqueness import lock

    await lock(db, current_tenant_id(user))
    return await _create_application_menu_node(application_id, body, db, user)


class MenuNodePaste(BaseModel):
    node_ids: list[Annotated[int, Field(gt=0)]] = Field(min_length=1, max_length=2000)
    parent_id: int | None = Field(default=None, gt=0)
    source_application_id: int | None = Field(default=None, gt=0)


@router.post("/applications/{application_id}/menu-nodes/paste")
async def paste_menu_nodes(application_id: int, body: MenuNodePaste,
                           db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    from app.services.field_uniqueness import lock

    await lock(db, current_tenant_id(user))
    return await paste_application_menu_nodes(
        application_id, body.node_ids, body.parent_id, db, user, source_application_id=body.source_application_id,
    )


class MenuOrderItem(BaseModel):
    id: int = Field(gt=0)
    parent_id: int | None = Field(default=None, gt=0)
    sort_order: int = Field(ge=0)


class MenuOrderWrite(BaseModel):
    expected: list[MenuOrderItem] = Field(max_length=2000)
    nodes: list[MenuOrderItem] = Field(max_length=2000)


@router.put("/applications/{application_id}/menu-order")
async def save_application_menu_order(application_id: int, body: MenuOrderWrite,
                                      db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    app = await lock_application(db, current_tenant_id(user), application_id)
    nodes = await menu_nodes(db, app)
    current = {node.id: (node.parent_id, node.sort_order) for node in nodes}
    expected = {item.id: (item.parent_id, item.sort_order) for item in body.expected}
    if len(expected) != len(body.expected) or current != expected:
        raise HTTPException(409, "菜单结构已变化，请刷新后重试")
    proposed = {item.id: item.parent_id for item in body.nodes}
    if len(proposed) != len(body.nodes) or set(proposed) != set(current):
        raise HTTPException(422, "必须提交当前应用的完整菜单结构")
    validate_tree(proposed)
    group_ids = {node.id for node in nodes if node.node_type == "group"}
    for item in body.nodes:
        if item.parent_id != current[item.id][0]:
            require_group_parent(item.parent_id, group_ids)
    orders = {(item.parent_id, item.sort_order) for item in body.nodes}
    if len(orders) != len(body.nodes):
        raise HTTPException(422, "同级菜单顺序不能重复")
    patches = {item.id: item for item in body.nodes}
    for node in nodes:
        node.parent_id = patches[node.id].parent_id
        node.sort_order = patches[node.id].sort_order
    await db.commit()
    return {"data": [await _menu_node_payload(db, node) for node in nodes]}


@router.put("/applications/{application_id}/menu-nodes/{node_id}")
async def update_application_menu_node(
    application_id: int,
    node_id: int,
    body: MenuNodeUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.field_uniqueness import lock

    await lock(db, current_tenant_id(user))
    return await _update_application_menu_node(application_id, node_id, body, db, user)


@router.delete("/applications/{application_id}/menu-nodes/{node_id}")
async def delete_application_menu_node(
    application_id: int,
    node_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.field_uniqueness import lock
    from app.models.relational import Application

    await lock(db, current_tenant_id(user))
    result = await _delete_application_menu_node(application_id, node_id, db, user, defer_commit=True)
    await db.flush()
    app = await db.get(Application, application_id)
    nodes = sorted(await menu_nodes(db, app), key=lambda node: (node.sort_order, node.id))
    result["data"] = [await _menu_node_payload(db, node) for node in nodes]
    state = await _application_to_dict(db, app)
    result["application"] = {field: state[field] for field in ("default_route", "edit_token")}
    await db.commit()
    return result


@router.get("/{form_id}/publish/preview")
async def preview_form_publish(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.form_versions import preview_form_publish as operation
    return await operation(form_id=form_id, db=db, user=user)


class FormPublishRequest(BaseModel):
    workflow_draft_id: int | None = Field(default=None, gt=0)


@router.post("/{form_id}/publish")
async def publish_form(
    form_id: int,
    body: FormPublishRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.form_versions import publish_form as operation
    return await operation(form_id=form_id, db=db, user=user,
                           workflow_draft_id=body.workflow_draft_id if body else None)


class FormDraftRestore(BaseModel):
    version: Optional[int] = Field(default=None, gt=0)


@router.post('/{form_id}/draft/restore')
async def restore_form_draft(form_id:int, body: FormDraftRestore | None = None, db:AsyncSession=Depends(get_db),user:dict=Depends(require_admin)):
    from app.services.form_versions import restore_form_draft as operation
    return await operation(form_id=form_id, db=db, user=user, version_number=None if body is None else body.version)


@router.get("/{form_id}/versions")
async def list_form_versions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.form_versions import list_form_versions as operation
    return await operation(form_id=form_id, db=db, user=user)


@router.get("/{form_id}/versions/{version_number}")
async def get_form_version(
    form_id: int,
    version_number: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.form_versions import get_form_version as operation
    return await operation(form_id=form_id, version_number=version_number, db=db, user=user)


@router.get("/code/{form_code}")
async def get_form_by_code(
    form_code: str,
    schema: str = Query(default="draft", pattern="^(draft|published)$"),
    scope: str = Query(default="designer", pattern="^(list|filters|create|edit|designer)$"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Form

    tenant_id = current_tenant_id(user)
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == form_code))
    if not form:
        raise HTTPException(404, "Form not found")
    return await get_form(form.id, schema=schema, scope=scope, db=db, user=user)


@router.get("/{form_id}")
async def get_form(
    form_id: int,
    schema: str = Query(default="draft", pattern="^(draft|published)$"),
    scope: str = Query(default="designer", pattern="^(list|filters|create|edit|designer)$"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.models.relational import Application, ApplicationForm, Form, FormField

    tenant_id = current_tenant_id(user)
    form = await db.get(Form, form_id)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "view")
    draft_fields = (await db.execute(
        select(FormField).where(FormField.form_id == form_id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order, FormField.id)
    )).scalars().all()
    if await _ensure_agent_business_runtime_design(db, tenant_id, form, draft_fields):
        await db.commit()
        await db.refresh(form)
    fields = await _runtime_form_fields(db, tenant_id, form_id) if schema == "published" else draft_fields
    if not user.get("is_admin") and not _is_anonymous_reader(user):
        visible_names = await allowed_form_fields(user, form_id, "view", fields, db)
        fields = [field for field in fields if field.field_name in visible_names]
    app_rows = await db.execute(
        select(Application, ApplicationForm)
        .join(ApplicationForm, ApplicationForm.application_id == Application.id)
        .where(ApplicationForm.form_id == form_id, ApplicationForm.tenant_id == tenant_id, Application.tenant_id == tenant_id)
        .order_by(ApplicationForm.sort_order)
    )
    applications = [
        {
            "id": app.id,
            "name": app.name,
            "code": app.code,
            "alias": binding.alias,
            "enabled": binding.enabled,
            "sort_order": binding.sort_order,
        }
        for app, binding in app_rows.fetchall()
    ]
    if schema == "published":
        version = await _latest_form_version(db, tenant_id, form_id)
        if version:
            payload = _published_form_payload(form, version, applications=applications)
            if not user.get("is_admin") and not _is_anonymous_reader(user):
                visible_names = await allowed_form_fields(user, form_id, "view", fields, db)
                payload["fields"] = [field for field in payload["fields"] if field.get("field_name") in visible_names]
            await _set_runtime_approval_capabilities(db, form, payload)
            payload["runtime_permissions"] = await _runtime_permission_summary(user, form_id, db)
            payload["runtime_field_permissions"] = await _runtime_field_permission_summary(user, form, payload.get("fields") or [], db)
            return {"data": _scoped_form_payload(await _scope_runtime_view_tabs(payload, user, db, scope), scope)}
    payload = _form_payload(form, fields=fields, applications=applications)
    if schema == "published" and "formAppearance" in payload["config"]:
        payload["config"] = {key: value for key, value in payload["config"].items() if key != "formAppearance"}
    await _set_runtime_approval_capabilities(db, form, payload)
    payload["runtime_permissions"] = await _runtime_permission_summary(user, form_id, db)
    payload["runtime_field_permissions"] = await _runtime_field_permission_summary(user, form, fields, db)
    return {"data": _scoped_form_payload(await _scope_runtime_view_tabs(payload, user, db, scope), scope)}


@router.put("/{form_id}")
async def update_form(
    form_id: int,
    body: FormUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.update_form(form_id=form_id, body=body, db=db, user=user)


@router.delete("/{form_id}")
async def delete_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.delete_form(form_id=form_id, db=db, user=user)


@router.post("/{form_id}/fields")
async def create_form_field(
    form_id: int,
    body: FormFieldCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.form_fields import create_form_field as operation
    return await operation(form_id=form_id, body=body, db=db, user=user)


@router.put("/{form_id}/fields/{field_id}")
async def update_form_field(
    form_id: int,
    field_id: int,
    body: FormFieldUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.form_fields import update_form_field as operation
    return await operation(form_id=form_id, field_id=field_id, body=body, db=db, user=user)


@router.delete("/{form_id}/fields/{field_id}")
async def archive_form_field(
    form_id: int,
    field_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.form_fields import archive_form_field as operation
    return await operation(form_id=form_id, field_id=field_id, db=db, user=user)


@router.get("/{form_id}/layouts")
async def list_form_layouts(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.form_layouts import list_form_layouts as operation
    return await operation(form_id=form_id, db=db, user=user)


@router.put("/{form_id}/layouts/{layout_type}")
async def upsert_form_layout(
    form_id: int,
    layout_type: str,
    body: FormLayoutUpsert,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from app.services.form_layouts import upsert_form_layout as operation
    return await operation(form_id=form_id, layout_type=layout_type, body=body, db=db, user=user)


@router.get("/{form_id}/actions")
async def list_form_actions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return await form_admin_service.list_form_actions(form_id=form_id, db=db, user=user)


@router.post("/{form_id}/actions")
async def create_form_action(
    form_id: int,
    body: FormActionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.create_form_action(form_id=form_id, body=body, db=db, user=user)


@router.put("/{form_id}/actions/{action_id}")
async def update_form_action(
    form_id: int,
    action_id: int,
    body: FormActionUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.update_form_action(form_id=form_id, action_id=action_id, body=body, db=db, user=user)


@router.delete("/{form_id}/actions/{action_id}")
async def delete_form_action(
    form_id: int,
    action_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.delete_form_action(form_id=form_id, action_id=action_id, db=db, user=user)


@router.get("/{form_id}/permissions")
async def list_form_permissions(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.list_form_permissions(form_id=form_id, db=db, user=user)


@router.post("/{form_id}/permissions")
async def create_form_permission(
    form_id: int,
    body: FormPermissionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.create_form_permission(form_id=form_id, body=body, db=db, user=user)


@router.put("/{form_id}/permissions/{permission_id}")
async def update_form_permission(
    form_id: int,
    permission_id: int,
    body: FormPermissionUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.update_form_permission(form_id=form_id, permission_id=permission_id, body=body, db=db, user=user)


@router.delete("/{form_id}/permissions/{permission_id}")
async def delete_form_permission(
    form_id: int,
    permission_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.delete_form_permission(form_id=form_id, permission_id=permission_id, db=db, user=user)


@router.get("/{form_id}/workflow-bindings")
async def list_workflow_bindings(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.list_workflow_bindings(form_id=form_id, db=db, user=user)


@router.post("/{form_id}/workflow-bindings")
async def create_workflow_binding(
    form_id: int,
    body: WorkflowBindingCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.create_workflow_binding(form_id=form_id, body=body, db=db, user=user)


@router.put("/{form_id}/workflow-bindings/{binding_id}")
async def update_workflow_binding(
    form_id: int,
    binding_id: int,
    body: WorkflowBindingUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.update_workflow_binding(form_id=form_id, binding_id=binding_id, body=body, db=db, user=user)


@router.delete("/{form_id}/workflow-bindings/{binding_id}")
async def delete_workflow_binding(
    form_id: int,
    binding_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await form_admin_service.delete_workflow_binding(form_id=form_id, binding_id=binding_id, db=db, user=user)


@router.get("/{form_id}/records")
async def list_dynamic_records(
    form_id: int,
    include_deleted: bool = False,
    search: Optional[str] = Query(default=None),
    filters_json: Optional[str] = Query(default=None, alias="filters"),
    sort_field: Optional[str] = Query(default=None),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    cursor_after_id: Optional[int] = Query(default=None, ge=1),
    cursor_before_id: Optional[int] = Query(default=None, ge=1),
    include_total: bool = True,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.records import add_record_actor_names, list_records

    result = await list_records(form_id, db, user, include_deleted=include_deleted, search=search,
        filters_json=filters_json, sort_field=sort_field, sort_order=sort_order,
        cursor_after_id=cursor_after_id, cursor_before_id=cursor_before_id, include_total=include_total,
        page=page, page_size=page_size)
    await add_record_actor_names(db, current_tenant_id(user), result['data'])
    return result


@router.get('/{form_id}/records/actor-options')
async def list_record_actor_options(
    form_id: int,
    field: Literal['_created_by', '_updated_by'],
    query: str = Query(default='', max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    selected: int | None = Query(default=None, ge=1, le=2**63 - 1),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.records import record_actor_options

    return await record_actor_options(form_id, db, user, field=field, query=query, page=page,
                                      page_size=page_size, selected=selected)


@router.get('/{form_id}/records-export')
async def export_records_page(form_id:int,page:int=Query(1,ge=1),page_size:int=Query(20,ge=1,le=200),search:Optional[str]=None,filters_json:Optional[str]=Query(None,alias='filters'),sort_field:Optional[str]=None,sort_order:str=Query('desc',pattern='^(asc|desc)$'),db:AsyncSession=Depends(get_db),user:dict=Depends(get_current_user)):
    import csv,io
    from fastapi.responses import Response
    from app.services import records
    from app.models.relational import Form
    form=await db.get(Form,form_id)
    if not form or form.tenant_id!=current_tenant_id(user):raise HTTPException(404,'Form not found')
    await records.require_form_permission(db,user,form_id,'export')
    result=await records.list_records(form_id,db,user,page=page,page_size=page_size,search=search,filters_json=filters_json,sort_field=sort_field,sort_order=sort_order)
    fields=await records.runtime_fields(db,form)
    columns=[field for field in fields if not field.archived]
    stream=io.StringIO();writer=csv.writer(stream)
    writer.writerow([field.label for field in columns])
    for row in result['data']:
        if not await records.record_allowed(db,user,form,'export',row):continue
        allowed=await allowed_form_fields(user,form_id,'export',fields,db,record_data=records.policy_data(row))
        values=[]
        for field in columns:
            value=(row.get('data') or {}).get(field.field_name,'') if field.field_name in allowed else ''
            value=json.dumps(value,ensure_ascii=False) if isinstance(value,(dict,list)) else str(value) if value is not None else ''
            # Keep spreadsheet software from evaluating formula-like cell content.
            values.append("'"+value if value.startswith(('=','+','-','@','\t','\r')) else value)
        writer.writerow(values)
    return Response('\ufeff'+stream.getvalue(),media_type='text/csv; charset=utf-8')


@router.post('/{form_id}/imports/preview')
async def preview_form_import(form_id:int,file:UploadFile=File(...),db:AsyncSession=Depends(get_db),user:dict=Depends(get_current_user)):
    from app.services.form_imports import preview,MAX_BYTES
    return {'data':await preview(db,user,form_id,file.filename or '',await file.read(MAX_BYTES+1))}


@router.post('/{form_id}/imports')
async def execute_form_import(form_id:int,file:UploadFile=File(...),mapping:str=FormParam(...),request_key:str=FormParam(...),schema_version:int=FormParam(...),db:AsyncSession=Depends(get_db),user:dict=Depends(get_current_user)):
    from app.services.form_imports import execute,MAX_BYTES
    try:columns=json.loads(mapping)
    except (ValueError,TypeError):raise HTTPException(422,'列映射格式无效')
    return {'data':await execute(db,user,form_id,file.filename or '',await file.read(MAX_BYTES+1),columns,request_key,schema_version)}


@router.get("/{form_id}/records/{record_id}")
async def get_dynamic_record(
    form_id: int,
    record_id: int,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.records import get_record
    return await get_record(form_id, record_id, db, user, include_deleted=include_deleted)


@router.post("/{form_id}/records")
async def create_dynamic_record(
    form_id: int,
    body: DynamicRecordCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return await _create_dynamic_record(form_id, body, db, user)


async def _create_dynamic_record(form_id, body, db, user, *, defer_commit=False):
    from app.services.records import create_record
    return await create_record(form_id, body, db, user, defer_commit=defer_commit)


async def _record_creation_audit(db, defer_commit, **values):
    from app.models.relational import AuditLog
    import json
    new_values = values.pop("new_values", None)
    db.add(AuditLog(**values, new_values=json.dumps(new_values, ensure_ascii=False, default=str)))
    await db.flush()
    if not defer_commit:
        await db.commit()


@router.put("/{form_id}/records/{record_id}")
async def update_dynamic_record(
    form_id: int,
    record_id: int,
    body: DynamicRecordUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.records import update_record
    return await update_record(form_id, record_id, body, db, user)


@router.delete("/{form_id}/records/{record_id}")
async def delete_dynamic_record(
    form_id: int,
    record_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from app.services.records import delete_record
    return await delete_record(form_id, record_id, db, user)


@router.post("/{form_id}/records/{record_id}/submit")
async def submit_form_application(form_id: int, record_id: int, body: FormApplicationSubmit,
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    from app.models.relational import Form
    from app.services.form_application_lifecycle import enabled, locked_record, metadata, audit, set_status, decorate
    form = await db.get(Form, form_id)
    tenant_id = current_tenant_id(user)
    if not form or form.tenant_id != tenant_id:
        raise HTTPException(404, "Form not found")
    await _ensure_form_permission(db, user, form_id, "edit")
    from app.services.designer_permissions import require_action
    await require_action(db,user,form,'submit')
    if not await enabled(db, form):
        raise HTTPException(409, "此表单尚未配置审批流程")
    record = await locked_record(db, form, record_id)
    from app.services.records import require_record_permission
    await require_record_permission(db, user, form, "edit", record)
    state = await metadata(db, form, record, user)
    if not state:
        raise HTTPException(409, "历史记录不能直接转换为申请，请新建草稿")
    if body.expected_status not in {"draft", "rejected"} or state['status'] != body.expected_status:
        raise HTTPException(409, "申请状态已变化，请刷新重试")
    if not state['can_submit']:
        raise HTTPException(403, "仅申请人或管理员可以提交")
    await _protect_pending_form_record(db, tenant_id, form_id, record_id)
    fields = await _runtime_form_fields(db, tenant_id, form_id)
    from app.services.form_rules import evaluate
    checked=await evaluate(db,user,fields,{},existing=record['data'],enforce=True)
    _validate_record_data(checked['fields'],checked['data'])
    if any(record['data'].get(key)!=value for key,value in checked['data'].items()):
        raise HTTPException(409,'表单规则已更新，请重新保存草稿后提交')
    instances = await _start_form_workflows(db, tenant_id=tenant_id, form=form, record_payload=record, user=user)
    if len(instances) != 1:
        raise HTTPException(409, "表单须配置唯一的审批流程")
    status = "approved" if instances[0]["status"] == "approved" else "pending"
    await set_status(db, form, record, status, user)
    await audit(db, form, record_id, user, "submit", status=status, workflow_id=instances[0]['instance_id'])
    await db.commit()
    visible = await _runtime_visible_field_names(user, form_id, fields, db)
    record['data'] = {key: value for key, value in record['data'].items() if key in visible}
    await decorate(db, form, record, user)
    return {"data": {**record, "workflow_instances": instances}}
