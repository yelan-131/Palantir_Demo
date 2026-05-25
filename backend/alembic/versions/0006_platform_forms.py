"""add platform form and dynamic record tables

Revision ID: 0006_platform_forms
Revises: 0005_applications
Create Date: 2026-05-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0006_platform_forms"
down_revision = "0005_applications"
branch_labels = None
depends_on = None


json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _create_table_once(table_name: str, *columns, **kwargs) -> None:
    if not _has_table(table_name):
        op.create_table(table_name, *columns, **kwargs)


def _create_index_once(name: str, table_name: str, columns: list[str], **kwargs) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {idx["name"] for idx in inspector.get_indexes(table_name)} if _has_table(table_name) else set()
    if name not in existing:
        op.create_index(name, table_name, columns, **kwargs)


def upgrade() -> None:
    _create_table_once(
        "forms",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("model_id", sa.Integer(), sa.ForeignKey("meta_models.id"), nullable=True),
        sa.Column("table_name", sa.String(length=200), nullable=True),
        sa.Column("storage_mode", sa.String(length=50), nullable=False, server_default="dynamic"),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="draft"),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("config", json_type, nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    _create_table_once(
        "application_forms",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("alias", sa.String(length=200), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_view", sa.String(length=50), nullable=False, server_default="list"),
        sa.Column("data_scope", sa.String(length=100), nullable=True),
        sa.Column("allow_create", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_edit", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_delete", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_export", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("application_id", "form_id", name="uq_application_forms_application_form"),
    )

    _create_table_once(
        "application_menu_nodes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("application_menu_nodes.id"), nullable=True),
        sa.Column("node_type", sa.String(length=50), nullable=False, server_default="form"),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("icon", sa.String(length=100), nullable=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=True),
        sa.Column("route_path", sa.String(length=200), nullable=True),
        sa.Column("visible", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_entry", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    _create_table_once(
        "form_fields",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("meta_field_id", sa.Integer(), sa.ForeignKey("meta_fields.id"), nullable=True),
        sa.Column("field_name", sa.String(length=200), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("field_type", sa.String(length=50), nullable=False, server_default="string"),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("visible_in_list", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("visible_in_form", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("searchable", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sortable", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("default_value", sa.String(length=500), nullable=True),
        sa.Column("enum_values", json_type, nullable=True),
        sa.Column("validation", json_type, nullable=True),
        sa.Column("ui_config", json_type, nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("form_id", "field_name", name="uq_form_fields_form_field_name"),
    )

    _create_table_once(
        "form_layouts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("layout_type", sa.String(length=50), nullable=False, server_default="list"),
        sa.Column("config", json_type, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("form_id", "layout_type", name="uq_form_layouts_form_layout_type"),
    )

    _create_table_once(
        "form_actions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("action_key", sa.String(length=100), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("action_type", sa.String(length=50), nullable=False, server_default="builtin"),
        sa.Column("config", json_type, nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    _create_table_once(
        "form_permissions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id"), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("effect", sa.String(length=20), nullable=False, server_default="allow"),
        sa.Column("field_name", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    _create_table_once(
        "dynamic_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("model_id", sa.Integer(), sa.ForeignKey("meta_models.id"), nullable=True),
        sa.Column("data", json_type, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="active"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    _create_table_once(
        "workflow_bindings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id"), nullable=False),
        sa.Column("workflow_id", sa.Integer(), sa.ForeignKey("workflow_defs.id"), nullable=False),
        sa.Column("trigger_action", sa.String(length=50), nullable=False, server_default="submit"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config", json_type, nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("form_id", "workflow_id", "trigger_action", name="uq_workflow_bindings_form_workflow_trigger"),
    )

    _create_index_once("ix_forms_code", "forms", ["code"], unique=True)
    _create_index_once("ix_forms_status", "forms", ["status"])
    _create_index_once("ix_application_forms_application_id", "application_forms", ["application_id"])
    _create_index_once("ix_application_menu_nodes_application_id", "application_menu_nodes", ["application_id"])
    _create_index_once("ix_form_fields_form_id", "form_fields", ["form_id"])
    _create_index_once("ix_dynamic_records_form_id", "dynamic_records", ["form_id"])
    _create_index_once("ix_dynamic_records_status", "dynamic_records", ["status"])


def downgrade() -> None:
    for table_name in [
        "workflow_bindings",
        "dynamic_records",
        "form_permissions",
        "form_actions",
        "form_layouts",
        "form_fields",
        "application_menu_nodes",
        "application_forms",
        "forms",
    ]:
        if _has_table(table_name):
            op.drop_table(table_name)
