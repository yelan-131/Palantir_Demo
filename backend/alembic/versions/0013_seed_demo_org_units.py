"""add demo organization units and memberships

Revision ID: 0013_seed_demo_org_units
Revises: 0012_seed_demo_application_roles
Create Date: 2026-05-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_seed_demo_org_units"
down_revision = "0012_seed_demo_application_roles"
branch_labels = None
depends_on = None


TENANT_ID = 1

ORG_UNITS = [
    ("mf-root", None, "ManuFoundry 制造集团", "company", 10, "制造业 Demo 根组织"),
    ("plant-a", "mf-root", "上海一厂", "factory", 20, "核心生产基地"),
    ("production", "plant-a", "生产运营部", "department", 30, "生产计划、现场协调和工单推进"),
    ("quality", "plant-a", "质量管理部", "department", 40, "质量事件、检验和 CAPA 管理"),
    ("maintenance", "plant-a", "设备维护部", "department", 50, "设备健康、维修工单和点检"),
    ("process", "plant-a", "工艺工程部", "department", 60, "工艺参数和过程能力管理"),
    ("supply-chain", "mf-root", "供应链管理部", "department", 70, "供应风险、供应商和采购协同"),
    ("warehouse", "plant-a", "仓储物流组", "team", 80, "库存、出入库和物料影响确认"),
    ("data-governance", "mf-root", "数据治理组", "team", 90, "主数据和数据质量维护"),
    ("audit", "mf-root", "审计观察组", "team", 100, "审计、只读观察和合规复核"),
]

USER_ORG_MEMBERSHIPS = [
    ("admin", "mf-root", "系统超级管理员", True),
    ("pm_li", "production", "生产经理", True),
    ("qe_wang", "quality", "质量工程师", True),
    ("mm_zhou", "maintenance", "设备维护经理", True),
    ("me_sun", "maintenance", "维修工程师", True),
    ("pe_huang", "process", "工艺工程师", True),
    ("scm_liu", "supply-chain", "供应链经理", True),
    ("wh_feng", "warehouse", "仓储操作员", True),
    ("ds_he", "data-governance", "数据专员", True),
    ("auditor_gu", "audit", "审计观察员", True),
]


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table("org_units"):
        op.create_table(
            "org_units",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("parent_id", sa.Integer(), sa.ForeignKey("org_units.id"), nullable=True),
            sa.Column("code", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("org_type", sa.String(length=50), nullable=False, server_default="department"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="active"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("tenant_id", "code", name="uq_org_units_tenant_code"),
        )
        op.create_index("ix_org_units_tenant_id", "org_units", ["tenant_id"])
        op.create_index("ix_org_units_parent_id", "org_units", ["parent_id"])

    if not _has_table("user_org_memberships"):
        op.create_table(
            "user_org_memberships",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("org_unit_id", sa.Integer(), sa.ForeignKey("org_units.id"), nullable=False),
            sa.Column("position_title", sa.String(length=200), nullable=True),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("tenant_id", "user_id", "org_unit_id", name="uq_user_org_memberships_user_org"),
        )
        op.create_index("ix_user_org_memberships_tenant_id", "user_org_memberships", ["tenant_id"])
        op.create_index("ix_user_org_memberships_user_id", "user_org_memberships", ["user_id"])
        op.create_index("ix_user_org_memberships_org_unit_id", "user_org_memberships", ["org_unit_id"])

    bind.execute(sa.text(
        "INSERT INTO tenants (id, name, slug, status) "
        "SELECT :tenant_id, 'Default Tenant', 'default', 'active' "
        "WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = :tenant_id)"
    ), {"tenant_id": TENANT_ID})

    org_ids: dict[str, int] = {}
    for code, parent_code, name, org_type, sort_order, description in ORG_UNITS:
        parent_id = org_ids.get(parent_code) if parent_code else None
        org_id = bind.execute(sa.text(
            "SELECT id FROM org_units WHERE tenant_id = :tenant_id AND code = :code LIMIT 1"
        ), {"tenant_id": TENANT_ID, "code": code}).scalar()
        if org_id is None:
            org_id = bind.execute(sa.text(
                "INSERT INTO org_units (tenant_id, parent_id, code, name, org_type, sort_order, status, description) "
                "VALUES (:tenant_id, :parent_id, :code, :name, :org_type, :sort_order, 'active', :description) "
                "RETURNING id"
            ), {
                "tenant_id": TENANT_ID,
                "parent_id": parent_id,
                "code": code,
                "name": name,
                "org_type": org_type,
                "sort_order": sort_order,
                "description": description,
            }).scalar()
        else:
            bind.execute(sa.text(
                "UPDATE org_units SET parent_id = :parent_id, name = :name, org_type = :org_type, "
                "sort_order = :sort_order, status = 'active', description = :description "
                "WHERE id = :org_id"
            ), {
                "org_id": org_id,
                "parent_id": parent_id,
                "name": name,
                "org_type": org_type,
                "sort_order": sort_order,
                "description": description,
            })
        org_ids[code] = int(org_id)

    for username, org_code, position_title, is_primary in USER_ORG_MEMBERSHIPS:
        user_id = bind.execute(sa.text(
            "SELECT id FROM users WHERE username = :username LIMIT 1"
        ), {"username": username}).scalar()
        org_id = org_ids.get(org_code)
        if user_id is None or org_id is None:
            continue
        if is_primary:
            bind.execute(sa.text(
                "UPDATE user_org_memberships SET is_primary = FALSE "
                "WHERE tenant_id = :tenant_id AND user_id = :user_id"
            ), {"tenant_id": TENANT_ID, "user_id": user_id})
        membership_id = bind.execute(sa.text(
            "SELECT id FROM user_org_memberships "
            "WHERE tenant_id = :tenant_id AND user_id = :user_id AND org_unit_id = :org_unit_id LIMIT 1"
        ), {"tenant_id": TENANT_ID, "user_id": user_id, "org_unit_id": org_id}).scalar()
        if membership_id is None:
            bind.execute(sa.text(
                "INSERT INTO user_org_memberships (tenant_id, user_id, org_unit_id, position_title, is_primary) "
                "VALUES (:tenant_id, :user_id, :org_unit_id, :position_title, :is_primary)"
            ), {
                "tenant_id": TENANT_ID,
                "user_id": user_id,
                "org_unit_id": org_id,
                "position_title": position_title,
                "is_primary": is_primary,
            })
        else:
            bind.execute(sa.text(
                "UPDATE user_org_memberships SET position_title = :position_title, is_primary = :is_primary "
                "WHERE id = :membership_id"
            ), {
                "membership_id": membership_id,
                "position_title": position_title,
                "is_primary": is_primary,
            })


def downgrade() -> None:
    if _has_table("user_org_memberships"):
        op.drop_index("ix_user_org_memberships_org_unit_id", table_name="user_org_memberships")
        op.drop_index("ix_user_org_memberships_user_id", table_name="user_org_memberships")
        op.drop_index("ix_user_org_memberships_tenant_id", table_name="user_org_memberships")
        op.drop_table("user_org_memberships")
    if _has_table("org_units"):
        op.drop_index("ix_org_units_parent_id", table_name="org_units")
        op.drop_index("ix_org_units_tenant_id", table_name="org_units")
        op.drop_table("org_units")
