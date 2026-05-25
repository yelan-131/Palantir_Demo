from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal


DB_PATH = Path(__file__).resolve().parents[1] / "backend" / "manufoundry.db"
SEED_MARKER = "audit-demo-seed-20260525"


def payload(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def build_rows() -> list[tuple]:
    now = datetime.now().replace(microsecond=0)
    raw_rows = [
        ("login_success", "auth", None, None, {"username": "admin", "source": "database", "marker": SEED_MARKER}, 1, 1, 3),
        ("login_failed", "auth", None, None, {"username": "unknown_user", "reason": "invalid_credentials", "marker": SEED_MARKER}, None, 1, 7),
        ("logout", "auth", None, None, {"username": "admin", "marker": SEED_MARKER}, 1, 1, 12),
        ("update", "application", 2, {"status": "draft"}, {"name": "质量分析", "status": "published", "marker": SEED_MARKER}, 1, 1, 24),
        ("update", "platform_menu_node", 104, {"visible": False}, {"title": "设备健康", "visible": True, "marker": SEED_MARKER}, 1, 1, 32),
        ("create", "platform_menu_node", 118, None, {"title": "质量复核", "route_path": "/program/quality-review", "marker": SEED_MARKER}, 9, 1, 48),
        ("delete", "platform_menu_node", 93, {"title": "旧版报表入口"}, {"reason": "合并到质量看板", "marker": SEED_MARKER}, 1, 1, 62),
        ("update", "platform_form", 31, {"field": "supplier", "required": False}, {"field": "supplier", "required": True, "marker": SEED_MARKER}, 9, 1, 75),
        ("create", "application_binding", 2, None, {"application": "质量分析", "form": "质量事件表单", "marker": SEED_MARKER}, 1, 1, 94),
        ("update", "role_permission", 4, {"actions": ["view"]}, {"role": "quality_engineer", "actions": ["view", "edit", "approve"], "marker": SEED_MARKER}, 1, 1, 110),
        ("update", "ontology_object", 7, {"status": "draft"}, {"name": "QualityEvent", "status": "active", "marker": SEED_MARKER}, 9, 1, 126),
        ("create", "ontology_relation", 12, None, {"source": "QualityEvent", "target": "MaterialBatch", "relation": "impacts", "marker": SEED_MARKER}, 9, 1, 144),
        ("sync", "graph", 1, None, {"job": "quality-demo-graph", "nodes": 128, "edges": 326, "marker": SEED_MARKER}, 9, 1, 168),
        ("query", "ai_assistant", None, None, {"conversation": "质量异常影响分析", "tool": "impact-analysis", "marker": SEED_MARKER}, 3, 1, 190),
        ("draft_saved", "ai_assistant", 501, None, {"draft_type": "CAPA", "risk": "medium", "marker": SEED_MARKER}, 3, 1, 208),
        ("confirm", "ai_assistant", 501, {"state": "draft"}, {"state": "confirmed", "requires_audit": True, "marker": SEED_MARKER}, 3, 1, 230),
        ("start", "workflow_instance", 801, None, {"definition": "CAPA 审批", "business_key": "QE-2026-0519", "marker": SEED_MARKER}, 3, 1, 251),
        ("approve", "workflow_instance", 801, {"state": "pending"}, {"state": "approved", "comment": "同意纠正措施", "marker": SEED_MARKER}, 9, 1, 270),
        ("reject", "workflow_instance", 802, {"state": "pending"}, {"state": "rejected", "comment": "缺少复检记录", "marker": SEED_MARKER}, 10, 1, 294),
        ("create", "report", 44, None, {"name": "供应商批次风险周报", "marker": SEED_MARKER}, 7, 1, 320),
        ("export", "report", 44, None, {"format": "xlsx", "rows": 238, "marker": SEED_MARKER}, 7, 1, 355),
        ("update", "ai_settings", 1, {"recordToolCalls": False}, {"recordToolCalls": True, "auditEnabled": True, "marker": SEED_MARKER}, 1, 1, 390),
        ("disable", "user", 10, {"is_active": True}, {"username": "wh_feng", "is_active": False, "marker": SEED_MARKER}, 1, 1, 430),
        ("update", "user", 10, {"primary_org_unit": "warehouse"}, {"primary_org_unit": "quality", "marker": SEED_MARKER}, 1, 1, 455),
        ("create", "org_unit", 22, None, {"name": "质量复核小组", "parent": "质量部", "marker": SEED_MARKER}, 1, 1, 480),
        ("update", "data_asset", 15, {"owner": "production"}, {"owner": "quality", "quality_score": 96, "marker": SEED_MARKER}, 9, 1, 520),
        ("create", "knowledge_asset", 63, None, {"title": "质量异常 SOP 2026", "permission_scope": "enterprise", "marker": SEED_MARKER}, 9, 1, 560),
        ("upload", "knowledge_asset", 64, None, {"filename": "设备点检手册.pdf", "size_mb": 4.8, "marker": SEED_MARKER}, 4, 1, 600),
        ("query", "knowledge", 64, None, {"question": "主轴温升异常如何处理", "top_k": 5, "marker": SEED_MARKER}, 4, 1, 640),
        ("create", "maintenance_order", 303, None, {"equipment": "CNC-001", "priority": "P1", "marker": SEED_MARKER}, 4, 1, 690),
        ("update", "maintenance_order", 303, {"state": "created"}, {"state": "accepted", "owner": "me_sun", "marker": SEED_MARKER}, 5, 1, 730),
        ("approve", "maintenance_order", 303, {"state": "accepted"}, {"state": "closed", "marker": SEED_MARKER}, 4, 1, 780),
        ("freeze", "material_batch", 7021, {"state": "available"}, {"state": "frozen", "reason": "质量异常影响", "marker": SEED_MARKER}, 3, 1, 840),
        ("update", "supplier", 18, {"risk_level": "medium"}, {"risk_level": "high", "reason": "连续两批缺陷", "marker": SEED_MARKER}, 7, 1, 900),
        ("create", "notification", 9001, None, {"target": "quality_engineer", "template": "质量异常升级", "marker": SEED_MARKER}, 3, 1, 960),
        ("archive", "audit", None, None, {"range": "2026-Q1", "retention_days": 365, "marker": SEED_MARKER}, 10, 1, 1020),
    ]
    return [
        (
            action,
            resource_type,
            resource_id,
            payload(old_values) if old_values else None,
            payload(new_values),
            user_id,
            tenant_id,
            now - timedelta(minutes=minutes_ago),
        )
        for action, resource_type, resource_id, old_values, new_values, user_id, tenant_id, minutes_ago in raw_rows
    ]


def seed_sqlite(rows: list[tuple]) -> Literal["inserted", "exists"]:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"SQLite database not found: {DB_PATH}")

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = OFF")
        existing = conn.execute(
            "SELECT COUNT(*) FROM audit_logs WHERE new_values LIKE ?",
            (f"%{SEED_MARKER}%",),
        ).fetchone()[0]
        if existing:
            print(f"SQLite audit seed already present: {existing} rows")
            return "exists"

        conn.executemany(
            """
            INSERT INTO audit_logs
              (action, resource_type, resource_id, old_values, new_values, user_id, tenant_id, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [(a, rt, rid, old, new, uid, tid, ts.isoformat(sep=" ")) for a, rt, rid, old, new, uid, tid, ts in rows],
        )
        conn.commit()

    print(f"Inserted {len(rows)} audit log rows into {DB_PATH}")
    return "inserted"


def seed_postgres(rows: list[tuple]) -> Literal["inserted", "exists"]:
    import psycopg2

    conn = psycopg2.connect(
        host="localhost",
        port=5432,
        user="manufoundry",
        password="manufoundry123",
        dbname="manufoundry",
        connect_timeout=2,
    )
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM audit_logs WHERE new_values LIKE %s", (f"%{SEED_MARKER}%",))
                existing = cur.fetchone()[0]
                if existing:
                    print(f"PostgreSQL audit seed already present: {existing} rows")
                    return "exists"

                cur.executemany(
                    """
                    INSERT INTO audit_logs
                      (action, resource_type, resource_id, old_values, new_values, user_id, tenant_id, timestamp)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    rows,
                )
        print("Inserted %d audit log rows into PostgreSQL manufoundry.audit_logs" % len(rows))
        return "inserted"
    finally:
        conn.close()


def main() -> None:
    rows = build_rows()
    try:
        seed_postgres(rows)
    except Exception as exc:
        print(f"PostgreSQL seed skipped: {exc}")
        seed_sqlite(rows)


if __name__ == "__main__":
    main()
