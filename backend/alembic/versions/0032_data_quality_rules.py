"""add data quality rule configuration

Revision ID: 0032_data_quality_rules
Revises: 0031_role_is_active
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0032_data_quality_rules"
down_revision = "0031_role_is_active"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("data_quality_rules"):
        return
    op.create_table(
        "data_quality_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("entity_name", sa.String(length=200), nullable=False),
        sa.Column("field_name", sa.String(length=200), nullable=True),
        sa.Column("key", sa.String(length=160), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("rule_type", sa.String(length=80), nullable=False, server_default="custom"),
        sa.Column("dimension", sa.String(length=80), nullable=False, server_default="custom"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("severity", sa.String(length=50), nullable=False, server_default="warning"),
        sa.Column("threshold", sa.Integer(), nullable=False, server_default="95"),
        sa.Column("weight", sa.Float(), nullable=False, server_default="1"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("include_in_score", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["data_sources.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "source_id", "entity_name", "key", name="uq_data_quality_rules_source_entity_key"),
    )
    op.create_index(
        "ix_data_quality_rules_tenant_source_entity",
        "data_quality_rules",
        ["tenant_id", "source_id", "entity_name"],
    )
    op.create_index(op.f("ix_data_quality_rules_tenant_id"), "data_quality_rules", ["tenant_id"])


def downgrade() -> None:
    if not _has_table("data_quality_rules"):
        return
    op.drop_index(op.f("ix_data_quality_rules_tenant_id"), table_name="data_quality_rules")
    op.drop_index("ix_data_quality_rules_tenant_source_entity", table_name="data_quality_rules")
    op.drop_table("data_quality_rules")
