"""Guidance gates before an Agent proposes side-effect actions."""

from __future__ import annotations

import re
from typing import Any

from app.services.ai.agent_definition import load_action_contracts
from app.services.ai.low_code_tools import (
    describe_add_form_field_contract,
    describe_create_form_definition_contract,
    has_minimum_form_requirements,
)


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
    return bool(re.search(r"\d+\s*(?:件|个|台|套|pcs?|kg|千克|吨|小时|天)", text, flags=re.IGNORECASE))


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


def _slot_label(slot: str) -> str:
    labels = {
        "form.name": "表单名称",
        "form.code": "表单编码",
        "fields": "字段清单",
        "quantity": "数量",
    }
    return labels.get(slot, slot)


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", "", value).strip("，。；;:：、 ")


def _clean_form_name(value: str) -> str:
    candidate = re.sub(
        r"^(那你能帮我|你能帮我|帮我|请|麻烦|给我|为我|新建|创建|建立|生成|设计|配置|做|一个|1个)+",
        "",
        value or "",
    )
    candidate = re.sub(r"(表单|清单|页面)$", "", candidate)
    return _compact_text(candidate)


def _guess_form_name_from_message(message: str) -> str | None:
    text = (message or "").strip()
    if not text:
        return None
    patterns = [
        r"(?:新建|创建|建立|生成|设计|配置|做)(?:一个|1个)?\s*(.+?)(?:表单|清单|页面)",
        r"(.+?)(?:表单|清单|页面)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1)
        candidate = _clean_form_name(candidate)
        if 2 <= len(candidate) <= 40:
            return candidate
    return None


def _known_form_name(action_state: dict[str, Any]) -> str | None:
    slots = action_state.get("collected_slots") if isinstance(action_state.get("collected_slots"), dict) else {}
    for key in ("formName", "form_name", "form.name"):
        value = slots.get(key)
        if value:
            candidate = _clean_form_name(str(value))
            if candidate:
                return candidate
    return _guess_form_name_from_message(str(action_state.get("source_message") or ""))


def _build_low_code_form_guidance(
    *,
    assistant_name: str,
    action_state: dict[str, Any] | None,
    contract: dict[str, Any],
) -> str:
    action_state = action_state or {}
    missing = [str(item) for item in action_state.get("missing_slots") or []]
    if not missing:
        missing = [str(item) for item in contract.get("required") or []]
    missing_labels = "、".join(_slot_label(item) for item in missing) or "必要信息"
    form_name = _known_form_name(action_state)

    lines: list[str] = []
    if form_name:
        lines.append(f"可以，我已经识别到你想创建「{form_name}」表单。")
    else:
        lines.append("可以，我会先把这个表单创建请求整理成可确认的配置草稿。")

    lines.append("先不直接生成可确认动作，我会先补齐关键配置。")
    lines.append(f"现在还不能进入确认，因为还缺少：{missing_labels}。")
    lines.append("")

    if "fields" in missing and len(missing) == 1:
        lines.append("请直接补充字段清单，最好顺手标出哪些字段必填。")
        example_name = form_name or "物料主数据"
        lines.append(
            "例如：字段：物料编码、物料名称、物料类型、规格型号、计量单位、安全库存、状态；"
            f"物料编码和物料名称必填；创建菜单入口：{example_name}。"
        )
    else:
        questions: list[str] = []
        if "form.name" in missing:
            questions.append("表单名称是什么？")
        if "form.code" in missing:
            questions.append("是否指定表单编码？不指定的话我可以按名称生成。")
        if "fields" in missing:
            questions.append("需要哪些字段？哪些字段必填？")
        if not questions:
            questions = [str(question) for question in contract.get("questions") or []]
        if questions:
            lines.append("请先补充：")
            lines.extend(f"{index}. {question}" for index, question in enumerate(questions, start=1))

    lines.append("")
    lines.append(f"收到后，{assistant_name} 会继续整理确认清单；确认前不会写入系统。")
    return "\n".join(lines)


def build_action_guidance_answer(
    skill: str,
    *,
    assistant_name: str = "AI Agent",
    action_state: dict[str, Any] | None = None,
) -> str:
    contract = describe_action_contract(skill)
    if skill == "low_code.create_form_definition":
        return _build_low_code_form_guidance(
            assistant_name=assistant_name,
            action_state=action_state,
            contract=contract,
        )

    questions = contract.get("questions") or []
    required = [str(item) for item in contract.get("required") or []]
    missing = [
        str(item)
        for item in (action_state or {}).get("missing_slots", [])
    ] or required
    lines = [
        "可以，这个动作需要先补齐关键参数，确认前不会写入或提交业务流程。",
        "",
        f"当前动作：`{skill}`",
    ]
    if missing:
        lines.append(f"还需要：{'、'.join(_slot_label(item) for item in missing)}")
    if questions:
        lines.append("")
        lines.append("请先补充：")
        lines.extend(f"{index}. {question}" for index, question in enumerate(questions, start=1))
    if contract.get("example"):
        lines.append("")
        lines.append(f"你可以这样回复：{contract['example']}")
    return "\n".join(lines)
