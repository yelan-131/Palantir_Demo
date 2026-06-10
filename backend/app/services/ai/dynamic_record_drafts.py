"""Resolve Agent draft actions to platform dynamic-record drafts when possible."""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id
from app.api._model_driven_shared import assert_safe_identifier
from app.core.audit import write_audit_log
from app.core.permissions import has_form_permission
from app.models.relational import DynamicRecord, Form, FormField, FormVersion


SKILL_FORM_CANDIDATES = {
    "forms.create_record_draft": [],
    "maintenance.create_work_order_draft": ["work-order", "work_order", "maintenance-order", "alert-center"],
    "supply.create_purchase_request_draft": ["purchase-request", "purchase_request", "risk-review"],
    "material.create_material_application_draft": ["material-application", "material_application", "risk-review"],
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
            select(Form).where(Form.tenant_id == tenant_id)
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

    fields = (
        await session.execute(
            select(FormField)
            .where(FormField.form_id == form.id, FormField.tenant_id == tenant_id, FormField.archived.is_(False))
            .order_by(FormField.sort_order, FormField.id)
        )
    ).scalars().all()
    data: dict[str, Any] = {}
    for field in fields:
        value = _pick_payload_value(payload, field)
        if value not in (None, "", [], {}):
            data[field.field_name] = value
    data["_aiDraft"] = {
        "skill": skill,
        "source": "agent_run_confirmation",
        "evidenceCount": len(evidence or []),
    }
    latest_version = await session.scalar(
        select(FormVersion)
        .where(FormVersion.tenant_id == tenant_id, FormVersion.form_id == form.id)
        .order_by(FormVersion.version.desc())
        .limit(1)
    )
    if form.table_name and str(form.storage_mode or "").lower() in {"physical_table", "business_table"}:
        table_name = str(form.table_name)
        assert_safe_identifier(table_name)
        columns = ["tenant_id", "record_status", "created_by", "updated_by"]
        params: dict[str, Any] = {
            "tenant_id": tenant_id,
            "record_status": "draft",
            "created_by": current_user_id(user),
            "updated_by": current_user_id(user),
        }
        for field in fields:
            if field.archived:
                continue
            column = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", str(field.field_name))
            column = re.sub(r"[^a-z0-9_]+", "_", column.lower()).strip("_")
            if not column:
                continue
            assert_safe_identifier(column)
            columns.append(column)
            params[column] = data.get(field.field_name)
        result = await session.execute(
            text(
                f"INSERT INTO {table_name} ({', '.join(columns)}) "
                f"VALUES ({', '.join(':' + column for column in columns)}) "
                "RETURNING id, created_at, updated_at"
            ),
            params,
        )
        row = result.first()
        await session.commit()
        record_id = int(row.id) if row is not None else 0
        result_payload = {
            "record_id": record_id,
            "form_id": form.id,
            "form_code": form.code,
            "form_name": form.name,
            "status": "draft",
            "data": data,
        }
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="physical_record",
            resource_id=record_id,
            new_values={**result_payload, "createdByAgent": True},
        )
        return result_payload

    record = DynamicRecord(
        tenant_id=tenant_id,
        form_id=form.id,
        model_id=form.model_id,
        data=data,
        schema_version=latest_version.version if latest_version else 1,
        status="draft",
        created_by=current_user_id(user),
        updated_by=current_user_id(user),
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    result = {
        "record_id": record.id,
        "form_id": form.id,
        "form_code": form.code,
        "form_name": form.name,
        "status": record.status,
        "data": record.data,
    }
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="create",
        resource_type="dynamic_record",
        resource_id=record.id,
        new_values={**result, "createdByAgent": True},
    )
    return result
