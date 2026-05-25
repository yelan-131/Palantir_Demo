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
    )

    assert result["job"]["status"] == "completed"
    assert result["document"]["markdown_content"].startswith("# Material Application")
    assert result["chunks"][0]["source_location"] == "section:1"
    assert result["chunks"][0]["permission_scope"] == "enterprise"

    search_results = search_ingested_knowledge("material number category", limit=3, permission_scope="enterprise")
    assert search_results
    assert any(item["document_id"] == result["document"]["document_id"] for item in search_results)
    assert "source_location" in search_results[0]


def test_excel_ingestion_generates_markdown_summary():
    from app.services.ai.knowledge_ingestion import ingest_asset

    buffer = io.BytesIO()
    frame = pd.DataFrame({"material": ["M-001", "M-002"], "rule": ["standard", "critical"]})
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name="Rules", index=False)

    result = ingest_asset("rules.xlsx", buffer.getvalue())

    assert result["job"]["status"] == "completed"
    assert "## Sheet: Rules" in result["document"]["markdown_content"]
    assert "material" in result["document"]["markdown_content"]


def test_unsupported_ingestion_records_failed_job():
    from app.services.ai.knowledge_ingestion import ingest_asset

    result = ingest_asset("archive.zip", b"not supported")

    assert result["job"]["status"] == "failed"
    assert result["asset"]["status"] == "failed"
    assert "Unsupported knowledge file type" in result["job"]["error"]
