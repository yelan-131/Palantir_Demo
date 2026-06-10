"""Object & Relation Center persistence and governance services."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.relational import (
    AuditLog,
    Form,
    FormField,
    KnowledgeObjectLink,
    MetaField,
    MetaModel,
    OntologyCandidate,
    OntologyField,
    OntologyMapping,
    OntologyObject,
    OntologyPublishLog,
    OntologyRelation,
    OntologyVersion,
)


def object_payload(obj: OntologyObject) -> dict[str, Any]:
    return {
        "id": str(obj.id),
        "db_id": obj.id,
        "name": obj.name,
        "code": obj.code,
        "domain": obj.domain,
        "source": obj.source_ref or obj.source_type,
        "description": obj.description or "",
        "status": obj.status,
        "version": obj.version,
        "confidence": obj.confidence,
        "review_status": obj.review_status,
        "fields": [
            {
                "id": field.id,
                "name": field.code,
                "label": field.name,
                "code": field.code,
                "type": field.field_type,
                "source_field": field.source_ref,
                "list": field.visible_in_list,
                "form": field.visible_in_form,
                "search": field.searchable,
                "status": field.status,
                "confidence": field.confidence,
            }
            for field in sorted(obj.fields, key=lambda item: item.id)
        ],
    }


def relation_payload(rel: OntologyRelation) -> dict[str, Any]:
    return {
        "id": str(rel.id),
        "db_id": rel.id,
        "code": rel.code,
        "source": rel.source_object_code,
        "target": rel.target_object_code,
        "label": rel.name,
        "type": rel.relation_type,
        "graph": rel.graph_enabled,
        "description": rel.description or "",
        "status": rel.status,
        "version": rel.version,
        "confidence": rel.confidence,
        "review_status": rel.review_status,
        "source_ref": rel.source_ref,
    }


def mapping_payload(mapping: OntologyMapping) -> dict[str, Any]:
    return {
        "id": mapping.id,
        "source_system": mapping.source_system,
        "source_type": mapping.source_type,
        "source_entity": mapping.source_entity,
        "source_field": mapping.source_field,
        "source_field_type": mapping.source_field_type,
        "target_object_code": mapping.target_object_code,
        "target_field_code": mapping.target_field_code,
        "confidence": mapping.confidence,
        "status": mapping.status,
        "evidence": mapping.evidence,
    }


def candidate_payload(candidate: OntologyCandidate) -> dict[str, Any]:
    return {
        "id": candidate.id,
        "candidate_key": candidate.candidate_key,
        "candidate_type": candidate.candidate_type,
        "title": candidate.title,
        "payload": candidate.payload,
        "source_type": candidate.source_type,
        "source_ref": candidate.source_ref,
        "confidence": candidate.confidence,
        "status": candidate.status,
        "merge_target_id": candidate.merge_target_id,
        "review_note": candidate.review_note,
        "created_at": candidate.created_at.isoformat() if candidate.created_at else None,
    }


async def list_published_objects(db: AsyncSession, tenant_id: int) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(OntologyObject)
            .options(selectinload(OntologyObject.fields))
            .where(OntologyObject.tenant_id == tenant_id, OntologyObject.status != "deprecated")
            .order_by(OntologyObject.code)
        )
    ).scalars().all()
    return [object_payload(row) for row in rows]


async def list_published_relations(db: AsyncSession, tenant_id: int) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(OntologyRelation)
            .where(OntologyRelation.tenant_id == tenant_id, OntologyRelation.status != "deprecated")
            .order_by(OntologyRelation.code)
        )
    ).scalars().all()
    return [relation_payload(row) for row in rows]


async def create_or_update_object(
    db: AsyncSession,
    *,
    tenant_id: int,
    data: dict[str, Any],
    actor_id: int | None = None,
    status: str = "published",
) -> OntologyObject:
    code = str(data.get("code") or data.get("name") or "").strip()
    if not code:
        raise ValueError("Ontology object code is required")
    existing = await db.scalar(select(OntologyObject).where(OntologyObject.tenant_id == tenant_id, OntologyObject.code == code))
    now = datetime.now()
    if existing:
        existing.name = str(data.get("name") or existing.name)
        existing.description = data.get("description") if data.get("description") is not None else existing.description
        existing.domain = str(data.get("domain") or existing.domain)
        existing.status = status or existing.status
        existing.review_status = "approved"
        existing.reviewed_by = actor_id
        existing.reviewed_at = now
        existing.updated_by = actor_id
        obj = existing
    else:
        obj = OntologyObject(
            tenant_id=tenant_id,
            code=code,
            name=str(data.get("name") or code),
            domain=str(data.get("domain") or "manufacturing"),
            description=data.get("description"),
            status=status,
            confidence=float(data.get("confidence") or 1),
            source_type=str(data.get("source_type") or "manual"),
            source_ref=data.get("source_ref"),
            review_status="approved",
            reviewed_by=actor_id,
            reviewed_at=now,
            created_by=actor_id,
            updated_by=actor_id,
            metadata_json=data.get("metadata") or {},
        )
        db.add(obj)
        await db.flush()

    for field in data.get("fields") or []:
        await create_or_update_field(db, tenant_id=tenant_id, obj=obj, data=field)
    return obj


async def create_or_update_field(
    db: AsyncSession,
    *,
    tenant_id: int,
    obj: OntologyObject,
    data: dict[str, Any],
) -> OntologyField:
    code = str(data.get("code") or data.get("name") or "").strip()
    if not code:
        raise ValueError("Ontology field code is required")
    existing = await db.scalar(
        select(OntologyField).where(
            OntologyField.tenant_id == tenant_id,
            OntologyField.object_id == obj.id,
            OntologyField.code == code,
        )
    )
    if existing:
        existing.name = str(data.get("name") or data.get("label") or existing.name)
        existing.field_type = str(data.get("field_type") or data.get("type") or existing.field_type)
        existing.searchable = bool(data.get("searchable", existing.searchable))
        existing.visible_in_list = bool(data.get("visible_in_list", data.get("list", existing.visible_in_list)))
        existing.visible_in_form = bool(data.get("visible_in_form", data.get("form", existing.visible_in_form)))
        existing.source_ref = data.get("source_ref") or data.get("source_field") or existing.source_ref
        existing.status = "published"
        return existing
    field = OntologyField(
        tenant_id=tenant_id,
        object_id=obj.id,
        code=code,
        name=str(data.get("name") or data.get("label") or code),
        field_type=str(data.get("field_type") or data.get("type") or "string"),
        required=bool(data.get("required", False)),
        searchable=bool(data.get("searchable", data.get("search", False))),
        sortable=bool(data.get("sortable", False)),
        visible_in_list=bool(data.get("visible_in_list", data.get("list", True))),
        visible_in_form=bool(data.get("visible_in_form", data.get("form", True))),
        status="published",
        confidence=float(data.get("confidence") or 1),
        source_type=str(data.get("source_type") or obj.source_type),
        source_ref=data.get("source_ref") or data.get("source_field"),
        metadata_json=data.get("metadata") or {},
    )
    db.add(field)
    await db.flush()
    return field


async def create_or_update_relation(
    db: AsyncSession,
    *,
    tenant_id: int,
    data: dict[str, Any],
    actor_id: int | None = None,
    status: str = "published",
) -> OntologyRelation:
    code = str(data.get("code") or f"{data.get('source_object_code')}_{data.get('relation_type')}_{data.get('target_object_code')}")
    existing = await db.scalar(select(OntologyRelation).where(OntologyRelation.tenant_id == tenant_id, OntologyRelation.code == code))
    source_obj = await db.scalar(select(OntologyObject).where(OntologyObject.tenant_id == tenant_id, OntologyObject.code == data.get("source_object_code")))
    target_obj = await db.scalar(select(OntologyObject).where(OntologyObject.tenant_id == tenant_id, OntologyObject.code == data.get("target_object_code")))
    now = datetime.now()
    if existing:
        existing.name = str(data.get("name") or existing.name)
        existing.relation_type = str(data.get("relation_type") or existing.relation_type)
        existing.source_object_id = source_obj.id if source_obj else existing.source_object_id
        existing.target_object_id = target_obj.id if target_obj else existing.target_object_id
        existing.source_object_code = str(data.get("source_object_code") or existing.source_object_code)
        existing.target_object_code = str(data.get("target_object_code") or existing.target_object_code)
        existing.description = data.get("description") if data.get("description") is not None else existing.description
        existing.status = status
        existing.review_status = "approved"
        existing.reviewed_by = actor_id
        existing.reviewed_at = now
        return existing
    relation = OntologyRelation(
        tenant_id=tenant_id,
        code=code,
        name=str(data.get("name") or code),
        relation_type=str(data.get("relation_type") or "RELATED_TO"),
        source_object_id=source_obj.id if source_obj else None,
        target_object_id=target_obj.id if target_obj else None,
        source_object_code=str(data.get("source_object_code") or ""),
        target_object_code=str(data.get("target_object_code") or ""),
        description=data.get("description"),
        graph_enabled=bool(data.get("graph_enabled", True)),
        status=status,
        confidence=float(data.get("confidence") or 1),
        source_type=str(data.get("source_type") or "manual"),
        source_ref=data.get("source_ref"),
        review_status="approved",
        reviewed_by=actor_id,
        reviewed_at=now,
        metadata_json=data.get("metadata") or {},
    )
    db.add(relation)
    await db.flush()
    return relation


async def create_or_update_mapping(
    db: AsyncSession,
    *,
    tenant_id: int,
    data: dict[str, Any],
    status: str = "approved",
) -> OntologyMapping:
    target_object = await db.scalar(select(OntologyObject).where(OntologyObject.tenant_id == tenant_id, OntologyObject.code == data.get("target_object_code")))
    target_field = None
    if target_object and data.get("target_field_code"):
        target_field = await db.scalar(
            select(OntologyField).where(
                OntologyField.tenant_id == tenant_id,
                OntologyField.object_id == target_object.id,
                OntologyField.code == data.get("target_field_code"),
            )
        )
    filters = [
        OntologyMapping.tenant_id == tenant_id,
        OntologyMapping.source_system == str(data.get("source_system") or ""),
        OntologyMapping.source_entity == str(data.get("source_entity") or ""),
        OntologyMapping.source_field == str(data.get("source_field") or ""),
        OntologyMapping.target_object_code == str(data.get("target_object_code") or ""),
        OntologyMapping.target_field_code == data.get("target_field_code"),
    ]
    existing = await db.scalar(select(OntologyMapping).where(*filters))
    if existing:
        existing.confidence = float(data.get("confidence") or existing.confidence)
        existing.status = status
        existing.evidence = data.get("evidence") or existing.evidence
        existing.target_object_id = target_object.id if target_object else existing.target_object_id
        existing.target_field_id = target_field.id if target_field else existing.target_field_id
        return existing
    mapping = OntologyMapping(
        tenant_id=tenant_id,
        source_system=str(data.get("source_system") or ""),
        source_type=str(data.get("source_type") or "database"),
        source_entity=str(data.get("source_entity") or ""),
        source_field=str(data.get("source_field") or ""),
        source_field_type=data.get("source_field_type"),
        target_object_id=target_object.id if target_object else None,
        target_field_id=target_field.id if target_field else None,
        target_object_code=str(data.get("target_object_code") or ""),
        target_field_code=data.get("target_field_code"),
        confidence=float(data.get("confidence") or 0),
        status=status,
        evidence=data.get("evidence"),
        metadata_json=data.get("metadata") or {},
    )
    db.add(mapping)
    await db.flush()
    return mapping


async def approve_candidate(
    db: AsyncSession,
    *,
    tenant_id: int,
    candidate_id: int,
    actor_id: int | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    candidate = await db.get(OntologyCandidate, candidate_id)
    if not candidate or candidate.tenant_id != tenant_id:
        raise ValueError("Ontology candidate not found")
    payload = candidate.payload or {}
    created: dict[str, Any] = {}
    if payload.get("object"):
        obj_data = {**payload["object"], "confidence": candidate.confidence}
        if payload.get("field"):
            obj_data.setdefault("fields", []).append(payload["field"])
        obj = await create_or_update_object(db, tenant_id=tenant_id, data=obj_data, actor_id=actor_id)
        created["object"] = object_payload(obj)
    if payload.get("field") and not payload.get("object"):
        object_code = payload["field"].get("object_code")
        obj = await db.scalar(select(OntologyObject).where(OntologyObject.tenant_id == tenant_id, OntologyObject.code == object_code))
        if obj:
            field = await create_or_update_field(db, tenant_id=tenant_id, obj=obj, data={**payload["field"], "confidence": candidate.confidence})
            created["field"] = field.code
    if payload.get("relation"):
        relation = await create_or_update_relation(db, tenant_id=tenant_id, data={**payload["relation"], "confidence": candidate.confidence}, actor_id=actor_id)
        created["relation"] = relation_payload(relation)
    if payload.get("mapping"):
        mapping = await create_or_update_mapping(db, tenant_id=tenant_id, data={**payload["mapping"], "confidence": candidate.confidence}, status="approved")
        created["mapping"] = mapping_payload(mapping)

    now = datetime.now()
    candidate.status = "approved"
    candidate.reviewed_by = actor_id
    candidate.reviewed_at = now
    candidate.review_note = note
    await log_ontology_action(db, tenant_id=tenant_id, action="approve", resource_type="ontology_candidate", resource_id=candidate.id, actor_id=actor_id, detail=created)
    return {"candidate": candidate_payload(candidate), "created": created}


async def reject_candidate(
    db: AsyncSession,
    *,
    tenant_id: int,
    candidate_id: int,
    actor_id: int | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    candidate = await db.get(OntologyCandidate, candidate_id)
    if not candidate or candidate.tenant_id != tenant_id:
        raise ValueError("Ontology candidate not found")
    candidate.status = "rejected"
    candidate.reviewed_by = actor_id
    candidate.reviewed_at = datetime.now()
    candidate.review_note = note
    await log_ontology_action(db, tenant_id=tenant_id, action="reject", resource_type="ontology_candidate", resource_id=candidate.id, actor_id=actor_id, detail={"note": note})
    return candidate_payload(candidate)


async def publish_version(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: int | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    objects = await list_published_objects(db, tenant_id)
    relations = await list_published_relations(db, tenant_id)
    mappings = [
        mapping_payload(row)
        for row in (await db.execute(select(OntologyMapping).where(OntologyMapping.tenant_id == tenant_id).order_by(OntologyMapping.id))).scalars().all()
    ]
    next_version = int(await db.scalar(select(func.max(OntologyVersion.version)).where(OntologyVersion.tenant_id == tenant_id)) or 0) + 1
    version = OntologyVersion(
        tenant_id=tenant_id,
        version=next_version,
        title=title or f"Object model v{next_version}",
        snapshot={"objects": objects, "relations": relations, "mappings": mappings},
        status="published",
        published_by=actor_id,
        published_at=datetime.now(),
    )
    db.add(version)
    await log_ontology_action(db, tenant_id=tenant_id, action="publish", resource_type="ontology_version", resource_id=None, actor_id=actor_id, detail={"version": next_version})
    await db.flush()
    return {"version": version.version, "title": version.title, "snapshot": version.snapshot, "published_at": version.published_at.isoformat() if version.published_at else None}


async def impact_analysis(db: AsyncSession, *, tenant_id: int, object_code: str | None = None, field_code: str | None = None) -> dict[str, Any]:
    impacted_forms = []
    impacted_meta = []
    impacted_knowledge = []
    impacted_mappings = []

    if object_code:
        forms = (await db.execute(select(Form).where(Form.tenant_id == tenant_id, Form.code == object_code))).scalars().all()
        impacted_forms.extend([{"id": form.id, "name": form.name, "code": form.code, "impact": "bound object code"} for form in forms])
        meta_models = (await db.execute(select(MetaModel).where(MetaModel.name == object_code.lower()))).scalars().all()
        impacted_meta.extend([{"id": model.id, "name": model.name, "label": model.label, "impact": "model name match"} for model in meta_models])
        links = (await db.execute(select(KnowledgeObjectLink).where(KnowledgeObjectLink.tenant_id == tenant_id, KnowledgeObjectLink.object_type == object_code).limit(100))).scalars().all()
        impacted_knowledge.extend([{"id": link.id, "document_id": link.document_id, "object_name": link.object_name, "impact": "knowledge object type"} for link in links])
        mappings_query = select(OntologyMapping).where(OntologyMapping.tenant_id == tenant_id, OntologyMapping.target_object_code == object_code)
        if field_code:
            mappings_query = mappings_query.where(OntologyMapping.target_field_code == field_code)
        impacted_mappings.extend([mapping_payload(row) for row in (await db.execute(mappings_query)).scalars().all()])

    if field_code:
        fields = (await db.execute(select(FormField).where(FormField.tenant_id == tenant_id, FormField.field_name == field_code).limit(100))).scalars().all()
        impacted_forms.extend([{"id": field.form_id, "field": field.field_name, "label": field.label, "impact": "form field name match"} for field in fields])
        meta_fields = (await db.execute(select(MetaField).where(MetaField.field_name == field_code).limit(100))).scalars().all()
        impacted_meta.extend([{"id": field.id, "field": field.field_name, "label": field.label, "impact": "meta field name match"} for field in meta_fields])

    blocking = bool(impacted_forms or impacted_mappings)
    return {
        "blocking": blocking,
        "items": {
            "forms": impacted_forms,
            "meta_models": impacted_meta,
            "knowledge": impacted_knowledge,
            "mappings": impacted_mappings,
            "graph_assets": [],
        },
        "warnings": ["Changing this object affects runtime forms or mappings."] if blocking else [],
    }


async def log_ontology_action(
    db: AsyncSession,
    *,
    tenant_id: int,
    action: str,
    resource_type: str,
    resource_id: int | None,
    actor_id: int | None,
    detail: dict[str, Any],
) -> None:
    db.add(OntologyPublishLog(
        tenant_id=tenant_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        actor_id=actor_id,
        detail=detail,
    ))
    db.add(AuditLog(
        tenant_id=tenant_id,
        user_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        new_values=json.dumps(detail, ensure_ascii=False),
    ))
