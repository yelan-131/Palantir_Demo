"""Typed, permission-checked edits of a pending AI record proposal."""

from __future__ import annotations

from math import isfinite
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, JsonValue
from sqlalchemy import select, update

from app.core.db import db_session
from app.core.permissions import allowed_form_fields
from app.core.principal import current_tenant_id, current_user_id
from app.models.relational import AIAgentRun, AIConversation
from app.services import field_policies, form_rules, records
from app.services.designer_permissions import field_settings, require_action
from app.services.form_engine.validation import _validate_record_data
from app.services.option_search import settings as option_search_settings
from app.services.record_domains import prepare_domain_create, validate_domain_update
from app.services.workflow_field_policy import current_policy

from .agent_items import confirmation_item, extract_confirmation_payload
from .agent_runs import AGENT_RUNS
from .agent_validation import agent_validation_service
from .confirmations import create_confirmation_payload
from .dynamic_record_drafts import _pick_payload_value, resolve_dynamic_record_form
from .policies import decide_tool_permission
from .run_recovery import waiting_confirmation_unchanged
from .settings import mask_sensitive_payload, mask_sensitive_text


CREATE = 'forms.create_dynamic_record_draft'
UPDATE = 'forms.update_record'
RECORD_TOOLS = frozenset({CREATE, UPDATE})
TEXT_FIELDS = frozenset({'string', 'text', 'code'})
NUMBER_FIELDS = frozenset({'integer', 'int', 'number', 'decimal', 'float'})
DRAFT_METADATA = frozenset({'form_id', 'form_code', 'target_form_code', 'record_id', 'payload', 'record', 'record.data', 'data'})


class RecordReviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirmation_token: str = Field(min_length=1, max_length=200)
    action_index: int = Field(ge=0, strict=True)


class RecordReviewEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action_index: int = Field(ge=0, strict=True)
    data: dict[str, JsonValue] = Field(min_length=1, max_length=500)


class RecordReviewEditRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirmation_token: str = Field(min_length=1, max_length=200)
    edits: list[RecordReviewEdit] = Field(min_length=1, max_length=100)


def _owner(user):
    return str(user.get('sub') or user.get('username') or user.get('uid') or '')


async def _load_run(db, run_id, user, token, *, lock=False):
    tenant_id = current_tenant_id(user)
    query = select(AIAgentRun).where(AIAgentRun.run_id == run_id, AIAgentRun.tenant_id == tenant_id)
    row = await db.scalar(query.with_for_update() if lock else query)
    confirmation = (row.confirmation_payload or extract_confirmation_payload(row.items)) if row is not None else {}
    if not confirmation or str(confirmation.get('user')) != _owner(user):
        raise HTTPException(404, '待确认操作不存在')
    if row.status != 'waiting_confirmation' or confirmation.get('confirmation_token') != token:
        raise HTTPException(409, '确认卡片已更新或操作已结束，请刷新后重试')
    if confirmation.get('expires_at') and datetime.fromisoformat(confirmation['expires_at']) < datetime.now():
        raise HTTPException(409, '确认卡片已过期，请重新生成')
    return row, deepcopy(row.actions or confirmation.get('actions') or [])


def _action_at(actions, index):
    if index >= len(actions):
        raise HTTPException(422, '待确认操作不存在')
    action = actions[index]
    payload = action.get('payload') or {}
    if payload.get('_harness_tool') not in RECORD_TOOLS:
        raise HTTPException(422, '当前操作不支持编辑业务字段')
    return action


def _draft_data(payload):
    """Locate the same nested input used by the draft executor."""
    while nested := next((payload[key] for key in ('record.data', 'data', 'record')
                          if isinstance(payload.get(key), dict) and payload[key]), None):
        payload = nested
    return payload


def _select_options(field):
    options = field.enum_values or []
    if isinstance(options, str):
        from app.services.static_options import parse_options
        try:
            options = parse_options(options)
        except ValueError:
            options = []
    if isinstance(options, dict):
        options = options.get('values', options)
    if isinstance(options, dict):
        options = [{'value': key, 'label': value} for key, value in options.items()]
    if not isinstance(options, list):
        return []
    pairs = []
    for item in options:
        value = item.get('value') if isinstance(item, dict) else item
        if type(value) in {str, float, int} and mask_sensitive_payload(value) == value:
            label = item.get('label', value) if isinstance(item, dict) else value
            pairs.append({'value': value, 'label': mask_sensitive_text(str(label))})
    return pairs


def _kind(field):
    ui = form_rules.config(field)
    control = ui.get('controlType')
    if form_rules.relation(field):
        return 'relation'
    if control in {'textarea', 'number', 'select'}:
        return control
    if control not in {None, 'field', 'text', 'code'}:
        return 'readonly'
    if field.field_type in NUMBER_FIELDS:
        return 'number'
    if field.field_type == 'enum':
        return 'select'
    if field.field_type in TEXT_FIELDS:
        return 'textarea' if field.field_type == 'text' else 'text'
    return 'readonly'


def _display(value):
    if value in (None, '', []):
        return ''
    if isinstance(value, list):
        return '、'.join(_display(item) for item in value)
    if isinstance(value, dict):
        return '结构化值'
    return mask_sensitive_text(str(value))


def _form_data(payload, fields):
    data = {field.field_name: _pick_payload_value(payload, field) for field in fields}
    return {key: value for key, value in data.items() if value not in (None, '', [], {})}


async def _state(db, user, settings, action):
    payload = action['payload']
    tool = payload['_harness_tool']
    decision = decide_tool_permission(user, settings, tool)
    if not decision.allowed:
        raise HTTPException(403, decision.reason)
    cache = {}
    if tool == CREATE:
        form = await resolve_dynamic_record_form(db, tenant_id=current_tenant_id(user), skill='forms.create_record_draft', payload=payload)
        if form is None:
            raise HTTPException(404, '待填写的表单不存在')
        await records.require_form_permission(db, user, form.id, 'create', cache=cache)
        await require_action(db, user, form, 'saveDraft', cache=cache)
        record = {'data': {}, 'created_by': current_user_id(user)}
        source, permission = _draft_data(payload), 'create'
    else:
        form = await records.resolve_form(db, user, form_code=payload.get('form_code'))
        record = await records.read_raw(db, form, payload['record_id'])
        await records.require_record_permission(db, user, form, 'view', record, cache=cache)
        source, permission = payload.get('data') or {}, 'edit'
        expected = payload.get('expected_values')
        if not isinstance(expected, dict) or set(expected) != set(source):
            raise HTTPException(409, '缺少原始记录快照，请重新生成待确认操作')
        if any(record['data'].get(key) != value for key, value in expected.items()):
            raise HTTPException(409, '待修改字段已发生变化，请重新读取并确认后再修改')

    all_fields = await records.runtime_fields(db, form, cache=cache)
    fields = {field.field_name: field for field in all_fields if not field.archived}
    proposed = {key: value for key, value in source.items() if key in fields and (source is not payload or key not in DRAFT_METADATA)}
    incoming = _form_data(payload, fields.values()) if tool == CREATE else proposed
    merged = {**record['data'], **incoming}
    permission_record = {**record, 'data': merged} if tool == CREATE else record
    await records.require_form_permission(db, user, form.id, permission, cache=cache)
    await records.require_record_permission(db, user, form, permission, permission_record, cache=cache)
    original_scope = records.policy_data(permission_record)
    writable = await allowed_form_fields(user, form.id, permission, all_fields, db, record_data=original_scope, cache=cache)
    readable = await allowed_form_fields(user, form.id, 'view', all_fields, db, record_data=original_scope, cache=cache)
    _, presentation = await field_policies.presentation(db, user, all_fields, merged, cache=cache)
    node = await current_policy(db, user, form, record.get('id'), cache=cache)
    states = form_rules.states(fields.values(), merged)
    for key, flags in (await field_settings(db, user, all_fields, cache=cache)).items():
        if key in states and states[key]['visible'] and not states[key]['generated'] and flags.get('required'):
            states[key]['required'] = True
    baseline_hidden = set()
    if tool == UPDATE:
        _, original_presentation = await field_policies.presentation(db, user, all_fields, record['data'], cache=cache)
        baseline_hidden = {key for key, flags in original_presentation.items() if flags.get('masked')}
    derived = {
        target for field in fields.values() if form_rules.config(field).get('assignmentRulesEnabled') is not False
        for target in [*((form_rules.relation(field) or {}).get('backfill') or {}),
                       *(rule.get('targetField') for rule in form_rules.config(field).get('assignmentRules') or [])]
    }
    hidden = {
        key for key in fields if key not in readable or not states[key]['visible'] or key in baseline_hidden
        or presentation.get(key, {}).get('masked')
        or (isinstance(node.get(key), dict) and node[key].get('visible') is False)
        or mask_sensitive_payload(merged.get(key), key_hint=key) != merged.get(key)
    }
    editable = {
        key for key in proposed if key in writable and key not in hidden and key not in derived
        and not states[key]['readonly'] and _kind(fields[key]) != 'readonly'
        and not (isinstance(node.get(key), dict) and node[key].get('editable') is False)
    }
    return SimpleNamespace(form=form, record=record, incoming=incoming, merged=merged, fields=fields,
                           proposed=proposed, editable=editable, hidden=hidden, states=states,
                           writable=writable, tool=tool, cache=cache)


async def _describe(db, user, state, *, include_options):
    result = []
    safe_context = {key: value for key, value in state.merged.items() if key not in state.hidden}
    for key in state.proposed:
        field = state.fields[key]
        type_settings = form_rules.config(field).get('typeSettings') or {}
        protected = key in state.hidden
        readonly = key not in state.editable
        value = None if protected else state.incoming.get(key)
        kind = _kind(field)
        descriptor = {
            'name': key, 'label': mask_sensitive_text(field.label or key),
            'kind': 'readonly' if readonly else kind,
            'value': value, 'readonly': readonly,
            'required': False if protected else state.states[key]['required'],
        }
        display = '受权限保护' if protected else _display(value)
        if not protected and kind == 'select':
            options = _select_options(field)
            choices = {str(item['value']): item['label'] for item in options}
            if isinstance(value, list):
                display = '、'.join(choices.get(str(item), _display(item)) for item in value)
            else:
                display = choices.get(str(value), display)
            if not readonly and include_options:
                descriptor.update(options=options, multiple=type_settings.get('selectionMode') == 'multiple' or type_settings.get('displayMode') == 'tags')
        elif not protected and kind == 'relation':
            try:
                if value not in (None, ''):
                    selected = await form_rules.archive_options(db, user, field, safe_context, selected=value)
                    display = mask_sensitive_text(str(selected[0]['label'])) if selected else '所选档案不可访问'
                    if not selected:
                        descriptor['value'] = None
                if include_options and not readonly:
                    ref = form_rules.relation(field)
                    if ref.get('source_kind') not in {'dictionary', 'externalApi'}:
                        options = await form_rules.archive_options(db, user, field, safe_context, search={'page_size': 20})
                        descriptor['options'] = [{'value': item['id'], 'label': mask_sensitive_text(str(item['label']))} for item in options]
            except HTTPException as exc:
                if exc.status_code not in {403, 404, 422}:
                    raise
                descriptor.update(kind='readonly', readonly=True, value=None)
                display = '档案来源不可访问'
        for source, output in (('min', 'min'), ('max', 'max'), ('precision', 'precision'), ('maxLength', 'max_length'), ('unit', 'unit')):
            if not readonly and source in type_settings:
                descriptor[output] = type_settings[source]
        if not readonly and field.field_type in {'integer', 'int'}:
            descriptor['precision'] = 0
        descriptor['display_value'] = display
        result.append(descriptor)
    return result


async def review_record_fields(run_id, request: RecordReviewRequest, user, settings):
    async with db_session() as db:
        _, actions = await _load_run(db, run_id, user, request.confirmation_token)
        state = await _state(db, user, settings, _action_at(actions, request.action_index))
        dependencies = set()
        for key in state.editable:
            field = state.fields[key]
            if ref := form_rules.relation(field):
                dependencies.add(ref.get('cascade_from'))
                dependencies.update(item.get('sourceField') for item in (ref.get('filters') or []) if isinstance(item, dict))
                dependencies.update(item.get('sourceField') for item in (option_search_settings(field).get('filters') or []) if isinstance(item, dict))
        context_data = {key: value for key, value in state.merged.items()
                        if key in dependencies and key not in state.hidden and type(value) in {str, int, float, bool}}
        return {'form_id': state.form.id, 'form_name': mask_sensitive_text(state.form.name), 'form_code': state.form.code,
                'record_id': state.record.get('id'), 'context_data': context_data,
                'fields': await _describe(db, user, state, include_options=True)}


def _field_error(field, label, message):
    return HTTPException(422, {'message': message, 'issues': [{'field': field, 'message': message, 'label': label}]})


def _check_value(field, value):
    kind = _kind(field)
    ui = form_rules.config(field).get('typeSettings') or {}
    multiple = ui.get('selectionMode') == 'multiple' or ui.get('displayMode') == 'tags'
    if value is None:
        return
    if type(value) is float and not isfinite(value):
        raise _field_error(field.field_name, field.label, f'字段「{field.label}」需要有效数值')
    if kind in {'text', 'textarea'} and not isinstance(value, str):
        raise _field_error(field.field_name, field.label, f'字段「{field.label}」需要文本')
    if kind == 'number' and (type(value) not in {int, float} or (field.field_type in {'integer', 'int'} and type(value) is not int)):
        raise _field_error(field.field_name, field.label, f'字段「{field.label}」需要有效数值')
    if kind == 'relation' and type(value) not in {int, str}:
        raise _field_error(field.field_name, field.label, f'字段「{field.label}」需要有效档案 ID')
    if kind == 'select' and value != '':
        valid = isinstance(value, list) and all(type(item) in {str, int, float} for item in value) if multiple else type(value) in {str, int, float}
        if not valid:
            raise _field_error(field.field_name, field.label, f'字段「{field.label}」需要有效选项')
        options = _select_options(field)
        if options and not ui.get('allowCreateOption'):
            allowed = {str(item['value']) for item in options}
            if any(str(item) not in allowed for item in (value if multiple else [value])):
                raise _field_error(field.field_name, field.label, f'字段「{field.label}」包含未配置的选项')


async def _validate(db, user, settings, action, state):
    payload = action['payload']
    fields = list(state.fields.values())
    existing = state.record['data'] if state.tool == UPDATE else None
    incoming = state.incoming
    records.validate_business_keys(incoming)
    if set(incoming) - state.writable:
        raise HTTPException(403, '当前角色无权保存提案中的部分字段')
    if state.tool == UPDATE:
        validate_domain_update(state.form.code, incoming)
        if state.form.code == 'material-application':
            raise HTTPException(409, '料号申请请通过专用入口修改')
        await field_policies.protect_update(db, user, fields, incoming, existing, cache=state.cache)
    else:
        incoming = prepare_domain_create(state.form.code, incoming, user)
    try:
        validated = await form_rules.evaluate(db, user, fields, incoming, existing=existing,
                                              enforce=True, partial=state.tool == CREATE, cache=state.cache)
        _validate_record_data(validated['fields'], validated['data'], partial=state.tool == CREATE)
    except HTTPException as exc:
        if exc.status_code == 422 and isinstance(exc.detail, str):
            field = next((field for field in fields if f'「{field.label}」' in exc.detail
                          or exc.detail.startswith(f'Field {field.field_name} ')), None)
            if field:
                raise _field_error(field.field_name, field.label, mask_sensitive_text(exc.detail)) from exc
        raise
    await records.require_record_permission(db, user, state.form, 'create' if state.tool == CREATE else 'edit',
                                            {**state.record, 'data': validated['data']}, cache=state.cache)
    validation = agent_validation_service.validate_tool_payload(tool_name=state.tool, payload=payload, settings=settings)
    if not validation.valid:
        raise HTTPException(422, {'message': validation.summary(), 'issues': [issue.as_dict() for issue in validation.errors]})


def _public_record_action(action, state=None, fields=None):
    payload = action['payload']
    public = {'_harness_tool': payload['_harness_tool']}
    if state is not None:
        public.update(form_id=state.form.id, form_code=state.form.code)
        if state.record.get('id') is not None:
            public['record_id'] = state.record['id']
        public['_preview'] = {'target': mask_sensitive_text(state.form.name), 'fields': {field['label']: field['display_value'] for field in (fields or [])}}
    return {**action, 'payload': public}


async def revise_record_review(run_id, request: RecordReviewEditRequest, user, settings):
    async with db_session() as db:
        row, actions = await _load_run(db, run_id, user, request.confirmation_token, lock=True)
        reviewed = {}
        for edit in request.edits:
            if edit.action_index in reviewed:
                raise HTTPException(422, '同一待确认操作不能重复编辑')
            action = _action_at(actions, edit.action_index)
            original = await _state(db, user, settings, action)
            source = _draft_data(action['payload']) if original.tool == CREATE else action['payload']['data']
            for key, value in edit.data.items():
                if key not in original.editable:
                    raise HTTPException(403, '该字段未在原提案中或不可编辑')
                _check_value(original.fields[key], value)
                source[key] = value
            state = await _state(db, user, settings, action)
            if set(edit.data) - state.editable:
                raise HTTPException(403, '变更后的字段规则不允许编辑其中的字段')
            if state.tool == CREATE and any(value in (None, '') and state.incoming.get(key) not in (None, '')
                                            for key, value in edit.data.items()):
                raise HTTPException(422, '当前字段会自动使用默认值，无法清空')
            await _validate(db, user, settings, action, state)
            reviewed[edit.action_index] = _public_record_action(action, state, await _describe(db, user, state, include_options=False))

        public_actions = []
        for index, action in enumerate(actions):
            if index in reviewed:
                public_actions.append(reviewed[index])
                continue
            if (action.get('payload') or {}).get('_harness_tool') not in RECORD_TOOLS:
                public_actions.append(action)
                continue
            try:
                state = await _state(db, user, settings, action)
                public_actions.append(_public_record_action(action, state, await _describe(db, user, state, include_options=False)))
            except HTTPException as exc:
                if exc.status_code not in {403, 404, 409, 422}:
                    raise
                public_actions.append(_public_record_action(action))

        updated = create_confirmation_payload(user=user, actions=actions, evidence=row.evidence, risk_level=row.risk_level)
        display = confirmation_item(confirmation_payload={**updated, 'actions': public_actions, 'evidence': []}, run_id=run_id)
        items = [item for item in (row.items or []) if item.get('type') != 'confirmation'] + [display]
        result = await db.execute(update(AIAgentRun).where(*waiting_confirmation_unchanged(row))
                                  .values(items=items, actions=actions, confirmation_payload=updated))
        if result.rowcount != 1:
            raise HTTPException(409, '确认卡片已更新或操作已结束，请刷新后重试')
        conversation = await db.scalar(select(AIConversation).where(
            AIConversation.conversation_id == row.conversation_id,
            AIConversation.tenant_id == row.tenant_id, AIConversation.user_id == _owner(user)))
        if conversation:
            first = public_actions[request.edits[0].action_index]
            conversation.metadata_json = {**(conversation.metadata_json or {}),
                'pending_action_state': {'skill': first['skill'], 'status': 'ready_for_confirmation',
                    'collected_slots': first['payload'], 'missing_slots': []}}
        await db.commit()
        if run_id in AGENT_RUNS:
            AGENT_RUNS[run_id].update(items=items, actions=actions)
        return {'run_id': run_id, 'items': [display], 'requires_confirmation': True}
