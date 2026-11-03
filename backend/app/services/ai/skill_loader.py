"""Versioned, allowlisted business instructions loaded on demand over MCP.

This is a platform MCP adapter, not a claim that DSH native skill discovery is enabled.
Registry activation and actor permissions still govern visibility and reads.
"""
from hashlib import sha256
from pathlib import Path

from .skills import get_skill
from .policies import decide_ai_permission

SKILL_TOOL = 'platform.skills.read'
FORM_SKILL = 'low_code.create_form_definition'
SKILL_FILES = {FORM_SKILL: ('1.0.0', 'form_design_skill.md')}
READER_SCHEMA = {'type': 'object', 'properties': {'name': {'type': 'string', 'enum': list(SKILL_FILES)}},
                 'required': ['name'], 'additionalProperties': False}


def available_skill_catalog(user, settings, context):
    if context.get('surface') == 'knowledge':
        return []
    result = []
    for name, (version, _) in SKILL_FILES.items():
        skill = get_skill(name)
        if skill and decide_ai_permission(user, settings, skill.permission_capability or 'qa',
                skill=name, domain=skill.domain, risk_level=skill.risk_level).allowed:
            result.append({'name': name, 'version': version, 'description': '新建业务表单或继续调整当前表单草稿时读取；咨询无需读取。'})
    return result


def read_business_skill(name, *, user, settings, context):
    if not isinstance(name, str) or name not in {item['name'] for item in available_skill_catalog(user, settings, context)}:
        return {'status': 'blocked', 'message': '技能不存在、已停用或当前用户不可访问'}
    version, filename = SKILL_FILES[name]
    body = Path(__file__).with_name(filename).read_text(encoding='utf-8')
    return {'status': 'completed', 'skill': {'name': name, 'version': version,
            'digest': sha256(body.encode()).hexdigest(), 'instructions': body}}
