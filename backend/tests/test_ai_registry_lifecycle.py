"""Registry lifecycle boundaries, including persistence after failed requests."""
from copy import deepcopy

import pytest

from app.services.ai.agent_registry import AgentRegistryError, _validate_registry_transition


@pytest.mark.parametrize('kind', ['skills', 'tools'])
def test_active_item_cannot_be_removed(kind):
    old = {'item': {'name': 'item', 'enabled': True}}
    with pytest.raises(AgentRegistryError, match='先成功停用'):
        _validate_registry_transition({}, {}, old if kind == 'skills' else {}, old if kind == 'tools' else {})


def test_disabled_item_can_be_removed():
    _validate_registry_transition({}, {}, {'skill': {'enabled': False}}, {'tool': {'enabled': False}})


def test_unimplemented_tool_activation_rejected():
    with pytest.raises(AgentRegistryError, match='尚未绑定已实现'):
        _validate_registry_transition({}, {'tool': {'enabled': True, 'handler_key': 'not_implemented'}}, {}, {'tool': {'enabled': False}})


def test_skill_activation_requires_enabled_implemented_dependency():
    with pytest.raises(AgentRegistryError, match='未启用或处理器未实现'):
        _validate_registry_transition({'skill': {'enabled': True, 'default_tool': 'tool'}}, {'tool': {'enabled': False}}, {'skill': {'enabled': False}}, {'tool': {'enabled': False}})


@pytest.mark.asyncio
async def test_failed_delete_and_activation_preserve_saved_state():
    from app.database import init_db
    from app.services.ai import agent_definition
    from app.services.ai.agent_registry import load_seed_registry, load_agent_registry, save_agent_registry_payload

    await init_db()
    previous_skills = agent_definition._RUNTIME_SKILL_REGISTRY
    previous_tools = agent_definition._RUNTIME_TOOL_REGISTRY
    skills, tools = load_seed_registry()
    original = {'skills': deepcopy(skills), 'tools': deepcopy(tools)}
    try:
        initial = await save_agent_registry_payload(original, seed_import=True, updated_by='creator')
        candidate = deepcopy(original)
        name = 'workflow.submit_after_confirmation'
        candidate['skills'][name]['instructions'] = '1. 核对待提交记录。'
        candidate['skills'][name]['title'] = '提交业务审批'
        candidate['skills'][name]['description'] = '复核业务记录后提交审批。'
        candidate['skills'][name]['created_by'] = 'spoofed'
        candidate['skills'][name]['created_at'] = '2000-01-01T00:00:00'
        saved = await save_agent_registry_payload(candidate, updated_by='editor')
        stored = await load_agent_registry(include_disabled=True)
        assert saved['skills'][name] == stored['skills'][name]
        assert stored['skills'][name]['created_by'] == 'admin'
        assert stored['skills'][name]['created_at'] == initial['skills'][name]['created_at']
        assert stored['skills'][name]['updated_by'] == 'editor'
        untouched = 'analysis.analyze_form_records'
        assert stored['skills'][untouched] == initial['skills'][untouched]
        assert stored['skills'][name]['instructions'] == '1. 核对待提交记录。'
        assert stored['skills'][name]['title'] == '提交业务审批'
        assert stored['skills'][name]['description'] == '复核业务记录后提交审批。'

        candidate = deepcopy(original)
        candidate['skills'].pop('analysis.analyze_form_records')
        with pytest.raises(AgentRegistryError, match='先成功停用'):
            await save_agent_registry_payload(candidate)
        assert 'analysis.analyze_form_records' in (await load_agent_registry(include_disabled=True))['skills']

        candidate = deepcopy(original)
        tool_name = 'forms.get_record'
        candidate['tools'][tool_name].update(enabled=False, created_by='spoofed', updated_by='spoofed')
        saved = await save_agent_registry_payload(candidate, updated_by='operator')
        stored = await load_agent_registry(include_disabled=True)
        assert stored['tools'][tool_name] == saved['tools'][tool_name]
        assert stored['tools'][tool_name]['created_by'] == 'admin'
        assert stored['tools'][tool_name]['created_at'] == initial['tools'][tool_name]['created_at']
        assert stored['tools'][tool_name]['updated_by'] == 'operator'
        assert stored['tools']['forms.query_records'] == initial['tools']['forms.query_records']
        assert tool_name not in (await load_agent_registry())['tools']
        candidate['tools']['forms.get_record']['enabled'] = True
        await save_agent_registry_payload(candidate)
        assert 'forms.get_record' in (await load_agent_registry())['tools']

        candidate = deepcopy(original)
        candidate['tools']['workflow.start']['enabled'] = False
        result = await save_agent_registry_payload(candidate)
        assert result['tools']['workflow.start']['enabled'] is False
        assert 'workflow.start' not in (await load_agent_registry())['tools']
        assert (await load_agent_registry(include_disabled=True))['tools']['workflow.start']['enabled'] is False
        candidate['tools']['workflow.start']['enabled'] = True
        with pytest.raises(AgentRegistryError, match='尚未绑定已实现'):
            await save_agent_registry_payload(candidate)
        assert (await load_agent_registry(include_disabled=True))['tools']['workflow.start']['enabled'] is False
    finally:
        await save_agent_registry_payload(original, seed_import=True)
        agent_definition._RUNTIME_SKILL_REGISTRY = previous_skills
        agent_definition._RUNTIME_TOOL_REGISTRY = previous_tools
        agent_definition.load_skill_registry.cache_clear()
        agent_definition.load_tool_registry.cache_clear()
