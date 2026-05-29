"""Agent analysis helpers for permission-scoped dynamic form records."""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .client import get_provider
from .form_record_tools import query_form_records
from .providers import EXTERNAL_PROVIDERS
from .schemas import AIProviderConfig, ChatMessage, ChatOptions


def _model_is_available(config: AIProviderConfig | None) -> bool:
    if not config:
        return False
    if config.provider in {"local", "mock"}:
        return False
    return config.provider in EXTERNAL_PROVIDERS and bool(config.api_key)


def _stringify_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)[:160]
    return str(value)[:160]


def summarize_form_record_result(query_result: dict[str, Any]) -> dict[str, Any]:
    records = query_result.get("records") or []
    visible_fields = list(query_result.get("visible_fields") or [])
    status_counts = Counter(str(record.get("status") or "unknown") for record in records)
    field_non_empty: dict[str, int] = {field: 0 for field in visible_fields}
    field_top_values: dict[str, list[dict[str, Any]]] = {}
    counters: dict[str, Counter[str]] = {field: Counter() for field in visible_fields}

    for record in records:
        data = record.get("data") if isinstance(record, dict) else {}
        if not isinstance(data, dict):
            continue
        for field in visible_fields:
            value = data.get(field)
            text = _stringify_value(value).strip()
            if text:
                field_non_empty[field] = field_non_empty.get(field, 0) + 1
                counters.setdefault(field, Counter())[text] += 1

    for field, counter in counters.items():
        field_top_values[field] = [{"value": value, "count": count} for value, count in counter.most_common(5)]

    return {
        "form": query_result.get("form") or {},
        "record_count": int(query_result.get("record_count") or len(records)),
        "sample_count": len(records),
        "visible_fields": visible_fields,
        "status_counts": dict(status_counts),
        "field_non_empty": field_non_empty,
        "field_top_values": field_top_values,
    }


def build_form_record_evidence(query_result: dict[str, Any], *, limit: int = 8) -> list[dict[str, Any]]:
    return [
        {
            "source": "forms.query_records",
            "form": query_result.get("form"),
            "record_id": record.get("id"),
            "status": record.get("status"),
            "data": record.get("data"),
        }
        for record in (query_result.get("records") or [])[:limit]
        if isinstance(record, dict)
    ]


def build_local_form_analysis_answer(summary: dict[str, Any], *, can_write: bool = False) -> str:
    form = summary.get("form") or {}
    form_name = form.get("name") or form.get("code") or "\u5f53\u524d\u8868\u5355"
    visible_fields = summary.get("visible_fields") or []
    status_counts = summary.get("status_counts") or {}
    field_non_empty = summary.get("field_non_empty") or {}
    top_complete_fields = sorted(field_non_empty.items(), key=lambda item: item[1], reverse=True)[:5]
    action_hint = (
        "\u5982\u679c\u9700\u8981\u5199\u5165\u6570\u636e\u3001\u4e0b\u8fbe\u6307\u4ee4\u6216\u53d1\u8d77\u6d41\u7a0b\uff0c"
        "\u6211\u4f1a\u5148\u751f\u6210\u8349\u7a3f\u548c\u786e\u8ba4\u6e05\u5355\uff0c\u4e0d\u4f1a\u76f4\u63a5\u6267\u884c\u3002"
    )
    if can_write:
        action_hint = (
            "\u4f60\u6709\u53d1\u8d77\u540e\u7eed\u52a8\u4f5c\u7684 AI \u6388\u6743\uff0c"
            "\u4f46\u5199\u5165\u6216\u6d41\u7a0b\u7c7b\u52a8\u4f5c\u4ecd\u4f1a\u5148\u8fdb\u5165\u8349\u7a3f\u548c\u786e\u8ba4\u3002"
        )
    field_list_text = ", ".join(visible_fields[:12]) if visible_fields else "\u6682\u65e0\u53ef\u89c1\u5b57\u6bb5"
    status_counts_text = json.dumps(status_counts, ensure_ascii=False) if status_counts else "\u6682\u65e0\u72b6\u6001\u6570\u636e"
    complete_fields_text = (
        ", ".join(f"{name}({count})" for name, count in top_complete_fields)
        if top_complete_fields
        else "\u6682\u65e0"
    )
    return "\n".join(
        [
            f"\u5df2\u6309\u6743\u9650\u8bfb\u53d6 `{form_name}` \u7684 {summary.get('record_count', 0)} \u6761\u8bb0\u5f55\uff0c\u672c\u6b21\u7528 {summary.get('sample_count', 0)} \u6761\u53ef\u89c1\u6837\u672c\u505a\u5206\u6790\u3002",
            "",
            "\u521d\u6b65\u89c2\u5bdf\uff1a",
            f"1. \u53ef\u89c1\u5b57\u6bb5\uff1a{field_list_text}",
            f"2. \u72b6\u6001\u5206\u5e03\uff1a{status_counts_text}",
            f"3. \u6570\u636e\u8986\u76d6\u8f83\u9ad8\u7684\u5b57\u6bb5\uff1a{complete_fields_text}",
            "",
            action_hint,
        ]
    )


async def analyze_form_records(
    session: AsyncSession,
    *,
    user: dict[str, Any],
    payload: dict[str, Any],
    question: str,
    provider_config: AIProviderConfig | None,
) -> dict[str, Any]:
    query_result = await query_form_records(session, user=user, payload=payload)
    summary = summarize_form_record_result(query_result)
    evidence = build_form_record_evidence(query_result)
    if not _model_is_available(provider_config):
        return {
            "answer": build_local_form_analysis_answer(summary),
            "summary": summary,
            "query_result": query_result,
            "evidence": evidence,
            "mode": "local_summary",
        }

    provider = get_provider(provider_config)
    messages = [
        ChatMessage(
            role="system",
            content=(
                "You are an enterprise data analysis agent. Analyze only the provided permission-scoped records. "
                "Answer in Chinese. Separate observations, possible causes, and next recommended actions. "
                "Never claim that data was written or workflow was submitted. For writes, say a draft and confirmation are required."
            ),
        ),
        ChatMessage(
            role="user",
            content=json.dumps(
                {
                    "question": question,
                    "summary": summary,
                    "records": query_result.get("records") or [],
                },
                ensure_ascii=False,
                default=str,
            ),
        ),
    ]
    result = await provider.chat(messages, ChatOptions(model=provider_config.chat_model, max_tokens=1200, temperature=0.2))
    return {
        "answer": result.content,
        "summary": summary,
        "query_result": query_result,
        "evidence": evidence,
        "mode": "ai_analysis",
        "usage": result.usage,
        "provider": result.provider,
        "model": result.model,
    }
