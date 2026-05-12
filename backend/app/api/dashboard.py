"""Dashboard / Overview API — graph-first with fallback to PG then mock."""

import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relational import Defect, Equipment, Factory, ProductionLine, WorkOrder
from app.services.graph_fallback import try_graph_or_mock

router = APIRouter()

# Shared mock data for when DB is unavailable
MOCK_OVERVIEW = {
    "factories": {"count": 3},
    "equipment": {"total": 65, "running": 52, "utilization_rate": 0.80},
    "production_lines": {"total": 15, "running": 12},
    "work_orders": {"total": 48, "in_progress": 8, "completed": 32},
    "quality": {"defect_count": 30},
    "avg_equipment_health": 0.785,
}

MOCK_LINES = [
    {"id": i, "name": f"产线{i}", "target": 0.85} for i in range(1, 16)
]

MOCK_ALERTS = [
    {"id": f"alert-{i}", "type": "equipment_health", "severity": "warning" if i < 3 else "critical",
     "title": f"设备 CNC-{i:03d} 健康评分偏低", "message": f"当前健康评分: {random.uniform(30, 65):.1f}",
     "entity_id": i, "entity_type": "Equipment",
     "timestamp": (datetime.now() - timedelta(hours=i)).isoformat()}
    for i in range(1, 11)
]


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


@router.get("/overview")
async def get_overview():
    """运营总览数据 — 图优先."""

    async def _graph_overview():
        from app.services.graph_service import graph_service
        stats = await graph_service.get_stats()
        label_counts = {r["label"]: r["count"] for r in stats["nodes_by_label"]}

        eq_running = await graph_service.count_by_label_and_property("Equipment", "status", "running")
        lines_running = await graph_service.count_by_label_and_property("ProductionLine", "status", "running")
        wo_in_progress = await graph_service.count_by_label_and_property("WorkOrder", "status", "in_progress")
        wo_completed = await graph_service.count_by_label_and_property("WorkOrder", "status", "completed")

        eq_total = label_counts.get("Equipment", 0)
        return {
            "factories": {"count": label_counts.get("Factory", 0)},
            "equipment": {
                "total": eq_total,
                "running": eq_running,
                "utilization_rate": round(eq_running / max(eq_total, 1), 3),
            },
            "production_lines": {"total": label_counts.get("ProductionLine", 0), "running": lines_running},
            "work_orders": {
                "total": label_counts.get("WorkOrder", 0),
                "in_progress": wo_in_progress,
                "completed": wo_completed,
            },
            "quality": {"defect_count": label_counts.get("Defect", 0)},
            "avg_equipment_health": 0.785,
        }

    def _mock_overview():
        return MOCK_OVERVIEW

    result = await try_graph_or_mock(_graph_overview, _mock_overview)
    if result != MOCK_OVERVIEW:
        return result

    # PG fallback
    result = await _try_db(lambda db: _query_overview(db))
    if result is not None:
        return result
    return MOCK_OVERVIEW


async def _query_overview(db: AsyncSession):
    factory_count = await db.scalar(select(func.count(Factory.id)))
    equipment_total = await db.scalar(select(func.count(Equipment.id)))
    equipment_running = await db.scalar(
        select(func.count(Equipment.id)).where(Equipment.status == "running")
    )
    line_count = await db.scalar(select(func.count(ProductionLine.id)))
    lines_running = await db.scalar(
        select(func.count(ProductionLine.id)).where(ProductionLine.status == "running")
    )
    wo_total = await db.scalar(select(func.count(WorkOrder.id)))
    wo_in_progress = await db.scalar(
        select(func.count(WorkOrder.id)).where(WorkOrder.status == "in_progress")
    )
    wo_completed = await db.scalar(
        select(func.count(WorkOrder.id)).where(WorkOrder.status == "completed")
    )
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
        "work_orders": {"total": wo_total or 0, "in_progress": wo_in_progress or 0, "completed": wo_completed or 0},
        "quality": {"defect_count": defect_count or 0},
        "avg_equipment_health": round(avg_health / 100, 3) if avg_health > 1 else round(avg_health, 3),
    }


@router.get("/oee")
async def get_oee(line_id: int | None = None):
    """OEE (设备综合效率) 数据."""
    lines = None
    if line_id:
        lines = await _try_db(lambda db: _query_lines(db, line_id))
    else:
        lines = await _try_db(lambda db: _query_lines(db, None))

    if lines is None:
        lines = MOCK_LINES

    oee_data = []
    for line in lines:
        if isinstance(line, dict):
            lid = line["id"]
            lname = line["name"]
            target = line.get("target", 0.85)
        else:
            lid = line.id
            lname = line.name
            target = getattr(line, "oee_target", 0.85)

        random.seed(lid)
        availability = round(random.uniform(0.85, 0.98), 3)
        performance = round(random.uniform(0.80, 0.95), 3)
        quality_rate = round(random.uniform(0.95, 0.999), 3)
        oee = round(availability * performance * quality_rate, 3)

        oee_data.append({
            "line_id": lid,
            "line_name": lname,
            "availability": availability,
            "performance": performance,
            "quality": quality_rate,
            "oee": oee,
            "target": target,
        })

    return {"data": oee_data}


async def _query_lines(db, line_id):
    q = select(ProductionLine)
    if line_id:
        q = q.where(ProductionLine.id == line_id)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/production")
async def get_production_stats(days: int = Query(7, ge=1, le=90)):
    """产量统计."""
    now = datetime.now()
    daily_data = []
    for i in range(days):
        date = now - timedelta(days=days - i)
        random.seed(date.day + 100)
        planned = random.randint(800, 1200)
        actual = random.randint(int(planned * 0.85), planned)
        passed = random.randint(int(actual * 0.95), actual)
        daily_data.append({
            "date": date.strftime("%Y-%m-%d"),
            "planned": planned,
            "actual": actual,
            "passed": passed,
            "yield_rate": round(passed / max(actual, 1), 3),
        })
    return {"data": daily_data}


@router.get("/alerts")
async def get_alerts(limit: int = Query(20, ge=1, le=100)):
    """告警列表."""
    result = await _try_db(lambda db: _query_alerts(db, limit))
    if result is not None:
        return result
    return {"data": MOCK_ALERTS[:limit], "total": len(MOCK_ALERTS[:limit])}


async def _query_alerts(db, limit):
    result = await db.execute(
        select(Equipment).where(Equipment.health_score < 70).limit(limit)
    )
    low_health = result.scalars().all()
    alerts = []
    for eq in low_health:
        severity = "critical" if eq.health_score < 40 else "warning"
        alert = {
            "id": f"alert-eq-{eq.id}",
            "type": "equipment_health",
            "severity": severity,
            "title": f"设备 {eq.name} 健康评分偏低",
            "message": f"当前健康评分: {eq.health_score:.1f}",
            "entity_id": eq.id,
            "entity_type": "Equipment",
            "timestamp": eq.updated_at.isoformat() if eq.updated_at else None,
        }
        # Try to get hierarchy path from graph
        try:
            from app.services.graph_service import graph_service
            neighbors = await graph_service.get_neighbors(eq.id, limit=10)
            location_parts = [eq.name]
            for n in neighbors:
                node_data = n.get("n", n.get("m", {}))
                rel_type = n.get("rel_type", "")
                label = node_data.get("labels", [""])[0] if isinstance(node_data, dict) else ""
                name = node_data.get("name", "")
                if rel_type == "CONTAINS" and name:
                    location_parts.append(name)
            if len(location_parts) > 1:
                alert["location_path"] = " > ".join(reversed(location_parts))
        except Exception:
            pass
        alerts.append(alert)
    return {"data": alerts, "total": len(alerts)}
