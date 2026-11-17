"""Owner-bound calls to existing page controllers; never business writes."""
import asyncio
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import Form, FormField
from .agent_items import build_agent_item
from .policies import decide_ai_permission
from .policies import action_is_forbidden
from .permission_resolver import PermissionResolver, PermissionDecision, build_default_rules, load_permission_rules
from .form_menu_tools import FormMenuTarget, resolve_menu_target
from .settings import mask_sensitive_text

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


ControlId = Annotated[str, Field(min_length=1, max_length=120)]
NewControlId = Annotated[str, Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,62}$')]


class LayoutTab(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    id: NewControlId
    label: str = Field(min_length=1, max_length=80)


class LayoutSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    columns: int | None = Field(default=None, ge=2, le=4)
    ratios: list[Annotated[int, Field(ge=1, le=12)]] | None = Field(default=None, min_length=2, max_length=4)
    gap: int | None = Field(default=None, ge=0, le=40)
    collapsible: bool | None = None
    defaultCollapsed: bool | None = None
    tabs: list[LayoutTab] | None = Field(default=None, min_length=1, max_length=12)

    @model_validator(mode='after')
    def unique_slots(self):
        if self.tabs and len({tab.id for tab in self.tabs}) != len(self.tabs):
            raise ValueError('页签 ID 不能重复')
        return self


class LayoutProperties(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    width: Literal['quarter', 'third', 'half', 'twoThird', 'threeQuarter', 'full'] | None = None
    visible: bool | None = None
    layout: LayoutSettings | None = None


class LayoutPlacement(BaseModel):
    model_config = ConfigDict(extra='forbid')
    parent_id: ControlId | None = None
    slot_id: ControlId | None = None
    before_id: ControlId | None = None

    @model_validator(mode='after')
    def validate_slot(self):
        if self.slot_id and not self.parent_id:
            raise ValueError('slot_id 需要 parent_id')
        return self


class AddLayoutControl(LayoutPlacement):
    op: Literal['add']
    control_id: NewControlId
    control_type: Literal['container', 'two-columns', 'tabs', 'divider']
    properties: LayoutProperties | None = None


class UpdateLayoutControl(BaseModel):
    model_config = ConfigDict(extra='forbid')
    op: Literal['update']
    control_id: ControlId
    properties: LayoutProperties

    @model_validator(mode='after')
    def require_changes(self):
        if not self.properties.model_dump(exclude_none=True):
            raise ValueError('至少提供一项布局控件属性')
        return self


class MoveLayoutControl(LayoutPlacement):
    op: Literal['move']
    control_id: ControlId | None = None
    field_name: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode='after')
    def require_target(self):
        if bool(self.control_id) == bool(self.field_name):
            raise ValueError('移动需要指定 control_id 或 field_name，两者只能传一个')
        return self


LayoutOperation = Annotated[AddLayoutControl | UpdateLayoutControl | MoveLayoutControl, Field(discriminator='op')]


class NewFormDraft(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(pattern=r'^[a-z][a-z0-9_]{0,62}$')
    description: str = Field(default='', max_length=1000)
    fields: list[DraftField] = Field(min_length=1, max_length=60)
    menu_target: FormMenuTarget | None = None
    layout_operations: list[LayoutOperation] | None = Field(default=None, min_length=1, max_length=60)

    @model_validator(mode='after')
    def unique_fields(self):
        if len({field.field_name for field in self.fields}) != len(self.fields):
            raise ValueError('字段编码不能重复')
        return self


class PageControlRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['draft_new', 'configure_fields', 'add_field', 'open', 'select_field', 'set_field_properties', 'preview', 'inspect_layout', 'configure_layout']
    form_id: int | None = Field(default=None, gt=0)
    form_code: str | None = Field(default=None, max_length=100)
    draft_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    draft: NewFormDraft | None = None
    new_field: DraftField | None = None
    changes: list[FieldChange] | None = Field(default=None, min_length=1, max_length=20)
    layout_operations: list[LayoutOperation] | None = Field(default=None, min_length=1, max_length=60)
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
        if (self.action == 'configure_layout') != bool(self.layout_operations):
            raise ValueError('只有 configure_layout 接受且必须提供 layout_operations')
        if self.action in {'configure_layout', 'inspect_layout'} and (self.field_name or self.properties):
            raise ValueError('布局操作请使用 layout_operations，不能传字段属性')
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


def designer_permission_error(user, settings):
    decision = decide_ai_permission(user, settings, 'config', domain='low-code', skill=TOOL)
    if not user.get('is_admin') or not decision.allowed:
        reason = decision.reason if not decision.allowed else '需要管理员权限'
        if reason == '业务域未开放':
            return '低代码业务域未开放。请在「AI 与平台设置 → 执行与安全 → 开放业务范围」启用「低代码」后重试。'
        return '当前用户无权操作表单设计器：' + reason
    resolved, reason = PermissionResolver(build_default_rules() + load_permission_rules(settings)).resolve(TOOL, user, 'low', 'low-code')
    if resolved == PermissionDecision.DENY or action_is_forbidden(settings, TOOL, side_effect='read'):
        return reason or '页面调用已被策略禁用'
    return None


PAGE_ACTION_TITLES = {
    'draft_new': '搭建表单草稿',
    'add_field': '新增字段',
    'set_field_properties': '调整字段属性',
    'review': '复核表单草稿',
    'open': '打开表单设计器',
    'select_field': '选中字段',
    'preview': '打开表单预览',
    'inspect_layout': '读取表单布局',
    'configure_layout': '调整表单布局',
    'inspect': '读取页面组件',
    'apply': '更新页面组件',
}


def _validate_page_receipt(command, receipt):
    if not receipt.get('ok') or command['type'] != 'form_designer':
        return receipt
    draft = command.get('draft')
    state = receipt.get('state') or {}
    if command['action'] == 'draft_new':
        expected = {field['field_name'] for field in draft['fields']}
        actual = {field.get('field_name') for field in state.get('fields', [])}
        if state.get('draft_id') != command['draft_id'] or actual != expected or not state.get('review_ready'):
            return {**receipt, 'ok': False, 'error': '设计器回执未确认全部字段已加入草稿，请在当前画布检查字段后继续。'}
    operations = (draft or command).get('layout_operations')
    if command['action'] in {'draft_new', 'configure_layout'} and operations and state.get('layout_operation_count') != len(operations):
        return {**receipt, 'ok': False, 'error': '设计器未确认全部布局操作，请核对当前画布。'}
    return receipt


async def dispatch_page_action(bridge, command):
    action_id = command['id']
    title = PAGE_ACTION_TITLES[command['action']]
    field = (command.get('field') or {}).get('label') or command.get('field_name')
    if field:
        title += f'「{mask_sensitive_text(field)[:80]}」'
    item = build_agent_item(type='page_action', item_id=action_id, title=title, status='running')

    async def finish(status, summary=''):
        result = {**item, 'status': status, 'summary': summary}
        bridge.items.append(result)
        await bridge.event_sink('item.updated', result)

    future = asyncio.get_running_loop().create_future()
    bridge.page_actions[action_id] = future
    try:
        await bridge.event_sink('item.created', item)
        await bridge.event_sink('ui.action', command)
        try:
            receipt = await asyncio.wait_for(future, timeout=20)
        except asyncio.TimeoutError:
            await bridge.event_sink('ui.action.cancel', {'id': action_id})
            await finish('timeout', '等待画布回执超时，请检查当前草稿。')
            raise
        receipt = _validate_page_receipt(command, receipt)
        if receipt.get('ok'):
            await finish('completed')
        else:
            await finish('failed', mask_sensitive_text(receipt.get('error') or '画布操作失败')[:240])
        return receipt
    finally:
        bridge.page_actions.pop(action_id, None)


async def call_page_control(bridge, arguments):
    try:
        request = PageControlRequest.model_validate(arguments)
    except ValueError as exc:
        return {'status': 'validation_failed', 'message': str(exc)}
    if error := designer_permission_error(bridge.user, bridge.settings):
        return {'status': 'blocked', 'message': error}
    if request.action == 'draft_new':
        async with db_session() as db:
            existing = await db.scalar(select(Form).where(Form.tenant_id == bridge.user['tenant_id'], Form.code == request.draft.code))
            if existing:
                return {'status': 'validation_failed', 'message': '表单编码已存在，请为新表单选择另一个编码；不得打开或覆盖同名已有表单。'}
            menu_target = None
            if request.draft.menu_target:
                from fastapi import HTTPException
                try:
                    app, parent = await resolve_menu_target(db, bridge.user['tenant_id'], request.draft.menu_target)
                except HTTPException as error:
                    return {'status': 'validation_failed', 'message': str(error.detail)}
                menu_target = {**request.draft.menu_target.model_dump(exclude_none=True),
                    'destination': ' / '.join([app.name, *([parent.title] if parent else []), request.draft.menu_target.menu_title or request.draft.name])}
        action = {'id': uuid.uuid4().hex, 'type': 'form_designer', 'form_id': 0,
                  'draft_id': uuid.uuid4().hex, 'action': request.action, 'draft': request.draft.model_dump(exclude_none=True)}
        if menu_target:
            action['draft']['menu_target'] = menu_target
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
    if request.layout_operations:
        action['layout_operations'] = [operation.model_dump(exclude_none=True) for operation in request.layout_operations]

    async def dispatch(command):
        return await dispatch_page_action(bridge, command)

    try:
        if request.action == 'configure_fields':
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
            if action.get('draft_id') or request.action in {'inspect_layout', 'configure_layout'}:
                previous = bridge.context.get('designerContext') or {}
                if previous.get('form_id') != (action['form_id'] or None) or previous.get('draft_id') != action.get('draft_id'):
                    previous = {}
                bridge.context['designerContext'] = {**previous, **(result.get('state') or {}),
                    'draft_id': action.get('draft_id'), 'form_id': action['form_id'] or None}
            if request.action in {'draft_new', 'configure_fields', 'add_field', 'set_field_properties'}:
                bridge.configuration_outcome = {'status': 'ui_draft', 'reason': '已在现有设计器更新本地草稿，请复核工作区并点击最终确认卡片。'}
            elif request.action == 'configure_layout':
                bridge.configuration_outcome = {'status': 'ui_draft', 'reason': '布局已更新在设计器草稿，请复核画布后保存草稿。'}
            elif (bridge.configuration_outcome or {}).get('status') != 'ui_draft':
                messages = {'open': '已打开现有表单设计器，未修改、保存或发布。',
                            'select_field': '已在现有设计器选中指定字段，未保存或发布。',
                            'preview': '已打开现有设计器的表单预览，未保存或发布。',
                            'inspect_layout': '已读取画布控件和位置。'}
                bridge.configuration_outcome = {'status': 'ui_page', 'reason': messages[request.action]}
        return {'status': 'completed' if result.get('ok') else 'blocked',
                'result': result.get('state') or {}, 'message': result.get('error') or
                ('已读取当前表单画布。' if request.action == 'inspect_layout' else
                 '布局仅已应用到当前画布，请复核并保存草稿。' if request.action == 'configure_layout' else
                 '页面调用已完成。修改仅存在于当前设计器，未保存或发布；等待用户点击最终确认卡片。')}
    except asyncio.TimeoutError:
        return {'status': 'blocked', 'message': '等待页面操作回执超时，已通知页面移除该操作。页面可能保留部分草稿修改，请检查当前设计器；未检测到是否存在未保存修改弹窗，不要据此认定有弹窗，也不要直接重复新建草稿。'}


def page_control_model_result(result: dict) -> dict:
    """Keep full receipts in the browser/bridge; send a compact acknowledgement to the model.

    Repeating the entire designer and every field's rules after each change grows
    the SDK history with successive copies of the same draft. Never summarize
    failures, whose diagnostics are needed to decide whether execution can continue.
    """
    if result.get('status') != 'completed':
        return result
    state = result.get('result') or {}
    compact = {key: state[key] for key in ('draft_id', 'form_id', 'form_code', 'saved', 'published') if key in state}
    for key in ('layout_controls', 'layout_operation_count'):
        if key in state:
            compact[key] = state[key]
    fields = state.get('fields')
    if isinstance(fields, list):
        compact['field_count'] = len(fields)
        compact['fields'] = [{key: item[key] for key in ('field_name', 'label', 'field_type', 'required') if key in item}
                             for item in fields if isinstance(item, dict)]
    return {**result, 'result': compact}


class PageControlResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ok: bool
    state: dict = Field(default_factory=dict)
    error: str | None = Field(default=None, max_length=500)
