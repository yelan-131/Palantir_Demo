"""add atomic form code sequence counters

Replaces the SELECT-all-then-max scan used for auto-encoding (料号) fields,
which raced under concurrent inserts and produced duplicate codes.

Revision ID: 0035_form_code_sequences
Revises: 0034_ai_agent_registry_tables
Create Date: 2026-06-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_form_code_sequences"
down_revision = "0034_ai_agent_registry_tables"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("form_code_sequences"):
        return
    op.create_table(
        "form_code_sequences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("field_name", sa.String(length=200), nullable=False),
        sa.Column("period_key", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "form_id", "field_name", "period_key", name="uq_form_code_sequences_scope"),
    )
    op.create_index("ix_form_code_sequences_tenant_id", "form_code_sequences", ["tenant_id"])
    op.create_index("ix_form_code_sequences_form_id", "form_code_sequences", ["form_id"])


def downgrade() -> None:
    if not _has_table("form_code_sequences"):
        return
    op.drop_index("ix_form_code_sequences_form_id", table_name="form_code_sequences")
    op.drop_index("ix_form_code_sequences_tenant_id", table_name="form_code_sequences")
    op.drop_table("form_code_sequences")
