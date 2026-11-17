"""Pending action slot-filling state for multi-turn Agent preparation."""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from .action_guidance import describe_action_contract


LABEL_SEPARATOR = r"\s*(?:[:：=]|是|为|-)\s*"
VALUE_UNTIL_SEPARATOR = r"([^，,；;\n。]+)"


def _merge_fields(existing: list[Any], incoming: list[Any]) -> list[Any]:
    output: list[Any] = []
    seen: set[str] = set()
    for item in [*existing, *incoming]:
        if not isinstance(item, dict):
            continue
        key = str(item.get("field_name") or item.get("label") or item.get("name") or len(output))
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


def merge_action_slots(existing: dict[str, Any] | None, incoming: dict[str, Any] | None) -> dict[str, Any]:
    merged = deepcopy(existing or {})
    incoming = incoming or {}
    for key, value in incoming.items():
        if value in (None, "", [], {}):
            continue
        if key == "fields":
            merged["fields"] = _merge_fields(
                merged.get("fields") if isinstance(merged.get("fields"), list) else [],
                value if isinstance(value, list) else [],
            )
        else:
            merged[key] = value
    return merged


def _slot_required_names(skill: str) -> list[str]:
    if skill == "low_code.create_form_definition":
        return ["form.name", "fields"]
    contract = describe_action_contract(skill)
    return [str(item) for item in contract.get("required") or []]


def missing_slots_for_action(skill: str, slots: dict[str, Any]) -> list[str]:
    if skill == "low_code.create_form_definition":
        missing = []
        if not (slots.get("formName") or slots.get("form_name") or slots.get("form.name")):
            missing.append("form.name")
        fields = slots.get("fields")
        if not isinstance(fields, list) or len(fields) < 2:
            missing.append("fields")
        return missing
    return [slot for slot in _slot_required_names(skill) if not slots.get(slot)]


def _label_candidates(slot: str, terms: Any) -> list[str]:
    labels = [slot, slot.replace("_", " "), slot.replace("_", "")]
    if isinstance(terms, list):
        labels.extend(str(term) for term in terms)
    return [label for label in dict.fromkeys(labels) if label]


def _extract_after_label(text: str, labels: list[str]) -> str | None:
    for label in labels:
        pattern = rf"{re.escape(label)}{LABEL_SEPARATOR}{VALUE_UNTIL_SEPARATOR}"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            if value:
                return value
    return None


def _extract_quantity(text: str) -> str | None:
    match = re.search(r"(?<![A-Za-z])(\d+(?:\.\d+)?\s*(?:件|个|套|pcs|kg|箱|台|卷|包))", text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else None


def _infer_low_code_slots_from_text(source_message: str) -> dict[str, Any]:
    text = source_message or ""
    if not text.strip():
        return {}

    name_patterns = [
        r"(?:表单名称|表单名|名称|form\s*name|name)\s*[:：]\s*([^，,；;\n。]+)",
        r"(?:表单名称|表单名|名称)?\s*(?:改为|改成|修改为|命名为|叫做|叫|换成)\s*([^，,；;\n。]+)",
        r"(?:^|[\n。；;])\s*([\u4e00-\u9fa5A-Za-z0-9_\-\s]{2,40}?)(?:[，,；;]\s*)?(?:字段|栏位|信息|内容)",
    ]
    for pattern in name_patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        form_name = match.group(1).strip()
        if "\n" in form_name:
            form_name = [part.strip() for part in form_name.splitlines() if part.strip()][-1]
        form_name = re.sub(r"^(请你|请|麻烦|帮我|给我|为我|建立|新建|创建|设计|生成|做|一个|一张|有关|关于|的)+", "", form_name)
        form_name = re.sub(r"(表单|清单|列表|页面|配置|就好|即可|就行|吧)+$", "", form_name).strip()
        if form_name:
            return {
                "formName": form_name,
                "form_name": form_name,
                "form.name": form_name,
            }
    return {}


def infer_action_slots_from_text(skill: str, source_message: str) -> dict[str, Any]:
    text = source_message or ""
    if not text.strip():
        return {}
    if skill == "low_code.create_form_definition":
        return _infer_low_code_slots_from_text(text)

    contract = describe_action_contract(skill)
    slot_terms = contract.get("slot_terms") or {}
    if not isinstance(slot_terms, dict):
        slot_terms = {}

    inferred: dict[str, Any] = {}
    for slot in _slot_required_names(skill):
        labels = _label_candidates(slot, slot_terms.get(slot))
        value = _extract_after_label(text, labels)
        if not value and slot == "quantity":
            value = _extract_quantity(text)
        if value:
            inferred[slot] = value
    return inferred


def _infer_by_presence(skill: str, source_message: str, slots: dict[str, Any]) -> dict[str, Any]:
    contract = describe_action_contract(skill)
    slot_terms = contract.get("slot_terms") or {}
    if not isinstance(slot_terms, dict):
        return {}
    text = (source_message or "").lower()
    inferred: dict[str, Any] = {}
    for slot, terms in slot_terms.items():
        if slot == "quantity":
            continue
        if slots.get(slot) or not isinstance(terms, list):
            continue
        if any(str(term).lower() in text for term in terms):
            inferred[slot] = source_message
    return inferred


def create_or_update_action_state(
    *,
    existing: dict[str, Any] | None,
    skill: str,
    source_message: str,
    extracted_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    existing = existing if isinstance(existing, dict) and existing.get("skill") == skill else {}
    slots = merge_action_slots(
        existing.get("collected_slots") if isinstance(existing.get("collected_slots"), dict) else {},
        extracted_context or {},
    )
    inferred_from_text = infer_action_slots_from_text(skill, source_message)
    has_semantic_slots = bool((extracted_context or {}).get("_semantic_parser"))
    explicit_slots = {
        key: value
        for key, value in inferred_from_text.items()
        if not slots.get(key)
    } if has_semantic_slots or skill != "low_code.create_form_definition" else inferred_from_text
    slots = merge_action_slots(slots, explicit_slots)
    presence_slots = {
        key: value
        for key, value in _infer_by_presence(skill, source_message, slots).items()
        if not slots.get(key)
    }
    slots = merge_action_slots(slots, presence_slots)

    missing = missing_slots_for_action(skill, slots)
    notes = list(existing.get("notes") or [])
    if source_message and source_message not in notes:
        notes.append(source_message)
    return {
        "status": "ready_for_confirmation" if not missing else "collecting",
        "skill": skill,
        "source_message": source_message or existing.get("source_message") or "",
        "collected_slots": slots,
        "missing_slots": missing,
        "notes": notes[-8:],
    }


def clear_action_state_if_completed(result_requires_confirmation: bool, action_state: dict[str, Any] | None) -> dict[str, Any] | None:
    if not action_state:
        return None
    if result_requires_confirmation:
        return {**action_state, "status": "ready_for_confirmation", "missing_slots": []}
    return action_state
