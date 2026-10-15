"""Convenience entrypoint for AI provider calls."""

from __future__ import annotations

from app.config import settings

from .providers import LLMProvider, make_provider
from .schemas import AIProviderConfig


def default_provider_config() -> AIProviderConfig:
    from .settings import settings_snapshot, settings_to_provider_config
    return settings_to_provider_config(settings_snapshot())


def get_provider(config: AIProviderConfig | None = None) -> LLMProvider:
    return make_provider(config or default_provider_config())
