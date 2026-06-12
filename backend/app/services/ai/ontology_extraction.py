"""Document-to-ontology extraction workflow.

The extractor is deterministic by default when no external LLM is configured.
The public service shape is intentionally close to a real LLM pipeline: parse
source material, produce ontology candidates, generate a quality report, require
approval, then commit approved candidates to graph.
"""

from __future__ import annotations

import csv
import io
import json
import re
import uuid
import asyncio
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.db import db_session
from app.core.logging import get_logger
from app.models.relational import (
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeExtractionResult,
    KnowledgeIngestionJob,
    KnowledgeObjectLink,
)
from app.services.ai.tenant_context import require_tenant_id
from app.services.ai.knowledge_ingestion import (
    CHUNKS,
    DOCUMENTS,
    JOBS,
    markdown_to_chunks,
    parse_to_markdown_with_metadata,
)
from app.services.ai.ocr_service import save_original_asset
from app.services.ontology_candidate_service import upsert_candidate

logger = get_logger(__name__)

EXTRACTION_JOBS: dict[str, dict[str, Any]] = {}


def _record_belongs_to_tenant(record: dict[str, Any], tenant_id: int) -> bool:
    try:
        return require_tenant_id(record) == tenant_id
    except ValueError:
        return False


GENERIC_TYPE_MAP: dict[str, str] = {
    "Supplier": "Organization",
    "Customer": "Organization",
    "Equipment": "Asset",
    "MaterialBatch": "Material",
    "Material": "Material",
    "WorkOrder": "Process",
    "QualityEvent": "Event",
    "CAPA": "Process",
    "KnowledgeCard": "Document",
}

MANUFACTURING_DOMAIN_TYPES = {
    "Supplier",
    "Customer",
    "Equipment",
    "MaterialBatch",
    "Material",
    "WorkOrder",
    "QualityEvent",
    "CAPA",
}

SUPPORTED_SOURCE_TYPES = {"markdown", "unknown", "pdf", "excel"}
ENTITY_TYPES = [
    "Supplier",
    "Material",
    "MaterialBatch",
    "Equipment",
    "WorkOrder",
    "Defect",
    "QualityEvent",
    "CAPA",
    "Customer",
    "Product",
]

KEYWORD_TYPES = {
    "supplier": "Supplier",
    "vendor": "Supplier",
    "供应商": "Supplier",
    "material": "Material",
    "物料": "Material",
    "batch": "MaterialBatch",
    "批次": "MaterialBatch",
    "equipment": "Equipment",
    "device": "Equipment",
    "设备": "Equipment",
    "work order": "WorkOrder",
    "工单": "WorkOrder",
    "defect": "Defect",
    "缺陷": "Defect",
    "quality": "QualityEvent",
    "异常": "QualityEvent",
    "capa": "CAPA",
    "customer": "Customer",
    "客户": "Customer",
    "product": "Product",
    "产品": "Product",
}

KNOWN_OBJECTS = {
    "Supplier": ["北辰电子材料", "Beichen", "SUP-BEICHEN"],
    "MaterialBatch": ["MB-7781", "S12"],
    "Equipment": ["SMT-03", "回流焊"],
    "Defect": ["焊点虚焊", "空焊", "BGA"],
    "WorkOrder": ["WO-260521-017"],
}


def _now() -> str:
    return datetime.now().isoformat()


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _status_counts(quality_report: dict[str, Any]) -> dict[str, int]:
    counts = {"FATAL": 0, "ERROR": 0, "WARNING": 0, "INFO": 0}
    for item in quality_report.get("items", []):
        severity = item.get("severity", "INFO")
        counts[severity] = counts.get(severity, 0) + 1
    return counts


def _safe_name(text: str) -> str:
    text = re.sub(r"^[#\-\*\d\.\s]+", "", text).strip()
    text = re.sub(r"\s+", " ", text)
    return text[:120] or "Unnamed ontology object"


def parse_llm_extraction_json(content: str) -> dict[str, Any]:
    """Parse and normalize an LLM JSON extraction response."""
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM JSON parse failed: {exc.msg}") from exc

    required = ("entities", "relations", "logic_rules", "actions")
    missing = [key for key in required if key not in payload]
    if missing:
        raise ValueError(f"LLM extraction response missing fields: {', '.join(missing)}")

    for key in required:
        if not isinstance(payload[key], list):
            raise ValueError(f"LLM extraction field must be a list: {key}")
    return {key: payload[key] for key in required}


def _line_candidates(markdown: str) -> list[tuple[int, str]]:
    lines = []
    for index, raw in enumerate(markdown.splitlines(), start=1):
        line = raw.strip()
        if len(line) < 3:
            continue
        if line.startswith("|") and line.endswith("|"):
            continue
        if line.startswith("#") or ":" in line or "：" in line or re.search(r"\b[A-Z]{2,}-?\d{2,}", line):
            lines.append((index, line))
    return lines[:40]


def deterministic_extract(markdown: str, *, domain: str = "manufacturing") -> dict[str, Any]:
    """Create ontology candidates from source text without external network calls."""
    entities: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for line_no, line in _line_candidates(markdown):
        lower = line.lower()
        entity_type = next((value for key, value in KEYWORD_TYPES.items() if key in lower or key in line), None)
        if not entity_type:
            token = re.search(r"\b(?:WO|SO|MB|QE|CAPA|SMT|SUP)-?[A-Z0-9\-]+\b", line)
            entity_type = "WorkOrder" if token and token.group(0).startswith("WO") else None
            if token and token.group(0).startswith("MB"):
                entity_type = "MaterialBatch"
            if token and token.group(0).startswith("CAPA"):
                entity_type = "CAPA"
            if token and token.group(0).startswith("QE"):
                entity_type = "QualityEvent"
        if not entity_type:
            continue

        name = _safe_name(line.split(":", 1)[-1].split("：", 1)[-1])
        key = (entity_type, name.lower())
        if key in seen:
            continue
        seen.add(key)
        confidence = 0.86 if any(alias in line for alias in KNOWN_OBJECTS.get(entity_type, [])) else 0.68
        entities.append({
            "candidate_id": _id("ent"),
            "name": name,
            "entity_type": entity_type,
            "description": f"Extracted {entity_type} candidate from {domain} source material.",
            "confidence": confidence,
            "source_location": f"line:{line_no}",
            "status": "candidate",
        })

    relations = []
    if len(entities) >= 2:
        for left, right in zip(entities, entities[1:]):
            relations.append({
                "candidate_id": _id("rel"),
                "source_candidate_id": left["candidate_id"],
                "source_name": left["name"],
                "source_type": left["entity_type"],
                "target_candidate_id": right["candidate_id"],
                "target_name": right["name"],
                "target_type": right["entity_type"],
                "relation_type": "RELATED_TO",
                "confidence": min(left["confidence"], right["confidence"], 0.76),
                "source_location": right["source_location"],
                "status": "candidate",
            })

    logic_rules = []
    if re.search(r"\b(must|required|shall|应|必须|需要|不得|禁止)\b", markdown, flags=re.I):
        logic_rules.append({
            "candidate_id": _id("rule"),
            "name": "Source compliance rule",
            "condition": "When the extracted manufacturing condition is observed",
            "conclusion": "The referenced operating requirement must be reviewed before release",
            "confidence": 0.72,
            "source_location": "document",
            "status": "candidate",
        })

    actions = []
    if re.search(r"\b(freeze|containment|review|notify|create|隔离|冻结|复核|通知|生成)\b", markdown, flags=re.I):
        actions.append({
            "candidate_id": _id("act"),
            "trigger_condition": "Relevant quality or supply-chain risk is confirmed",
            "recommended_action": "Create a review task and attach source evidence before graph commit",
            "related_object": entities[0]["name"] if entities else None,
            "confidence": 0.7,
            "source_location": "document",
            "status": "candidate",
        })

    return normalize_ontology_result({
        "entities": entities,
        "relations": relations,
        "logic_rules": logic_rules,
        "actions": actions,
    }, domain=domain, markdown=markdown)


def normalize_ontology_result(result: dict[str, Any], *, domain: str = "manufacturing", markdown: str = "") -> dict[str, Any]:
    """Add platform-generic ontology fields while preserving the legacy contract."""
    entities = list(result.get("entities") or [])
    relations = list(result.get("relations") or [])
    generic_entities = []
    domain_mappings = []
    properties = []

    for entity in entities:
        entity_type = str(entity.get("entity_type") or "KnowledgeEntity")
        generic_type = GENERIC_TYPE_MAP.get(entity_type, "Object")
        generic_entities.append({
            "candidate_id": entity.get("candidate_id"),
            "name": entity.get("name"),
            "generic_type": generic_type,
            "description": entity.get("description"),
            "confidence": entity.get("confidence", 0),
            "source_location": entity.get("source_location"),
            "evidence": entity.get("source_location"),
        })
        if domain == "manufacturing" or entity_type in MANUFACTURING_DOMAIN_TYPES:
            domain_mappings.append({
                "candidate_id": entity.get("candidate_id"),
                "domain": "manufacturing",
                "domain_type": entity_type,
                "generic_type": generic_type,
                "mapping_status": "candidate",
                "confidence": entity.get("confidence", 0),
                "source_location": entity.get("source_location"),
            })
        if entity.get("name"):
            properties.append({
                "candidate_id": f"{entity.get('candidate_id')}:name",
                "entity_candidate_id": entity.get("candidate_id"),
                "property_name": "name",
                "value": entity.get("name"),
                "confidence": entity.get("confidence", 0),
                "source_location": entity.get("source_location"),
            })
        if entity.get("description"):
            properties.append({
                "candidate_id": f"{entity.get('candidate_id')}:description",
                "entity_candidate_id": entity.get("candidate_id"),
                "property_name": "description",
                "value": entity.get("description"),
                "confidence": max(float(entity.get("confidence") or 0) - 0.05, 0),
                "source_location": entity.get("source_location"),
            })

    result = {
        **result,
        "entities": entities,
        "generic_entities": generic_entities,
        "domain_mappings": domain_mappings,
        "relations": relations,
        "properties": properties,
    }
    if markdown and "document_profile" not in result:
        result["document_profile"] = build_intake_recommendation_from_document({
            "title": next((line.strip("# ").strip() for line in markdown.splitlines() if line.strip().startswith("#")), "") or "Uploaded document",
            "source_type": "markdown",
            "markdown_content": markdown,
            "document_id": "preview",
        })["document_profile"]
    return result


def build_intake_recommendation_from_document(document: dict[str, Any]) -> dict[str, Any]:
    markdown = str(document.get("markdown_content") or "")
    title = str(document.get("title") or document.get("source_file_name") or "Uploaded document")
    source_type = str(document.get("source_type") or "document")
    line_count = len([line for line in markdown.splitlines() if line.strip()])
    word_count = len(re.findall(r"\w+", markdown))
    has_tables = "|" in markdown or source_type in {"excel", "xlsx"}
    has_ocr = bool(document.get("ocr_result"))
    likely_domain = "manufacturing" if any(
        token.lower() in markdown.lower()
        for token in ["work order", "supplier", "equipment", "quality", "capa", "material", "mes", "erp", "工单", "供应商", "设备", "质量", "物料"]
    ) else "general"
    capabilities = [
        "summarize_document",
        "extract_ontology_candidates",
        "bind_existing_objects",
        "prepare_graph_publish",
    ]
    if has_ocr:
        capabilities.insert(1, "review_ocr_evidence")
    profile = {
        "document_id": document.get("document_id"),
        "title": title,
        "source_type": source_type,
        "likely_domain": likely_domain,
        "line_count": line_count,
        "word_count": word_count,
        "has_tables": has_tables,
        "has_ocr": has_ocr,
    }
    return {
        "document_id": document.get("document_id"),
        "document_profile": profile,
        "summary": f"{title} has been indexed as a {source_type} document and is ready for ontology intake.",
        "capabilities": capabilities,
        "suggested_actions": [
            {
                "key": "extract_ontology_candidates",
                "title": "Extract ontology candidates",
                "description": "Identify generic objects, manufacturing mappings, relationships, properties, and source evidence.",
                "requires_confirmation": True,
                "tool": "knowledge.extract_ontology_candidates",
            },
            {
                "key": "summarize_document",
                "title": "Summarize document",
                "description": "Create an evidence-backed document summary without writing graph assets.",
                "requires_confirmation": False,
                "tool": "knowledge.search",
            },
            {
                "key": "prepare_graph_publish",
                "title": "Prepare graph publish checklist",
                "description": "Review quality issues and binding gaps before graph publication.",
                "requires_confirmation": True,
                "tool": "knowledge.commit_ontology_to_graph",
            },
        ],
        "confirmation": {
            "skill": "knowledge.intake_document_ontology",
            "requires_confirmation": True,
            "write_policy": "review_before_extract_then_confirm_before_commit",
        },
    }


def build_quality_report(result: dict[str, Any], *, parse_error: str | None = None) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    if parse_error:
        items.append({
            "severity": "FATAL",
            "code": "LLM_JSON_PARSE_FAILED",
            "message": parse_error,
            "target": "llm_response",
        })

    if not result.get("entities"):
        items.append({
            "severity": "FATAL",
            "code": "NO_ENTITIES",
            "message": "No ontology entities were extracted from the source document.",
            "target": "entities",
        })

    seen_names: set[tuple[str, str]] = set()
    for entity in result.get("entities", []):
        target = f"{entity.get('entity_type')}:{entity.get('name')}"
        key = (str(entity.get("entity_type", "")).lower(), str(entity.get("name", "")).lower())
        if key in seen_names:
            items.append({
                "severity": "WARNING",
                "code": "DUPLICATE_ENTITY_CANDIDATE",
                "message": "Entity candidate appears more than once.",
                "target": target,
            })
        seen_names.add(key)
        if float(entity.get("confidence", 0)) < 0.6:
            items.append({
                "severity": "ERROR",
                "code": "LOW_CONFIDENCE_ENTITY",
                "message": "Entity confidence is below review threshold.",
                "target": target,
            })
        if not entity.get("source_location"):
            items.append({
                "severity": "ERROR",
                "code": "MISSING_EVIDENCE",
                "message": "Entity does not include source evidence.",
                "target": target,
            })
        known_aliases = KNOWN_OBJECTS.get(str(entity.get("entity_type")), [])
        if known_aliases and not any(alias.lower() in str(entity.get("name", "")).lower() for alias in known_aliases):
            items.append({
                "severity": "WARNING",
                "code": "UNBOUND_MASTER_DATA",
                "message": "Candidate may need manual binding to manufacturing master data.",
                "target": target,
            })

    for rel in result.get("relations", []):
        target = f"{rel.get('source_name')}->{rel.get('target_name')}"
        if float(rel.get("confidence", 0)) < 0.6:
            items.append({
                "severity": "ERROR",
                "code": "LOW_CONFIDENCE_RELATION",
                "message": "Relation confidence is below review threshold.",
                "target": target,
            })
        if not rel.get("source_location"):
            items.append({
                "severity": "ERROR",
                "code": "MISSING_EVIDENCE",
                "message": "Relation does not include source evidence.",
                "target": target,
            })

    if not items:
        items.append({
            "severity": "INFO",
            "code": "READY_FOR_REVIEW",
            "message": "Extraction completed and is ready for human review.",
            "target": "job",
        })

    report = {"items": items, "counts": {}, "blocking": False}
    report["counts"] = _status_counts(report)
    report["blocking"] = report["counts"].get("FATAL", 0) > 0
    return report


async def persist_ingestion_result(result: dict[str, Any], tenant_id: int | None = None) -> None:
    """Best-effort persistence for uploaded source material."""
    job = result.get("job") or {}
    document = result.get("document") or {}
    tenant_id = require_tenant_id({"tenant_id": tenant_id or document.get("tenant_id") or job.get("tenant_id")})
    try:
        async with db_session() as session:
            asset = result.get("asset") or {}
            if document:
                existing_doc = await session.scalar(
                    select(KnowledgeDocument).where(
                        KnowledgeDocument.tenant_id == tenant_id,
                        KnowledgeDocument.document_id == document["document_id"],
                    )
                )
                if not existing_doc:
                    session.add(KnowledgeDocument(
                        tenant_id=tenant_id,
                        document_id=document["document_id"],
                        source_file_name=document["source_file_name"],
                        source_type=document["source_type"],
                        title=document["title"],
                        markdown_content=document["markdown_content"],
                        permission_scope=document["permission_scope"],
                        owner_user_id=document.get("owner_user_id"),
                        source_path=document.get("source_path"),
                        ocr_result=document.get("ocr_result"),
                        status=document["status"],
                    ))
                else:
                    existing_doc.markdown_content = document["markdown_content"]
                    existing_doc.source_path = document.get("source_path")
                    existing_doc.ocr_result = document.get("ocr_result")
                    existing_doc.status = document["status"]
                for chunk in result.get("chunks") or []:
                    existing_chunk = await session.scalar(
                        select(KnowledgeChunk).where(
                            KnowledgeChunk.tenant_id == tenant_id,
                            KnowledgeChunk.chunk_id == chunk["chunk_id"],
                        )
                    )
                    if not existing_chunk:
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
            if job:
                existing_job = await session.scalar(
                    select(KnowledgeIngestionJob).where(
                        KnowledgeIngestionJob.tenant_id == tenant_id,
                        KnowledgeIngestionJob.job_id == job["job_id"],
                    )
                )
                if not existing_job:
                    session.add(KnowledgeIngestionJob(
                        tenant_id=tenant_id,
                        job_id=job["job_id"],
                        asset_id=job.get("asset_id") or asset.get("asset_id") or "",
                        document_id=job.get("document_id") or document.get("document_id") or "",
                        status=job["status"],
                        error=job.get("error"),
                    ))
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Knowledge ingestion persistence skipped: %s", exc)


async def create_extraction_job(
    *,
    file_name: str,
    content: bytes,
    domain: str = "manufacturing",
    prompt_name: str = "manufacturing_ontology_v1",
    model_name: str = "rules-ontology-extractor",
    owner_user_id: str = "knowledge-admin",
    permission_scope: str = "enterprise",
    tenant_id: int | None = None,
) -> dict[str, Any]:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    source_path = save_original_asset(file_name, content)
    source_type, markdown, metadata = parse_to_markdown_with_metadata(file_name, content)
    if source_type not in SUPPORTED_SOURCE_TYPES:
        raise ValueError(f"Unsupported extraction source type: {source_type}")

    document_id = _id("doc")
    asset_id = _id("asset")
    ingestion_job_id = _id("ingest")
    extraction_job_id = _id("extract")

    document = {
        "asset_id": asset_id,
        "document_id": document_id,
        "source_file_name": file_name,
        "source_type": source_type,
        "title": Path(file_name).stem,
        "markdown_content": markdown,
        "ocr_result": metadata.get("ocr_result"),
        "permission_scope": permission_scope,
        "owner_user_id": owner_user_id,
        "source_path": source_path,
        "status": "indexed",
        "created_at": _now(),
        "updated_at": _now(),
        "tenant_id": tenant_id,
    }
    chunks = markdown_to_chunks(markdown, document_id, permission_scope, tenant_id=tenant_id)
    DOCUMENTS[document_id] = document
    for chunk in chunks:
        CHUNKS[chunk["chunk_id"]] = chunk
    JOBS[ingestion_job_id] = {
        "job_id": ingestion_job_id,
        "asset_id": asset_id,
        "document_id": document_id,
        "tenant_id": tenant_id,
        "status": "completed",
        "error": None,
        "created_at": _now(),
        "updated_at": _now(),
    }

    await persist_ingestion_result({
        "job": JOBS[ingestion_job_id],
        "asset": {
            "asset_id": asset_id,
            "source_file_name": file_name,
            "permission_scope": permission_scope,
            "owner_user_id": owner_user_id,
            "status": "indexed",
        },
        "document": document,
        "chunks": chunks,
    }, tenant_id=tenant_id)

    result = deterministic_extract(markdown, domain=domain)
    quality_report = build_quality_report(result)
    job = {
        "job_id": extraction_job_id,
        "document_id": document_id,
        "domain": domain,
        "prompt_name": prompt_name,
        "model_name": model_name,
        "status": "completed",
        "result": result,
        "approved_result": None,
        "quality_report": quality_report,
        "created_at": _now(),
        "updated_at": _now(),
        "committed_at": None,
        "tenant_id": tenant_id,
    }
    EXTRACTION_JOBS[extraction_job_id] = job
    await persist_extraction_job(job, tenant_id=tenant_id)
    return {"job": job, "document": document, "chunks": chunks}


async def create_extraction_job_from_document(
    document_id: str,
    *,
    domain: str = "manufacturing",
    prompt_name: str = "manufacturing_ontology_v1",
    model_name: str = "rules-ontology-extractor",
    tenant_id: int | None = None,
) -> dict[str, Any] | None:
    """Create ontology candidates from a document that has already been ingested."""
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    document = DOCUMENTS.get(document_id)
    if document and not _record_belongs_to_tenant(document, tenant_id):
        document = None
    if not document:
        try:
            async with db_session() as session:
                row = await session.scalar(
                    select(KnowledgeDocument).where(
                        KnowledgeDocument.tenant_id == tenant_id,
                        KnowledgeDocument.document_id == document_id,
                    )
                )
                if row:
                    document = {
                        "asset_id": None,
                        "document_id": row.document_id,
                        "source_file_name": row.source_file_name,
                        "source_type": row.source_type,
                        "title": row.title,
                        "markdown_content": row.markdown_content,
                        "ocr_result": row.ocr_result,
                        "permission_scope": row.permission_scope,
                        "owner_user_id": row.owner_user_id,
                        "source_path": row.source_path,
                        "status": row.status,
                        "created_at": row.created_at.isoformat() if row.created_at else _now(),
                        "updated_at": row.updated_at.isoformat() if row.updated_at else _now(),
                        "tenant_id": tenant_id,
                    }
        except Exception as exc:  # noqa: BLE001
            logger.warning("Document lookup for ontology extraction skipped: %s", exc)
    if not document:
        return None

    markdown = str(document.get("markdown_content") or "")
    if not markdown.strip():
        return None

    DOCUMENTS[document_id] = document
    chunks = [
        chunk
        for chunk in CHUNKS.values()
        if chunk.get("document_id") == document_id and _record_belongs_to_tenant(chunk, tenant_id)
    ]
    if not chunks:
        chunks = markdown_to_chunks(
            markdown,
            document_id,
            str(document.get("permission_scope") or "enterprise"),
            tenant_id=tenant_id,
        )
        for chunk in chunks:
            CHUNKS[chunk["chunk_id"]] = chunk

    result = deterministic_extract(markdown, domain=domain)
    quality_report = build_quality_report(result)
    extraction_job_id = _id("extract")
    job = {
        "job_id": extraction_job_id,
        "document_id": document_id,
        "domain": domain,
        "prompt_name": prompt_name,
        "model_name": model_name,
        "status": "completed",
        "result": result,
        "approved_result": None,
        "quality_report": quality_report,
        "created_at": _now(),
        "updated_at": _now(),
        "committed_at": None,
        "tenant_id": tenant_id,
        "source": "uploaded_document",
    }
    EXTRACTION_JOBS[extraction_job_id] = job
    await persist_extraction_job(job, tenant_id=tenant_id)
    return {"job": job, "document": document, "chunks": chunks}


async def persist_extraction_job(job: dict[str, Any], tenant_id: int | None = None) -> None:
    tenant_id = require_tenant_id({"tenant_id": tenant_id or job.get("tenant_id")})
    try:
        async with db_session() as session:
            existing = await session.scalar(
                select(KnowledgeExtractionResult).where(
                    KnowledgeExtractionResult.tenant_id == tenant_id,
                    KnowledgeExtractionResult.job_id == job["job_id"],
                )
            )
            if existing:
                existing.status = job["status"]
                existing.result = job["result"]
                existing.approved_result = job.get("approved_result")
                existing.quality_report = job["quality_report"]
                existing.committed_at = datetime.fromisoformat(job["committed_at"]) if job.get("committed_at") else None
            else:
                session.add(KnowledgeExtractionResult(
                    tenant_id=tenant_id,
                    job_id=job["job_id"],
                    document_id=job["document_id"],
                    domain=job["domain"],
                    prompt_name=job["prompt_name"],
                    model_name=job["model_name"],
                    status=job["status"],
                    result=job["result"],
                    approved_result=job.get("approved_result"),
                    quality_report=job["quality_report"],
                    committed_at=datetime.fromisoformat(job["committed_at"]) if job.get("committed_at") else None,
                ))
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Knowledge extraction persistence skipped: %s", exc)


async def get_extraction_job(job_id: str, tenant_id: int | None = None) -> dict[str, Any] | None:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    if job_id in EXTRACTION_JOBS and int(EXTRACTION_JOBS[job_id].get("tenant_id") or tenant_id) == tenant_id:
        return EXTRACTION_JOBS[job_id]
    try:
        async with db_session() as session:
            row = await session.scalar(
                select(KnowledgeExtractionResult).where(
                    KnowledgeExtractionResult.tenant_id == tenant_id,
                    KnowledgeExtractionResult.job_id == job_id,
                )
            )
            if not row:
                return None
            job = {
                "job_id": row.job_id,
                "document_id": row.document_id,
                "domain": row.domain,
                "prompt_name": row.prompt_name,
                "model_name": row.model_name,
                "status": row.status,
                "result": row.result,
                "approved_result": row.approved_result,
                "quality_report": row.quality_report,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "committed_at": row.committed_at.isoformat() if row.committed_at else None,
                "tenant_id": row.tenant_id,
            }
            EXTRACTION_JOBS[job_id] = job
            return job
    except Exception as exc:  # noqa: BLE001
        logger.warning("Knowledge extraction lookup skipped: %s", exc)
        return None


async def approve_extraction_job(job_id: str, approved_result: dict[str, Any] | None = None, tenant_id: int | None = None) -> dict[str, Any] | None:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    job = await get_extraction_job(job_id, tenant_id=tenant_id)
    if not job:
        return None
    result = approved_result or job["result"]
    quality_report = build_quality_report(result)
    job.update({
        "approved_result": result,
        "quality_report": quality_report,
        "status": "approved" if not quality_report["blocking"] else "blocked",
        "updated_at": _now(),
    })
    EXTRACTION_JOBS[job_id] = job
    await persist_extraction_job(job, tenant_id=tenant_id)
    return job


async def commit_extraction_to_graph(job_id: str, tenant_id: int | None = None) -> dict[str, Any] | None:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    job = await get_extraction_job(job_id, tenant_id=tenant_id)
    if not job:
        return None
    if job["quality_report"].get("blocking"):
        raise ValueError("Extraction job contains FATAL quality issues and cannot be committed")
    result = job.get("approved_result") or job["result"]
    committed = {"entities": 0, "relations": 0, "object_links": 0, "graph_status": "skipped"}

    try:
        from app.services.graph_service import graph_service
        entity_ids: dict[str, str] = {}
        for index, entity in enumerate(result.get("entities", []), start=1):
            object_id = entity.get("candidate_id") or f"{job_id}-entity-{index}"
            entity_ids[object_id] = object_id
            props = {
                "name": entity.get("name"),
                "description": entity.get("description"),
                "source_location": entity.get("source_location"),
                "confidence": entity.get("confidence"),
                "knowledge_job_id": job_id,
                "source_document_id": job["document_id"],
                "review_status": "approved",
                "publish_status": "published",
            }
            await asyncio.wait_for(
                graph_service.upsert_business_node(entity.get("entity_type") or "KnowledgeCard", object_id, props),
                timeout=3,
            )
            committed["entities"] += 1
        for index, relation in enumerate(result.get("relations", []), start=1):
            src_id = relation.get("source_candidate_id")
            tgt_id = relation.get("target_candidate_id")
            if not src_id or not tgt_id:
                continue
            edge_props = {
                "id": relation.get("candidate_id") or f"{job_id}-rel-{index}",
                "name": relation.get("relation_type") or "RELATED_TO",
                "source_location": relation.get("source_location"),
                "confidence": relation.get("confidence"),
                "knowledge_job_id": job_id,
                "source_document_id": job["document_id"],
                "review_status": "approved",
                "publish_status": "published",
            }
            await asyncio.wait_for(
                graph_service.upsert_business_edge(src_id, tgt_id, "RELATED_TO", edge_props),
                timeout=3,
            )
            committed["relations"] += 1
        committed["graph_status"] = "created"
    except Exception as exc:  # noqa: BLE001
        logger.warning("Graph commit degraded to object-link persistence: %s", exc)
        committed["graph_status"] = "degraded"

    try:
        async with db_session() as session:
            for entity in result.get("entities", []):
                session.add(KnowledgeObjectLink(
                    tenant_id=tenant_id,
                    document_id=job["document_id"],
                    job_id=job_id,
                    object_type=entity.get("entity_type") or "KnowledgeEntity",
                    object_id=entity.get("candidate_id") or _id("object"),
                    object_name=entity.get("name") or "Unnamed ontology object",
                    confidence=float(entity.get("confidence", 0)),
                    source_location=entity.get("source_location"),
                    status="committed",
                ))
                committed["object_links"] += 1
                await upsert_candidate(
                    session,
                    tenant_id=tenant_id,
                    candidate_type="object",
                    candidate_key=f"knowledge:{job_id}:{entity.get('candidate_id')}:object",
                    title=f"{entity.get('name')} -> {entity.get('entity_type')}",
                    payload={
                        "object": {
                            "code": entity.get("entity_type") or "KnowledgeEntity",
                            "name": entity.get("entity_type") or "KnowledgeEntity",
                            "domain": job.get("domain") or "manufacturing",
                            "description": entity.get("description"),
                            "source_type": "knowledge",
                            "source_ref": f"knowledge_job:{job_id}:{entity.get('candidate_id')}",
                        },
                        "field": {
                            "object_code": entity.get("entity_type") or "KnowledgeEntity",
                            "code": "name",
                            "name": "Name",
                            "field_type": "string",
                            "source_type": "knowledge",
                            "source_ref": entity.get("source_location"),
                        },
                        "mapping": {
                            "source_system": "knowledge",
                            "source_type": "knowledge",
                            "source_entity": job["document_id"],
                            "source_field": entity.get("source_location") or "document",
                            "source_field_type": "text",
                            "target_object_code": entity.get("entity_type") or "KnowledgeEntity",
                            "target_field_code": "name",
                            "evidence": entity.get("source_location"),
                        },
                        "source": {"document_id": job["document_id"], "job_id": job_id},
                        "evidence": [entity.get("source_location")],
                    },
                    confidence=float(entity.get("confidence") or 0),
                    source_type="knowledge",
                    source_ref=f"knowledge_job:{job_id}",
                )
            for relation in result.get("relations", []):
                await upsert_candidate(
                    session,
                    tenant_id=tenant_id,
                    candidate_type="relation",
                    candidate_key=f"knowledge:{job_id}:{relation.get('candidate_id')}:relation",
                    title=f"{relation.get('source_type')} {relation.get('relation_type')} {relation.get('target_type')}",
                    payload={
                        "relation": {
                            "code": f"{relation.get('source_type')}_{relation.get('relation_type') or 'RELATED_TO'}_{relation.get('target_type')}",
                            "name": relation.get("relation_type") or "RELATED_TO",
                            "relation_type": relation.get("relation_type") or "RELATED_TO",
                            "source_object_code": relation.get("source_type") or "KnowledgeEntity",
                            "target_object_code": relation.get("target_type") or "KnowledgeEntity",
                            "description": relation.get("source_location"),
                            "source_type": "knowledge",
                            "source_ref": f"knowledge_job:{job_id}:{relation.get('candidate_id')}",
                        },
                        "source": {"document_id": job["document_id"], "job_id": job_id},
                        "evidence": [relation.get("source_location")],
                    },
                    confidence=float(relation.get("confidence") or 0),
                    source_type="knowledge",
                    source_ref=f"knowledge_job:{job_id}",
                )
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Object-link persistence skipped: %s", exc)

    if committed["entities"] == 0:
        committed["entities"] = len(result.get("entities", []))
    if committed["relations"] == 0:
        committed["relations"] = len(result.get("relations", []))
    job.update({"status": "committed", "committed_at": _now(), "updated_at": _now()})
    EXTRACTION_JOBS[job_id] = job
    await persist_extraction_job(job, tenant_id=tenant_id)
    return {"job": job, "commit": committed}


def _asset_node_from_entity(job: dict[str, Any], entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entity.get("candidate_id"),
        "name": entity.get("name"),
        "type": entity.get("entity_type") or "KnowledgeEntity",
        "description": entity.get("description"),
        "confidence": entity.get("confidence", 0),
        "source_document_id": job.get("document_id"),
        "source_location": entity.get("source_location"),
        "knowledge_job_id": job.get("job_id"),
        "review_status": "approved" if job.get("approved_result") else "pending_review",
        "publish_status": "published" if job.get("status") == "committed" else "draft",
        "binding_status": "unbound",
    }


def _asset_relationship_from_relation(job: dict[str, Any], relation: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": relation.get("candidate_id"),
        "source": relation.get("source_candidate_id"),
        "source_name": relation.get("source_name"),
        "source_type": relation.get("source_type"),
        "target": relation.get("target_candidate_id"),
        "target_name": relation.get("target_name"),
        "target_type": relation.get("target_type"),
        "relation_type": relation.get("relation_type") or "RELATED_TO",
        "confidence": relation.get("confidence", 0),
        "source_document_id": job.get("document_id"),
        "source_location": relation.get("source_location"),
        "knowledge_job_id": job.get("job_id"),
        "review_status": "approved" if job.get("approved_result") else "pending_review",
        "publish_status": "published" if job.get("status") == "committed" else "draft",
    }


def _asset_evidence_from_job(job: dict[str, Any]) -> list[dict[str, Any]]:
    result = job.get("approved_result") or job.get("result") or {}
    items: list[dict[str, Any]] = []
    for entity in result.get("entities", []):
        items.append({
            "id": f"{entity.get('candidate_id')}:evidence",
            "asset_type": "node",
            "asset_id": entity.get("candidate_id"),
            "asset_name": entity.get("name"),
            "source_document_id": job.get("document_id"),
            "source_location": entity.get("source_location"),
            "confidence": entity.get("confidence", 0),
            "knowledge_job_id": job.get("job_id"),
        })
    for relation in result.get("relations", []):
        items.append({
            "id": f"{relation.get('candidate_id')}:evidence",
            "asset_type": "relationship",
            "asset_id": relation.get("candidate_id"),
            "asset_name": f"{relation.get('source_name')} -> {relation.get('target_name')}",
            "source_document_id": job.get("document_id"),
            "source_location": relation.get("source_location"),
            "confidence": relation.get("confidence", 0),
            "knowledge_job_id": job.get("job_id"),
        })
    return items


async def list_graph_asset_jobs() -> list[dict[str, Any]]:
    jobs = [job for job in EXTRACTION_JOBS.values() if job.get("status") == "committed"]
    try:
        async with db_session() as session:
            result = await session.execute(
                select(KnowledgeExtractionResult).where(KnowledgeExtractionResult.status == "committed")
            )
            for row in result.scalars().all():
                if any(job.get("job_id") == row.job_id for job in jobs):
                    continue
                jobs.append({
                    "job_id": row.job_id,
                    "document_id": row.document_id,
                    "domain": row.domain,
                    "prompt_name": row.prompt_name,
                    "model_name": row.model_name,
                    "status": row.status,
                    "result": row.result or {},
                    "approved_result": row.approved_result,
                    "quality_report": row.quality_report or {},
                    "committed_at": row.committed_at.isoformat() if row.committed_at else None,
                })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Graph asset job lookup skipped: %s", exc)
    return jobs


async def list_graph_asset_nodes(search: str | None = None, entity_type: str | None = None) -> list[dict[str, Any]]:
    search_lc = (search or "").lower()
    nodes: list[dict[str, Any]] = []
    for job in await list_graph_asset_jobs():
        result = job.get("approved_result") or job.get("result") or {}
        for entity in result.get("entities", []):
            node = _asset_node_from_entity(job, entity)
            if entity_type and node["type"] != entity_type:
                continue
            if search_lc and search_lc not in str(node.get("name", "")).lower():
                continue
            nodes.append(node)
    return nodes


async def list_graph_asset_relationships(search: str | None = None, relation_type: str | None = None) -> list[dict[str, Any]]:
    search_lc = (search or "").lower()
    relationships: list[dict[str, Any]] = []
    for job in await list_graph_asset_jobs():
        result = job.get("approved_result") or job.get("result") or {}
        for relation in result.get("relations", []):
            item = _asset_relationship_from_relation(job, relation)
            if relation_type and item["relation_type"] != relation_type:
                continue
            haystack = f"{item.get('source_name')} {item.get('target_name')} {item.get('relation_type')}".lower()
            if search_lc and search_lc not in haystack:
                continue
            relationships.append(item)
    return relationships


async def get_graph_asset_node(node_id: str) -> dict[str, Any] | None:
    return next((node for node in await list_graph_asset_nodes() if str(node.get("id")) == node_id), None)


async def get_graph_asset_relationship(relationship_id: str) -> dict[str, Any] | None:
    return next((rel for rel in await list_graph_asset_relationships() if str(rel.get("id")) == relationship_id), None)


async def list_graph_asset_evidence() -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for job in await list_graph_asset_jobs():
        evidence.extend(_asset_evidence_from_job(job))
    return evidence


async def get_graph_asset_quality() -> dict[str, Any]:
    jobs = await list_graph_asset_jobs()
    nodes = await list_graph_asset_nodes()
    relationships = await list_graph_asset_relationships()
    low_confidence_nodes = [node for node in nodes if float(node.get("confidence") or 0) < 0.6]
    low_confidence_relationships = [rel for rel in relationships if float(rel.get("confidence") or 0) < 0.6]
    missing_evidence = [
        item for item in [*nodes, *relationships]
        if not item.get("source_document_id") or not item.get("source_location")
    ]
    unbound_nodes = [node for node in nodes if node.get("binding_status") != "bound"]
    return {
        "summary": {
            "jobs": len(jobs),
            "nodes": len(nodes),
            "relationships": len(relationships),
            "low_confidence": len(low_confidence_nodes) + len(low_confidence_relationships),
            "missing_evidence": len(missing_evidence),
            "unbound_nodes": len(unbound_nodes),
        },
        "items": [
            *[
                {"severity": "WARNING", "code": "LOW_CONFIDENCE_NODE", "target": node.get("name"), "asset_id": node.get("id")}
                for node in low_confidence_nodes
            ],
            *[
                {"severity": "WARNING", "code": "LOW_CONFIDENCE_RELATIONSHIP", "target": rel.get("id"), "asset_id": rel.get("id")}
                for rel in low_confidence_relationships
            ],
            *[
                {"severity": "ERROR", "code": "MISSING_EVIDENCE", "target": item.get("name") or item.get("id"), "asset_id": item.get("id")}
                for item in missing_evidence
            ],
            *[
                {"severity": "INFO", "code": "UNBOUND_MASTER_DATA", "target": node.get("name"), "asset_id": node.get("id")}
                for node in unbound_nodes
            ],
        ],
    }


def export_extraction(job: dict[str, Any], export_format: str) -> tuple[str, str, str]:
    result = job.get("approved_result") or job.get("result") or {}
    export_format = export_format.lower()
    if export_format == "json":
        return "application/json", "json", json.dumps(job, ensure_ascii=False, indent=2)
    if export_format == "yaml":
        content = json.dumps(job, ensure_ascii=False, indent=2)
        return "application/x-yaml", "yaml", "# YAML-compatible extraction export\n" + content
    if export_format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["kind", "name", "type", "confidence", "source_location"])
        for entity in result.get("entities", []):
            writer.writerow(["entity", entity.get("name"), entity.get("entity_type"), entity.get("confidence"), entity.get("source_location")])
        for relation in result.get("relations", []):
            writer.writerow(["relation", f"{relation.get('source_name')} -> {relation.get('target_name')}", relation.get("relation_type"), relation.get("confidence"), relation.get("source_location")])
        return "text/csv", "csv", buffer.getvalue()
    if export_format in {"ttl", "turtle", "rdf"}:
        lines = ["@prefix mf: <https://manufoundry.local/ontology/> .", ""]
        for entity in result.get("entities", []):
            name = re.sub(r"[^A-Za-z0-9_]", "_", entity.get("candidate_id", _id("ent")))
            lines.append(f"mf:{name} a mf:{entity.get('entity_type', 'KnowledgeEntity')} ;")
            lines.append(f'  mf:name "{entity.get("name", "")}" ;')
            lines.append(f'  mf:confidence "{entity.get("confidence", 0)}" .')
        return "text/turtle", "ttl", "\n".join(lines)
    if export_format == "html":
        html = ["<html><body><h1>Knowledge Extraction Report</h1>"]
        html.append(f"<h2>{escape(job['job_id'])}</h2><ul>")
        for entity in result.get("entities", []):
            html.append(
                f"<li><b>{escape(entity.get('entity_type', ''))}</b>: "
                f"{escape(entity.get('name', ''))} "
                f"({escape(str(entity.get('confidence', '')))}"
                f")</li>"
            )
        html.append("</ul></body></html>")
        return "text/html", "html", "".join(html)
    raise ValueError(f"Unsupported export format: {export_format}")
