from unittest.mock import AsyncMock

import pytest

from app.services.ai import skill_loader, harness_runtime as mod
from app.services.ai.skill_import import parse_skill_markdown
from app.services.ai.skills import SkillDefinition
from app.services.ai.settings import merge_ai_settings

USER = {'tenant_id': 1, 'sub': 'skill-test', 'is_admin': True, 'roles': ['admin']}


def test_imported_skill_can_be_read_without_tool_mapping(monkeypatch):
    markdown = (
        "\ufeff---\r\nname: report-review\r\ndescription: >-\r\n"
        "  Review a report.\r\n  Use before publication.\r\n"
        "allowed-tools: Bash\r\n---\r\n## Review\r\n\r\nCheck the evidence.\r\n"
    )
    imported = parse_skill_markdown(markdown)
    assert imported == {
        'name': 'report-review',
        'description': 'Review a report. Use before publication.',
        'instructions': '## Review\r\n\r\nCheck the evidence.\r\n',
        'source_markdown': markdown,
    }
    skill = SkillDefinition(**imported, title='Report review', capability_level='assisted')
    monkeypatch.setattr(skill_loader, 'skill_registry', lambda: {skill.name: skill})
    monkeypatch.setattr(skill_loader, 'get_skill', lambda name: skill if name == skill.name else None)
    settings = merge_ai_settings({'apiKey': 'test-key'})
    result = skill_loader.read_business_skill(skill.name, user=USER, settings=settings, context={})
    assert result['skill']['instructions'] == imported['instructions']
    assert skill.allowed_tools == [] and skill.default_tool is None


def test_import_preserves_native_invocation_options():
    imported = parse_skill_markdown(
        '---\nname: review\ndescription: Review\ndisable-model-invocation: true\nuser-invocable: false\n---\nBody'
    )
    assert imported['model_invocable'] is False
    assert imported['user_invocable'] is False


@pytest.mark.parametrize('markdown', [
    'No metadata',
    '---\nname: invalid.name\ndescription: Test\n---\nBody',
    '---\nname: valid-name\ndescription: []\n---\nBody',
    '---\nname: valid-name\ndescription: [\n---\nBody',
])
def test_skill_import_rejects_invalid_metadata(markdown):
    with pytest.raises(ValueError):
        parse_skill_markdown(markdown)


def test_catalog_is_small_and_body_is_loaded_only_on_request():
    settings = merge_ai_settings({'apiKey': 'test-key'})
    catalog = skill_loader.available_skill_catalog(USER, settings, {})
    assert catalog and 'instructions' not in catalog[0]
    loaded = skill_loader.read_business_skill(skill_loader.FORM_SKILL, user=USER, settings=settings, context={})
    assert loaded['status'] == 'completed'
    assert loaded['skill']['version'] == '1.1.0'
    assert len(loaded['skill']['digest']) == 64
    assert 'configure_fields' in loaded['skill']['instructions']
    assert 'instructions' not in str(catalog)


def test_edited_form_steps_override_bundled_instructions(monkeypatch):
    skill = skill_loader.get_skill(skill_loader.FORM_SKILL)
    edited = skill.model_copy(update={'instructions': '1. 核对草稿。'})
    monkeypatch.setattr(skill_loader, 'get_skill', lambda name: edited if name == edited.name else None)
    settings = merge_ai_settings({'apiKey': 'test-key'})
    result = skill_loader.read_business_skill(edited.name, user=USER, settings=settings, context={})
    assert result['skill']['instructions'] == edited.instructions


@pytest.mark.parametrize('name,context,changes', [
    ('../../config.py', {}, {}), ({'name': 'fake'}, {}, {}),
    (skill_loader.FORM_SKILL, {'surface': 'knowledge'}, {}),
    (skill_loader.FORM_SKILL, {}, {'agentMode': 'readonly'}),
    (skill_loader.FORM_SKILL, {}, {'assistEnabled': False}),
])
def test_skill_reads_cannot_bypass_scope_or_permissions(name, context, changes):
    settings = merge_ai_settings({'apiKey': 'test-key', **changes})
    result = skill_loader.read_business_skill(name, user=USER, settings=settings, context=context)
    assert result['status'] == 'blocked' and 'skill' not in result


@pytest.mark.asyncio
async def test_disabled_skill_is_rechecked_and_read_is_not_write_authorization(monkeypatch):
    monkeypatch.setenv('AI_HARNESS_NATIVE_SKILLS', 'false')
    settings = merge_ai_settings({'apiKey': 'test-key'})
    monkeypatch.setattr(mod, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    from app.services.ai import agent_registry
    reload = AsyncMock(return_value=dict(zip(('skills', 'tools'), agent_registry.load_seed_registry())))
    monkeypatch.setattr(agent_registry, 'load_agent_registry', reload)
    bridge = mod.PlatformBridge(USER, settings, {})
    result = await bridge.call_tool(mod.tool_alias(skill_loader.SKILL_TOOL), {'name': skill_loader.FORM_SKILL})
    assert result['status'] == 'completed' and bridge.calls == 1
    assert bridge.loaded_skills[skill_loader.FORM_SKILL]['version'] == '1.1.0'
    assert not bridge.pending
    monkeypatch.setattr(skill_loader, 'get_skill', lambda name: None)
    result = await bridge.call_tool(mod.tool_alias(skill_loader.SKILL_TOOL), {'name': skill_loader.FORM_SKILL})
    assert result['status'] == 'blocked'
    assert reload.await_count == 2


@pytest.mark.parametrize('native', [False, True])
def test_component_page_skill_discovery_preserves_tenant_instructions(monkeypatch, native):
    default_skill = skill_loader.get_skill(skill_loader.PAGE_SKILL)
    settings = merge_ai_settings({'apiKey': 'test-key', 'agentMode': 'confirm'})
    page_skill = default_skill.model_copy(update={'instructions': '租户自定义发布步骤。'})
    monkeypatch.setattr(skill_loader, 'skill_registry', lambda: {page_skill.name: page_skill})
    monkeypatch.setattr(skill_loader, 'get_skill', lambda name: page_skill if name == page_skill.name else None)
    assert 'record-list' in skill_loader.skill_body(default_skill)
    assert 'pages.publish' in skill_loader.skill_body(default_skill)
    assert skill_loader.available_skill_catalog(USER, settings, {}, native=native)[0]['name'] == page_skill.name
    assert skill_loader.read_business_skill(page_skill.name, user=USER, settings=settings, context={})['skill']['instructions'] == page_skill.instructions
