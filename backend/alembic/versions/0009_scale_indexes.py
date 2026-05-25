"""add large-list indexes for SaaS core tables

Revision ID: 0009_scale_indexes
Revises: 0008_saas_tenants
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_scale_indexes"
down_revision = "0008_saas_tenants"
branch_labels = None
depends_on = None


INDEXES = [
    ("ix_dynamic_records_tenant_form_deleted_id", "dynamic_records", ["tenant_id", "form_id", "deleted_at", "id"]),
    ("ix_dynamic_records_tenant_form_status_id", "dynamic_records", ["tenant_id", "form_id", "status", "id"]),
    ("ix_audit_logs_tenant_timestamp", "audit_logs", ["tenant_id", "timestamp"]),
    ("ix_workflow_instances_tenant_status_id", "workflow_instances", ["tenant_id", "status", "id"]),
    ("ix_reports_tenant_updated", "reports", ["tenant_id", "updated_at"]),
]


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    for index_name, table_name, columns in INDEXES:
        if _has_table(table_name) and not _has_index(table_name, index_name):
            op.create_index(index_name, table_name, columns)


def downgrade() -> None:
    for index_name, table_name, _columns in reversed(INDEXES):
        if _has_table(table_name) and _has_index(table_name, index_name):
            op.drop_index(index_name, table_name=table_name)
