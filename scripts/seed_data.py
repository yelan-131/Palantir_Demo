"""Seed data import script — load JSON data into PostgreSQL and build Neo4j graph."""

import asyncio
import json
import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.core.seed_config import (
    SEED_TABLE_COLUMNS,
    convert_datetimes,
    make_insert_sql,
)
from app.services.graph_service import graph_service

SEED_DIR = Path(__file__).resolve().parent.parent / "data" / "seed"
ADMIN_PASSWORD_HASH = "sha256$240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"
DEMO_PASSWORD_HASH = "sha256$8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
DEFAULT_TENANT_ID = 1

DEMO_ROLE_DEFINITIONS = [
    ("admin", "超级管理员", "系统超级管理员，拥有全部权限", [("all", "*", "*")]),
    ("production_manager", "生产经理", "生产态势、设备维护、质量概览和工单相关操作。", [
        ("menu", "/", "view"), ("menu", "/dashboard", "view"),
        ("menu", "/maintenance", "view"), ("menu", "/quality", "view"),
        ("action", "work_order", "create"),
    ]),
    ("quality_engineer", "质量工程师", "质量事件、检验批次、缺陷分析和 CAPA 跟踪。", [
        ("menu", "/quality", "view"), ("form", "quality-event", "view"),
        ("form", "quality-event", "create"), ("form", "quality-event", "edit"),
        ("form", "quality-event", "export"),
    ]),
    ("maintenance_manager", "设备维护经理", "设备健康、预测性维护、维修工单和维护报表。", [
        ("menu", "/maintenance", "view"), ("form", "maintenance-order", "view"),
        ("form", "maintenance-order", "edit"), ("form", "maintenance-order", "approve"),
    ]),
    ("maintenance_engineer", "维修工程师", "维修工单执行、设备点检和告警确认。", [
        ("menu", "/maintenance", "view"), ("form", "maintenance-order", "view"),
        ("form", "maintenance-order", "edit"),
    ]),
    ("process_engineer", "工艺工程师", "过程能力、工艺参数和异常分析。", [
        ("menu", "/dashboard", "view"), ("report", "process-capability-dashboard", "view"),
    ]),
    ("supply_chain_manager", "供应链经理", "供应链风险、库存、供应商和风险复核。", [
        ("menu", "/supply-chain", "view"), ("form", "risk-review", "view"),
        ("form", "risk-review", "approve"),
    ]),
    ("warehouse_operator", "仓储操作员", "物料出入库、库存核对和影响范围确认。", [
        ("form", "material-impact", "view"), ("form", "material-impact", "edit"),
    ]),
    ("data_steward", "数据专员", "主数据维护、数据质量检查和数据变更审批。", [
        ("data", "master-data", "view"), ("data", "master-data", "edit"),
    ]),
    ("approval_lead", "审批负责人", "跨模块审批、风险放行和业务流程终审。", [
        ("workflow", "*", "approve"),
    ]),
    ("viewer", "只读观察员", "只读查看工作台、看板和基础报表。", [
        ("menu", "*", "view"), ("report", "*", "view"),
    ]),
]

DEMO_USER_DEFINITIONS = [
    ("admin", "系统超级管理员", "admin@manufoundry.local", ADMIN_PASSWORD_HASH, True, ["admin"]),
    ("pm_li", "李明 · 生产经理", "pm.li@manufoundry.local", DEMO_PASSWORD_HASH, False, ["production_manager", "approval_lead"]),
    ("qe_wang", "王敏 · 质量工程师", "qe.wang@manufoundry.local", DEMO_PASSWORD_HASH, False, ["quality_engineer"]),
    ("mm_zhou", "周强 · 设备维护经理", "mm.zhou@manufoundry.local", DEMO_PASSWORD_HASH, False, ["maintenance_manager"]),
    ("me_sun", "孙浩 · 维修工程师", "me.sun@manufoundry.local", DEMO_PASSWORD_HASH, False, ["maintenance_engineer"]),
    ("pe_huang", "黄婷 · 工艺工程师", "pe.huang@manufoundry.local", DEMO_PASSWORD_HASH, False, ["process_engineer"]),
    ("scm_liu", "刘洋 · 供应链经理", "scm.liu@manufoundry.local", DEMO_PASSWORD_HASH, False, ["supply_chain_manager"]),
    ("wh_feng", "冯宇 · 仓储操作员", "wh.feng@manufoundry.local", DEMO_PASSWORD_HASH, False, ["warehouse_operator"]),
    ("ds_he", "何静 · 数据专员", "ds.he@manufoundry.local", DEMO_PASSWORD_HASH, False, ["data_steward"]),
    ("auditor_gu", "顾安 · 审计观察员", "auditor.gu@manufoundry.local", DEMO_PASSWORD_HASH, False, ["viewer"]),
]

DEMO_ORG_UNITS = [
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

DEMO_USER_ORG_MEMBERSHIPS = [
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

# Tables processed in order (sensor_readings handled separately due to size)
_SEED_TABLE_ORDER = [
    t for t in SEED_TABLE_COLUMNS if t != "sensor_readings"
]


async def create_tables(engine):
    """Create all tables from SQLAlchemy models."""
    from app.models.relational import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Tables created.")


async def seed_postgresql(engine):
    """Load JSON seed data into PostgreSQL."""
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    for table_name in _SEED_TABLE_ORDER:
        file_path = SEED_DIR / f"{table_name}.json"
        if not file_path.exists():
            print(f"  SKIP {table_name}: file not found")
            continue

        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)

        data = convert_datetimes(table_name, data)
        sql = make_insert_sql(table_name)

        async with async_session() as session:
            try:
                await session.execute(text(sql), data)
                await session.commit()
                print(f"  INSERT {table_name}: {len(data)} rows")
            except Exception as e:
                print(f"  ERROR {table_name}: {e}")
                await session.rollback()

    # Handle sensor_readings separately (large file, batch insert)
    readings_path = SEED_DIR / "sensor_readings.json"
    if readings_path.exists():
        with open(readings_path, encoding="utf-8") as f:
            readings = json.load(f)

        batch_size = 1000
        readings_sql = make_insert_sql("sensor_readings")
        async with async_session() as session:
            for i in range(0, len(readings), batch_size):
                batch = convert_datetimes("sensor_readings", readings[i:i + batch_size])
                try:
                    await session.execute(text(readings_sql), batch)
                    await session.commit()
                except Exception as e:
                    print(f"  ERROR sensor_readings batch {i}: {e}")
                    await session.rollback()
        print(f"  INSERT sensor_readings: {len(readings)} rows")


async def seed_super_admin(engine):
    """Ensure the default super admin exists for fresh demo environments."""
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as session:
        try:
            role_id = (await session.execute(text(
                "SELECT id FROM roles WHERE name = 'admin' LIMIT 1"
            ))).scalar()
            if role_id is None:
                role_id = (await session.execute(text(
                    "INSERT INTO roles (tenant_id, name, label, description) "
                    "VALUES (1, 'admin', '超级管理员', '系统超级管理员，拥有全部权限') RETURNING id"
                ))).scalar()
            else:
                await session.execute(text(
                    "UPDATE roles SET label = '超级管理员', description = '系统超级管理员，拥有全部权限' "
                    "WHERE id = :role_id"
                ), {"role_id": role_id})

            user_id = (await session.execute(text(
                "SELECT id FROM users WHERE username = 'admin' LIMIT 1"
            ))).scalar()
            if user_id is None:
                user_id = (await session.execute(text(
                    "INSERT INTO users (tenant_id, username, display_name, email, hashed_password, is_active, is_admin) "
                    "VALUES (1, 'admin', '系统超级管理员', 'admin@manufoundry.local', :password_hash, TRUE, TRUE) "
                    "RETURNING id"
                ), {"password_hash": ADMIN_PASSWORD_HASH})).scalar()
            else:
                await session.execute(text(
                    "UPDATE users SET is_active = TRUE, is_admin = TRUE WHERE id = :user_id"
                ), {"user_id": user_id})

            user_role_id = (await session.execute(text(
                "SELECT id FROM user_roles WHERE user_id = :user_id AND role_id = :role_id LIMIT 1"
            ), {"user_id": user_id, "role_id": role_id})).scalar()
            if user_role_id is None:
                await session.execute(text(
                    "INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES (1, :user_id, :role_id)"
                ), {"user_id": user_id, "role_id": role_id})

            permission_id = (await session.execute(text(
                "SELECT id FROM role_permissions "
                "WHERE role_id = :role_id AND resource_type = 'all' AND resource_key = '*' AND action = '*' "
                "LIMIT 1"
            ), {"role_id": role_id})).scalar()
            if permission_id is None:
                await session.execute(text(
                    "INSERT INTO role_permissions (tenant_id, role_id, resource_type, resource_key, action) "
                    "VALUES (1, :role_id, 'all', '*', '*')"
                ), {"role_id": role_id})

            await session.commit()
            print("  UPSERT super admin: admin / admin123")
        except Exception as e:
            print(f"  ERROR super admin: {e}")
            await session.rollback()


async def seed_demo_users(engine):
    """Ensure manufacturing demo roles and users exist."""
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as session:
        try:
            await session.execute(text(
                "INSERT INTO tenants (id, name, slug, status) "
                "SELECT :tenant_id, 'Default Tenant', 'default', 'active' "
                "WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = :tenant_id)"
            ), {"tenant_id": DEFAULT_TENANT_ID})

            role_ids: dict[str, int] = {}
            for name, label, description, permissions in DEMO_ROLE_DEFINITIONS:
                role_id = (await session.execute(text(
                    "SELECT id FROM roles WHERE tenant_id = :tenant_id AND name = :name LIMIT 1"
                ), {"tenant_id": DEFAULT_TENANT_ID, "name": name})).scalar()
                if role_id is None:
                    role_id = (await session.execute(text(
                        "INSERT INTO roles (tenant_id, name, label, description) "
                        "VALUES (:tenant_id, :name, :label, :description) RETURNING id"
                    ), {
                        "tenant_id": DEFAULT_TENANT_ID,
                        "name": name,
                        "label": label,
                        "description": description,
                    })).scalar()
                else:
                    await session.execute(text(
                        "UPDATE roles SET label = :label, description = :description WHERE id = :role_id"
                    ), {"role_id": role_id, "label": label, "description": description})
                role_ids[name] = int(role_id)

                for resource_type, resource_key, action in permissions:
                    permission_id = (await session.execute(text(
                        "SELECT id FROM role_permissions "
                        "WHERE role_id = :role_id AND resource_type = :resource_type "
                        "AND resource_key = :resource_key AND action = :action LIMIT 1"
                    ), {
                        "role_id": role_id,
                        "resource_type": resource_type,
                        "resource_key": resource_key,
                        "action": action,
                    })).scalar()
                    if permission_id is None:
                        await session.execute(text(
                            "INSERT INTO role_permissions (tenant_id, role_id, resource_type, resource_key, action) "
                            "VALUES (:tenant_id, :role_id, :resource_type, :resource_key, :action)"
                        ), {
                            "tenant_id": DEFAULT_TENANT_ID,
                            "role_id": role_id,
                            "resource_type": resource_type,
                            "resource_key": resource_key,
                            "action": action,
                        })

            for username, display_name, email, password_hash, is_admin, role_names in DEMO_USER_DEFINITIONS:
                user_id = (await session.execute(text(
                    "SELECT id FROM users WHERE username = :username LIMIT 1"
                ), {"username": username})).scalar()
                if user_id is None:
                    user_id = (await session.execute(text(
                        "INSERT INTO users (tenant_id, username, display_name, email, hashed_password, is_active, is_admin) "
                        "VALUES (:tenant_id, :username, :display_name, :email, :password_hash, TRUE, :is_admin) "
                        "RETURNING id"
                    ), {
                        "tenant_id": DEFAULT_TENANT_ID,
                        "username": username,
                        "display_name": display_name,
                        "email": email,
                        "password_hash": password_hash,
                        "is_admin": is_admin,
                    })).scalar()
                else:
                    await session.execute(text(
                        "UPDATE users SET display_name = :display_name, email = :email, "
                        "hashed_password = :password_hash, is_active = TRUE WHERE id = :user_id"
                    ), {
                        "user_id": user_id,
                        "display_name": display_name,
                        "email": email,
                        "password_hash": password_hash,
                    })
                    if username == "admin":
                        await session.execute(text(
                            "UPDATE users SET is_admin = TRUE WHERE id = :user_id"
                        ), {"user_id": user_id})

                for role_name in role_names:
                    role_id = role_ids.get(role_name)
                    if role_id is None:
                        continue
                    user_role_id = (await session.execute(text(
                        "SELECT id FROM user_roles WHERE user_id = :user_id AND role_id = :role_id LIMIT 1"
                    ), {"user_id": user_id, "role_id": role_id})).scalar()
                    if user_role_id is None:
                        await session.execute(text(
                            "INSERT INTO user_roles (tenant_id, user_id, role_id) "
                            "VALUES (:tenant_id, :user_id, :role_id)"
                        ), {
                            "tenant_id": DEFAULT_TENANT_ID,
                            "user_id": user_id,
                            "role_id": role_id,
                        })

            await session.commit()
            print(f"  UPSERT demo users: {len(DEMO_USER_DEFINITIONS)} users")
        except Exception as e:
            print(f"  ERROR demo users: {e}")
            await session.rollback()


async def seed_demo_org_units(engine):
    """Ensure demo organization units and user memberships exist."""
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as session:
        try:
            await session.execute(text(
                "INSERT INTO tenants (id, name, slug, status) "
                "SELECT :tenant_id, 'Default Tenant', 'default', 'active' "
                "WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = :tenant_id)"
            ), {"tenant_id": DEFAULT_TENANT_ID})

            org_ids: dict[str, int] = {}
            for code, parent_code, name, org_type, sort_order, description in DEMO_ORG_UNITS:
                parent_id = org_ids.get(parent_code) if parent_code else None
                org_id = (await session.execute(text(
                    "SELECT id FROM org_units WHERE tenant_id = :tenant_id AND code = :code LIMIT 1"
                ), {"tenant_id": DEFAULT_TENANT_ID, "code": code})).scalar()
                if org_id is None:
                    org_id = (await session.execute(text(
                        "INSERT INTO org_units (tenant_id, parent_id, code, name, org_type, sort_order, status, description) "
                        "VALUES (:tenant_id, :parent_id, :code, :name, :org_type, :sort_order, 'active', :description) "
                        "RETURNING id"
                    ), {
                        "tenant_id": DEFAULT_TENANT_ID,
                        "parent_id": parent_id,
                        "code": code,
                        "name": name,
                        "org_type": org_type,
                        "sort_order": sort_order,
                        "description": description,
                    })).scalar()
                else:
                    await session.execute(text(
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

            for username, org_code, position_title, is_primary in DEMO_USER_ORG_MEMBERSHIPS:
                user_id = (await session.execute(text(
                    "SELECT id FROM users WHERE username = :username LIMIT 1"
                ), {"username": username})).scalar()
                org_id = org_ids.get(org_code)
                if user_id is None or org_id is None:
                    continue
                if is_primary:
                    await session.execute(text(
                        "UPDATE user_org_memberships SET is_primary = FALSE "
                        "WHERE tenant_id = :tenant_id AND user_id = :user_id"
                    ), {"tenant_id": DEFAULT_TENANT_ID, "user_id": user_id})
                membership_id = (await session.execute(text(
                    "SELECT id FROM user_org_memberships "
                    "WHERE tenant_id = :tenant_id AND user_id = :user_id AND org_unit_id = :org_unit_id LIMIT 1"
                ), {"tenant_id": DEFAULT_TENANT_ID, "user_id": user_id, "org_unit_id": org_id})).scalar()
                if membership_id is None:
                    await session.execute(text(
                        "INSERT INTO user_org_memberships (tenant_id, user_id, org_unit_id, position_title, is_primary) "
                        "VALUES (:tenant_id, :user_id, :org_unit_id, :position_title, :is_primary)"
                    ), {
                        "tenant_id": DEFAULT_TENANT_ID,
                        "user_id": user_id,
                        "org_unit_id": org_id,
                        "position_title": position_title,
                        "is_primary": is_primary,
                    })
                else:
                    await session.execute(text(
                        "UPDATE user_org_memberships SET position_title = :position_title, is_primary = :is_primary "
                        "WHERE id = :membership_id"
                    ), {
                        "membership_id": membership_id,
                        "position_title": position_title,
                        "is_primary": is_primary,
                    })

            await session.commit()
            print(f"  UPSERT demo org units: {len(DEMO_ORG_UNITS)} units")
        except Exception as e:
            print(f"  ERROR demo org units: {e}")
            await session.rollback()


async def seed_neo4j():
    """Build knowledge graph in Neo4j from seed data."""
    seed_data = {}
    for json_file in SEED_DIR.glob("*.json"):
        key = json_file.stem
        if key not in ("sensor_readings", "spc_points"):
            with open(json_file, encoding="utf-8") as f:
                seed_data[key] = json.load(f)

    await graph_service.build_from_seed(seed_data)
    print("Neo4j graph built.")


async def main():
    print("=== ManuFoundry 数据初始化 ===\n")

    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    print("[1/3] Creating tables...")
    await create_tables(engine)

    print("\n[2/3] Seeding PostgreSQL...")
    await seed_postgresql(engine)
    await seed_super_admin(engine)
    await seed_demo_users(engine)
    await seed_demo_org_units(engine)

    print("\n[3/3] Building Neo4j graph...")
    try:
        await seed_neo4j()
    except Exception as e:
        print(f"  Neo4j connection failed (skip): {e}")

    await engine.dispose()
    print("\n=== Done! ===")


if __name__ == "__main__":
    asyncio.run(main())
