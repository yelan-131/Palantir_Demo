"""add database-backed AI agent registry

Revision ID: 0034_ai_agent_registry_tables
Revises: 0033_ai_agent_items_protocol
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_ai_agent_registry_tables"
down_revision = "0033_ai_agent_items_protocol"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("ai_agent_skill_definitions"):
        op.create_table(
            "ai_agent_skill_definitions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("title", sa.String(length=240), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("definition", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("source", sa.String(length=80), nullable=False, server_default="seed"),
            sa.Column("updated_by", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("name", name="uq_ai_agent_skill_definitions_name"),
        )
        op.create_index("ix_ai_agent_skill_definitions_enabled", "ai_agent_skill_definitions", ["enabled"])

    if not _has_table("ai_agent_tool_definitions"):
        op.create_table(
            "ai_agent_tool_definitions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("title", sa.String(length=240), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("handler_key", sa.String(length=160), nullable=False, server_default="not_implemented"),
            sa.Column("definition", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("source", sa.String(length=80), nullable=False, server_default="seed"),
            sa.Column("updated_by", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("name", name="uq_ai_agent_tool_definitions_name"),
        )
        op.create_index("ix_ai_agent_tool_definitions_enabled", "ai_agent_tool_definitions", ["enabled"])


def downgrade() -> None:
    if _has_table("ai_agent_tool_definitions"):
        op.drop_index("ix_ai_agent_tool_definitions_enabled", table_name="ai_agent_tool_definitions")
        op.drop_table("ai_agent_tool_definitions")
    if _has_table("ai_agent_skill_definitions"):
        op.drop_index("ix_ai_agent_skill_definitions_enabled", table_name="ai_agent_skill_definitions")
        op.drop_table("ai_agent_skill_definitions")
