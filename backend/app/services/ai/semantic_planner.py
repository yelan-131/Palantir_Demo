"""Model-assisted semantic planning for Agent turns.

The deterministic planner remains the fallback. This module asks the selected
LLM to return a small JSON contract so user wording like "change the form name"
or "add a field" is handled as structured intent instead of brittle slicing.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from .client import get_provider
from .planner import AgentPlan, plan_agent_turn
from .schemas import AIProviderConfig, ChatMessage, ChatOptions

logger = logging.getLogger(__name__)


EXTERNAL_PROVIDER_NAMES = {"openai-compatible", "openai", "azure-openai", "deepseek", "qwen", "glm"}


def _is_model_available(config: AIProviderConfig | None) -> bool:
    return bool(config and config.provider in EXTERNAL_PROVIDER_NAMES and config.api_key)


def _json_object_from_text(text: str) -> dict[str, Any] | None:
    content = (text or "").strip()
    if not content:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        content = fenced.group(1)
    else:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            content = content[start : end + 1]
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _clean_form_name(value: Any) -> str | None:
    name = str(value or "").strip()
    if not name:
        return None
    name = re.sub(r"^(表单名称|表单名|名称|form\s*name)\s*[:：=\-]?\s*", "", name, flags=re.IGNORECASE)
    name = re.sub(r"^(改为|改成|修改为|叫做|叫|命名为)\s*", "", name)
    name = re.sub(r"[。；;，,\s]*(吧|把|哈|呀|哦|呢|可以吗|行吗)$", "", name).strip()
    return name[:80] or None


def _normalize_fields(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    fields: list[dict[str, Any]] = []
    for index, item in enumerate(value[:20]):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or item.get("name") or item.get("field_name") or "").strip()
        if not label:
            continue
        field_name = str(item.get("field_name") or item.get("name") or f"field_{index + 1}").strip()
        field_type = str(item.get("field_type") or item.get("type") or "string").strip().lower()
        fields.append(
            {
                "field_name": field_name or f"field_{index + 1}",
                "label": label[:40],
                "field_type": field_type or "string",
                "required": bool(item.get("required", False)),
            }
        )
    return fields


def _semantic_context(parsed: dict[str, Any]) -> dict[str, Any]:
    extracted: dict[str, Any] = {
        "_semantic_parser": True,
        "semantic_operation": str(parsed.get("operation") or "").strip() or "unknown",
        "semantic_reason": str(parsed.get("reason") or "").strip(),
    }
    form_name = _clean_form_name(parsed.get("formName") or parsed.get("form_name"))
    if form_name:
        extracted["formName"] = form_name
        extracted["form_name"] = form_name
        extracted["form.name"] = form_name
    form_code = str(parsed.get("formCode") or parsed.get("form_code") or "").strip()
    if form_code:
        extracted["formCode"] = form_code
        extracted["form_code"] = form_code
    assembly_kind = str(parsed.get("assemblyKind") or parsed.get("assembly_kind") or "").strip().lower()
    if assembly_kind in {"business", "analysis"}:
        extracted["assemblyKind"] = assembly_kind
    fields = _normalize_fields(parsed.get("fields"))
    if fields:
        extracted["fields"] = fields
    menu = parsed.get("menu")
    if isinstance(menu, dict) and "create" in menu:
        extracted["createMenu"] = bool(menu.get("create"))
    elif "createMenu" in parsed:
        extracted["createMenu"] = bool(parsed.get("createMenu"))
    return extracted


def _recent_user_messages(context: dict[str, Any]) -> list[str]:
    rows = context.get("recentMessages") or context.get("recent_messages") or []
    if not isinstance(rows, list):
        return []
    messages = []
    for row in rows[-8:]:
        if isinstance(row, dict) and row.get("role") == "user" and row.get("content"):
            messages.append(str(row.get("content")))
    return messages


def _pending_summary(context: dict[str, Any]) -> dict[str, Any]:
    pending = context.get("pendingActionState") or context.get("pending_action_state") or {}
    if not isinstance(pending, dict):
        return {}
    slots = pending.get("collected_slots")
    return slots if isinstance(slots, dict) else {}


def _build_prompt(message: str, context: dict[str, Any]) -> list[ChatMessage]:
    system = (
        "You are the semantic planner for an enterprise low-code Agent. "
        "Return JSON only. Do not execute tools. "
        "Understand the user's Chinese or English wording and convert it into an action plan. "
        "Supported skill: low_code.create_form_definition. "
        "Operations: create_form, rename_form, add_field, update_field, remove_field, confirm, qa. "
        "If the user changes a form name, fill formName only and do not invent fields. "
        "If the user adds fields, fill fields and keep formName empty unless explicitly changed. "
        "Clean polite/modal particles from names, such as 吧, 把, 哈, 呀, 哦, 呢. "
        "Classify assemblyKind as business for data-entry/workflow forms, analysis for dashboards/reports/BI/analytics. "
        "Return schema: "
        "{\"intent\":\"qa|action\",\"skill\":\"low_code.create_form_definition|null\","
        "\"operation\":\"create_form|rename_form|add_field|update_field|remove_field|confirm|qa\","
        "\"assemblyKind\":\"business|analysis\","
        "\"formName\":\"\",\"formCode\":\"\",\"fields\":[{\"field_name\":\"snake_case\",\"label\":\"字段名\","
        "\"field_type\":\"string|number|text|enum|date|datetime|boolean|json\",\"required\":false}],"
        "\"menu\":{\"create\":true},\"confidence\":0.0,\"reason\":\"short\"}."
    )
    user_payload = {
        "current_message": message,
        "recent_user_messages": _recent_user_messages(context),
        "pending_slots": _pending_summary(context),
        "page": context.get("page") or context.get("currentPage") or context.get("surface"),
    }
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=json.dumps(user_payload, ensure_ascii=False)),
    ]


async def plan_agent_turn_semantic(
    message: str,
    context: dict[str, Any] | None = None,
    *,
    provider_config: AIProviderConfig | None = None,
    usage_sink: Callable[[dict[str, Any]], None] | None = None,
) -> AgentPlan:
    context = context or {}
    fallback = plan_agent_turn(message, context)
    if not _is_model_available(provider_config):
        return fallback

    try:
        semantic_config = provider_config.model_copy(
            update={"timeout_seconds": min(int(provider_config.timeout_seconds or 30), 8)}
        )
        provider = get_provider(semantic_config)
        result = await provider.chat(
            _build_prompt(message, context),
            ChatOptions(model=semantic_config.reasoning_model or semantic_config.chat_model, temperature=0.0, max_tokens=900),
        )
    except Exception:
        return fallback

    if usage_sink and result.usage:
        try:
            usage_sink(result.usage)
        except Exception:  # noqa: BLE001 - budget accounting must not break planning
            logger.exception("Semantic planner usage_sink failed")

    parsed = _json_object_from_text(result.content)
    if not parsed:
        return fallback
    if str(parsed.get("intent") or "").lower() != "action":
        return fallback
    if str(parsed.get("skill") or "") != "low_code.create_form_definition":
        return fallback

    extracted = _semantic_context(parsed)
    if not any(key in extracted for key in ("formName", "fields", "createMenu")):
        return fallback
    confidence = parsed.get("confidence", 0.84)
    try:
        confidence_value = float(confidence)
    except (TypeError, ValueError):
        confidence_value = 0.84
    return AgentPlan(
        intent="action",
        skill="low_code.create_form_definition",
        source_message=message,
        confidence=max(0.0, min(1.0, confidence_value)),
        reason=f"llm_semantic:{extracted.get('semantic_operation') or 'action'}",
        extracted_context=extracted,
    )
