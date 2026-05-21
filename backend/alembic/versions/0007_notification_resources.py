"""add notification resource reference columns

Revision ID: 0007_notification_resources
Revises: 0006_platform_forms
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_notification_resources"
down_revision = "0006_platform_forms"


def upgrade() -> None:
    op.add_column("notifications", sa.Column("resource_type", sa.String(100), nullable=True))
    op.add_column("notifications", sa.Column("resource_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "resource_id")
    op.drop_column("notifications", "resource_type")
