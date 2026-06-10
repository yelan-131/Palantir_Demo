"""object and relation center persistence

Revision ID: 0027_ontology_center
Revises: 0026_menu_node_config
Create Date: 2026-06-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_ontology_center"
down_revision = "0026_menu_node_config"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("ontology_objects"):
        op.create_table(
            "ontology_objects",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("code", sa.String(120), nullable=False),
            sa.Column("domain", sa.String(100), nullable=False, server_default="manufacturing"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="1"),
            sa.Column("source_type", sa.String(80), nullable=False, server_default="manual"),
            sa.Column("source_ref", sa.String(300), nullable=True),
            sa.Column("review_status", sa.String(50), nullable=False, server_default="approved"),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("updated_by", sa.Integer(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "code", name="uq_ontology_objects_tenant_code"),
        )
        op.create_index("ix_ontology_objects_tenant_id", "ontology_objects", ["tenant_id"])
        op.create_index("ix_ontology_objects_tenant_status", "ontology_objects", ["tenant_id", "status"])

    if not _has_table("ontology_fields"):
        op.create_table(
            "ontology_fields",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("object_id", sa.Integer(), sa.ForeignKey("ontology_objects.id"), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("code", sa.String(120), nullable=False),
            sa.Column("field_type", sa.String(80), nullable=False, server_default="string"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("searchable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sortable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("visible_in_list", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("visible_in_form", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("status", sa.String(50), nullable=False, server_default="published"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="1"),
            sa.Column("source_type", sa.String(80), nullable=False, server_default="manual"),
            sa.Column("source_ref", sa.String(300), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "object_id", "code", name="uq_ontology_fields_tenant_object_code"),
        )
        op.create_index("ix_ontology_fields_tenant_id", "ontology_fields", ["tenant_id"])
        op.create_index("ix_ontology_fields_tenant_object", "ontology_fields", ["tenant_id", "object_id"])

    if not _has_table("ontology_relations"):
        op.create_table(
            "ontology_relations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("code", sa.String(180), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("relation_type", sa.String(100), nullable=False, server_default="RELATED_TO"),
            sa.Column("source_object_id", sa.Integer(), sa.ForeignKey("ontology_objects.id"), nullable=True),
            sa.Column("target_object_id", sa.Integer(), sa.ForeignKey("ontology_objects.id"), nullable=True),
            sa.Column("source_object_code", sa.String(120), nullable=False),
            sa.Column("target_object_code", sa.String(120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("graph_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="1"),
            sa.Column("source_type", sa.String(80), nullable=False, server_default="manual"),
            sa.Column("source_ref", sa.String(300), nullable=True),
            sa.Column("review_status", sa.String(50), nullable=False, server_default="approved"),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "code", name="uq_ontology_relations_tenant_code"),
        )
        op.create_index("ix_ontology_relations_tenant_id", "ontology_relations", ["tenant_id"])
        op.create_index("ix_ontology_relations_tenant_status", "ontology_relations", ["tenant_id", "status"])

    if not _has_table("ontology_mappings"):
        op.create_table(
            "ontology_mappings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("source_system", sa.String(120), nullable=False),
            sa.Column("source_type", sa.String(80), nullable=False, server_default="database"),
            sa.Column("source_entity", sa.String(200), nullable=False),
            sa.Column("source_field", sa.String(200), nullable=False),
            sa.Column("source_field_type", sa.String(100), nullable=True),
            sa.Column("target_object_id", sa.Integer(), sa.ForeignKey("ontology_objects.id"), nullable=True),
            sa.Column("target_field_id", sa.Integer(), sa.ForeignKey("ontology_fields.id"), nullable=True),
            sa.Column("target_object_code", sa.String(120), nullable=False),
            sa.Column("target_field_code", sa.String(120), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(50), nullable=False, server_default="candidate"),
            sa.Column("evidence", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint(
                "tenant_id",
                "source_system",
                "source_entity",
                "source_field",
                "target_object_code",
                "target_field_code",
                name="uq_ontology_mappings_source_target",
            ),
        )
        op.create_index("ix_ontology_mappings_tenant_id", "ontology_mappings", ["tenant_id"])
        op.create_index("ix_ontology_mappings_tenant_target", "ontology_mappings", ["tenant_id", "target_object_code", "target_field_code"])

    if not _has_table("ontology_candidates"):
        op.create_table(
            "ontology_candidates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("candidate_key", sa.String(300), nullable=False),
            sa.Column("candidate_type", sa.String(50), nullable=False),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("source_type", sa.String(80), nullable=False, server_default="metadata"),
            sa.Column("source_ref", sa.String(300), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(50), nullable=False, server_default="pending_review"),
            sa.Column("merge_target_id", sa.Integer(), nullable=True),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("review_note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "candidate_key", name="uq_ontology_candidates_tenant_key"),
        )
        op.create_index("ix_ontology_candidates_tenant_id", "ontology_candidates", ["tenant_id"])
        op.create_index("ix_ontology_candidates_tenant_status", "ontology_candidates", ["tenant_id", "status"])

    if not _has_table("ontology_versions"):
        op.create_table(
            "ontology_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("snapshot", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("status", sa.String(50), nullable=False, server_default="published"),
            sa.Column("published_by", sa.Integer(), nullable=True),
            sa.Column("published_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        )
        op.create_index("ix_ontology_versions_tenant_id", "ontology_versions", ["tenant_id"])
        op.create_index("ix_ontology_versions_tenant_version", "ontology_versions", ["tenant_id", "version"])

    if not _has_table("ontology_publish_logs"):
        op.create_table(
            "ontology_publish_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("action", sa.String(50), nullable=False),
            sa.Column("resource_type", sa.String(80), nullable=False),
            sa.Column("resource_id", sa.Integer(), nullable=True),
            sa.Column("actor_id", sa.Integer(), nullable=True),
            sa.Column("detail", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        )
        op.create_index("ix_ontology_publish_logs_tenant_id", "ontology_publish_logs", ["tenant_id"])
        op.create_index("ix_ontology_publish_logs_tenant_action", "ontology_publish_logs", ["tenant_id", "action"])

    if not _has_table("data_source_metadata"):
        op.create_table(
            "data_source_metadata",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("source_id", sa.Integer(), sa.ForeignKey("data_sources.id"), nullable=False),
            sa.Column("source_type", sa.String(80), nullable=False, server_default="database"),
            sa.Column("entity_name", sa.String(200), nullable=False),
            sa.Column("entity_label", sa.String(200), nullable=True),
            sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("fields", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("relationships", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("sample_rows", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(50), nullable=False, server_default="scanned"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "source_id", "entity_name", name="uq_data_source_metadata_source_entity"),
        )
        op.create_index("ix_data_source_metadata_tenant_id", "data_source_metadata", ["tenant_id"])
        op.create_index("ix_data_source_metadata_tenant_source", "data_source_metadata", ["tenant_id", "source_id"])

    if not _has_table("data_source_sync_status"):
        op.create_table(
            "data_source_sync_status",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False, server_default="1"),
            sa.Column("source_id", sa.Integer(), sa.ForeignKey("data_sources.id"), nullable=False),
            sa.Column("status", sa.String(50), nullable=False, server_default="idle"),
            sa.Column("last_started_at", sa.DateTime(), nullable=True),
            sa.Column("last_finished_at", sa.DateTime(), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("tables_scanned", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("fields_scanned", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "source_id", name="uq_data_source_sync_status_tenant_source"),
        )
        op.create_index("ix_data_source_sync_status_tenant_id", "data_source_sync_status", ["tenant_id"])


def downgrade() -> None:
    for table_name in [
        "data_source_sync_status",
        "data_source_metadata",
        "ontology_publish_logs",
        "ontology_versions",
        "ontology_candidates",
        "ontology_mappings",
        "ontology_relations",
        "ontology_fields",
        "ontology_objects",
    ]:
        if _has_table(table_name):
            op.drop_table(table_name)
