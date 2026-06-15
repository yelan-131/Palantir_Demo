"""workflow definition version snapshots + instance version pinning

In-flight workflow instances used to re-read the live definition config on
every approval, so editing a definition reshaped running instances
(current_step index drift, skipped/duplicated steps). Definitions now snapshot
into workflow_def_versions on create/update and instances pin
workflow_version at start.

Backfills one snapshot per existing definition at its current version so
already-deployed definitions are pinnable immediately. Existing instances keep
workflow_version NULL and continue resolving the live config (legacy
behavior, unchanged).

Revision ID: 0037_workflow_def_versions
Revises: 0036_ontology_mapping_layouts
Create Date: 2026-06-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037_workflow_def_versions"
down_revision = "0036_ontology_mapping_layouts"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    columns = sa.inspect(op.get_bind()).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    if not _has_table("workflow_def_versions"):
        op.create_table(
            "workflow_def_versions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("workflow_id", sa.Integer(), sa.ForeignKey("workflow_defs.id"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("config", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("form_config", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="draft"),
            sa.Column("published_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("published_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("workflow_id", "version", name="uq_workflow_def_versions_workflow_version"),
        )
        op.create_index("ix_workflow_def_versions_tenant_id", "workflow_def_versions", ["tenant_id"])
        op.create_index("ix_workflow_def_versions_workflow_id", "workflow_def_versions", ["workflow_id"])

        # Backfill: snapshot every existing definition at its current version.
        op.execute(sa.text(
            """
            INSERT INTO workflow_def_versions (tenant_id, workflow_id, version, config, form_config, status)
            SELECT tenant_id, id, COALESCE(version, 1), COALESCE(config, '{}'), form_config, COALESCE(status, 'draft')
            FROM workflow_defs
            """
        ))

    if _has_table("workflow_instances") and not _has_column("workflow_instances", "workflow_version"):
        op.add_column("workflow_instances", sa.Column("workflow_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    if _has_table("workflow_instances") and _has_column("workflow_instances", "workflow_version"):
        op.drop_column("workflow_instances", "workflow_version")
    if _has_table("workflow_def_versions"):
        op.drop_index("ix_workflow_def_versions_workflow_id", table_name="workflow_def_versions")
        op.drop_index("ix_workflow_def_versions_tenant_id", table_name="workflow_def_versions")
        op.drop_table("workflow_def_versions")
