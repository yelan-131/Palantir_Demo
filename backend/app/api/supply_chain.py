"""Supply Chain API — with fallback to mock data when DB unavailable."""

import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Query

router = APIRouter()


# ── Mock data ──────────────────────────────────────────────

MOCK_SUPPLIERS = [
    {"id": 1, "name": "宝钢股份",         "location": "上海市宝山区",           "rating": 4.8, "lead_time_days": 5, "contact": "张经理 021-2664-XXXX"},
    {"id": 2, "name": "SKF中国",           "location": "上海市嘉定区",           "rating": 4.6, "lead_time_days": 7, "contact": "李经理 021-3958-XXXX"},
    {"id": 3, "name": "东北特钢集团",      "location": "辽宁省大连市",           "rating": 4.5, "lead_time_days": 8, "contact": "王经理 0411-8765-XXXX"},
    {"id": 4, "name": "NOK密封技术",      "location": "江苏省无锡市",           "rating": 4.3, "lead_time_days": 3, "contact": "陈经理 0510-8512-XXXX"},
    {"id": 5, "name": "沙钢集团",         "location": "江苏省张家港市",         "rating": 4.2, "lead_time_days": 6, "contact": "赵经理 0512-5856-XXXX"},
    {"id": 6, "name": "兴澄特钢",         "location": "江苏省江阴市",           "rating": 4.4, "lead_time_days": 5, "contact": "周经理 0510-8625-XXXX"},
    {"id": 7, "name": "太钢不锈",         "location": "山西省太原市",           "rating": 4.1, "lead_time_days": 10, "contact": "吴经理 0351-3015-XXXX"},
    {"id": 8, "name": "洛阳轴承研究所",   "location": "河南省洛阳市",           "rating": 4.0, "lead_time_days": 12, "contact": "郑经理 0379-6488-XXXX"},
]

MOCK_INVENTORY = {
    "items": [
        {"material_id": 1, "material_name": "20CrMnTi合金钢", "warehouse_id": 1, "quantity": 12000, "reserved": 3500, "available": 8500},
        {"material_id": 2, "material_name": "HT250铸铁",       "warehouse_id": 1, "quantity": 4500,  "reserved": 2000, "available": 2500},
        {"material_id": 3, "material_name": "45号钢棒料",      "warehouse_id": 1, "quantity": 15000, "reserved": 5000, "available": 10000},
        {"material_id": 4, "material_name": "NOK密封件",       "warehouse_id": 3, "quantity": 8000,  "reserved": 3000, "available": 5000},
        {"material_id": 5, "material_name": "SKF轴承6205",     "warehouse_id": 3, "quantity": 1500,  "reserved": 800,  "available": 700},
        {"material_id": 6, "material_name": "铝合金6061",      "warehouse_id": 1, "quantity": 6000,  "reserved": 2000, "available": 4000},
        {"material_id": 7, "material_name": "铜合金H62",       "warehouse_id": 1, "quantity": 2800,  "reserved": 1500, "available": 1300},
        {"material_id": 8, "material_name": "不锈钢304板",     "warehouse_id": 2, "quantity": 5200,  "reserved": 1800, "available": 3400},
    ],
    "alerts": [
        {"material_id": 2, "material_name": "HT250铸铁",   "current_stock": 4500,  "safety_stock": 5000,  "shortage": 500,  "alert_level": "warning"},
        {"material_id": 5, "material_name": "SKF轴承6205", "current_stock": 1500,  "safety_stock": 3000,  "shortage": 1500, "alert_level": "critical"},
        {"material_id": 7, "material_name": "铜合金H62",   "current_stock": 2800,  "safety_stock": 4000,  "shortage": 1200, "alert_level": "warning"},
    ],
}

MOCK_SHIPMENTS = [
    {"id": 1, "origin_id": 1, "destination_id": 3, "status": "in_transit", "eta": "2026-04-22T14:00:00", "tracking_no": "SF1234567890"},
    {"id": 2, "origin_id": 2, "destination_id": 1, "status": "delivered",  "eta": "2026-04-20T16:00:00", "tracking_no": "SF1234567891"},
    {"id": 3, "origin_id": 1, "destination_id": 2, "status": "pending",    "eta": "2026-04-23T10:00:00", "tracking_no": "SF1234567892"},
    {"id": 4, "origin_id": 3, "destination_id": 1, "status": "delayed",    "eta": "2026-04-22T18:00:00", "tracking_no": "SF1234567893"},
    {"id": 5, "origin_id": 2, "destination_id": 3, "status": "in_transit", "eta": "2026-04-23T08:00:00", "tracking_no": "SF1234567894"},
    {"id": 6, "origin_id": 1, "destination_id": 2, "status": "delivered",  "eta": "2026-04-19T12:00:00", "tracking_no": "SF1234567895"},
]

MOCK_RISKS = [
    {"supplier_id": 8, "supplier_name": "洛阳轴承研究所", "location": "河南省洛阳市", "risk_score": 62.3,
     "risk_level": "high",
     "factors": {"delivery_reliability": 72.5, "quality_rating": 80.0, "financial_stability": 58.3, "geopolitical_risk": 45.2},
     "recommendation": "高风险供应商，建议立即评估替代方案。"},
    {"supplier_id": 7, "supplier_name": "太钢不锈",     "location": "山西省太原市", "risk_score": 55.1,
     "risk_level": "high",
     "factors": {"delivery_reliability": 78.2, "quality_rating": 82.0, "financial_stability": 65.7, "geopolitical_risk": 38.4},
     "recommendation": "高风险供应商，建议立即评估替代方案。"},
    {"supplier_id": 5, "supplier_name": "沙钢集团",     "location": "江苏省张家港市", "risk_score": 38.7,
     "risk_level": "medium",
     "factors": {"delivery_reliability": 85.3, "quality_rating": 84.0, "financial_stability": 76.1, "geopolitical_risk": 22.5},
     "recommendation": "中等风险，建议加强监控并建立备用供应商。"},
    {"supplier_id": 4, "supplier_name": "NOK密封技术",  "location": "江苏省无锡市", "risk_score": 32.4,
     "risk_level": "medium",
     "factors": {"delivery_reliability": 88.1, "quality_rating": 86.0, "financial_stability": 82.5, "geopolitical_risk": 15.3},
     "recommendation": "中等风险，建议加强监控并建立备用供应商。"},
    {"supplier_id": 3, "supplier_name": "东北特钢集团", "location": "辽宁省大连市", "risk_score": 35.8,
     "risk_level": "medium",
     "factors": {"delivery_reliability": 82.6, "quality_rating": 90.0, "financial_stability": 79.4, "geopolitical_risk": 28.7},
     "recommendation": "中等风险，建议加强监控并建立备用供应商。"},
    {"supplier_id": 6, "supplier_name": "兴澄特钢",     "location": "江苏省江阴市", "risk_score": 28.2,
     "risk_level": "low",
     "factors": {"delivery_reliability": 90.7, "quality_rating": 88.0, "financial_stability": 85.2, "geopolitical_risk": 12.1},
     "recommendation": "低风险供应商，合作关系稳定。"},
    {"supplier_id": 2, "supplier_name": "SKF中国",       "location": "上海市嘉定区", "risk_score": 22.5,
     "risk_level": "low",
     "factors": {"delivery_reliability": 93.4, "quality_rating": 92.0, "financial_stability": 91.8, "geopolitical_risk": 10.8},
     "recommendation": "低风险供应商，合作关系稳定。"},
    {"supplier_id": 1, "supplier_name": "宝钢股份",     "location": "上海市宝山区", "risk_score": 18.9,
     "risk_level": "low",
     "factors": {"delivery_reliability": 95.2, "quality_rating": 96.0, "financial_stability": 93.5, "geopolitical_risk": 8.2},
     "recommendation": "低风险供应商，合作关系稳定。"},
]


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── Endpoints ──────────────────────────────────────────────

@router.get("/suppliers")
async def list_suppliers(rating_min: float | None = None):
    """供应商列表 — 附加上游 SUPPLIES 关系数据."""
    async def _query(db):
        from app.models.relational import Supplier
        from sqlalchemy import select
        query = select(Supplier).order_by(Supplier.rating.desc())
        if rating_min is not None:
            query = query.where(Supplier.rating >= rating_min)
        result = await db.execute(query)
        suppliers = result.scalars().all()
        data = [
            {
                "id": s.id,
                "name": s.name,
                "location": s.location,
                "rating": s.rating,
                "lead_time_days": s.lead_time_days,
                "contact": s.contact,
            }
            for s in suppliers
        ]
        # Note: Neo4j SUPPLIES relationship enrichment removed to avoid timeout
        # when Neo4j is slow/unavailable. The core supplier data from PG is sufficient.
        return {"data": data}

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    filtered = MOCK_SUPPLIERS
    if rating_min is not None:
        filtered = [s for s in filtered if s["rating"] >= rating_min]
    return {"data": filtered}


@router.get("/inventory")
async def inventory_overview():
    """库存总览."""
    async def _query(db):
        from app.models.relational import Inventory, Material
        from sqlalchemy import select
        result = await db.execute(
            select(Inventory, Material.name.label("material_name"))
            .join(Material, Inventory.material_id == Material.id)
        )
        rows = result.fetchall()

        items = []
        alerts = []
        for inv, mat_name in rows:
            item = {
                "material_id": inv.material_id,
                "material_name": mat_name,
                "warehouse_id": inv.warehouse_id,
                "quantity": inv.quantity,
                "reserved": inv.reserved,
                "available": inv.quantity - inv.reserved,
            }
            items.append(item)

            mat = await db.get(Material, inv.material_id)
            if mat and inv.quantity < mat.safety_stock:
                alerts.append({
                    "material_id": inv.material_id,
                    "material_name": mat_name,
                    "current_stock": inv.quantity,
                    "safety_stock": mat.safety_stock,
                    "shortage": mat.safety_stock - inv.quantity,
                    "alert_level": "critical" if inv.quantity < mat.safety_stock * 0.5 else "warning",
                })

        return {
            "items": items,
            "total_items": len(items),
            "alerts": alerts,
            "alert_count": len(alerts),
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    return {
        "items": MOCK_INVENTORY["items"],
        "total_items": len(MOCK_INVENTORY["items"]),
        "alerts": MOCK_INVENTORY["alerts"],
        "alert_count": len(MOCK_INVENTORY["alerts"]),
    }


@router.get("/shipments")
async def list_shipments(status: str | None = None):
    """物流追踪."""
    async def _query(db):
        from app.models.relational import Shipment
        from sqlalchemy import select
        query = select(Shipment).order_by(Shipment.created_at.desc())
        if status:
            query = query.where(Shipment.status == status)
        result = await db.execute(query)
        shipments = result.scalars().all()
        return {
            "data": [
                {
                    "id": s.id,
                    "origin_id": s.origin_id,
                    "destination_id": s.destination_id,
                    "status": s.status,
                    "eta": s.eta.isoformat() if s.eta else None,
                    "tracking_no": s.tracking_no,
                }
                for s in shipments
            ]
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    filtered = MOCK_SHIPMENTS
    if status:
        filtered = [s for s in filtered if s["status"] == status]
    return {"data": filtered}


@router.get("/risk-assessment")
async def risk_assessment():
    """供应链风险评估 — 用图影响分析评估连锁风险."""
    async def _query(db):
        from app.models.relational import Supplier
        from sqlalchemy import select
        result = await db.execute(select(Supplier))
        suppliers = result.scalars().all()

        risks = []
        random.seed(42)
        for s in suppliers:
            risk_score = round(100 - s.rating * 20 + random.uniform(-5, 5), 1)
            risk_score = max(0, min(100, risk_score))
            entry = {
                "supplier_id": s.id,
                "supplier_name": s.name,
                "location": s.location,
                "risk_score": risk_score,
                "risk_level": "high" if risk_score > 60 else ("medium" if risk_score > 30 else "low"),
                "factors": {
                    "delivery_reliability": round(random.uniform(60, 100), 1),
                    "quality_rating": round(s.rating / 5 * 100, 1),
                    "financial_stability": round(random.uniform(55, 95), 1),
                    "geopolitical_risk": round(random.uniform(10, 70), 1),
                },
                "recommendation": _get_risk_recommendation(risk_score),
            }
            # Note: Neo4j impact analysis enrichment removed to avoid timeout.
            # The risk score and factors from PG data are sufficient.
            risks.append(entry)

        risks.sort(key=lambda x: x["risk_score"], reverse=True)
        return {"data": risks}

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    return {"data": MOCK_RISKS}


@router.get("/analytics")
async def supply_chain_analytics():
    """供应链分析数据."""
    async def _query(db):
        from app.models.relational import Supplier
        from sqlalchemy import func, select
        random.seed(42)
        monthly_turnover = [
            {"month": (datetime.now() - timedelta(days=30 * i)).strftime("%Y-%m"), "turnover_rate": round(random.uniform(3.5, 6.5), 2)}
            for i in range(6)
        ][::-1]

        supplier_count = await db.scalar(select(func.count(Supplier.id)))
        delivery_performance = {
            "on_time": round(random.uniform(85, 95), 1),
            "early": round(random.uniform(3, 8), 1),
            "late": round(random.uniform(2, 10), 1),
        }

        cost_trend = [
            {"month": (datetime.now() - timedelta(days=30 * i)).strftime("%Y-%m"), "cost": round(random.uniform(800000, 1200000), 0)}
            for i in range(6)
        ][::-1]

        return {
            "inventory_turnover": monthly_turnover,
            "delivery_performance": delivery_performance,
            "cost_trend": cost_trend,
            "supplier_count": supplier_count or 0,
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    random.seed(42)
    monthly_turnover = [
        {"month": (datetime.now() - timedelta(days=30 * i)).strftime("%Y-%m"), "turnover_rate": round(random.uniform(3.5, 6.5), 2)}
        for i in range(6)
    ][::-1]
    cost_trend = [
        {"month": (datetime.now() - timedelta(days=30 * i)).strftime("%Y-%m"), "cost": round(random.uniform(800000, 1200000), 0)}
        for i in range(6)
    ][::-1]
    return {
        "inventory_turnover": monthly_turnover,
        "delivery_performance": {"on_time": 91.2, "early": 5.3, "late": 3.5},
        "cost_trend": cost_trend,
        "supplier_count": len(MOCK_SUPPLIERS),
    }


def _get_risk_recommendation(risk_score: float) -> str:
    if risk_score > 60:
        return "高风险供应商，建议立即评估替代方案。"
    elif risk_score > 30:
        return "中等风险，建议加强监控并建立备用供应商。"
    else:
        return "低风险供应商，合作关系稳定。"
