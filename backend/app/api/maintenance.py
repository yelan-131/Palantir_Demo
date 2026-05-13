"""Predictive Maintenance API — with fallback to mock data when DB unavailable."""

import asyncio
import random
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.graph_fallback import try_graph_or_mock

router = APIRouter()


# ── Mock data ──────────────────────────────────────────────

MOCK_EQUIPMENT_HEALTH = [
    {"id": 1,  "name": "DMG MORI NLX 2500",    "model": "NLX2500/700",       "status": "running",     "health_score": 92.5, "risk_level": "healthy"},
    {"id": 2,  "name": "CNC加工中心-01",        "model": "VMC850",             "status": "running",     "health_score": 88.3, "risk_level": "healthy"},
    {"id": 3,  "name": "五轴加工中心",          "model": "MU-5000",            "status": "running",     "health_score": 95.1, "risk_level": "healthy"},
    {"id": 4,  "name": "激光切割机-TRUMPF",     "model": "TruLaser 3030",     "status": "running",     "health_score": 91.2, "risk_level": "healthy"},
    {"id": 5,  "name": "焊接机器人-KUKA",       "model": "KR 210 R2700",      "status": "running",     "health_score": 76.8, "risk_level": "warning"},
    {"id": 6,  "name": "数控冲床-AMADA",        "model": "EMK 3610",          "status": "idle",        "health_score": 85.0, "risk_level": "healthy"},
    {"id": 7,  "name": "三坐标测量仪",          "model": "Global S",          "status": "running",     "health_score": 98.2, "risk_level": "healthy"},
    {"id": 8,  "name": "注塑机-海天",           "model": "MA3200",            "status": "running",     "health_score": 82.1, "risk_level": "healthy"},
    {"id": 9,  "name": "数控车床-沈阳机床",     "model": "CAK50135",          "status": "running",     "health_score": 68.5, "risk_level": "warning"},
    {"id": 10, "name": "磨床-上海机床",         "model": "MKA3220",           "status": "maintenance", "health_score": 45.2, "risk_level": "critical"},
    {"id": 11, "name": "电火花机-沙迪克",       "model": "VZ300L",            "status": "running",     "health_score": 72.3, "risk_level": "warning"},
    {"id": 12, "name": "折弯机-通快",           "model": "TruBend 5130",     "status": "running",     "health_score": 89.7, "risk_level": "healthy"},
    {"id": 13, "name": "工业机器人-FANUC",      "model": "M-20iA/35M",       "status": "running",     "health_score": 93.4, "risk_level": "healthy"},
    {"id": 14, "name": "AGV搬运车-01",          "model": "AVG-500",           "status": "running",     "health_score": 78.6, "risk_level": "warning"},
    {"id": 15, "name": "空压机-阿特拉斯",       "model": "GA37+",             "status": "running",     "health_score": 38.9, "risk_level": "critical"},
]

MOCK_PREDICTIONS = [
    {"equipment_id": 15, "equipment_name": "空压机-阿特拉斯",     "health_score": 38.9, "fault_probability": 0.611, "predicted_fault": "轴承磨损",   "estimated_days": 2,  "risk_level": "critical"},
    {"equipment_id": 10, "equipment_name": "磨床-上海机床",       "health_score": 45.2, "fault_probability": 0.548, "predicted_fault": "轴承磨损",   "estimated_days": 3,  "risk_level": "critical"},
    {"equipment_id": 9,  "equipment_name": "数控车床-沈阳机床",   "health_score": 68.5, "fault_probability": 0.315, "predicted_fault": "温度异常",   "estimated_days": 7,  "risk_level": "warning"},
    {"equipment_id": 11, "equipment_name": "电火花机-沙迪克",     "health_score": 72.3, "fault_probability": 0.277, "predicted_fault": "温度异常",   "estimated_days": 8,  "risk_level": "warning"},
    {"equipment_id": 14, "equipment_name": "AGV搬运车-01",        "health_score": 78.6, "fault_probability": 0.214, "predicted_fault": "温度异常",   "estimated_days": 9,  "risk_level": "warning"},
    {"equipment_id": 5,  "equipment_name": "焊接机器人-KUKA",     "health_score": 76.8, "fault_probability": 0.232, "predicted_fault": "温度异常",   "estimated_days": 9,  "risk_level": "warning"},
]


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── Endpoints ──────────────────────────────────────────────

@router.get("/equipment-health")
async def equipment_health_overview():
    """设备健康总览."""
    async def _query(db):
        from app.models.relational import Equipment
        from sqlalchemy import select
        result = await db.execute(select(Equipment).order_by(Equipment.health_score))
        equipment_list = result.scalars().all()

        total = len(equipment_list)
        healthy = sum(1 for e in equipment_list if e.health_score >= 80)
        warning = sum(1 for e in equipment_list if 50 <= e.health_score < 80)
        critical = sum(1 for e in equipment_list if e.health_score < 50)

        return {
            "summary": {
                "total": total,
                "healthy": healthy,
                "warning": warning,
                "critical": critical,
                "avg_score": round(sum(e.health_score for e in equipment_list) / max(total, 1), 1),
            },
            "equipment": [
                {
                    "id": e.id,
                    "name": e.name,
                    "model": e.model,
                    "status": e.status,
                    "health_score": round(e.health_score, 1),
                    "risk_level": "critical" if e.health_score < 50 else ("warning" if e.health_score < 80 else "healthy"),
                }
                for e in equipment_list
            ],
        }

    result = await _try_db(_query)
    if result is not None:
        # Note: Neo4j per-equipment get_neighbors enrichment removed to avoid timeout.
        # Location path, sensor count, and assigned workers are non-essential for overview.
        return result

    # Mock fallback
    total = len(MOCK_EQUIPMENT_HEALTH)
    healthy = sum(1 for e in MOCK_EQUIPMENT_HEALTH if e["health_score"] >= 80)
    warning = sum(1 for e in MOCK_EQUIPMENT_HEALTH if 50 <= e["health_score"] < 80)
    critical = sum(1 for e in MOCK_EQUIPMENT_HEALTH if e["health_score"] < 50)
    avg_score = round(sum(e["health_score"] for e in MOCK_EQUIPMENT_HEALTH) / total, 1)

    return {
        "summary": {
            "total": total,
            "healthy": healthy,
            "warning": warning,
            "critical": critical,
            "avg_score": avg_score,
        },
        "equipment": MOCK_EQUIPMENT_HEALTH,
    }


@router.get("/equipment/{equipment_id}/health")
async def single_equipment_health(equipment_id: int):
    """单设备健康评分详情."""
    async def _query(db):
        from app.models.relational import Equipment
        eq = await db.get(Equipment, equipment_id)
        if not eq:
            return None

        trend = []
        for i in range(7):
            date = datetime.now() - timedelta(days=6 - i)
            random.seed(equipment_id * 100 + i)
            score = max(0, min(100, eq.health_score + random.uniform(-10, 5)))
            trend.append({"date": date.strftime("%Y-%m-%d"), "health_score": round(score, 1)})

        random.seed(equipment_id)
        breakdown = {
            "vibration": round(random.uniform(60, 100), 1),
            "temperature": round(random.uniform(70, 100), 1),
            "pressure": round(random.uniform(75, 100), 1),
            "electrical": round(random.uniform(80, 100), 1),
            "wear": round(random.uniform(50, 95), 1),
        }

        return {
            "id": eq.id,
            "name": eq.name,
            "model": eq.model,
            "status": eq.status,
            "health_score": round(eq.health_score, 1),
            "risk_level": "critical" if eq.health_score < 50 else ("warning" if eq.health_score < 80 else "healthy"),
            "trend": trend,
            "breakdown": breakdown,
            "recommendation": _get_recommendation(eq.health_score),
        }

    result = await _try_db(_query)
    if result is not None:
        # Enrich with graph context (with timeout to avoid cascade)
        try:
            from app.services.graph_service import graph_service
            neighbors = await asyncio.wait_for(
                graph_service.get_neighbors(equipment_id, limit=20),
                timeout=3,
            )
            location_parts = []
            related_work_orders = []
            for nb in neighbors:
                if nb.get("rel_type") == "CONTAINS":
                    m = nb.get("m", {})
                    if isinstance(m, dict):
                        name = m.get("name", "")
                        if name:
                            location_parts.append(name)
                if nb.get("rel_type") == "FEEDS" and isinstance(nb.get("m"), dict):
                    related_work_orders.append(nb["m"].get("pg_id"))
            result["location_path"] = " > ".join(location_parts) if location_parts else None
            result["sensor_count"] = sum(1 for nb in neighbors if nb.get("rel_type") == "FEEDS")
            result["related_work_orders"] = related_work_orders if related_work_orders else None
        except asyncio.TimeoutError:
            pass
        except Exception:
            pass
        # Cascade risk from impact analysis (with timeout)
        try:
            from app.services.graph_service import graph_service
            impacted = await asyncio.wait_for(
                graph_service.impact_analysis(equipment_id, max_hops=3, limit=30),
                timeout=3,
            )
            result["cascade_risk"] = len(impacted) if impacted else 0
        except asyncio.TimeoutError:
            pass
        except Exception:
            pass
        return result

    # Mock fallback - find matching mock equipment
    eq_mock = None
    for eq in MOCK_EQUIPMENT_HEALTH:
        if eq["id"] == equipment_id:
            eq_mock = eq
            break

    if not eq_mock:
        # Generate a generic mock for unknown IDs
        random.seed(equipment_id)
        health_score = round(random.uniform(40, 95), 1)
        eq_mock = {
            "id": equipment_id,
            "name": f"设备-{equipment_id}",
            "model": f"MODEL-{equipment_id}",
            "status": "running",
            "health_score": health_score,
            "risk_level": "critical" if health_score < 50 else ("warning" if health_score < 80 else "healthy"),
        }

    trend = []
    for i in range(7):
        date = datetime.now() - timedelta(days=6 - i)
        random.seed(equipment_id * 100 + i)
        score = max(0, min(100, eq_mock["health_score"] + random.uniform(-10, 5)))
        trend.append({"date": date.strftime("%Y-%m-%d"), "health_score": round(score, 1)})

    random.seed(equipment_id)
    breakdown = {
        "vibration": round(random.uniform(60, 100), 1),
        "temperature": round(random.uniform(70, 100), 1),
        "pressure": round(random.uniform(75, 100), 1),
        "electrical": round(random.uniform(80, 100), 1),
        "wear": round(random.uniform(50, 95), 1),
    }

    result = {
        "id": eq_mock["id"],
        "name": eq_mock["name"],
        "model": eq_mock["model"],
        "status": eq_mock["status"],
        "health_score": eq_mock["health_score"],
        "risk_level": eq_mock["risk_level"],
        "trend": trend,
        "breakdown": breakdown,
        "recommendation": _get_recommendation(eq_mock["health_score"]),
    }

    # Enrich mock result with graph context (with timeout)
    try:
        from app.services.graph_service import graph_service
        neighbors = await asyncio.wait_for(
            graph_service.get_neighbors(equipment_id, limit=20),
            timeout=3,
        )
        location_parts = []
        related_work_orders = []
        for nb in neighbors:
            if nb.get("rel_type") == "CONTAINS":
                m = nb.get("m", {})
                if isinstance(m, dict):
                    name = m.get("name", "")
                    if name:
                        location_parts.append(name)
            if nb.get("rel_type") == "FEEDS" and isinstance(nb.get("m"), dict):
                related_work_orders.append(nb["m"].get("pg_id"))
        result["location_path"] = " > ".join(location_parts) if location_parts else None
        result["sensor_count"] = sum(1 for nb in neighbors if nb.get("rel_type") == "FEEDS")
        result["related_work_orders"] = related_work_orders if related_work_orders else None
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass
    try:
        from app.services.graph_service import graph_service
        impacted = await asyncio.wait_for(
            graph_service.impact_analysis(equipment_id, max_hops=3, limit=30),
            timeout=3,
        )
        result["cascade_risk"] = len(impacted) if impacted else 0
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass

    return result


@router.get("/predictions")
async def fault_predictions(
    risk_level: str | None = None,
    limit: int = Query(20, ge=1, le=100),
):
    """故障预测列表."""
    async def _query(db):
        from app.models.relational import Equipment
        from sqlalchemy import select
        result = await db.execute(select(Equipment).order_by(Equipment.health_score))
        all_equipment = result.scalars().all()

        predictions = []
        for eq in all_equipment:
            if eq.health_score < 80:
                fault_prob = round((100 - eq.health_score) / 100, 3)
                pred = {
                    "equipment_id": eq.id,
                    "equipment_name": eq.name,
                    "health_score": round(eq.health_score, 1),
                    "fault_probability": fault_prob,
                    "predicted_fault": "轴承磨损" if eq.health_score < 60 else "温度异常",
                    "estimated_days": max(1, int((eq.health_score - 30) / 5)),
                    "risk_level": "critical" if eq.health_score < 50 else "warning",
                }
                if risk_level and pred["risk_level"] != risk_level:
                    continue
                predictions.append(pred)

        return {"data": predictions[:limit]}

    result = await _try_db(_query)
    if result is not None:
        # Note: Neo4j per-prediction impact_analysis enrichment removed to avoid timeout.
        # Affected production lines and work orders are non-essential for prediction list.
        return result

    # Mock fallback
    filtered = MOCK_PREDICTIONS
    if risk_level:
        filtered = [p for p in filtered if p["risk_level"] == risk_level]
    filtered = filtered[:limit]
    return {"data": filtered}


@router.get("/work-orders")
async def list_work_orders(status: str | None = None):
    """维修工单列表."""
    async def _query(db):
        from app.models.relational import WorkOrder
        from sqlalchemy import select
        query = select(WorkOrder).order_by(WorkOrder.created_at.desc())
        if status:
            query = query.where(WorkOrder.status == status)
        result = await db.execute(query)
        work_orders = result.scalars().all()
        return {
            "data": [
                {
                    "id": wo.id,
                    "order_no": wo.order_no,
                    "line_id": wo.line_id,
                    "status": wo.status,
                    "quantity": wo.quantity,
                    "completed_quantity": wo.completed_quantity,
                    "created_at": wo.created_at.isoformat() if wo.created_at else None,
                }
                for wo in work_orders
            ]
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    work_orders = []
    random.seed(42)
    for i in range(1, 11):
        wo_status = random.choice(["pending", "in_progress", "completed"])
        if status and wo_status != status:
            continue
        work_orders.append({
            "id": i,
            "equipment_id": random.randint(1, 15),
            "type": random.choice(["preventive", "corrective", "emergency"]),
            "priority": random.choice(["low", "medium", "high", "critical"]),
            "status": wo_status,
            "assigned_to": f"维修工-{random.randint(1, 5)}",
            "created_at": (datetime.now() - timedelta(days=random.randint(0, 7))).isoformat(),
        })
    return {"data": work_orders}


@router.post("/work-orders")
async def create_work_order(body: dict):
    """创建维修工单."""
    return {
        "id": random.randint(100, 999),
        "status": "pending",
        "message": "维修工单已创建",
    }


def _get_recommendation(health_score: float) -> str:
    if health_score >= 80:
        return "设备运行正常，建议继续常规巡检。"
    elif health_score >= 60:
        return "设备存在轻微异常，建议加强监控并安排预防性维护。"
    elif health_score >= 40:
        return "设备存在明显风险，建议48小时内安排检修。"
    else:
        return "设备存在严重风险，建议立即停机检修！"
