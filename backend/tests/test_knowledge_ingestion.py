"""Tests for knowledge upload parsing, Markdown conversion, and vector-shaped search."""

import io

import pandas as pd


def test_markdown_ingestion_creates_document_chunks_and_search_result():
    from app.services.ai.knowledge_ingestion import ingest_asset, search_ingested_knowledge

    result = ingest_asset(
        "material-process.md",
        b"# Material Application\n\nMaterial number applications require category and unit.",
        owner_user_id="tester",
        permission_scope="enterprise",
        tenant_id=7,
    )

    assert result["job"]["status"] == "completed"
    assert result["document"]["tenant_id"] == 7
    assert result["document"]["markdown_content"].startswith("# Material Application")
    assert result["chunks"][0]["source_location"] == "section:1"
    assert result["chunks"][0]["permission_scope"] == "enterprise"
    assert result["chunks"][0]["tenant_id"] == 7

    search_results = search_ingested_knowledge("material number category", tenant_id=7, limit=3, permission_scope="enterprise")
    assert search_results
    assert any(item["document_id"] == result["document"]["document_id"] for item in search_results)
    assert "source_location" in search_results[0]

    other_tenant_results = search_ingested_knowledge("material number category", tenant_id=8, limit=3, permission_scope="enterprise")
    assert not any(item["document_id"] == result["document"]["document_id"] for item in other_tenant_results)


def test_excel_ingestion_generates_markdown_summary():
    from app.services.ai.knowledge_ingestion import ingest_asset

    buffer = io.BytesIO()
    frame = pd.DataFrame({"material": ["M-001", "M-002"], "rule": ["standard", "critical"]})
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name="Rules", index=False)

    result = ingest_asset("rules.xlsx", buffer.getvalue(), tenant_id=1)

    assert result["job"]["status"] == "completed"
    assert "## Sheet: Rules" in result["document"]["markdown_content"]
    assert "material" in result["document"]["markdown_content"]


def test_unsupported_ingestion_records_failed_job():
    from app.services.ai.knowledge_ingestion import ingest_asset

    result = ingest_asset("archive.zip", b"not supported", tenant_id=1)

    assert result["job"]["status"] == "failed"
    assert result["asset"]["status"] == "failed"
    assert "Unsupported knowledge file type" in result["job"]["error"]


def test_image_ingestion_uses_ocr_metadata(monkeypatch, tmp_path):
    from app.services.ai import knowledge_ingestion

    monkeypatch.setattr(knowledge_ingestion, "save_original_asset", lambda file_name, content: str(tmp_path / file_name))
    monkeypatch.setattr(
        knowledge_ingestion,
        "ocr_extract",
        lambda file_name, content: {
            "markdown_content": f"# {file_name}\n\nRecognized serial number SN-7781",
            "blocks": [
                {
                    "id": "ocr-1-1",
                    "page_number": 1,
                    "text": "Recognized serial number SN-7781",
                    "bbox": [0, 0, 100, 20],
                    "confidence": 0.91,
                    "block_type": "text",
                    "status": "recognized",
                    "corrected_text": "",
                }
            ],
            "average_confidence": 0.91,
            "low_confidence_count": 0,
            "provider": "rapidocr",
            "enhanced_by_vision": False,
        },
    )

    result = knowledge_ingestion.ingest_asset("label.png", b"fake image", tenant_id=1)

    assert result["job"]["status"] == "completed"
    assert result["document"]["source_type"] == "image"
    assert "placeholder" not in result["document"]["markdown_content"].lower()
    assert result["document"]["ocr_result"]["blocks"][0]["confidence"] == 0.91


def test_scanned_pdf_falls_back_to_ocr(monkeypatch, tmp_path):
    from app.services.ai import knowledge_ingestion

    monkeypatch.setattr(knowledge_ingestion, "save_original_asset", lambda file_name, content: str(tmp_path / file_name))
    monkeypatch.setattr(
        knowledge_ingestion,
        "extract_pdf_text",
        lambda file_name, content: (_ for _ in ()).throw(RuntimeError("No extractable PDF text; OCR/vision is required")),
    )
    monkeypatch.setattr(
        knowledge_ingestion,
        "ocr_extract",
        lambda file_name, content: {
            "markdown_content": f"# {file_name}\n\nScanned PDF OCR text",
            "blocks": [{"id": "ocr-1-1", "page_number": 1, "text": "Scanned PDF OCR text", "confidence": 0.8}],
            "average_confidence": 0.8,
            "low_confidence_count": 0,
            "provider": "rapidocr",
            "enhanced_by_vision": False,
        },
    )

    result = knowledge_ingestion.ingest_asset("scan.pdf", b"%PDF fake", tenant_id=1)

    assert result["job"]["status"] == "completed"
    assert result["document"]["source_type"] == "pdf"
    assert "Scanned PDF OCR text" in result["document"]["markdown_content"]
    assert result["document"]["ocr_result"]["provider"] == "rapidocr"


def test_ocr_corrections_refresh_markdown_and_chunks(monkeypatch, tmp_path):
    from app.services.ai import knowledge_ingestion

    monkeypatch.setattr(knowledge_ingestion, "save_original_asset", lambda file_name, content: str(tmp_path / file_name))
    monkeypatch.setattr(
        knowledge_ingestion,
        "ocr_extract",
        lambda file_name, content: {
            "markdown_content": f"# {file_name}\n\nBad reccognition",
            "blocks": [{"id": "ocr-1-1", "page_number": 1, "text": "Bad reccognition", "confidence": 0.55}],
            "average_confidence": 0.55,
            "low_confidence_count": 1,
            "provider": "rapidocr",
            "enhanced_by_vision": False,
        },
    )
    result = knowledge_ingestion.ingest_asset("field.png", b"fake image", tenant_id=1)
    document_id = result["document"]["document_id"]

    updated = knowledge_ingestion.update_ocr_corrections(
        document_id,
        [{"id": "ocr-1-1", "page_number": 1, "text": "Bad reccognition", "corrected_text": "Good recognition", "confidence": 0.55}],
        tenant_id=1,
    )

    assert updated is not None
    assert "Good recognition" in updated["markdown_content"]
    refreshed_chunks = [chunk for chunk in knowledge_ingestion.CHUNKS.values() if chunk["document_id"] == document_id]
    assert any("Good recognition" in chunk["chunk_text"] for chunk in refreshed_chunks)
