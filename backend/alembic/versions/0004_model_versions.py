"""add model_versions table + version column on meta_models

Revision ID: 0004_model_versions
Revises: 0003_rules
Create Date: 2026-05-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_model_versions"
down_revision = "0003_rules"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    # Add version column to meta_models (default 1 for existing rows)
    if "version" not in {column["name"] for column in inspector.get_columns("meta_models")}:
        op.add_column(
            "meta_models",
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        )

    if "model_versions" in inspector.get_table_names():
        return
    # Create model_versions table
    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("model_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.Text(), nullable=False),
        sa.Column("change_description", sa.String(500), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["model_id"], ["meta_models.id"]),
    )


def downgrade() -> None:
    op.drop_table("model_versions")
    op.drop_column("meta_models", "version")
