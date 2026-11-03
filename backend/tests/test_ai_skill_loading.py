from unittest.mock import AsyncMock

import pytest

from app.services.ai import skill_loader, harness_runtime as mod
from app.services.ai.settings import merge_ai_settings

USER = {'tenant_id': 1, 'sub': 'skill-test', 'is_admin': True, 'roles': ['admin']}


def test_catalog_is_small_and_body_is_loaded_only_on_request():
    settings = merge_ai_settings({'apiKey': 'test-key'})
    catalog = skill_loader.available_skill_catalog(USER, settings, {})
    assert catalog and 'instructions' not in catalog[0]
    loaded = skill_loader.read_business_skill(skill_loader.FORM_SKILL, user=USER, settings=settings, context={})
    assert loaded['status'] == 'completed'
    assert loaded['skill']['version'] == '1.0.0'
    assert len(loaded['skill']['digest']) == 64
    assert 'configure_fields' in loaded['skill']['instructions']
    assert 'instructions' not in str(catalog)


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
    settings = merge_ai_settings({'apiKey': 'test-key'})
    monkeypatch.setattr(mod, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    from app.services.ai import agent_registry
    reload = AsyncMock()
    monkeypatch.setattr(agent_registry, 'load_agent_registry', reload)
    bridge = mod.PlatformBridge(USER, settings, {})
    result = await bridge.call_tool(mod.tool_alias(skill_loader.SKILL_TOOL), {'name': skill_loader.FORM_SKILL})
    assert result['status'] == 'completed' and bridge.calls == 1
    assert bridge.loaded_skills[skill_loader.FORM_SKILL]['version'] == '1.0.0'
    assert not bridge.pending
    monkeypatch.setattr(skill_loader, 'get_skill', lambda name: None)
    result = await bridge.call_tool(mod.tool_alias(skill_loader.SKILL_TOOL), {'name': skill_loader.FORM_SKILL})
    assert result['status'] == 'blocked'
    assert reload.await_count == 2
