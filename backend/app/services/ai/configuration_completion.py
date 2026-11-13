"""Structured status reports for incomplete configuration requests."""
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
