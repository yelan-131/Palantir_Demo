from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from sqlalchemy import text


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.db import db_session  # noqa: E402


TENANT_ID = 1
DEMO_PASSWORD_HASH = "sha256$8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"


ROLES = [
    ("line_supervisor", "产线主管", "负责产线班组节拍、异常升级与交接确认。"),
    ("shift_lead", "班组长", "负责班次协调、工单分配与现场问题闭环。"),
    ("production_operator", "生产操作员", "执行生产工单、录入产量与过程参数。"),
    ("quality_inspector", "质量检验员", "执行来料、过程与成品检验。"),
    ("supplier_quality_engineer", "供应商质量工程师", "负责供应商质量风险、8D 与来料异常跟踪。"),
    ("maintenance_planner", "维护计划员", "负责预防性维护计划与备件协调。"),
    ("procurement_specialist", "采购专员", "负责采购订单、供应风险与供应商协同。"),
    ("inventory_controller", "库存控制员", "负责库存准确性、呆滞风险与物料影响分析。"),
    ("oee_analyst", "OEE 分析员", "负责设备效率、停机损失与产能分析。"),
    ("safety_coordinator", "安全协调员", "负责安全事件、隐患整改与合规跟踪。"),
]


USERS = [
    ("prod_wu", "吴越 · 产线主管", "prod.wu@manufoundry.local"),
    ("prod_lin", "林珂 · 产线主管", "prod.lin@manufoundry.local"),
    ("prod_xu", "徐然 · 生产操作员", "prod.xu@manufoundry.local"),
    ("shift_qian", "钱宁 · 早班组长", "shift.qian@manufoundry.local"),
    ("shift_tang", "唐一 · 晚班组长", "shift.tang@manufoundry.local"),
    ("op_ma", "马骁 · 生产操作员", "op.ma@manufoundry.local"),
    ("qa_lin", "林安 · 质量检验员", "qa.lin@manufoundry.local"),
    ("qa_ma", "马悦 · 质量检验员", "qa.ma@manufoundry.local"),
    ("sqe_chen", "陈澄 · 供应商质量", "sqe.chen@manufoundry.local"),
    ("sqe_du", "杜衡 · 供应商质量", "sqe.du@manufoundry.local"),
    ("maint_han", "韩川 · 维护计划员", "maint.han@manufoundry.local"),
    ("maint_guo", "郭航 · 维护计划员", "maint.guo@manufoundry.local"),
    ("planner_yin", "尹路 · 维修排程", "planner.yin@manufoundry.local"),
    ("proc_su", "苏禾 · 采购专员", "proc.su@manufoundry.local"),
    ("proc_tan", "谭溪 · 采购专员", "proc.tan@manufoundry.local"),
    ("inv_gao", "高岚 · 库存控制", "inv.gao@manufoundry.local"),
    ("inv_pan", "潘远 · 库存控制", "inv.pan@manufoundry.local"),
    ("wh_qiao", "乔杉 · 仓储操作员", "wh.qiao@manufoundry.local"),
    ("data_qin", "秦予 · 数据专员", "data.qin@manufoundry.local"),
    ("analyst_shen", "沈知 · OEE 分析员", "analyst.shen@manufoundry.local"),
    ("safety_lu", "陆遥 · 安全协调员", "safety.lu@manufoundry.local"),
    ("safety_zheng", "郑宁 · 安全协调员", "safety.zheng@manufoundry.local"),
]


ROLE_MEMBERS = {
    "line_supervisor": ["prod_wu", "prod_lin", "shift_qian"],
    "shift_lead": ["shift_qian", "shift_tang", "op_ma"],
    "production_operator": ["prod_xu", "op_ma", "wh_qiao"],
    "quality_inspector": ["qa_lin", "qa_ma", "qc_zhao"],
    "supplier_quality_engineer": ["sqe_chen", "sqe_du", "qe_wang"],
    "maintenance_planner": ["maint_han", "maint_guo", "planner_yin"],
    "procurement_specialist": ["proc_su", "proc_tan", "scm_liu"],
    "inventory_controller": ["inv_gao", "inv_pan", "wh_feng"],
    "oee_analyst": ["analyst_shen", "prod_wu", "pm_li"],
    "safety_coordinator": ["safety_lu", "safety_zheng", "shift_tang"],
    "production_manager": ["pm_li", "prod_chen", "prod_wu"],
    "process_engineer": ["pe_huang", "analyst_shen", "prod_lin"],
    "quality_engineer": ["qe_wang", "qc_zhao", "qa_lin"],
    "maintenance_manager": ["mm_zhou", "maint_han", "me_sun"],
    "supply_chain_manager": ["scm_liu", "proc_su", "sqe_chen"],
    "warehouse_operator": ["wh_feng", "wh_qiao", "inv_gao"],
    "data_steward": ["ds_he", "data_qin", "analyst_shen"],
    "viewer": ["auditor_gu", "safety_lu", "prod_xu"],
}


ROLE_PERMISSIONS = {
    "line_supervisor": [("menu", "/dashboard", "view"), ("form", "work-order", "view"), ("report", "line-performance", "view")],
    "shift_lead": [("menu", "/dashboard", "view"), ("form", "shift-handover", "edit"), ("action", "line-escalation", "create")],
    "production_operator": [("form", "production-record", "edit"), ("form", "work-order", "view")],
    "quality_inspector": [("menu", "/quality", "view"), ("form", "inspection-lot", "edit"), ("form", "quality-event", "create")],
    "supplier_quality_engineer": [("form", "supplier-risk", "edit"), ("form", "quality-event", "view"), ("report", "supplier-quality", "view")],
    "maintenance_planner": [("menu", "/maintenance", "view"), ("form", "maintenance-order", "edit"), ("report", "maintenance-plan", "view")],
    "procurement_specialist": [("form", "purchase-order", "view"), ("form", "supplier-risk", "view"), ("report", "supply-risk", "view")],
    "inventory_controller": [("form", "material-impact", "edit"), ("report", "inventory-risk", "view")],
    "oee_analyst": [("menu", "/dashboard", "view"), ("report", "oee", "view"), ("report", "downtime", "view")],
    "safety_coordinator": [("form", "safety-incident", "edit"), ("report", "safety-compliance", "view")],
}


async def scalar(session, sql: str, params: dict):
    result = await session.execute(text(sql), params)
    return result.scalar_one_or_none()


async def upsert_role(session, name: str, label: str, description: str) -> int:
    role_id = await scalar(session, "SELECT id FROM roles WHERE tenant_id = :tenant_id AND name = :name", {"tenant_id": TENANT_ID, "name": name})
    if role_id is None:
        await session.execute(
            text(
                """
                INSERT INTO roles (tenant_id, name, label, description)
                VALUES (:tenant_id, :name, :label, :description)
                """
            ),
            {"tenant_id": TENANT_ID, "name": name, "label": label, "description": description},
        )
        role_id = await scalar(session, "SELECT id FROM roles WHERE tenant_id = :tenant_id AND name = :name", {"tenant_id": TENANT_ID, "name": name})
    else:
        await session.execute(
            text(
                """
                UPDATE roles
                SET label = :label, description = :description, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                """
            ),
            {"id": role_id, "label": label, "description": description},
        )
    return int(role_id)


async def upsert_user(session, username: str, display_name: str, email: str) -> int:
    user_id = await scalar(session, "SELECT id FROM users WHERE tenant_id = :tenant_id AND username = :username", {"tenant_id": TENANT_ID, "username": username})
    if user_id is None:
        await session.execute(
            text(
                """
                INSERT INTO users (tenant_id, username, email, display_name, hashed_password, is_active, is_admin)
                VALUES (:tenant_id, :username, :email, :display_name, :password_hash, true, false)
                """
            ),
            {
                "tenant_id": TENANT_ID,
                "username": username,
                "email": email,
                "display_name": display_name,
                "password_hash": DEMO_PASSWORD_HASH,
            },
        )
        user_id = await scalar(session, "SELECT id FROM users WHERE tenant_id = :tenant_id AND username = :username", {"tenant_id": TENANT_ID, "username": username})
    else:
        await session.execute(
            text(
                """
                UPDATE users
                SET email = :email, display_name = :display_name, is_active = true, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                """
            ),
            {"id": user_id, "email": email, "display_name": display_name},
        )
    return int(user_id)


async def ensure_user_role(session, user_id: int, role_id: int) -> None:
    existing = await scalar(
        session,
        """
        SELECT id FROM user_roles
        WHERE tenant_id = :tenant_id AND user_id = :user_id AND role_id = :role_id
        """,
        {"tenant_id": TENANT_ID, "user_id": user_id, "role_id": role_id},
    )
    if existing is None:
        await session.execute(
            text(
                """
                INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
                VALUES (:tenant_id, :user_id, :role_id, CURRENT_TIMESTAMP)
                """
            ),
            {"tenant_id": TENANT_ID, "user_id": user_id, "role_id": role_id},
        )


async def ensure_role_permission(session, role_id: int, resource_type: str, resource: str, action: str) -> None:
    existing = await scalar(
        session,
        """
        SELECT id FROM role_permissions
        WHERE tenant_id = :tenant_id
          AND role_id = :role_id
          AND resource_type = :resource_type
          AND resource_key = :resource
          AND action = :action
        """,
        {
            "tenant_id": TENANT_ID,
            "role_id": role_id,
            "resource_type": resource_type,
            "resource": resource,
            "action": action,
        },
    )
    if existing is None:
        await session.execute(
            text(
                """
                INSERT INTO role_permissions
                    (tenant_id, role_id, resource_type, resource_key, action, effect, data_scope, priority, enabled)
                VALUES
                    (:tenant_id, :role_id, :resource_type, :resource, :action, 'allow', 'all', 100, true)
                """
            ),
            {
                "tenant_id": TENANT_ID,
                "role_id": role_id,
                "resource_type": resource_type,
                "resource": resource,
                "action": action,
            },
        )


async def main() -> None:
    async with db_session() as session:
        role_ids = {}
        user_ids = {}

        for name, label, description in ROLES:
            role_ids[name] = await upsert_role(session, name, label, description)

        for username, display_name, email in USERS:
            user_ids[username] = await upsert_user(session, username, display_name, email)

        role_names = set(ROLE_MEMBERS) - set(role_ids)
        for role_name in sorted(role_names):
            role_id = await scalar(session, "SELECT id FROM roles WHERE tenant_id = :tenant_id AND name = :name", {"tenant_id": TENANT_ID, "name": role_name})
            if role_id is not None:
                role_ids[role_name] = int(role_id)

        user_names = {username for members in ROLE_MEMBERS.values() for username in members} - set(user_ids)
        for username in sorted(user_names):
            user_id = await scalar(session, "SELECT id FROM users WHERE tenant_id = :tenant_id AND username = :username", {"tenant_id": TENANT_ID, "username": username})
            if user_id is not None:
                user_ids[username] = int(user_id)

        for role_name, members in ROLE_MEMBERS.items():
            role_id = role_ids.get(role_name)
            if role_id is None:
                continue
            for username in members:
                user_id = user_ids.get(username)
                if user_id is not None:
                    await ensure_user_role(session, user_id, role_id)

        for role_name, permissions in ROLE_PERMISSIONS.items():
            role_id = role_ids.get(role_name)
            if role_id is None:
                continue
            for resource_type, resource, action in permissions:
                await ensure_role_permission(session, role_id, resource_type, resource, action)

        await session.commit()

        user_count = await scalar(session, "SELECT COUNT(*) FROM users WHERE tenant_id = :tenant_id", {"tenant_id": TENANT_ID})
        role_count = await scalar(session, "SELECT COUNT(*) FROM roles WHERE tenant_id = :tenant_id", {"tenant_id": TENANT_ID})
        binding_count = await scalar(session, "SELECT COUNT(*) FROM user_roles WHERE tenant_id = :tenant_id", {"tenant_id": TENANT_ID})
        print(f"seeded tenant={TENANT_ID} users={user_count} roles={role_count} user_roles={binding_count}")

        for name in sorted(ROLE_MEMBERS):
            member_count = await scalar(
                session,
                """
                SELECT COUNT(ur.user_id)
                FROM roles r
                LEFT JOIN user_roles ur ON ur.role_id = r.id AND ur.tenant_id = r.tenant_id
                WHERE r.tenant_id = :tenant_id AND r.name = :name
                """,
                {"tenant_id": TENANT_ID, "name": name},
            )
            print(f"{name}: {member_count} users")


if __name__ == "__main__":
    asyncio.run(main())
