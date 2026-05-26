"""add AI agent runtime persistence

Revision ID: 0015_ai_agent_runtime
Revises: 0014_knowledge_extract
Create Date: 2026-05-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_ai_agent_runtime"
down_revision = "0014_knowledge_extract"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("ai_conversations"):
        op.create_table(
            "ai_conversations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("conversation_id", sa.String(length=100), nullable=False),
            sa.Column("user_id", sa.String(length=100), nullable=False),
            sa.Column("page", sa.String(length=100), nullable=False, server_default="knowledge-center"),
            sa.Column("document_id", sa.String(length=100), nullable=True),
            sa.Column("title", sa.String(length=300), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="active"),
            sa.Column("last_message", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_ai_conversations_conversation_id", "ai_conversations", ["conversation_id"], unique=True)
        op.create_index("ix_ai_conversations_user_id", "ai_conversations", ["user_id"])
        op.create_index("ix_ai_conversations_document_id", "ai_conversations", ["document_id"])

    if not _has_table("ai_messages"):
        op.create_table(
            "ai_messages",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("message_id", sa.String(length=100), nullable=False),
            sa.Column("conversation_id", sa.String(length=100), sa.ForeignKey("ai_conversations.conversation_id"), nullable=False),
            sa.Column("role", sa.String(length=30), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("evidence", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("model_name", sa.String(length=200), nullable=True),
            sa.Column("usage", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="completed"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_ai_messages_message_id", "ai_messages", ["message_id"], unique=True)
        op.create_index("ix_ai_messages_conversation_id", "ai_messages", ["conversation_id"])

    if not _has_table("ai_agent_runs"):
        op.create_table(
            "ai_agent_runs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.String(length=100), nullable=False),
            sa.Column("conversation_id", sa.String(length=100), sa.ForeignKey("ai_conversations.conversation_id"), nullable=False),
            sa.Column("user_message_id", sa.String(length=100), nullable=True),
            sa.Column("assistant_message_id", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="completed"),
            sa.Column("mode", sa.String(length=50), nullable=False, server_default="qa"),
            sa.Column("input_message", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=True),
            sa.Column("steps", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("evidence", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("actions", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("risk_level", sa.String(length=50), nullable=False, server_default="low"),
            sa.Column("requires_confirmation", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("confirmation_payload", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_ai_agent_runs_run_id", "ai_agent_runs", ["run_id"], unique=True)
        op.create_index("ix_ai_agent_runs_conversation_id", "ai_agent_runs", ["conversation_id"])

    if not _has_table("ai_tool_calls"):
        op.create_table(
            "ai_tool_calls",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("call_id", sa.String(length=100), nullable=False),
            sa.Column("run_id", sa.String(length=100), sa.ForeignKey("ai_agent_runs.run_id"), nullable=False),
            sa.Column("tool_name", sa.String(length=200), nullable=False),
            sa.Column("skill_name", sa.String(length=200), nullable=True),
            sa.Column("input", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("output", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="completed"),
            sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_ai_tool_calls_call_id", "ai_tool_calls", ["call_id"], unique=True)
        op.create_index("ix_ai_tool_calls_run_id", "ai_tool_calls", ["run_id"])

    if not _has_table("ai_memory_entries"):
        op.create_table(
            "ai_memory_entries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("memory_id", sa.String(length=100), nullable=False),
            sa.Column("conversation_id", sa.String(length=100), sa.ForeignKey("ai_conversations.conversation_id"), nullable=True),
            sa.Column("scope", sa.String(length=50), nullable=False, server_default="conversation"),
            sa.Column("key", sa.String(length=200), nullable=False),
            sa.Column("value", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_ai_memory_entries_memory_id", "ai_memory_entries", ["memory_id"], unique=True)
        op.create_index("ix_ai_memory_entries_conversation_id", "ai_memory_entries", ["conversation_id"])


def downgrade() -> None:
    for index_name, table_name in [
        ("ix_ai_memory_entries_conversation_id", "ai_memory_entries"),
        ("ix_ai_memory_entries_memory_id", "ai_memory_entries"),
        ("ix_ai_tool_calls_run_id", "ai_tool_calls"),
        ("ix_ai_tool_calls_call_id", "ai_tool_calls"),
        ("ix_ai_agent_runs_conversation_id", "ai_agent_runs"),
        ("ix_ai_agent_runs_run_id", "ai_agent_runs"),
        ("ix_ai_messages_conversation_id", "ai_messages"),
        ("ix_ai_messages_message_id", "ai_messages"),
        ("ix_ai_conversations_document_id", "ai_conversations"),
        ("ix_ai_conversations_user_id", "ai_conversations"),
        ("ix_ai_conversations_conversation_id", "ai_conversations"),
    ]:
        if _has_table(table_name):
            op.drop_index(index_name, table_name=table_name)

    for table_name in [
        "ai_memory_entries",
        "ai_tool_calls",
        "ai_agent_runs",
        "ai_messages",
        "ai_conversations",
    ]:
        if _has_table(table_name):
            op.drop_table(table_name)
