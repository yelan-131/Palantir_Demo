"""Knowledge ingestion and local vector-search MVP.

This module is intentionally pgvector-ready but stores demo records in memory.
The generated records include IDs, source locations, permission scope, raw
markdown, chunk text, and embedding vectors so persistence can be swapped in
without changing API contracts.
"""

from __future__ import annotations

import io
import math
import re
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import pandas as pd

from .providers import _stable_embedding
from .ocr_service import (
    extract_pdf_text,
    ocr_extract,
    ocr_markdown_from_blocks,
    save_original_asset,
    source_type_for_file,
)
from .tenant_context import require_tenant_id


ASSETS: dict[str, dict[str, Any]] = {}
DOCUMENTS: dict[str, dict[str, Any]] = {}
CHUNKS: dict[str, dict[str, Any]] = {}
JOBS: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now().isoformat()


def _source_type(file_name: str) -> str:
    return source_type_for_file(file_name)


def _normalize_tenant_id(tenant_id: int | str | None) -> int:
    return require_tenant_id({"tenant_id": tenant_id})


def _belongs_to_tenant(record: dict[str, Any], tenant_id: int) -> bool:
    try:
        return _normalize_tenant_id(record.get("tenant_id")) == tenant_id
    except ValueError:
        return False


def markdown_to_chunks(
    markdown: str,
    document_id: str,
    permission_scope: str = "enterprise",
    *,
    tenant_id: int | str,
) -> list[dict[str, Any]]:
    tenant_id = _normalize_tenant_id(tenant_id)
    sections = re.split(r"(?m)(?=^#{1,4}\s+)", markdown.strip())
    raw_chunks = [section.strip() for section in sections if section.strip()] or [markdown.strip()]
    chunks = []
    for index, text in enumerate(raw_chunks, start=1):
        if not text:
            continue
        title_match = re.search(r"^#{1,4}\s+(.+)$", text, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else f"Chunk {index}"
        chunk_id = f"chunk-{uuid.uuid4().hex[:12]}"
        chunks.append({
            "chunk_id": chunk_id,
            "tenant_id": tenant_id,
            "document_id": document_id,
            "title": title,
            "chunk_text": text[:4000],
            "embedding": _stable_embedding(text),
            "source_location": f"section:{index}",
            "page_number": None,
            "sheet_name": None,
            "row_range": None,
            "permission_scope": permission_scope,
            "status": "indexed",
            "created_at": _now(),
            "updated_at": _now(),
        })
    return chunks


def parse_markdown(file_name: str, content: bytes) -> str:
    text = content.decode("utf-8-sig", errors="replace")
    return text if text.lstrip().startswith("#") else f"# {file_name}\n\n{text}"


def parse_excel(file_name: str, content: bytes) -> str:
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, nrows=50)
    parts = [f"# {file_name}", "", "> Excel source converted to Markdown summary. Large sheets are summarized, not fully embedded."]
    for sheet_name, frame in sheets.items():
        parts.extend(["", f"## Sheet: {sheet_name}", ""])
        parts.append(f"- Rows sampled: {len(frame)}")
        parts.append(f"- Columns: {', '.join(str(col) for col in frame.columns)}")
        if not frame.empty:
            parts.extend(["", frame.head(10).to_markdown(index=False)])
    return "\n".join(parts)


def parse_word(file_name: str, content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            document_xml = archive.read("word/document.xml")
    except Exception as exc:
        raise RuntimeError("Invalid or unsupported Word document") from exc

    root = ElementTree.fromstring(document_xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    parts = [f"# {file_name}", "", "> Word source converted to Markdown text."]
    body = root.find("w:body", ns)
    if body is None:
        return "\n\n".join(parts)

    for child in body:
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = "".join(node.text or "" for node in child.findall(".//w:t", ns)).strip()
            if text:
                style_el = child.find("w:pPr/w:pStyle", ns)
                style = style_el.get(f"{{{ns['w']}}}val", "") if style_el is not None else ""
                if style == "Title":
                    text = f"# {text}"
                elif style.startswith("Heading"):
                    text = f"## {text}"
                parts.append(text)
            continue
        if tag == "tbl":
            rows: list[list[str]] = []
            for row in child.findall("w:tr", ns):
                cells = []
                for cell in row.findall("w:tc", ns):
                    cell_text = " ".join(
                        "".join(node.text or "" for node in paragraph.findall(".//w:t", ns)).strip()
                        for paragraph in cell.findall("w:p", ns)
                    ).strip()
                    cells.append(cell_text)
                if cells:
                    rows.append(cells)
            if rows:
                max_cols = max(len(row) for row in rows)
                normalized = [row + [""] * (max_cols - len(row)) for row in rows]
                parts.append("| " + " | ".join(normalized[0]) + " |")
                parts.append("| " + " | ".join(["---"] * max_cols) + " |")
                for row in normalized[1:]:
                    parts.append("| " + " | ".join(row) + " |")
    return "\n\n".join(parts)


def parse_pdf(file_name: str, content: bytes) -> str:
    return extract_pdf_text(file_name, content)


def parse_image(file_name: str, content: bytes) -> str:
    if not content:
        raise RuntimeError("Image file is empty")
    return ocr_extract(file_name, content)["markdown_content"]


def parse_to_markdown_with_metadata(file_name: str, content: bytes) -> tuple[str, str, dict[str, Any]]:
    source_type = _source_type(file_name)
    metadata: dict[str, Any] = {}
    if source_type == "markdown":
        return source_type, parse_markdown(file_name, content), metadata
    if source_type == "excel":
        return source_type, parse_excel(file_name, content), metadata
    if source_type == "word":
        return source_type, parse_word(file_name, content), metadata
    if source_type == "pdf":
        try:
            return source_type, parse_pdf(file_name, content), metadata
        except RuntimeError as exc:
            if "OCR/vision is required" not in str(exc):
                raise
            ocr_result = ocr_extract(file_name, content)
            metadata["ocr_result"] = ocr_result
            return source_type, ocr_result["markdown_content"], metadata
    if source_type == "image":
        ocr_result = ocr_extract(file_name, content)
        metadata["ocr_result"] = ocr_result
        return source_type, ocr_result["markdown_content"], metadata
    raise RuntimeError(f"Unsupported knowledge file type: {Path(file_name).suffix or 'unknown'}")


def parse_to_markdown(file_name: str, content: bytes) -> tuple[str, str]:
    source_type, markdown, _metadata = parse_to_markdown_with_metadata(file_name, content)
    return source_type, markdown


def update_ocr_corrections(
    document_id: str,
    blocks: list[dict[str, Any]],
    *,
    tenant_id: int | str,
) -> dict[str, Any] | None:
    tenant_id = _normalize_tenant_id(tenant_id)
    document = DOCUMENTS.get(document_id)
    if not document or not _belongs_to_tenant(document, tenant_id):
        return None
    ocr_result = dict(document.get("ocr_result") or {})
    existing_by_id = {str(block.get("id") or index): block for index, block in enumerate(ocr_result.get("blocks") or [])}
    next_blocks = []
    for index, block in enumerate(blocks):
        block_id = str(block.get("id") or index)
        merged = {**existing_by_id.get(block_id, {}), **block}
        if merged.get("corrected_text"):
            merged["status"] = "corrected"
        next_blocks.append(merged)
    if not next_blocks:
        next_blocks = ocr_result.get("blocks") or []
    ocr_result["blocks"] = next_blocks
    ocr_result["markdown_content"] = ocr_markdown_from_blocks(document["source_file_name"], next_blocks)
    document["ocr_result"] = ocr_result
    document["markdown_content"] = ocr_result["markdown_content"]
    for chunk_id in [
        chunk_id
        for chunk_id, chunk in CHUNKS.items()
        if chunk["document_id"] == document_id and _belongs_to_tenant(chunk, tenant_id)
    ]:
        CHUNKS.pop(chunk_id, None)
    for chunk in markdown_to_chunks(
        document["markdown_content"],
        document_id,
        document["permission_scope"],
        tenant_id=tenant_id,
    ):
        CHUNKS[chunk["chunk_id"]] = chunk
    document["updated_at"] = _now()
    return document


def ingest_asset(
    file_name: str,
    content: bytes,
    owner_user_id: str = "demo-user",
    permission_scope: str = "enterprise",
    *,
    tenant_id: int | str,
) -> dict[str, Any]:
    tenant_id = _normalize_tenant_id(tenant_id)
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    asset_id = f"asset-{uuid.uuid4().hex[:12]}"
    document_id = f"doc-{uuid.uuid4().hex[:12]}"
    created_at = _now()
    JOBS[job_id] = {
        "job_id": job_id,
        "tenant_id": tenant_id,
        "asset_id": asset_id,
        "document_id": document_id,
        "status": "running",
        "error": None,
        "created_at": created_at,
        "updated_at": created_at,
    }

    ASSETS[asset_id] = {
        "asset_id": asset_id,
        "tenant_id": tenant_id,
        "source_file_name": file_name,
        "owner_user_id": owner_user_id,
        "permission_scope": permission_scope,
        "status": "uploaded",
        "created_at": created_at,
        "updated_at": created_at,
    }

    try:
        source_path = save_original_asset(file_name, content)
        source_type, markdown, metadata = parse_to_markdown_with_metadata(file_name, content)
        document = {
            "asset_id": asset_id,
            "document_id": document_id,
            "tenant_id": tenant_id,
            "source_file_name": file_name,
            "source_type": source_type,
            "title": Path(file_name).stem,
            "markdown_content": markdown,
            "ocr_result": metadata.get("ocr_result"),
            "permission_scope": permission_scope,
            "owner_user_id": owner_user_id,
            "source_path": source_path,
            "status": "indexed",
            "created_at": created_at,
            "updated_at": _now(),
        }
        DOCUMENTS[document_id] = document
        for chunk in markdown_to_chunks(markdown, document_id, permission_scope, tenant_id=tenant_id):
            CHUNKS[chunk["chunk_id"]] = chunk
        ASSETS[asset_id]["status"] = "indexed"
        JOBS[job_id].update({"status": "completed", "updated_at": _now()})
    except Exception as exc:
        ASSETS[asset_id]["status"] = "failed"
        JOBS[job_id].update({"status": "failed", "error": str(exc), "updated_at": _now()})

    return {
        "job": JOBS[job_id],
        "asset": ASSETS[asset_id],
        "document": DOCUMENTS.get(document_id),
        "chunks": [
            chunk
            for chunk in CHUNKS.values()
            if chunk["document_id"] == document_id and _belongs_to_tenant(chunk, tenant_id)
        ],
    }


def cosine_score(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return 0.0
    return round(numerator / (left_norm * right_norm), 6)


def lexical_score(query: str, text: str) -> float:
    tokens = {
        token
        for token in re.split(r"[^a-z0-9_-]+", query.lower())
        if len(token) >= 2
    }
    if not tokens:
        return 0.0
    haystack = text.lower()
    return sum(1 for token in tokens if token in haystack) / len(tokens)


def search_ingested_knowledge(
    query: str,
    *,
    tenant_id: int | str,
    limit: int = 5,
    permission_scope: str | None = None,
) -> list[dict[str, Any]]:
    tenant_id = _normalize_tenant_id(tenant_id)
    query_embedding = _stable_embedding(query)
    candidates = []
    for chunk in CHUNKS.values():
        if not _belongs_to_tenant(chunk, tenant_id):
            continue
        if permission_scope and chunk["permission_scope"] != permission_scope:
            continue
        document = DOCUMENTS.get(chunk["document_id"], {})
        if not document or not _belongs_to_tenant(document, tenant_id):
            continue
        chunk_text = str(chunk["chunk_text"])
        score = cosine_score(query_embedding, chunk["embedding"]) + lexical_score(query, chunk_text) * 2
        candidates.append({
            "chunk_id": chunk["chunk_id"],
            "tenant_id": tenant_id,
            "document_id": chunk["document_id"],
            "title": chunk["title"],
            "snippet": chunk_text[:300],
            "source_location": chunk["source_location"],
            "source_file_name": document.get("source_file_name"),
            "score": round(score, 6),
        })
    return sorted(candidates, key=lambda item: item["score"], reverse=True)[: max(1, min(limit, 20))]
