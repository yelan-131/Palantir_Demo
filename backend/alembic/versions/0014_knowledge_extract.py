"""add knowledge extraction persistence

Revision ID: 0014_knowledge_extract
Revises: 0013_seed_demo_org_units
Create Date: 2026-05-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_knowledge_extract"
down_revision = "0013_seed_demo_org_units"
branch_labels = None
depends_on = None


INDEX_DEFINITIONS = [
    ("ix_knowledge_documents_document_id", "knowledge_documents", ["document_id"]),
    ("ix_knowledge_chunks_chunk_id", "knowledge_chunks", ["chunk_id"]),
    ("ix_knowledge_chunks_document_id", "knowledge_chunks", ["document_id"]),
    ("ix_knowledge_ingestion_jobs_job_id", "knowledge_ingestion_jobs", ["job_id"]),
    ("ix_knowledge_ingestion_jobs_asset_id", "knowledge_ingestion_jobs", ["asset_id"]),
    ("ix_knowledge_ingestion_jobs_document_id", "knowledge_ingestion_jobs", ["document_id"]),
    ("ix_knowledge_extraction_results_job_id", "knowledge_extraction_results", ["job_id"]),
    ("ix_knowledge_extraction_results_document_id", "knowledge_extraction_results", ["document_id"]),
    ("ix_knowledge_object_links_document_id", "knowledge_object_links", ["document_id"]),
    ("ix_knowledge_object_links_job_id", "knowledge_object_links", ["job_id"]),
]


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _indexes(table_name: str) -> dict[str, dict]:
    if not _has_table(table_name):
        return {}
    return {
        index["name"]: index
        for index in sa.inspect(op.get_bind()).get_indexes(table_name)
        if index.get("name")
    }


def _ensure_lookup_index(index_name: str, table_name: str, columns: list[str]) -> None:
    indexes = _indexes(table_name)
    if index_name in indexes:
        if not indexes[index_name].get("unique"):
            return
        op.drop_index(index_name, table_name=table_name)
    op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    if not _has_table("knowledge_documents"):
        op.create_table(
            "knowledge_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_id", sa.String(length=100), nullable=False),
            sa.Column("source_file_name", sa.String(length=500), nullable=False),
            sa.Column("source_type", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=300), nullable=False),
            sa.Column("markdown_content", sa.Text(), nullable=False),
            sa.Column("permission_scope", sa.String(length=50), nullable=False, server_default="enterprise"),
            sa.Column("owner_user_id", sa.String(length=100), nullable=True),
            sa.Column("source_path", sa.String(length=1000), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="indexed"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    if not _has_table("knowledge_chunks"):
        op.create_table(
            "knowledge_chunks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("chunk_id", sa.String(length=100), nullable=False),
            sa.Column("document_id", sa.String(length=100), nullable=False),
            sa.Column("title", sa.String(length=300), nullable=False),
            sa.Column("chunk_text", sa.Text(), nullable=False),
            sa.Column("embedding", sa.JSON(), nullable=True),
            sa.Column("source_location", sa.String(length=200), nullable=False, server_default="section:1"),
            sa.Column("permission_scope", sa.String(length=50), nullable=False, server_default="enterprise"),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="indexed"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    if not _has_table("knowledge_ingestion_jobs"):
        op.create_table(
            "knowledge_ingestion_jobs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.String(length=100), nullable=False),
            sa.Column("asset_id", sa.String(length=100), nullable=False),
            sa.Column("document_id", sa.String(length=100), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="running"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    if not _has_table("knowledge_extraction_results"):
        op.create_table(
            "knowledge_extraction_results",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.String(length=100), nullable=False),
            sa.Column("document_id", sa.String(length=100), nullable=False),
            sa.Column("domain", sa.String(length=100), nullable=False, server_default="manufacturing"),
            sa.Column("prompt_name", sa.String(length=200), nullable=False, server_default="manufacturing_ontology_v1"),
            sa.Column("model_name", sa.String(length=200), nullable=False, server_default="rules-ontology-extractor"),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="completed"),
            sa.Column("result", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("approved_result", sa.JSON(), nullable=True),
            sa.Column("quality_report", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("committed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    if not _has_table("knowledge_object_links"):
        op.create_table(
            "knowledge_object_links",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("document_id", sa.String(length=100), nullable=False),
            sa.Column("job_id", sa.String(length=100), nullable=True),
            sa.Column("object_type", sa.String(length=100), nullable=False),
            sa.Column("object_id", sa.String(length=200), nullable=False),
            sa.Column("object_name", sa.String(length=300), nullable=False),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
            sa.Column("source_location", sa.String(length=200), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="candidate"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    # Tenant-scoped uniqueness is added later in 0023; keep these as lookup indexes only.
    for index_name, table_name, columns in INDEX_DEFINITIONS:
        if _has_table(table_name):
            _ensure_lookup_index(index_name, table_name, columns)


def downgrade() -> None:
    for index_name, table_name, _columns in reversed(INDEX_DEFINITIONS):
        if _has_table(table_name) and index_name in _indexes(table_name):
            op.drop_index(index_name, table_name=table_name)

    for table_name in [
        "knowledge_object_links",
        "knowledge_extraction_results",
        "knowledge_ingestion_jobs",
        "knowledge_chunks",
        "knowledge_documents",
    ]:
        if _has_table(table_name):
            op.drop_table(table_name)
