"""Unified Agent runtime facade.

This first stage keeps public API contracts stable while moving prompt
construction, model calls, and policy-aware answer generation into services.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from .knowledge_ingestion import search_ingested_knowledge
from .prompt_builder import PromptBuildInput, PromptBuilder
from .schemas import AgentRequest, AgentResponse, ChatMessage, ChatOptions
from .settings import settings_snapshot, settings_to_provider_config
from .tenant_profile import TenantProfile, default_tenant_profile
from .planner import plan_agent_turn
from .tools import choose_draft_actions, create_low_code_form_definition_action
from .client import get_provider
from .agent_context_router import classify_context_need


EXTERNAL_PROVIDER_NAMES = {"openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"}
RISK_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
AgentEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]
GENERAL_CHAT_TERMS = [
    "你好",
    "您好",
    "早上好",
    "晚上好",
    "你是谁",
    "你叫什么",
    "who are you",
    "喜欢我",
    "你喜欢",
    "爱我",
    "谢谢",
    "thank",
    "hello",
    "hi",
    "在吗",
    "聊聊",
    "随便聊",
]
KNOWLEDGE_TASK_TERMS = [
    "文档",
    "该文档",
    "这个文档",
    "内容",
    "包含",
    "总结",
    "概括",
    "分析",
    "证据",
    "来源",
    "引用",
    "SOP",
    "流程",
    "风险",
    "CAPA",
    "本体",
    "图谱",
    "关系",
    "实体",
    "字段",
    "document",
    "content",
    "contains",
    "summary",
    "summarize",
    "evidence",
]


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


async def _emit_step(event_sink: AgentEventSink | None, step: dict[str, Any]) -> None:
    if event_sink:
        await event_sink("step.completed", {"step": step})


class AgentRuntime:
    def __init__(self, prompt_builder: PromptBuilder | None = None):
        self.prompt_builder = prompt_builder or PromptBuilder()

    def classify_knowledge_intent(self, query: str) -> str:
        """Route short social turns away from RAG while keeping knowledge tasks grounded."""

        normalized = query.strip().lower()
        if not normalized:
            return "general"
        if any(term.lower() in normalized for term in KNOWLEDGE_TASK_TERMS):
            return "knowledge"
        if len(normalized) <= 40 and any(term.lower() in normalized for term in GENERAL_CHAT_TERMS):
            return "general"
        return "knowledge"

    async def run(
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

        profile = tenant_profile or default_tenant_profile()
        steps = [
            {
                "id": "step-intent",
                "type": "observe",
                "title": "Intent received",
                "status": "completed",
                "summary": request.message[:160],
            }
        ]
        planner_result = plan_agent_turn(request.message, request.context)
        planner_step = {
            "id": "step-planner",
            "type": "plan",
            "status": "completed",
            "intent": planner_result.intent,
            "skill": planner_result.skill,
            "confidence": planner_result.confidence,
            "reason": planner_result.reason,
        }
        steps.append(planner_step)
        await _emit_step(event_sink, planner_step)
        context_need = "draft_action" if planner_result.intent == "action" else classify_context_need(request.message, request.context)
        evidence = search_ingested_knowledge(request.message, limit=3) if context_need in {"knowledge_rag", "business_query", "semantic_graph", "draft_action"} else []
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
        if planner_result.skill == "low_code.create_form_definition":
            action_context = {
                **(request.context or {}),
                **planner_result.extracted_context,
            }
            actions.append(create_low_code_form_definition_action(planner_result.source_message, evidence=evidence, context=action_context))
        elif planner_result.intent == "qa":
            actions = choose_draft_actions(request.message, evidence=evidence, context=request.context)
        if actions:
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
                risk_level=_max_risk(actions),
                requires_confirmation=any(action.requires_confirmation for action in actions),
                mode="assisted",
            )

        config = request.provider_config or settings_to_provider_config(settings_snapshot())
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
    ) -> tuple[str, str, dict[str, Any]]:
        profile = tenant_profile or default_tenant_profile()
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
            if any(term in lower for term in ["喜欢我", "爱我", "你喜欢"]):
                return "当然愿意认真陪你聊。作为 AI 我没有人类意义上的喜欢，但我会以稳定、真诚和有边界的方式回应你。"
            if any(term in lower for term in ["你好", "您好", "早上好", "晚上好", "hello", "hi"]):
                return f"你好呀，我是 {profile.assistant_name}。你可以直接和我聊天，也可以让我帮你查文档、梳理 SOP 或分析知识关系。"
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
