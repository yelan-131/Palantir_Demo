"""Model-driven tool_use agent loop.

This completes the migration scaffold described in ``schemas.py``: instead of
the deterministic operation state machine in ``runtime._run_agent_loop``, the
LLM itself is the planner. Each turn the model either returns a final answer
or a batch of ``tool_calls``; tool execution always flows through
``ToolExecutionEnvelope`` so permission hooks, payload validation,
confirmation gating, timeouts, and audit stay enforced in one place.

Safety contract:

- ``read`` / ``analyze`` tools execute immediately (still envelope-guarded).
- Any side-effecting tool freezes the conversation into a ``FrozenContext``,
  returns a confirmation payload, and never executes in the same turn.
- ``resume()`` consumes the confirmation token, executes the pending calls
  with ``confirmed=True``, and continues the loop where it stopped.

The loop is opt-in via the ``agentLoopMode`` safety-policy flag ("model" or
"tool_use"); the legacy pipeline loop remains the default behavior.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Awaitable, Callable

from .budget import BudgetTracker
from .client import get_provider
from .compactor import ContextCompactor
from .confirmations import async_consume_confirmation_token, async_create_confirmation_payload
from .events import AgentEvent, EventBus
from .hooks import register_builtin_hooks
from .prompt_builder import PromptBuilder
from .schemas import (
    AgentRequest,
    AgentResponse,
    AIProviderConfig,
    ChatMessage,
    ChatOptions,
    FrozenContext,
    InterceptResult,
    ToolCall,
)
from .settings import safety_policy_snapshot
from .tenant_context import require_tenant_id
from .tenant_profile import TenantProfile, default_tenant_profile
from .tool_envelope import tool_execution_envelope
from .tool_registry import get_tool, openai_tools_for_user

logger = logging.getLogger(__name__)

AgentEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]

EXTERNAL_PROVIDER_NAMES = {"openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"}
RISK_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
AUTO_EXEC_SIDE_EFFECTS = {"read", "analyze"}
COMPACT_THRESHOLD = 40
MAX_TOOL_RESULT_CHARS = 4000


def is_model_configured(config: AIProviderConfig | None) -> bool:
    return bool(config and config.provider in EXTERNAL_PROVIDER_NAMES and config.api_key)


def _message_to_chat(message: dict[str, Any]) -> ChatMessage:
    allowed = {"role", "content", "tool_calls", "tool_call_id", "name"}
    return ChatMessage(**{k: v for k, v in message.items() if k in allowed and v is not None})


def _history_from_context(context: dict[str, Any] | None) -> list[ChatMessage]:
    rows = (context or {}).get("recentMessages") or (context or {}).get("recent_messages") or []
    if not isinstance(rows, list):
        return []
    history: list[ChatMessage] = []
    for row in rows[-8:]:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "")
        content = row.get("content")
        if role in {"user", "assistant"} and content:
            history.append(ChatMessage(role=role, content=str(content)))
    return history


def _safe_tool_arguments(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _tool_result_content(result: dict[str, Any]) -> str:
    try:
        content = json.dumps(result, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        content = str(result)
    return content[:MAX_TOOL_RESULT_CHARS]


def _max_risk(levels: list[str]) -> str:
    if not levels:
        return "low"
    return max(levels, key=lambda level: RISK_RANK.get(level, 0))


class ToolUseLoopRunner:
    """Runs the LLM-driven function-calling loop on top of the tool envelope."""

    def __init__(self, prompt_builder: PromptBuilder | None = None):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.compactor = ContextCompactor()

    # ── Entry points ─────────────────────────────────────────

    async def run(
        self,
        request: AgentRequest,
        *,
        tenant_profile: TenantProfile | None = None,
        user: dict[str, Any] | None = None,
        settings: dict[str, Any],
        config: AIProviderConfig,
        event_sink: AgentEventSink | None = None,
        bus: EventBus | None = None,
    ) -> AgentResponse:
        profile = tenant_profile or default_tenant_profile(require_tenant_id(user or request.context))
        policy = safety_policy_snapshot(settings)
        budget = BudgetTracker(
            max_input_tokens=int(policy.get("agentMaxInputTokens") or 100_000),
            max_output_tokens=int(policy.get("agentMaxOutputTokens") or 20_000),
        )
        max_turns = max(1, min(int(policy.get("maxToolSteps") or 5), 10))
        loop_bus = bus
        if loop_bus is None:
            loop_bus = EventBus()
            register_builtin_hooks(loop_bus, settings)

        messages = [
            m.to_api_dict()
            for m in self.prompt_builder.build_agent_prompt(
                user=user or {},
                tenant_profile=profile,
                page_context={"page": request.page, **(request.context or {})},
                history=_history_from_context(request.context),
                user_message=request.message,
            )
        ]
        tools = openai_tools_for_user(user or {}, settings)
        run_id = f"toolloop-{uuid.uuid4().hex[:12]}"
        await loop_bus.emit(AgentEvent.RUN_STARTED, {"run_id": run_id, "mode": "tool_use"})

        return await self._loop(
            messages=messages,
            tools=tools,
            turn=0,
            max_turns=max_turns,
            budget=budget,
            items=[],
            evidence=[],
            run_id=run_id,
            user=user or {},
            settings=settings,
            config=config,
            event_sink=event_sink,
            bus=loop_bus,
        )

    async def resume(
        self,
        frozen: FrozenContext,
        *,
        confirmation_token: str,
        user: dict[str, Any] | None = None,
        settings: dict[str, Any],
        config: AIProviderConfig,
        event_sink: AgentEventSink | None = None,
        bus: EventBus | None = None,
    ) -> AgentResponse:
        """Thaw a frozen conversation after the user confirmed the pending calls."""
        # Single-use, user-bound, atomic at the store level.
        await async_consume_confirmation_token(confirmation_token, user=user)

        loop_bus = bus
        if loop_bus is None:
            loop_bus = EventBus()
            register_builtin_hooks(loop_bus, settings)

        policy = safety_policy_snapshot(settings)
        budget = BudgetTracker(
            max_input_tokens=int(policy.get("agentMaxInputTokens") or 100_000),
            max_output_tokens=int(policy.get("agentMaxOutputTokens") or 20_000),
        )
        run_id = f"toolloop-{uuid.uuid4().hex[:12]}"
        messages = list(frozen.messages)
        items = list(frozen.items)
        evidence = list(frozen.evidence)

        await loop_bus.emit(AgentEvent.POST_CONFIRMATION, {"run_id": run_id, "pending": len(frozen.pending_tool_calls)})

        for tool_call in frozen.pending_tool_calls:
            payload = _safe_tool_arguments(tool_call.function.arguments)
            envelope_result = await tool_execution_envelope.execute_tool(
                tool_name=tool_call.function.name,
                payload=payload,
                current_user=user,
                settings=settings,
                confirmed=True,
                event_sink=event_sink,
                event_bus=loop_bus,
                run_id=run_id,
            )
            items.extend(item for item in (envelope_result.get("items") or []) if isinstance(item, dict))
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": tool_call.function.name,
                    "content": _tool_result_content(envelope_result.get("result") or {}),
                }
            )

        return await self._loop(
            messages=messages,
            tools=frozen.openai_tools,
            turn=frozen.turn_number,
            max_turns=frozen.max_turns,
            budget=budget,
            items=items,
            evidence=evidence,
            run_id=run_id,
            user=user or {},
            settings=settings,
            config=config,
            event_sink=event_sink,
            bus=loop_bus,
        )

    # ── Core loop ────────────────────────────────────────────

    async def _loop(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        turn: int,
        max_turns: int,
        budget: BudgetTracker,
        items: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
        run_id: str,
        user: dict[str, Any],
        settings: dict[str, Any],
        config: AIProviderConfig,
        event_sink: AgentEventSink | None,
        bus: EventBus,
    ) -> AgentResponse:
        provider = get_provider(config)

        while turn < max_turns:
            turn += 1

            if budget.is_exceeded():
                await bus.emit(AgentEvent.BUDGET_EXCEEDED, {"budget": budget.summary(), "run_id": run_id})
                return self._final_response(
                    answer="Token 预算已用尽，请缩小查询范围或开启新对话。",
                    items=items,
                    evidence=evidence,
                    budget=budget,
                )

            if len(messages) > COMPACT_THRESHOLD:
                await bus.emit(AgentEvent.PRE_COMPACT, {"message_count": len(messages), "run_id": run_id})
                messages, summary = self.compactor.compact_messages(messages)
                if summary:
                    await bus.emit(AgentEvent.POST_COMPACT, {"summary": summary.__dict__, "run_id": run_id})

            chat_messages = [_message_to_chat(m) for m in messages]
            result = await provider.chat(
                chat_messages,
                ChatOptions(
                    model=config.chat_model,
                    tools=tools or None,
                    tool_choice="auto" if tools else None,
                    max_tokens=1200,
                    temperature=0.3,
                ),
            )
            budget.accumulate(result.usage)

            if result.tool_calls:
                messages.append(
                    {
                        "role": "assistant",
                        "content": result.content,
                        "tool_calls": [tc.model_dump() for tc in result.tool_calls],
                    }
                )
                intercept = await self._execute_tool_batch(
                    result.tool_calls,
                    messages=messages,
                    items=items,
                    evidence=evidence,
                    run_id=run_id,
                    user=user,
                    settings=settings,
                    event_sink=event_sink,
                    bus=bus,
                )
                await bus.emit(
                    AgentEvent.POST_TOOL_BATCH,
                    {"run_id": run_id, "status": intercept.status, "count": len(result.tool_calls)},
                )
                if intercept.status == "needs_confirmation":
                    return await self._freeze_for_confirmation(
                        intercept,
                        messages=messages,
                        tools=tools,
                        turn=turn,
                        max_turns=max_turns,
                        budget=budget,
                        items=items,
                        evidence=evidence,
                        user=user,
                        bus=bus,
                        run_id=run_id,
                    )
                continue

            await bus.emit(AgentEvent.RUN_COMPLETED, {"run_id": run_id, "turns": turn})
            return self._final_response(
                answer=result.content or "",
                items=items,
                evidence=evidence,
                budget=budget,
            )

        return self._final_response(
            answer="我已经达到本轮允许的最大工具调用次数，但还没有得到最终结果。请缩小问题范围或继续追问。",
            items=items,
            evidence=evidence,
            budget=budget,
        )

    # ── Tool batch interception ──────────────────────────────

    async def _execute_tool_batch(
        self,
        tool_calls: list[ToolCall],
        *,
        messages: list[dict[str, Any]],
        items: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
        run_id: str,
        user: dict[str, Any],
        settings: dict[str, Any],
        event_sink: AgentEventSink | None,
        bus: EventBus,
    ) -> InterceptResult:
        pending: list[dict[str, Any]] = []
        executed: list[dict[str, Any]] = []

        for tool_call in tool_calls:
            tool_name = tool_call.function.name
            payload = _safe_tool_arguments(tool_call.function.arguments)
            tool_def = get_tool(tool_name)
            side_effect = tool_def.side_effect if tool_def else "read"
            risk_level = tool_def.risk_level if tool_def else "low"

            if tool_def and side_effect not in AUTO_EXEC_SIDE_EFFECTS:
                # Side-effecting call: never execute inline. The envelope
                # would refuse it anyway (confirmed=False), but freezing here
                # gives the user a reviewable confirmation payload instead of
                # a silent tool failure.
                pending.append(
                    {
                        "tool_call": tool_call,
                        "tool": tool_name,
                        "payload": payload,
                        "side_effect": side_effect,
                        "risk_level": risk_level,
                    }
                )
                continue

            envelope_result = await tool_execution_envelope.execute_tool(
                tool_name=tool_name,
                payload=payload,
                current_user=user,
                settings=settings,
                confirmed=False,
                event_sink=event_sink,
                event_bus=bus,
                run_id=run_id,
            )
            items.extend(item for item in (envelope_result.get("items") or []) if isinstance(item, dict))
            result_payload = envelope_result.get("result") or {}
            if tool_name == "knowledge.search" and isinstance(result_payload.get("results"), list):
                evidence.extend(result_payload["results"])
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": tool_name,
                    "content": _tool_result_content(result_payload),
                }
            )
            executed.append({"tool": tool_name, "status": envelope_result.get("status")})

        if pending:
            return InterceptResult(status="needs_confirmation", tool_results=executed, pending_confirmations=pending)
        return InterceptResult(status="executed", tool_results=executed)

    # ── Freeze / response helpers ────────────────────────────

    async def _freeze_for_confirmation(
        self,
        intercept: InterceptResult,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        turn: int,
        max_turns: int,
        budget: BudgetTracker,
        items: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
        user: dict[str, Any],
        bus: EventBus,
        run_id: str,
    ) -> AgentResponse:
        pending = intercept.pending_confirmations
        actions = [
            {
                "type": "tool_call",
                "skill": item["tool"],
                "tool": item["tool"],
                "payload": item["payload"],
                "side_effect": item["side_effect"],
                "risk_level": item["risk_level"],
            }
            for item in pending
        ]
        risk_level = _max_risk([str(item["risk_level"]) for item in pending])
        confirmation_payload = await async_create_confirmation_payload(
            user=user,
            actions=actions,
            evidence=evidence,
            risk_level=risk_level,
        )
        frozen = FrozenContext(
            messages=messages,
            pending_tool_calls=[item["tool_call"] for item in pending],
            executed_tool_results=intercept.tool_results,
            turn_number=turn,
            max_turns=max_turns,
            token_count=budget.summary().get("total_tokens", 0),
            openai_tools=tools,
            items=items,
            evidence=evidence,
        )
        tool_names = "、".join(str(item["tool"]) for item in pending)
        summary = f"以下操作需要你确认后才会执行：{tool_names}。确认前不会写入任何数据。"
        return AgentResponse(
            answer=summary,
            items=items,
            evidence=evidence,
            requires_confirmation=True,
            confirmation_payload=confirmation_payload,
            frozen_context=frozen,
            risk_level=risk_level,  # type: ignore[arg-type]
            mode="agentic",
            token_budget=budget.summary(),
        )

    @staticmethod
    def _final_response(
        *,
        answer: str,
        items: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
        budget: BudgetTracker,
    ) -> AgentResponse:
        return AgentResponse(
            answer=answer,
            items=items,
            evidence=evidence,
            mode="agentic",
            token_budget=budget.summary(),
        )


tool_use_loop_runner = ToolUseLoopRunner()
