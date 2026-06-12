"""Tests for the model-driven tool_use loop, provider tool protocol, and
bounded in-memory stores."""

import json

import pytest


def _user() -> dict:
    return {"sub": "tooluse-test", "tenant_id": 1, "is_admin": True, "roles": [{"name": "admin"}]}


def _config():
    from app.services.ai.schemas import AIProviderConfig

    return AIProviderConfig(provider="glm", api_key="test-key", chat_model="glm-test")


def _tool_call(call_id: str, name: str, arguments: dict):
    from app.services.ai.schemas import ToolCall, ToolCallFunction

    return ToolCall(id=call_id, function=ToolCallFunction(name=name, arguments=json.dumps(arguments)))


class _ScriptedProvider:
    """Returns pre-scripted ChatResults in order."""

    def __init__(self, results):
        self._results = list(results)
        self.calls = []

    async def chat(self, messages, options=None):
        self.calls.append({"messages": messages, "options": options})
        return self._results.pop(0)


class _FakeEnvelope:
    """Stands in for ToolExecutionEnvelope; records calls."""

    def __init__(self, result=None):
        self.calls = []
        self._result = result or {"items": [{"id": 1}], "count": 1}

    async def execute_tool(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "tool": kwargs.get("tool_name"),
            "status": "completed",
            "result": self._result,
            "items": [{"item_id": f"item-{len(self.calls)}", "type": "tool_result"}],
        }


def _chat_result(content=None, tool_calls=None, usage=None):
    from app.services.ai.schemas import ChatResult

    return ChatResult(
        provider="glm",
        model="glm-test",
        content=content,
        tool_calls=tool_calls,
        finish_reason="tool_calls" if tool_calls else "stop",
        usage=usage or {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    )


# ── Provider tool protocol ───────────────────────────────────


def test_parse_tool_calls_from_openai_payload():
    from app.services.ai.providers import _parse_tool_calls

    raw = [
        {"id": "call_1", "type": "function", "function": {"name": "knowledge.search", "arguments": '{"query": "q"}'}},
        {"id": "", "type": "function", "function": {"name": "", "arguments": "{}"}},
    ]
    calls = _parse_tool_calls(raw)
    assert calls is not None
    assert len(calls) == 1
    assert calls[0].function.name == "knowledge.search"
    assert _parse_tool_calls([]) is None
    assert _parse_tool_calls(None) is None


def test_chat_message_api_dict_strips_none_fields():
    from app.services.ai.schemas import ChatMessage

    plain = ChatMessage(role="user", content="hi").to_api_dict()
    assert "tool_calls" not in plain
    assert "tool_call_id" not in plain

    tool_msg = ChatMessage(role="tool", tool_call_id="call_1", name="knowledge.search", content="{}").to_api_dict()
    assert tool_msg["tool_call_id"] == "call_1"


# ── Tool use loop: read tools execute, then final answer ─────


@pytest.mark.asyncio
async def test_tool_use_loop_executes_read_tool_then_answers(monkeypatch):
    from app.services.ai import tool_use_loop
    from app.services.ai.schemas import AgentRequest

    provider = _ScriptedProvider(
        [
            _chat_result(tool_calls=[_tool_call("call_1", "knowledge.search", {"query": "委外", "limit": 3})]),
            _chat_result(content="最终回答"),
        ]
    )
    envelope = _FakeEnvelope(result={"results": [{"title": "SOP", "snippet": "..."}]})
    monkeypatch.setattr(tool_use_loop, "get_provider", lambda config: provider)
    monkeypatch.setattr(tool_use_loop, "tool_execution_envelope", envelope)

    runner = tool_use_loop.ToolUseLoopRunner()
    response = await runner.run(
        AgentRequest(message="查一下委外流程"),
        user=_user(),
        settings={"safetyPolicy": {"maxToolSteps": 5}},
        config=_config(),
    )

    assert response.answer == "最终回答"
    assert response.mode == "agentic"
    assert response.requires_confirmation is False
    assert len(envelope.calls) == 1
    assert envelope.calls[0]["tool_name"] == "knowledge.search"
    assert envelope.calls[0]["confirmed"] is False
    # Evidence harvested from knowledge.search results
    assert response.evidence and response.evidence[0]["title"] == "SOP"
    # Tool result was fed back to the model as a role=tool message
    second_call_messages = provider.calls[1]["messages"]
    assert any(m.role == "tool" for m in second_call_messages)
    # Budget accumulated across both model calls
    assert response.token_budget["turns_tracked"] == 2


# ── Tool use loop: side-effect tool freezes for confirmation ─


@pytest.mark.asyncio
async def test_tool_use_loop_freezes_side_effect_tool(monkeypatch):
    from app.services.ai import tool_use_loop
    from app.services.ai.schemas import AgentRequest
    from app.services.ai.tool_registry import ToolDefinition

    provider = _ScriptedProvider(
        [_chat_result(tool_calls=[_tool_call("call_1", "forms.create_form_definition", {"name": "测试表单"})])]
    )
    envelope = _FakeEnvelope()
    monkeypatch.setattr(tool_use_loop, "get_provider", lambda config: provider)
    monkeypatch.setattr(tool_use_loop, "tool_execution_envelope", envelope)
    monkeypatch.setattr(
        tool_use_loop,
        "get_tool",
        lambda name: ToolDefinition(
            name=name,
            title="创建表单",
            description="创建表单定义",
            side_effect="configuration_write",
            risk_level="high",
        ),
    )

    runner = tool_use_loop.ToolUseLoopRunner()
    response = await runner.run(
        AgentRequest(message="帮我创建一个表单"),
        user=_user(),
        settings={"safetyPolicy": {"maxToolSteps": 5}},
        config=_config(),
    )

    assert response.requires_confirmation is True
    assert response.risk_level == "high"
    assert response.frozen_context is not None
    assert len(response.frozen_context.pending_tool_calls) == 1
    assert response.confirmation_payload.get("confirmation_token")
    # The side-effect tool must NOT have been executed
    assert envelope.calls == []


# ── Tool use loop: resume after confirmation ─────────────────


@pytest.mark.asyncio
async def test_tool_use_loop_resume_executes_pending_confirmed(monkeypatch):
    from app.services.ai import tool_use_loop
    from app.services.ai.confirmations import CONFIRMATIONS, async_create_confirmation_payload, reset_store
    from app.services.ai.schemas import FrozenContext

    provider = _ScriptedProvider([_chat_result(content="已创建")])
    envelope = _FakeEnvelope(result={"form_code": "test_form"})
    monkeypatch.setattr(tool_use_loop, "get_provider", lambda config: provider)
    monkeypatch.setattr(tool_use_loop, "tool_execution_envelope", envelope)

    CONFIRMATIONS.clear()
    reset_store()
    payload = await async_create_confirmation_payload(
        user=_user(), actions=[{"tool": "forms.create_form_definition"}]
    )
    frozen = FrozenContext(
        messages=[
            {"role": "system", "content": "system"},
            {"role": "user", "content": "创建表单"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [_tool_call("call_1", "forms.create_form_definition", {"name": "测试表单"}).model_dump()],
            },
        ],
        pending_tool_calls=[_tool_call("call_1", "forms.create_form_definition", {"name": "测试表单"})],
        turn_number=1,
        max_turns=5,
    )

    runner = tool_use_loop.ToolUseLoopRunner()
    response = await runner.resume(
        frozen,
        confirmation_token=payload["confirmation_token"],
        user=_user(),
        settings={"safetyPolicy": {"maxToolSteps": 5}},
        config=_config(),
    )

    assert response.answer == "已创建"
    assert len(envelope.calls) == 1
    assert envelope.calls[0]["confirmed"] is True
    assert envelope.calls[0]["tool_name"] == "forms.create_form_definition"
    # Confirmation token is single-use
    with pytest.raises(ValueError):
        await runner.resume(
            frozen,
            confirmation_token=payload["confirmation_token"],
            user=_user(),
            settings={"safetyPolicy": {"maxToolSteps": 5}},
            config=_config(),
        )


# ── Tool use loop: budget stops the loop ─────────────────────


@pytest.mark.asyncio
async def test_tool_use_loop_stops_when_budget_exceeded(monkeypatch):
    from app.services.ai import tool_use_loop
    from app.services.ai.schemas import AgentRequest

    provider = _ScriptedProvider(
        [
            _chat_result(
                tool_calls=[_tool_call("call_1", "knowledge.search", {"query": "q"})],
                usage={"prompt_tokens": 999_999, "completion_tokens": 10, "total_tokens": 1_000_009},
            ),
            _chat_result(content="不应该到这里"),
        ]
    )
    envelope = _FakeEnvelope()
    monkeypatch.setattr(tool_use_loop, "get_provider", lambda config: provider)
    monkeypatch.setattr(tool_use_loop, "tool_execution_envelope", envelope)

    runner = tool_use_loop.ToolUseLoopRunner()
    response = await runner.run(
        AgentRequest(message="查询"),
        user=_user(),
        settings={"safetyPolicy": {"maxToolSteps": 5}},
        config=_config(),
    )

    assert "预算" in response.answer
    assert len(provider.calls) == 1


# ── Runtime dispatch flag ────────────────────────────────────


@pytest.mark.asyncio
async def test_runtime_dispatches_to_tool_use_loop_when_enabled(monkeypatch):
    from app.services.ai import runtime as runtime_module
    from app.services.ai import tool_use_loop
    from app.services.ai.schemas import AgentRequest, AgentResponse

    async def fake_run(request, **kwargs):
        return AgentResponse(answer="model-loop", mode="agentic")

    monkeypatch.setattr(tool_use_loop.tool_use_loop_runner, "run", fake_run)
    monkeypatch.setattr(
        runtime_module,
        "settings_snapshot",
        lambda: {"provider": "glm", "apiKey": "k", "safetyPolicy": {"agentLoopMode": "model"}},
    )
    monkeypatch.setattr(
        runtime_module,
        "safety_policy_snapshot",
        lambda settings=None: {"agentLoopMode": "model"},
    )
    monkeypatch.setattr(tool_use_loop, "is_model_configured", lambda config: True)

    response = await runtime_module.AgentRuntime().run(AgentRequest(message="hi"), user=_user())
    assert response.answer == "model-loop"


# ── Bounded in-memory stores ─────────────────────────────────


def test_audit_log_is_bounded():
    from app.services.ai.audit import AI_AUDIT_LOG_LIMIT, AI_AUDIT_LOGS, record_ai_event

    AI_AUDIT_LOGS.clear()
    for index in range(AI_AUDIT_LOG_LIMIT + 50):
        record_ai_event({"sub": "bound-test"}, "test_event", {"index": index})
    assert len(AI_AUDIT_LOGS) == AI_AUDIT_LOG_LIMIT
    assert AI_AUDIT_LOGS[-1]["payload"]["index"] == AI_AUDIT_LOG_LIMIT + 49
    AI_AUDIT_LOGS.clear()


def test_agent_runs_store_evicts_terminal_runs(monkeypatch):
    from app.services.ai import agent_runs as agent_runs_module
    from app.services.ai.schemas import AgentRequest, AgentResponse

    monkeypatch.setattr(agent_runs_module, "MAX_AGENT_RUNS", 5)
    agent_runs_module.AGENT_RUNS.clear()

    user = _user()
    for index in range(8):
        agent_runs_module.create_agent_run(
            AgentRequest(message=f"m{index}"),
            AgentResponse(answer=f"a{index}"),
            user,
        )

    assert len(agent_runs_module.AGENT_RUNS) <= 5
    agent_runs_module.AGENT_RUNS.clear()


@pytest.mark.asyncio
async def test_inmemory_confirmation_consume_is_single_use():
    from app.services.ai.confirmation_store import InMemoryConfirmationStore

    store = InMemoryConfirmationStore()
    created = await store.create({"user_key": "u1", "actions": []})
    token = created["token"]

    first = await store.consume(token, user_key="u1")
    assert first["valid"] is True
    second = await store.consume(token, user_key="u1")
    assert second["valid"] is False
