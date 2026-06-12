"""Shared AI settings helpers.

The demo still keeps settings in memory, but all AI entrypoints should read
through this module so runtime, knowledge chat, and provider tests do not
import API modules from each other.
"""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from sqlalchemy import select, text

from app.core.logging import get_logger

from .schemas import AIProviderConfig


logger = get_logger(__name__)
AI_SETTINGS_KEY = "ai.system"
_SYSTEM_SETTINGS_TABLE_ENSURED = False
SUPPORTED_PROVIDER_NAMES = {"openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"}

DEFAULT_ROLE_POLICIES: list[dict[str, Any]] = [
    {
        "role": "admin",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft", "workflow", "config"],
        "domains": ["production", "quality", "maintenance", "supply-chain", "workflow", "low-code"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "production_manager",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft", "workflow"],
        "domains": ["production", "maintenance", "workflow"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "quality_engineer",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft"],
        "domains": ["quality"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "maintenance_manager",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft"],
        "domains": ["maintenance"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "supply_chain_manager",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft"],
        "domains": ["supply-chain"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "viewer",
        "enabled": True,
        "capabilities": ["qa", "rag", "report"],
        "domains": ["production", "quality", "maintenance", "supply-chain"],
        "agentMode": "readonly",
    },
]

DEFAULT_CONTEXT_POLICY: dict[str, Any] = {
    "recentMessageLimit": 10,
    "maxContextTokens": 12000,
    "showContextSources": True,
}

DEFAULT_RAG_POLICY: dict[str, Any] = {
    "enabled": True,
    "topK": 5,
    "maxEvidenceChars": 1200,
    "similarityThreshold": 0.15,
}

DEFAULT_MEMORY_POLICY: dict[str, Any] = {
    "enabled": False,
    "recallLimit": 5,
    "allowedTypes": ["summary", "fact", "preference", "task_state", "decision"],
    "defaultVisibility": "private",
    "retentionDays": 90,
}

DEFAULT_COMPACTION_POLICY: dict[str, Any] = {
    "enabled": True,
    "triggerMessageCount": 20,
    "triggerTokenCount": 12000,
    "compactOnClose": True,
    "summaryDetail": "standard",
}

DEFAULT_SAFETY_POLICY: dict[str, Any] = {
    "sensitiveMasking": True,
    "blockSecretMemory": True,
    "highRiskConfirm": True,
    # "pipeline" keeps the deterministic operation state machine;
    # "model" / "tool_use" routes requests to the LLM-driven tool_use loop
    # (requires a configured external provider; falls back to pipeline).
    "agentLoopMode": "pipeline",
    "maxToolSteps": 5,
    "toolTimeoutSeconds": 30,
    "persistConfirmations": False,
    "agentMaxInputTokens": 100000,
    "agentMaxOutputTokens": 20000,
    "maxToolResultChars": 8000,
    "deferredToolLoading": False,
    "permissionRules": [],
    "validationRules": [],
    "enabledHooks": [
        "enforce_permissions",
        "validate_before_confirmation",
        "validate_before_tool",
        "validate_after_tool",
        "audit_tool_use",
    ],
}

SENSITIVE_VALUE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\b(sk-[A-Za-z0-9_\-]{12,})\b"),
    re.compile(r"(?i)\b(api[_-]?key|token|secret|password|passwd)\s*[:=]\s*([^\s,;\"']{4,})"),
    re.compile(r"(?i)\b(bearer\s+)([A-Za-z0-9._\-]{12,})"),
)
SENSITIVE_KEY_MARKERS = ("api_key", "apikey", "password", "passwd", "secret", "token", "credential")

DEEPSEEK_DEFAULTS: dict[str, str] = {
    "baseUrl": "https://api.deepseek.com",
    "chatModel": "deepseek-chat",
    "reasoningModel": "deepseek-reasoner",
}


AI_SYSTEM_SETTINGS: dict[str, Any] = {
    "aiEnabled": True,
    "provider": "glm",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "apiKey": "",
    "chatModel": "glm-5.1",
    "reasoningModel": "glm-5.1",
    "embeddingModel": "embedding-3",
    "visionModel": "glm-4v-plus",
    "agentMode": "draft",
    "ragEnabled": True,
    "guestAccess": "disabled",
    "rolePolicies": DEFAULT_ROLE_POLICIES,
    "riskPolicy": {
        "low": "allow",
        "medium": "confirm",
        "high": "confirm_and_audit",
        "critical": "blocked",
    },
    "forbiddenActions": ["auto_order", "delete_data", "change_permission"],
    "contextPolicy": DEFAULT_CONTEXT_POLICY,
    "ragPolicy": DEFAULT_RAG_POLICY,
    "memoryPolicy": DEFAULT_MEMORY_POLICY,
    "compactionPolicy": DEFAULT_COMPACTION_POLICY,
    "safetyPolicy": DEFAULT_SAFETY_POLICY,
}


def get_ai_settings() -> dict[str, Any]:
    """Return a mutable in-memory settings object for the current demo runtime."""

    return AI_SYSTEM_SETTINGS


def settings_snapshot() -> dict[str, Any]:
    """Return a defensive copy for prompt/runtime use."""

    return deepcopy(AI_SYSTEM_SETTINGS)


def safety_policy_snapshot(settings_data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = settings_data or AI_SYSTEM_SETTINGS
    safety_policy = _merge_nested(DEFAULT_SAFETY_POLICY, data.get("safetyPolicy"))
    risk_policy = data.get("riskPolicy") or {}
    if safety_policy.get("maxToolSteps") in (None, "") and risk_policy.get("maxToolSteps") not in (None, ""):
        safety_policy["maxToolSteps"] = risk_policy.get("maxToolSteps")
    return safety_policy


def audit_enabled(settings_data: dict[str, Any] | None = None) -> bool:
    data = settings_data or AI_SYSTEM_SETTINGS
    return bool(data.get("auditEnabled", True))


def record_tool_calls_enabled(settings_data: dict[str, Any] | None = None) -> bool:
    data = settings_data or AI_SYSTEM_SETTINGS
    return bool(data.get("recordToolCalls", True))


def mask_sensitive_text(text: str) -> str:
    masked = text
    masked = SENSITIVE_VALUE_PATTERNS[0].sub("[REDACTED_SECRET]", masked)
    masked = SENSITIVE_VALUE_PATTERNS[1].sub(lambda match: f"{match.group(1)}=[REDACTED_SECRET]", masked)
    masked = SENSITIVE_VALUE_PATTERNS[2].sub(lambda match: f"{match.group(1)}[REDACTED_SECRET]", masked)
    return masked


def mask_sensitive_payload(value: Any, *, key_hint: str = "") -> Any:
    lowered_key = key_hint.lower()
    if any(marker in lowered_key for marker in SENSITIVE_KEY_MARKERS):
        return "[REDACTED_SECRET]" if value not in (None, "") else value
    if isinstance(value, dict):
        return {key: mask_sensitive_payload(item, key_hint=str(key)) for key, item in value.items()}
    if isinstance(value, list):
        return [mask_sensitive_payload(item, key_hint=key_hint) for item in value]
    if isinstance(value, tuple):
        return tuple(mask_sensitive_payload(item, key_hint=key_hint) for item in value)
    if isinstance(value, str):
        return mask_sensitive_text(value)
    return value


def maybe_mask_sensitive_payload(value: Any, settings_data: dict[str, Any] | None = None) -> Any:
    if not safety_policy_snapshot(settings_data).get("sensitiveMasking", True):
        return value
    return mask_sensitive_payload(value)


def settings_to_provider_config(settings_data: dict[str, Any] | None = None) -> AIProviderConfig:
    data = settings_data or AI_SYSTEM_SETTINGS
    try:
        from app.config import settings as runtime_settings
    except Exception:  # pragma: no cover - config import should not block local tests
        runtime_settings = None

    env_api_key = ""
    env_base_url = ""
    env_chat_model = ""
    env_reasoning_model = ""
    env_embedding_model = ""
    env_vision_model = ""
    env_timeout_seconds = 30
    if runtime_settings is not None:
        env_api_key = getattr(runtime_settings, "AI_API_KEY", "") or getattr(runtime_settings, "OPENAI_API_KEY", "")
        env_base_url = getattr(runtime_settings, "AI_BASE_URL", "")
        env_chat_model = getattr(runtime_settings, "AI_CHAT_MODEL", "") or getattr(runtime_settings, "OPENAI_MODEL", "")
        env_reasoning_model = getattr(runtime_settings, "AI_REASONING_MODEL", "")
        env_embedding_model = getattr(runtime_settings, "AI_EMBEDDING_MODEL", "")
        env_vision_model = getattr(runtime_settings, "AI_VISION_MODEL", "")
        env_timeout_seconds = int(getattr(runtime_settings, "AI_TIMEOUT_SECONDS", 30) or 30)

    return AIProviderConfig(
        provider=data.get("provider") or "glm",
        base_url=data.get("baseUrl") or data.get("base_url") or env_base_url or "",
        api_key=data.get("apiKey") or data.get("api_key") or env_api_key,
        organization=data.get("organization") or "",
        project=data.get("project") or "",
        chat_model=data.get("chatModel") or data.get("chat_model") or env_chat_model or "glm-5.1",
        reasoning_model=data.get("reasoningModel") or data.get("reasoning_model") or env_reasoning_model or "glm-5.1",
        embedding_model=data.get("embeddingModel") or data.get("embedding_model") or env_embedding_model or "embedding-3",
        vision_model=data.get("visionModel") or data.get("vision_model") or env_vision_model or "glm-4v-plus",
        timeout_seconds=int(data.get("timeoutSeconds") or data.get("timeout_seconds") or env_timeout_seconds),
    )


def mask_settings(settings_data: dict[str, Any]) -> dict[str, Any]:
    masked = {**settings_data}
    if masked.get("apiKey"):
        masked["apiKey"] = "********"
    return masked


def _merge_nested(defaults: dict[str, Any], value: Any) -> dict[str, Any]:
    incoming = value if isinstance(value, dict) else {}
    return {**defaults, **incoming}


def _normalize_provider_defaults(settings_data: dict[str, Any]) -> dict[str, Any]:
    provider = settings_data.get("provider")
    if provider not in SUPPORTED_PROVIDER_NAMES:
        settings_data["provider"] = "glm"
        provider = "glm"
    if provider == "deepseek":
        base_url = str(settings_data.get("baseUrl") or settings_data.get("base_url") or "")
        if not base_url or "bigmodel.cn" in base_url or "api.openai.com" in base_url:
            settings_data["baseUrl"] = DEEPSEEK_DEFAULTS["baseUrl"]
        chat_model = str(settings_data.get("chatModel") or settings_data.get("chat_model") or "")
        if not chat_model or chat_model.startswith(("glm-", "GLM-", "gpt-")):
            settings_data["chatModel"] = DEEPSEEK_DEFAULTS["chatModel"]
        reasoning_model = str(settings_data.get("reasoningModel") or settings_data.get("reasoning_model") or "")
        if not reasoning_model or reasoning_model.startswith(("glm-", "GLM-", "gpt-")):
            settings_data["reasoningModel"] = DEEPSEEK_DEFAULTS["reasoningModel"]
    return settings_data


def merge_ai_settings(incoming: dict[str, Any], *, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    clean_incoming = {**incoming}
    if clean_incoming.get("apiKey") == "********" or clean_incoming.get("api_key") == "********":
        clean_incoming.pop("apiKey", None)
        clean_incoming.pop("api_key", None)

    merged = {**(existing or AI_SYSTEM_SETTINGS), **clean_incoming}
    merged = _normalize_provider_defaults(merged)
    merged.setdefault("guestAccess", "disabled")
    merged.setdefault("rolePolicies", DEFAULT_ROLE_POLICIES)
    merged.setdefault("riskPolicy", {"low": "allow", "medium": "confirm", "high": "confirm_and_audit", "critical": "blocked"})
    merged.setdefault("forbiddenActions", ["auto_order", "delete_data", "change_permission"])
    merged["contextPolicy"] = _merge_nested(DEFAULT_CONTEXT_POLICY, merged.get("contextPolicy"))
    merged["ragPolicy"] = _merge_nested(DEFAULT_RAG_POLICY, merged.get("ragPolicy"))
    merged["memoryPolicy"] = _merge_nested(DEFAULT_MEMORY_POLICY, merged.get("memoryPolicy"))
    merged["compactionPolicy"] = _merge_nested(DEFAULT_COMPACTION_POLICY, merged.get("compactionPolicy"))
    merged["safetyPolicy"] = _merge_nested(DEFAULT_SAFETY_POLICY, merged.get("safetyPolicy"))
    if merged["safetyPolicy"].get("maxToolSteps") not in (None, ""):
        merged.setdefault("riskPolicy", {})["maxToolSteps"] = merged["safetyPolicy"].get("maxToolSteps")
    return merged


async def load_persisted_ai_settings() -> dict[str, Any] | None:
    try:
        from app.core.db import db_session
        from app.models.relational import SystemSetting

        async with db_session() as session:
            await _ensure_system_settings_table(session)
            result = await session.execute(select(SystemSetting).where(SystemSetting.key == AI_SETTINGS_KEY))
            record = result.scalar_one_or_none()
            if not record or not isinstance(record.value, dict):
                return None
            merged = merge_ai_settings(record.value)
            if record.value != merged:
                record.value = merged
                await session.commit()
            AI_SYSTEM_SETTINGS.clear()
            AI_SYSTEM_SETTINGS.update(merged)
            return merged
    except Exception as exc:  # noqa: BLE001 - settings should fall back to env/in-memory
        logger.warning("AI settings DB load failed; using runtime defaults: %s", exc)
        return None


async def save_persisted_ai_settings(settings_data: dict[str, Any], *, updated_by: str | None = None) -> dict[str, Any]:
    from app.core.db import db_session
    from app.models.relational import SystemSetting

    existing = await load_persisted_ai_settings()
    merged = merge_ai_settings(settings_data, existing=existing or AI_SYSTEM_SETTINGS)

    async with db_session() as session:
        await _ensure_system_settings_table(session)
        result = await session.execute(select(SystemSetting).where(SystemSetting.key == AI_SETTINGS_KEY))
        record = result.scalar_one_or_none()
        if record is None:
            record = SystemSetting(
                key=AI_SETTINGS_KEY,
                value=merged,
                description="AI provider, permission, and runtime settings",
                updated_by=updated_by,
            )
            session.add(record)
        else:
            record.value = merged
            record.updated_by = updated_by
        await session.commit()

    AI_SYSTEM_SETTINGS.clear()
    AI_SYSTEM_SETTINGS.update(merged)
    return merged


async def _ensure_system_settings_table(session) -> None:
    global _SYSTEM_SETTINGS_TABLE_ENSURED
    if _SYSTEM_SETTINGS_TABLE_ENSURED:
        return

    bind = session.get_bind()
    dialect_name = bind.dialect.name if bind is not None else ""
    if dialect_name == "postgresql":
        id_column = "id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"
        value_type = "JSONB"
        key_column = '"key"'
    else:
        id_column = "id INTEGER PRIMARY KEY AUTOINCREMENT"
        value_type = "JSON"
        key_column = "key"

    await session.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS system_settings (
                {id_column},
                {key_column} VARCHAR(120) NOT NULL UNIQUE,
                value {value_type} NOT NULL DEFAULT '{{}}',
                description TEXT,
                updated_by VARCHAR(120),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await session.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS ix_system_settings_key ON system_settings ({key_column})"))
    await session.commit()
    _SYSTEM_SETTINGS_TABLE_ENSURED = True
