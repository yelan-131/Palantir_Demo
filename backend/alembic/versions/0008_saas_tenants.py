"""add SaaS tenant isolation columns

Revision ID: 0008_saas_tenants
Revises: 0007_notification_resources
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_saas_tenants"
down_revision = "0007_notification_resources"
branch_labels = None
depends_on = None


TENANT_TABLES = [
    "users",
    "roles",
    "user_roles",
    "role_permissions",
    "menu_items",
    "applications",
    "application_menus",
    "application_roles",
    "forms",
    "application_forms",
    "application_menu_nodes",
    "form_fields",
    "form_layouts",
    "form_actions",
    "form_permissions",
    "dynamic_records",
    "workflow_bindings",
    "workflow_defs",
    "workflow_instances",
    "reports",
    "report_snapshots",
    "audit_logs",
]


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    if not _has_table("tenants"):
        op.create_table(
            "tenants",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("slug", sa.String(100), nullable=False),
            sa.Column("status", sa.String(50), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("slug", name="uq_tenants_slug"),
        )
    if not _has_index("tenants", "ix_tenants_slug"):
        op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)

    bind = op.get_bind()
    bind.execute(sa.text(
        "INSERT INTO tenants (id, name, slug, status) "
        "SELECT 1, 'Default Tenant', 'default', 'active' "
        "WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 1)"
    ))

    for table_name in TENANT_TABLES:
        if not _has_table(table_name) or _has_column(table_name, "tenant_id"):
            continue
        op.add_column(table_name, sa.Column("tenant_id", sa.Integer(), nullable=True))
        if table_name != "audit_logs":
            # SQLite cannot add FK constraints outside batch recreate; model-level
            # constraints cover fresh installs, while this migration preserves data.
            pass
        op.execute(sa.text(f"UPDATE {table_name} SET tenant_id = 1 WHERE tenant_id IS NULL"))
        index_name = f"ix_{table_name}_tenant_id"
        if not _has_index(table_name, index_name):
            op.create_index(index_name, table_name, ["tenant_id"])


def downgrade() -> None:
    for table_name in reversed(TENANT_TABLES):
        if not _has_table(table_name) or not _has_column(table_name, "tenant_id"):
            continue
        index_name = f"ix_{table_name}_tenant_id"
        if _has_index(table_name, index_name):
            op.drop_index(index_name, table_name=table_name)
        op.drop_column(table_name, "tenant_id")
    if _has_table("tenants"):
        op.drop_table("tenants")
