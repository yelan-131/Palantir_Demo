"""Versioned, allowlisted business instructions loaded on demand over MCP.

This is a platform MCP adapter, not a claim that DSH native skill discovery is enabled.
Registry activation and actor permissions still govern visibility and reads.
"""
from hashlib import sha256
from pathlib import Path

from .skills import get_skill, skill_registry
from .policies import decide_ai_permission

SKILL_TOOL = 'platform.skills.read'
FORM_SKILL = 'low_code.create_form_definition'
PAGE_SKILL = 'low_code.manage_component_page'
SKILL_FILES = {
    FORM_SKILL: ('1.1.0', 'form_design_skill.md'),
    PAGE_SKILL: ('1.0.0', 'skill_instructions/low_code.manage_component_page.md'),
    'analysis.manage_dashboard': ('1.1.0', 'skill_instructions/analysis.manage_dashboard.md'),
    'analysis.query_dashboard': ('1.1.0', 'skill_instructions/analysis.query_dashboard.md'),
    'low_code.publish_form_to_menu': ('1.1.0', 'skill_instructions/low_code.publish_form_to_menu.md'),
}
REGISTRY_INSTRUCTION_NAMES = frozenset({
    'knowledge.answer_question',
    'knowledge.ingest_for_rag',
    'knowledge.intake_document_ontology',
    'quality.create_capa_draft',
    'maintenance.create_work_order_draft',
    'supply.create_purchase_request_draft',
    'material.create_material_application_draft',
    'analysis.analyze_form_records',
    'forms.create_record_draft',
    'low_code.suggest_model_or_page',
    'low_code.add_form_field',
    'workflow.submit_after_confirmation',
    'low_code.inspect_form',
})
def available_skill_catalog(user, settings, context, *, native=False, registry=None):
    if context.get('surface') == 'knowledge':
        return []
    result = []
    for name, skill in (skill_registry() if registry is None else registry).items():
        bundled = name in SKILL_FILES or (native and name in REGISTRY_INSTRUCTION_NAMES)
        if not bundled and not skill.instructions:
            continue
        if not skill.model_invocable and not (native and skill.user_invocable):
            continue
        if decide_ai_permission(user, settings, skill.permission_capability or 'qa',
                skill=name, domain=skill.domain, risk_level=skill.risk_level).allowed:
            version = SKILL_FILES[name][0] if name in SKILL_FILES else '1.0.0'
            description = '配置业务数据表单的字段、填写规则和表单草稿。需要搭建台账、登记入口或看板页面时使用通用页面技能。' if name == FORM_SKILL and skill.instructions is None else skill.description
            result.append({'name': name, 'version': version, 'description': description})
    return result


def read_business_skill(name, *, user, settings, context):
    catalog = {item['name']: item for item in available_skill_catalog(user, settings, context)}
    skill = get_skill(name) if isinstance(name, str) and name in catalog else None
    if skill is None:
        return {'status': 'blocked', 'message': '技能不存在、已停用或当前用户不可访问'}
    body = skill_body(skill)
    return {'status': 'completed', 'skill': {'name': name, 'version': catalog[name]['version'],
            'digest': sha256(body.encode()).hexdigest(), 'instructions': body}}


def skill_body(skill):
    if skill.instructions is not None:
        return skill.instructions
    return read_registered_skill_instructions(skill.name) or ''


def read_registered_skill_instructions(name: str) -> str | None:
    entry = SKILL_FILES.get(name)
    if entry:
        return Path(__file__).parent.joinpath(entry[1]).read_text(encoding='utf-8')
    if name in REGISTRY_INSTRUCTION_NAMES:
        return Path(__file__).with_name('skill_instructions').joinpath(f'{name}.md').read_text(encoding='utf-8')
    return None
