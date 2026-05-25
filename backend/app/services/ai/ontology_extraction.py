"""Document-to-ontology extraction workflow.

The extractor is deterministic by default so the demo and tests work without
external LLM calls. The public service shape is intentionally close to a real
LLM pipeline: parse source material, produce ontology candidates, generate a
quality report, require approval, then commit approved candidates to graph.
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
from app.services.ai.knowledge_ingestion import (
    CHUNKS,
    DOCUMENTS,
    JOBS,
    markdown_to_chunks,
    parse_to_markdown,
)

logger = get_logger(__name__)

EXTRACTION_JOBS: dict[str, dict[str, Any]] = {}

DEMO_GRAPH_ASSET_JOBS: list[dict[str, Any]] = [
    {
        "job_id": "demo-job-supplier-8d",
        "document_id": "demo-doc-supplier-8d",
        "domain": "quality",
        "prompt_name": "supplier_8d_v1",
        "model_name": "mock-chat",
        "status": "committed",
        "committed_at": "2026-05-25T09:30:00",
        "approved_result": {
            "entities": [
                {
                    "candidate_id": "demo-ent-supplier-beichen",
                    "name": "北辰电子材料",
                    "entity_type": "Supplier",
                    "description": "供应商 8D 报告中确认的来料供应商。",
                    "confidence": 0.96,
                    "source_location": "8D:供应商信息",
                },
                {
                    "candidate_id": "demo-ent-material-mb7781",
                    "name": "MB-7781 焊锡膏 S12",
                    "entity_type": "MaterialBatch",
                    "description": "涉及温控波动的焊锡膏批次。",
                    "confidence": 0.94,
                    "source_location": "8D:D3 围堵措施",
                },
                {
                    "candidate_id": "demo-ent-defect-void",
                    "name": "BGA 焊点虚焊",
                    "entity_type": "Defect",
                    "description": "AOI 与复检确认的主要缺陷。",
                    "confidence": 0.91,
                    "source_location": "8D:D2 问题描述",
                },
                {
                    "candidate_id": "demo-ent-capa-072",
                    "name": "CAPA-072 批次冻结与复检",
                    "entity_type": "CAPA",
                    "description": "供应商整改和厂内复检动作。",
                    "confidence": 0.88,
                    "source_location": "8D:D5/D6 纠正措施",
                },
            ],
            "relations": [
                {
                    "candidate_id": "demo-rel-supplier-material",
                    "source_candidate_id": "demo-ent-supplier-beichen",
                    "source_name": "北辰电子材料",
                    "source_type": "Supplier",
                    "target_candidate_id": "demo-ent-material-mb7781",
                    "target_name": "MB-7781 焊锡膏 S12",
                    "target_type": "MaterialBatch",
                    "relation_type": "SUPPLIES",
                    "confidence": 0.93,
                    "source_location": "8D:供应商信息",
                },
                {
                    "candidate_id": "demo-rel-material-defect",
                    "source_candidate_id": "demo-ent-material-mb7781",
                    "source_name": "MB-7781 焊锡膏 S12",
                    "source_type": "MaterialBatch",
                    "target_candidate_id": "demo-ent-defect-void",
                    "target_name": "BGA 焊点虚焊",
                    "target_type": "Defect",
                    "relation_type": "MAY_CAUSE",
                    "confidence": 0.82,
                    "source_location": "8D:D4 根因分析",
                },
                {
                    "candidate_id": "demo-rel-defect-capa",
                    "source_candidate_id": "demo-ent-defect-void",
                    "source_name": "BGA 焊点虚焊",
                    "source_type": "Defect",
                    "target_candidate_id": "demo-ent-capa-072",
                    "target_name": "CAPA-072 批次冻结与复检",
                    "target_type": "CAPA",
                    "relation_type": "TRIGGERS",
                    "confidence": 0.89,
                    "source_location": "8D:D5/D6 纠正措施",
                },
            ],
            "logic_rules": [],
            "actions": [],
        },
        "quality_report": {"blocking": False, "counts": {"FATAL": 0, "ERROR": 0, "WARNING": 1, "INFO": 1}, "items": []},
    },
    {
        "job_id": "demo-job-quality-sop",
        "document_id": "demo-doc-quality-sop",
        "domain": "quality",
        "prompt_name": "quality_sop_v1",
        "model_name": "mock-chat",
        "status": "committed",
        "committed_at": "2026-05-25T09:35:00",
        "approved_result": {
            "entities": [
                {
                    "candidate_id": "demo-ent-sop-q14",
                    "name": "SOP-QA-014 焊点虚焊复检流程",
                    "entity_type": "KnowledgeCard",
                    "description": "质量 SOP 中定义的冻结、复检和放行流程。",
                    "confidence": 0.92,
                    "source_location": "SOP:3.2-4.1",
                },
                {
                    "candidate_id": "demo-ent-inspection-recheck",
                    "name": "BGA 区域复检",
                    "entity_type": "QualityEvent",
                    "description": "针对同批次和同设备窗口的复检要求。",
                    "confidence": 0.84,
                    "source_location": "SOP:4.1",
                },
            ],
            "relations": [
                {
                    "candidate_id": "demo-rel-sop-defect",
                    "source_candidate_id": "demo-ent-sop-q14",
                    "source_name": "SOP-QA-014 焊点虚焊复检流程",
                    "source_type": "KnowledgeCard",
                    "target_candidate_id": "demo-ent-defect-void",
                    "target_name": "BGA 焊点虚焊",
                    "target_type": "Defect",
                    "relation_type": "EVIDENCE_FOR",
                    "confidence": 0.87,
                    "source_location": "SOP:3.2",
                },
                {
                    "candidate_id": "demo-rel-sop-recheck",
                    "source_candidate_id": "demo-ent-sop-q14",
                    "source_name": "SOP-QA-014 焊点虚焊复检流程",
                    "source_type": "KnowledgeCard",
                    "target_candidate_id": "demo-ent-inspection-recheck",
                    "target_name": "BGA 区域复检",
                    "target_type": "QualityEvent",
                    "relation_type": "TRIGGERS",
                    "confidence": 0.81,
                    "source_location": "SOP:4.1",
                },
            ],
            "logic_rules": [],
            "actions": [],
        },
        "quality_report": {"blocking": False, "counts": {"FATAL": 0, "ERROR": 0, "WARNING": 0, "INFO": 1}, "items": []},
    },
    {
        "job_id": "demo-job-equipment-log",
        "document_id": "demo-doc-equipment-log",
        "domain": "maintenance",
        "prompt_name": "equipment_log_v1",
        "model_name": "mock-chat",
        "status": "committed",
        "committed_at": "2026-05-25T09:40:00",
        "approved_result": {
            "entities": [
                {
                    "candidate_id": "demo-ent-equipment-smt03",
                    "name": "SMT-03 回流炉",
                    "entity_type": "Equipment",
                    "description": "设备日志中出现温区短时偏低的回流炉。",
                    "confidence": 0.93,
                    "source_location": "设备日志:09:12",
                },
                {
                    "candidate_id": "demo-ent-sensor-temp05",
                    "name": "温区 4 温度传感器",
                    "entity_type": "Sensor",
                    "description": "记录异常温度窗口的传感器。",
                    "confidence": 0.78,
                    "source_location": "设备日志:09:12",
                },
            ],
            "relations": [
                {
                    "candidate_id": "demo-rel-equipment-sensor",
                    "source_candidate_id": "demo-ent-equipment-smt03",
                    "source_name": "SMT-03 回流炉",
                    "source_type": "Equipment",
                    "target_candidate_id": "demo-ent-sensor-temp05",
                    "target_name": "温区 4 温度传感器",
                    "target_type": "Sensor",
                    "relation_type": "MEASURED_BY",
                    "confidence": 0.78,
                    "source_location": "设备日志:09:12",
                }
            ],
            "logic_rules": [],
            "actions": [],
        },
        "quality_report": {"blocking": False, "counts": {"FATAL": 0, "ERROR": 0, "WARNING": 1, "INFO": 1}, "items": []},
    },
    {
        "job_id": "demo-job-workorder-exception",
        "document_id": "demo-doc-workorder-exception",
        "domain": "manufacturing",
        "prompt_name": "workorder_exception_v1",
        "model_name": "mock-chat",
        "status": "committed",
        "committed_at": "2026-05-25T09:45:00",
        "approved_result": {
            "entities": [
                {
                    "candidate_id": "demo-ent-workorder-017",
                    "name": "WO-260521-017 电控模块工单",
                    "entity_type": "WorkOrder",
                    "description": "同设备、同物料批次窗口内的生产工单。",
                    "confidence": 0.9,
                    "source_location": "工单异常记录:line 6",
                },
                {
                    "candidate_id": "demo-ent-product-batch-a",
                    "name": "PB-260521-A 电控模块产品批",
                    "entity_type": "ProductBatch",
                    "description": "可能受影响的产品批次。",
                    "confidence": 0.86,
                    "source_location": "工单异常记录:line 9",
                },
                {
                    "candidate_id": "demo-ent-customer-order-8821",
                    "name": "SO-8821 客户订单",
                    "entity_type": "CustomerOrder",
                    "description": "受影响产品批次关联的客户订单。",
                    "confidence": 0.8,
                    "source_location": "工单异常记录:line 12",
                },
            ],
            "relations": [
                {
                    "candidate_id": "demo-rel-workorder-equipment",
                    "source_candidate_id": "demo-ent-workorder-017",
                    "source_name": "WO-260521-017 电控模块工单",
                    "source_type": "WorkOrder",
                    "target_candidate_id": "demo-ent-equipment-smt03",
                    "target_name": "SMT-03 回流炉",
                    "target_type": "Equipment",
                    "relation_type": "USES_EQUIPMENT",
                    "confidence": 0.87,
                    "source_location": "工单异常记录:line 6",
                },
                {
                    "candidate_id": "demo-rel-workorder-product",
                    "source_candidate_id": "demo-ent-workorder-017",
                    "source_name": "WO-260521-017 电控模块工单",
                    "source_type": "WorkOrder",
                    "target_candidate_id": "demo-ent-product-batch-a",
                    "target_name": "PB-260521-A 电控模块产品批",
                    "target_type": "ProductBatch",
                    "relation_type": "PRODUCES_BATCH",
                    "confidence": 0.84,
                    "source_location": "工单异常记录:line 9",
                },
                {
                    "candidate_id": "demo-rel-product-order",
                    "source_candidate_id": "demo-ent-product-batch-a",
                    "source_name": "PB-260521-A 电控模块产品批",
                    "source_type": "ProductBatch",
                    "target_candidate_id": "demo-ent-customer-order-8821",
                    "target_name": "SO-8821 客户订单",
                    "target_type": "CustomerOrder",
                    "relation_type": "AFFECTS_ORDER",
                    "confidence": 0.8,
                    "source_location": "工单异常记录:line 12",
                },
            ],
            "logic_rules": [],
            "actions": [],
        },
        "quality_report": {"blocking": False, "counts": {"FATAL": 0, "ERROR": 0, "WARNING": 1, "INFO": 1}, "items": []},
    },
]

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

    if not entities:
        title = next((line.strip("# ").strip() for line in markdown.splitlines() if line.strip().startswith("#")), "")
        if title:
            entities.append({
                "candidate_id": _id("ent"),
                "name": title[:120],
                "entity_type": "QualityEvent",
                "description": "Fallback candidate from document title.",
                "confidence": 0.52,
                "source_location": "line:1",
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

    return {
        "entities": entities,
        "relations": relations,
        "logic_rules": logic_rules,
        "actions": actions,
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


async def persist_ingestion_result(result: dict[str, Any]) -> None:
    """Best-effort persistence for uploaded source material."""
    try:
        async with db_session() as session:
            job = result.get("job") or {}
            asset = result.get("asset") or {}
            document = result.get("document") or {}
            if document:
                existing_doc = await session.scalar(
                    select(KnowledgeDocument).where(KnowledgeDocument.document_id == document["document_id"])
                )
                if not existing_doc:
                    session.add(KnowledgeDocument(
                        document_id=document["document_id"],
                        source_file_name=document["source_file_name"],
                        source_type=document["source_type"],
                        title=document["title"],
                        markdown_content=document["markdown_content"],
                        permission_scope=document["permission_scope"],
                        owner_user_id=document.get("owner_user_id"),
                        status=document["status"],
                    ))
                for chunk in result.get("chunks") or []:
                    existing_chunk = await session.scalar(
                        select(KnowledgeChunk).where(KnowledgeChunk.chunk_id == chunk["chunk_id"])
                    )
                    if not existing_chunk:
                        session.add(KnowledgeChunk(
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
                    select(KnowledgeIngestionJob).where(KnowledgeIngestionJob.job_id == job["job_id"])
                )
                if not existing_job:
                    session.add(KnowledgeIngestionJob(
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
    model_name: str = "mock-chat",
    owner_user_id: str = "demo-user",
    permission_scope: str = "enterprise",
) -> dict[str, Any]:
    source_type, markdown = parse_to_markdown(file_name, content)
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
        "permission_scope": permission_scope,
        "owner_user_id": owner_user_id,
        "status": "indexed",
        "created_at": _now(),
        "updated_at": _now(),
    }
    chunks = markdown_to_chunks(markdown, document_id, permission_scope)
    DOCUMENTS[document_id] = document
    for chunk in chunks:
        CHUNKS[chunk["chunk_id"]] = chunk
    JOBS[ingestion_job_id] = {
        "job_id": ingestion_job_id,
        "asset_id": asset_id,
        "document_id": document_id,
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
    })

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
    }
    EXTRACTION_JOBS[extraction_job_id] = job
    await persist_extraction_job(job)
    return {"job": job, "document": document, "chunks": chunks}


async def persist_extraction_job(job: dict[str, Any]) -> None:
    try:
        async with db_session() as session:
            existing = await session.scalar(
                select(KnowledgeExtractionResult).where(KnowledgeExtractionResult.job_id == job["job_id"])
            )
            if existing:
                existing.status = job["status"]
                existing.result = job["result"]
                existing.approved_result = job.get("approved_result")
                existing.quality_report = job["quality_report"]
                existing.committed_at = datetime.fromisoformat(job["committed_at"]) if job.get("committed_at") else None
            else:
                session.add(KnowledgeExtractionResult(
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


async def get_extraction_job(job_id: str) -> dict[str, Any] | None:
    if job_id in EXTRACTION_JOBS:
        return EXTRACTION_JOBS[job_id]
    try:
        async with db_session() as session:
            row = await session.scalar(
                select(KnowledgeExtractionResult).where(KnowledgeExtractionResult.job_id == job_id)
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
            }
            EXTRACTION_JOBS[job_id] = job
            return job
    except Exception as exc:  # noqa: BLE001
        logger.warning("Knowledge extraction lookup skipped: %s", exc)
        return None


async def approve_extraction_job(job_id: str, approved_result: dict[str, Any] | None = None) -> dict[str, Any] | None:
    job = await get_extraction_job(job_id)
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
    await persist_extraction_job(job)
    return job


async def commit_extraction_to_graph(job_id: str) -> dict[str, Any] | None:
    job = await get_extraction_job(job_id)
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
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Object-link persistence skipped: %s", exc)

    if committed["relations"] == 0:
        committed["relations"] = len(result.get("relations", []))
    job.update({"status": "committed", "committed_at": _now(), "updated_at": _now()})
    EXTRACTION_JOBS[job_id] = job
    await persist_extraction_job(job)
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
    if not jobs:
        jobs.extend(DEMO_GRAPH_ASSET_JOBS)
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
