"""add rules table

Revision ID: 0003_rules
Revises: 0002_audit_log
Create Date: 2026-05-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_rules"
down_revision = "0002_audit_log"


def upgrade() -> None:
    op.create_table(
        "rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("model_id", sa.Integer(), sa.ForeignKey("meta_models.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("rule_type", sa.String(20), nullable=False),
        sa.Column("field_name", sa.String(100), nullable=True),
        sa.Column("condition", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=True),
        sa.Column("message", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("priority", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("rules")
