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
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from .providers import _stable_embedding


ASSETS: dict[str, dict[str, Any]] = {}
DOCUMENTS: dict[str, dict[str, Any]] = {}
CHUNKS: dict[str, dict[str, Any]] = {}
JOBS: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now().isoformat()


def _source_type(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    if suffix in {".md", ".markdown", ".txt"}:
        return "markdown"
    if suffix in {".xlsx", ".xls"}:
        return "excel"
    if suffix == ".pdf":
        return "pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        return "image"
    return "unknown"


def markdown_to_chunks(markdown: str, document_id: str, permission_scope: str = "enterprise") -> list[dict[str, Any]]:
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


def parse_pdf(file_name: str, content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover - depends on optional import
        raise RuntimeError("PDF parser dependency pypdf is not installed") from exc

    reader = PdfReader(io.BytesIO(content))
    parts = [f"# {file_name}", ""]
    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            parts.extend([f"## Page {page_index}", "", text.strip(), ""])
    if len(parts) <= 2:
        raise RuntimeError("No extractable PDF text; OCR/vision is required")
    return "\n".join(parts)


def parse_image(file_name: str, content: bytes) -> str:
    if not content:
        raise RuntimeError("Image file is empty")
    return (
        f"# {file_name}\n\n"
        "Image OCR/vision extraction placeholder. Configure a vision model such as GLM vision or another provider "
        "to extract text and visual descriptions from this image."
    )


def parse_to_markdown(file_name: str, content: bytes) -> tuple[str, str]:
    source_type = _source_type(file_name)
    if source_type == "markdown":
        return source_type, parse_markdown(file_name, content)
    if source_type == "excel":
        return source_type, parse_excel(file_name, content)
    if source_type == "pdf":
        return source_type, parse_pdf(file_name, content)
    if source_type == "image":
        return source_type, parse_image(file_name, content)
    raise RuntimeError(f"Unsupported knowledge file type: {Path(file_name).suffix or 'unknown'}")


def ingest_asset(
    file_name: str,
    content: bytes,
    owner_user_id: str = "demo-user",
    permission_scope: str = "enterprise",
) -> dict[str, Any]:
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    asset_id = f"asset-{uuid.uuid4().hex[:12]}"
    document_id = f"doc-{uuid.uuid4().hex[:12]}"
    created_at = _now()
    JOBS[job_id] = {
        "job_id": job_id,
        "asset_id": asset_id,
        "document_id": document_id,
        "status": "running",
        "error": None,
        "created_at": created_at,
        "updated_at": created_at,
    }

    ASSETS[asset_id] = {
        "asset_id": asset_id,
        "source_file_name": file_name,
        "owner_user_id": owner_user_id,
        "permission_scope": permission_scope,
        "status": "uploaded",
        "created_at": created_at,
        "updated_at": created_at,
    }

    try:
        source_type, markdown = parse_to_markdown(file_name, content)
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
            "created_at": created_at,
            "updated_at": _now(),
        }
        DOCUMENTS[document_id] = document
        for chunk in markdown_to_chunks(markdown, document_id, permission_scope):
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
        "chunks": [chunk for chunk in CHUNKS.values() if chunk["document_id"] == document_id],
    }


def cosine_score(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return 0.0
    return round(numerator / (left_norm * right_norm), 6)


def search_ingested_knowledge(query: str, limit: int = 5, permission_scope: str | None = None) -> list[dict[str, Any]]:
    query_embedding = _stable_embedding(query)
    candidates = []
    for chunk in CHUNKS.values():
        if permission_scope and chunk["permission_scope"] != permission_scope:
            continue
        document = DOCUMENTS.get(chunk["document_id"], {})
        candidates.append({
            "chunk_id": chunk["chunk_id"],
            "document_id": chunk["document_id"],
            "title": chunk["title"],
            "snippet": chunk["chunk_text"][:300],
            "source_location": chunk["source_location"],
            "source_file_name": document.get("source_file_name"),
            "score": cosine_score(query_embedding, chunk["embedding"]),
        })
    return sorted(candidates, key=lambda item: item["score"], reverse=True)[: max(1, min(limit, 20))]
