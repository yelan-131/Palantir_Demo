"""Tests for the enterprise AI provider and Agent shell."""

import pytest


@pytest.mark.asyncio
async def test_glm_provider_requires_api_key():
    from app.services.ai.providers import ProviderConfigurationError, make_provider
    from app.services.ai.schemas import AIProviderConfig, ChatMessage

    provider = make_provider(AIProviderConfig(provider="glm", chat_model="glm-4-flash"))

    with pytest.raises(ProviderConfigurationError) as exc_info:
        await provider.chat([ChatMessage(role="user", content="ping")])

    assert "glm API key is not configured" in str(exc_info.value)


@pytest.mark.asyncio
async def test_mock_provider_returns_embeddings():
    from app.services.ai.providers import make_provider
    from app.services.ai.schemas import AIProviderConfig

    provider = make_provider(AIProviderConfig(provider="mock", embedding_model="mock-embedding"))
    result = await provider.embed(["material application process"])

    assert result.provider == "mock"
    assert result.model == "mock-embedding"
    assert len(result.embeddings) == 1
    assert len(result.embeddings[0]) == 16


@pytest.mark.asyncio
async def test_agent_returns_confirmed_draft_skill():
    from app.services.ai.orchestrator import run_agent
    from app.services.ai.schemas import AgentRequest

    result = await run_agent(AgentRequest(message="生成维修工单草稿"))

    assert result.mode == "assisted"
    assert result.requires_confirmation is True
    assert result.actions
    assert result.actions[0].skill == "maintenance.create_work_order_draft"
    assert result.actions[0].requires_confirmation is True


def test_policy_blocks_forbidden_action():
    from app.services.ai.policies import apply_policy
    from app.services.ai.schemas import SkillAction

    action = apply_policy(SkillAction(skill="supply.auto_order", title="Auto order"))

    assert action.mode == "blocked"
    assert action.risk_level == "critical"
    assert action.requires_confirmation is True


def test_skill_tool_registry_contracts():
    from app.services.ai.skills import get_skill, list_skills
    from app.services.ai.tool_registry import get_tool, list_tools, validate_tool_call

    assert any(item["name"] == "knowledge.answer_question" for item in list_skills())
    assert any(item["name"] == "forms.create_dynamic_record_draft" for item in list_tools())
    assert get_skill("quality.create_capa_draft").confirmation_policy == "confirm_token"
    assert get_tool("workflow.start").side_effect == "workflow_action"

    allowed, reason = validate_tool_call("quality.create_capa_draft", "forms.create_dynamic_record_draft")
    assert allowed is True
    assert reason == "Allowed"

    allowed, reason = validate_tool_call("knowledge.answer_question", "workflow.start")
    assert allowed is False
    assert reason == "Tool is outside the skill allowlist"
