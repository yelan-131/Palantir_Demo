"""add ontology mapping layouts

Revision ID: 0036_ontology_mapping_layouts
Revises: 0035_form_code_sequences
Create Date: 2026-06-12 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0036_ontology_mapping_layouts"
down_revision = "0035_form_code_sequences"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("ontology_mapping_layouts"):
        return
    op.create_table(
        "ontology_mapping_layouts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("object_code", sa.String(length=120), nullable=False),
        sa.Column("source_scope", sa.String(length=120), nullable=False, server_default="all"),
        sa.Column("layout", sa.JSON(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "object_code", "source_scope", name="uq_ontology_mapping_layout_scope"),
    )
    op.create_index("ix_ontology_mapping_layout_tenant_object", "ontology_mapping_layouts", ["tenant_id", "object_code"])
    op.create_index(op.f("ix_ontology_mapping_layouts_tenant_id"), "ontology_mapping_layouts", ["tenant_id"])


def downgrade() -> None:
    if not _has_table("ontology_mapping_layouts"):
        return
    op.drop_index(op.f("ix_ontology_mapping_layouts_tenant_id"), table_name="ontology_mapping_layouts")
    op.drop_index("ix_ontology_mapping_layout_tenant_object", table_name="ontology_mapping_layouts")
    op.drop_table("ontology_mapping_layouts")
