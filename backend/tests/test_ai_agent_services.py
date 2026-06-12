"""Tests for the enterprise AI provider and Agent shell."""

import pytest


class _SemanticFakeProvider:
    def __init__(self, content: str):
        self.content = content

    async def chat(self, messages, options=None):
        from app.services.ai.schemas import ChatResult

        return ChatResult(provider="glm", model="semantic-test", content=self.content, usage={"mode": "test"})


def _tenant_user() -> dict:
    return {"sub": "agent-test", "tenant_id": 1, "is_admin": True, "roles": [{"name": "admin"}]}


@pytest.mark.asyncio
async def test_glm_provider_requires_api_key():
    from app.services.ai.providers import ProviderConfigurationError, make_provider
    from app.services.ai.schemas import AIProviderConfig, ChatMessage

    provider = make_provider(AIProviderConfig(provider="glm", chat_model="glm-5.1"))

    with pytest.raises(ProviderConfigurationError) as exc_info:
        await provider.chat([ChatMessage(role="user", content="ping")])

    assert "glm API key is not configured" in str(exc_info.value)


@pytest.mark.asyncio
async def test_mock_provider_is_rejected_by_schema():
    from app.services.ai.schemas import AIProviderConfig
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        AIProviderConfig(provider="mock", embedding_model="mock-embedding")


@pytest.mark.asyncio
async def test_agent_returns_confirmed_draft_skill():
    from app.services.ai.orchestrator import run_agent
    from app.services.ai.schemas import AgentRequest

    result = await run_agent(AgentRequest(message="生成维修工单草稿"), user=_tenant_user())

    assert result.mode == "qa"
    assert result.requires_confirmation is False
    assert result.actions == []
    assert "maintenance.create_work_order_draft" in result.answer
    assert any(step["id"] == "step-tool-contract" for step in result.steps)
    assert any(step["id"] == "step-requirement-gap" for step in result.steps)


@pytest.mark.asyncio
async def test_agent_returns_confirmed_draft_after_guided_requirements():
    from app.services.ai.orchestrator import run_agent
    from app.services.ai.schemas import AgentRequest

    result = await run_agent(AgentRequest(message="为设备 CNC-17 生成维修工单草稿，主轴振动异常，优先级高，48 小时内处理"), user=_tenant_user())

    assert result.mode == "assisted"
    assert result.requires_confirmation is True
    assert result.actions
    assert result.actions[0].skill == "maintenance.create_work_order_draft"
    assert result.actions[0].requires_confirmation is True
    assert "To be confirmed" not in str(result.actions[0].payload)
    assert result.actions[0].payload["_contract"]["tool"] == "forms.create_dynamic_record_draft"


@pytest.mark.asyncio
async def test_agent_continues_pending_action_slot_state():
    from app.services.ai.orchestrator import run_agent
    from app.services.ai.schemas import AgentRequest

    first = await run_agent(AgentRequest(message="生成维修工单草稿"), user=_tenant_user())
    assert first.action_state
    assert first.action_state["status"] == "collecting"

    second = await run_agent(AgentRequest(
        message="设备 A 出现故障异常，优先级高，48 小时内处理",
        context={"pendingActionState": first.action_state},
    ), user=_tenant_user())

    assert second.requires_confirmation is True
    assert second.action_state
    assert second.action_state["status"] == "ready_for_confirmation"
    assert second.actions[0].skill == "maintenance.create_work_order_draft"
    assert "To be confirmed" not in str(second.actions[0].payload)


@pytest.mark.asyncio
async def test_low_code_adjustment_updates_confirmation_payload():
    from app.services.ai.orchestrator import run_agent
    from app.services.ai.schemas import AgentRequest

    first = await run_agent(AgentRequest(
        message="帮我新建一个物料主数据表单，字段包括物料编码、物料名称、物料类型、安全库存；物料编码和物料名称必填；创建菜单入口",
    ), user=_tenant_user())
    assert first.requires_confirmation is True
    assert first.action_state

    second = await run_agent(AgentRequest(
        message="请调整刚才的 Low-code form creation plan：表单名称改成阀类物料主数据",
        context={"pendingActionState": first.action_state},
    ), user=_tenant_user())

    assert second.requires_confirmation is True
    assert second.action_state
    assert second.action_state["collected_slots"]["formName"] == "阀类物料主数据"
    assert second.actions[0].payload["form"]["name"] == "阀类物料主数据"


@pytest.mark.asyncio
async def test_generic_draft_payload_uses_action_contract_slots():
    from app.services.ai.orchestrator import run_agent
    from app.services.ai.schemas import AgentRequest

    result = await run_agent(AgentRequest(
        message="create maintenance work order draft for equipment CNC-17, problem spindle vibration, priority high due in 8 hours",
    ), user=_tenant_user())

    assert result.requires_confirmation is True
    assert result.actions[0].skill == "maintenance.create_work_order_draft"
    payload = result.actions[0].payload
    assert payload["asset"]
    assert payload["problem_or_risk"]
    assert payload["priority_or_window"]
    assert payload["_contract"]["skill"] == "maintenance.create_work_order_draft"
    assert "To be confirmed" not in str(payload)


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
    assert any(item["name"] == "forms.query_records" for item in list_tools())
    assert any(item["name"] == "analysis.analyze_form_records" for item in list_skills())
    assert any(item["name"] == "forms.create_record_draft" for item in list_skills())
    assert any(item["name"] == "ai.semantic_plan_low_code_form" for item in list_tools())
    assert get_skill("quality.create_capa_draft").confirmation_policy == "confirm_token"
    assert get_tool("workflow.start").side_effect == "workflow_action"
    assert get_tool("ai.semantic_plan_low_code_form").side_effect == "read"
    assert get_tool("forms.query_records").permission_check == "business_query"
    assert get_tool("forms.add_form_field").side_effect == "configuration_write"
    assert "forms.query_records" in get_skill("analysis.analyze_form_records").allowed_tools
    assert "forms.create_dynamic_record_draft" in get_skill("forms.create_record_draft").allowed_tools
    assert "ai.semantic_plan_low_code_form" in get_skill("low_code.create_form_definition").allowed_tools
    assert "forms.add_form_field" in get_skill("low_code.add_form_field").allowed_tools

    allowed, reason = validate_tool_call("quality.create_capa_draft", "forms.create_dynamic_record_draft")
    assert allowed is True
    assert reason == "Allowed"

    allowed, reason = validate_tool_call("low_code.create_form_definition", "ai.semantic_plan_low_code_form")
    assert allowed is True
    assert reason == "Allowed"

    allowed, reason = validate_tool_call("low_code.add_form_field", "forms.add_form_field")
    assert allowed is True
    assert reason == "Allowed"

    allowed, reason = validate_tool_call("analysis.analyze_form_records", "forms.query_records")
    assert allowed is True
    assert reason == "Allowed"

    allowed, reason = validate_tool_call("forms.create_record_draft", "forms.create_dynamic_record_draft")
    assert allowed is True
    assert reason == "Allowed"

    allowed, reason = validate_tool_call("knowledge.answer_question", "workflow.start")
    assert allowed is False
    assert reason == "Tool is outside the skill allowlist"


def test_preflight_blocks_viewer_configuration_write():
    from app.services.ai.preflight import preflight_agent_request
    from app.services.ai.settings import AI_SYSTEM_SETTINGS

    decision = preflight_agent_request(
        message="\u5e2e\u6211\u65b0\u5efa\u4e00\u4e2a\u8868\u5355",
        context={},
        user={"sub": "auditor_gu", "is_admin": False, "roles": [{"name": "viewer"}]},
        settings=AI_SYSTEM_SETTINGS,
    )

    assert decision.allowed is False
    assert decision.capability == "config"
    assert decision.risk_level == "high"


def test_preflight_blocks_viewer_business_query_without_capability():
    from app.services.ai.preflight import preflight_agent_request
    from app.services.ai.settings import AI_SYSTEM_SETTINGS

    decision = preflight_agent_request(
        message="\u5e2e\u6211\u5206\u6790\u4e00\u4e0b\u5f53\u524d\u8868\u5355\u6570\u636e",
        context={"formCode": "supplier_risk"},
        user={"sub": "auditor_gu", "is_admin": False, "roles": [{"name": "viewer"}]},
        settings=AI_SYSTEM_SETTINGS,
    )

    assert decision.allowed is False
    assert decision.capability == "business_query"


def test_safety_policy_max_tool_steps_is_mirrored_for_runtime_compatibility():
    from app.services.ai.settings import merge_ai_settings, safety_policy_snapshot

    merged = merge_ai_settings({"safetyPolicy": {"maxToolSteps": 2, "toolTimeoutSeconds": 9}}, existing={})

    assert safety_policy_snapshot(merged)["maxToolSteps"] == 2
    assert merged["riskPolicy"]["maxToolSteps"] == 2


def test_high_risk_confirm_switch_controls_high_risk_confirmation():
    from app.services.ai.policies import decide_ai_permission

    settings = {
        "highRiskConfirm": True,
        "safetyPolicy": {"highRiskConfirm": False},
        "riskPolicy": {"high": "confirm_and_audit"},
        "rolePolicies": [],
    }
    decision = decide_ai_permission(
        {"sub": "admin", "is_admin": True},
        settings,
        "config",
        risk_level="high",
    )

    assert decision.allowed is True
    assert decision.requires_confirmation is False
    assert decision.audit_required is False


def test_sensitive_payload_masking_redacts_keys_and_inline_secrets():
    from app.services.ai.settings import maybe_mask_sensitive_payload

    payload = {
        "apiKey": "sk-demo-secret-value",
        "message": "token=abc1234567890 and Authorization: Bearer abcdefghijklmnop",
        "nested": [{"password": "plain-text"}],
    }

    masked = maybe_mask_sensitive_payload(payload, {"safetyPolicy": {"sensitiveMasking": True}})

    assert masked["apiKey"] == "[REDACTED_SECRET]"
    assert "abc1234567890" not in masked["message"]
    assert "abcdefghijklmnop" not in masked["message"]
    assert masked["nested"][0]["password"] == "[REDACTED_SECRET]"


@pytest.mark.asyncio
async def test_context_builder_masks_sensitive_context_before_prompt():
    from app.services.ai.context_builder import context_builder
    from app.services.ai.schemas import AgentRequest

    payload = await context_builder.build(
        None,
        request=AgentRequest(
            message="check this",
            context={"semanticContext": {"records": [{"api_key": "sk-test-secret"}]}},
        ),
        user={"sub": "admin", "tenant_id": 1, "is_admin": True},
        settings={"safetyPolicy": {"sensitiveMasking": True}},
    )

    assert payload["semantic_context"]["records"][0]["api_key"] == "[REDACTED_SECRET]"


@pytest.mark.asyncio
async def test_tool_executor_respects_configured_timeout(monkeypatch):
    import asyncio

    from app.services.ai.tool_executor import AgentToolExecutor

    executor = AgentToolExecutor()

    async def slow_execute_action(**kwargs):
        await asyncio.sleep(2)
        return {"status": "completed"}

    async def noop_update(**kwargs):
        return None

    async def noop_persist(*args, **kwargs):
        return {"draft_id": "draft-test"}

    audit_events = []
    monkeypatch.setattr(executor, "_execute_action", slow_execute_action)

    run = await executor.execute_confirmed_run(
        {"run_id": "run-test", "status": "confirmed", "actions": [{"skill": "demo.slow", "payload": {}}]},
        current_user={"sub": "admin"},
        persist_ai_draft=noop_persist,
        update_ai_draft_status=noop_update,
        audit_ai_event=lambda user, event_type, payload: audit_events.append((event_type, payload)),
        settings={"safetyPolicy": {"toolTimeoutSeconds": 1}},
    )

    assert run["status"] == "failed"
    assert run["tool_results"][0]["status"] == "failed"
    assert run["tool_results"][0]["error"] == "Tool execution exceeded 1 seconds"
    assert audit_events[0][0] == "agent_tool_timeout"


@pytest.mark.asyncio
async def test_tool_envelope_pre_hook_abort_generates_validation_item():
    from app.services.ai.events import AgentEvent, EventBus, HookResult
    from app.services.ai.tool_envelope import tool_execution_envelope

    bus = EventBus()

    async def blocker(event, payload):
        return HookResult(action="abort", reason="blocked by test hook")

    bus.on(AgentEvent.PRE_TOOL_USE, blocker)
    result = await tool_execution_envelope.execute_tool(
        tool_name="knowledge.search",
        payload={"query": "quality", "limit": 1},
        current_user={"sub": "admin", "tenant_id": 1, "is_admin": True},
        settings={"safetyPolicy": {"enabledHooks": ["validate_before_tool"]}},
        event_bus=bus,
    )

    assert result["status"] == "failed"
    assert result["error"] == "blocked by test hook"
    assert any(item["type"] == "validation" and item["status"] == "failed" for item in result["items"])


@pytest.mark.asyncio
async def test_tool_envelope_pre_hook_can_modify_payload():
    from app.services.ai.events import AgentEvent, EventBus, HookResult
    from app.services.ai.tool_envelope import tool_execution_envelope

    bus = EventBus()

    async def modifier(event, payload):
        return HookResult(action="modify", modified_payload={"payload": {"limit": 7}})

    async def callback(payload):
        return {"status": "completed", "result": {"seen": payload}}

    bus.on(AgentEvent.PRE_TOOL_USE, modifier)
    result = await tool_execution_envelope.execute_callable(
        tool_name="forms.query_records",
        skill_name="analysis.analyze_form_records",
        payload={"limit": 1},
        current_user={"sub": "admin", "is_admin": True},
        callback=callback,
        settings={"safetyPolicy": {"enabledHooks": ["validate_before_tool", "validate_after_tool"]}},
        event_bus=bus,
    )

    assert result["status"] == "completed"
    assert result["result"]["seen"] == {"limit": 7}
    assert [item["type"] for item in result["items"]].count("validation") >= 2


def test_confirmation_validation_error_blocks_token():
    from app.services.ai.agent_runs import create_agent_run
    from app.services.ai.schemas import AgentRequest, AgentResponse

    response = AgentResponse(answer="Need confirmation", requires_confirmation=True, mode="assisted")
    run = create_agent_run(AgentRequest(message="confirm empty"), response, {"sub": "admin"})

    assert run["status"] == "failed"
    assert response.requires_confirmation is False
    assert not response.confirmation_payload
    assert any(item["type"] == "validation" and item["status"] == "failed" for item in response.items)


def test_confirmation_validation_warning_enters_checklist(monkeypatch):
    from app.services.ai.agent_runs import create_agent_run
    from app.services.ai.schemas import AgentRequest, AgentResponse, SkillAction

    monkeypatch.setattr(
        "app.services.ai.agent_runs.settings_snapshot",
        lambda: {
            "safetyPolicy": {
                "enabledHooks": ["validate_before_confirmation"],
                "validationRules": [
                    {
                        "phase": "pre_confirmation",
                        "tool": "forms.create_form_definition",
                        "severity": "warning",
                        "ruleType": "field_required",
                        "field": "form.name",
                        "message": "Form name should be reviewed",
                    }
                ],
            }
        },
    )
    response = AgentResponse(
        answer="Need confirmation",
        requires_confirmation=True,
        risk_level="high",
        mode="assisted",
        actions=[
            SkillAction(
                skill="low_code.create_form_definition",
                title="Create form",
                risk_level="high",
                payload={"form": {}, "fields": [], "_contract": {"tool": "forms.create_form_definition"}},
            )
        ],
    )
    run = create_agent_run(AgentRequest(message="create form"), response, {"sub": "admin"})
    confirmation = next(item["payload"] for item in run["items"] if item["type"] == "confirmation")

    assert run["status"] == "waiting_confirmation"
    assert confirmation["confirmation_token"].startswith("confirm-")
    assert confirmation["checklist"][0]["message"] == "Form name should be reviewed"


@pytest.mark.asyncio
async def test_confirmed_action_post_validation_failure_marks_run_failed(monkeypatch):
    from app.services.ai.tool_executor import AgentToolExecutor

    executor = AgentToolExecutor()

    async def fake_execute_action(**kwargs):
        return {"status": "completed", "result": {"ok": True}}

    async def noop_update(**kwargs):
        return None

    async def noop_persist(*args, **kwargs):
        return {"draft_id": "draft-test"}

    monkeypatch.setattr(executor, "_execute_action", fake_execute_action)
    run = await executor.execute_confirmed_run(
        {
            "run_id": "run-post-validation",
            "status": "confirmed",
            "actions": [{"skill": "demo.dynamic", "payload": {"_contract": {"tool": "forms.create_dynamic_record_draft"}}}],
            "items": [],
        },
        current_user={"sub": "admin", "is_admin": True},
        persist_ai_draft=noop_persist,
        update_ai_draft_status=noop_update,
        audit_ai_event=None,
        settings={"safetyPolicy": {"enabledHooks": ["validate_before_tool", "validate_after_tool"]}},
    )

    assert run["status"] == "failed"
    assert run["tool_results"][0]["status"] == "failed"
    assert any(item["type"] == "validation" and item["status"] == "failed" for item in run["items"])


def test_form_record_analysis_summarizes_visible_records():
    from app.services.ai.form_analysis import (
        build_form_record_evidence,
        build_local_form_analysis_answer,
        summarize_form_record_result,
    )

    query_result = {
        "form": {"id": 10, "name": "Material Master", "code": "material_master"},
        "visible_fields": ["material_code", "status", "owner"],
        "record_count": 3,
        "records": [
            {"id": 1, "status": "active", "data": {"material_code": "M-001", "status": "open", "owner": "QA"}},
            {"id": 2, "status": "active", "data": {"material_code": "M-002", "status": "open", "owner": "SQE"}},
            {"id": 3, "status": "archived", "data": {"material_code": "M-003", "status": "closed", "owner": "QA"}},
        ],
    }

    summary = summarize_form_record_result(query_result)
    evidence = build_form_record_evidence(query_result, limit=2)
    answer = build_local_form_analysis_answer(summary)

    assert summary["record_count"] == 3
    assert summary["status_counts"] == {"active": 2, "archived": 1}
    assert summary["field_non_empty"]["material_code"] == 3
    assert summary["field_top_values"]["owner"][0] == {"value": "QA", "count": 2}
    assert [item["record_id"] for item in evidence] == [1, 2]
    assert "Material Master" in answer
    assert "\u786e\u8ba4\u6e05\u5355" in answer


@pytest.mark.asyncio
async def test_dynamic_record_draft_checks_target_form_create_permission(monkeypatch):
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.services.ai import dynamic_record_drafts

    async def fake_resolve_form(session, *, tenant_id, skill, payload):
        return SimpleNamespace(id=12, tenant_id=tenant_id, code="quality_event", name="Quality Event")

    async def fake_has_form_permission(user, form_id, action, session):
        assert form_id == 12
        assert action == "create"
        return False

    monkeypatch.setattr(dynamic_record_drafts, "resolve_dynamic_record_form", fake_resolve_form)
    monkeypatch.setattr(dynamic_record_drafts, "has_form_permission", fake_has_form_permission)

    with pytest.raises(HTTPException) as exc_info:
        await dynamic_record_drafts.create_dynamic_record_draft_from_agent(
            SimpleNamespace(),
            user={"sub": "viewer", "tenant_id": 1, "is_admin": False},
            skill="forms.create_record_draft",
            payload={"form_code": "quality_event", "record.data": {"title": "A"}},
            evidence=[],
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Form create permission denied"


def test_prompt_builder_includes_tenant_context_memory_and_evidence():
    from app.services.ai.prompt_builder import PromptBuildInput, PromptBuilder
    from app.services.ai.schemas import ChatMessage
    from app.services.ai.tenant_profile import TenantProfile

    profile = TenantProfile(
        tenant_id=42,
        slug="acme",
        display_name="ACME Manufacturing",
        product_name="ACME Foundry",
        assistant_name="Atlas",
        industry="discrete manufacturing",
        terminology={"line": "production line"},
    )
    messages = PromptBuilder().build(
        PromptBuildInput(
            mode="knowledge",
            tenant_profile=profile,
            page_context={"page": "knowledge-center", "document_id": "doc-1"},
            evidence=[
                {"title": f"SOP {index}", "snippet": f"Step {index}"}
                for index in range(10)
            ],
            memory=[
                {"memory_id": f"mem-{index}", "summary": f"Remember {index}"}
                for index in range(10)
            ],
            history=[ChatMessage(role="user", content="previous question")],
            output_contract="Return concise JSON.",
            user_message="What changed?",
        )
    )

    assert [message.role for message in messages] == ["system", "user"]
    assert "ACME Manufacturing" in messages[0].content
    assert "ACME Foundry" in messages[0].content
    assert "Atlas" in messages[0].content
    assert "line=production line" in messages[0].content
    assert "[M1] Remember 0" in messages[1].content
    assert "[M8] Remember 7" in messages[1].content
    assert "Remember 8" not in messages[1].content
    assert "[S1] SOP 0" in messages[1].content
    assert "[S8] SOP 7" in messages[1].content
    assert "SOP 8" not in messages[1].content
    assert "previous question" in messages[1].content
    assert "Return concise JSON." in messages[1].content
    assert "What changed?" in messages[1].content


def test_agent_runtime_routes_social_turns_away_from_rag():
    from app.services.ai.runtime import AgentRuntime
    from app.services.ai.intent_router import route_intent

    runtime = AgentRuntime()

    assert runtime.classify_knowledge_intent("你喜欢我吗") == "general"
    assert runtime.classify_knowledge_intent("你好呀 请问你是谁呀") == "general"
    assert runtime.classify_knowledge_intent("该文档中都包含什么内容") == "knowledge"
    assert runtime.classify_knowledge_intent("分析这个 SOP 的风险和 CAPA 关系") == "knowledge"

    action_route = route_intent("帮我新建一个供应商准入表单", {})
    assert action_route.intent == "action_prepare"
    assert action_route.skill == "low_code.create_form_definition"
    assert action_route.context_need == "draft_action"
    assert "tool_contract" in action_route.needs_context

    knowledge_route = route_intent("总结这篇文档", {"surface": "knowledge"})
    assert knowledge_route.intent == "knowledge"
    assert knowledge_route.context_need == "knowledge_rag"


@pytest.mark.asyncio
async def test_semantic_planner_cleans_form_name_particle(monkeypatch):
    from app.services.ai import semantic_planner
    from app.services.ai.schemas import AIProviderConfig

    monkeypatch.setattr(
        semantic_planner,
        "get_provider",
        lambda config: _SemanticFakeProvider(
            '{"intent":"action","skill":"low_code.create_form_definition","operation":"rename_form",'
            '"formName":"物料主数据把","fields":[],"menu":{},"confidence":0.91,"reason":"rename requested"}'
        ),
    )
    monkeypatch.setattr(semantic_planner, "_is_model_available", lambda config: True)

    plan = await semantic_planner.plan_agent_turn_semantic(
        "表单名称改成物料主数据把",
        {"pendingActionState": {"skill": "low_code.create_form_definition", "collected_slots": {"formName": "旧表单"}}},
        provider_config=AIProviderConfig(provider="glm", chat_model="glm-5.1"),
    )

    assert plan.intent == "action"
    assert plan.reason.startswith("llm_semantic")
    assert plan.extracted_context["formName"] == "物料主数据"


@pytest.mark.asyncio
async def test_semantic_add_field_does_not_rename_pending_form(monkeypatch):
    from app.services.ai import semantic_planner
    from app.services.ai.orchestrator import run_agent
    from app.services.ai.schemas import AIProviderConfig, AgentRequest

    monkeypatch.setattr(
        semantic_planner,
        "get_provider",
        lambda config: _SemanticFakeProvider(
            '{"intent":"action","skill":"low_code.create_form_definition","operation":"add_field",'
            '"formName":"","fields":[{"field_name":"supplier_rating","label":"供应商等级",'
            '"field_type":"string","required":false}],"menu":{},"confidence":0.93,"reason":"add one field"}'
        ),
    )
    monkeypatch.setattr(semantic_planner, "_is_model_available", lambda config: True)

    pending = {
        "status": "ready_for_confirmation",
        "skill": "low_code.create_form_definition",
        "source_message": "创建物料主数据表单",
        "collected_slots": {
            "formName": "物料主数据",
            "form_name": "物料主数据",
            "fields": [
                {"field_name": "material_code", "label": "物料编码", "field_type": "string", "required": True},
                {"field_name": "material_name", "label": "物料名称", "field_type": "string", "required": True},
            ],
        },
        "missing_slots": [],
        "notes": [],
    }

    result = await run_agent(
        AgentRequest(
            message="新增一个字段：供应商等级",
            context={"pendingActionState": pending},
            provider_config=AIProviderConfig(provider="glm", chat_model="glm-5.1"),
        ),
        user=_tenant_user(),
    )

    assert result.requires_confirmation is True
    assert result.action_state["collected_slots"]["formName"] == "物料主数据"
    payload = result.actions[0].payload
    assert payload["form"]["name"] == "物料主数据"
    assert [field["label"] for field in payload["fields"]] == ["物料编码", "物料名称", "供应商等级"]


@pytest.mark.asyncio
async def test_knowledge_answer_requires_model_configuration():
    from app.services.ai.runtime import AgentRuntime
    from app.services.ai.schemas import AIProviderConfig
    from app.services.ai.tenant_profile import TenantProfile

    profile = TenantProfile(
        tenant_id=1,
        slug="demo",
        display_name="Demo Works",
        product_name="Demo Platform",
        assistant_name="Demo Assistant",
    )

    answer, model_name, usage = await AgentRuntime().answer_knowledge(
        query="你喜欢我吗",
        title="焊点虚焊异常处置 SOP",
        evidence=[],
        history=[],
        tenant_profile=profile,
        provider_config=AIProviderConfig(provider="glm", chat_model="glm-5.1", api_key=""),
    )

    assert model_name == "unconfigured-ai-provider"
    assert usage["intent"] == "general"
    assert usage["evidence_count"] == 0
    assert usage["mode"] == "model_not_configured"
    assert "未配置大模型" in answer


@pytest.mark.asyncio
async def test_load_tenant_profile_uses_session_tenant_with_safe_fallback():
    from app.services.ai.tenant_profile import load_tenant_profile

    class TenantRow:
        name = "Contoso Works"
        slug = "contoso"

    class FakeSession:
        async def get(self, model, tenant_id):
            assert model.__name__ == "Tenant"
            assert tenant_id == 7
            return TenantRow()

    profile = await load_tenant_profile(7, session=FakeSession())

    assert profile.tenant_id == 7
    assert profile.slug == "contoso"
    assert profile.display_name == "Contoso Works"
    assert profile.product_name == "Contoso Works"
    assert profile.assistant_name == "Contoso Works AI"


@pytest.mark.asyncio
async def test_memory_service_append_turn_memory_populates_extended_fields():
    from app.models.relational import AIAgentRun, AIConversation, AIMessage
    from app.services.ai.memory import MemoryService

    class FakeSession:
        def __init__(self):
            self.added = []

        def add(self, item):
            self.added.append(item)

    conversation = AIConversation(
        conversation_id="conv-1",
        user_id="user-1",
        page="quality",
        document_id="doc-1",
        title="Quality chat",
    )
    run = AIAgentRun(
        run_id="run-1",
        conversation_id="conv-1",
        input_message="How do we handle defects?",
    )
    user_message = AIMessage(
        message_id="msg-user",
        conversation_id="conv-1",
        role="user",
        content="How do we handle defects?",
    )
    assistant_message = AIMessage(
        message_id="msg-assistant",
        conversation_id="conv-1",
        role="assistant",
        content="Open a CAPA draft and attach evidence.",
    )
    session = FakeSession()

    memory = await MemoryService().append_turn_memory(
        session,
        conversation=conversation,
        run=run,
        user_message=user_message,
        assistant_message=assistant_message,
        evidence=[{"document_id": "doc-1"}],
        tenant_id=9,
        user_key="operator-9",
        status="active",
    )

    assert session.added == [memory]
    assert memory.memory_id.startswith("mem-")
    assert memory.tenant_id == 9
    assert memory.user_key == "operator-9"
    assert memory.page == "quality"
    assert memory.document_id == "doc-1"
    assert memory.run_id == "run-1"
    assert memory.user_message_id == "msg-user"
    assert memory.assistant_message_id == "msg-assistant"
    assert memory.memory_type == "turn_summary"
    assert memory.content == "Open a CAPA draft and attach evidence."
    assert memory.confidence == 0.7
    assert memory.importance_score == 0.4
    assert memory.visibility == "private"
    assert memory.sensitivity == "normal"
    assert len(memory.content_hash) == 64
    assert memory.value["evidence_count"] == 1
    assert memory.status == "active"


def test_memory_service_serializes_prompt_context_and_markdown():
    from app.models.relational import AIMemoryEntry
    from app.services.ai.memory import MemoryService

    service = MemoryService()
    memory = AIMemoryEntry(
        memory_id="mem-1",
        conversation_id="conv-1",
        tenant_id=3,
        user_key="planner",
        page="knowledge",
        document_id="doc-7",
        run_id="run-7",
        scope="document",
        memory_type="preference",
        key="preferred_view",
        content="Use concise tables.",
        value={"format": "table"},
        tags=["ui"],
        summary="Planner prefers concise tables.",
        importance_score=0.8,
        confidence=0.9,
        visibility="tenant",
        sensitivity="normal",
        status="active",
    )

    serialized = service.serialize(memory)
    prompt_context = service.build_prompt_context([serialized, {"memory_id": "empty"}])
    markdown = service._memory_markdown(serialized)

    assert serialized["tenant_id"] == 3
    assert serialized["user_key"] == "planner"
    assert serialized["memory_type"] == "preference"
    assert serialized["content"] == "Use concise tables."
    assert serialized["tags"] == ["ui"]
    assert serialized["importance_score"] == 0.8
    assert serialized["confidence"] == 0.9
    assert prompt_context == [
        {
            "memory_id": "mem-1",
            "scope": "document",
            "summary": "Planner prefers concise tables.",
            "memory_type": "preference",
        }
    ]
    assert "memory_id: mem-1" in markdown
    assert "tenant_id: 3" in markdown
    assert "readonly: True" in markdown
    assert "Planner prefers concise tables." in markdown
