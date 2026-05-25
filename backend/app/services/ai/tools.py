"""Business skill registry for the first AI Agent MVP."""

from __future__ import annotations

from typing import Any

from .policies import apply_policy
from .schemas import SkillAction


def create_work_order_draft(evidence: list[dict[str, Any]] | None = None) -> SkillAction:
    return apply_policy(SkillAction(
        skill="maintenance.create_work_order_draft",
        title="Maintenance work order draft",
        payload={
            "equipment": "CNC-17 spindle",
            "priority": "high",
            "suggested_window": "within 48 hours",
            "risk_signal": "health score 68, vibration rising",
        },
        evidence=evidence or [],
    ))


def create_purchase_request_draft(evidence: list[dict[str, Any]] | None = None) -> SkillAction:
    return apply_policy(SkillAction(
        skill="supply.create_purchase_request_draft",
        title="Purchase request draft",
        payload={
            "material": "M-0042 critical spare part",
            "quantity": "200 pcs",
            "reason": "projected below safety stock in 5 days",
            "recommended_supplier": "East China Precision",
        },
        evidence=evidence or [],
    ))


def create_material_application_draft(evidence: list[dict[str, Any]] | None = None) -> SkillAction:
    return apply_policy(SkillAction(
        skill="material.create_material_application_draft",
        title="Material application draft",
        payload={
            "line": "Assembly Line 2",
            "material_code": "MAT-2188",
            "quantity": "36 sets",
            "usage": "rework and supplemental issue",
        },
        evidence=evidence or [],
    ))


def create_capa_draft(evidence: list[dict[str, Any]] | None = None) -> SkillAction:
    return apply_policy(SkillAction(
        skill="quality.create_capa_draft",
        title="CAPA draft",
        payload={
            "problem": "defect rate increased for 3 consecutive shifts",
            "containment": "isolate related batches and increase inspection frequency",
            "suspected_root_cause": "material batch or process parameter drift",
        },
        evidence=evidence or [],
    ))


def choose_draft_actions(message: str, evidence: list[dict[str, Any]] | None = None) -> list[SkillAction]:
    text = message.lower()
    wants_draft = any(token in text for token in ["draft", "草稿", "生成", "申请", "工单", "capa"])
    if not wants_draft:
        return []

    actions: list[SkillAction] = []
    if any(token in text for token in ["maintenance", "work order", "维修", "工单", "设备"]):
        actions.append(create_work_order_draft(evidence))
    if any(token in text for token in ["purchase", "采购"]):
        actions.append(create_purchase_request_draft(evidence))
    if any(token in text for token in ["material", "物料", "料号", "领料"]):
        actions.append(create_material_application_draft(evidence))
    if any(token in text for token in ["quality", "capa", "质量", "缺陷"]):
        actions.append(create_capa_draft(evidence))
    return actions

