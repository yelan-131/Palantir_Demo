"""Convenience entrypoint for AI provider calls."""

from __future__ import annotations

from app.config import settings

from .providers import LLMProvider, make_provider
from .schemas import AIProviderConfig


def default_provider_config() -> AIProviderConfig:
    provider = getattr(settings, "AI_PROVIDER", "mock") or "mock"
    return AIProviderConfig(
        provider=provider,
        base_url=getattr(settings, "AI_BASE_URL", ""),
        api_key=getattr(settings, "AI_API_KEY", "") or getattr(settings, "OPENAI_API_KEY", ""),
        chat_model=getattr(settings, "AI_CHAT_MODEL", "") or getattr(settings, "OPENAI_MODEL", "mock-chat"),
        reasoning_model=getattr(settings, "AI_REASONING_MODEL", "mock-reasoning"),
        embedding_model=getattr(settings, "AI_EMBEDDING_MODEL", "mock-embedding"),
        vision_model=getattr(settings, "AI_VISION_MODEL", "disabled"),
        timeout_seconds=getattr(settings, "AI_TIMEOUT_SECONDS", 30),
    )


def get_provider(config: AIProviderConfig | None = None) -> LLMProvider:
    return make_provider(config or default_provider_config())

