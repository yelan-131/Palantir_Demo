"""Versioned, allowlisted business instructions loaded on demand over MCP.

This is a platform MCP adapter, not a claim that DSH native skill discovery is enabled.
Registry activation and actor permissions still govern visibility and reads.
"""
from hashlib import sha256
from pathlib import Path

from .skills import get_skill, skill_registry
from .policies import decide_ai_permission
from .skill_import import split_skill_markdown

SKILL_TOOL = 'platform.skills.read'
FORM_SKILL = 'low_code.create_form_definition'
PAGE_SKILL = 'low_code.manage_component_page'
BUNDLE_ROOT = Path(__file__).with_name('business_skills')
PLATFORM_READABLE_SKILLS = frozenset({
    FORM_SKILL, PAGE_SKILL, 'analysis.manage_dashboard',
    'analysis.query_dashboard', 'low_code.publish_form_to_menu',
})
NATIVE_ONLY_SKILLS = frozenset({
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
BUNDLED_SKILLS = PLATFORM_READABLE_SKILLS | NATIVE_ONLY_SKILLS


def bundled_skill_source(name: str) -> str | None:
    if name not in BUNDLED_SKILLS:
        return None
    package_name = name.replace('.', '-').replace('_', '-')
    return (BUNDLE_ROOT / package_name / 'SKILL.md').read_text(encoding='utf-8')


def bundled_skill_package(name: str) -> tuple[dict, str] | None:
    document = bundled_skill_source(name)
    return split_skill_markdown(document) if document is not None else None


def available_skill_catalog(user, settings, context, *, native=False, registry=None):
    if context.get('surface') == 'knowledge':
        return []
    result = []
    for name, skill in (skill_registry() if registry is None else registry).items():
        bundled = name in PLATFORM_READABLE_SKILLS or (native and name in NATIVE_ONLY_SKILLS)
        if not bundled and not skill.instructions:
            continue
        if not skill.model_invocable and not (native and skill.user_invocable):
            continue
        if decide_ai_permission(user, settings, skill.permission_capability or 'qa',
                skill=name, domain=skill.domain, risk_level=skill.risk_level).allowed:
            package = bundled_skill_package(name) if bundled else None
            version = package[0].get('metadata', {}).get('version', '1.0.0') if package else '1.0.0'
            result.append({'name': name, 'version': version, 'description': skill.description})
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
    package = bundled_skill_package(name)
    return package[1] if package else None
