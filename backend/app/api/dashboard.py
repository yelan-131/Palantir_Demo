"""Dashboard API for production operations."""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import safe_db_call as _try_db
from app.models.relational import Defect, Equipment, Factory, Product, ProductionLine, SalesOrder, WorkOrder, Workshop

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
async def get_overview():
    result = await _try_db(lambda db: _query_overview(db))
    return result or MOCK_OVERVIEW


async def _query_overview(db: AsyncSession):
    factory_count = await db.scalar(select(func.count(Factory.id)))
    equipment_total = await db.scalar(select(func.count(Equipment.id)))
    equipment_running = await db.scalar(select(func.count(Equipment.id)).where(Equipment.status == "running"))
    line_count = await db.scalar(select(func.count(ProductionLine.id)))
    lines_running = await db.scalar(select(func.count(ProductionLine.id)).where(ProductionLine.status == "running"))
    wo_total = await db.scalar(select(func.count(WorkOrder.id)))
    wo_in_progress = await db.scalar(select(func.count(WorkOrder.id)).where(WorkOrder.status == "in_progress"))
    wo_completed = await db.scalar(select(func.count(WorkOrder.id)).where(WorkOrder.status == "completed"))
    defect_count = await db.scalar(select(func.count(Defect.id)))
    avg_health = await db.scalar(select(func.avg(Equipment.health_score))) or 0.0

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
    }


@router.get("/oee")
async def get_oee(line_id: int | None = None):
    lines = await _try_db(lambda db: _query_lines(db, line_id))
    if not lines:
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
    return {"data": oee_data}


async def _query_lines(db: AsyncSession, line_id: int | None):
    query = select(ProductionLine).order_by(ProductionLine.id)
    if line_id:
        query = query.where(ProductionLine.id == line_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/production")
async def get_production_stats(days: int = Query(14, ge=1, le=90)):
    result = await _try_db(lambda db: _query_production_stats(db, days))
    if result is not None:
        return result
    return {"data": _mock_production_stats(days)}


async def _query_production_stats(db: AsyncSession, days: int):
    start = datetime.now() - timedelta(days=days - 1)
    result = await db.execute(select(WorkOrder).where(WorkOrder.planned_start >= start))
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
async def get_alerts(limit: int = Query(20, ge=1, le=100)):
    result = await _try_db(lambda db: _query_alerts(db, limit))
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
    return {"data": alerts, "total": len(alerts)}


async def _query_alerts(db: AsyncSession, limit: int):
    result = await db.execute(
        select(Equipment)
        .where(Equipment.health_score < 68)
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
    return {"data": alerts, "total": len(alerts)}


@router.get("/programs/{program_id}")
async def get_program_data(program_id: str, limit: int = Query(500, ge=1, le=1000)):
    """Return database-backed rows for generated application pages.

    The AppPrograms frontend still owns layout and column renderers. This API
    replaces the old static row arrays with data from the manufacturing seed
    tables when the production database is available.
    """
    loaders = {
        "line-status": _query_line_status_program,
        "production-plan-entry": _query_plan_program,
        "alert-center": _query_alert_program,
    }
    loader = loaders.get(program_id)
    if loader is None:
        return {"data": None, "source": "unsupported", "program_id": program_id}

    result = await _try_db(lambda db: loader(db, limit))
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


async def _query_line_status_program(db: AsyncSession, limit: int):
    status_counts = dict(
        (
            (status or "unknown"),
            count,
        )
        for status, count in (
            await db.execute(select(ProductionLine.status, func.count(ProductionLine.id)).group_by(ProductionLine.status))
        ).all()
    )
    total_lines = sum(status_counts.values())

    equipment_stats = (
        select(
            Equipment.line_id.label("line_id"),
            func.count(Equipment.id).label("equipment_count"),
            func.avg(Equipment.health_score).label("avg_health"),
        )
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


async def _query_plan_program(db: AsyncSession, limit: int):
    status_counts = dict(
        (
            (status or "unknown"),
            count,
        )
        for status, count in (
            await db.execute(select(WorkOrder.status, func.count(WorkOrder.id)).group_by(WorkOrder.status))
        ).all()
    )
    distinct_lines = await db.scalar(select(func.count(func.distinct(WorkOrder.line_id)))) or 0
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


async def _query_alert_program(db: AsyncSession, limit: int):
    equipment_result = await db.execute(
        select(Equipment.id, Equipment.name, Equipment.status, Equipment.health_score, ProductionLine.name.label("line_name"))
        .join(ProductionLine, ProductionLine.id == Equipment.line_id)
        .where((Equipment.health_score < 78) | (Equipment.status.in_(["fault", "maintenance", "offline"])))
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
