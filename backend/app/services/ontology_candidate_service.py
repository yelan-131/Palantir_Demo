"""Candidate generation for the Object & Relation Center."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relational import DataSourceMetadata, OntologyCandidate, OntologyObject


OBJECT_ALIASES: dict[str, list[str]] = {
    "Equipment": ["equipment", "equip", "device", "machine", "asset", "eqp", "plc"],
    "WorkOrder": ["work_order", "workorder", "wo", "job_order", "production_order"],
    "Material": ["material", "item", "part", "sku"],
    "MaterialBatch": ["batch", "lot", "material_lot", "inventory_lot"],
    "Supplier": ["supplier", "vendor"],
    "Customer": ["customer", "client"],
    "QualityEvent": ["quality", "defect", "nonconformance", "complaint", "inspection"],
    "CAPA": ["capa", "corrective", "containment"],
    "ProductionLine": ["line", "production_line"],
}

FIELD_ALIASES: dict[str, list[str]] = {
    "code": ["code", "no", "number", "id", "sn", "编号", "编码"],
    "name": ["name", "title", "名称", "标题"],
    "status": ["status", "state", "状态"],
    "createdAt": ["created_at", "create_time", "created", "发生时间"],
    "owner": ["owner", "handler", "assignee", "负责人"],
    "level": ["level", "severity", "priority", "等级"],
}


def normalize_code(value: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+", value)
    words = [p for p in parts if p]
    if not words:
        return "Object"
    return "".join(word[:1].upper() + word[1:] for word in words)


def lower_tokens(value: str) -> set[str]:
    return {token for token in re.split(r"[^a-z0-9]+", value.lower()) if token}


def infer_object_code(entity_name: str, source_type: str = "") -> tuple[str, float, list[str]]:
    raw = entity_name.lower()
    tokens = lower_tokens(raw)
    best = (normalize_code(entity_name), 0.55, ["fallback: normalized entity name"])
    for object_code, aliases in OBJECT_ALIASES.items():
        for alias in aliases:
            alias_tokens = lower_tokens(alias)
            if alias in raw or alias_tokens.intersection(tokens):
                score = 0.9 if alias in raw else 0.74
                if source_type.lower() in {"mes", "iot", "plc", "scada"} and object_code in {"Equipment", "WorkOrder", "ProductionLine"}:
                    score += 0.04
                if source_type.lower() in {"erp", "wms"} and object_code in {"Material", "MaterialBatch", "Supplier"}:
                    score += 0.04
                if source_type.lower() in {"qms"} and object_code in {"QualityEvent", "CAPA"}:
                    score += 0.04
                return object_code, min(score, 0.98), [f"matched alias '{alias}' from {source_type or 'source'}"]
    return best


def infer_field_code(field_name: str) -> tuple[str, float, list[str]]:
    raw = field_name.lower()
    tokens = lower_tokens(raw)
    for field_code, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            alias_tokens = lower_tokens(alias)
            if alias.lower() in raw or alias_tokens.intersection(tokens):
                return field_code, 0.86, [f"matched field alias '{alias}'"]
    return field_name, 0.62, ["fallback: source field name"]


async def generate_candidates_from_metadata(
    db: AsyncSession,
    *,
    tenant_id: int,
    source_id: int | None = None,
) -> list[OntologyCandidate]:
    query = select(DataSourceMetadata).where(DataSourceMetadata.tenant_id == tenant_id)
    if source_id is not None:
        query = query.where(DataSourceMetadata.source_id == source_id)
    rows = (await db.execute(query.order_by(DataSourceMetadata.source_id, DataSourceMetadata.entity_name))).scalars().all()
    existing_objects = {
        obj.code: obj
        for obj in (await db.execute(select(OntologyObject).where(OntologyObject.tenant_id == tenant_id))).scalars().all()
    }
    generated: list[OntologyCandidate] = []

    for row in rows:
        object_code, confidence, evidence = infer_object_code(row.entity_name, row.source_type)
        candidate = await upsert_candidate(
            db,
            tenant_id=tenant_id,
            candidate_type="object",
            candidate_key=f"metadata:{row.source_id}:{row.entity_name}:object:{object_code}",
            title=f"{row.entity_label or row.entity_name} -> {object_code}",
            payload={
                "object": {
                    "code": object_code,
                    "name": existing_objects.get(object_code).name if object_code in existing_objects else object_code,
                    "domain": "manufacturing",
                    "description": f"Generated from {row.source_type} metadata entity {row.entity_name}.",
                    "source_type": row.source_type,
                    "source_ref": f"data_source:{row.source_id}:{row.entity_name}",
                },
                "merge_target_id": existing_objects.get(object_code).id if object_code in existing_objects else None,
                "source": {"source_id": row.source_id, "entity_name": row.entity_name, "source_type": row.source_type},
                "evidence": evidence,
            },
            confidence=confidence,
            source_type="metadata",
            source_ref=f"data_source:{row.source_id}:{row.entity_name}",
        )
        generated.append(candidate)

        for field in row.fields or []:
            source_field = str(field.get("name") or "")
            if not source_field:
                continue
            field_code, field_confidence, field_evidence = infer_field_code(source_field)
            generated.append(await upsert_candidate(
                db,
                tenant_id=tenant_id,
                candidate_type="mapping",
                candidate_key=f"metadata:{row.source_id}:{row.entity_name}:{source_field}:mapping:{object_code}.{field_code}",
                title=f"{row.entity_name}.{source_field} -> {object_code}.{field_code}",
                payload={
                    "mapping": {
                        "source_system": str(row.source_id),
                        "source_type": row.source_type,
                        "source_entity": row.entity_name,
                        "source_field": source_field,
                        "source_field_type": field.get("type"),
                        "target_object_code": object_code,
                        "target_field_code": field_code,
                        "evidence": "; ".join(field_evidence),
                    },
                    "field": {
                        "object_code": object_code,
                        "code": field_code,
                        "name": str(field.get("label") or source_field),
                        "field_type": str(field.get("type") or "string"),
                        "source_type": row.source_type,
                        "source_ref": f"data_source:{row.source_id}:{row.entity_name}.{source_field}",
                    },
                    "source": {"source_id": row.source_id, "entity_name": row.entity_name, "field_name": source_field},
                    "evidence": field_evidence,
                },
                confidence=min(confidence, field_confidence),
                source_type="metadata",
                source_ref=f"data_source:{row.source_id}:{row.entity_name}.{source_field}",
            ))

        for rel in row.relationships or []:
            target_entity = str(rel.get("target_entity") or rel.get("target_table") or "")
            if not target_entity:
                continue
            target_code, rel_confidence, rel_evidence = infer_object_code(target_entity, row.source_type)
            relation_type = str(rel.get("relation_type") or "REFERENCES")
            generated.append(await upsert_candidate(
                db,
                tenant_id=tenant_id,
                candidate_type="relation",
                candidate_key=f"metadata:{row.source_id}:{row.entity_name}:{target_entity}:relation:{relation_type}",
                title=f"{object_code} {relation_type} {target_code}",
                payload={
                    "relation": {
                        "code": f"{object_code}_{relation_type}_{target_code}",
                        "name": f"{object_code} {relation_type} {target_code}",
                        "relation_type": relation_type,
                        "source_object_code": object_code,
                        "target_object_code": target_code,
                        "description": str(rel.get("description") or ""),
                        "source_type": row.source_type,
                        "source_ref": f"data_source:{row.source_id}:{row.entity_name}",
                    },
                    "source": {"source_id": row.source_id, "entity_name": row.entity_name, "target_entity": target_entity},
                    "evidence": rel_evidence,
                },
                confidence=min(confidence, rel_confidence),
                source_type="metadata",
                source_ref=f"data_source:{row.source_id}:{row.entity_name}",
            ))

    await db.flush()
    return generated


async def upsert_candidate(
    db: AsyncSession,
    *,
    tenant_id: int,
    candidate_type: str,
    candidate_key: str,
    title: str,
    payload: dict[str, Any],
    confidence: float,
    source_type: str,
    source_ref: str | None,
) -> OntologyCandidate:
    existing = await db.scalar(
        select(OntologyCandidate).where(
            OntologyCandidate.tenant_id == tenant_id,
            OntologyCandidate.candidate_key == candidate_key,
        )
    )
    if existing:
        if existing.status in {"pending_review", "rejected"}:
            existing.title = title
            existing.payload = payload
            existing.confidence = confidence
            existing.source_type = source_type
            existing.source_ref = source_ref
            if existing.status == "rejected":
                existing.status = "pending_review"
        return existing
    candidate = OntologyCandidate(
        tenant_id=tenant_id,
        candidate_type=candidate_type,
        candidate_key=candidate_key,
        title=title,
        payload=payload,
        confidence=confidence,
        source_type=source_type,
        source_ref=source_ref,
        status="pending_review",
        merge_target_id=payload.get("merge_target_id"),
    )
    db.add(candidate)
    return candidate
