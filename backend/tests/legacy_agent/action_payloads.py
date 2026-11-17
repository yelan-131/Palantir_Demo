"""Build draft action payloads from external Agent action contracts."""

from __future__ import annotations

from typing import Any

from .action_guidance import describe_action_contract


ACTION_TITLES = {
    "forms.create_record_draft": "Form record draft",
    "maintenance.create_work_order_draft": "Maintenance work order draft",
    "supply.create_purchase_request_draft": "Purchase request draft",
    "material.create_material_application_draft": "Material application draft",
    "quality.create_capa_draft": "CAPA draft",
    "low_code.add_form_field": "Add low-code form field",
}


def _slot_value(slots: dict[str, Any], slot: str) -> Any:
    if slot in slots and slots[slot] not in (None, "", [], {}):
        return slots[slot]
    aliases = {
        "problem_or_risk": ["problem", "risk", "issue"],
        "priority_or_window": ["priority", "window", "due_date"],
        "owner_or_due_date": ["owner", "due_date"],
        "item": ["material", "part", "object"],
        "form.id|form.code": ["form_id", "formId", "form_code", "formCode", "form"],
        "record.data": ["data", "record", "values", "fields"],
    }
    for alias in aliases.get(slot, []):
        if alias in slots and slots[alias] not in (None, "", [], {}):
            return slots[alias]
    return None


def build_contract_action_payload(
    skill: str,
    *,
    slots: dict[str, Any] | None = None,
    source_message: str = "",
) -> dict[str, Any]:
    """Create a conservative payload using the skill contract as schema."""

    contract = describe_action_contract(skill)
    required = [str(item) for item in contract.get("required") or []]
    slots = slots or {}
    payload: dict[str, Any] = {}
    for slot in required:
        value = _slot_value(slots, slot)
        if value is not None:
            payload[slot] = value
    payload["_contract"] = {
        "skill": skill,
        "tool": contract.get("tool") or "",
        "required": required,
        "source": "agent_action_contract",
    }
    for key in ("_source_draft_id", "_resume_draft_id"):
        if key in slots:
            payload[key] = slots[key]
    if source_message:
        payload["source_message"] = source_message
    return payload


def action_title(skill: str) -> str:
    return ACTION_TITLES.get(skill, skill)
