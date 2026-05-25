"""Shared schemas for the system AI layer."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


ProviderName = Literal["openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm", "local", "mock"]


class AIProviderConfig(BaseModel):
    provider: ProviderName = "mock"
    base_url: str = ""
    api_key: str = ""
    organization: str | None = None
    project: str | None = None
    chat_model: str = "mock-chat"
    reasoning_model: str = "mock-reasoning"
    embedding_model: str = "mock-embedding"
    vision_model: str = "disabled"
    timeout_seconds: int = 30


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatOptions(BaseModel):
    model: str | None = None
    temperature: float = 0.2
    max_tokens: int = 2048
    stream: bool = False


class ChatResult(BaseModel):
    provider: str
    model: str
    content: str
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
    answer: str
    actions: list[SkillAction] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    requires_confirmation: bool = False
    mode: Literal["qa", "assisted", "agentic"] = "qa"


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
