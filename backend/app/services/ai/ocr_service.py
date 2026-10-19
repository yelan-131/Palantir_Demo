"""OCR extraction for knowledge ingestion.

The service keeps OCR optional at import time so tests and lightweight demo
installs can still run without the heavier OCR wheels installed.
"""

from __future__ import annotations

import base64
import io
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Any


from app.config import settings
from app.core.logging import get_logger
from .settings import settings_snapshot, settings_to_provider_config

logger = get_logger(__name__)

LOW_CONFIDENCE_THRESHOLD = 0.72
LOW_CONFIDENCE_RATIO = 0.2
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def source_type_for_file(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    if suffix in {".md", ".markdown", ".txt"}:
        return "markdown"
    if suffix == ".docx":
        return "word"
    if suffix in {".xlsx", ".xls"}:
        return "excel"
    if suffix == ".pdf":
        return "pdf"
    if suffix in IMAGE_SUFFIXES:
        return "image"
    return "unknown"


def safe_asset_name(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(file_name).stem).strip("-") or "asset"
    return f"{stem}-{uuid.uuid4().hex[:12]}{suffix}"


def save_original_asset(file_name: str, content: bytes) -> str:
    storage_dir = Path(settings.KNOWLEDGE_STORAGE_DIR)
    if not storage_dir.is_absolute():
        storage_dir = Path.cwd() / storage_dir
    storage_dir.mkdir(parents=True, exist_ok=True)
    path = storage_dir / safe_asset_name(file_name)
    path.write_bytes(content)
    return str(path)


def ocr_markdown_from_blocks(file_name: str, blocks: list[dict[str, Any]]) -> str:
    parts = [f"# {file_name}", ""]
    by_page: dict[int, list[dict[str, Any]]] = {}
    for block in blocks:
        page_number = int(block.get("page_number") or 1)
        by_page.setdefault(page_number, []).append(block)

    for page_number in sorted(by_page):
        parts.extend([f"## Page {page_number}", ""])
        for block in by_page[page_number]:
            text = (block.get("corrected_text") or block.get("text") or "").strip()
            if not text:
                continue
            confidence = float(block.get("confidence") or 0)
            marker = " low-confidence" if confidence < LOW_CONFIDENCE_THRESHOLD else ""
            parts.append(f"> OCR confidence: {confidence:.2f}{marker}")
            parts.extend([text, ""])
    return "\n".join(parts).strip() or f"# {file_name}\n\n"


def _summarize(blocks: list[dict[str, Any]]) -> tuple[float, int]:
    if not blocks:
        return 0.0, 0
    average = round(sum(float(block.get("confidence") or 0) for block in blocks) / len(blocks), 4)
    low_count = sum(1 for block in blocks if float(block.get("confidence") or 0) < LOW_CONFIDENCE_THRESHOLD)
    return average, low_count


def should_enhance_with_vision(result: dict[str, Any]) -> bool:
    blocks = result.get("blocks") or []
    if not blocks:
        return True
    low_count = int(result.get("low_confidence_count") or 0)
    average = float(result.get("average_confidence") or 0)
    return average < LOW_CONFIDENCE_THRESHOLD or (low_count / max(len(blocks), 1)) > LOW_CONFIDENCE_RATIO


def _normalize_bbox(points: Any) -> list[float]:
    if points is None:
        return []
    if hasattr(points, "tolist"):
        points = points.tolist()
    if not points:
        return []
    if isinstance(points, (list, tuple)) and points and isinstance(points[0], (list, tuple)):
        xs = [float(point[0]) for point in points if len(point) >= 2]
        ys = [float(point[1]) for point in points if len(point) >= 2]
        if xs and ys:
            return [min(xs), min(ys), max(xs), max(ys)]
    if isinstance(points, (list, tuple)) and len(points) >= 4:
        return [float(value) for value in points[:4]]
    return []


def _rapidocr_blocks(image: bytes, page_number: int = 1) -> list[dict[str, Any]]:
    try:
        from PIL import Image
        from rapidocr import RapidOCR
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("OCR dependencies rapidocr and Pillow are not installed") from exc

    Image.open(io.BytesIO(image)).verify()
    engine = RapidOCR()
    result = engine(image)
    blocks: list[dict[str, Any]] = []

    boxes = getattr(result, "boxes", None)
    txts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    if boxes is not None and txts is not None:
        for index, (bbox, text, confidence) in enumerate(zip(boxes, txts, scores or []), start=1):
            if not str(text).strip():
                continue
            confidence = float(confidence or 0)
            blocks.append({
                "id": f"ocr-{page_number}-{index}",
                "page_number": page_number,
                "text": str(text).strip(),
                "bbox": _normalize_bbox(bbox),
                "confidence": confidence,
                "block_type": "text",
                "status": "low_confidence" if confidence < LOW_CONFIDENCE_THRESHOLD else "recognized",
                "corrected_text": "",
            })
        return blocks

    raw_items: Any = []
    if isinstance(result, tuple) and result:
        raw_items = result[0]
    if hasattr(result, "to_json"):
        try:
            raw_items = result.to_json().get("data") or raw_items
        except Exception:
            raw_items = raw_items

    for index, item in enumerate(raw_items or [], start=1):
        bbox: Any = []
        text = ""
        confidence = 0.0
        if isinstance(item, dict):
            text = str(item.get("text") or item.get("rec_text") or item.get("txt") or "")
            confidence = float(item.get("confidence") or item.get("score") or item.get("rec_score") or 0)
            bbox = item.get("bbox") or item.get("points") or item.get("box")
        elif isinstance(item, (list, tuple)):
            bbox = item[0] if len(item) > 0 else []
            text = str(item[1] if len(item) > 1 else "")
            confidence = float(item[2] if len(item) > 2 and item[2] is not None else 0)
        if not text.strip():
            continue
        blocks.append({
            "id": f"ocr-{page_number}-{index}",
            "page_number": page_number,
            "text": text.strip(),
            "bbox": _normalize_bbox(bbox),
            "confidence": confidence,
            "block_type": "text",
            "status": "low_confidence" if confidence < LOW_CONFIDENCE_THRESHOLD else "recognized",
            "corrected_text": "",
        })
    return blocks


def _pdf_page_images(content: bytes) -> list[bytes]:
    try:
        import pymupdf
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("PDF OCR fallback requires PyMuPDF") from exc

    images: list[bytes] = []
    document = pymupdf.open(stream=content, filetype="pdf")
    for page in document:
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
        images.append(pixmap.tobytes("png"))
    return images


def extract_pdf_text(file_name: str, content: bytes) -> str:
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


def vision_extract_markdown(file_name: str, content: bytes, *, settings_data: dict | None = None) -> dict[str, Any] | None:
    from .model_catalog import resolve_model_settings
    effective = resolve_model_settings(settings_data if settings_data is not None else settings_snapshot(), 'document')
    config = settings_to_provider_config(effective, purpose='document')
    api_key = config.api_key
    if not effective.get("aiEnabled", True) or config.vision_model == "disabled" or not api_key:
        return None
    from .harness_runtime import run_document_sdk
    try:
        mime_type = mimetypes.guess_type(file_name)[0] or "image/png"
        images = [("image/png", image) for image in _pdf_page_images(content)] if mime_type == 'application/pdf' else [(mime_type, content)]
        if any(mime not in {'image/png', 'image/jpeg', 'image/webp', 'image/gif'} for mime, _ in images):
            raise ValueError('视觉增强仅支持图片或 PDF')
        if sum(len(image) for _, image in images) > 15 * 1024 * 1024:
            raise ValueError('文档图片超过视觉请求大小限制，请拆分文档')
        blocks = [{"type": "text", "text": "Extract all readable text from these document images. Return clean Markdown only. Preserve page labels, tables, dates, codes, and low-confidence notes."}]
        blocks.extend({"type": "image", "mimeType": mime, "data": base64.b64encode(image).decode('ascii')} for mime, image in images)
        result = run_document_sdk(effective, blocks)
        if result.finish_reason not in {'completed', 'stop', None}:
            raise RuntimeError(f'文档模型执行未完成：{result.finish_reason}')
        if result.final_response.strip():
            usage = {}
            for event in result.events:
                for key, value in (event.get('data', {}).get('usage') or {}).items():
                    if isinstance(value, (int, float)):
                        usage[key] = usage.get(key, 0) + value
            return {"markdown": result.final_response.strip(), "model": config.vision_model, "usage": usage, "engine": "deepseek-harness"}
    except Exception as exc:
        from .settings import mask_sensitive_text
        detail = mask_sensitive_text(str(exc).replace(api_key, '[REDACTED_SECRET]'))
        logger.warning("Vision OCR enhancement skipped for %s: %s", file_name, detail)
        return {"error": detail}
    return None


def ocr_extract(file_name: str, content: bytes, *, force_vision: bool = False) -> dict[str, Any]:
    source_type = source_type_for_file(file_name)
    blocks: list[dict[str, Any]] = []
    provider = "rapidocr"

    if source_type == "image":
        blocks = _rapidocr_blocks(content, page_number=1)
    elif source_type == "pdf":
        for page_number, image in enumerate(_pdf_page_images(content), start=1):
            blocks.extend(_rapidocr_blocks(image, page_number=page_number))
    else:
        raise RuntimeError(f"OCR is not supported for source type: {source_type}")

    average, low_count = _summarize(blocks)
    result: dict[str, Any] = {
        "file_name": file_name,
        "source_type": source_type,
        "provider": provider,
        "blocks": blocks,
        "average_confidence": average,
        "low_confidence_count": low_count,
        "enhanced_by_vision": False,
        "vision_model": None,
        "vision_error": None,
    }
    result["markdown_content"] = ocr_markdown_from_blocks(file_name, blocks)

    if force_vision or should_enhance_with_vision(result):
        vision = vision_extract_markdown(file_name, content)
        if vision and vision.get("markdown"):
            result["markdown_content"] = vision["markdown"]
            result["enhanced_by_vision"] = True
            result["vision_model"] = vision.get("model")
            result["provider"] = f"{provider}+vision"
        elif vision and vision.get("error"):
            result["vision_error"] = vision["error"]

    return result
