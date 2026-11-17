"""Business skill registry for the first AI Agent MVP."""

from __future__ import annotations

from typing import Any

from .action_payloads import action_title, build_contract_action_payload
from app.services.ai.low_code_tools import build_low_code_form_payload
from app.services.ai.policies import apply_policy
from app.services.ai.schemas import SkillAction


def create_contract_draft_action(
    skill: str,
    *,
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    source_message: str = "",
) -> SkillAction:
    return apply_policy(SkillAction(
        skill=skill,
        title=action_title(skill),
        payload=build_contract_action_payload(skill, slots=context or {}, source_message=source_message),
        evidence=evidence or [],
    ))


def create_form_record_draft(
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    source_message: str = "",
) -> SkillAction:
    return create_contract_draft_action(
        "forms.create_record_draft",
        evidence=evidence,
        context=context,
        source_message=source_message,
    )


def create_work_order_draft(
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    source_message: str = "",
) -> SkillAction:
    return create_contract_draft_action(
        "maintenance.create_work_order_draft",
        evidence=evidence,
        context=context,
        source_message=source_message,
    )


def create_purchase_request_draft(
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    source_message: str = "",
) -> SkillAction:
    return create_contract_draft_action(
        "supply.create_purchase_request_draft",
        evidence=evidence,
        context=context,
        source_message=source_message,
    )


def create_material_application_draft(
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    source_message: str = "",
) -> SkillAction:
    return create_contract_draft_action(
        "material.create_material_application_draft",
        evidence=evidence,
        context=context,
        source_message=source_message,
    )


def create_capa_draft(
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    source_message: str = "",
) -> SkillAction:
    return create_contract_draft_action(
        "quality.create_capa_draft",
        evidence=evidence,
        context=context,
        source_message=source_message,
    )


def create_low_code_form_definition_action(
    message: str,
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
) -> SkillAction:
    return apply_policy(SkillAction(
        skill="low_code.create_form_definition",
        title="Low-code form creation plan",
        mode="confirmed_write",
        risk_level="high",
        payload=build_low_code_form_payload(message, context),
        evidence=evidence or [],
    ))


def choose_draft_actions(
    message: str,
    evidence: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
) -> list[SkillAction]:
    text = message.lower()
    wants_low_code_form = (
        any(token in text for token in ["form", "low-code", "low code", "table", "\u8868\u5355"])
        and any(token in text for token in ["create", "new", "build", "\u65b0\u5efa", "\u521b\u5efa", "\u751f\u6210"])
    )
    wants_draft = wants_low_code_form or any(
        token in text
        for token in ["draft", "\u8349\u7a3f", "\u751f\u6210", "\u7533\u8bf7", "\u5de5\u5355", "capa"]
    )
    if not wants_draft:
        return []

    actions: list[SkillAction] = []
    if wants_low_code_form:
        actions.append(create_low_code_form_definition_action(message, evidence, context))
    if any(token in text for token in ["create record", "new record", "\u65b0\u5efa\u6570\u636e", "\u521b\u5efa\u8bb0\u5f55", "\u65b0\u589e\u6570\u636e"]):
        actions.append(create_form_record_draft(evidence, context, message))
    if any(token in text for token in ["maintenance", "work order", "\u7ef4\u4fee", "\u5de5\u5355", "\u8bbe\u5907"]):
        actions.append(create_work_order_draft(evidence, context, message))
    if any(token in text for token in ["purchase", "\u91c7\u8d2d"]):
        actions.append(create_purchase_request_draft(evidence, context, message))
    if any(token in text for token in ["material", "\u7269\u6599", "\u6599\u53f7", "\u9886\u6599"]):
        actions.append(create_material_application_draft(evidence, context, message))
    if any(token in text for token in ["quality", "capa", "\u8d28\u91cf", "\u7f3a\u9677"]):
        actions.append(create_capa_draft(evidence, context, message))
    return actions
