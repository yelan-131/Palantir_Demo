"""Bounded recovery for configuration requests that finish without a proposal."""
import re

REPORT_TOOL = 'platform.report_configuration_status'
REPORT_SCHEMA = {
    'type': 'object',
    'properties': {
        'status': {'type': 'string', 'enum': ['needs_clarification', 'blocked']},
        'reason': {'type': 'string', 'minLength': 1, 'maxLength': 600},
        'missing_fields': {'type': 'array', 'maxItems': 12,
                           'items': {'type': 'string', 'minLength': 1, 'maxLength': 100}},
    },
    'required': ['status', 'reason'], 'additionalProperties': False,
}
REPORT_DESCRIPTION = ('配置请求无法生成确认卡片时报告原因。仅缺少不可推断的关键业务参数时用 needs_clarification，'
                      '并提供 missing_fields；权限、能力或服务限制用 blocked。可选描述、图标、顺序不是阻塞项。'
                      '此工具不生成配置、不执行写入。')
COMPLETION_CONTRACT = ('\n配置请求完成协议：本轮必须调用配置工具生成真实确认卡片，或调用 '
                       'platform.report_configuration_status 报告缺少的关键业务信息或阻塞原因。'
                       '不要仅回复文字方案或声称已生成卡片。用户只是在咨询时直接回答即可。'
                       'ui.form_designer 已在现有设计器完成本地草稿时，页面会提供最终确认卡片，等待用户点击；不再生成重复业务写入卡片。')
REPAIR_INSTRUCTION = ('\n\n平台检查：上一轮没有准备任何真实确认卡片，也没有报告无法生成的原因。'
                      '请根据同一用户请求和配置草稿补齐本轮结果。'
                      '信息足够时立即调用对应工具准备确认卡片；'
                      '缺少关键业务参数或存在限制时调用 platform.report_configuration_status。'
                      '不得猜测金额、数量、关联对象或审批规则，不得为了出卡片绕过权限。'
                      '这是唯一一次自动补做；不要重复只输出文字方案。')


def expects_configuration(message, context):
    if context.get('surface') == 'knowledge':
        return False
    text = message.strip().lower()
    # Explicit consultation, cancellation and negation must never force a write proposal.
    if re.search(r'^(怎么|如何|为什么|什么情况下|会不会|是否|能否|请解释|解释|介绍|what\b|how\b|why\b)', text):
        return False
    if re.search(r'(怎么|如何|是什么|什么意思|有什么作用|what is\b|how to\b)', text):
        return False
    if re.search(r'(不要|不用|无需|先别|暂不|不需要|取消|只[是想需]*了解|只[是想需]*咨询|don.t|do not|cancel\b)', text):
        return False
    if re.search(r'(?:生成|准备).*(?:确认)?卡片|按(?:上表|上述|方案|清单).*(?:开始|生成)', text):
        return True
    if re.search(r'(?:新建|创建|建)(?:一[个张]|[个张])?表', text):
        return True
    target = r'(表单|字段|配置|菜单|审批|规则|页面|form\b|field\b|configuration\b|workflow\b)'
    operation = r'(创建|新建|新增|添加|生成|配置|修改|调整|设置|改成|改为|设为|建[一个张]*表|create\b|add\b|update\b|configure\b|change\b)'
    if re.search(target, text) and re.search(operation, text):
        return True
    pending = context.get('pendingActionState') or context.get('pending_action_state') or context.get('configurationDraft')
    return isinstance(pending, dict) and bool(re.search(operation, text))


def expects_native_designer(message, context):
    if not context.get('pageControlsSupported') or context.get('surface') == 'knowledge':
        return False
    if re.search(r'(一条记录|填报记录|业务记录|提交记录)', message):
        return False
    if re.search(r'(打开|进入|预览).*(设计器|表单设计)', message):
        return True
    if context.get('designerContext') and not re.match(r'^(查询|统计|分析|搜索)', message.strip()):
        return True
    return bool(re.search(r'(新建|创建|搭建|做|建).*(表单|登记表|申请表|入库单|退料单|领料单|验收单|出库单|表[，。！!?？\s]*$)', message))
