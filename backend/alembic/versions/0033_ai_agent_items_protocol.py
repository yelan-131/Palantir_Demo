"""rename AI agent run steps to items

Revision ID: 0033_ai_agent_items_protocol
Revises: 0032_data_quality_rules
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0033_ai_agent_items_protocol"
down_revision = "0032_data_quality_rules"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    columns = _columns("ai_agent_runs")
    if "steps" in columns and "items" not in columns:
        op.alter_column("ai_agent_runs", "steps", new_column_name="items", existing_type=sa.JSON())
    elif "items" not in columns:
        op.add_column("ai_agent_runs", sa.Column("items", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    columns = _columns("ai_agent_runs")
    if "items" in columns and "steps" not in columns:
        op.alter_column("ai_agent_runs", "items", new_column_name="steps", existing_type=sa.JSON())
