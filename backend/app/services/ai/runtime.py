"""Unified Agent runtime facade.

This first stage keeps public API contracts stable while moving prompt
construction, model calls, and policy-aware answer generation into services.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import Application, Form, Role, User, UserRole

from .form_record_tools import query_form_records
from .knowledge_ingestion import search_ingested_knowledge
from .prompt_builder import PromptBuildInput, PromptBuilder
from .schemas import AgentRequest, AgentResponse, ChatMessage, ChatOptions
from .settings import safety_policy_snapshot, settings_snapshot, settings_to_provider_config
from .tenant_profile import TenantProfile, default_tenant_profile
from .tenant_context import TenantContextError, require_tenant_id
from .intent_router import route_intent, route_intent_async
from .tools import choose_draft_actions, create_contract_draft_action, create_low_code_form_definition_action
from .action_guidance import (
    build_action_guidance_answer,
    describe_action_contract,
    has_minimum_action_requirements,
)
from .action_state import create_or_update_action_state
from .client import get_provider
from .preflight import preflight_agent_request
from .budget import BudgetTracker
from .compactor import ContextCompactor
from .events import AgentEvent, CompositeEventSink, EventBus
from .hooks import register_builtin_hooks
from .agent_items import from_legacy_step
from .tool_envelope import tool_execution_envelope


EXTERNAL_PROVIDER_NAMES = {"openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"}
RISK_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
AgentEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]


def _tenant_context_required_response(steps: list[dict[str, Any]]) -> AgentResponse:
    return AgentResponse(
        answer="Tenant context is required before querying tenant-scoped platform data.",
        evidence=[],
        steps=steps,
        mode="qa",
    )


def _agent_note_for_step(step: dict[str, Any]) -> str | None:
    step_id = str(step.get("id") or "")
    if step_id == "step-draft-resume":
        return "我先载入之前待确认的草稿，继续沿着同一个动作处理。"
    if step_id == "step-intent":
        return "我会先识别这句话是普通问答、知识检索，还是需要准备业务动作。"
    if step_id == "step-preflight":
        return "我先做一次请求预检，确认当前策略允许继续。"
    if step_id == "step-planner":
        return "我已经规划好接下来要走的任务路径。"
    if step_id.startswith("step-agent-loop-"):
        operation = step.get("operation")
        labels = {
            "preflight": "我先确认这次请求可以继续处理。",
            "route_intent": "我先判断这次更像问答、检索，还是需要准备业务动作。",
            "action_permission_policy": "我会先检查动作权限，避免未经确认的写入。",
            "knowledge_search": "我需要先查找相关知识和证据。",
            "forms_query_records": "我需要读取当前业务记录来补全上下文。",
            "prepare_action": "我会根据已有信息准备一个可复核的动作草稿。",
            "generate_answer": "我已经拿到足够上下文，开始组织回复。",
        }
        return labels.get(str(operation or ""), "我会根据刚拿到的结果继续判断下一步。")
    if step_id == "step-action-permission":
        return "涉及写入或流程动作时，我会先生成预览，不会直接落库。"
    if step_id == "step-knowledge-search":
        count = step.get("result_count")
        return f"我先检索知识库和证据，找到了 {count} 条相关结果。" if count is not None else "我先检索知识库和证据。"
    if step_id == "step-tool-contract":
        tool = step.get("tool") or "目标工具"
        return f"我读取了 {tool} 的工具合约，用它来校验必填字段和写入边界。"
    if step_id == "step-requirement-gap":
        return "信息还不够完整，我会先告诉你缺哪些内容。"
    if step_id == "step-skill-selection":
        skill = step.get("skill")
        return f"我选择用 {skill} 来准备这次业务动作。" if skill else "我已选择可用工具来准备这次业务动作。"
    if step_id == "step-confirmation":
        return "我已经整理好待确认动作，确认前不会写入系统。"
    if step_id == "step-answer":
        return "工具和上下文都整理完了，我开始生成最终回复。"
    if str(step.get("type") or "") == "tool":
        tool = step.get("tool")
        return f"我调用 {tool} 获取结果。" if tool else "我调用工具获取结果。"
    return None


def _tool_event_payload(step: dict[str, Any]) -> dict[str, Any] | None:
    if str(step.get("type") or "") != "tool":
        return None
    tool = step.get("tool")
    if not tool:
        return None
    payload = {
        "step_id": step.get("id"),
        "tool": tool,
        "status": step.get("status") or "completed",
    }
    if step.get("result_count") is not None:
        payload["result_count"] = step.get("result_count")
    if step.get("summary"):
        payload["summary"] = step.get("summary")
    return payload


def _max_risk(actions) -> str:
    if not actions:
        return "low"
    return max((action.risk_level for action in actions), key=lambda value: RISK_RANK.get(value, 0))


def _is_real_model_configured(config) -> bool:
    return config.provider in EXTERNAL_PROVIDER_NAMES and bool(config.api_key)


def _format_provider_failure(exc: Exception) -> str:
    detail = str(exc)
    if "余额不足" in detail or "无可用资源包" in detail or '"code":"1113"' in detail:
        return "大模型连接失败：供应商返回余额不足或无可用资源包，请充值、更换 API Key，或切换到有可用额度的模型资源。"
    return "大模型连接失败。请检查 AI provider、base URL、API Key、模型名称、账户额度和网络连通性后重试。"


def _form_query_payload(context: dict[str, Any]) -> dict[str, Any] | None:
    form_id = context.get("form_id") or context.get("formId") or context.get("currentFormId")
    form_code = context.get("form_code") or context.get("formCode") or context.get("currentFormCode")
    if not form_id and not form_code:
        return None
    payload: dict[str, Any] = {"limit": context.get("limit") or context.get("pageSize") or 20}
    if form_id:
        payload["form_id"] = form_id
    if form_code:
        payload["form_code"] = form_code
    if context.get("status"):
        payload["status"] = context.get("status")
    return payload


def _admin_recent_text(context: dict[str, Any]) -> str:
    recent = context.get("recentMessages") if isinstance(context.get("recentMessages"), list) else []
    return "\n".join(
        str(item.get("content") or "")
        for item in recent[-3:]
        if isinstance(item, dict)
    ).lower()


def _has_any(text: str, terms: list[str]) -> bool:
    return any(term in text for term in terms)


def _is_ambiguous_admin_followup(message: str) -> bool:
    text = message.lower()
    return _has_any(text, ["\u597d\u7684", "\u53ef\u4ee5", "\u5e2e\u6211\u67e5", "\u67e5\u770b\u4e0b", "\u67e5\u4e00\u4e0b", "ok", "yes"]) and not _has_any(
        text,
        ["\u7528\u6237", "\u8d26\u53f7", "\u8d26\u6237", "\u5e94\u7528", "\u7a0b\u5e8f", "\u7cfb\u7edf", "user", "users", "app", "application"],
    )


def _is_admin_application_query(message: str, context: dict[str, Any] | None = None) -> bool:
    context = context or {}
    text = message.lower()
    app_terms = ["\u5e94\u7528", "\u7a0b\u5e8f", "\u5e94\u7528\u5217\u8868", "app", "apps", "application", "applications"]
    query_terms = ["\u591a\u5c11", "\u51e0\u4e2a", "\u54ea\u4e9b", "\u5217\u8868", "\u67e5\u770b", "\u67e5\u8be2", "list", "show", "how many"]
    if _has_any(text, app_terms) and _has_any(text, query_terms):
        return True
    if _is_ambiguous_admin_followup(message):
        recent_text = _admin_recent_text(context)
        return _has_any(recent_text, app_terms) and _has_any(recent_text, query_terms)
    return False


def _is_admin_user_query(message: str, context: dict[str, Any] | None = None) -> bool:
    context = context or {}
    text = message.lower()
    user_terms = ["\u7528\u6237", "\u8d26\u53f7", "\u8d26\u6237", "user", "users", "account"]
    competing_terms = ["\u5e94\u7528", "\u7a0b\u5e8f", "app", "application"]
    query_terms = ["\u591a\u5c11", "\u51e0\u4e2a", "\u54ea\u4e9b", "\u5217\u8868", "\u67e5\u770b", "\u67e5\u8be2", "list", "show", "how many"]
    if _has_any(text, competing_terms):
        return False
    if _has_any(text, user_terms) and _has_any(text, query_terms):
        return True
    if _is_ambiguous_admin_followup(message):
        recent_text = _admin_recent_text(context)
        return _has_any(recent_text, user_terms) and _has_any(recent_text, query_terms) and not _has_any(recent_text, competing_terms)
    return False


def _match_platform_settings_query(message: str, context: dict[str, Any] | None = None) -> dict[str, str] | None:
    context = context or {}
    text = message.lower()
    query_terms = ["\u591a\u5c11", "\u51e0\u4e2a", "\u54ea\u4e9b", "\u5217\u8868", "\u67e5\u770b", "\u67e5\u8be2", "list", "show", "how many"]
    entities = [
        {
            "subject": "applications",
            "tool": "platform.application_settings.query",
            "terms": ["\u5e94\u7528", "\u7a0b\u5e8f", "\u5e94\u7528\u5217\u8868", "app", "apps", "application", "applications"],
        },
        {
            "subject": "identity_users",
            "tool": "platform.identity_settings.query",
            "terms": ["\u7528\u6237", "\u8d26\u53f7", "\u8d26\u6237", "user", "users", "account"],
        },
        {
            "subject": "forms",
            "tool": "platform.form_settings.query",
            "terms": ["\u8868\u5355", "\u8868\u5355\u8bbe\u7f6e", "\u5b57\u6bb5\u914d\u7f6e", "form", "forms", "field settings"],
        },
    ]
    for entity in entities:
        if _has_any(text, entity["terms"]) and _has_any(text, query_terms):
            return {"subject": entity["subject"], "tool": entity["tool"]}
    if _is_ambiguous_admin_followup(message):
        recent_text = _admin_recent_text(context)
        matches = [
            {"subject": entity["subject"], "tool": entity["tool"]}
            for entity in entities
            if _has_any(recent_text, entity["terms"]) and _has_any(recent_text, query_terms)
        ]
        return matches[-1] if matches else None
    return None


def _looks_like_pending_action_followup(message: str, pending_action: dict[str, Any]) -> bool:
    """Continue a pending draft only when the user appears to supply missing action details."""

    if not pending_action.get("skill"):
        return False
    normalized = message.strip().lower()
    if not normalized:
        return False
    fresh_intent_markers = [
        "你会干什么",
        "你能干什么",
        "what can you do",
        "who are you",
        "hello",
        "hi",
        "你好",
        "用户",
        "users",
        "有哪些",
        "列出",
        "查询",
        "show me",
        "list",
    ]
    if any(marker in normalized for marker in fresh_intent_markers):
        return False
    if any(marker in normalized for marker in ["取消", "不做", "forget", "cancel", "stop"]):
        return False

    collected = pending_action.get("collected_slots") if isinstance(pending_action.get("collected_slots"), dict) else {}
    missing = pending_action.get("missing_slots") if isinstance(pending_action.get("missing_slots"), list) else []
    slot_text = " ".join(str(item) for item in [*missing, *collected.keys()]).lower()
    slot_markers = {
        "asset": ["设备", "资产", "产线", "smt", "equipment", "asset", "line"],
        "problem_or_risk": ["问题", "风险", "异常", "温度", "漂移", "temperature", "abnormal", "risk", "problem"],
        "priority_or_window": ["优先级", "紧急", "小时", "负责人", "截止", "urgent", "priority", "hour", "owner", "due"],
        "fields": ["字段", "field"],
        "form.name": ["表单", "名称", "form"],
        "menu": ["菜单", "menu"],
    }
    active_markers = [marker for slot, markers in slot_markers.items() if slot in slot_text for marker in markers]
    if any(marker in normalized for marker in active_markers):
        return True
    return any(separator in message for separator in [":", "：", "；", ";"])


async def _emit_step(event_sink: AgentEventSink | None, step: dict[str, Any]) -> None:
    if event_sink:
        item = step if "item_id" in step and "payload" in step else from_legacy_step(step)
        note = _agent_note_for_step(step)
        if note:
            await event_sink("assistant.note", {"message": note, "item_id": item.get("item_id")})
        tool_payload = _tool_event_payload(step)
        if tool_payload:
            await event_sink("item.created", {**item, "status": "running"})
        await event_sink("item.updated", item)
        if tool_payload:
            await event_sink("item.updated", item)


class AgentRuntime:
    def __init__(self, prompt_builder: PromptBuilder | None = None, *, bus: EventBus | None = None):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self._bus = bus
        if bus:
            register_builtin_hooks(bus, settings_snapshot())

    def classify_knowledge_intent(self, query: str) -> str:
        """Backward-compatible wrapper around structured intent routing."""

        route = route_intent(query, {})
        return "knowledge" if route.intent in {"knowledge", "business_query", "page_help"} else "general"

    async def run(
        self,
        request: AgentRequest,
        *,
        tenant_profile: TenantProfile | None = None,
        user: dict[str, Any] | None = None,
        event_sink: AgentEventSink | None = None,
    ) -> AgentResponse:
        settings_data = settings_snapshot()
        loop_mode = str(safety_policy_snapshot(settings_data).get("agentLoopMode") or "pipeline").lower()
        if loop_mode in {"model", "tool_use"}:
            from .tool_use_loop import is_model_configured, tool_use_loop_runner

            config = request.provider_config or settings_to_provider_config(settings_data)
            if is_model_configured(config):
                return await tool_use_loop_runner.run(
                    request,
                    tenant_profile=tenant_profile,
                    user=user,
                    settings=settings_data,
                    config=config,
                    event_sink=event_sink,
                    bus=self._bus,
                )
            # Model loop requested but no provider configured: fall back to
            # the deterministic pipeline so the assistant stays usable.
        return await self._run_agent_loop(
            request,
            tenant_profile=tenant_profile,
            user=user,
            event_sink=event_sink,
        )

    async def resume_tool_use(
        self,
        frozen_context: Any,
        *,
        confirmation_token: str,
        user: dict[str, Any] | None = None,
        event_sink: AgentEventSink | None = None,
    ) -> AgentResponse:
        """Resume a frozen tool_use conversation after user confirmation."""
        from .schemas import FrozenContext
        from .tool_use_loop import tool_use_loop_runner

        settings_data = settings_snapshot()
        config = settings_to_provider_config(settings_data)
        frozen = (
            frozen_context
            if isinstance(frozen_context, FrozenContext)
            else FrozenContext.model_validate(frozen_context)
        )
        return await tool_use_loop_runner.resume(
            frozen,
            confirmation_token=confirmation_token,
            user=user,
            settings=settings_data,
            config=config,
            event_sink=event_sink,
            bus=self._bus,
        )

    async def _run_legacy_linear(
        self,
        request: AgentRequest,
        *,
        tenant_profile: TenantProfile | None = None,
        user: dict[str, Any] | None = None,
        event_sink: AgentEventSink | None = None,
    ) -> AgentResponse:
        """Run the generic enterprise Agent shell.

        The planner is still conservative in this stage: it proposes draft
        skill actions and RAG evidence, while the actual model-backed response
        path is introduced for knowledge conversations first.
        """

        profile = tenant_profile or default_tenant_profile(require_tenant_id(user or request.context))
        steps = [
            {
                "id": "step-intent",
                "type": "observe",
                "title": "Intent received",
                "status": "completed",
                "summary": request.message[:160],
            }
        ]
        pending_action = (request.context or {}).get("pendingActionState") or (request.context or {}).get("pending_action_state")
        resume_draft = (request.context or {}).get("resumeDraft") or (request.context or {}).get("resume_draft")
        if isinstance(resume_draft, dict) and resume_draft.get("draft_id"):
            resume_step = {
                "id": "step-draft-resume",
                "type": "context",
                "status": "completed",
                "draft_id": resume_draft.get("draft_id"),
                "skill": resume_draft.get("skill"),
                "draft_status": resume_draft.get("status"),
                "summary": "Loaded saved pending action for review.",
            }
            steps.append(resume_step)
            await _emit_step(event_sink, resume_step)
        if isinstance(resume_draft, dict) and resume_draft.get("skill") and not isinstance(pending_action, dict):
            draft_payload = resume_draft.get("payload") if isinstance(resume_draft.get("payload"), dict) else {}
            pending_action = {
                "status": "ready_for_confirmation",
                "skill": str(resume_draft.get("skill")),
                "source_message": str(draft_payload.get("source_message") or request.message),
                "collected_slots": draft_payload,
                "missing_slots": [],
                "notes": [f"resume pending action {resume_draft.get('draft_id')}"],
            }
        settings_data = settings_snapshot()
        preflight = preflight_agent_request(
            message=request.message,
            context=request.context,
            user=user,
            settings=settings_data,
        )
        preflight_step = preflight.as_step()
        steps.append(preflight_step)
        await _emit_step(event_sink, preflight_step)
        if not preflight.allowed:
            return AgentResponse(
                answer=f"当前 AI 权限策略不允许继续执行该请求：{preflight.reason}",
                steps=steps,
                mode="qa",
            )

        config = request.provider_config or settings_to_provider_config(settings_data)
        intent_route = await route_intent_async(request.message, request.context, provider_config=config)
        if (
            isinstance(pending_action, dict)
            and pending_action.get("skill")
            and intent_route.intent != "action_prepare"
            and (
                (isinstance(resume_draft, dict) and resume_draft.get("draft_id"))
                or _looks_like_pending_action_followup(request.message, pending_action)
            )
        ):
            intent_route.intent = "action_prepare"
            intent_route.skill = str(pending_action.get("skill"))
            intent_route.target = "action"
            intent_route.context_need = "draft_action"
            intent_route.needs_context = ["pending_action_state", "skill_contract", "tool_contract", "permission_policy"]
            intent_route.reason = "pending_action_followup"
            intent_route.source_message = "\n".join(
                item for item in [str(pending_action.get("source_message") or ""), request.message] if item
            )
            if isinstance(resume_draft, dict) and resume_draft.get("draft_id"):
                intent_route.reason = "resume_ai_draft"
        elif isinstance(pending_action, dict) and pending_action.get("skill") and intent_route.intent != "action_prepare":
            pending_action = None
            intent_route.reason = "new_intent_ignored_pending_action"
        route_step = intent_route.as_step()
        steps.append(route_step)
        await _emit_step(event_sink, route_step)
        planner_step = {
            "id": "step-planner",
            "type": "plan",
            "status": "completed",
            "intent": "action" if intent_route.intent == "action_prepare" else "qa",
            "skill": intent_route.skill,
            "confidence": intent_route.confidence,
            "reason": intent_route.reason,
        }
        steps.append(planner_step)
        await _emit_step(event_sink, planner_step)
        permission_context_step = {
            "id": "step-action-permission",
            "type": "policy",
            "status": "completed",
            "summary": "Permission and risk policy will gate any draft write before execution.",
            "requires_confirmation": True,
        }
        steps.append(permission_context_step)
        await _emit_step(event_sink, permission_context_step)
        context_need = intent_route.context_need
        if context_need in {"knowledge_rag", "business_query", "semantic_graph", "draft_action"}:
            try:
                tenant_id = require_tenant_id(user or request.context)
            except TenantContextError:
                return _tenant_context_required_response(steps)
            evidence = search_ingested_knowledge(request.message, tenant_id=tenant_id, limit=3)
        else:
            evidence = []
        if context_need in {"knowledge_rag", "business_query", "semantic_graph", "draft_action"}:
            knowledge_step = {
                "id": "step-knowledge-search",
                "type": "tool",
                "tool": "knowledge.search",
                "status": "completed",
                "result_count": len(evidence),
            }
            steps.append(knowledge_step)
            await _emit_step(event_sink, knowledge_step)
        actions = []
        action_state: dict[str, Any] | None = None
        if intent_route.skill == "low_code.create_form_definition":
            action_context = {
                **(request.context or {}),
                **(pending_action.get("collected_slots") if isinstance(pending_action, dict) and isinstance(pending_action.get("collected_slots"), dict) else {}),
                **intent_route.extracted_context,
            }
            action_state = create_or_update_action_state(
                existing=pending_action if isinstance(pending_action, dict) else None,
                skill=intent_route.skill,
                source_message=intent_route.source_message,
                extracted_context=action_context,
            )
            effective_action_context = (
                action_state.get("collected_slots")
                if isinstance(action_state.get("collected_slots"), dict)
                else action_context
            )
            contract = describe_action_contract(intent_route.skill)
            contract_step = {
                "id": "step-tool-contract",
                "type": "observe",
                "status": "completed",
                "tool": contract["tool"],
                "summary": "Loaded form creation API contract before planning a write.",
                "required": contract["required"],
            }
            steps.append(contract_step)
            await _emit_step(event_sink, contract_step)
            if action_state.get("missing_slots") or not has_minimum_action_requirements(intent_route.skill, intent_route.source_message, effective_action_context):
                missing_step = {
                    "id": "step-requirement-gap",
                    "type": "plan",
                    "status": "completed",
                    "summary": "Need more form design details before preparing a write confirmation.",
                    "missing_slots": action_state.get("missing_slots") or [],
                }
                steps.append(missing_step)
                await _emit_step(event_sink, missing_step)
                return AgentResponse(
                    answer=build_action_guidance_answer(
                        intent_route.skill,
                        assistant_name=profile.assistant_name,
                        action_state=action_state,
                    ),
                    evidence=evidence,
                    steps=steps,
                    action_state=action_state,
                    mode="qa",
                )
            actions.append(create_low_code_form_definition_action(intent_route.source_message, evidence=evidence, context=effective_action_context))
        elif intent_route.intent != "action_prepare":
            actions = choose_draft_actions(request.message, evidence=evidence, context=request.context)
            if actions:
                first_action = actions[0]
                evidence_text = "\n".join(
                    str(item.get("snippet") or item.get("chunk_text") or item.get("content") or item.get("summary") or "")
                    for item in evidence
                    if isinstance(item, dict)
                )
                action_source_message = "\n".join(part for part in [request.message, evidence_text] if part)
                action_state = create_or_update_action_state(
                    existing=pending_action if isinstance(pending_action, dict) else None,
                    skill=first_action.skill,
                    source_message=action_source_message,
                    extracted_context={},
                )
                contract = describe_action_contract(first_action.skill)
                contract_step = {
                    "id": "step-tool-contract",
                    "type": "observe",
                    "status": "completed",
                    "tool": contract.get("tool") or first_action.skill,
                    "summary": "Loaded action skill/tool contract before preparing confirmation.",
                    "required": contract.get("required") or [],
                }
                steps.append(contract_step)
                await _emit_step(event_sink, contract_step)
                if action_state.get("missing_slots") or not has_minimum_action_requirements(first_action.skill, action_source_message, request.context):
                    missing_step = {
                        "id": "step-requirement-gap",
                        "type": "plan",
                        "status": "completed",
                        "summary": "Need more action details before preparing a confirmation.",
                        "missing_slots": action_state.get("missing_slots") or [],
                    }
                    steps.append(missing_step)
                    await _emit_step(event_sink, missing_step)
                    return AgentResponse(
                        answer=build_action_guidance_answer(
                            first_action.skill,
                            assistant_name=profile.assistant_name,
                            action_state=action_state,
                        ),
                        evidence=evidence,
                        steps=steps,
                        action_state=action_state,
                        mode="qa",
                    )
                actions = choose_draft_actions(
                    request.message,
                    evidence=evidence,
                    context=action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else {},
                )
        elif intent_route.skill:
            action_state = create_or_update_action_state(
                existing=pending_action if isinstance(pending_action, dict) else None,
                skill=intent_route.skill,
                source_message=intent_route.source_message or request.message,
                extracted_context={},
            )
            if action_state.get("missing_slots"):
                missing_step = {
                    "id": "step-requirement-gap",
                    "type": "plan",
                    "status": "completed",
                    "summary": "Need more action details before preparing a confirmation.",
                    "missing_slots": action_state.get("missing_slots") or [],
                }
                steps.append(missing_step)
                await _emit_step(event_sink, missing_step)
                return AgentResponse(
                    answer=build_action_guidance_answer(
                        intent_route.skill,
                        assistant_name=profile.assistant_name,
                        action_state=action_state,
                    ),
                    evidence=evidence,
                    steps=steps,
                    action_state=action_state,
                    mode="qa",
                )
            actions = choose_draft_actions(
                intent_route.source_message or request.message,
                evidence=evidence,
                context=action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else {},
            )
            if not actions:
                actions = [
                    create_contract_draft_action(
                        intent_route.skill,
                        evidence=evidence,
                        context=action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else {},
                        source_message=intent_route.source_message or request.message,
                    )
                ]
        if actions:
            if not action_state:
                action_state = create_or_update_action_state(
                    existing=pending_action if isinstance(pending_action, dict) else None,
                    skill=actions[0].skill,
                    source_message=intent_route.source_message or request.message,
                    extracted_context=pending_action.get("collected_slots") if isinstance(pending_action, dict) and isinstance(pending_action.get("collected_slots"), dict) else {},
                )
            skill_step = {
                "id": "step-skill-selection",
                "type": "plan",
                "status": "completed",
                "skills": [action.skill for action in actions],
            }
            confirmation_step = {
                "id": "step-confirmation",
                "type": "policy",
                "status": "waiting_confirmation",
                "summary": "Draft actions require human confirmation before saving or submission.",
            }
            steps.append(skill_step)
            await _emit_step(event_sink, skill_step)
            steps.append(confirmation_step)
            await _emit_step(event_sink, confirmation_step)
            return AgentResponse(
                answer=f"{profile.assistant_name} 已准备好草稿动作，确认前不会写入或提交业务流程。",
                actions=actions,
                evidence=evidence,
                steps=steps,
                action_state={**action_state, "status": "ready_for_confirmation", "missing_slots": []},
                risk_level=_max_risk(actions),
                requires_confirmation=any(action.requires_confirmation for action in actions),
                mode="assisted",
            )

        form_query_payload = _form_query_payload(request.context or {})
        if user and preflight.capability == "business_query" and form_query_payload:
            async with db_session() as session:
                query_result = await query_form_records(session, user=user, payload=form_query_payload)
            tool_step = {
                "id": "step-form-record-query",
                "type": "tool",
                "tool": "forms.query_records",
                "status": "completed",
                "result_count": query_result.get("record_count", 0),
            }
            steps.append(tool_step)
            await _emit_step(event_sink, tool_step)
            records = query_result.get("records") or []
            evidence = [
                {
                    "source": "forms.query_records",
                    "form": query_result.get("form"),
                    "record_id": record.get("id"),
                    "data": record.get("data"),
                }
                for record in records[:8]
            ]
            form_name = (query_result.get("form") or {}).get("name") or (query_result.get("form") or {}).get("code") or "当前表单"
            return AgentResponse(
                answer=(
                    f"已按权限读取 `{form_name}` 的 {query_result.get('record_count', 0)} 条记录。"
                    "我会基于可见字段给出分析；若需要写入或发起流程，会先生成操作预览和确认清单。"
                ),
                evidence=evidence,
                steps=steps,
                mode="qa",
            )

        if not _is_real_model_configured(config):
            model_step = {
                "id": "step-model-config",
                "type": "configure",
                "status": "blocked",
                "provider": config.provider,
                "model": config.chat_model,
                "summary": "Large model provider is not configured.",
            }
            steps.append(model_step)
            await _emit_step(event_sink, model_step)
            return AgentResponse(
                answer="未配置大模型。请先在 AI 设置或后端环境变量中配置可用的大模型 provider、base URL、API Key 和模型名称。",
                evidence=evidence,
                steps=steps,
                mode="qa",
            )

        try:
            provider = get_provider(config)
            messages = self.prompt_builder.build(
                PromptBuildInput(
                    mode="agent",
                    tenant_profile=profile,
                    user_context=user or {},
                    page_context={
                        "page": request.page,
                        **(request.context or {}),
                    },
                    evidence=evidence,
                    tool_policy={"write_policy": "risk_based_confirmation"},
                    output_contract=(
                        "用中文自然回答用户当前问题。"
                        "回答前必须遵循平台已完成的身份识别、角色权限和风险策略结果；不要越权推测用户不可访问的数据。"
                        "如果问题可以直接回答，就直接回答；涉及企业事实时优先结合页面上下文和证据。"
                        "可以给出建议和草稿思路，但不要声称已经写入、提交或执行业务动作。"
                    ),
                    user_message=request.message,
                )
            )
            result = await provider.chat(messages, ChatOptions(model=config.chat_model, max_tokens=1200, temperature=0.3))
            answer_step = {
                "id": "step-answer",
                "type": "respond",
                "status": "completed",
                "model": result.model,
                "provider": result.provider,
            }
            steps.append(answer_step)
            await _emit_step(event_sink, answer_step)
            return AgentResponse(
                answer=result.content,
                evidence=evidence,
                steps=steps,
                mode="qa",
            )
        except Exception as exc:  # noqa: BLE001 - page assistant should degrade gracefully
            failed_step = {
                "id": "step-answer",
                "type": "respond",
                "status": "failed",
                "model": config.chat_model,
                "provider": config.provider,
                "fallback_reason": str(exc),
            }
            steps.append(failed_step)
            await _emit_step(event_sink, failed_step)
            return AgentResponse(
                answer=_format_provider_failure(exc),
                evidence=evidence,
                steps=steps,
                mode="qa",
            )

    async def _run_agent_loop(
        self,
        request: AgentRequest,
        *,
        tenant_profile: TenantProfile | None = None,
        user: dict[str, Any] | None = None,
        event_sink: AgentEventSink | None = None,
    ) -> AgentResponse:
        profile = tenant_profile or default_tenant_profile(require_tenant_id(user or request.context))
        settings_data = settings_snapshot()
        safety_policy = safety_policy_snapshot(settings_data)
        budget = BudgetTracker(
            max_input_tokens=int(safety_policy.get("agentMaxInputTokens") or 100_000),
            max_output_tokens=int(safety_policy.get("agentMaxOutputTokens") or 20_000),
        )
        max_iterations = max(3, min(int(safety_policy.get("maxToolSteps") or 5) + 4, 12))
        steps: list[dict[str, Any]] = []
        # One bus per run: builtin hooks (audit / budget / compaction /
        # permission interception) are registered once and every envelope
        # call below reuses this bus instead of rebuilding its own.
        loop_bus = self._bus
        if loop_bus is None:
            loop_bus = EventBus()
            register_builtin_hooks(loop_bus, settings_data)
        state: dict[str, Any] = {
            "profile": profile,
            "settings": settings_data,
            "config": request.provider_config or settings_to_provider_config(settings_data),
            "pending_action": (request.context or {}).get("pendingActionState") or (request.context or {}).get("pending_action_state"),
            "resume_draft": (request.context or {}).get("resumeDraft") or (request.context or {}).get("resume_draft"),
            "evidence": None,
            "actions": [],
            "action_state": None,
            "checked_action": False,
            "checked_form_query": False,
            "checked_platform_settings_query": False,
            "response": None,
            "budget": budget,
            "event_bus": loop_bus,
        }

        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-intent",
                "type": "observe",
                "title": "Intent received",
                "status": "completed",
                "summary": request.message[:160],
            },
        )
        self._hydrate_resume_state(state, request)
        if isinstance(state.get("resume_step"), dict):
            await self._record_loop_step(steps, event_sink, state["resume_step"])

        for iteration in range(1, max_iterations + 1):
            if budget.is_exceeded():
                await loop_bus.emit(AgentEvent.BUDGET_EXCEEDED, {"budget": budget.summary()})
                return AgentResponse(
                    answer="Token 预算已用尽，请缩小查询范围或开启新对话。",
                    evidence=state.get("evidence") or [],
                    steps=steps,
                    action_state=state.get("action_state"),
                    mode="qa",
                    token_budget=budget.summary(),
                )

            operation = self._next_loop_operation(state, request)
            await self._record_loop_step(
                steps,
                event_sink,
                {
                    "id": f"step-agent-loop-{iteration}",
                    "type": "plan",
                    "status": "completed",
                    "iteration": iteration,
                    "operation": operation,
                    "observations": self._loop_observations(state),
                },
            )
            if operation == "final":
                response = state.get("response")
                if isinstance(response, AgentResponse):
                    response.steps = steps
                    response.token_budget = budget.summary()
                    return response
                break
            await self._execute_loop_operation(operation, request, state, steps, event_sink, user=user)
            if isinstance(state.get("response"), AgentResponse):
                response = state["response"]
                response.steps = steps
                response.token_budget = budget.summary()
                return response

        blocked_step = {
            "id": "step-agent-loop-limit",
            "type": "plan",
            "status": "blocked",
            "summary": "Agent loop reached the configured maximum iterations before producing a final answer.",
        }
        await self._record_loop_step(steps, event_sink, blocked_step)
        return AgentResponse(
            answer="我已经多轮检查上下文和工具结果，但还没有得到足够稳定的下一步。请补充目标、对象或要执行的动作，我会继续处理。",
            evidence=state.get("evidence") or [],
            steps=steps,
            action_state=state.get("action_state"),
            mode="qa",
            token_budget=budget.summary(),
        )

    async def _record_loop_step(
        self,
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        step: dict[str, Any],
    ) -> None:
        item = step if "item_id" in step and "payload" in step else from_legacy_step(step)
        steps.append(item)
        await _emit_step(event_sink, item)

    def _hydrate_resume_state(self, state: dict[str, Any], request: AgentRequest) -> None:
        resume_draft = state.get("resume_draft")
        pending_action = state.get("pending_action")
        if isinstance(resume_draft, dict) and resume_draft.get("draft_id"):
            state["resume_step"] = {
                "id": "step-draft-resume",
                "type": "context",
                "status": "completed",
                "draft_id": resume_draft.get("draft_id"),
                "skill": resume_draft.get("skill"),
                "draft_status": resume_draft.get("status"),
                "summary": "Loaded saved pending action for review.",
            }
        if isinstance(resume_draft, dict) and resume_draft.get("skill") and not isinstance(pending_action, dict):
            draft_payload = resume_draft.get("payload") if isinstance(resume_draft.get("payload"), dict) else {}
            state["pending_action"] = {
                "status": "ready_for_confirmation",
                "skill": str(resume_draft.get("skill")),
                "source_message": str(draft_payload.get("source_message") or request.message),
                "collected_slots": draft_payload,
                "missing_slots": [],
                "notes": [f"resume pending action {resume_draft.get('draft_id')}"],
            }

    def _loop_observations(self, state: dict[str, Any]) -> dict[str, Any]:
        route = state.get("intent_route")
        evidence = state.get("evidence")
        actions = state.get("actions") or []
        return {
            "preflight": bool(state.get("preflight")),
            "intent": getattr(route, "intent", None),
            "context_need": getattr(route, "context_need", None),
            "evidence_count": len(evidence or []),
            "actions": [action.skill for action in actions],
            "has_response": isinstance(state.get("response"), AgentResponse),
        }

    def _next_loop_operation(self, state: dict[str, Any], request: AgentRequest) -> str:
        if isinstance(state.get("response"), AgentResponse):
            return "final"
        if not state.get("preflight"):
            return "preflight"
        if not state.get("intent_route"):
            return "route_intent"
        route = state["intent_route"]
        if (
            not state.get("checked_platform_settings_query")
            and _match_platform_settings_query(request.message, request.context)
        ):
            state["platform_settings_query"] = _match_platform_settings_query(request.message, request.context)
            return "platform_settings_query"
        if (
            state.get("evidence") is None
            and getattr(route, "context_need", None) in {"knowledge_rag", "business_query", "semantic_graph", "draft_action"}
        ):
            return "knowledge_search"
        if (
            not state.get("checked_form_query")
            and state.get("preflight_capability") == "business_query"
            and _form_query_payload(request.context or {})
        ):
            return "forms_query_records"
        route_wants_action = self._route_wants_action(state)
        if route_wants_action and not state.get("permission_context_checked"):
            return "action_permission_policy"
        if route_wants_action and not state.get("checked_action"):
            return "prepare_action"
        if not state.get("checked_action"):
            fallback_actions = choose_draft_actions(
                request.message,
                evidence=state.get("evidence") or [],
                context=request.context,
            )
            if fallback_actions:
                state["fallback_actions"] = fallback_actions
                if not state.get("permission_context_checked"):
                    return "action_permission_policy"
                return "prepare_action"
        return "generate_answer"

    def _route_wants_action(self, state: dict[str, Any]) -> bool:
        route = state.get("intent_route")
        pending = state.get("pending_action")
        if isinstance(pending, dict) and pending.get("skill"):
            return True
        return bool(route and (getattr(route, "intent", None) == "action_prepare" or getattr(route, "skill", None)))

    async def _execute_loop_operation(
        self,
        operation: str,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        if operation == "preflight":
            await self._loop_preflight(request, state, steps, event_sink, user=user)
            return
        if operation == "route_intent":
            await self._loop_route_intent(request, state, steps, event_sink)
            return
        if operation == "action_permission_policy":
            await self._record_loop_step(
                steps,
                event_sink,
                {
                    "id": "step-action-permission",
                    "type": "policy",
                    "status": "completed",
                    "summary": "Permission and risk policy will gate any draft write before execution.",
                    "requires_confirmation": True,
                },
            )
            state["permission_context_checked"] = True
            return
        if operation == "knowledge_search":
            await self._loop_knowledge_search(request, state, steps, event_sink, user=user)
            return
        if operation == "forms_query_records":
            await self._loop_forms_query(request, state, steps, event_sink, user=user)
            return
        if operation == "platform_settings_query":
            await self._loop_platform_settings_query(request, state, steps, event_sink, user=user)
            return
        if operation == "prepare_action":
            await self._loop_prepare_action(request, state, steps, event_sink)
            return
        if operation == "generate_answer":
            await self._loop_generate_answer(request, state, steps, event_sink, user=user)

    async def _loop_preflight(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        preflight = preflight_agent_request(
            message=request.message,
            context=request.context,
            user=user,
            settings=state["settings"],
        )
        state["preflight"] = preflight
        state["preflight_capability"] = preflight.capability
        await self._record_loop_step(steps, event_sink, preflight.as_step())
        if not preflight.allowed:
            state["response"] = AgentResponse(
                answer=f"当前 AI 权限策略不允许继续执行该请求：{preflight.reason}",
                steps=steps,
                mode="qa",
            )

    async def _loop_route_intent(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
    ) -> None:
        budget = state.get("budget")
        route = await route_intent_async(
            request.message,
            request.context,
            provider_config=state["config"],
            usage_sink=budget.accumulate if budget else None,
        )
        pending_action = state.get("pending_action")
        resume_draft = state.get("resume_draft")
        if (
            isinstance(pending_action, dict)
            and pending_action.get("skill")
            and route.intent != "action_prepare"
            and (
                (isinstance(resume_draft, dict) and resume_draft.get("draft_id"))
                or _looks_like_pending_action_followup(request.message, pending_action)
            )
        ):
            route.intent = "action_prepare"
            route.skill = str(pending_action.get("skill"))
            route.target = "action"
            route.context_need = "draft_action"
            route.needs_context = ["pending_action_state", "skill_contract", "tool_contract", "permission_policy"]
            route.reason = "pending_action_followup"
            route.source_message = "\n".join(
                item for item in [str(pending_action.get("source_message") or ""), request.message] if item
            )
            if isinstance(resume_draft, dict) and resume_draft.get("draft_id"):
                route.reason = "resume_ai_draft"
        elif isinstance(pending_action, dict) and pending_action.get("skill") and route.intent != "action_prepare":
            state["pending_action"] = None
            route.reason = "new_intent_ignored_pending_action"
        state["intent_route"] = route
        await self._record_loop_step(steps, event_sink, route.as_step())
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-planner",
                "type": "plan",
                "status": "completed",
                "intent": "action" if route.intent == "action_prepare" else "qa",
                "skill": route.skill,
                "confidence": route.confidence,
                "reason": route.reason,
                "next_operation": "prepare_action" if route.intent == "action_prepare" else "answer_or_retrieve",
            },
        )

    async def _loop_knowledge_search(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        route = state["intent_route"]
        current_user = (request.context or {}).get("_current_user") or user or request.context
        try:
            tenant_id = require_tenant_id(current_user)
        except TenantContextError:
            state["response"] = _tenant_context_required_response(steps)
            return
        envelope_result = await tool_execution_envelope.execute_tool(
            tool_name="knowledge.search",
            payload={"query": request.message, "limit": 3, "tenant_id": tenant_id},
            current_user=current_user,
            settings=state.get("settings"),
            confirmed=False,
            event_sink=event_sink,
            event_bus=state.get("event_bus"),
        )
        steps.extend(item for item in (envelope_result.get("items") or []) if isinstance(item, dict))
        evidence = (envelope_result.get("result") or {}).get("results") or []
        state["evidence"] = evidence
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-knowledge-search",
                "type": "tool",
                "tool": "knowledge.search",
                "status": "completed",
                "context_need": route.context_need,
                "result_count": len(evidence),
            },
        )

    async def _loop_forms_query(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        state["checked_form_query"] = True
        if not user:
            return
        payload = _form_query_payload(request.context or {})
        if not payload:
            return
        envelope_result = await tool_execution_envelope.execute_tool(
            tool_name="forms.query_records",
            payload=payload,
            current_user=user or {},
            settings=state.get("settings"),
            confirmed=False,
            event_sink=event_sink,
            event_bus=state.get("event_bus"),
        )
        steps.extend(item for item in (envelope_result.get("items") or []) if isinstance(item, dict))
        query_result = envelope_result.get("result") or {}
        if envelope_result.get("status") == "failed":
            state["response"] = AgentResponse(
                answer=f"读取表单数据失败：{envelope_result.get('error') or 'unknown error'}",
                evidence=[],
                steps=steps,
                mode="qa",
            )
            return
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-form-record-query",
                "type": "tool",
                "tool": "forms.query_records",
                "status": "completed",
                "result_count": query_result.get("record_count", 0),
            },
        )
        records = query_result.get("records") or []
        evidence = [
            {
                "source": "forms.query_records",
                "form": query_result.get("form"),
                "record_id": record.get("id"),
                "data": record.get("data"),
            }
            for record in records[:8]
        ]
        state["evidence"] = evidence
        form_name = (query_result.get("form") or {}).get("name") or (query_result.get("form") or {}).get("code") or "当前表单"
        state["response"] = AgentResponse(
            answer=(
                f"已按权限读取 `{form_name}` 的 {query_result.get('record_count', 0)} 条记录。"
                "我会基于可见字段给出分析；若需要写入或发起流程，会先生成操作预览和确认清单。"
            ),
            evidence=evidence,
            steps=steps,
            mode="qa",
        )

    async def _loop_platform_settings_query(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        state["checked_platform_settings_query"] = True
        match = state.get("platform_settings_query") or _match_platform_settings_query(request.message, request.context)
        if not isinstance(match, dict):
            return
        if not user or not user.get("is_admin"):
            state["response"] = AgentResponse(
                answer="\u5f53\u524d\u7528\u6237\u6ca1\u6709\u67e5\u770b\u5e73\u53f0\u8bbe\u7f6e\u6570\u636e\u7684\u6743\u9650\u3002",
                evidence=[],
                steps=steps,
                mode="qa",
            )
            return

        try:
            tenant_id = require_tenant_id(user)
        except TenantContextError:
            state["response"] = _tenant_context_required_response(steps)
            return
        subject = str(match.get("subject") or "")
        tool = str(match.get("tool") or "platform.settings.query")
        if subject == "applications":
            rows = await self._query_application_settings(tenant_id)
            columns = ["\u5e94\u7528\u540d\u79f0", "\u4ee3\u7801", "\u5165\u53e3", "\u72b6\u6001"]
            values = [
                [row["name"], row["code"], row["default_route"] or "-", row["status"] or "-"]
                for row in rows
            ]
            title = f"\u6211\u5df2\u901a\u8fc7 `{tool}` \u67e5\u8be2\u5f53\u524d\u79df\u6237\u5e94\u7528\u8bbe\u7f6e\uff0c\u5171 {len(rows)} \u4e2a\uff1a"
            evidence_key = "applications"
        elif subject == "identity_users":
            rows = await self._query_identity_settings(tenant_id)
            columns = ["\u7528\u6237\u540d", "\u663e\u793a\u540d", "\u90ae\u7bb1", "\u89d2\u8272", "\u72b6\u6001"]
            values = [
                [row["username"], row["display_name"] or "-", row["email"] or "-", "\u3001".join(row["roles"]) if row["roles"] else "-", "\u542f\u7528" if row["is_active"] else "\u505c\u7528"]
                for row in rows
            ]
            title = f"\u6211\u5df2\u901a\u8fc7 `{tool}` \u67e5\u8be2\u5f53\u524d\u79df\u6237\u8eab\u4efd\u8bbe\u7f6e\uff0c\u5171 {len(rows)} \u4e2a\u7528\u6237\uff1a"
            evidence_key = "users"
        elif subject == "forms":
            rows = await self._query_form_settings(tenant_id)
            columns = ["\u8868\u5355\u540d\u79f0", "\u4ee3\u7801", "\u6570\u636e\u8868", "\u72b6\u6001"]
            values = [
                [row["name"], row["code"], row["table_name"], row["status"]]
                for row in rows
            ]
            title = f"\u6211\u5df2\u901a\u8fc7 `{tool}` \u67e5\u8be2\u5f53\u524d\u79df\u6237\u8868\u5355\u8bbe\u7f6e\uff0c\u5171 {len(rows)} \u4e2a\uff1a"
            evidence_key = "forms"
        else:
            return

        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": f"step-{tool.replace('.', '-')}",
                "type": "tool",
                "tool": tool,
                "status": "completed",
                "result_count": len(rows),
                "summary": f"subject={subject}; tenant_id={tenant_id}",
            },
        )
        lines = [title, "", "| " + " | ".join(columns) + " |", "| " + " | ".join("---" for _ in columns) + " |"]
        for row_values in values:
            lines.append("| " + " | ".join(str(item) for item in row_values) + " |")
        state["evidence"] = [{"source": tool, evidence_key: rows, "count": len(rows)}]
        state["response"] = AgentResponse(
            answer="\n".join(lines) if rows else f"{title}\n\n\u6682\u65f6\u6ca1\u6709\u67e5\u5230\u6570\u636e\u3002",
            evidence=state["evidence"],
            steps=steps,
            mode="qa",
        )

    async def _query_application_settings(self, tenant_id: int) -> list[dict[str, Any]]:
        async with db_session() as session:
            applications = (
                await session.execute(
                    select(Application)
                    .where(Application.tenant_id == tenant_id)
                    .order_by(Application.sort_order, Application.id)
                )
            ).scalars().all()
        return [
            {
                "id": item.id,
                "name": item.name,
                "code": item.code,
                "default_route": item.default_route,
                "status": item.status,
                "is_pinned": item.is_pinned,
            }
            for item in applications
        ]

    async def _query_identity_settings(self, tenant_id: int) -> list[dict[str, Any]]:
        async with db_session() as session:
            users = (
                await session.execute(
                    select(User)
                    .where(User.tenant_id == tenant_id)
                    .order_by(User.id)
                )
            ).scalars().all()
            user_ids = [item.id for item in users]
            role_map: dict[int, list[str]] = {item.id: [] for item in users}
            if user_ids:
                role_rows = (
                    await session.execute(
                        select(UserRole.user_id, Role.name, Role.label)
                        .join(Role, Role.id == UserRole.role_id)
                        .where(
                            UserRole.tenant_id == tenant_id,
                            Role.tenant_id == tenant_id,
                            UserRole.user_id.in_(user_ids),
                        )
                        .order_by(UserRole.user_id, Role.id)
                    )
                ).all()
                for user_id, role_name, role_label in role_rows:
                    role_map.setdefault(int(user_id), []).append(str(role_label or role_name or "role"))
        return [
            {
                "id": item.id,
                "username": item.username,
                "display_name": item.display_name,
                "email": item.email,
                "is_active": item.is_active,
                "is_admin": item.is_admin,
                "roles": role_map.get(item.id) or (["\u7ba1\u7406\u5458"] if item.is_admin else []),
            }
            for item in users
        ]

    async def _query_form_settings(self, tenant_id: int) -> list[dict[str, Any]]:
        async with db_session() as session:
            forms = (
                await session.execute(
                    select(Form)
                    .where(Form.tenant_id == tenant_id)
                    .order_by(Form.id)
                )
            ).scalars().all()
        return [
            {
                "id": item.id,
                "name": item.name,
                "code": item.code,
                "table_name": item.table_name,
                "status": item.status,
            }
            for item in forms
        ]

    async def _loop_admin_list_applications(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        state["checked_admin_application_query"] = True
        if not user or not user.get("is_admin"):
            state["response"] = AgentResponse(
                answer="\u5f53\u524d\u7528\u6237\u6ca1\u6709\u67e5\u770b\u5e94\u7528\u7ba1\u7406\u5217\u8868\u7684\u6743\u9650\u3002",
                evidence=[],
                steps=steps,
                mode="qa",
            )
            return

        try:
            tenant_id = require_tenant_id(user)
        except TenantContextError:
            state["response"] = _tenant_context_required_response(steps)
            return
        async with db_session() as session:
            applications = (
                await session.execute(
                    select(Application)
                    .where(Application.tenant_id == tenant_id)
                    .order_by(Application.sort_order, Application.id)
                )
            ).scalars().all()

        app_rows = [
            {
                "id": item.id,
                "name": item.name,
                "code": item.code,
                "default_route": item.default_route,
                "status": item.status,
                "is_pinned": item.is_pinned,
            }
            for item in applications
        ]
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-admin-list-applications",
                "type": "tool",
                "tool": "admin.list_applications",
                "status": "completed",
                "result_count": len(app_rows),
                "summary": f"tenant_id={tenant_id}",
            },
        )
        evidence = [{"source": "admin.list_applications", "applications": app_rows, "count": len(app_rows)}]
        if not app_rows:
            answer = "\u6211\u5df2\u901a\u8fc7 `admin.list_applications` \u67e5\u8be2\u5f53\u524d\u79df\u6237\uff0c\u6682\u65f6\u6ca1\u6709\u67e5\u5230\u5e94\u7528\u3002"
        else:
            lines = [
                f"\u6211\u5df2\u901a\u8fc7 `admin.list_applications` \u67e5\u8be2\u5f53\u524d\u79df\u6237\u5e94\u7528\uff0c\u5171 {len(app_rows)} \u4e2a\uff1a",
                "",
                "| \u5e94\u7528\u540d\u79f0 | \u4ee3\u7801 | \u5165\u53e3 | \u72b6\u6001 |",
                "|---|---|---|---|",
            ]
            for item in app_rows:
                lines.append(
                    f"| {item['name']} | {item['code']} | {item['default_route'] or '-'} | {item['status'] or '-'} |"
                )
            answer = "\n".join(lines)

        state["evidence"] = evidence
        state["response"] = AgentResponse(
            answer=answer,
            evidence=evidence,
            steps=steps,
            mode="qa",
        )

    async def _loop_admin_list_users(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        state["checked_admin_user_query"] = True
        if not user or not user.get("is_admin"):
            state["response"] = AgentResponse(
                answer="当前用户没有查看用户列表的权限。用户列表属于管理员数据，需要管理员权限。",
                evidence=[],
                steps=steps,
                mode="qa",
            )
            return

        try:
            tenant_id = require_tenant_id(user)
        except TenantContextError:
            state["response"] = _tenant_context_required_response(steps)
            return
        async with db_session() as session:
            users = (
                await session.execute(
                    select(User)
                    .where(User.tenant_id == tenant_id)
                    .order_by(User.id)
                )
            ).scalars().all()
            user_ids = [item.id for item in users]
            role_map: dict[int, list[str]] = {item.id: [] for item in users}
            if user_ids:
                role_rows = (
                    await session.execute(
                        select(UserRole.user_id, Role.name, Role.label)
                        .join(Role, Role.id == UserRole.role_id)
                        .where(
                            UserRole.tenant_id == tenant_id,
                            Role.tenant_id == tenant_id,
                            UserRole.user_id.in_(user_ids),
                        )
                        .order_by(UserRole.user_id, Role.id)
                    )
                ).all()
                for user_id, role_name, role_label in role_rows:
                    role_map.setdefault(int(user_id), []).append(str(role_label or role_name or "role"))

        user_rows = [
            {
                "id": item.id,
                "username": item.username,
                "display_name": item.display_name,
                "email": item.email,
                "is_active": item.is_active,
                "is_admin": item.is_admin,
                "roles": role_map.get(item.id) or (["管理员"] if item.is_admin else []),
            }
            for item in users
        ]
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-admin-list-users",
                "type": "tool",
                "tool": "admin.list_users",
                "status": "completed",
                "result_count": len(user_rows),
                "summary": f"tenant_id={tenant_id}",
            },
        )
        evidence = [{"source": "admin.list_users", "users": user_rows, "count": len(user_rows)}]
        if not user_rows:
            answer = "我已通过管理员用户查询工具检查当前租户，暂时没有查到用户。"
        else:
            lines = [
                f"我已通过 `admin.list_users` 查询当前租户用户，共 {len(user_rows)} 个：",
                "",
                "| 用户名 | 显示名 | 邮箱 | 角色 | 状态 |",
                "|---|---|---|---|---|",
            ]
            for item in user_rows:
                roles = "、".join(item["roles"]) if item["roles"] else "-"
                status = "启用" if item["is_active"] else "停用"
                lines.append(
                    f"| {item['username']} | {item['display_name'] or '-'} | {item['email'] or '-'} | {roles} | {status} |"
                )
            answer = "\n".join(lines)

        state["evidence"] = evidence
        state["response"] = AgentResponse(
            answer=answer,
            evidence=evidence,
            steps=steps,
            mode="qa",
        )

    async def _loop_prepare_action(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
    ) -> None:
        state["checked_action"] = True
        route = state["intent_route"]
        pending_action = state.get("pending_action")
        evidence = state.get("evidence") or []
        profile = state["profile"]
        actions = []
        action_state: dict[str, Any] | None = None

        if route.skill == "low_code.create_form_definition":
            action_context = {
                **(request.context or {}),
                **(
                    pending_action.get("collected_slots")
                    if isinstance(pending_action, dict) and isinstance(pending_action.get("collected_slots"), dict)
                    else {}
                ),
                **route.extracted_context,
            }
            action_state = create_or_update_action_state(
                existing=pending_action if isinstance(pending_action, dict) else None,
                skill=route.skill,
                source_message=route.source_message,
                extracted_context=action_context,
            )
            effective_context = action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else action_context
            await self._emit_contract_step(route.skill, steps, event_sink, "Loaded form creation API contract before planning a write.")
            if action_state.get("missing_slots") or not has_minimum_action_requirements(route.skill, route.source_message, effective_context):
                await self._emit_missing_step(action_state, steps, event_sink, "Need more form design details before preparing a write confirmation.")
                state["action_state"] = action_state
                state["response"] = AgentResponse(
                    answer=build_action_guidance_answer(
                        route.skill,
                        assistant_name=profile.assistant_name,
                        action_state=action_state,
                    ),
                    evidence=evidence,
                    steps=steps,
                    action_state=action_state,
                    mode="qa",
                )
                return
            actions.append(create_low_code_form_definition_action(route.source_message, evidence=evidence, context=effective_context))
        elif route.intent != "action_prepare":
            actions = state.pop("fallback_actions", None) or choose_draft_actions(request.message, evidence=evidence, context=request.context)
        elif route.skill:
            action_state = create_or_update_action_state(
                existing=pending_action if isinstance(pending_action, dict) else None,
                skill=route.skill,
                source_message=route.source_message or request.message,
                extracted_context={},
            )
            if action_state.get("missing_slots"):
                await self._emit_missing_step(action_state, steps, event_sink, "Need more action details before preparing a confirmation.")
                state["action_state"] = action_state
                state["response"] = AgentResponse(
                    answer=build_action_guidance_answer(
                        route.skill,
                        assistant_name=profile.assistant_name,
                        action_state=action_state,
                    ),
                    evidence=evidence,
                    steps=steps,
                    action_state=action_state,
                    mode="qa",
                )
                return
            context = action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else {}
            actions = choose_draft_actions(route.source_message or request.message, evidence=evidence, context=context)
            if not actions:
                actions = [create_contract_draft_action(route.skill, evidence=evidence, context=context, source_message=route.source_message or request.message)]

        if actions and not action_state:
            first_action = actions[0]
            evidence_text = "\n".join(
                str(item.get("snippet") or item.get("chunk_text") or item.get("content") or item.get("summary") or "")
                for item in evidence
                if isinstance(item, dict)
            )
            source_message = "\n".join(part for part in [route.source_message or request.message, evidence_text] if part)
            action_state = create_or_update_action_state(
                existing=pending_action if isinstance(pending_action, dict) else None,
                skill=first_action.skill,
                source_message=source_message,
                extracted_context=(
                    pending_action.get("collected_slots")
                    if isinstance(pending_action, dict) and isinstance(pending_action.get("collected_slots"), dict)
                    else {}
                ),
            )
            await self._emit_contract_step(first_action.skill, steps, event_sink, "Loaded action skill/tool contract before preparing confirmation.")
            context = action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else request.context
            if action_state.get("missing_slots") or not has_minimum_action_requirements(first_action.skill, source_message, context):
                await self._emit_missing_step(action_state, steps, event_sink, "Need more action details before preparing a confirmation.")
                state["action_state"] = action_state
                state["response"] = AgentResponse(
                    answer=build_action_guidance_answer(
                        first_action.skill,
                        assistant_name=profile.assistant_name,
                        action_state=action_state,
                    ),
                    evidence=evidence,
                    steps=steps,
                    action_state=action_state,
                    mode="qa",
                )
                return
            actions = choose_draft_actions(
                request.message,
                evidence=evidence,
                context=action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else {},
            ) or actions

        if not actions:
            state["actions"] = []
            state["action_state"] = action_state
            return

        if not action_state:
            action_state = create_or_update_action_state(
                existing=pending_action if isinstance(pending_action, dict) else None,
                skill=actions[0].skill,
                source_message=route.source_message or request.message,
                extracted_context={},
            )
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-skill-selection",
                "type": "plan",
                "status": "completed",
                "skills": [action.skill for action in actions],
            },
        )
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-confirmation",
                "type": "policy",
                "status": "waiting_confirmation",
                "summary": "Draft actions require human confirmation before saving or submission.",
            },
        )
        state["actions"] = actions
        state["action_state"] = action_state
        state["response"] = AgentResponse(
            answer=f"{profile.assistant_name} 已准备好草稿动作，确认前不会写入或提交业务流程。",
            actions=actions,
            evidence=evidence,
            steps=steps,
            action_state={**action_state, "status": "ready_for_confirmation", "missing_slots": []},
            risk_level=_max_risk(actions),
            requires_confirmation=any(action.requires_confirmation for action in actions),
            mode="assisted",
        )

    async def _emit_contract_step(
        self,
        skill: str,
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        summary: str,
    ) -> None:
        contract = describe_action_contract(skill)
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-tool-contract",
                "type": "observe",
                "status": "completed",
                "tool": contract.get("tool") or skill,
                "summary": summary,
                "required": contract.get("required") or [],
            },
        )

    async def _emit_missing_step(
        self,
        action_state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        summary: str,
    ) -> None:
        await self._record_loop_step(
            steps,
            event_sink,
            {
                "id": "step-requirement-gap",
                "type": "plan",
                "status": "completed",
                "summary": summary,
                "missing_slots": action_state.get("missing_slots") or [],
            },
        )

    async def _loop_generate_answer(
        self,
        request: AgentRequest,
        state: dict[str, Any],
        steps: list[dict[str, Any]],
        event_sink: AgentEventSink | None,
        *,
        user: dict[str, Any] | None,
    ) -> None:
        evidence = state.get("evidence") or []
        config = state["config"]
        if not _is_real_model_configured(config):
            model_step = {
                "id": "step-model-config",
                "type": "configure",
                "status": "blocked",
                "provider": config.provider,
                "model": config.chat_model,
                "summary": "Large model provider is not configured.",
            }
            await self._record_loop_step(steps, event_sink, model_step)
            state["response"] = AgentResponse(
                answer="未配置大模型。请先在 AI 设置或后端环境变量中配置可用的大模型 provider、base URL、API Key 和模型名称。",
                evidence=evidence,
                steps=steps,
                mode="qa",
            )
            return
        try:
            provider = get_provider(config)
            built_messages = self.prompt_builder.build(
                PromptBuildInput(
                    mode="agent",
                    tenant_profile=state["profile"],
                    user_context=user or {},
                    page_context={"page": request.page, **(request.context or {})},
                    evidence=evidence,
                    tool_policy={"write_policy": "risk_based_confirmation"},
                    output_contract=(
                        "用中文自然回答用户当前问题。你已经通过 Agent loop 完成了上下文判断、必要工具调用和权限检查；"
                        "请基于可见证据回答，不要声称已经执行未经确认的写入动作。"
                    ),
                    user_message=request.message,
                )
            )
            messages_dicts = [m.to_api_dict() for m in built_messages]
            compactor = ContextCompactor()
            messages_dicts, _summary = compactor.compact_messages(messages_dicts)
            if _summary:
                bus = state.get("event_bus")
                if bus:
                    await bus.emit(AgentEvent.POST_COMPACT, {"summary": _summary.__dict__})
            compacted_messages = [ChatMessage(**{k: v for k, v in d.items() if v is not None}) for d in messages_dicts]
            result = await provider.chat(
                compacted_messages,
                ChatOptions(model=config.chat_model, max_tokens=1200, temperature=0.3),
            )
            budget = state.get("budget")
            if budget:
                budget.accumulate(result.usage)
            await self._record_loop_step(
                steps,
                event_sink,
                {
                    "id": "step-answer",
                    "type": "respond",
                    "status": "completed",
                    "model": result.model,
                    "provider": result.provider,
                },
            )
            state["response"] = AgentResponse(answer=result.content, evidence=evidence, steps=steps, mode="qa")
        except Exception as exc:  # noqa: BLE001 - page assistant should degrade gracefully
            await self._record_loop_step(
                steps,
                event_sink,
                {
                    "id": "step-answer",
                    "type": "respond",
                    "status": "failed",
                    "model": config.chat_model,
                    "provider": config.provider,
                    "fallback_reason": str(exc),
                },
            )
            state["response"] = AgentResponse(answer=_format_provider_failure(exc), evidence=evidence, steps=steps, mode="qa")

    async def answer_knowledge(
        self,
        *,
        query: str,
        title: str,
        evidence: list[dict[str, Any]],
        history: list[Any],
        tenant_profile: TenantProfile | None = None,
        provider_config=None,
        memory: list[dict[str, Any]] | None = None,
        intent: str | None = None,
        tenant_id: int | None = None,
    ) -> tuple[str, str, dict[str, Any]]:
        profile = tenant_profile or default_tenant_profile(tenant_id)
        config = provider_config or settings_to_provider_config(settings_snapshot())
        resolved_intent = intent or self.classify_knowledge_intent(query)
        scoped_evidence = evidence if resolved_intent == "knowledge" else []
        if not _is_real_model_configured(config):
            return (
                "未配置大模型。请先在 AI 设置或后端环境变量中配置可用的大模型 provider、base URL、API Key 和模型名称。",
                "unconfigured-ai-provider",
                {
                    "mode": "model_not_configured",
                    "provider": config.provider,
                    "model": config.chat_model,
                    "intent": resolved_intent,
                    "history_messages": len(history),
                    "evidence_count": len(scoped_evidence),
                    "memory_count": len(memory or []),
                },
            )
        try:
            provider = get_provider(config)
            history_messages = [
                ChatMessage(role=item.role, content=item.content)
                for item in history[-8:]
                if getattr(item, "role", None) in {"user", "assistant"}
            ]
            mode = "knowledge" if resolved_intent == "knowledge" else "chat"
            messages = self.prompt_builder.build(
                PromptBuildInput(
                    mode=mode,
                    tenant_profile=profile,
                    user_context={},
                    page_context={"page": "knowledge-center", "document_title": title} if resolved_intent == "knowledge" else {"page": "knowledge-center"},
                    evidence=scoped_evidence,
                    memory=memory or [],
                    history=history_messages,
                    tool_policy={"write_policy": "risk_based_confirmation"},
                    output_contract=(
                        "用中文自然回答。普通寒暄、情绪、身份或偏好问题不要强行引用文档。"
                        "只有涉及企业事实、文档、SOP、数据、本体或图谱时才引用 [Sx]；使用记忆时引用 [Mx]。"
                        "如果知识任务证据不足，请明确说明缺口，并给出下一步建议。"
                    ),
                    user_message=query,
                )
            )
            result = await provider.chat(messages, ChatOptions(model=config.chat_model, max_tokens=1000, temperature=0.2))
            return (
                result.content,
                result.model,
                {
                    "mode": "ai_provider_rag",
                    "provider": result.provider,
                    "prompt_version": self.prompt_builder.version,
                    "intent": resolved_intent,
                    "history_messages": len(history),
                    "evidence_count": len(scoped_evidence),
                    "memory_count": len(memory or []),
                    "usage": result.usage,
                },
            )
        except Exception as exc:  # noqa: BLE001 - knowledge chat should degrade gracefully
            return (
                _format_provider_failure(exc),
                config.chat_model,
                {
                    "mode": "ai_provider_failed",
                    "provider": config.provider,
                    "prompt_version": self.prompt_builder.version,
                    "intent": resolved_intent,
                    "fallback_reason": str(exc),
                    "history_messages": len(history),
                    "evidence_count": len(scoped_evidence),
                    "memory_count": len(memory or []),
                },
            )

    def _local_knowledge_answer(
        self,
        *,
        query: str,
        title: str,
        evidence: list[dict[str, Any]],
        history: list[Any],
        profile: TenantProfile,
        intent: str = "knowledge",
        configured_model: str | None = None,
    ) -> str:
        lower = query.lower()
        if intent == "general":
            if any(term in lower for term in ["who are you", "model", "模型", "你是谁", "大模型"]):
                model_hint = f"当前 AI 平台配置的默认生成模型是 {configured_model}。" if configured_model else "背后的模型由 AI 平台配置决定。"
                return (
                    f"你好，我是 {profile.assistant_name}。"
                    f"{model_hint}"
                    "我可以正常聊天，也可以在你询问文档、SOP、知识对象或业务数据时切换到知识检索模式。"
                )
            return "我在。你可以像正常对话一样问我；如果问题涉及当前文档或知识库，我会再结合证据回答。"
        if any(term in lower for term in ["who are you", "model", "模型", "你是谁", "大模型"]):
            model_hint = f"当前 AI 平台配置的默认生成模型是 {configured_model}。" if configured_model else "背后的模型由 AI 平台配置决定。"
            return (
                f"你好，我是 {profile.assistant_name}，运行在 {profile.product_name} 平台中。"
                "我会结合当前页面、知识库证据、会话记忆和角色权限来回答问题；"
                f"{model_hint}"
            )
        if evidence:
            lines = [f"我先基于《{title}》和当前检索到的证据做一个概括："]
            for index, item in enumerate(evidence[:3], start=1):
                snippet = item.get("snippet") or item.get("chunk_text") or item.get("summary") or ""
                if snippet:
                    lines.append(f"- {str(snippet)[:180]} [S{index}]")
            if len(history) > 0:
                lines.append("我也会结合本轮会话前文继续收敛上下文。")
            return "\n".join(lines)
        return (
            f"当前知识库没有检索到足够强的证据来回答《{title}》下的这个问题。"
            "我可以给出通用判断，但建议先补充文档片段、抽取结果或切换到对应知识对象后再继续。"
        )


agent_runtime = AgentRuntime()
