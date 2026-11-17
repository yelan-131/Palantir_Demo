"""Apply bounded component edits to the current browser's unsaved page draft."""
import asyncio
import uuid
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model, model_validator

from .page_controls import dispatch_page_action
from .permission_resolver import PermissionDecision, PermissionResolver, build_default_rules, load_permission_rules
from .policies import decide_ai_permission

TOOL = 'ui.component_page'
TOOL_DETAILS = {
    f'{TOOL}.inspect': ('查看画布', '读取当前画布的组件 ID、数据来源和配置。可指定组件 ID 查看详情。'),
    f'{TOOL}.add': ('添加组件', '在当前画布新增业务列表、指标卡或分组图表。widget_id 需唯一。'),
    f'{TOOL}.update_properties': ('修改组件属性', '修改指定组件的名称、尺寸、数据源、统计口径、列表或筛选配置。'),
    f'{TOOL}.update_appearance': ('调整组件外观', '修改指定组件的标题样式、配色、圆角或图表外观。'),
    f'{TOOL}.set_interaction': ('设置组件交互', '设置图表点击行为和同来源联动目标。'),
}


class Operation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    widget_id: str = Field(min_length=1, max_length=100, pattern=r'^[\w-]+$')


class AddWidget(Operation):
    action: Literal['add']
    widget_type: Literal['record-list', 'metric', 'chart']


def patch_model(name, source, fields):
    # Reuse the editor API's validation. Omitted keys stay omitted when dispatched.
    return create_model(name, __config__=ConfigDict(extra='forbid'), **{
        key: (Annotated[source.model_fields[key].annotation, *source.model_fields[key].metadata]
              if source.model_fields[key].metadata else source.model_fields[key].annotation, None)
        for key in fields
    })


@lru_cache(maxsize=1)
def component_models():
    # Import lazily so the component API can keep using the AI services independently.
    from app.services.component_page_definitions import FilterSettings, ListSettings, PageWidget, WidgetAppearance

    properties = patch_model('ComponentProperties', PageWidget, (
        'title', 'width', 'dataBinding', 'dimension', 'measure', 'aggregate', 'expression',
        'customWidth', 'customHeight', 'height', 'showFilters', 'filterFields', 'chartType',
        'format', 'unit', 'threshold',
    ))
    appearance = patch_model('ComponentAppearance', WidgetAppearance, WidgetAppearance.model_fields)
    interaction = patch_model('ComponentInteraction', PageWidget, ('interaction', 'targetWidgetIds'))
    list_settings = patch_model('ComponentListSettings', ListSettings, (
        'columns', 'sortableColumns', 'pageSize', 'defaultSort', 'rowClick', 'toolbarActions',
        'rowActions', 'selection', 'emptyText',
    ))
    filter_settings = patch_model('ComponentFilterSettings', FilterSettings, (
        'queryMode', 'resetMode', 'showKeyword', 'expandAdvanced', 'requiredFields', 'queryLabel', 'resetLabel',
    ))
    edit = create_model('EditComponent', __base__=Operation, action=(Literal['edit'], ...),
                        properties=(properties | None, None), appearance=(appearance | None, None),
                        interaction=(interaction | None, None), list_settings=(list_settings | None, None),
                        filter_settings=(filter_settings | None, None))
    class ComponentRequest(BaseModel):
        model_config = ConfigDict(extra='forbid')
        action: Literal['inspect', 'apply']
        widget_id: str | None = Field(default=None, max_length=100, description='仅 inspect 使用，读取指定组件的完整配置')
        operations: list[Annotated[AddWidget | edit, Field(discriminator='action')]] | None = Field(
            default=None, min_length=1, max_length=20, description='仅 apply 使用，按顺序应用全部操作')

        @model_validator(mode='after')
        def validate_operation(self):
            if self.action == 'inspect' and self.operations is None:
                return self
            if self.action != 'apply' or self.widget_id is not None or not self.operations:
                raise ValueError('inspect 只接受 widget_id，apply 必须提供 operations')
            for operation in self.operations:
                if operation.action == 'edit' and not any(
                    patch is not None and patch.model_fields_set
                    for patch in (operation.properties, operation.appearance, operation.interaction,
                                  operation.list_settings, operation.filter_settings)
                ):
                    raise ValueError('请指定要修改的组件字段')
            return self

    def required_patch(fields):
        return model_validator(mode='after')(lambda self: validate_patch(self, fields))

    tools = dict(zip(TOOL_DETAILS, (
        create_model('InspectCanvas', __config__=ConfigDict(extra='forbid'),
                     widget_id=(str | None, Field(default=None, max_length=100))),
        create_model('AddCanvasComponent', __base__=Operation,
                     widget_type=(AddWidget.model_fields['widget_type'].annotation, ...)),
        create_model('UpdateCanvasProperties', __base__=Operation,
                     __validators__={'has_patch': required_patch(('properties', 'list_settings', 'filter_settings'))},
                     properties=(properties | None, None), list_settings=(list_settings | None, None),
                     filter_settings=(filter_settings | None, None)),
        create_model('UpdateCanvasAppearance', __base__=Operation,
                     __validators__={'has_patch': required_patch(('appearance',))}, appearance=(appearance, ...)),
        create_model('SetCanvasInteraction', __base__=Operation,
                     __validators__={'has_patch': required_patch(('interaction',))}, interaction=(interaction, ...)),
    )))
    return ComponentRequest, tools


def validate_patch(request, fields):
    if not any(patch is not None and patch.model_fields_set for patch in (getattr(request, key) for key in fields)):
        raise ValueError('请指定要修改的组件字段')
    return request


def component_request_model():
    return component_models()[0]


def registry_definitions():
    return {
        name: {'name': name, 'title': title, 'description': description,
               'handler_key': name, 'input_schema': component_models()[1][name].model_json_schema(),
               'enabled': True, 'side_effect': 'read' if name.endswith('.inspect') else 'draft_write',
               'risk_level': 'low', 'domain': 'low-code', 'permission_check': 'config',
               'dry_run_supported': True, 'audit_required': False}
        for name, (title, description) in TOOL_DETAILS.items()
    }


def tool_arguments(name, arguments):
    request = component_models()[1][name].model_validate(arguments).model_dump(exclude_unset=True)
    if name.endswith('.inspect'):
        return {'action': 'inspect', **request}
    operation = 'add' if name.endswith('.add') else 'edit'
    return {'action': 'apply', 'operations': [{'action': operation, **request}]}


async def browser_required(_payload, _context):
    return {'status': 'blocked', 'message': '请在目标业务页面的 AI 助手中调用此画布工具'}


def component_context(context):
    page = context.get('componentPageContext')
    if context.get('surface') == 'knowledge' or not isinstance(page, dict):
        return None
    return page if isinstance(page.get('code'), str) and page['code'] else None


def permission_error(user, settings):
    if not user.get('is_admin'):
        return '仅管理员可操作业务页面编辑器'
    decision = decide_ai_permission(user, settings, 'config', skill=TOOL, domain='low-code')
    if not decision.allowed:
        return decision.reason
    resolved, reason = PermissionResolver(build_default_rules() + load_permission_rules(settings)).resolve(
        TOOL, user, 'low', 'low-code')
    return (reason or '业务页面工具已被策略禁用') if resolved == PermissionDecision.DENY else None


async def call_component_page(bridge, arguments, *, tool=TOOL):
    page = component_context(bridge.context)
    if not page or not bridge.event_sink or not bridge.context.get('pageControlsSupported'):
        return {'status': 'blocked', 'message': '请在当前网页打开目标业务页面'}
    if not bridge.user.get('is_admin'):
        return {'status': 'blocked', 'message': '仅管理员可操作业务页面编辑器'}
    if tool == TOOL and (error := permission_error(bridge.user, bridge.settings)):
        return {'status': 'blocked', 'message': error}
    try:
        request = component_request_model().model_validate(arguments)
    except ValueError as exc:
        return {'status': 'validation_failed', 'message': str(exc)}

    command = {'id': uuid.uuid4().hex, 'type': 'component_page', 'page_code': page['code'],
               **request.model_dump(exclude_unset=True)}
    try:
        receipt = await dispatch_page_action(bridge, command)
    except asyncio.TimeoutError:
        return {'status': 'blocked', 'message': '未收到画布回执，请检查当前草稿后再试'}
    if not receipt.get('ok'):
        return {'status': 'blocked', 'message': receipt.get('error') or '画布操作失败'}
    message = ('已读取当前业务页面组件' if request.action == 'inspect' else
               '已在业务页面画布更新本地草稿。可以继续手动编辑，确认后点击「保存草稿」。')
    return {'status': 'completed', 'message': message, 'result': receipt.get('state') or {}}
