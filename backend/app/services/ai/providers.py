"""LLM provider adapters."""

from __future__ import annotations

import base64
import hashlib
import mimetypes
from abc import ABC, abstractmethod
from urllib.parse import urljoin

import httpx

from .schemas import (
    AIProviderConfig,
    ChatMessage,
    ChatOptions,
    ChatResult,
    EmbeddingResult,
    ToolCall,
    ToolCallFunction,
    VisionExtractResult,
)


EXTERNAL_PROVIDERS = {"openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"}


def _parse_tool_calls(raw: object) -> list[ToolCall] | None:
    """Parse OpenAI-format tool_calls from a chat completion message."""
    if not isinstance(raw, list) or not raw:
        return None
    calls: list[ToolCall] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        function = item.get("function") or {}
        name = str(function.get("name") or "").strip()
        if not name:
            continue
        arguments = function.get("arguments")
        calls.append(
            ToolCall(
                id=str(item.get("id") or f"call_{index}"),
                function=ToolCallFunction(
                    name=name,
                    arguments=arguments if isinstance(arguments, str) else "{}",
                ),
            )
        )
    return calls or None


class ProviderConfigurationError(RuntimeError):
    """Raised when a provider is selected but required configuration is missing."""


def _http_error_detail(response: httpx.Response) -> str:
    try:
        return response.content.decode("utf-8", errors="replace")[:500]
    except Exception:  # pragma: no cover - httpx response content should decode
        return response.text[:500]


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


class OpenAICompatibleProvider(LLMProvider):
    """OpenAI-compatible adapter shell used by GLM, Qwen, DeepSeek, and others."""

    def _chat_completions_url(self) -> str:
        base_url = (self.config.base_url or "").strip()
        if not base_url:
            if self.config.provider == "glm":
                base_url = "https://open.bigmodel.cn/api/paas/v4"
            elif self.config.provider == "openai":
                base_url = "https://api.openai.com/v1"
            else:
                raise ProviderConfigurationError(f"{self.config.provider} base URL is not configured")
        if base_url.endswith("/chat/completions"):
            return base_url
        return urljoin(f"{base_url.rstrip('/')}/", "chat/completions")

    def _embeddings_url(self) -> str:
        base_url = (self.config.base_url or "").strip()
        if not base_url:
            if self.config.provider == "glm":
                base_url = "https://open.bigmodel.cn/api/paas/v4"
            elif self.config.provider == "openai":
                base_url = "https://api.openai.com/v1"
            else:
                raise ProviderConfigurationError(f"{self.config.provider} base URL is not configured")
        if base_url.endswith("/embeddings"):
            return base_url
        return urljoin(f"{base_url.rstrip('/')}/", "embeddings")

    async def chat(self, messages: list[ChatMessage], options: ChatOptions | None = None) -> ChatResult:
        if not self.config.api_key:
            raise ProviderConfigurationError(f"{self.config.provider} API key is not configured")

        model = options.model if options and options.model else self.config.chat_model
        payload: dict = {
            "model": model,
            # to_api_dict() strips None fields; model_dump() would leak
            # content/tool_calls/tool_call_id nulls that some OpenAI-compatible
            # backends reject.
            "messages": [message.to_api_dict() for message in messages],
            "temperature": options.temperature if options else 0.2,
            "max_tokens": options.max_tokens if options else 2048,
            "stream": False,
        }
        if options and options.tools:
            payload["tools"] = options.tools
            payload["tool_choice"] = options.tool_choice or "auto"
        if options and options.response_format:
            payload["response_format"] = options.response_format
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        if self.config.organization:
            headers["OpenAI-Organization"] = self.config.organization
        if self.config.project:
            headers["OpenAI-Project"] = self.config.project

        try:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
                response = await client.post(self._chat_completions_url(), json=payload, headers=headers)
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = _http_error_detail(exc.response)
            raise ProviderConfigurationError(f"{self.config.provider} request failed: HTTP {exc.response.status_code} {detail}") from exc
        except httpx.HTTPError as exc:
            raise ProviderConfigurationError(f"{self.config.provider} request failed: {exc}") from exc

        data = response.json()
        choice = data.get("choices", [{}])[0]
        message = choice.get("message", {})
        content = message.get("content")
        tool_calls = _parse_tool_calls(message.get("tool_calls"))
        finish_reason = str(choice.get("finish_reason") or ("tool_calls" if tool_calls else "stop"))
        # A response carrying only tool_calls legitimately has empty content.
        if not content and not tool_calls:
            raise ProviderConfigurationError(f"{self.config.provider} returned an empty chat response")
        return ChatResult(
            provider=self.config.provider,
            model=data.get("model") or model,
            content=content,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
            usage=data.get("usage") or {},
        )

    async def embed(self, texts: list[str], model: str | None = None) -> EmbeddingResult:
        if not self.config.api_key:
            raise ProviderConfigurationError(f"{self.config.provider} API key is not configured")
        selected_model = model or self.config.embedding_model
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
                response = await client.post(self._embeddings_url(), json={"model": selected_model, "input": texts}, headers=headers)
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = _http_error_detail(exc.response)
            raise ProviderConfigurationError(f"{self.config.provider} embedding request failed: HTTP {exc.response.status_code} {detail}") from exc
        except httpx.HTTPError as exc:
            raise ProviderConfigurationError(f"{self.config.provider} embedding request failed: {exc}") from exc

        data = response.json()
        embeddings = [item.get("embedding") for item in data.get("data", []) if isinstance(item.get("embedding"), list)]
        if len(embeddings) != len(texts):
            raise ProviderConfigurationError(f"{self.config.provider} returned {len(embeddings)} embeddings for {len(texts)} inputs")
        return EmbeddingResult(provider=self.config.provider, model=data.get("model") or selected_model, embeddings=embeddings)

    async def vision_extract(self, file_name: str, content: bytes, model: str | None = None) -> VisionExtractResult:
        if not self.config.api_key:
            raise ProviderConfigurationError(f"{self.config.provider} API key is not configured")
        selected_model = model or self.config.vision_model
        mime_type = mimetypes.guess_type(file_name)[0] or "image/png"
        image_url = f"data:{mime_type};base64,{base64.b64encode(content).decode('ascii')}"
        payload = {
            "model": selected_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Extract all readable document text from this image. "
                                "Return clean Markdown only, preserving tables, dates, part codes, and low-confidence notes."
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }
            ],
            "temperature": 0.0,
            "max_tokens": 4096,
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
                response = await client.post(self._chat_completions_url(), json=payload, headers=headers)
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = _http_error_detail(exc.response)
            raise ProviderConfigurationError(f"{self.config.provider} vision request failed: HTTP {exc.response.status_code} {detail}") from exc
        except httpx.HTTPError as exc:
            raise ProviderConfigurationError(f"{self.config.provider} vision request failed: {exc}") from exc

        data = response.json()
        markdown = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not markdown:
            raise ProviderConfigurationError(f"{self.config.provider} returned an empty vision response")
        return VisionExtractResult(
            provider=self.config.provider,
            model=data.get("model") or selected_model,
            markdown=markdown,
            confidence=0.8,
        )


def make_provider(config: AIProviderConfig) -> LLMProvider:
    if config.provider in EXTERNAL_PROVIDERS:
        return OpenAICompatibleProvider(config)
    raise ProviderConfigurationError(f"Unsupported AI provider: {config.provider}")
