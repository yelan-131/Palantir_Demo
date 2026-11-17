"""Knowledge search and document context reads shared by routes and AI tools."""
from __future__ import annotations

from functools import lru_cache
import os
from typing import Any
from sqlalchemy import select
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from app.core.db import db_session
from app.models.relational import KnowledgeChunk, KnowledgeDocument, KnowledgeObjectLink
from app.services.ai.knowledge_ingestion import CHUNKS as INGESTED_CHUNKS, DOCUMENTS as INGESTED_DOCUMENTS, search_ingested_knowledge, cosine_score, lexical_score
from app.services.ai.providers import _stable_embedding
from app.services.ai.tenant_context import require_tenant_id


STATIC_KNOWLEDGE_RUNTIME_ENV = "PALANTIR_ENABLE_STATIC_KNOWLEDGE_RUNTIME"


def _static_knowledge_runtime_enabled() -> bool:
    return os.getenv(STATIC_KNOWLEDGE_RUNTIME_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def _static_knowledge_documents() -> list[dict[str, Any]]:
    return KNOWLEDGE_DOCUMENTS if _static_knowledge_runtime_enabled() else []


def _static_knowledge_chunks() -> list[dict[str, Any]]:
    return KNOWLEDGE_CHUNKS if _static_knowledge_runtime_enabled() else []


KNOWLEDGE_SOURCES = [
    {
        "id": "quality-sop",
        "name": "Quality SOP",
        "type": "sop",
        "owner": "Quality Management",
        "status": "indexed",
        "document_count": 2,
        "description": "Quality exception handling, defect review, batch isolation, and CAPA guidance.",
    },
    {
        "id": "historical-capa",
        "name": "Historical CAPA",
        "type": "capa",
        "owner": "Quality Engineering",
        "status": "indexed",
        "document_count": 2,
        "description": "Past closed-loop quality events, root-cause analysis, and preventive actions.",
    },
    {
        "id": "supplier-evidence",
        "name": "Supplier evidence",
        "type": "supplier_report",
        "owner": "SQE Team",
        "status": "reviewing",
        "document_count": 1,
        "description": "Supplier 8D reports, batch traceability, and delivery commitments.",
    },
    {
        "id": "equipment-logs",
        "name": "Equipment logs",
        "type": "log",
        "owner": "Equipment Engineering",
        "status": "indexed",
        "document_count": 1,
        "description": "Alarm records, temperature drift, maintenance notes, and engineer reviews.",
    },
]


KNOWLEDGE_DOCUMENTS = [
    {
        "id": "doc-sop-qe-001",
        "source_id": "quality-sop",
        "title": "Solder void exception handling SOP",
        "doc_type": "SOP",
        "status": "indexed",
        "updated_at": "2026-05-20 18:30",
        "summary": "Defines AOI review, batch isolation, CAPA, and customer impact assessment after solder void defects are found.",
        "linked_objects": [
            {"type": "QualityEvent", "id": "QE-20260521-001", "name": "AOI solder void event"},
            {"type": "WorkOrder", "id": "workorder-260521-017", "name": "WO-260521-017"},
            {"type": "Equipment", "id": "equipment-smt-03", "name": "SMT-03 reflow oven"},
        ],
    },
    {
        "id": "doc-capa-052",
        "source_id": "historical-capa",
        "title": "CAPA-052 solder paste storage exception review",
        "doc_type": "CAPA",
        "status": "indexed",
        "updated_at": "2026-05-18 16:10",
        "summary": "Historical CAPA shows cold-chain and warm-up time issues can increase solder void risk.",
        "linked_objects": [
            {"type": "Supplier", "id": "supplier-s-023", "name": "North Star Electronic Materials"},
            {"type": "MaterialBatch", "id": "batch-mb-7781", "name": "MB-7781 solder paste"},
        ],
    },
    {
        "id": "doc-supplier-8d-7781",
        "source_id": "supplier-evidence",
        "title": "North Star material batch 8D rectification report",
        "doc_type": "SupplierReport",
        "status": "reviewing",
        "updated_at": "2026-05-19 11:45",
        "summary": "Supplier report states that MB-7781 lacks complete cold-chain temperature records and needs supplemental traceability evidence.",
        "linked_objects": [
            {"type": "Supplier", "id": "supplier-s-023", "name": "North Star Electronic Materials"},
            {"type": "MaterialBatch", "id": "batch-mb-7781", "name": "MB-7781 solder paste"},
        ],
    },
    {
        "id": "doc-equipment-log-smt03",
        "source_id": "equipment-logs",
        "title": "SMT-03 reflow oven zone 5 fluctuation record",
        "doc_type": "EquipmentLog",
        "status": "indexed",
        "updated_at": "2026-05-21 09:35",
        "summary": "Equipment log shows slight drift in zone 5 before the abnormal event; engineer review is recommended.",
        "linked_objects": [
            {"type": "Equipment", "id": "equipment-smt-03", "name": "SMT-03 reflow oven"},
            {"type": "WorkOrder", "id": "workorder-260521-017", "name": "WO-260521-017"},
        ],
    },
    {
        "id": "doc-customer-risk",
        "source_id": "quality-sop",
        "title": "Customer delivery risk communication standard",
        "doc_type": "Guideline",
        "status": "indexed",
        "updated_at": "2026-05-21 14:00",
        "summary": "When quality exceptions affect customer orders, confirm substitute batches and delivery commitments before external communication.",
        "linked_objects": [
            {"type": "CustomerOrder", "id": "co-202605-889", "name": "Customer order CO-202605-889"},
        ],
    },
]


KNOWLEDGE_CHUNKS = [
    {
        "chunk_id": "chunk-sop-001",
        "document_id": "doc-sop-qe-001",
        "source_ref": "SOP section 2",
        "chunk_text": "When AOI continuously finds solder void defects above 2.0%, trigger a quality exception event and confirm the affected scope with the quality manager.",
        "tags": ["quality", "AOI", "solder"],
    },
    {
        "chunk_id": "chunk-sop-002",
        "document_id": "doc-sop-qe-001",
        "source_ref": "SOP section 3",
        "chunk_text": "Recommended handling sequence: freeze risk batches, start reinspection, create CAPA draft, and ask purchasing to verify supplier batch risk.",
        "tags": ["CAPA", "supplier", "batch"],
    },
    {
        "chunk_id": "chunk-capa-052-001",
        "document_id": "doc-capa-052",
        "source_ref": "CAPA-052 root cause",
        "chunk_text": "Cold-chain transport temperature exceptions, insufficient warm-up time, and long exposure after opening all increase solder void probability.",
        "tags": ["CAPA", "cold-chain", "solder paste"],
    },
    {
        "chunk_id": "chunk-capa-052-002",
        "document_id": "doc-capa-052",
        "source_ref": "CAPA-052 preventive actions",
        "chunk_text": "Corrective actions include supplementing cold-chain records, limiting post-opening use duration, increasing first-piece review frequency, and requesting supplier temperature evidence.",
        "tags": ["corrective action", "supplier"],
    },
    {
        "chunk_id": "chunk-supplier-8d-001",
        "document_id": "doc-supplier-8d-7781",
        "source_ref": "Supplier 8D report",
        "chunk_text": "The supplier confirms that MB-7781 lacks complete transport temperature records; freeze the batch until additional traceability evidence is provided.",
        "tags": ["8D", "supplier", "MB-7781"],
    },
    {
        "chunk_id": "chunk-equipment-001",
        "document_id": "doc-equipment-log-smt03",
        "source_ref": "Equipment log 09:12",
        "chunk_text": "SMT-03 reflow oven zone 5 showed slight drift after 09:12. Although no stop alarm was triggered, an equipment inspection task and temperature profile review are recommended.",
        "tags": ["equipment", "temperature"],
    },
    {
        "chunk_id": "chunk-customer-risk-001",
        "document_id": "doc-customer-risk",
        "source_ref": "Customer communication standard section 1",
        "chunk_text": "When an exception affects customer orders, sales should confirm substitute batches and delivery commitments after quality confirms the isolation scope.",
        "tags": ["customer", "delivery"],
    },
]


def _document_by_id(document_id: str) -> dict[str, Any]:
    if document_id == "doc-welding-sop":
        document_id = "doc-sop-qe-001"
    return next(item for item in _static_knowledge_documents() if item["id"] == document_id)


def _canonical_document_id(document_id: str | None) -> str | None:
    if document_id == "doc-welding-sop":
        return "doc-sop-qe-001"
    return document_id


def _record_belongs_to_tenant(record: dict[str, Any], tenant_id: int) -> bool:
    try:
        return require_tenant_id(record) == tenant_id
    except ValueError:
        return False


def _ingested_document_for_tenant(document_id: str, tenant_id: int) -> dict[str, Any] | None:
    document = INGESTED_DOCUMENTS.get(document_id)
    if not document or not _record_belongs_to_tenant(document, tenant_id):
        return None
    return document


def _ingested_chunks_for_tenant(document_id: str, tenant_id: int) -> list[dict[str, Any]]:
    return [
        chunk
        for chunk in INGESTED_CHUNKS.values()
        if chunk["document_id"] == document_id and _record_belongs_to_tenant(chunk, tenant_id)
    ]


def _source_by_id(source_id: str) -> dict[str, Any]:
    return next(item for item in KNOWLEDGE_SOURCES if item["id"] == source_id)


def _chunk_payload(chunk: dict[str, Any], score: float | None = None) -> dict[str, Any]:
    document = _document_by_id(chunk["document_id"])
    source = _source_by_id(document["source_id"])
    payload = {
        **chunk,
        "document_title": document["title"],
        "document_type": document["doc_type"],
        "document_summary": document["summary"],
        "source_name": source["name"],
        "source_type": source["type"],
        "linked_objects": document["linked_objects"],
    }
    if score is not None:
        payload["score"] = round(float(score), 4)
    return payload


@lru_cache(maxsize=1)
def _retriever():
    corpus = [
        f"{_document_by_id(chunk['document_id'])['title']} {_document_by_id(chunk['document_id'])['summary']} {chunk['chunk_text']}"
        for chunk in _static_knowledge_chunks()
    ]
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
    matrix = vectorizer.fit_transform(corpus)
    return vectorizer, matrix


def _matches_object(document: dict[str, Any], object_type: str | None, object_id: str | None) -> bool:
    if not object_type and not object_id:
        return True
    normalized_id = (object_id or "").lower()
    normalized_type = (object_type or "").lower()
    for linked in document["linked_objects"]:
        if normalized_type and linked["type"].lower() != normalized_type:
            continue
        if not normalized_id:
            return True
        if normalized_id in linked["id"].lower() or normalized_id in linked["name"].lower():
            return True
    return False


def _now_iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


def _db_document_payload(row: KnowledgeDocument, linked_objects: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": row.document_id,
        "tenant_id": row.tenant_id,
        "document_id": row.document_id,
        "source_id": "database",
        "title": row.title,
        "doc_type": row.source_type,
        "source_type": row.source_type,
        "source_file_name": row.source_file_name,
        "status": row.status,
        "updated_at": _now_iso(row.updated_at),
        "summary": f"Database knowledge asset: {row.source_file_name}",
        "markdown_content": row.markdown_content,
        "ocr_status": "ready" if row.ocr_result else None,
        "ocr_result": row.ocr_result,
        "permission_scope": row.permission_scope,
        "owner_user_id": row.owner_user_id,
        "source_path": row.source_path,
        "linked_objects": linked_objects or [],
    }


def _db_chunk_payload(
    chunk: KnowledgeChunk,
    document: KnowledgeDocument | None = None,
    score: float | None = None,
) -> dict[str, Any]:
    payload = {
        "chunk_id": chunk.chunk_id,
        "tenant_id": chunk.tenant_id,
        "document_id": chunk.document_id,
        "title": chunk.title,
        "chunk_text": chunk.chunk_text,
        "snippet": chunk.chunk_text[:300],
        "source_location": chunk.source_location,
        "permission_scope": chunk.permission_scope,
        "status": chunk.status,
    }
    if document:
        payload.update({
            "document_title": document.title,
            "document_type": document.source_type,
            "source_file_name": document.source_file_name,
            "source_name": document.source_file_name,
            "source_type": document.source_type,
        })
    if score is not None:
        payload["score"] = round(float(score), 4)
    return payload


async def _load_document_links(session, document_ids: list[str], tenant_id: int | None = None) -> dict[str, list[dict[str, Any]]]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    if not document_ids:
        return {}
    rows = (
        await session.execute(
            select(KnowledgeObjectLink).where(
                KnowledgeObjectLink.tenant_id == tenant_id,
                KnowledgeObjectLink.document_id.in_(document_ids),
            )
        )
    ).scalars().all()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row.document_id, []).append({
            "type": row.object_type,
            "id": row.object_id,
            "name": row.object_name,
            "confidence": row.confidence,
            "source_location": row.source_location,
            "status": row.status,
        })
    return grouped


async def _get_persisted_document(document_id: str, tenant_id: int | None = None) -> dict[str, Any] | None:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    try:
        async with db_session() as session:
            row = await session.scalar(
                select(KnowledgeDocument).where(
                    KnowledgeDocument.tenant_id == tenant_id,
                    KnowledgeDocument.document_id == document_id,
                )
            )
            if not row:
                return None
            links = await _load_document_links(session, [document_id], tenant_id)
            return _db_document_payload(row, links.get(document_id, []))
    except Exception:
        return None


async def _list_persisted_chunks(document_id: str, tenant_id: int | None = None) -> list[dict[str, Any]]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    try:
        async with db_session() as session:
            document = await session.scalar(
                select(KnowledgeDocument).where(
                    KnowledgeDocument.tenant_id == tenant_id,
                    KnowledgeDocument.document_id == document_id,
                )
            )
            if not document:
                return []
            rows = (
                await session.execute(
                    select(KnowledgeChunk).where(
                        KnowledgeChunk.tenant_id == tenant_id,
                        KnowledgeChunk.document_id == document_id,
                    )
                )
            ).scalars().all()
            return [_db_chunk_payload(row, document) for row in rows]
    except Exception:
        return []


async def _search_persisted_knowledge_payload(
    query: str,
    *,
    limit: int = 5,
    document_id: str | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
    tenant_id: int | None = None,
) -> list[dict[str, Any]]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    try:
        async with db_session() as session:
            allowed_document_ids: set[str] | None = None
            if object_type or object_id:
                link_stmt = select(KnowledgeObjectLink).where(KnowledgeObjectLink.tenant_id == tenant_id)
                if object_type:
                    link_stmt = link_stmt.where(KnowledgeObjectLink.object_type == object_type)
                if object_id:
                    normalized = f"%{object_id}%"
                    link_stmt = link_stmt.where(
                        KnowledgeObjectLink.object_id.ilike(normalized)
                        | KnowledgeObjectLink.object_name.ilike(normalized)
                    )
                allowed_document_ids = {
                    row.document_id for row in (await session.execute(link_stmt)).scalars().all()
                }
                if not allowed_document_ids:
                    return []

            chunk_stmt = select(KnowledgeChunk, KnowledgeDocument).join(
                KnowledgeDocument,
                KnowledgeDocument.document_id == KnowledgeChunk.document_id,
            ).where(KnowledgeChunk.tenant_id == tenant_id, KnowledgeDocument.tenant_id == tenant_id)
            canonical_document_id = _canonical_document_id(document_id)
            if canonical_document_id:
                chunk_stmt = chunk_stmt.where(KnowledgeChunk.document_id == canonical_document_id)
            if allowed_document_ids is not None:
                chunk_stmt = chunk_stmt.where(KnowledgeChunk.document_id.in_(allowed_document_ids))

            query_embedding = _stable_embedding(query)
            candidates = []
            for chunk, document in (await session.execute(chunk_stmt)).all():
                score = cosine_score(query_embedding, chunk.embedding or _stable_embedding(chunk.chunk_text))
                score += lexical_score(query, chunk.chunk_text) * 2
                candidates.append(_db_chunk_payload(chunk, document, score))
            return sorted(candidates, key=lambda item: item.get("score", 0), reverse=True)[: max(1, min(limit, 10))]
    except Exception:
        return []


def _search_knowledge_payload(
    query: str,
    *,
    tenant_id: int | None = None,
    limit: int = 5,
    document_id: str | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
    include_static: bool = True,
) -> list[dict[str, Any]]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    results: list[dict[str, Any]] = []
    canonical_document_id = _canonical_document_id(document_id)
    for item in search_ingested_knowledge(query, tenant_id=tenant_id, limit=limit):
        if canonical_document_id and item.get("document_id") != canonical_document_id:
            continue
        if object_type or object_id:
            continue
        results.append(item)

    if not include_static:
        return results[: max(1, min(limit, 10))]

    vectorizer, matrix = _retriever()
    query_vector = vectorizer.transform([query])
    scores = cosine_similarity(query_vector, matrix).flatten()
    ranked = sorted(enumerate(scores), key=lambda item: item[1], reverse=True)

    for index, score in ranked:
        if score <= 0:
            continue
        chunk = _static_knowledge_chunks()[index]
        if canonical_document_id and chunk["document_id"] != canonical_document_id:
            continue
        document = _document_by_id(chunk["document_id"])
        if not _matches_object(document, object_type, object_id):
            continue
        payload = _chunk_payload(chunk, float(score))
        payload.setdefault("snippet", payload.get("chunk_text", "")[:300])
        payload.setdefault("source_location", payload.get("source_ref", "demo-source"))
        results.append(payload)
        if len(results) >= max(1, min(limit, 10)):
            break

    return results[: max(1, min(limit, 10))]


async def _search_knowledge_payload_async(
    query: str,
    *,
    tenant_id: int | None = None,
    limit: int = 5,
    document_id: str | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
) -> list[dict[str, Any]]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    persisted = await _search_persisted_knowledge_payload(
        query,
        limit=limit,
        document_id=document_id,
        object_type=object_type,
        object_id=object_id,
        tenant_id=tenant_id,
    )
    memory_and_static = _search_knowledge_payload(
        query,
        tenant_id=tenant_id,
        limit=limit,
        document_id=document_id,
        object_type=object_type,
        object_id=object_id,
        include_static=_static_knowledge_runtime_enabled(),
    )
    by_key: dict[str, dict[str, Any]] = {}
    for item in [*persisted, *memory_and_static]:
        key = str(item.get("chunk_id") or item.get("document_id") or item.get("source_location"))
        if key not in by_key:
            by_key[key] = item
    return list(by_key.values())[: max(1, min(limit, 10))]


def _document_context_payload(document_id: str | None) -> list[dict[str, Any]]:
    document_id = _canonical_document_id(document_id)
    if not document_id:
        return []
    try:
        document = _document_by_id(document_id)
    except StopIteration:
        return []
    chunks = [chunk for chunk in _static_knowledge_chunks() if chunk["document_id"] == document_id]
    if chunks:
        return [_chunk_payload(chunk, 1.0) for chunk in chunks]
    return [
        {
            "document_id": document["id"],
            "document_title": document["title"],
            "document_type": document["doc_type"],
            "document_summary": document["summary"],
            "snippet": document["summary"],
            "source_location": document["title"],
            "linked_objects": document.get("linked_objects", []),
            "score": 1.0,
        }
    ]


async def _document_context_payload_async(document_id: str | None, tenant_id: int | None = None) -> list[dict[str, Any]]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    document_id = _canonical_document_id(document_id)
    if not document_id:
        return []
    persisted_chunks = await _list_persisted_chunks(document_id, tenant_id)
    if persisted_chunks:
        for chunk in persisted_chunks:
            chunk.setdefault("score", 1.0)
        return persisted_chunks
    persisted_document = await _get_persisted_document(document_id, tenant_id)
    if persisted_document:
        return [{
            "document_id": persisted_document["document_id"],
            "document_title": persisted_document["title"],
            "document_type": persisted_document["source_type"],
            "document_summary": persisted_document["summary"],
            "snippet": persisted_document["markdown_content"][:300],
            "source_location": persisted_document["source_file_name"],
            "linked_objects": persisted_document.get("linked_objects", []),
            "score": 1.0,
        }]
    ingested_document = _ingested_document_for_tenant(document_id, tenant_id)
    if ingested_document:
        chunks = _ingested_chunks_for_tenant(document_id, tenant_id)
        if chunks:
            return [
                {
                    **chunk,
                    "document_title": ingested_document["title"],
                    "document_type": ingested_document["source_type"],
                    "snippet": chunk["chunk_text"][:300],
                    "source_file_name": ingested_document["source_file_name"],
                    "score": 1.0,
                }
                for chunk in chunks
            ]
        return [{
            "document_id": ingested_document["document_id"],
            "document_title": ingested_document["title"],
            "document_type": ingested_document["source_type"],
            "snippet": ingested_document["markdown_content"][:300],
            "source_location": ingested_document["source_file_name"],
            "score": 1.0,
        }]
    if not _static_knowledge_runtime_enabled():
        return []
    return _document_context_payload(document_id)
