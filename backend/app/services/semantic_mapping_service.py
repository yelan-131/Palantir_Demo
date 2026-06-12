from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.relational import (
    DataSource,
    DataSourceMetadata,
    OntologyCandidate,
    OntologyMapping,
    OntologyMappingLayout,
    OntologyObject,
)
from app.services.ontology_candidate_service import upsert_candidate
from app.services.ontology_service import candidate_payload, mapping_payload, object_payload


def _source_scope(source_id: int | None) -> str:
    return str(source_id) if source_id is not None else "all"


def _candidate_target(candidate: OntologyCandidate) -> tuple[str | None, str | None]:
    payload = candidate.payload or {}
    mapping = payload.get("mapping") if isinstance(payload.get("mapping"), dict) else {}
    field = payload.get("field") if isinstance(payload.get("field"), dict) else {}
    relation = payload.get("relation") if isinstance(payload.get("relation"), dict) else {}
    target_object = mapping.get("target_object_code") or field.get("object_code") or relation.get("source_object_code")
    target_field = mapping.get("target_field_code") or field.get("code")
    return (str(target_object) if target_object else None, str(target_field) if target_field else None)


def _field_label(field: dict[str, Any]) -> str:
    return str(field.get("label") or field.get("name") or "")


def _node(node_id: str, node_type: str, label: str, data: dict[str, Any], x: int, y: int) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": node_type,
        "label": label,
        "data": data,
        "position": {"x": x, "y": y},
    }


async def get_semantic_mapping_workbench(
    db: AsyncSession,
    *,
    tenant_id: int,
    object_code: str | None = None,
    source_id: int | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    objects_query = select(OntologyObject).options(selectinload(OntologyObject.fields)).where(OntologyObject.tenant_id == tenant_id).order_by(OntologyObject.code)
    if object_code:
        objects_query = objects_query.where(OntologyObject.code == object_code)
    objects = (await db.execute(objects_query)).scalars().unique().all()

    selected_object = next((item for item in objects if item.code == object_code), None) or (objects[0] if objects else None)
    effective_object_code = object_code or (selected_object.code if selected_object else None)

    metadata_query = select(DataSourceMetadata).where(DataSourceMetadata.tenant_id == tenant_id).order_by(DataSourceMetadata.source_id, DataSourceMetadata.entity_name)
    if source_id is not None:
        metadata_query = metadata_query.where(DataSourceMetadata.source_id == source_id)
    metadata_rows = (await db.execute(metadata_query)).scalars().all()
    source_ids = sorted({row.source_id for row in metadata_rows})
    sources = {
        row.id: row
        for row in (await db.execute(select(DataSource).where(DataSource.tenant_id == tenant_id, DataSource.id.in_(source_ids)))).scalars().all()
    } if source_ids else {}

    candidate_query = select(OntologyCandidate).where(OntologyCandidate.tenant_id == tenant_id).order_by(OntologyCandidate.created_at.desc(), OntologyCandidate.id.desc())
    if status:
        candidate_query = candidate_query.where(OntologyCandidate.status == status)
    candidates = (await db.execute(candidate_query)).scalars().all()
    if effective_object_code:
        candidates = [candidate for candidate in candidates if _candidate_target(candidate)[0] == effective_object_code]

    mapping_query = select(OntologyMapping).where(OntologyMapping.tenant_id == tenant_id).order_by(OntologyMapping.id.desc())
    if source_id is not None:
        mapping_query = mapping_query.where(OntologyMapping.source_system == str(source_id))
    if effective_object_code:
        mapping_query = mapping_query.where(OntologyMapping.target_object_code == effective_object_code)
    mappings = (await db.execute(mapping_query)).scalars().all()

    layout = await db.scalar(
        select(OntologyMappingLayout).where(
            OntologyMappingLayout.tenant_id == tenant_id,
            OntologyMappingLayout.object_code == (effective_object_code or "__all__"),
            OntologyMappingLayout.source_scope == _source_scope(source_id),
        )
    )
    saved_positions = (layout.layout or {}).get("positions", {}) if layout else {}

    nodes: list[dict[str, Any]] = []
    node_ids: set[str] = set()
    edges: list[dict[str, Any]] = []

    def add_node(node: dict[str, Any]) -> None:
        if node["id"] in node_ids:
            return
        if node["id"] in saved_positions and isinstance(saved_positions[node["id"]], dict):
            node["position"] = saved_positions[node["id"]]
        nodes.append(node)
        node_ids.add(node["id"])

    for object_index, obj in enumerate(objects):
        object_node_id = f"object:{obj.code}"
        add_node(_node(object_node_id, "object", obj.name or obj.code, {"object": object_payload(obj)}, 720, 80 + object_index * 220))
        for field_index, field in enumerate(obj.fields or []):
            field_node_id = f"object-field:{obj.code}.{field.code}"
            add_node(_node(
                field_node_id,
                "object_field",
                field.label or field.code,
                {"object_code": obj.code, "field": {"code": field.code, "label": field.label, "type": field.field_type}},
                980,
                120 + field_index * 80,
            ))
            edges.append({
                "id": f"object-field-edge:{obj.code}.{field.code}",
                "source": object_node_id,
                "target": field_node_id,
                "type": "object_field",
                "status": "published",
                "label": "字段",
                "data": {"readonly": True},
            })

    for row_index, row in enumerate(metadata_rows):
        source = sources.get(row.source_id)
        table_node_id = f"source-table:{row.source_id}:{row.entity_name}"
        add_node(_node(
            table_node_id,
            "source_table",
            row.entity_label or row.entity_name,
            {
                "source_id": row.source_id,
                "source_name": source.name if source else str(row.source_id),
                "source_type": row.source_type,
                "entity_name": row.entity_name,
                "row_count": row.row_count,
                "sample_rows": row.sample_rows or [],
            },
            40,
            80 + row_index * 240,
        ))
        for field_index, field in enumerate((row.fields or [])[:12]):
            field_name = str(field.get("name") or "")
            if not field_name:
                continue
            field_node_id = f"source-field:{row.source_id}:{row.entity_name}.{field_name}"
            add_node(_node(
                field_node_id,
                "source_field",
                _field_label(field),
                {
                    "source_id": row.source_id,
                    "source_name": source.name if source else str(row.source_id),
                    "entity_name": row.entity_name,
                    "field_name": field_name,
                    "field": field,
                    "sample_values": [sample.get(field_name) for sample in (row.sample_rows or []) if isinstance(sample, dict) and field_name in sample],
                },
                300,
                110 + row_index * 240 + field_index * 42,
            ))
            edges.append({
                "id": f"source-field-edge:{row.source_id}:{row.entity_name}.{field_name}",
                "source": table_node_id,
                "target": field_node_id,
                "type": "source_field",
                "status": "metadata",
                "label": "字段",
                "data": {"readonly": True},
            })

    for mapping in mappings:
        source_id_text = str(mapping.source_system)
        source_node = f"source-field:{source_id_text}:{mapping.source_entity}.{mapping.source_field}"
        target_node = f"object-field:{mapping.target_object_code}.{mapping.target_field_code}" if mapping.target_field_code else f"object:{mapping.target_object_code}"
        edges.append({
            "id": f"mapping:{mapping.id}",
            "source": source_node,
            "target": target_node,
            "type": "semantic_mapping",
            "status": mapping.status,
            "label": "已批准",
            "data": {"mapping": mapping_payload(mapping), "confidence": mapping.confidence},
        })

    for candidate in candidates:
        payload = candidate.payload or {}
        mapping = payload.get("mapping") if isinstance(payload.get("mapping"), dict) else None
        if not mapping:
            continue
        source_node = f"source-field:{mapping.get('source_system')}:{mapping.get('source_entity')}.{mapping.get('source_field')}"
        target_node = f"object-field:{mapping.get('target_object_code')}.{mapping.get('target_field_code')}" if mapping.get("target_field_code") else f"object:{mapping.get('target_object_code')}"
        edges.append({
            "id": f"candidate:{candidate.id}",
            "source": source_node,
            "target": target_node,
            "type": "semantic_candidate",
            "status": candidate.status,
            "label": "候选",
            "data": {"candidate": candidate_payload(candidate), "confidence": candidate.confidence},
        })

    return {
        "object_code": effective_object_code,
        "source_id": source_id,
        "nodes": nodes,
        "edges": edges,
        "objects": [object_payload(obj) for obj in objects],
        "metadata": [
            {
                "id": row.id,
                "source_id": row.source_id,
                "source_type": row.source_type,
                "entity_name": row.entity_name,
                "entity_label": row.entity_label,
                "row_count": row.row_count,
                "fields": row.fields or [],
                "relationships": row.relationships or [],
                "sample_rows": row.sample_rows or [],
                "status": row.status,
                "error": row.error,
            }
            for row in metadata_rows
        ],
        "candidates": [candidate_payload(candidate) for candidate in candidates],
        "mappings": [mapping_payload(mapping) for mapping in mappings],
        "layout": layout.layout if layout else {"positions": {}, "viewport": None},
    }


async def save_semantic_mapping_layout(
    db: AsyncSession,
    *,
    tenant_id: int,
    object_code: str | None,
    source_id: int | None,
    layout: dict[str, Any],
    actor_id: int | None = None,
) -> OntologyMappingLayout:
    key_object = object_code or "__all__"
    key_scope = _source_scope(source_id)
    existing = await db.scalar(
        select(OntologyMappingLayout).where(
            OntologyMappingLayout.tenant_id == tenant_id,
            OntologyMappingLayout.object_code == key_object,
            OntologyMappingLayout.source_scope == key_scope,
        )
    )
    if existing:
        existing.layout = layout
        existing.updated_by = actor_id
        return existing
    row = OntologyMappingLayout(
        tenant_id=tenant_id,
        object_code=key_object,
        source_scope=key_scope,
        layout=layout,
        updated_by=actor_id,
    )
    db.add(row)
    await db.flush()
    return row


async def create_manual_mapping_candidate(
    db: AsyncSession,
    *,
    tenant_id: int,
    source_node: dict[str, Any],
    target_node: dict[str, Any],
    confidence: float = 0.72,
    note: str | None = None,
) -> OntologyCandidate:
    source_data = source_node.get("data") or {}
    target_data = target_node.get("data") or {}
    source_id = source_data.get("source_id")
    entity_name = str(source_data.get("entity_name") or "")
    field_name = str(source_data.get("field_name") or "")
    object_code = str(target_data.get("object_code") or (target_data.get("object") or {}).get("code") or "")
    target_field = target_data.get("field") if isinstance(target_data.get("field"), dict) else {}
    target_field_code = str(target_field.get("code") or target_data.get("field_name") or "")
    if not source_id or not entity_name or not field_name or not object_code:
        raise ValueError("请从来源字段连接到对象或对象字段")
    payload = {
        "mapping": {
            "source_system": str(source_id),
            "source_type": str(source_data.get("source_type") or "database"),
            "source_entity": entity_name,
            "source_field": field_name,
            "source_field_type": (source_data.get("field") or {}).get("type"),
            "target_object_code": object_code,
            "target_field_code": target_field_code or None,
            "evidence": note or "人工在语义映射画布中创建候选连线",
        },
        "source": {"source_id": source_id, "entity_name": entity_name, "field_name": field_name},
        "evidence": [note or "manual canvas connection"],
    }
    if target_field_code:
        payload["field"] = {
            "object_code": object_code,
            "code": target_field_code,
            "name": target_field.get("label") or target_field_code,
            "field_type": target_field.get("type") or "string",
            "source_type": "manual",
            "source_ref": f"canvas:{source_id}:{entity_name}.{field_name}",
        }
    return await upsert_candidate(
        db,
        tenant_id=tenant_id,
        candidate_type="mapping",
        candidate_key=f"canvas:{source_id}:{entity_name}.{field_name}:mapping:{object_code}.{target_field_code or '__object__'}",
        title=f"{entity_name}.{field_name} -> {object_code}{'.' + target_field_code if target_field_code else ''}",
        payload=payload,
        confidence=max(0, min(float(confidence), 1)),
        source_type="canvas",
        source_ref=f"canvas:{source_id}:{entity_name}.{field_name}",
    )
