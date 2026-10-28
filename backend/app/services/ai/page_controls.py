"""Owner-bound calls to existing page controllers; never business writes."""
import asyncio
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import Form, FormField
from .policies import decide_ai_permission
from .policies import action_is_forbidden
from .permission_resolver import PermissionResolver, PermissionDecision, build_default_rules, load_permission_rules

TOOL = 'ui.form_designer'


class Choice(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=80)


class EncodingSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    prefix: str = Field(default='NO', max_length=20, pattern=r'^[A-Za-z0-9_-]*$')
    date_pattern: Literal['YYYYMMDD', 'YYMMDD', 'YYYYMM', 'YYMM'] = 'YYYYMMDD'
    sequence_length: int = Field(default=4, ge=1, le=10)
    reset_cycle: Literal['day', 'month', 'year', 'none'] = 'day'


class InputSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    rows: int | None = Field(default=None, ge=2, le=12)
    maxLength: int | None = Field(default=None, ge=1, le=10000)
    precision: int | None = Field(default=None, ge=0, le=6)
    unit: str | None = Field(default=None, max_length=12)
    displayMode: Literal['dropdown', 'radio', 'tags'] | None = None
    selectionMode: Literal['single', 'multiple'] | None = None
    maxFiles: int | None = Field(default=None, ge=1, le=20)
    maxFileSize: int | None = Field(default=None, ge=1, le=50)
    fileTypes: str | None = Field(default=None, max_length=100)
    checkedText: str | None = Field(default=None, max_length=20)
    uncheckedText: str | None = Field(default=None, max_length=20)


class Presentation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    startNewRow: bool | None = None
    labelPosition: Literal['top', 'left'] | None = None
    labelAlign: Literal['left', 'right'] | None = None
    spacingAfter: int | None = Field(default=None, ge=0, le=48)
    borderRadius: int | None = Field(default=None, ge=0, le=24)
    fontSize: int | None = Field(default=None, ge=10, le=24)
    labelFontSize: int | None = Field(default=None, ge=10, le=24)
    controlHeight: int | None = Field(default=None, ge=24, le=64)


class FieldProperties(BaseModel):
    model_config = ConfigDict(extra='forbid')
    label: str | None = Field(default=None, min_length=1, max_length=200)
    required: bool | None = None
    readonly: bool | None = None
    placeholder: str | None = Field(default=None, max_length=500)
    min: float | None = None
    max: float | None = None
    control_type: Literal['text', 'textarea', 'code', 'number', 'select', 'datetime', 'switch', 'upload'] | None = None
    width: Literal['quarter', 'third', 'half', 'twoThird', 'threeQuarter', 'full'] | None = None
    position: int | None = Field(default=None, ge=0, le=59)
    help_text: str | None = Field(default=None, max_length=500)
    options: list[Choice] | None = Field(default=None, min_length=1, max_length=30)
    settings: InputSettings | None = None
    presentation: Presentation | None = None
    encoding: EncodingSettings | None = None

    @model_validator(mode='after')
    def validate_properties(self):
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError('最小值不能大于最大值')
        if self.options and len({choice.value for choice in self.options}) != len(self.options):
            raise ValueError('候选项的值不能重复')
        return self


class DraftField(FieldProperties):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    field_name: str = Field(pattern=r'^[a-z][a-z0-9_]{0,62}$')
    label: str = Field(min_length=1, max_length=200)
    field_type: Literal['string', 'text', 'integer', 'decimal', 'date', 'datetime', 'code', 'enum', 'attachment', 'boolean'] = 'string'
    required: bool = False
    placeholder: str = Field(default='', max_length=500)

    @model_validator(mode='after')
    def validate_native_type(self):
        if self.field_type == 'enum' and not self.options:
            raise ValueError('选择字段必须提供有效候选项')
        if self.encoding and self.field_type != 'code':
            raise ValueError('自动编号规则只能用于 code 字段')
        if self.field_type == 'code' and self.readonly is False:
            raise ValueError('自动编号不能允许人工修改')
        return self


class FieldChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    field_name: str | None = None
    properties: FieldProperties | None = None
    new_field: DraftField | None = None

    @model_validator(mode='after')
    def validate_change(self):
        if self.new_field:
            if self.field_name or self.properties:
                raise ValueError('新增与修改必须分别描述')
        elif not self.field_name or not self.properties or not self.properties.model_dump(exclude_none=True):
            raise ValueError('修改需要 field_name 和 properties')
        return self


class NewFormDraft(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(pattern=r'^[a-z][a-z0-9_]{0,62}$')
    description: str = Field(default='', max_length=1000)
    fields: list[DraftField] = Field(min_length=1, max_length=60)

    @model_validator(mode='after')
    def unique_fields(self):
        if len({field.field_name for field in self.fields}) != len(self.fields):
            raise ValueError('字段编码不能重复')
        return self


class PageControlRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['draft_new', 'configure_fields', 'add_field', 'open', 'select_field', 'set_field_properties', 'preview']
    form_id: int | None = Field(default=None, gt=0)
    form_code: str | None = Field(default=None, max_length=100)
    draft_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    draft: NewFormDraft | None = None
    new_field: DraftField | None = None
    changes: list[FieldChange] | None = Field(default=None, min_length=1, max_length=20)
    field_name: str | None = Field(default=None, max_length=100)
    properties: FieldProperties | None = None

    @model_validator(mode='after')
    def validate_target(self):
        if self.action == 'draft_new':
            if not self.draft or self.form_id or self.form_code or self.draft_id:
                raise ValueError('新建草稿必须提供 draft，不能指定已有表单或草稿')
        elif self.draft:
            raise ValueError('只有 draft_new 接受新表单定义')
        elif self.draft_id:
            if self.form_id or self.form_code:
                raise ValueError('不能同时指定新草稿和已有表单')
        elif not self.form_id and not self.form_code:
            raise ValueError('必须指定已有表单的 form_id、form_code 或当前 draft_id')
        if self.action == 'configure_fields' and (not self.draft_id or not self.changes):
            raise ValueError('多字段配置需要当前 draft_id 和 changes')
        if self.action != 'configure_fields' and self.changes:
            raise ValueError('只有 configure_fields 接受 changes')
        if self.action == 'add_field' and (not self.draft_id or not self.new_field):
            raise ValueError('添加字段仅适用于当前新建草稿，需要 draft_id 和 new_field')
        if self.action != 'add_field' and self.new_field:
            raise ValueError('只有 add_field 接受 new_field')
        if self.action in {'select_field', 'set_field_properties'} and not self.field_name:
            raise ValueError('必须指定已有字段 field_name')
        if self.action == 'set_field_properties' and (not self.properties or not self.properties.model_dump(exclude_none=True)):
            raise ValueError('必须指定要修改的字段属性')
        if self.properties and self.properties.min is not None and self.properties.max is not None and self.properties.min > self.properties.max:
            raise ValueError('最小值不能大于最大值')
        return self


async def call_page_control(bridge, arguments):
    try:
        request = PageControlRequest.model_validate(arguments)
    except ValueError as exc:
        return {'status': 'validation_failed', 'message': str(exc)}
    # The designer uses the same admin/config boundary as native configuration.
    decision = decide_ai_permission(bridge.user, bridge.settings, 'config', domain='low-code', skill=TOOL)
    if not bridge.user.get('is_admin') or not decision.allowed:
        return {'status': 'blocked', 'message': '当前用户无权操作表单设计器：' + decision.reason}
    resolved, reason = PermissionResolver(build_default_rules() + load_permission_rules(bridge.settings)).resolve(TOOL, bridge.user, 'low', 'low-code')
    if resolved == PermissionDecision.DENY or action_is_forbidden(bridge.settings, TOOL, side_effect='read'):
        return {'status': 'blocked', 'message': reason or '页面调用已被策略禁用'}
    if request.action == 'draft_new':
        async with db_session() as db:
            existing = await db.scalar(select(Form).where(Form.tenant_id == bridge.user['tenant_id'], Form.code == request.draft.code))
            if existing:
                return {'status': 'validation_failed', 'message': '表单编码已存在，请为新表单选择另一个编码；不得打开或覆盖同名已有表单。'}
        action = {'id': uuid.uuid4().hex, 'type': 'form_designer', 'form_id': 0,
                  'draft_id': uuid.uuid4().hex, 'action': request.action, 'draft': request.draft.model_dump(exclude_none=True)}
    elif request.draft_id:
        context = bridge.context.get('designerContext') or {}
        if context.get('draft_id') != request.draft_id or context.get('form_id'):
            return {'status': 'blocked', 'message': '新建草稿不在当前设计器中，请使用当前页面的 draft_id'}
        if request.field_name and request.field_name not in {field.get('field_name') for field in context.get('fields', [])}:
            return {'status': 'validation_failed', 'message': '当前草稿中没有这个字段'}
        if request.action == 'configure_fields':
            known = {field.get('field_name') for field in context.get('fields', [])}
            for change in request.changes:
                if change.new_field:
                    if change.new_field.field_name in known or len(known) >= 60:
                        return {'status': 'validation_failed', 'message': '新增字段编码重复或达到字段上限'}
                    known.add(change.new_field.field_name)
                elif change.field_name not in known:
                    return {'status': 'validation_failed', 'message': '修改目标不在当前草稿中'}
        if request.action == 'add_field':
            fields = context.get('fields', [])
            if len(fields) >= 60 or any(field.get('field_name') == request.new_field.field_name for field in fields):
                return {'status': 'validation_failed', 'message': '字段编码重复或草稿已达到字段数量上限'}
        action = {'id': uuid.uuid4().hex, 'type': 'form_designer', 'form_id': 0,
                  'field': request.new_field.model_dump(exclude_none=True) if request.new_field else None,
                  'draft_id': request.draft_id, 'action': request.action, 'field_name': request.field_name,
                  'properties': request.properties.model_dump(exclude_none=True) if request.properties else {}}
    else:
        async with db_session() as db:
            query = select(Form).where(Form.tenant_id == bridge.user['tenant_id'])
            if request.form_id:
                query = query.where(Form.id == request.form_id)
            if request.form_code:
                query = query.where(Form.code == request.form_code)
            form = await db.scalar(query)
            if not form:
                return {'status': 'blocked', 'message': '已有表单不存在或不可访问'}
            if request.field_name:
                field = await db.scalar(select(FormField).where(FormField.form_id == form.id,
                    FormField.tenant_id == bridge.user['tenant_id'], FormField.field_name == request.field_name,
                    FormField.archived.is_(False)))
                if not field:
                    return {'status': 'validation_failed', 'message': '已有字段不存在，不能凭空创建字段'}
            action = {'id': uuid.uuid4().hex, 'type': 'form_designer', 'form_id': form.id,
                      'action': request.action, 'field_name': request.field_name,
                      'properties': request.properties.model_dump(exclude_none=True) if request.properties else {}}
    async def dispatch(command):
        future = asyncio.get_running_loop().create_future()
        bridge.page_actions[command['id']] = future
        try:
            await bridge.event_sink('ui.action', command)
            return await asyncio.wait_for(future, timeout=20)
        finally:
            bridge.page_actions.pop(command['id'], None)

    try:
        if request.action == 'draft_new':
            # Drive the native editor incrementally; each next step waits for React's receipt.
            fields = action['draft']['fields']
            action['draft'] = {**action['draft'], 'fields': []}
            result = await dispatch(action)
            for field in fields:
                if not result.get('ok'):
                    break
                result = await dispatch({'id': uuid.uuid4().hex, 'type': 'form_designer',
                    'form_id': 0, 'draft_id': action['draft_id'], 'action': 'add_field', 'field': field})
            if result.get('ok'):
                result = await dispatch({'id': uuid.uuid4().hex, 'type': 'form_designer',
                    'form_id': 0, 'draft_id': action['draft_id'], 'action': 'review'})
        elif request.action == 'configure_fields':
            result = {'ok': True}
            for change in request.changes:
                command = {'id': uuid.uuid4().hex, 'type': 'form_designer', 'form_id': 0, 'draft_id': request.draft_id}
                if change.new_field:
                    command.update(action='add_field', field=change.new_field.model_dump(exclude_none=True))
                else:
                    command.update(action='set_field_properties', field_name=change.field_name,
                        properties=change.properties.model_dump(exclude_none=True))
                result = await dispatch(command)
                if not result.get('ok'):
                    break
            if result.get('ok'):
                result = await dispatch({'id': uuid.uuid4().hex, 'type': 'form_designer', 'form_id': 0,
                    'draft_id': request.draft_id, 'action': 'review'})
        else:
            result = await dispatch(action)
            if result.get('ok') and request.draft_id and request.action in {'add_field', 'set_field_properties'}:
                result = await dispatch({'id': uuid.uuid4().hex, 'type': 'form_designer', 'form_id': 0,
                    'draft_id': request.draft_id, 'action': 'review'})
        if result.get('ok'):
            bridge.configuration_failure = None
            if action.get('draft_id'):
                bridge.context['designerContext'] = {**(bridge.context.get('designerContext') or {}),
                    **(result.get('state') or {}), 'draft_id': action['draft_id'], 'form_id': None}
            if request.action in {'draft_new', 'configure_fields', 'add_field', 'set_field_properties'}:
                bridge.configuration_outcome = {'status': 'ui_draft', 'reason': '已在现有设计器更新本地草稿，请复核工作区并点击最终确认卡片。'}
            elif (bridge.configuration_outcome or {}).get('status') != 'ui_draft':
                messages = {'open': '已打开现有表单设计器，未修改、保存或发布。',
                            'select_field': '已在现有设计器选中指定字段，未保存或发布。',
                            'preview': '已打开现有设计器的表单预览，未保存或发布。'}
                bridge.configuration_outcome = {'status': 'ui_page', 'reason': messages[request.action]}
        return {'status': 'completed' if result.get('ok') else 'blocked',
                'result': result.get('state') or {}, 'message': result.get('error') or
                '页面调用已完成。修改仅存在于当前设计器，未保存或发布；等待用户点击最终确认卡片。'}
    except asyncio.TimeoutError:
        return {'status': 'blocked', 'message': '页面没有完成操作，请保持网页打开并处理未保存修改提示后重试'}


class PageControlResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ok: bool
    state: dict = Field(default_factory=dict)
    error: str | None = Field(default=None, max_length=500)
