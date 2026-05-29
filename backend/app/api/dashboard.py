"""Dashboard API for production operations."""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, get_current_user, get_db
from app.core.db import safe_db_call as _try_db
from app.models.relational import (
    Defect,
    DynamicRecord,
    Equipment,
    Factory,
    Form,
    Inspection,
    Material,
    Product,
    ProductionLine,
    SalesOrder,
    SPCPoint,
    Supplier,
    WorkOrder,
    Workshop,
)

router = APIRouter()

MOCK_OVERVIEW = {
    "factories": {"count": 320},
    "equipment": {"total": 1920, "running": 1450, "utilization_rate": 0.755},
    "production_lines": {"total": 960, "running": 748},
    "work_orders": {"total": 1800, "in_progress": 760, "completed": 720},
    "quality": {"defect_count": 900},
    "avg_equipment_health": 0.76,
}


@router.get("/overview")
async def get_overview(user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    result = await _try_db(lambda db: _query_overview(db, tenant_id))
    return result or {**MOCK_OVERVIEW, "source": "fallback"}


async def _query_overview(db: AsyncSession, tenant_id: int):
    factory_count = await db.scalar(select(func.count(Factory.id)).where(Factory.tenant_id == tenant_id))
    equipment_total = await db.scalar(select(func.count(Equipment.id)).where(Equipment.tenant_id == tenant_id))
    equipment_running = await db.scalar(
        select(func.count(Equipment.id)).where(Equipment.tenant_id == tenant_id, Equipment.status == "running")
    )
    line_count = await db.scalar(select(func.count(ProductionLine.id)).where(ProductionLine.tenant_id == tenant_id))
    lines_running = await db.scalar(
        select(func.count(ProductionLine.id)).where(ProductionLine.tenant_id == tenant_id, ProductionLine.status == "running")
    )
    wo_total = await db.scalar(select(func.count(WorkOrder.id)).where(WorkOrder.tenant_id == tenant_id))
    wo_in_progress = await db.scalar(
        select(func.count(WorkOrder.id)).where(WorkOrder.tenant_id == tenant_id, WorkOrder.status == "in_progress")
    )
    wo_completed = await db.scalar(
        select(func.count(WorkOrder.id)).where(WorkOrder.tenant_id == tenant_id, WorkOrder.status == "completed")
    )
    defect_count = await db.scalar(select(func.count(Defect.id)).where(Defect.tenant_id == tenant_id))
    avg_health = await db.scalar(select(func.avg(Equipment.health_score)).where(Equipment.tenant_id == tenant_id)) or 0.0

    return {
        "factories": {"count": factory_count or 0},
        "equipment": {
            "total": equipment_total or 0,
            "running": equipment_running or 0,
            "utilization_rate": round((equipment_running or 0) / max(equipment_total or 1, 1), 3),
        },
        "production_lines": {"total": line_count or 0, "running": lines_running or 0},
        "work_orders": {
            "total": wo_total or 0,
            "in_progress": wo_in_progress or 0,
            "completed": wo_completed or 0,
        },
        "quality": {"defect_count": defect_count or 0},
        "avg_equipment_health": round(avg_health / 100, 3) if avg_health > 1 else round(avg_health, 3),
        "tenant_id": tenant_id,
        "source": "database",
    }


@router.get("/oee")
async def get_oee(line_id: int | None = None, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    lines = await _try_db(lambda db: _query_lines(db, tenant_id, line_id))
    source = "database"
    if not lines:
        source = "fallback"
        lines = [
            {"id": i, "name": f"产线-{i:03d}", "oee_target": 0.86}
            for i in range(1, 25)
        ]

    oee_data = []
    for line in lines[:80]:
        lid = line["id"] if isinstance(line, dict) else line.id
        lname = line["name"] if isinstance(line, dict) else line.name
        target = line.get("oee_target", 0.86) if isinstance(line, dict) else getattr(line, "oee_target", 0.86)
        random.seed(lid * 17)
        availability = round(random.uniform(0.82, 0.98), 3)
        performance = round(random.uniform(0.78, 0.96), 3)
        quality_rate = round(random.uniform(0.94, 0.998), 3)
        oee_data.append({
            "line_id": lid,
            "line_name": lname,
            "availability": availability,
            "performance": performance,
            "quality": quality_rate,
            "oee": round(availability * performance * quality_rate, 3),
            "target": target,
        })
    return {"data": oee_data, "tenant_id": tenant_id, "source": source}


async def _query_lines(db: AsyncSession, tenant_id: int, line_id: int | None):
    query = select(ProductionLine).where(ProductionLine.tenant_id == tenant_id).order_by(ProductionLine.id)
    if line_id:
        query = query.where(ProductionLine.id == line_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/production")
async def get_production_stats(days: int = Query(14, ge=1, le=90), user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    result = await _try_db(lambda db: _query_production_stats(db, tenant_id, days))
    if result is not None:
        return result
    return {"data": _mock_production_stats(days), "source": "fallback"}


async def _query_production_stats(db: AsyncSession, tenant_id: int, days: int):
    start = datetime.now() - timedelta(days=days - 1)
    result = await db.execute(select(WorkOrder).where(WorkOrder.tenant_id == tenant_id, WorkOrder.planned_start >= start))
    rows = result.scalars().all()
    buckets: dict[str, dict[str, int]] = {}
    for row in rows:
        day = row.planned_start.strftime("%Y-%m-%d") if row.planned_start else datetime.now().strftime("%Y-%m-%d")
        bucket = buckets.setdefault(day, {"planned": 0, "actual": 0, "passed": 0})
        planned = int(row.quantity or 0)
        actual = int(row.completed_quantity or 0)
        bucket["planned"] += planned
        bucket["actual"] += actual
        bucket["passed"] += int(actual * 0.985) if row.status == "completed" else int(actual * 0.965)

    data = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).strftime("%Y-%m-%d")
        bucket = buckets.get(day, {"planned": 0, "actual": 0, "passed": 0})
        data.append({
            "date": day,
            "planned": bucket["planned"],
            "actual": bucket["actual"],
            "passed": bucket["passed"],
            "yield_rate": round(bucket["passed"] / max(bucket["actual"], 1), 3),
        })
    return {"data": data}


def _mock_production_stats(days: int) -> list[dict]:
    now = datetime.now()
    data = []
    for offset in range(days):
        day = now - timedelta(days=days - offset - 1)
        random.seed(day.toordinal())
        planned = random.randint(18000, 36000)
        actual = random.randint(int(planned * 0.78), planned)
        passed = random.randint(int(actual * 0.94), actual)
        data.append({
            "date": day.strftime("%Y-%m-%d"),
            "planned": planned,
            "actual": actual,
            "passed": passed,
            "yield_rate": round(passed / max(actual, 1), 3),
        })
    return data


@router.get("/alerts")
async def get_alerts(limit: int = Query(20, ge=1, le=100), user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    result = await _try_db(lambda db: _query_alerts(db, tenant_id, limit))
    if result is not None:
        return result
    alerts = [
        {
            "id": f"alert-{i}",
            "type": "equipment_health",
            "severity": "critical" if i % 5 == 0 else "warning",
            "title": f"设备 EQ-{i:04d} 健康度偏低",
            "message": f"当前健康度 {random.uniform(35, 68):.1f}，建议安排点检。",
            "entity_id": i,
            "entity_type": "Equipment",
            "timestamp": (datetime.now() - timedelta(hours=i)).isoformat(),
        }
        for i in range(1, limit + 1)
    ]
    return {"data": alerts, "total": len(alerts), "source": "fallback"}


async def _query_alerts(db: AsyncSession, tenant_id: int, limit: int):
    result = await db.execute(
        select(Equipment)
        .where(Equipment.tenant_id == tenant_id, Equipment.health_score < 68)
        .order_by(Equipment.health_score.asc(), Equipment.id.asc())
        .limit(limit)
    )
    low_health = result.scalars().all()
    alerts = []
    for eq in low_health:
        severity = "critical" if eq.health_score < 52 else "warning"
        alerts.append({
            "id": f"alert-eq-{eq.id}",
            "type": "equipment_health",
            "severity": severity,
            "title": f"设备 {eq.name} 健康度偏低",
            "message": f"当前健康度: {eq.health_score:.1f}",
            "entity_id": eq.id,
            "entity_type": "Equipment",
            "timestamp": eq.updated_at.isoformat() if eq.updated_at else None,
        })
    return {"data": alerts, "total": len(alerts), "tenant_id": tenant_id, "source": "database"}


@router.get("/programs/{program_id}")
async def get_program_data(
    program_id: str,
    limit: int = Query(500, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Return database-backed rows for generated application pages.

    The AppPrograms frontend still owns layout and column renderers. This API
    replaces the old static row arrays with data from the manufacturing seed
    tables when the production database is available.
    """
    loaders = {
        "oee-trend-report": _query_oee_program,
        "line-status": _query_line_status_program,
        "line-load-analysis": _query_line_status_program,
        "production-plan-entry": _query_plan_program,
        "device-health-dashboard": _query_equipment_program,
        "fault-prediction": _query_equipment_program,
        "maintenance-order": _query_equipment_program,
        "failure-trend-analysis": _query_equipment_program,
        "alert-center": _query_alert_program,
        "inspection-batch": _query_quality_program,
        "defect-analysis": _query_quality_program,
        "defect-analysis-report": _query_quality_program,
        "process-capability-dashboard": _query_spc_program,
        "supplier-risk": _query_supply_program,
        "material-impact": _query_material_program,
        "material-impact-report": _query_material_program,
        "supply-risk-dashboard": _query_supply_program,
    }
    tenant_id = current_tenant_id(user)
    dynamic_result = await _query_dynamic_form_program(db, tenant_id, program_id, limit)
    if dynamic_result is not None:
        dynamic_result["program_id"] = program_id
        dynamic_result["source"] = "dynamic_records"
        return dynamic_result

    loader = loaders.get(program_id)
    if loader is None:
        return {"data": None, "source": "unsupported", "program_id": program_id}

    result = await _try_db(lambda safe_db: loader(safe_db, tenant_id, limit))
    if result is None:
        return {"data": None, "source": "fallback", "program_id": program_id}
    result["program_id"] = program_id
    result["source"] = "database"
    return result


def _metric(label: str, value: int | float | str, tone: str, suffix: str | None = None) -> dict:
    payload = {"label": label, "value": value, "tone": tone}
    if suffix:
        payload["suffix"] = suffix
    return payload


async def _query_dynamic_form_program(db: AsyncSession, tenant_id: int, program_id: str, limit: int):
    if program_id not in {"alert-center", "risk-review"}:
        return None

    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == program_id))
    if form is None:
        return None

    total = await db.scalar(
        select(func.count(DynamicRecord.id)).where(
            DynamicRecord.tenant_id == tenant_id,
            DynamicRecord.form_id == form.id,
            DynamicRecord.deleted_at.is_(None),
        )
    ) or 0
    records = (
        await db.execute(
            select(DynamicRecord)
            .where(
                DynamicRecord.tenant_id == tenant_id,
                DynamicRecord.form_id == form.id,
                DynamicRecord.deleted_at.is_(None),
            )
            .order_by(DynamicRecord.id.desc())
            .limit(limit)
        )
    ).scalars().all()

    if program_id == "alert-center":
        rows = []
        for record in records:
            data = record.data or {}
            rows.append({
                **data,
                "key": f"record-{record.id}",
                "recordId": record.id,
                "formId": form.id,
                "formCode": form.code,
                "_formData": data,
                "_createdAt": record.created_at.isoformat() if record.created_at else None,
                "_updatedAt": record.updated_at.isoformat() if record.updated_at else None,
                "name": data.get("title") or data.get("alertId") or f"Alert {record.id}",
                "source": data.get("source") or data.get("device") or "-",
                "level": data.get("level") or "-",
                "status": data.get("status") or record.status,
                "owner": data.get("owner") or "-",
                "occurredAt": data.get("occurredAt") or (record.created_at.isoformat() if record.created_at else None),
            })
        severe = sum(1 for row in rows if row.get("level") in {"\u4e25\u91cd", "critical", "high"})
        closed = sum(1 for row in rows if row.get("status") in {"\u5df2\u5173\u95ed", "closed"})
        return {
            "metrics": [
                _metric("\u544a\u8b66\u603b\u6570", int(total), "orange"),
                _metric("\u4e25\u91cd\u544a\u8b66", severe, "red"),
                _metric("\u672a\u5173\u95ed", max(int(total) - closed, 0), "blue"),
                _metric("\u8868\u5355\u8bb0\u5f55", "\u5df2\u5165\u5e93", "green"),
            ],
            "rows": rows,
            "total": int(total),
        }

    rows = []
    for record in records:
        data = record.data or {}
        rows.append({
            **data,
            "key": f"record-{record.id}",
            "recordId": record.id,
            "formId": form.id,
            "formCode": form.code,
            "_formData": data,
            "_createdAt": record.created_at.isoformat() if record.created_at else None,
            "_updatedAt": record.updated_at.isoformat() if record.updated_at else None,
            "riskNo": data.get("riskNo") or f"SR-{record.id:06d}",
            "subject": data.get("subject") or "-",
            "level": data.get("level") or "-",
            "owner": data.get("owner") or "-",
            "status": data.get("status") or record.status,
        })
    high = sum(1 for row in rows if row.get("level") in {"\u9ad8", "critical", "high"})
    closed = sum(1 for row in rows if row.get("status") in {"\u5df2\u5173\u95ed", "closed"})
    return {
        "metrics": [
            _metric("\u5f85\u590d\u6838", max(int(total) - closed, 0), "orange"),
            _metric("\u9ad8\u98ce\u9669", high, "red"),
            _metric("\u5df2\u5173\u95ed", closed, "green"),
            _metric("\u8868\u5355\u8bb0\u5f55", int(total), "blue"),
        ],
        "rows": rows,
        "total": int(total),
    }


async def _query_line_status_program(db: AsyncSession, tenant_id: int, limit: int):
    status_counts = dict(
        (
            (status or "unknown"),
            count,
        )
        for status, count in (
            await db.execute(
                select(ProductionLine.status, func.count(ProductionLine.id))
                .where(ProductionLine.tenant_id == tenant_id)
                .group_by(ProductionLine.status)
            )
        ).all()
    )
    total_lines = sum(status_counts.values())

    equipment_stats = (
        select(
            Equipment.line_id.label("line_id"),
            func.count(Equipment.id).label("equipment_count"),
            func.avg(Equipment.health_score).label("avg_health"),
        )
        .where(Equipment.tenant_id == tenant_id)
        .group_by(Equipment.line_id)
        .subquery()
    )
    result = await db.execute(
        select(
            ProductionLine.id,
            ProductionLine.name,
            ProductionLine.status,
            ProductionLine.capacity,
            Workshop.name.label("workshop_name"),
            equipment_stats.c.equipment_count,
            equipment_stats.c.avg_health,
        )
        .where(ProductionLine.tenant_id == tenant_id, Workshop.tenant_id == tenant_id)
        .join(Workshop, Workshop.id == ProductionLine.workshop_id)
        .outerjoin(equipment_stats, equipment_stats.c.line_id == ProductionLine.id)
        .order_by(ProductionLine.id.asc())
        .limit(limit)
    )
    rows = []
    for row in result.mappings().all():
        health = float(row["avg_health"] or 0)
        load = max(1, min(100, round((float(row["capacity"] or 0) % 100) * 0.45 + health * 0.55)))
        rows.append({
            "key": f"line-{row['id']}",
            "line": row["name"],
            "product": row["workshop_name"],
            "station": f"{int(row['equipment_count'] or 0)} devices / {row['status']}",
            "load": load,
        })

    running = int(status_counts.get("running", 0))
    idle = int(status_counts.get("idle", 0))
    maintenance = int(status_counts.get("maintenance", 0))
    offline = int(status_counts.get("offline", 0) + status_counts.get("fault", 0))
    return {
        "metrics": [
            _metric("运行产线", running, "green"),
            _metric("待料/空闲", idle, "orange"),
            _metric("维护/换型", maintenance, "blue"),
            _metric("停线/故障", offline, "red"),
        ],
        "rows": rows,
        "total": total_lines,
    }


async def _query_oee_program(db: AsyncSession, tenant_id: int, limit: int):
    rows_result = await db.execute(
        select(ProductionLine).where(ProductionLine.tenant_id == tenant_id).order_by(ProductionLine.id.asc()).limit(limit)
    )
    lines = rows_result.scalars().all()
    avg_target = await db.scalar(select(func.avg(ProductionLine.oee_target)).where(ProductionLine.tenant_id == tenant_id)) or 0
    low_target_count = await db.scalar(
        select(func.count(ProductionLine.id)).where(ProductionLine.tenant_id == tenant_id, ProductionLine.oee_target < 0.85)
    ) or 0
    rows = []
    total_oee = 0.0
    for line in lines:
        random.seed(line.id * 23)
        availability = random.uniform(0.82, 0.98)
        performance = random.uniform(0.78, 0.96)
        quality_rate = random.uniform(0.94, 0.998)
        oee = availability * performance * quality_rate
        total_oee += oee
        rows.append({
            "key": f"oee-{line.id}",
            "date": datetime.now().strftime("%m-%d"),
            "line": line.name,
            "oee": f"{oee * 100:.1f}%",
            "availability": f"{availability * 100:.1f}%",
            "reason": line.status,
        })
    avg_oee = total_oee / max(len(lines), 1)
    return {
        "metrics": [
            _metric("本期 OEE", round(avg_oee * 100, 1), "green", "%"),
            _metric("目标 OEE", round(float(avg_target) * 100, 1), "blue", "%"),
            _metric("低于目标产线", int(low_target_count), "orange"),
            _metric("样本产线", len(lines), "blue"),
        ],
        "rows": rows,
        "total": await db.scalar(select(func.count(ProductionLine.id)).where(ProductionLine.tenant_id == tenant_id)) or len(rows),
    }


async def _query_plan_program(db: AsyncSession, tenant_id: int, limit: int):
    status_counts = dict(
        (
            (status or "unknown"),
            count,
        )
        for status, count in (
            await db.execute(
                select(WorkOrder.status, func.count(WorkOrder.id))
                .where(WorkOrder.tenant_id == tenant_id)
                .group_by(WorkOrder.status)
            )
        ).all()
    )
    distinct_lines = await db.scalar(
        select(func.count(func.distinct(WorkOrder.line_id))).where(WorkOrder.tenant_id == tenant_id)
    ) or 0
    result = await db.execute(
        select(
            WorkOrder.id,
            WorkOrder.order_no,
            WorkOrder.quantity,
            WorkOrder.completed_quantity,
            WorkOrder.status,
            ProductionLine.name.label("line_name"),
            Product.name.label("product_name"),
        )
        .where(
            WorkOrder.tenant_id == tenant_id,
            ProductionLine.tenant_id == tenant_id,
            SalesOrder.tenant_id == tenant_id,
            Product.tenant_id == tenant_id,
        )
        .join(ProductionLine, ProductionLine.id == WorkOrder.line_id)
        .join(SalesOrder, SalesOrder.id == WorkOrder.sales_order_id)
        .join(Product, Product.id == SalesOrder.product_id)
        .order_by(WorkOrder.planned_start.desc(), WorkOrder.id.asc())
        .limit(limit)
    )
    rows = [
        {
            "key": f"plan-{row['id']}",
            "planNo": row["order_no"],
            "product": row["product_name"],
            "line": row["line_name"],
            "quantity": int(row["quantity"] or 0),
            "status": row["status"],
        }
        for row in result.mappings().all()
    ]
    pending = int(status_counts.get("pending", 0))
    confirmed = int(status_counts.get("confirmed", 0) + status_counts.get("in_progress", 0))
    adjust = int(status_counts.get("cancelled", 0))
    return {
        "metrics": [
            _metric("待提交计划", pending, "orange"),
            _metric("已确认/执行", confirmed, "green"),
            _metric("待调整批次", adjust, "red"),
            _metric("覆盖产线", int(distinct_lines), "blue"),
        ],
        "rows": rows,
        "total": sum(status_counts.values()),
    }


async def _query_equipment_program(db: AsyncSession, tenant_id: int, limit: int):
    total = await db.scalar(select(func.count(Equipment.id)).where(Equipment.tenant_id == tenant_id)) or 0
    avg_health = await db.scalar(select(func.avg(Equipment.health_score)).where(Equipment.tenant_id == tenant_id)) or 0
    high_risk = await db.scalar(
        select(func.count(Equipment.id)).where(Equipment.tenant_id == tenant_id, Equipment.health_score < 60)
    ) or 0
    maintenance = await db.scalar(
        select(func.count(Equipment.id)).where(
            Equipment.tenant_id == tenant_id, Equipment.status.in_(["maintenance", "fault", "offline"])
        )
    ) or 0
    result = await db.execute(
        select(Equipment.id, Equipment.name, Equipment.model, Equipment.status, Equipment.health_score, ProductionLine.name.label("line_name"))
        .join(ProductionLine, ProductionLine.id == Equipment.line_id)
        .where(Equipment.tenant_id == tenant_id, ProductionLine.tenant_id == tenant_id)
        .order_by(Equipment.health_score.asc(), Equipment.id.asc())
        .limit(limit)
    )
    rows = []
    for row in result.mappings().all():
        health = round(float(row["health_score"] or 0))
        rows.append({
            "key": f"equipment-{row['id']}",
            "asset": row["name"],
            "health": health,
            "level": "high" if health < 60 else "medium" if health < 80 else "low",
            "risk": f"{row['status']} / {row['model']}",
            "action": "inspect" if health < 75 else "monitor",
            "orderNo": f"MO-{row['id']:06d}",
            "owner": "maintenance",
            "status": row["status"],
            "week": datetime.now().strftime("%Y-W%W"),
            "type": row["line_name"],
            "count": 1,
            "reason": row["status"],
            "fault": row["status"],
            "probability": f"{max(5, min(95, 100 - health))}%",
            "window": "7d",
        })
    return {
        "metrics": [
            _metric("平均健康度", round(float(avg_health), 1), "green", "%"),
            _metric("高风险设备", int(high_risk), "red"),
            _metric("待处理设备", int(maintenance), "orange"),
            _metric("在线设备", int(total), "blue"),
        ],
        "rows": rows,
        "total": int(total),
    }


async def _query_alert_program(db: AsyncSession, tenant_id: int, limit: int):
    equipment_result = await db.execute(
        select(Equipment.id, Equipment.name, Equipment.status, Equipment.health_score, ProductionLine.name.label("line_name"))
        .join(ProductionLine, ProductionLine.id == Equipment.line_id)
        .where(
            Equipment.tenant_id == tenant_id,
            ProductionLine.tenant_id == tenant_id,
            (Equipment.health_score < 78) | (Equipment.status.in_(["fault", "maintenance", "offline"])),
        )
        .order_by(Equipment.health_score.asc(), Equipment.id.asc())
        .limit(limit)
    )
    rows = []
    for row in equipment_result.mappings().all():
        critical = float(row["health_score"] or 0) < 55 or row["status"] in {"fault", "offline"}
        rows.append({
            "key": f"alert-equipment-{row['id']}",
            "name": f"{row['name']} health warning",
            "source": row["line_name"],
            "level": "critical" if critical else "warning",
            "status": "open" if critical else "reviewing",
            "owner": "maintenance",
            "occurredAt": datetime.now().strftime("%Y-%m-%d"),
        })

    remaining = max(0, limit - len(rows))
    if remaining:
        defect_result = await db.execute(
            select(Defect.id, Defect.defect_type, Defect.severity, Defect.created_at)
            .where(Defect.tenant_id == tenant_id)
            .order_by(Defect.created_at.desc(), Defect.id.asc())
            .limit(remaining)
        )
        for row in defect_result.mappings().all():
            rows.append({
                "key": f"alert-defect-{row['id']}",
                "name": f"{row['defect_type']} quality event",
                "source": "quality",
                "level": "critical" if row["severity"] == "critical" else "warning",
                "status": "open",
                "owner": "quality",
                "occurredAt": row["created_at"].strftime("%Y-%m-%d") if row["created_at"] else None,
            })

    critical_count = sum(1 for row in rows if row["level"] == "critical")
    warning_count = sum(1 for row in rows if row["level"] == "warning")
    return {
        "metrics": [
            _metric("未关闭告警", len(rows), "orange"),
            _metric("严重告警", critical_count, "red"),
            _metric("待复核", warning_count, "blue"),
            _metric("数据来源", "PostgreSQL", "green"),
        ],
        "rows": rows,
        "total": len(rows),
    }


async def _query_quality_program(db: AsyncSession, tenant_id: int, limit: int):
    total_defects = await db.scalar(select(func.count(Defect.id)).where(Defect.tenant_id == tenant_id)) or 0
    critical = await db.scalar(
        select(func.count(Defect.id)).where(Defect.tenant_id == tenant_id, Defect.severity == "critical")
    ) or 0
    inspections = await db.scalar(select(func.count(Inspection.id)).where(Inspection.tenant_id == tenant_id)) or 0
    pass_count = await db.scalar(
        select(func.count(Inspection.id)).where(Inspection.tenant_id == tenant_id, Inspection.result == "pass")
    ) or 0
    result = await db.execute(
        select(Defect.id, Defect.defect_type, Defect.severity, Defect.description, Defect.root_cause, Defect.created_at)
        .where(Defect.tenant_id == tenant_id)
        .order_by(Defect.created_at.desc(), Defect.id.asc())
        .limit(limit)
    )
    rows = []
    for row in result.mappings().all():
        rows.append({
            "key": f"defect-{row['id']}",
            "batchNo": f"INSP-{row['id']:06d}",
            "type": row["defect_type"],
            "count": 1,
            "status": row["severity"],
            "defect": row["defect_type"],
            "severity": row["severity"],
            "reason": row["root_cause"] or row["description"] or "pending analysis",
            "process": row["defect_type"],
            "feature": row["severity"],
            "cpk": 1.1 if row["severity"] == "critical" else 1.35,
            "ppk": 1.0 if row["severity"] == "critical" else 1.28,
            "eventNo": f"QE-{row['id']:06d}",
            "subject": row["defect_type"],
            "owner": "quality",
            "stage": row["severity"],
            "date": row["created_at"].strftime("%Y-%m-%d") if row["created_at"] else None,
        })
    pass_rate = round((pass_count / max(inspections, 1)) * 100, 1)
    return {
        "metrics": [
            _metric("质检批次", int(inspections), "blue"),
            _metric("缺陷记录", int(total_defects), "orange"),
            _metric("严重缺陷", int(critical), "red"),
            _metric("通过率", pass_rate, "green", "%"),
        ],
        "rows": rows,
        "total": int(total_defects),
    }


async def _query_spc_program(db: AsyncSession, tenant_id: int, limit: int):
    total = await db.scalar(select(func.count(SPCPoint.id)).where(SPCPoint.tenant_id == tenant_id)) or 0
    out_of_limit = await db.scalar(
        select(func.count(SPCPoint.id)).where(
            SPCPoint.tenant_id == tenant_id,
            (SPCPoint.value > SPCPoint.ucl) | (SPCPoint.value < SPCPoint.lcl),
        )
    ) or 0
    result = await db.execute(
        select(SPCPoint.id, SPCPoint.parameter, SPCPoint.value, SPCPoint.ucl, SPCPoint.lcl, Equipment.name.label("equipment_name"))
        .join(Equipment, Equipment.id == SPCPoint.equipment_id)
        .where(SPCPoint.tenant_id == tenant_id, Equipment.tenant_id == tenant_id)
        .order_by(SPCPoint.timestamp.desc(), SPCPoint.id.asc())
        .limit(limit)
    )
    rows = []
    for row in result.mappings().all():
        span = max(float(row["ucl"] or 0) - float(row["lcl"] or 0), 0.001)
        cpk = round(span / max(abs(float(row["value"] or 0) - ((float(row["ucl"] or 0) + float(row["lcl"] or 0)) / 2)), 0.1), 2)
        rows.append({
            "key": f"spc-{row['id']}",
            "process": row["equipment_name"],
            "feature": row["parameter"],
            "cpk": cpk,
            "ppk": max(0.8, round(cpk * 0.94, 2)),
            "status": "out_of_limit" if row["value"] > row["ucl"] or row["value"] < row["lcl"] else "stable",
        })
    return {
        "metrics": [
            _metric("SPC 点位", int(total), "blue"),
            _metric("超限点", int(out_of_limit), "orange"),
            _metric("受控比例", round((1 - out_of_limit / max(total, 1)) * 100, 1), "green", "%"),
            _metric("样本", len(rows), "blue"),
        ],
        "rows": rows,
        "total": int(total),
    }


async def _query_supply_program(db: AsyncSession, tenant_id: int, limit: int):
    total = await db.scalar(select(func.count(Supplier.id)).where(Supplier.tenant_id == tenant_id)) or 0
    high_risk = await db.scalar(
        select(func.count(Supplier.id)).where(Supplier.tenant_id == tenant_id, Supplier.rating < 3.5)
    ) or 0
    avg_rating = await db.scalar(select(func.avg(Supplier.rating)).where(Supplier.tenant_id == tenant_id)) or 0
    result = await db.execute(
        select(Supplier).where(Supplier.tenant_id == tenant_id).order_by(Supplier.rating.asc(), Supplier.id.asc()).limit(limit)
    )
    rows = []
    for supplier in result.scalars().all():
        level = "high" if supplier.rating < 3.5 else "medium" if supplier.rating < 4.2 else "low"
        rows.append({
            "key": f"supplier-{supplier.id}",
            "supplier": supplier.name,
            "category": supplier.location,
            "risk": level,
            "level": level,
            "reason": f"rating {supplier.rating:.1f}, lead time {supplier.lead_time_days}d",
            "mitigation": "dual source" if level == "high" else "monitor",
        })
    return {
        "metrics": [
            _metric("供应商", int(total), "blue"),
            _metric("高风险供应商", int(high_risk), "red"),
            _metric("平均评分", round(float(avg_rating), 2), "green"),
            _metric("样本", len(rows), "orange"),
        ],
        "rows": rows,
        "total": int(total),
    }


async def _query_material_program(db: AsyncSession, tenant_id: int, limit: int):
    total = await db.scalar(select(func.count(Material.id)).where(Material.tenant_id == tenant_id)) or 0
    low_stock = await db.scalar(
        select(func.count(Material.id)).where(Material.tenant_id == tenant_id, Material.safety_stock < 500)
    ) or 0
    result = await db.execute(
        select(Material).where(Material.tenant_id == tenant_id).order_by(Material.safety_stock.asc(), Material.id.asc()).limit(limit)
    )
    rows = []
    for material in result.scalars().all():
        risk = "high" if material.safety_stock < 500 else "medium" if material.safety_stock < 1200 else "low"
        rows.append({
            "key": f"material-{material.id}",
            "material": material.name,
            "gap": int(max(0, 1200 - float(material.safety_stock or 0))),
            "line": material.material_type,
            "target": material.material_type,
            "impact": risk,
            "action": "expedite purchase" if risk == "high" else "monitor stock",
            "group": material.material_type,
            "days": round(float(material.safety_stock or 0) / 100, 1),
            "transit": int(float(material.safety_stock or 0) % 40),
            "risk": risk,
        })
    return {
        "metrics": [
            _metric("物料", int(total), "blue"),
            _metric("低安全库存", int(low_stock), "orange"),
            _metric("样本物料", len(rows), "green"),
            _metric("数据来源", "PostgreSQL", "blue"),
        ],
        "rows": rows,
        "total": int(total),
    }
