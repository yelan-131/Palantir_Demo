"""LLM provider adapters.

The current implementation keeps real network calls out of the demo path. It
normalizes provider configuration, validates missing API keys for external
providers, and exposes deterministic local behavior for tests and fallback.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod

from .schemas import AIProviderConfig, ChatMessage, ChatOptions, ChatResult, EmbeddingResult, VisionExtractResult


EXTERNAL_PROVIDERS = {"openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"}


class ProviderConfigurationError(RuntimeError):
    """Raised when a provider is selected but required configuration is missing."""


class LLMProvider(ABC):
    def __init__(self, config: AIProviderConfig):
        self.config = config

    @abstractmethod
    async def chat(self, messages: list[ChatMessage], options: ChatOptions | None = None) -> ChatResult:
        raise NotImplementedError

    @abstractmethod
    async def embed(self, texts: list[str], model: str | None = None) -> EmbeddingResult:
        raise NotImplementedError

    @abstractmethod
    async def vision_extract(self, file_name: str, content: bytes, model: str | None = None) -> VisionExtractResult:
        raise NotImplementedError


def _stable_embedding(text: str, dimensions: int = 16) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8", errors="ignore")).digest()
    values = []
    for index in range(dimensions):
        raw = digest[index] / 255
        values.append(round((raw * 2) - 1, 6))
    return values


class LocalMockProvider(LLMProvider):
    async def chat(self, messages: list[ChatMessage], options: ChatOptions | None = None) -> ChatResult:
        model = options.model if options and options.model else self.config.chat_model
        last_user = next((item.content for item in reversed(messages) if item.role == "user"), "")
        return ChatResult(
            provider=self.config.provider,
            model=model,
            content=f"Mock AI response for: {last_user}".strip(),
            usage={"mode": "local_mock"},
        )

    async def embed(self, texts: list[str], model: str | None = None) -> EmbeddingResult:
        return EmbeddingResult(
            provider=self.config.provider,
            model=model or self.config.embedding_model,
            embeddings=[_stable_embedding(text) for text in texts],
        )

    async def vision_extract(self, file_name: str, content: bytes, model: str | None = None) -> VisionExtractResult:
        return VisionExtractResult(
            provider=self.config.provider,
            model=model or self.config.vision_model,
            markdown=f"# {file_name}\n\nImage OCR/vision extraction is pending provider configuration.",
            confidence=0.1,
        )


class OpenAICompatibleProvider(LocalMockProvider):
    """OpenAI-compatible adapter shell used by GLM, Qwen, DeepSeek, and others.

    Network calls are intentionally not performed in this MVP. The class gives
    the rest of the system a stable provider boundary and validates API keys so
    production wiring can replace the mock body without changing callers.
    """

    async def chat(self, messages: list[ChatMessage], options: ChatOptions | None = None) -> ChatResult:
        if not self.config.api_key:
            raise ProviderConfigurationError(f"{self.config.provider} API key is not configured")
        return await super().chat(messages, options)

    async def embed(self, texts: list[str], model: str | None = None) -> EmbeddingResult:
        if not self.config.api_key:
            raise ProviderConfigurationError(f"{self.config.provider} API key is not configured")
        return await super().embed(texts, model)


def make_provider(config: AIProviderConfig) -> LLMProvider:
    if config.provider in {"local", "mock"}:
        return LocalMockProvider(config)
    if config.provider in EXTERNAL_PROVIDERS:
        return OpenAICompatibleProvider(config)
    raise ProviderConfigurationError(f"Unsupported AI provider: {config.provider}")
