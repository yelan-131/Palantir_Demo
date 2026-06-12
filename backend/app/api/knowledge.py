"""Knowledge base APIs for persisted RAG assets and extraction jobs."""

from __future__ import annotations

import uuid
from datetime import datetime
from functools import lru_cache
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, desc, select
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.api.deps import current_tenant_id, current_user_id, get_current_user
from app.core.audit import write_audit_log
from app.core.db import db_session
from app.models.relational import (
    AIAgentRun,
    AIConversation,
    AIMemoryEntry,
    AIMessage,
    AIToolCall,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeObjectLink,
)
from app.services.ai.knowledge_ingestion import (
    CHUNKS as INGESTED_CHUNKS,
    DOCUMENTS as INGESTED_DOCUMENTS,
    JOBS as INGESTION_JOBS,
    ingest_asset,
    markdown_to_chunks,
    search_ingested_knowledge,
    update_ocr_corrections,
    cosine_score,
    lexical_score,
)
from app.services.ai.agent_items import items_from_steps
from app.services.ai.providers import _stable_embedding
from app.services.ai.ocr_service import ocr_extract
from app.services.ai.memory import memory_service
from app.services.ai.runtime import agent_runtime
from app.services.ai.settings import load_persisted_ai_settings, settings_snapshot, settings_to_provider_config
from app.services.ai.tenant_context import require_tenant_id
from app.services.ai.tenant_profile import load_tenant_profile
from app.services.ai.ontology_extraction import (
    approve_extraction_job,
    build_intake_recommendation_from_document,
    commit_extraction_to_graph,
    create_extraction_job,
    create_extraction_job_from_document,
    export_extraction,
    get_extraction_job,
    persist_ingestion_result,
)

router = APIRouter()

STATIC_KNOWLEDGE_RUNTIME_ENV = "PALANTIR_ENABLE_STATIC_KNOWLEDGE_RUNTIME"


def _static_knowledge_runtime_enabled() -> bool:
    return os.getenv(STATIC_KNOWLEDGE_RUNTIME_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def _static_knowledge_documents() -> list[dict[str, Any]]:
    return KNOWLEDGE_DOCUMENTS if _static_knowledge_runtime_enabled() else []


def _static_knowledge_chunks() -> list[dict[str, Any]]:
    return KNOWLEDGE_CHUNKS if _static_knowledge_runtime_enabled() else []


def _static_knowledge_cards() -> list[dict[str, Any]]:
    return KNOWLEDGE_CARDS if _static_knowledge_runtime_enabled() else []


DEMO_KNOWLEDGE_DOCUMENT_ORDER = [
    "kb-doc-quality-sop-docx",
    "kb-doc-capa-072-docx",
    "kb-doc-supplier-8d-xlsx",
    "kb-doc-process-control-xlsx",
    "kb-doc-maintenance-log-pdf",
    "kb-doc-customer-risk-pdf",
]


class KnowledgeSearchBody(BaseModel):
    query: str
    limit: int = 5
    object_type: str | None = None
    object_id: str | None = None


class KnowledgeAgentConversationBody(BaseModel):
    document_id: str | None = None
    document_title: str | None = None
    page: str = "knowledge-center"
    metadata: dict[str, Any] | None = None


class KnowledgeAgentMessageBody(BaseModel):
    content: str
    context: dict[str, Any] | None = None


class BindingCandidateBody(BaseModel):
    text: str
    limit: int = 8


class ExtractionApproveBody(BaseModel):
    approved_result: dict[str, Any] | None = None


class OntologyIntakeBody(BaseModel):
    domain_hint: str = "manufacturing"
    mode: str = "recommend"


class DocumentExtractionJobBody(BaseModel):
    domain: str = "manufacturing"
    prompt_name: str = "manufacturing_ontology_v1"
    model_name: str = "rules-ontology-extractor"


class OcrCorrectionBody(BaseModel):
    blocks: list[dict[str, Any]]


class KnowledgeDirectoryCreateBody(BaseModel):
    name: str
    parent_id: str | None = None
    scope: str = "enterprise"
    owner_user_id: str | None = None
    sort_order: int = 100


class KnowledgeDirectoryUpdateBody(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    scope: str | None = None
    owner_user_id: str | None = None
    sort_order: int | None = None
    status: str | None = None


class KnowledgeDirectoryMoveBody(BaseModel):
    parent_id: str | None = None
    sort_order: int = 100


KNOWLEDGE_SPACES = [
    {
        "id": "personal",
        "name": "Personal knowledge",
        "scope": "private",
        "owner_role": "Knowledge uploader",
        "review_required": False,
        "description": "Personal notes, temporary material, and unpublished experience visible to the owner by default.",
    },
    {
        "id": "team-quality",
        "name": "Quality team knowledge",
        "scope": "team",
        "owner_role": "Quality engineer",
        "review_required": True,
        "description": "Reusable quality exceptions, inspection strategies, and project material for the team.",
    },
    {
        "id": "dept-quality",
        "name": "Quality department knowledge",
        "scope": "department",
        "owner_role": "Quality manager",
        "review_required": True,
        "description": "Reviewed SOPs, CAPA material, quality issue libraries, and handling strategies.",
    },
    {
        "id": "enterprise",
        "name": "Enterprise knowledge",
        "scope": "enterprise",
        "owner_role": "Platform admin / business expert",
        "review_required": True,
        "description": "Formal cross-department knowledge available to workbench and AI assistant retrieval.",
    },
]


KNOWLEDGE_DIRECTORIES = [
    {
        "id": "dir-enterprise",
        "name": "Enterprise knowledge",
        "parent_id": None,
        "scope": "enterprise",
        "owner_user_id": "system",
        "sort_order": 10,
        "status": "active",
        "created_at": "2026-05-21T10:00:00",
        "updated_at": "2026-05-21T10:00:00",
    },
    {
        "id": "dir-quality",
        "name": "Quality department",
        "parent_id": "dir-enterprise",
        "scope": "department",
        "owner_user_id": "quality",
        "sort_order": 20,
        "status": "active",
        "created_at": "2026-05-21T10:00:00",
        "updated_at": "2026-05-21T10:00:00",
    },
    {
        "id": "dir-personal",
        "name": "Personal notes",
        "parent_id": None,
        "scope": "private",
        "owner_user_id": "demo-user",
        "sort_order": 30,
        "status": "active",
        "created_at": "2026-05-21T10:00:00",
        "updated_at": "2026-05-21T10:00:00",
    },
]


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


KNOWLEDGE_CARDS = [
    {
        "id": "card-welding-sop",
        "space_id": "team-quality",
        "title": "Solder void exception handling SOP",
        "tags": ["quality", "APS", "solder"],
        "status": "pending_review",
        "summary": "Defines review, isolation, CAPA, supplier verification, and customer impact assessment actions.",
        "owner": "Quality system owner",
        "reviewer": "Quality manager",
        "scenario": "AOI finds continuous solder voids above the control threshold.",
        "steps": [
            "Freeze same-batch materials and WIP.",
            "Start BGA area reinspection and include same-shift work orders.",
            "Check reflow temperature profile and solder paste storage records.",
            "Generate CAPA draft when repeated defects appear.",
        ],
        "guardrails": [
            "Do not release same-batch inventory before supplier evidence is complete.",
            "Confirm substitute batches before committing delivery dates.",
        ],
        "evidence_refs": [
            {"document_id": "doc-sop-qe-001", "source_ref": "SOP section 2-3"},
            {"document_id": "doc-capa-052", "source_ref": "CAPA-052 root cause"},
        ],
        "linked_objects": [
            {"type": "QualityEvent", "id": "QE-20260521-001", "name": "AOI solder void event"},
            {"type": "Equipment", "id": "equipment-smt-03", "name": "SMT-03 reflow oven"},
        ],
        "created_at": "2026-05-20 18:30",
        "updated_at": "2026-05-20 18:30",
    },
    {
        "id": "card-supplier-risk",
        "space_id": "team-quality",
        "title": "Supplier batch risk decision",
        "tags": ["supplier", "8D", "batch"],
        "status": "indexed",
        "summary": "Use supplier 8D, traceability gaps, and incoming inspection strategy to judge batch risk.",
        "owner": "SQE team",
        "reviewer": "Quality engineer",
        "scenario": "Supplier evidence shows missing temperature or storage records.",
        "steps": [
            "Isolate same-batch and same-storage-risk materials.",
            "Ask SQE to supplement 8D and temperature evidence.",
            "Increase subsequent incoming inspection ratio.",
        ],
        "guardrails": [
            "Reviewing supplier evidence is only a reference and cannot replace official release criteria.",
        ],
        "evidence_refs": [
            {"document_id": "doc-capa-052", "source_ref": "CAPA-052 preventive actions"},
            {"document_id": "doc-supplier-8d-7781", "source_ref": "Supplier 8D report"},
        ],
        "linked_objects": [
            {"type": "Supplier", "id": "supplier-s-023", "name": "North Star Electronic Materials"},
            {"type": "MaterialBatch", "id": "batch-mb-7781", "name": "MB-7781 solder paste"},
        ],
        "created_at": "2026-05-21 10:30",
        "updated_at": "2026-05-21 10:30",
    },
]


OCR_PIPELINE_STEPS = [
    {"key": "upload", "title": "Upload", "owner": "Knowledge owner", "description": "Upload Word, PDF, Markdown, Excel, image, or OCR material."},
    {"key": "ocr", "title": "OCR and parsing", "owner": "System / AI", "description": "Normalize files into markdown text and structured blocks."},
    {"key": "extract", "title": "Entity extraction", "owner": "System / AI", "description": "Identify suppliers, batches, equipment, work orders, defects, and customer orders."},
    {"key": "match", "title": "Master-data matching", "owner": "Data steward", "description": "Match aliases to ERP, MES, QMS, equipment master, and ontology objects."},
    {"key": "draft", "title": "Draft knowledge card", "owner": "AI + business reviewer", "description": "Create markdown-style knowledge cards for review and publication."},
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


def _card_payload(card: dict[str, Any]) -> dict[str, Any]:
    space = next((item for item in KNOWLEDGE_SPACES if item["id"] == card["space_id"]), None)
    evidence = []
    for ref in card["evidence_refs"]:
        document = _document_by_id(ref["document_id"])
        source = _source_by_id(document["source_id"])
        evidence.append({
            **ref,
            "document_title": document["title"],
            "document_type": document["doc_type"],
            "source_name": source["name"],
            "source_type": source["type"],
        })
    return {
        **card,
        "space_name": space["name"] if space else card["space_id"],
        "evidence_refs": evidence,
    }


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


def _matches_card(card: dict[str, Any], object_type: str | None, object_id: str | None) -> bool:
    if not object_type and not object_id:
        return True
    normalized_id = (object_id or "").lower()
    normalized_type = (object_type or "").lower()
    for linked in card["linked_objects"]:
        if normalized_type and linked["type"].lower() != normalized_type:
            continue
        if not normalized_id:
            return True
        if normalized_id in linked["id"].lower() or normalized_id in linked["name"].lower():
            return True
    return False


def _user_key(user: dict[str, Any]) -> str:
    return str(user.get("sub") or user.get("username") or user.get("uid") or "guest")


def _now_iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


def _serialize_conversation(row: AIConversation) -> dict[str, Any]:
    return {
        "id": row.conversation_id,
        "conversation_id": row.conversation_id,
        "user_id": row.user_id,
        "page": row.page,
        "document_id": row.document_id,
        "title": row.title,
        "status": row.status,
        "last_message": row.last_message,
        "metadata": row.metadata_json or {},
        "created_at": _now_iso(row.created_at),
        "updated_at": _now_iso(row.updated_at),
    }


def _serialize_message(row: AIMessage) -> dict[str, Any]:
    return {
        "id": row.message_id,
        "message_id": row.message_id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "content": row.content,
        "evidence": row.evidence or [],
        "model_name": row.model_name,
        "usage": row.usage,
        "status": row.status,
        "error": row.error,
        "created_at": _now_iso(row.created_at),
        "updated_at": _now_iso(row.updated_at),
    }


def _serialize_run(row: AIAgentRun) -> dict[str, Any]:
    items = getattr(row, "items", None) or []
    return {
        "id": row.run_id,
        "run_id": row.run_id,
        "conversation_id": row.conversation_id,
        "user_message_id": row.user_message_id,
        "assistant_message_id": row.assistant_message_id,
        "status": row.status,
        "mode": row.mode,
        "input_message": row.input_message,
        "answer": row.answer,
        "items": items,
        "evidence": row.evidence or [],
        "risk_level": row.risk_level,
        "requires_confirmation": row.requires_confirmation,
        "created_at": _now_iso(row.created_at),
        "updated_at": _now_iso(row.updated_at),
    }


async def _persist_document_and_chunks(document: dict[str, Any], tenant_id: int | None = None) -> None:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    try:
        async with db_session() as session:
            row = await session.scalar(
                select(KnowledgeDocument).where(
                    KnowledgeDocument.tenant_id == tenant_id,
                    KnowledgeDocument.document_id == document["document_id"],
                )
            )
            if row:
                row.markdown_content = document["markdown_content"]
                row.ocr_result = document.get("ocr_result")
                row.status = document.get("status", row.status)
            await session.execute(
                delete(KnowledgeChunk).where(
                    KnowledgeChunk.tenant_id == tenant_id,
                    KnowledgeChunk.document_id == document["document_id"],
                )
            )
            for chunk in _ingested_chunks_for_tenant(document["document_id"], tenant_id):
                session.add(KnowledgeChunk(
                    tenant_id=tenant_id,
                    chunk_id=chunk["chunk_id"],
                    document_id=chunk["document_id"],
                    title=chunk["title"],
                    chunk_text=chunk["chunk_text"],
                    embedding=chunk.get("embedding"),
                    source_location=chunk["source_location"],
                    permission_scope=chunk["permission_scope"],
                    status=chunk["status"],
                ))
            await session.commit()
    except Exception:
        pass


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


async def _list_persisted_documents(source_id: str | None = None, tenant_id: int | None = None) -> list[dict[str, Any]]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    if source_id and source_id not in {"database", "uploaded"}:
        return []
    try:
        async with db_session() as session:
            rows = (await session.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.tenant_id == tenant_id)
            )).scalars().all()
            rows = sorted(
                rows,
                key=lambda row: (
                    DEMO_KNOWLEDGE_DOCUMENT_ORDER.index(row.document_id)
                    if row.document_id in DEMO_KNOWLEDGE_DOCUMENT_ORDER
                    else 999,
                    -(row.updated_at.timestamp() if row.updated_at else 0),
                ),
            )
            links = await _load_document_links(session, [row.document_id for row in rows], tenant_id)
            return [_db_document_payload(row, links.get(row.document_id, [])) for row in rows]
    except Exception:
        return []


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


def _is_identity_question(query: str) -> bool:
    normalized = query.strip().lower()
    identity_terms = ["你是谁", "who are you", "介绍自己", "你的身份", "你能做什么"]
    return any(term in normalized for term in identity_terms)


def _knowledge_agent_answer(
    *,
    query: str,
    title: str,
    evidence: list[dict[str, Any]],
    history: list[AIMessage],
) -> str:
    history_hint = "，我会结合前面的追问继续收敛上下文" if history else ""
    if evidence:
        source_names = [
            str(item.get("title") or item.get("document_title") or item.get("source_file_name") or item.get("document_id"))
            for item in evidence[:3]
        ]
        return (
            f"我已基于《{title}》和 {len(evidence)} 条知识证据{history_hint}形成回答。"
            f"当前问题是：{query}。建议优先复核这些来源：{'、'.join(source_names)}；"
            "如需发布到图谱，应先确认候选实体、关系和证据段落。"
        )
    return (
        f"我已记录这次关于《{title}》的追问{history_hint}。当前知识库没有检索到强匹配证据，"
        "建议先补充文档片段或切换到抽取结果页确认候选实体。"
    )


async def _generate_knowledge_agent_answer(
    *,
    query: str,
    title: str,
    evidence: list[dict[str, Any]],
    history: list[AIMessage],
    tenant_profile=None,
    tenant_id: int | None = None,
    memory: list[dict[str, Any]] | None = None,
    intent: str | None = None,
) -> tuple[str, str, dict[str, Any]]:
    await load_persisted_ai_settings()
    return await agent_runtime.answer_knowledge(
        query=query,
        title=title,
        evidence=evidence,
        history=history,
        tenant_profile=tenant_profile,
        tenant_id=tenant_id,
        provider_config=settings_to_provider_config(settings_snapshot()),
        memory=memory or [],
        intent=intent,
    )


def _directory_document_count(directory_id: str, tenant_id: int) -> int:
    tenant_uploads = [item for item in INGESTED_DOCUMENTS.values() if _record_belongs_to_tenant(item, tenant_id)]
    static_documents = _static_knowledge_documents()
    if directory_id == "dir-quality":
        return sum(1 for item in static_documents if item["source_id"] in {"quality-sop", "historical-capa"})
    if directory_id == "dir-enterprise":
        return len(static_documents) + len(tenant_uploads)
    if directory_id == "dir-personal":
        return sum(1 for item in tenant_uploads if item.get("owner_user_id") == "demo-user")
    return 0


def _directory_payload(directory: dict[str, Any], tenant_id: int) -> dict[str, Any]:
    return {**directory, "tenant_id": directory.get("tenant_id") or tenant_id}


def _directory_tree(tenant_id: int) -> list[dict[str, Any]]:
    by_parent: dict[str | None, list[dict[str, Any]]] = {}
    for directory in KNOWLEDGE_DIRECTORIES:
        payload = {
            **_directory_payload(directory, tenant_id),
            "document_count": _directory_document_count(directory["id"], tenant_id),
            "children": [],
        }
        by_parent.setdefault(directory.get("parent_id"), []).append(payload)
    for children in by_parent.values():
        children.sort(key=lambda item: (item["sort_order"], item["name"]))
    for directory in [item for children in by_parent.values() for item in children]:
        directory["children"] = by_parent.get(directory["id"], [])
    return by_parent.get(None, [])


@router.get("/sources")
async def list_sources():
    return {"data": KNOWLEDGE_SOURCES}


@router.get("/spaces")
async def list_spaces():
    return {"data": KNOWLEDGE_SPACES}


@router.get("/directories")
async def list_directories(user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    return {
        "data": {
            "items": [_directory_payload(item, tenant_id) for item in KNOWLEDGE_DIRECTORIES],
            "tree": _directory_tree(tenant_id),
        }
    }


@router.post("/directories")
async def create_directory(body: KnowledgeDirectoryCreateBody, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Directory name cannot be empty")
    if body.parent_id and not any(item["id"] == body.parent_id for item in KNOWLEDGE_DIRECTORIES):
        raise HTTPException(status_code=404, detail="Parent directory not found")
    now = datetime.now().isoformat()
    record = {
        "id": f"dir-{uuid.uuid4().hex[:12]}",
        "name": body.name.strip(),
        "parent_id": body.parent_id,
        "scope": body.scope,
        "owner_user_id": body.owner_user_id or _user_key(user),
        "tenant_id": tenant_id,
        "sort_order": body.sort_order,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    KNOWLEDGE_DIRECTORIES.append(record)
    return {"data": record, "ok": True}


@router.put("/directories/{directory_id}")
async def update_directory(directory_id: str, body: KnowledgeDirectoryUpdateBody, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    record = next((item for item in KNOWLEDGE_DIRECTORIES if item["id"] == directory_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Knowledge directory not found")
    if record.get("tenant_id") and record.get("tenant_id") != tenant_id:
        raise HTTPException(status_code=404, detail="Knowledge directory not found")
    if body.parent_id and not any(item["id"] == body.parent_id for item in KNOWLEDGE_DIRECTORIES):
        raise HTTPException(status_code=404, detail="Parent directory not found")
    updates = body.model_dump(exclude_unset=True)
    if "name" in updates and not str(updates["name"]).strip():
        raise HTTPException(status_code=400, detail="Directory name cannot be empty")
    record.update({key: value for key, value in updates.items() if value is not None})
    if body.name is not None:
        record["name"] = body.name.strip()
    record["updated_at"] = datetime.now().isoformat()
    return {"data": record, "ok": True}


@router.post("/directories/{directory_id}/move")
async def move_directory(directory_id: str, body: KnowledgeDirectoryMoveBody, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    record = next((item for item in KNOWLEDGE_DIRECTORIES if item["id"] == directory_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Knowledge directory not found")
    if record.get("tenant_id") and record.get("tenant_id") != tenant_id:
        raise HTTPException(status_code=404, detail="Knowledge directory not found")
    if body.parent_id and not any(item["id"] == body.parent_id for item in KNOWLEDGE_DIRECTORIES):
        raise HTTPException(status_code=404, detail="Parent directory not found")
    if body.parent_id == directory_id:
        raise HTTPException(status_code=400, detail="Directory cannot be moved under itself")
    record["parent_id"] = body.parent_id
    record["sort_order"] = body.sort_order
    record["updated_at"] = datetime.now().isoformat()
    return {"data": record, "ok": True}


@router.post("/agent/conversations")
async def create_or_resume_agent_conversation(
    body: KnowledgeAgentConversationBody,
    user: dict = Depends(get_current_user),
):
    user_key = _user_key(user)
    tenant_id = current_tenant_id(user)
    document_id = body.document_id or "general"
    title = body.document_title or "Knowledge assistant conversation"
    page = body.page or "knowledge-center"
    async with db_session() as session:
        existing = await session.scalar(
            select(AIConversation)
            .where(
                AIConversation.tenant_id == tenant_id,
                AIConversation.user_id == user_key,
                AIConversation.page == page,
                AIConversation.document_id == document_id,
                AIConversation.status == "active",
            )
            .order_by(desc(AIConversation.updated_at))
        )
        if existing:
            existing.title = title
            if body.metadata:
                existing.metadata_json = {**(existing.metadata_json or {}), **body.metadata}
            await session.commit()
            await session.refresh(existing)
            return {"data": _serialize_conversation(existing), "ok": True}

        record = AIConversation(
            tenant_id=tenant_id,
            conversation_id=f"conv-{uuid.uuid4().hex[:12]}",
            user_id=user_key,
            page=page,
            document_id=document_id,
            title=title,
            status="active",
            metadata_json=body.metadata or {},
        )
        session.add(record)
        await session.commit()
        await session.refresh(record)
        return {"data": _serialize_conversation(record), "ok": True}


@router.get("/agent/conversations")
async def list_agent_conversations(
    document_id: str | None = None,
    page: str = "knowledge-center",
    limit: int = 20,
    user: dict = Depends(get_current_user),
):
    user_key = _user_key(user)
    tenant_id = current_tenant_id(user)
    async with db_session() as session:
        stmt = (
            select(AIConversation)
            .where(AIConversation.tenant_id == tenant_id, AIConversation.user_id == user_key, AIConversation.page == page)
            .order_by(desc(AIConversation.updated_at))
            .limit(max(1, min(limit, 100)))
        )
        if document_id:
            stmt = stmt.where(AIConversation.document_id == document_id)
        rows = (await session.execute(stmt)).scalars().all()
        return {"data": [_serialize_conversation(row) for row in rows]}


@router.get("/agent/conversations/{conversation_id}/messages")
async def list_agent_messages(
    conversation_id: str,
    user: dict = Depends(get_current_user),
):
    user_key = _user_key(user)
    tenant_id = current_tenant_id(user)
    async with db_session() as session:
        tenant_profile = await load_tenant_profile(tenant_id, session=session)
        conversation = await session.scalar(
            select(AIConversation).where(
                AIConversation.tenant_id == tenant_id,
                AIConversation.conversation_id == conversation_id,
                AIConversation.user_id == user_key,
            )
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Agent conversation not found")
        messages = (
            await session.execute(
                select(AIMessage)
                .where(AIMessage.tenant_id == tenant_id, AIMessage.conversation_id == conversation_id)
                .order_by(AIMessage.id)
            )
        ).scalars().all()
        return {"data": [_serialize_message(row) for row in messages]}


@router.post("/agent/conversations/{conversation_id}/messages")
async def send_agent_message(
    conversation_id: str,
    body: KnowledgeAgentMessageBody,
    user: dict = Depends(get_current_user),
):
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message content cannot be empty")

    user_key = _user_key(user)
    tenant_id = current_tenant_id(user)
    async with db_session() as session:
        tenant_profile = await load_tenant_profile(tenant_id, session=session)
        conversation = await session.scalar(
            select(AIConversation).where(
                AIConversation.tenant_id == tenant_id,
                AIConversation.conversation_id == conversation_id,
                AIConversation.user_id == user_key,
            )
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Agent conversation not found")

        history = (
            await session.execute(
                select(AIMessage)
                .where(AIMessage.tenant_id == tenant_id, AIMessage.conversation_id == conversation_id)
                .order_by(desc(AIMessage.id))
                .limit(12)
            )
        ).scalars().all()
        intent = agent_runtime.classify_knowledge_intent(content)
        evidence = await _search_knowledge_payload_async(content, limit=5, document_id=conversation.document_id, tenant_id=tenant_id) if intent == "knowledge" else []
        if intent == "knowledge" and (
            not evidence or any(term in content for term in ["document", "content", "contains", "summary", "summarize", "what is", "文档", "内容", "包含", "总结", "概括"])
        ):
            by_id = {item.get("id") or item.get("chunk_id") or item.get("source_location"): item for item in evidence}
            for item in await _document_context_payload_async(conversation.document_id, tenant_id):
                key = item.get("id") or item.get("chunk_id") or item.get("source_location")
                by_id.setdefault(key, item)
            evidence = list(by_id.values())[:5]
        memory_context = await memory_service.retrieve_context(
            session,
            tenant_id=tenant_id,
            user_key=user_key,
            conversation_id=conversation_id,
            page=conversation.page,
            document_id=conversation.document_id,
            query=content,
            limit=6,
        )
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        user_message = AIMessage(
            tenant_id=tenant_id,
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            role="user",
            content=content,
            evidence=[],
            status="completed",
        )
        answer, model_name, usage = await _generate_knowledge_agent_answer(
            query=content,
            title=conversation.title,
            evidence=evidence,
            history=list(reversed(history)),
            tenant_profile=tenant_profile,
            tenant_id=tenant_id,
            memory=memory_context,
            intent=intent,
        )
        assistant_message = AIMessage(
            tenant_id=tenant_id,
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            role="assistant",
            content=answer,
            evidence=evidence,
            model_name=model_name,
            usage=usage,
            status="completed",
        )
        steps = [
            {"id": "step-context", "type": "observe", "status": "completed", "summary": conversation.title},
            {"id": "step-history", "type": "memory", "status": "completed", "message_count": len(history)},
            {
                "id": "step-knowledge-search",
                "type": "tool",
                "tool": "knowledge.search",
                "status": "skipped" if intent == "general" else "completed",
                "result_count": len(evidence),
            },
            {"id": "step-answer", "type": "respond", "status": "completed", "model": model_name, "mode": usage.get("mode")},
        ]
        run = AIAgentRun(
            tenant_id=tenant_id,
            run_id=run_id,
            conversation_id=conversation_id,
            user_message_id=user_message.message_id,
            assistant_message_id=assistant_message.message_id,
            status="completed",
            mode="qa",
            input_message=content,
            answer=answer,
            items=items_from_steps(steps, run_id=run_id),
            evidence=evidence,
            risk_level="low",
            requires_confirmation=False,
        )
        tool_call = AIToolCall(
            tenant_id=tenant_id,
            call_id=f"call-{uuid.uuid4().hex[:12]}",
            run_id=run_id,
            tool_name="knowledge.search",
            skill_name="knowledge.answer_question",
            input={"query": content, "limit": 5, "document_id": conversation.document_id, "tenant_id": tenant_id},
            output={"result_count": len(evidence), "results": evidence},
            status="completed",
            duration_ms=0,
        )
        memory = await memory_service.append_turn_memory(
            session,
            conversation=conversation,
            run=run,
            user_message=user_message,
            assistant_message=assistant_message,
            evidence=evidence,
            tenant_id=tenant_id,
            user_key=user_key,
            status="candidate",
        )
        conversation.last_message = content
        conversation.metadata_json = {**(conversation.metadata_json or {}), "last_run_id": run_id}

        session.add_all([user_message, assistant_message, run, tool_call, memory])
        await session.commit()
        await session.refresh(conversation)
        await session.refresh(user_message)
        await session.refresh(assistant_message)
        await session.refresh(run)
        conversation_payload = _serialize_conversation(conversation)
        user_message_payload = _serialize_message(user_message)
        assistant_message_payload = _serialize_message(assistant_message)
        run_payload = _serialize_run(run)

    await write_audit_log(
        action="ai_agent_message",
        resource_type="ai_agent_run",
        resource_id=None,
        new_values={"run_id": run_id, "conversation_id": conversation_id, "message": content[:300]},
        user_id=current_user_id(user),
    )

    return {
        "data": {
            "conversation": conversation_payload,
            "user_message": user_message_payload,
            "assistant_message": assistant_message_payload,
            "run": run_payload,
            "evidence": evidence,
        },
        "ok": True,
    }


@router.get("/documents")
async def list_documents(source_id: str | None = None, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    documents = [] if source_id == "database" else _static_knowledge_documents()
    if source_id and source_id != "database":
        documents = [item for item in documents if item["source_id"] == source_id]
    persisted = await _list_persisted_documents(source_id, tenant_id)
    ingested = [
        {
            "id": item["document_id"],
            "tenant_id": item["tenant_id"],
            "source_id": "uploaded",
            "title": item["title"],
            "doc_type": item["source_type"],
            "status": item["status"],
            "updated_at": item["updated_at"],
            "summary": f"Uploaded knowledge asset: {item['source_file_name']}",
            "ocr_status": "ready" if item.get("ocr_result") else None,
            "ocr_result": item.get("ocr_result"),
            "linked_objects": [],
        }
        for item in INGESTED_DOCUMENTS.values()
        if _record_belongs_to_tenant(item, tenant_id)
    ]
    persisted_ids = {item["id"] for item in persisted}
    ingested = [item for item in ingested if item["id"] not in persisted_ids]
    return {"data": [*documents, *persisted, *ingested]}


@router.post("/assets/upload")
async def upload_knowledge_asset(
    file: UploadFile = File(...),
    permission_scope: str = "enterprise",
    owner_user_id: str = "demo-user",
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    content = await file.read()
    result = ingest_asset(
        file_name=file.filename or "uploaded-asset",
        content=content,
        owner_user_id=owner_user_id,
        permission_scope=permission_scope,
        tenant_id=tenant_id,
    )
    if result.get("job"):
        result["job"]["tenant_id"] = tenant_id
        INGESTION_JOBS[result["job"]["job_id"]]["tenant_id"] = tenant_id
    if result.get("document"):
        result["document"]["tenant_id"] = tenant_id
        result["intake_recommendation"] = build_intake_recommendation_from_document(result["document"])
    await persist_ingestion_result(result, tenant_id=tenant_id)
    if result["job"]["status"] == "failed":
        return {"data": result, "ok": False}
    return {"data": result, "ok": True}


@router.post("/documents/{document_id}/ontology-intake")
async def create_document_ontology_intake(
    document_id: str,
    body: OntologyIntakeBody | None = None,
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    document = _ingested_document_for_tenant(document_id, tenant_id)
    if not document:
        document = await _get_persisted_document(document_id, tenant_id)
    if not document:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    recommendation = build_intake_recommendation_from_document({
        **document,
        "document_id": document.get("document_id") or document.get("id") or document_id,
    })
    recommendation["request"] = {
        "domain_hint": (body.domain_hint if body else "manufacturing"),
        "mode": (body.mode if body else "recommend"),
    }
    return {"data": recommendation, "ok": True}


@router.post("/documents/{document_id}/extraction-jobs")
async def create_document_knowledge_extraction_job(
    document_id: str,
    body: DocumentExtractionJobBody | None = None,
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    request = body or DocumentExtractionJobBody()
    result = await create_extraction_job_from_document(
        document_id,
        domain=request.domain,
        prompt_name=request.prompt_name,
        model_name=request.model_name,
        tenant_id=tenant_id,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Knowledge document not found or has no extracted text")
    return {"data": result, "ok": True}


@router.post("/extraction-jobs")
async def create_knowledge_extraction_job(
    file: UploadFile = File(...),
    domain: str = Form("manufacturing"),
    prompt_name: str = Form("manufacturing_ontology_v1"),
    model_name: str = Form("rules-ontology-extractor"),
    permission_scope: str = Form("enterprise"),
    owner_user_id: str = Form("demo-user"),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    content = await file.read()
    try:
        result = await create_extraction_job(
            file_name=file.filename or "uploaded-asset",
            content=content,
            domain=domain,
            prompt_name=prompt_name,
            model_name=model_name,
            owner_user_id=owner_user_id,
            permission_scope=permission_scope,
            tenant_id=tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"data": result, "ok": True}


@router.get("/extraction-jobs/{job_id}")
async def get_knowledge_extraction_job(job_id: str, user: dict = Depends(get_current_user)):
    job = await get_extraction_job(job_id, tenant_id=current_tenant_id(user))
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    return {"data": job}


@router.post("/extraction-jobs/{job_id}/approve")
async def approve_knowledge_extraction_job(job_id: str, body: ExtractionApproveBody | None = None, user: dict = Depends(get_current_user)):
    job = await approve_extraction_job(job_id, body.approved_result if body else None, tenant_id=current_tenant_id(user))
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    return {"data": job, "ok": job["status"] != "blocked"}


@router.post("/extraction-jobs/{job_id}/commit-to-graph")
async def commit_knowledge_extraction_job_to_graph(job_id: str, user: dict = Depends(get_current_user)):
    try:
        result = await commit_extraction_to_graph(job_id, tenant_id=current_tenant_id(user))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    return {"data": result, "ok": True}


@router.get("/extraction-jobs/{job_id}/export")
async def export_knowledge_extraction_job(job_id: str, format: str = "json", user: dict = Depends(get_current_user)):
    job = await get_extraction_job(job_id, tenant_id=current_tenant_id(user))
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    try:
        media_type, suffix, content = export_extraction(job, format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    headers = {"Content-Disposition": f'attachment; filename="{job_id}.{suffix}"'}
    return Response(content=content, media_type=media_type, headers=headers)


@router.get("/ingestion-jobs/{job_id}")
async def get_ingestion_job(job_id: str, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    job = INGESTION_JOBS.get(job_id)
    if job and not _record_belongs_to_tenant(job, tenant_id):
        job = None
    if not job:
        try:
            from app.models.relational import KnowledgeIngestionJob

            async with db_session() as session:
                row = await session.scalar(
                    select(KnowledgeIngestionJob).where(
                        KnowledgeIngestionJob.tenant_id == tenant_id,
                        KnowledgeIngestionJob.job_id == job_id,
                    )
                )
                if row:
                    job = {
                        "job_id": row.job_id,
                        "asset_id": row.asset_id,
                        "document_id": row.document_id,
                        "status": row.status,
                        "error": row.error,
                        "created_at": _now_iso(row.created_at),
                        "updated_at": _now_iso(row.updated_at),
                    }
        except Exception:
            job = None
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge ingestion job not found")
    return {"data": job}


@router.get("/documents/{document_id}")
async def get_document(document_id: str, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    ingested = _ingested_document_for_tenant(document_id, tenant_id)
    if ingested:
        return {"data": ingested}
    persisted = await _get_persisted_document(document_id, tenant_id)
    if persisted:
        return {"data": persisted}
    document = next((item for item in _static_knowledge_documents() if item["id"] == document_id), None)
    if not document:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    return {"data": document}


@router.get("/documents/{document_id}/markdown")
async def get_document_markdown(document_id: str, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    ingested = _ingested_document_for_tenant(document_id, tenant_id)
    if not ingested:
        persisted = await _get_persisted_document(document_id, tenant_id)
        if persisted:
            return {
                "data": {
                    "document_id": document_id,
                    "markdown_content": persisted["markdown_content"],
                    "source_file_name": persisted["source_file_name"],
                }
            }
        raise HTTPException(status_code=404, detail="Markdown document not found")
    return {
        "data": {
            "document_id": document_id,
            "markdown_content": ingested["markdown_content"],
            "source_file_name": ingested["source_file_name"],
        }
    }


@router.get("/documents/{document_id}/ocr")
async def get_document_ocr(document_id: str, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    ingested = _ingested_document_for_tenant(document_id, tenant_id)
    if not ingested:
        persisted = await _get_persisted_document(document_id, tenant_id)
        if persisted and persisted.get("ocr_result"):
            return {"data": {"document_id": document_id, **persisted["ocr_result"]}}
        raise HTTPException(status_code=404, detail="OCR result not found")
    ocr_result = ingested.get("ocr_result")
    if not ocr_result:
        raise HTTPException(status_code=404, detail="OCR result not found")
    return {"data": {"document_id": document_id, **ocr_result}}


@router.put("/documents/{document_id}/ocr/corrections")
async def save_document_ocr_corrections(document_id: str, body: OcrCorrectionBody, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    document = update_ocr_corrections(document_id, body.blocks, tenant_id=tenant_id)
    if not document:
        raise HTTPException(status_code=404, detail="OCR document not found")
    await _persist_document_and_chunks(document, tenant_id)
    return {"data": {"document_id": document_id, **(document.get("ocr_result") or {})}, "ok": True}


@router.post("/documents/{document_id}/ocr/enhance")
async def enhance_document_ocr(document_id: str, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    document = _ingested_document_for_tenant(document_id, tenant_id)
    if not document:
        raise HTTPException(status_code=404, detail="OCR document not found")
    source_path = document.get("source_path")
    if not source_path or not Path(source_path).exists():
        raise HTTPException(status_code=404, detail="Original source file is not available for OCR enhancement")
    try:
        content = Path(source_path).read_bytes()
        ocr_result = ocr_extract(document["source_file_name"], content, force_vision=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    document["ocr_result"] = ocr_result
    document["markdown_content"] = ocr_result["markdown_content"]
    for chunk_id in [
        chunk_id
        for chunk_id, chunk in INGESTED_CHUNKS.items()
        if chunk["document_id"] == document_id and _record_belongs_to_tenant(chunk, tenant_id)
    ]:
        INGESTED_CHUNKS.pop(chunk_id, None)
    for chunk in markdown_to_chunks(
        document["markdown_content"],
        document_id,
        document["permission_scope"],
        tenant_id=tenant_id,
    ):
        INGESTED_CHUNKS[chunk["chunk_id"]] = chunk
    await _persist_document_and_chunks(document, tenant_id)
    return {"data": {"document_id": document_id, **ocr_result}, "ok": True}


@router.get("/documents/{document_id}/chunks")
async def list_document_chunks(document_id: str, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    if _ingested_document_for_tenant(document_id, tenant_id):
        chunks = _ingested_chunks_for_tenant(document_id, tenant_id)
        return {"data": chunks}
    persisted = await _list_persisted_chunks(document_id, tenant_id)
    if persisted:
        return {"data": persisted}
    if not any(item["id"] == document_id for item in _static_knowledge_documents()):
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    chunks = [chunk for chunk in _static_knowledge_chunks() if chunk["document_id"] == document_id]
    return {"data": [_chunk_payload(chunk) for chunk in chunks]}


@router.get("/cards")
async def list_cards(space_id: str | None = None, status: str | None = None):
    cards = _static_knowledge_cards()
    if space_id:
        cards = [item for item in cards if item["space_id"] == space_id]
    if status:
        cards = [item for item in cards if item["status"] == status]
    return {"data": [_card_payload(card) for card in cards]}


@router.get("/cards/{card_id}")
async def get_card(card_id: str):
    card = next((item for item in _static_knowledge_cards() if item["id"] == card_id), None)
    if not card:
        raise HTTPException(status_code=404, detail="Knowledge card not found")
    return {"data": _card_payload(card)}


@router.get("/related-cards")
async def get_related_cards(object_type: str | None = None, object_id: str | None = None, limit: int = 4):
    cards = [
        _card_payload(card)
        for card in _static_knowledge_cards()
        if _matches_card(card, object_type, object_id)
    ]
    return {"data": cards[: max(1, min(limit, 10))]}


@router.post("/binding-candidates")
async def suggest_binding_candidates(body: BindingCandidateBody):
    text = body.text.strip().lower()
    if not text:
        raise HTTPException(status_code=400, detail="Binding text cannot be empty")

    results = []
    for candidate in DATA_CLEANING_CANDIDATES:
        haystack = " ".join([
            candidate["text"],
            candidate["object_type"],
            candidate["object_id"],
            candidate["object_name"],
            *candidate["alias"],
        ]).lower()
        if any(token and token in haystack for token in text.split()) or candidate["text"].lower() in text:
            results.append(candidate)

    if not results:
        results = sorted(DATA_CLEANING_CANDIDATES, key=lambda item: item["confidence"], reverse=True)[:3]

    return {"data": results[: max(1, min(body.limit, 20))]}


@router.get("/ocr-pipeline")
async def get_ocr_pipeline():
    return {"data": OCR_PIPELINE_STEPS}


@router.get("/related")
async def get_related_knowledge(object_type: str | None = None, object_id: str | None = None, limit: int = 4, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    matched_documents = []
    if _static_knowledge_runtime_enabled():
        matched_documents = [
            document
            for document in _static_knowledge_documents()
            if _matches_object(document, object_type, object_id)
        ]
    related = []
    for document in matched_documents:
        chunks = [chunk for chunk in _static_knowledge_chunks() if chunk["document_id"] == document["id"]]
        first_chunk = chunks[0] if chunks else None
        source = _source_by_id(document["source_id"])
        related.append({
            **document,
            "source_name": source["name"],
            "source_type": source["type"],
            "source_ref": first_chunk["source_ref"] if first_chunk else document["title"],
            "chunk_text": first_chunk["chunk_text"] if first_chunk else document["summary"],
            "score": 0.88 if object_type or object_id else 0.72,
        })
    persisted = []
    try:
        async with db_session() as session:
            link_stmt = select(KnowledgeObjectLink).where(KnowledgeObjectLink.tenant_id == tenant_id)
            if object_type:
                link_stmt = link_stmt.where(KnowledgeObjectLink.object_type == object_type)
            if object_id:
                normalized = f"%{object_id}%"
                link_stmt = link_stmt.where(
                    KnowledgeObjectLink.object_id.ilike(normalized)
                    | KnowledgeObjectLink.object_name.ilike(normalized)
                )
            links = (await session.execute(link_stmt)).scalars().all()
            document_ids = list({link.document_id for link in links})
            if document_ids:
                documents = (
                    await session.execute(
                        select(KnowledgeDocument).where(
                            KnowledgeDocument.tenant_id == tenant_id,
                            KnowledgeDocument.document_id.in_(document_ids),
                        )
                    )
                ).scalars().all()
                first_chunks = {
                    chunk.document_id: chunk
                    for chunk in (
                        await session.execute(
                            select(KnowledgeChunk).where(
                                KnowledgeChunk.tenant_id == tenant_id,
                                KnowledgeChunk.document_id.in_(document_ids),
                            )
                        )
                    ).scalars().all()
                }
                link_map = await _load_document_links(session, document_ids, tenant_id)
                for document in documents:
                    first_chunk = first_chunks.get(document.document_id)
                    persisted.append({
                        **_db_document_payload(document, link_map.get(document.document_id, [])),
                        "source_name": document.source_file_name,
                        "source_type": document.source_type,
                        "source_ref": first_chunk.source_location if first_chunk else document.source_file_name,
                        "chunk_text": first_chunk.chunk_text if first_chunk else document.markdown_content[:500],
                        "score": 0.9,
                    })
    except Exception:
        persisted = []
    return {"data": [*persisted, *related][: max(1, min(limit, 10))]}


@router.post("/search")
async def search_knowledge(body: KnowledgeSearchBody, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")
    results = await _search_knowledge_payload_async(
        query,
        limit=body.limit,
        object_type=body.object_type,
        object_id=body.object_id,
        tenant_id=tenant_id,
    )

    return {
        "data": {
            "query": query,
            "answer": (
                "\u5df2\u68c0\u7d22\u5230\u76f8\u5173\u77e5\u8bc6\u8bc1\u636e\u3002\u8bf7\u7ed3\u5408 results \u4e2d\u7684\u6765\u6e90\u3001\u7247\u6bb5\u548c\u5173\u8054\u5bf9\u8c61\u8fdb\u884c\u590d\u6838\u3002"
                if results
                else "\u5f53\u524d\u79df\u6237\u77e5\u8bc6\u5e93\u672a\u68c0\u7d22\u5230\u53ef\u7528\u8bc1\u636e\u3002\u8bf7\u5148\u4e0a\u4f20\u6216\u7d22\u5f15\u76f8\u5173\u6587\u6863\u540e\u518d\u8bd5\u3002"
            ),
            "results": results,
        }
    }
