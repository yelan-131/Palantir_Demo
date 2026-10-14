"""Resolve Agent draft actions to platform dynamic-record drafts when possible."""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id
from app.core.permissions import has_form_permission
from app.models.relational import Form, FormField


SKILL_FORM_CANDIDATES = {
    "forms.create_record_draft": [],
    "maintenance.create_work_order_draft": ["work-order", "work_order", "maintenance-order", "alert-center"],
    "supply.create_purchase_request_draft": ["purchase-request", "purchase_request", "risk-review"],
    "material.create_material_application_draft": ["material-application"],
    "quality.create_capa_draft": ["capa", "capa-draft", "quality-capa", "quality-event"],
}


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _payload_target_codes(payload: dict[str, Any]) -> list[str]:
    explicit = payload.get("target_form_code") or payload.get("form_code")
    contract = payload.get("_contract") if isinstance(payload.get("_contract"), dict) else {}
    contract_target = contract.get("target_form_code")
    return [str(item) for item in [explicit, contract_target] if item]


async def resolve_dynamic_record_form(
    session: AsyncSession,
    *,
    tenant_id: int,
    skill: str,
    payload: dict[str, Any],
) -> Form | None:
    candidates = [*_payload_target_codes(payload), *SKILL_FORM_CANDIDATES.get(skill, [])]
    if not candidates:
        return None
    forms = (
        await session.execute(
            select(Form).where(Form.tenant_id == tenant_id).order_by(Form.id.desc())
        )
    ).scalars().all()
    normalized_candidates = [_normalize(item) for item in candidates if item]
    required_fields = set()
    contract = payload.get("_contract") if isinstance(payload.get("_contract"), dict) else {}
    if isinstance(contract.get("required"), list):
        required_fields = {_normalize(str(item)) for item in contract["required"]}
    fields_by_form: dict[int, set[str]] = {}
    if required_fields:
        all_fields = (
            await session.execute(
                select(FormField).where(
                    FormField.tenant_id == tenant_id,
                    FormField.form_id.in_([form.id for form in forms]),
                    FormField.archived.is_(False),
                )
            )
        ).scalars().all()
        for field in all_fields:
            fields_by_form.setdefault(field.form_id, set()).add(_normalize(str(field.field_name or field.label or "")))

    best_form: Form | None = None
    best_score = 0
    for form in forms:
        if skill == "material.create_material_application_draft" and form.code != "material-application":
            continue
        haystacks = [
            _normalize(str(form.code or "")),
            _normalize(str(form.table_name or "")),
            _normalize(str(form.name or "")),
        ]
        score = 0
        for candidate in normalized_candidates:
            if not candidate:
                continue
            for haystack in haystacks:
                if candidate == haystack:
                    score = max(score, 100)
                elif haystack.startswith(candidate):
                    score = max(score, 80)
                elif candidate in haystack:
                    score = max(score, 50)
                elif haystack in candidate:
                    score = max(score, 10)
        if required_fields:
            field_matches = len(required_fields.intersection(fields_by_form.get(form.id, set())))
            score += field_matches * 15
        if score > best_score:
            best_score = score
            best_form = form
    return best_form


def _pick_payload_value(payload: dict[str, Any], field: FormField) -> Any:
    nested_data = payload.get("record.data") or payload.get("data") or payload.get("record")
    if isinstance(nested_data, dict) and nested_data is not payload:
        nested_value = _pick_payload_value(nested_data, field)
        if nested_value not in (None, "", [], {}):
            return nested_value
    keys = [
        field.field_name,
        field.field_name.replace("_", "-"),
        field.label,
    ]
    for key in keys:
        if key in payload and payload[key] not in (None, "", [], {}):
            return payload[key]
    lowered_label = str(field.label or "").lower()
    for key, value in payload.items():
        if key.startswith("_") or value in (None, "", [], {}):
            continue
        if _normalize(str(key)) == _normalize(field.field_name) or (lowered_label and lowered_label in str(key).lower()):
            return value
    if field.required:
        if field.field_type in {"json", "array"}:
            return {}
        return str(payload.get("source_message") or "Pending action review")[:240]
    return field.default_value


async def create_dynamic_record_draft_from_agent(
    session: AsyncSession,
    *,
    user: dict[str, Any],
    skill: str,
    payload: dict[str, Any],
    evidence: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    tenant_id = current_tenant_id(user)
    form = await resolve_dynamic_record_form(session, tenant_id=tenant_id, skill=skill, payload=payload)
    if not form:
        return None
    if not await has_form_permission(user, form.id, "create", session):
        raise HTTPException(status_code=403, detail="Form create permission denied")

    from app.services.records import runtime_fields, create_record
    from app.api.forms import DynamicRecordCreate
    fields = await runtime_fields(session, form)
    data = {}
    for field in fields:
        if field.archived:
            continue
        value = _pick_payload_value(payload, field)
        if value not in (None, "", [], {}):
            data[field.field_name] = value
    response = await create_record(form.id, DynamicRecordCreate(data=data, status="draft"),
        session, user, draft=True, source="ai_agent_confirmation")
    record = response["data"]
    return {"record_id": record["id"], "form_id": form.id, "form_code": form.code,
        "form_name": form.name, "status": record["status"], "data": record["data"]}
