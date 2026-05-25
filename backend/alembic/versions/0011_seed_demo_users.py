"""seed manufacturing demo users and roles

Revision ID: 0011_seed_demo_users
Revises: 0010_seed_super_admin
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_seed_demo_users"
down_revision = "0010_seed_super_admin"
branch_labels = None
depends_on = None


TENANT_ID = 1
ADMIN_PASSWORD_HASH = "sha256$240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"
DEMO_PASSWORD_HASH = "sha256$8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"


ROLE_DEFINITIONS = [
    {
        "name": "admin",
        "label": "超级管理员",
        "description": "系统超级管理员，拥有全部权限",
        "permissions": [("all", "*", "*")],
    },
    {
        "name": "production_manager",
        "label": "生产经理",
        "description": "生产态势、设备维护、质量概览和工单相关操作。",
        "permissions": [
            ("menu", "/", "view"),
            ("menu", "/dashboard", "view"),
            ("menu", "/maintenance", "view"),
            ("menu", "/quality", "view"),
            ("action", "work_order", "create"),
        ],
    },
    {
        "name": "quality_engineer",
        "label": "质量工程师",
        "description": "质量事件、检验批次、缺陷分析和 CAPA 跟踪。",
        "permissions": [
            ("menu", "/quality", "view"),
            ("form", "quality-event", "view"),
            ("form", "quality-event", "create"),
            ("form", "quality-event", "edit"),
            ("form", "quality-event", "export"),
        ],
    },
    {
        "name": "maintenance_manager",
        "label": "设备维护经理",
        "description": "设备健康、预测性维护、维修工单和维护报表。",
        "permissions": [
            ("menu", "/maintenance", "view"),
            ("form", "maintenance-order", "view"),
            ("form", "maintenance-order", "edit"),
            ("form", "maintenance-order", "approve"),
        ],
    },
    {
        "name": "maintenance_engineer",
        "label": "维修工程师",
        "description": "维修工单执行、设备点检和告警确认。",
        "permissions": [
            ("menu", "/maintenance", "view"),
            ("form", "maintenance-order", "view"),
            ("form", "maintenance-order", "edit"),
        ],
    },
    {
        "name": "process_engineer",
        "label": "工艺工程师",
        "description": "过程能力、工艺参数和异常分析。",
        "permissions": [
            ("menu", "/dashboard", "view"),
            ("report", "process-capability-dashboard", "view"),
        ],
    },
    {
        "name": "supply_chain_manager",
        "label": "供应链经理",
        "description": "供应链风险、库存、供应商和风险复核。",
        "permissions": [
            ("menu", "/supply-chain", "view"),
            ("form", "risk-review", "view"),
            ("form", "risk-review", "approve"),
        ],
    },
    {
        "name": "warehouse_operator",
        "label": "仓储操作员",
        "description": "物料出入库、库存核对和影响范围确认。",
        "permissions": [
            ("form", "material-impact", "view"),
            ("form", "material-impact", "edit"),
        ],
    },
    {
        "name": "data_steward",
        "label": "数据专员",
        "description": "主数据维护、数据质量检查和数据变更审批。",
        "permissions": [
            ("data", "master-data", "view"),
            ("data", "master-data", "edit"),
        ],
    },
    {
        "name": "approval_lead",
        "label": "审批负责人",
        "description": "跨模块审批、风险放行和业务流程终审。",
        "permissions": [
            ("workflow", "*", "approve"),
        ],
    },
    {
        "name": "viewer",
        "label": "只读观察员",
        "description": "只读查看工作台、看板和基础报表。",
        "permissions": [
            ("menu", "*", "view"),
            ("report", "*", "view"),
        ],
    },
]


USER_DEFINITIONS = [
    {
        "username": "admin",
        "display_name": "系统超级管理员",
        "email": "admin@manufoundry.local",
        "password_hash": ADMIN_PASSWORD_HASH,
        "is_admin": True,
        "roles": ["admin"],
    },
    {
        "username": "pm_li",
        "display_name": "李明 · 生产经理",
        "email": "pm.li@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["production_manager", "approval_lead"],
    },
    {
        "username": "qe_wang",
        "display_name": "王敏 · 质量工程师",
        "email": "qe.wang@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["quality_engineer"],
    },
    {
        "username": "mm_zhou",
        "display_name": "周强 · 设备维护经理",
        "email": "mm.zhou@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["maintenance_manager"],
    },
    {
        "username": "me_sun",
        "display_name": "孙浩 · 维修工程师",
        "email": "me.sun@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["maintenance_engineer"],
    },
    {
        "username": "pe_huang",
        "display_name": "黄婷 · 工艺工程师",
        "email": "pe.huang@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["process_engineer"],
    },
    {
        "username": "scm_liu",
        "display_name": "刘洋 · 供应链经理",
        "email": "scm.liu@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["supply_chain_manager"],
    },
    {
        "username": "wh_feng",
        "display_name": "冯宇 · 仓储操作员",
        "email": "wh.feng@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["warehouse_operator"],
    },
    {
        "username": "ds_he",
        "display_name": "何静 · 数据专员",
        "email": "ds.he@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["data_steward"],
    },
    {
        "username": "auditor_gu",
        "display_name": "顾安 · 审计观察员",
        "email": "auditor.gu@manufoundry.local",
        "password_hash": DEMO_PASSWORD_HASH,
        "is_admin": False,
        "roles": ["viewer"],
    },
]


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table_name)}


def _tenant_columns(table_name: str) -> str:
    return "tenant_id, " if _has_column(table_name, "tenant_id") else ""


def _tenant_values() -> str:
    return f"{TENANT_ID}, "


def _tenant_where(table_name: str) -> str:
    return f" AND tenant_id = {TENANT_ID}" if _has_column(table_name, "tenant_id") else ""


def _ensure_tenant(bind) -> None:
    if not _has_table("tenants"):
        return
    bind.execute(sa.text(
        "INSERT INTO tenants (id, name, slug, status) "
        "SELECT :tenant_id, 'Default Tenant', 'default', 'active' "
        "WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = :tenant_id)"
    ), {"tenant_id": TENANT_ID})


def _upsert_role(bind, role: dict) -> int:
    role_id = bind.execute(sa.text(
        f"SELECT id FROM roles WHERE name = :name{_tenant_where('roles')} LIMIT 1"
    ), {"name": role["name"]}).scalar()
    if role_id is None:
        bind.execute(sa.text(
            f"INSERT INTO roles ({_tenant_columns('roles')}name, label, description) "
            f"VALUES ({_tenant_values() if _has_column('roles', 'tenant_id') else ''}:name, :label, :description)"
        ), role)
        role_id = bind.execute(sa.text(
            f"SELECT id FROM roles WHERE name = :name{_tenant_where('roles')} LIMIT 1"
        ), {"name": role["name"]}).scalar()
    else:
        bind.execute(sa.text(
            "UPDATE roles SET label = :label, description = :description WHERE id = :role_id"
        ), {"role_id": role_id, "label": role["label"], "description": role["description"]})
    return int(role_id)


def _ensure_permission(bind, role_id: int, permission: tuple[str, str, str]) -> None:
    resource_type, resource_key, action = permission
    exists = bind.execute(sa.text(
        "SELECT id FROM role_permissions "
        "WHERE role_id = :role_id AND resource_type = :resource_type "
        "AND resource_key = :resource_key AND action = :action LIMIT 1"
    ), {
        "role_id": role_id,
        "resource_type": resource_type,
        "resource_key": resource_key,
        "action": action,
    }).scalar()
    if exists is None:
        bind.execute(sa.text(
            f"INSERT INTO role_permissions ({_tenant_columns('role_permissions')}role_id, resource_type, resource_key, action) "
            f"VALUES ({_tenant_values() if _has_column('role_permissions', 'tenant_id') else ''}"
            ":role_id, :resource_type, :resource_key, :action)"
        ), {
            "role_id": role_id,
            "resource_type": resource_type,
            "resource_key": resource_key,
            "action": action,
        })


def _upsert_user(bind, user: dict) -> int:
    user_id = bind.execute(sa.text(
        "SELECT id FROM users WHERE username = :username LIMIT 1"
    ), {"username": user["username"]}).scalar()
    if user_id is None:
        bind.execute(sa.text(
            f"INSERT INTO users ({_tenant_columns('users')}username, display_name, email, hashed_password, is_active, is_admin) "
            f"VALUES ({_tenant_values() if _has_column('users', 'tenant_id') else ''}"
            ":username, :display_name, :email, :password_hash, TRUE, :is_admin)"
        ), user)
        user_id = bind.execute(sa.text(
            "SELECT id FROM users WHERE username = :username LIMIT 1"
        ), {"username": user["username"]}).scalar()
    else:
        bind.execute(sa.text(
            "UPDATE users SET display_name = :display_name, email = :email, "
            "hashed_password = :password_hash, is_active = TRUE "
            "WHERE id = :user_id"
        ), {**user, "user_id": user_id})
        if user["username"] == "admin":
            bind.execute(sa.text(
                "UPDATE users SET is_admin = TRUE WHERE id = :user_id"
            ), {"user_id": user_id})
    return int(user_id)


def _ensure_user_role(bind, user_id: int, role_id: int) -> None:
    exists = bind.execute(sa.text(
        "SELECT id FROM user_roles WHERE user_id = :user_id AND role_id = :role_id LIMIT 1"
    ), {"user_id": user_id, "role_id": role_id}).scalar()
    if exists is None:
        bind.execute(sa.text(
            f"INSERT INTO user_roles ({_tenant_columns('user_roles')}user_id, role_id) "
            f"VALUES ({_tenant_values() if _has_column('user_roles', 'tenant_id') else ''}:user_id, :role_id)"
        ), {"user_id": user_id, "role_id": role_id})


def upgrade() -> None:
    if not (_has_table("users") and _has_table("roles") and _has_table("user_roles") and _has_table("role_permissions")):
        return

    bind = op.get_bind()
    _ensure_tenant(bind)

    role_ids: dict[str, int] = {}
    for role in ROLE_DEFINITIONS:
        role_id = _upsert_role(bind, role)
        role_ids[role["name"]] = role_id
        for permission in role["permissions"]:
            _ensure_permission(bind, role_id, permission)

    for user in USER_DEFINITIONS:
        user_id = _upsert_user(bind, user)
        for role_name in user["roles"]:
            role_id = role_ids.get(role_name)
            if role_id is not None:
                _ensure_user_role(bind, user_id, role_id)


def downgrade() -> None:
    # Keep seeded demo users on downgrade to avoid breaking demo login flows.
    pass

