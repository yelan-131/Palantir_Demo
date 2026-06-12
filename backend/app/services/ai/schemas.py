"""Shared schemas for the system AI layer.

Supports both the legacy state-machine agent and the new LLM-driven tool_use
agent.  The tool_use types (ToolCall, FrozenContext, etc.) are used by the
LLM-driven loop; the legacy types (SkillAction, etc.) are retained for
backward-compatibility and will be cleaned up once the migration is complete.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ── Provider configuration ──────────────────────────────────

ProviderName = Literal["openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"]


class AIProviderConfig(BaseModel):
    provider: ProviderName = "glm"
    base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    api_key: str = ""
    organization: str | None = None
    project: str | None = None
    chat_model: str = "glm-5.1"
    reasoning_model: str = "glm-5.1"
    embedding_model: str = "embedding-3"
    vision_model: str = "glm-4v-plus"
    timeout_seconds: int = 30


# ── Tool use protocol types ─────────────────────────────────

class ToolCallFunction(BaseModel):
    """A single function call requested by the LLM."""
    name: str
    arguments: str  # JSON-encoded string


class ToolCall(BaseModel):
    """Represents one tool call in an LLM response."""
    id: str
    type: Literal["function"] = "function"
    function: ToolCallFunction


# ── Chat messages ────────────────────────────────────────────

class ChatMessage(BaseModel):
    """A single message in the conversation.

    Supports both legacy text-only messages and the new tool_use protocol:
    - role='assistant' with tool_calls: the LLM requests tool execution
    - role='tool' with tool_call_id + content: a tool execution result
    """
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = None
    tool_calls: list[ToolCall] | None = None   # assistant → tool call requests
    tool_call_id: str | None = None             # tool → which call this answers
    name: str | None = None                     # tool → tool name (optional)

    def to_api_dict(self) -> dict[str, Any]:
        """Convert to the format expected by OpenAI-compatible chat APIs.

        Strips None fields so the API doesn't reject extra keys.
        """
        d: dict[str, Any] = {"role": self.role}
        if self.content is not None:
            d["content"] = self.content
        if self.tool_calls is not None:
            d["tool_calls"] = [tc.model_dump() for tc in self.tool_calls]
        if self.tool_call_id is not None:
            d["tool_call_id"] = self.tool_call_id
        if self.name is not None:
            d["name"] = self.name
        # Ensure assistant with tool_calls has non-null content
        if d.get("role") == "assistant" and "tool_calls" in d and "content" not in d:
            d["content"] = None
        # Ensure tool role has required fields
        if d.get("role") == "tool" and "content" not in d:
            d["content"] = ""
        return d


class ChatOptions(BaseModel):
    model: str | None = None
    temperature: float = 0.2
    max_tokens: int = 2048
    stream: bool = False
    response_format: dict[str, Any] | None = None
    tools: list[dict[str, Any]] | None = None       # OpenAI function definitions
    tool_choice: str | dict | None = None             # "auto" | "required" | "none" | {"type":"function","function":{"name":"..."}}


class ChatResult(BaseModel):
    """Result from a single LLM chat call.

    Extended to support tool_use: the response may contain either a text
    answer (content) or tool call requests (tool_calls), or both.
    """
    provider: str
    model: str
    content: str | None = None
    tool_calls: list[ToolCall] | None = None
    finish_reason: str = "stop"  # "stop" | "tool_calls" | "length"
    usage: dict[str, Any] = Field(default_factory=dict)


class EmbeddingResult(BaseModel):
    provider: str
    model: str
    embeddings: list[list[float]]


class VisionExtractResult(BaseModel):
    provider: str
    model: str
    markdown: str
    confidence: float = 0.0


# ── Frozen context for confirmation freeze/resume ───────────

class FrozenContext(BaseModel):
    """Serialized LLM conversation state for confirmation freeze/resume.

    When the LLM requests a high-risk tool call that requires human
    confirmation, the runtime freezes the entire conversation state into
    this object, stores it alongside the confirmation token, and pauses the
    loop.  When the user confirms, the runtime thaws the context and
    continues from where it left off.
    """
    messages: list[dict[str, Any]] = Field(default_factory=list)
    pending_tool_calls: list[ToolCall] = Field(default_factory=list)
    executed_tool_results: list[dict[str, Any]] = Field(default_factory=list)
    turn_number: int = 0
    max_turns: int = 8
    token_count: int = 0
    openai_tools: list[dict[str, Any]] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)


# ── Tool interception result ────────────────────────────────

class InterceptResult(BaseModel):
    """Result from processing a batch of LLM tool calls through the safety interceptor."""
    status: Literal["executed", "needs_confirmation", "denied", "tool_error"] = "executed"
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    pending_confirmations: list[dict[str, Any]] = Field(default_factory=list)
    denied_reasons: dict[str, str] = Field(default_factory=dict)


# ── Legacy types (retained for backward compatibility) ──────

class SkillAction(BaseModel):
    type: Literal["skill_result"] = "skill_result"
    skill: str
    title: str
    mode: Literal["read", "draft", "confirmed_write", "blocked"] = "draft"
    risk_level: Literal["low", "medium", "high", "critical"] = "medium"
    requires_confirmation: bool = True
    payload: dict[str, Any] = Field(default_factory=dict)
    evidence: list[dict[str, Any]] = Field(default_factory=list)


class AIPermissionDecision(BaseModel):
    allowed: bool
    reason: str = ""
    requires_confirmation: bool = False
    audit_required: bool = False
    matched_role: str | None = None
    capability: str | None = None


class AgentRequest(BaseModel):
    message: str
    page: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    provider_config: AIProviderConfig | None = None


class AgentResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    run_id: str | None = None
    answer: str
    actions: list[SkillAction] = Field(default_factory=list, exclude=True)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list)
    confirmation_payload: dict[str, Any] = Field(default_factory=dict, exclude=True)
    action_state: dict[str, Any] | None = None
    risk_level: Literal["low", "medium", "high", "critical"] = "low"
    requires_confirmation: bool = False
    mode: Literal["qa", "assisted", "agentic"] = "qa"
    frozen_context: FrozenContext | None = None
    token_budget: dict[str, Any] | None = None

    @model_validator(mode="before")
    @classmethod
    def _map_legacy_steps(cls, data: Any) -> Any:
        if isinstance(data, dict) and "items" not in data and "steps" in data:
            data = {**data, "items": data.get("steps") or []}
        return data

    @property
    def steps(self) -> list[dict[str, Any]]:
        """Internal compatibility shim while runtime code moves to items."""
        return self.items

    @steps.setter
    def steps(self, value: list[dict[str, Any]]) -> None:
        self.items = value


class DraftSaveRequest(BaseModel):
    skill: str
    payload: dict[str, Any] = Field(default_factory=dict)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    confirmation: dict[str, Any] = Field(default_factory=dict)


class DraftSaveResult(BaseModel):
    draft_id: str
    status: Literal["draft"] = "draft"
    skill: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str
