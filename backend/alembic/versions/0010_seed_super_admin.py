"""seed default super admin account

Revision ID: 0010_seed_super_admin
Revises: 0009_scale_indexes
Create Date: 2026-05-24
"""
from __future__ import annotations

import os

import sqlalchemy as sa
from alembic import op

revision = "0010_seed_super_admin"
down_revision = "0009_scale_indexes"
branch_labels = None
depends_on = None


ADMIN_USERNAME = "admin"
ADMIN_PASSWORD_ENV = "PALANTIR_SEED_ADMIN_PASSWORD"


def _hash_seed_password(password: str) -> str:
    try:
        from passlib.hash import bcrypt as _bcrypt
    except Exception as exc:
        raise RuntimeError(
            f"Migration {revision} requires passlib with bcrypt support to hash the seeded admin password. "
            "Install the backend password-hashing dependencies before running deployable account migrations."
        ) from exc

    try:
        return _bcrypt.hash(password)
    except Exception as exc:
        raise RuntimeError(
            f"Migration {revision} could not hash the seeded admin password with bcrypt. "
            "Refusing to create a deploy-reachable account with an insecure fallback hash."
        ) from exc


def _required_seed_password_hash(env_name: str, username: str) -> str:
    password = os.getenv(env_name)
    if not password:
        raise RuntimeError(
            f"{env_name} must be set before migration {revision} can create user '{username}'. "
            "Refusing to seed a deploy-reachable admin account with a known default password."
        )
    return _hash_seed_password(password)


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table_name)}


def _tenant_columns(table_name: str) -> str:
    return "tenant_id, " if _has_column(table_name, "tenant_id") else ""


def _tenant_values() -> str:
    return "1, "


def _tenant_where(table_name: str) -> str:
    return " AND tenant_id = 1" if _has_column(table_name, "tenant_id") else ""


def upgrade() -> None:
    bind = op.get_bind()
    if not (_has_table("users") and _has_table("roles") and _has_table("user_roles") and _has_table("role_permissions")):
        return

    role_id = bind.execute(sa.text(
        f"SELECT id FROM roles WHERE name = 'admin'{_tenant_where('roles')} LIMIT 1"
    )).scalar()
    if role_id is None:
        bind.execute(sa.text(
            f"INSERT INTO roles ({_tenant_columns('roles')}name, label, description) "
            f"VALUES ({_tenant_values() if _has_column('roles', 'tenant_id') else ''}"
            "'admin', '超级管理员', '系统超级管理员，拥有全部权限')"
        ))
        role_id = bind.execute(sa.text(
            f"SELECT id FROM roles WHERE name = 'admin'{_tenant_where('roles')} LIMIT 1"
        )).scalar()
    else:
        bind.execute(sa.text(
            "UPDATE roles SET label = '超级管理员', description = '系统超级管理员，拥有全部权限' "
            "WHERE id = :role_id"
        ), {"role_id": role_id})

    user_id = bind.execute(sa.text(
        "SELECT id FROM users WHERE username = :username LIMIT 1"
    ), {"username": ADMIN_USERNAME}).scalar()
    if user_id is None:
        password_hash = _required_seed_password_hash(ADMIN_PASSWORD_ENV, ADMIN_USERNAME)
        bind.execute(sa.text(
            f"INSERT INTO users ({_tenant_columns('users')}username, display_name, email, hashed_password, is_active, is_admin) "
            f"VALUES ({_tenant_values() if _has_column('users', 'tenant_id') else ''}"
            ":username, '系统超级管理员', 'admin@manufoundry.local', :password_hash, TRUE, TRUE)"
        ), {"username": ADMIN_USERNAME, "password_hash": password_hash})
        user_id = bind.execute(sa.text(
            "SELECT id FROM users WHERE username = :username LIMIT 1"
        ), {"username": ADMIN_USERNAME}).scalar()
    else:
        bind.execute(sa.text(
            "UPDATE users SET is_active = TRUE, is_admin = TRUE WHERE id = :user_id"
        ), {"user_id": user_id})

    if user_id is not None and role_id is not None:
        exists = bind.execute(sa.text(
            "SELECT id FROM user_roles WHERE user_id = :user_id AND role_id = :role_id LIMIT 1"
        ), {"user_id": user_id, "role_id": role_id}).scalar()
        if exists is None:
            bind.execute(sa.text(
                f"INSERT INTO user_roles ({_tenant_columns('user_roles')}user_id, role_id) "
                f"VALUES ({_tenant_values() if _has_column('user_roles', 'tenant_id') else ''}:user_id, :role_id)"
            ), {"user_id": user_id, "role_id": role_id})

        all_permission_exists = bind.execute(sa.text(
            "SELECT id FROM role_permissions "
            "WHERE role_id = :role_id AND resource_type = 'all' AND resource_key = '*' AND action = '*' "
            "LIMIT 1"
        ), {"role_id": role_id}).scalar()
        if all_permission_exists is None:
            bind.execute(sa.text(
                f"INSERT INTO role_permissions ({_tenant_columns('role_permissions')}role_id, resource_type, resource_key, action) "
                f"VALUES ({_tenant_values() if _has_column('role_permissions', 'tenant_id') else ''}:role_id, 'all', '*', '*')"
            ), {"role_id": role_id})


def downgrade() -> None:
    # Keep the account on downgrade to avoid locking operators out.
    pass
