"""form physical table metadata

Revision ID: 0029_form_physical_tables
Revises: 0028_user_avatar_url
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0029_form_physical_tables"
down_revision = "0028_user_avatar_url"
branch_labels = None
depends_on = None

json_type = sa.JSON()


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {idx["name"] for idx in sa.inspect(op.get_bind()).get_indexes(table_name)}


def _create_index(index_name: str, table: str, columns: list[str], *, unique: bool = False) -> None:
    if _has_table(table) and not _has_index(table, index_name):
        op.create_index(index_name, table, columns, unique=unique)


def upgrade() -> None:
    if not _has_table("form_physical_tables"):
        op.create_table(
            "form_physical_tables",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
            sa.Column("base_table_name", sa.String(200), nullable=False),
            sa.Column("part_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("field_limit_per_part", sa.Integer(), nullable=False, server_default="200"),
            sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("status", sa.String(50), nullable=False, server_default="active"),
            sa.Column("config", json_type, nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "form_id", name="uq_form_physical_tables_tenant_form"),
        )
    if not _has_table("form_physical_fields"):
        op.create_table(
            "form_physical_fields",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
            sa.Column("field_id", sa.Integer(), nullable=False),
            sa.Column("field_name", sa.String(200), nullable=False),
            sa.Column("column_name", sa.String(200), nullable=False),
            sa.Column("part_index", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("part_table_name", sa.String(200), nullable=False),
            sa.Column("field_type", sa.String(50), nullable=False, server_default="string"),
            sa.Column("indexed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sortable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("searchable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "form_id", "field_id", name="uq_form_physical_fields_tenant_form_field"),
        )
    if not _has_table("form_physical_migrations"):
        op.create_table(
            "form_physical_migrations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
            sa.Column("migration_type", sa.String(50), nullable=False, server_default="full"),
            sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
            sa.Column("source_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("migrated_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.Column("config", json_type, nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        )

    _create_index("ix_form_physical_tables_form_id", "form_physical_tables", ["form_id"])
    _create_index("ix_form_physical_fields_form_part", "form_physical_fields", ["tenant_id", "form_id", "part_index"])
    _create_index("ix_form_physical_fields_name", "form_physical_fields", ["tenant_id", "form_id", "field_name"])
    _create_index("ix_form_physical_migrations_form_status", "form_physical_migrations", ["tenant_id", "form_id", "status"])


def downgrade() -> None:
    for table in ["form_physical_migrations", "form_physical_fields", "form_physical_tables"]:
        if _has_table(table):
            op.drop_table(table)
