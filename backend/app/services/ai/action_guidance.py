"""Guidance gates before an Agent proposes side-effect actions."""

from __future__ import annotations

import re
from typing import Any

from .agent_definition import load_action_contracts
from .low_code_tools import describe_add_form_field_contract, describe_create_form_definition_contract, has_minimum_form_requirements


def describe_action_contract(skill: str) -> dict[str, Any]:
    contracts = {
        "low_code.create_form_definition": describe_create_form_definition_contract(),
        "low_code.add_form_field": describe_add_form_field_contract(),
        **load_action_contracts(),
    }
    return contracts.get(skill, {"tool": skill, "required": [], "questions": [], "example": ""})


def _text_from_context(context: dict[str, Any]) -> str:
    parts = []
    for key in ("message", "currentPage", "selectedText", "summary"):
        if context.get(key):
            parts.append(str(context[key]))
    for row in context.get("recentMessages") or context.get("recent_messages") or []:
        if isinstance(row, dict) and row.get("content"):
            parts.append(str(row["content"]))
    return "\n".join(parts)


def _has_quantity(text: str) -> bool:
    return bool(re.search(r"\d+\s*(件|个|套|pcs|kg|箱|台|小时|天|周)?", text, flags=re.IGNORECASE))


def has_minimum_action_requirements(skill: str, message: str, context: dict[str, Any] | None = None) -> bool:
    context = context or {}
    if skill == "low_code.create_form_definition":
        return has_minimum_form_requirements(context)

    text = f"{message}\n{_text_from_context(context)}".lower()
    contract = describe_action_contract(skill)
    slot_terms = contract.get("slot_terms") or {}
    if isinstance(slot_terms, dict) and slot_terms:
        return all(
            any(str(token).lower() in text for token in terms)
            for terms in slot_terms.values()
            if isinstance(terms, list)
        )
    if "quantity" in contract.get("required", []):
        return _has_quantity(text)
    return True


def build_action_guidance_answer(skill: str, *, assistant_name: str = "AI Agent") -> str:
    contract = describe_action_contract(skill)
    questions = contract.get("questions") or []
    required = contract.get("required") or []
    lines = [
        f"可以，{assistant_name} 会先查看对应 skill/tool 合约，把关键参数问清楚，再给你确认清单；确认前不会写入或提交业务流程。",
        "",
        f"当前动作：`{skill}`",
        f"调用合约：`{contract.get('tool') or skill}`",
    ]
    lines[0] = f"可以，{assistant_name} 会先不直接生成可确认动作，而是查看对应 skill/tool 合约，把关键参数问清楚，再给你确认清单；确认前不会写入或提交业务流程。"
    if required:
        lines.append(f"关键参数：{', '.join(str(item) for item in required)}")
    if questions:
        lines.append("")
        lines.append("请先补充：")
        lines.extend(f"{index}. {question}" for index, question in enumerate(questions, start=1))
    if contract.get("example"):
        lines.append("")
        lines.append(f"你可以这样回复：{contract['example']}")
    return "\n".join(lines)
