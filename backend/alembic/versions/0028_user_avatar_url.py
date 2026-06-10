"""add user avatar url

Revision ID: 0028_user_avatar_url
Revises: 0027_ontology_center
Create Date: 2026-06-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028_user_avatar_url"
down_revision = "0027_ontology_center"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    if _has_table("users") and not _has_column("users", "avatar_url"):
        op.add_column("users", sa.Column("avatar_url", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    if _has_table("users") and _has_column("users", "avatar_url"):
        op.drop_column("users", "avatar_url")
