"""add active flag to roles

Revision ID: 0031_role_is_active
Revises: 0030_seed_platform_config
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031_role_is_active"
down_revision = "0030_seed_platform_config"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    if _has_table("roles") and not _has_column("roles", "is_active"):
        op.add_column("roles", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    if _has_table("roles") and _has_column("roles", "is_active"):
        op.drop_column("roles", "is_active")
