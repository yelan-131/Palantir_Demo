"""Database-authoritative AI settings with one runtime cache and policy schema."""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from sqlalchemy import select, text
from urllib.parse import urlparse

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
    "recallLimit": 0,
    "allowedTypes": ["summary", "fact", "preference", "task_state", "decision"],
    "defaultVisibility": "private",
    "retentionDays": 90,
}

DEFAULT_COMPACTION_POLICY: dict[str, Any] = {
    "enabled": False,
    "triggerMessageCount": 20,
    "triggerTokenCount": 12000,
    "compactOnClose": False,
    "summaryDetail": "standard",
}

# SDK and plugin names follow the pinned DSH runtime. None preserves the
# existing automatic/default behaviour instead of creating a second override.
DEFAULT_HARNESS_POLICY: dict[str, Any] = {
    "reasoning_effort": None,
    "initialize_timeout_seconds": 30,
    "request_timeout_seconds": None,
    "streamIdleTimeoutMs": None,
    "contextWindow": None,
    "compaction": {"enabled": True, "thresholdRatio": 0.8, "retainRatio": 0.16},
}

DEFAULT_SAFETY_POLICY: dict[str, Any] = {
    "sensitiveMasking": True,
    "blockSecretMemory": True,
    "highRiskConfirm": True,
    # The public runtime always uses the official Harness kernel.
    "agentLoopMode": "harness",
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
    "qaEnabled": True,
    "assistEnabled": True,
    "temperature": "strict",
    "maxTokens": 2048,
    "retryCount": 2,
    "timeoutSeconds": 30,
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
    "harnessPolicy": DEFAULT_HARNESS_POLICY,
    "safetyPolicy": DEFAULT_SAFETY_POLICY,
}


try:
    from app.config import settings as _environment
    for _key, _env in {"provider": "AI_PROVIDER", "baseUrl": "AI_BASE_URL", "chatModel": "AI_CHAT_MODEL", "reasoningModel": "AI_REASONING_MODEL", "embeddingModel": "AI_EMBEDDING_MODEL", "visionModel": "AI_VISION_MODEL", "timeoutSeconds": "AI_TIMEOUT_SECONDS"}.items():
        _value = getattr(_environment, _env, None)
        if _value:
            AI_SYSTEM_SETTINGS[_key] = _value
except ImportError:
    pass


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


def settings_to_provider_config(settings_data: dict[str, Any] | None = None, *, purpose: str = 'chat') -> AIProviderConfig:
    from .model_catalog import resolve_model_settings
    data = resolve_model_settings(settings_data or AI_SYSTEM_SETTINGS, purpose)
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
        if not getattr(runtime_settings, "AI_API_KEY", "") and getattr(runtime_settings, "OPENAI_API_KEY", "") and getattr(runtime_settings, "AI_PROVIDER", "glm") not in {"openai", "openai-compatible", "azure-openai"}:
            env_base_url = "https://api.openai.com/v1"
        env_chat_model = getattr(runtime_settings, "AI_CHAT_MODEL", "") or getattr(runtime_settings, "OPENAI_MODEL", "")
        env_reasoning_model = getattr(runtime_settings, "AI_REASONING_MODEL", "")
        env_embedding_model = getattr(runtime_settings, "AI_EMBEDDING_MODEL", "")
        env_vision_model = getattr(runtime_settings, "AI_VISION_MODEL", "")
        env_timeout_seconds = int(getattr(runtime_settings, "AI_TIMEOUT_SECONDS", 30) or 30)

    base_url = data.get("baseUrl") or data.get("base_url") or env_base_url or ""
    # Environment credentials are scoped to their configured server origin;
    # switching provider/URL must not send an old secret to a new service.
    try:
        target, source = urlparse(base_url), urlparse(env_base_url)
        env_key_allowed = (target.scheme, target.hostname, target.port) == (source.scheme, source.hostname, source.port)
    except ValueError:
        env_key_allowed = False
    return AIProviderConfig(
        provider=data.get("provider") or "glm",
        base_url=base_url,
        api_key=data.get("apiKey") or data.get("api_key") or (env_api_key if env_key_allowed and not data.get("_catalogResolved") else ""),
        organization=data.get("organization") or "",
        project=data.get("project") or "",
        chat_model=data.get("chatModel") or data.get("chat_model") or env_chat_model or "glm-5.1",
        reasoning_model=data.get("reasoningModel") or data.get("reasoning_model") or data.get("chatModel") or data.get("chat_model") or env_reasoning_model or "glm-5.1",
        embedding_model=data.get("embeddingModel") or data.get("embedding_model") or env_embedding_model or "embedding-3",
        vision_model=data.get("visionModel") or data.get("vision_model") or env_vision_model or "glm-4v-plus",
        timeout_seconds=int(data.get("timeoutSeconds") or data.get("timeout_seconds") or env_timeout_seconds),
        retry_count=int(data.get("retryCount", 2)),
    )


def mask_settings(settings_data: dict[str, Any]) -> dict[str, Any]:
    from .model_catalog import catalog_from_legacy
    masked = deepcopy(settings_data)
    if 'modelServices' not in masked:
        masked['modelServices'], masked['modelAssignments'] = catalog_from_legacy(masked)
    for service in masked['modelServices']:
        if service.get('apiKey'):
            service['apiKey'] = '********'
    for key in ("apiKey", "api_key"):
        if masked.get(key):
            masked[key] = "********"
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
        for key, value in DEEPSEEK_DEFAULTS.items():
            if key not in settings_data or (not settings_data.get(key) and key != "reasoningModel"):
                settings_data[key] = value
    return settings_data


def merge_ai_settings(incoming: dict[str, Any], *, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    clean_incoming = deepcopy(incoming)
    clean_incoming.pop("_catalogResolved", None)
    clean_incoming.pop("_testTarget", None)
    for group in ("contextPolicy", "memoryPolicy", "compactionPolicy", "ragPolicy", "safetyPolicy", "riskPolicy", "harnessPolicy"):
        if group in clean_incoming:
            if not isinstance(clean_incoming[group], dict):
                raise ValueError(f"{group} 必须是对象")
            previous_group = (existing if existing is not None else AI_SYSTEM_SETTINGS).get(group) or {}
            if group == "harnessPolicy" and "compaction" in clean_incoming[group]:
                if not isinstance(clean_incoming[group]["compaction"], dict):
                    raise ValueError("harnessPolicy.compaction 必须是对象")
                clean_incoming[group]["compaction"] = {**deepcopy(previous_group.get("compaction") or {}), **clean_incoming[group]["compaction"]}
            clean_incoming[group] = {**deepcopy(previous_group), **clean_incoming[group]}
    for snake, camel in {"api_key": "apiKey", "base_url": "baseUrl", "chat_model": "chatModel", "reasoning_model": "reasoningModel", "embedding_model": "embeddingModel", "vision_model": "visionModel", "timeout_seconds": "timeoutSeconds"}.items():
        if snake in clean_incoming:
            clean_incoming[camel] = clean_incoming.pop(snake)
    if clean_incoming.get("apiKey") == "********" or clean_incoming.get("api_key") == "********":
        clean_incoming.pop("apiKey", None)
        clean_incoming.pop("api_key", None)

    merged = {**deepcopy(existing if existing is not None else AI_SYSTEM_SETTINGS), **clean_incoming}
    if "provider" in clean_incoming and clean_incoming["provider"] not in SUPPORTED_PROVIDER_NAMES:
        raise ValueError("不支持的模型服务商")
    existing_data = existing if existing is not None else AI_SYSTEM_SETTINGS
    if clean_incoming.get("provider") == "deepseek" and existing_data.get("provider") != "deepseek":
        for key, value in DEEPSEEK_DEFAULTS.items():
            if key not in clean_incoming:
                merged[key] = value
    merged = _normalize_provider_defaults(merged)
    existing_data = existing if existing is not None else AI_SYSTEM_SETTINGS
    if not clean_incoming.get("apiKey") and merged.get("apiKey"):
        previous_url = urlparse(str(existing_data.get("baseUrl") or ""))
        next_url = urlparse(str(merged.get("baseUrl") or ""))
        if (previous_url.scheme, previous_url.netloc.lower()) != (next_url.scheme, next_url.netloc.lower()):
            merged["apiKey"] = ""
    merged.setdefault("guestAccess", "disabled")
    merged.setdefault("rolePolicies", DEFAULT_ROLE_POLICIES)
    merged.setdefault("riskPolicy", {"low": "allow", "medium": "confirm", "high": "confirm_and_audit", "critical": "blocked"})
    merged.setdefault("forbiddenActions", ["auto_order", "delete_data", "change_permission"])
    merged["contextPolicy"] = _merge_nested(DEFAULT_CONTEXT_POLICY, merged.get("contextPolicy"))
    merged["ragPolicy"] = _merge_nested(DEFAULT_RAG_POLICY, merged.get("ragPolicy"))
    merged["memoryPolicy"] = _merge_nested(DEFAULT_MEMORY_POLICY, merged.get("memoryPolicy"))
    # Shared memory scopes are not implemented; never imply broader visibility.
    merged["memoryPolicy"]["defaultVisibility"] = "private"
    merged["compactionPolicy"] = _merge_nested(DEFAULT_COMPACTION_POLICY, merged.get("compactionPolicy"))
    merged["harnessPolicy"] = _merge_nested(deepcopy(DEFAULT_HARNESS_POLICY), merged.get("harnessPolicy"))
    merged["harnessPolicy"]["compaction"] = _merge_nested(deepcopy(DEFAULT_HARNESS_POLICY["compaction"]), merged["harnessPolicy"].get("compaction"))
    # Retired platform summaries must never override native DSH compaction.
    merged["safetyPolicy"] = _merge_nested(DEFAULT_SAFETY_POLICY, merged.get("safetyPolicy"))
    for key in ("highRiskConfirm", "sensitiveMasking"):
        if key in clean_incoming and key not in (clean_incoming.get("safetyPolicy") or {}):
            merged["safetyPolicy"][key] = clean_incoming[key]
        merged.pop(key, None)
    for key in ("ragEnabled", "topK", "similarityThreshold"):
        target = {"ragEnabled": "enabled"}.get(key, key)
        if key in clean_incoming and target not in (clean_incoming.get("ragPolicy") or {}):
            merged["ragPolicy"][target] = clean_incoming[key]
        merged.pop(key, None)
    if merged["safetyPolicy"].get("maxToolSteps") not in (None, ""):
        merged.setdefault("riskPolicy", {})["maxToolSteps"] = merged["safetyPolicy"].get("maxToolSteps")
    merged["safetyPolicy"]["agentLoopMode"] = "harness"
    for deprecated in ("proactiveEnabled", "streaming", "dailyLimit", "userDailyLimit", "knowledgeScopes", "tools", "retentionDays"):
        merged.pop(deprecated, None)
    from .model_catalog import merge_catalog, catalog_from_legacy
    catalog_existing = deepcopy(existing if existing is not None else AI_SYSTEM_SETTINGS)
    if 'modelServices' in incoming and 'modelServices' not in catalog_existing:
        catalog_existing['modelServices'], catalog_existing['modelAssignments'] = catalog_from_legacy(catalog_existing)
    merge_catalog(clean_incoming, catalog_existing, merged)
    merged['memoryPolicy'].update(enabled=False, recallLimit=0)
    merged['compactionPolicy'].update(enabled=False, compactOnClose=False)
    validate_ai_settings(merged)
    from .harness_parameters import effective_harness_parameters
    for purpose in ('chat', 'reasoning', 'document'):
        if purpose == 'document' and 'modelServices' in merged and not merged.get('modelAssignments', {}).get('document'):
            continue
        effective_harness_parameters(merged, purpose)
    return merged


def validate_ai_settings(data: dict[str, Any]) -> None:
    harness = data.get("harnessPolicy") or {}
    for key, low, high in (("initialize_timeout_seconds", 1, 180), ("request_timeout_seconds", 1, 3600), ("streamIdleTimeoutMs", 1, 3600000), ("contextWindow", 1000, 2000000)):
        value = harness.get(key)
        if value in (None, ""):
            continue
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"harnessPolicy.{key} 必须是整数") from None
        if not parsed.is_integer() or not low <= parsed <= high:
            raise ValueError(f"harnessPolicy.{key} 必须是 {low} 到 {high} 之间的整数")
    effort = harness.get("reasoning_effort")
    if effort not in (None, "", "minimal", "low", "medium", "high", "xhigh", "max"):
        raise ValueError("reasoning_effort 必须使用当前 DSH 适配器支持的级别")
    compaction = harness.get("compaction") or {}
    if not isinstance(compaction.get("enabled", True), bool):
        raise ValueError("harnessPolicy.compaction.enabled 必须是布尔值")
    try:
        threshold, retain = float(compaction.get("thresholdRatio", .8)), float(compaction.get("retainRatio", .16))
    except (TypeError, ValueError):
        raise ValueError("DSH 压缩比例必须是数字") from None
    if not 0 < retain < threshold <= 1:
        raise ValueError("DSH 压缩比例需满足 0 < retainRatio < thresholdRatio ≤ 1")
    for key, low in (("headroomTokens", 0), ("maxTokens", 1)):
        value = compaction.get(key)
        if value not in (None, "") and (isinstance(value, bool) or not isinstance(value, int) or not low <= value <= 32768):
            raise ValueError(f"harnessPolicy.compaction.{key} 必须是 {low} 到 32768 之间的整数")
    window = harness.get("contextWindow")
    if window not in (None, "") and int(window) <= int(data.get("maxTokens", 2048)):
        raise ValueError("contextWindow 必须大于 max_tokens，为输入保留空间")
    memory = data.get("memoryPolicy") or {}
    if not isinstance(memory.get("allowedTypes", []), list) or not all(isinstance(item, str) and item in {"summary", "fact", "preference", "task_state", "decision", "turn_summary"} for item in memory.get("allowedTypes", [])):
        raise ValueError("允许记忆类型必须是支持的类型数组")
    for group, key in (("contextPolicy", "showContextSources"), ("compactionPolicy", "compactOnClose")):
        if not isinstance((data.get(group) or {}).get(key, True), bool):
            raise ValueError(f"{group}.{key} 必须是布尔值")
    if (data.get("compactionPolicy") or {}).get("summaryDetail", "standard") not in {"compact", "standard", "detailed"}:
        raise ValueError("摘要粒度无效")
    for key in ("aiEnabled", "qaEnabled", "assistEnabled", "auditEnabled", "recordToolCalls"):
        if key in data and not isinstance(data[key], bool):
            raise ValueError(f"{key} 必须是布尔值")
    for group in ("memoryPolicy", "ragPolicy", "compactionPolicy"):
        if "enabled" in (data.get(group) or {}) and not isinstance(data[group]["enabled"], bool):
            raise ValueError(f"{group}.enabled 必须是布尔值")
    for key in ("sensitiveMasking", "blockSecretMemory", "highRiskConfirm"):
        if key in (data.get("safetyPolicy") or {}) and not isinstance(data["safetyPolicy"][key], bool):
            raise ValueError(f"safetyPolicy.{key} 必须是布尔值")
    for key in ("domains", "forbiddenActions"):
        if key in data and (not isinstance(data[key], list) or not all(isinstance(item, str) for item in data[key])):
            raise ValueError(f"{key} 必须是文本数组")
    policies = data.get("rolePolicies", [])
    if not isinstance(policies, list):
        raise ValueError("rolePolicies 必须是数组")
    for role in policies:
        if not isinstance(role, dict) or not isinstance(role.get("role"), str) or not isinstance(role.get("enabled", True), bool):
            raise ValueError("角色策略格式无效")
        if role.get("agentMode", "confirm") not in {"off", "readonly", "draft", "confirm", "save_after_confirm"}:
            raise ValueError("角色执行模式无效")
        for key in ("capabilities", "domains"):
            if not isinstance(role.get(key, []), list) or not all(isinstance(item, str) for item in role.get(key, [])):
                raise ValueError(f"角色的 {key} 必须是文本数组")
    if data.get("agentMode", "draft") not in {"off", "readonly", "draft", "confirm"}:
        raise ValueError("Agent 执行模式无效")
    policy = data.get("safetyPolicy") or {}
    if policy.get("agentLoopMode", "pipeline") not in {"harness"}:
        raise ValueError("Agent 推理架构无效")
    for key, low, high in [("maxTokens", 32, 32768), ("timeoutSeconds", 1, 180), ("retryCount", 0, 3)]:
        try:
            number = int(data.get(key, low))
        except (ValueError, TypeError):
            raise ValueError(f"{key} 必须是整数") from None
        if not low <= number <= high:
            raise ValueError(f"{key} 必须在 {low} 到 {high} 之间")
    for key, low, high in [("maxToolSteps", 1, 20), ("toolTimeoutSeconds", 1, 180)]:
        try:
            number = int(policy.get(key, DEFAULT_SAFETY_POLICY[key]))
        except (ValueError, TypeError):
            raise ValueError(f"{key} 必须是整数") from None
        if not low <= number <= high:
            raise ValueError(f"{key} 必须在 {low} 到 {high} 之间")
    for group, ranges in {
        "contextPolicy": {"recentMessageLimit": (2, 50), "maxContextTokens": (1000, 200000)},
        "ragPolicy": {"topK": (1, 20), "maxEvidenceChars": (200, 5000)},
        "memoryPolicy": {"recallLimit": (0, 20), "retentionDays": (1, 3650)},
        "compactionPolicy": {"triggerMessageCount": (2, 200), "triggerTokenCount": (1000, 200000)},
    }.items():
        for key, (low, high) in ranges.items():
            value = (data.get(group) or {}).get(key)
            if value is None:
                continue
            try:
                parsed = int(value)
            except (ValueError, TypeError):
                raise ValueError(f"{group}.{key} 必须是整数") from None
            if not low <= parsed <= high:
                raise ValueError(f"{group}.{key} 必须在 {low} 到 {high} 之间")
    try:
        threshold = float((data.get("ragPolicy") or {}).get("similarityThreshold", 0.15))
    except (ValueError, TypeError):
        raise ValueError("相似度阈值必须是 0 到 1 的数字") from None
    if not 0 <= threshold <= 1:
        raise ValueError("相似度阈值必须是 0 到 1 的数字")
    url = data.get("baseUrl") or ""
    if url and (urlparse(url).scheme not in {"http", "https"} or not urlparse(url).hostname):
        raise ValueError("Base URL 必须是有效的 HTTP(S) 地址")
    if data.get("temperature", "strict") not in {"strict", "balanced", "creative"}:
        raise ValueError("回答风格无效")


def chat_options(settings_data: dict[str, Any], *, model: str | None = None):
    from .schemas import ChatOptions
    return ChatOptions(model=model, max_tokens=int(settings_data.get("maxTokens", 2048)), temperature={"strict": 0.2, "balanced": 0.5, "creative": 0.8}.get(settings_data.get("temperature"), 0.2))


def runtime_status(settings_data: dict[str, Any]) -> dict[str, Any]:
    config = settings_to_provider_config(settings_data)
    issues = []
    if not config.api_key:
        issues.append("未配置 API Key")
    host = urlparse(config.base_url).hostname
    if host in {"127.0.0.1", "localhost", "::1"}:
        issues.append("回环地址指向后端容器自身；宿主机服务请使用 host.docker.internal")
    if config.chat_model == "local-disabled":
        issues.append("当前聊天模型是 local-disabled，无法连接真实模型")
    if (config.reasoning_model or config.chat_model) == "local-disabled":
        issues.append("当前 Agent 模型是 local-disabled，无法执行业务 Agent")
    routes = []
    if 'modelServices' in settings_data:
        from .model_catalog import resolve_model_settings
        issues = []
        for purpose in ('chat', 'reasoning', 'document'):
            if purpose == 'document' and not (settings_data.get('modelAssignments') or {}).get('document'):
                continue
            selected = settings_to_provider_config(settings_data, purpose=purpose)
            routes.append({'purpose': purpose, 'baseUrl': selected.base_url, 'model': selected.chat_model, 'credentialConfigured': bool(selected.api_key)})
            if not selected.api_key:
                issues.append(f'{purpose} 用途的模型服务未配置 API Key')
            if selected.chat_model == 'local-disabled':
                issues.append(f'{purpose} 用途尚未选择真实模型')
            if urlparse(selected.base_url).hostname in {'127.0.0.1', 'localhost', '::1'}:
                issues.append(f'{purpose} 用途使用回环地址，请确认容器可访问')
    from importlib.metadata import PackageNotFoundError, version
    try:
        sdk_version = version("deepseek-harness-sdk")
    except PackageNotFoundError:
        sdk_version = None
        issues.append("官方 DeepSeek Harness SDK 尚未安装")
    try:
        runtime_version = version("deepseek-harness-runtime-bin")
    except PackageNotFoundError:
        runtime_version = None
        issues.append("Harness 配套运行时尚未安装")
    if sdk_version and runtime_version and sdk_version != runtime_version:
        issues.append("Harness SDK 与运行时版本不一致")
    return {"routes": routes, "engine": "deepseek-harness", "sdkVersion": sdk_version, "runtimeVersion": runtime_version, "providerConfigured": bool(config.api_key and config.chat_model and config.chat_model != "local-disabled"), "ready": not issues, "agentLoopMode": safety_policy_snapshot(settings_data)["agentLoopMode"], "agentMode": settings_data.get("agentMode", "draft"), "issues": issues}


async def load_persisted_ai_settings(*, strict: bool = False) -> dict[str, Any] | None:
    try:
        from app.core.db import db_session
        from app.models.relational import SystemSetting

        async with db_session() as session:
            await _ensure_system_settings_table(session)
            result = await session.execute(select(SystemSetting).where(SystemSetting.key == AI_SETTINGS_KEY))
            record = result.scalar_one_or_none()
            if not record or not isinstance(record.value, dict):
                return None
            from .credential_store import protect_credentials, reveal_credentials
            merged = merge_ai_settings(reveal_credentials(record.value))
            protected = protect_credentials(merged, previous=record.value)
            if record.value != protected:
                record.value = protected
                await session.commit()
            AI_SYSTEM_SETTINGS.clear()
            AI_SYSTEM_SETTINGS.update(merged)
            return merged
    except Exception as exc:  # noqa: BLE001 - settings should fall back to env/in-memory
        logger.warning("AI settings DB load failed; using runtime defaults: %s", exc)
        if strict:
            raise RuntimeError("AI 设置读取失败，数据库暂不可用") from exc
        return None


async def save_persisted_ai_settings(settings_data: dict[str, Any], *, updated_by: str | None = None) -> dict[str, Any]:
    from app.core.db import db_session
    from app.models.relational import SystemSetting

    existing = await load_persisted_ai_settings(strict=True)
    merged = merge_ai_settings(settings_data, existing=existing or AI_SYSTEM_SETTINGS)

    async with db_session() as session:
        await _ensure_system_settings_table(session)
        result = await session.execute(select(SystemSetting).where(SystemSetting.key == AI_SETTINGS_KEY))
        record = result.scalar_one_or_none()
        from .credential_store import protect_credentials
        protected = protect_credentials(merged, previous=record.value if record else None)
        if record is None:
            record = SystemSetting(
                key=AI_SETTINGS_KEY,
                value=protected,
                description="AI provider, permission, and runtime settings",
                updated_by=updated_by,
            )
            session.add(record)
        else:
            record.value = protected
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
