"""seed demo application role bindings

Revision ID: 0012_seed_demo_application_roles
Revises: 0011_seed_demo_users
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_seed_demo_application_roles"
down_revision = "0011_seed_demo_users"
branch_labels = None
depends_on = None


TENANT_ID = 1

APPLICATION_ROLE_BINDINGS = {
    "production-dashboard": ["admin", "production_manager", "process_engineer", "viewer"],
    "maintenance-analysis": ["admin", "production_manager", "maintenance_manager", "maintenance_engineer", "viewer"],
    "quality-control": ["admin", "quality_inspector", "quality_engineer", "viewer"],
    "supply-risk": ["admin", "production_manager", "supply_chain_manager", "warehouse_operator", "viewer"],
}


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table_name)}


def _tenant_where(table_name: str) -> str:
    return f" AND tenant_id = {TENANT_ID}" if _has_column(table_name, "tenant_id") else ""


def _tenant_columns(table_name: str) -> str:
    return "tenant_id, " if _has_column(table_name, "tenant_id") else ""


def _tenant_values() -> str:
    return f"{TENANT_ID}, "


def upgrade() -> None:
    if not (_has_table("applications") and _has_table("roles") and _has_table("application_roles")):
        return

    bind = op.get_bind()
    for app_code, role_names in APPLICATION_ROLE_BINDINGS.items():
        app_id = bind.execute(sa.text(
            f"SELECT id FROM applications WHERE code = :code{_tenant_where('applications')} LIMIT 1"
        ), {"code": app_code}).scalar()
        if app_id is None:
            continue

        for role_name in role_names:
            role_id = bind.execute(sa.text(
                f"SELECT id FROM roles WHERE name = :name{_tenant_where('roles')} LIMIT 1"
            ), {"name": role_name}).scalar()
            if role_id is None:
                continue

            exists = bind.execute(sa.text(
                "SELECT id FROM application_roles "
                "WHERE application_id = :application_id AND role_id = :role_id LIMIT 1"
            ), {"application_id": app_id, "role_id": role_id}).scalar()
            if exists is None:
                bind.execute(sa.text(
                    f"INSERT INTO application_roles ({_tenant_columns('application_roles')}application_id, role_id) "
                    f"VALUES ({_tenant_values() if _has_column('application_roles', 'tenant_id') else ''}:application_id, :role_id)"
                ), {"application_id": app_id, "role_id": role_id})


def downgrade() -> None:
    # Keep bindings on downgrade to avoid hiding demo applications.
    pass

