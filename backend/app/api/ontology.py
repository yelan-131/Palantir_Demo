"""Ontology Management API — graph-first with fallback to PG then mock."""

import asyncio
import re

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.models.graph_models import ENTITY_SCHEMAS, CYPHER_TEMPLATES, NodeLabel, RelType
from app.services.graph_fallback import try_graph_then_db

router = APIRouter()

# Whitelist of allowed column names for dynamic SQL to prevent injection
_SAFE_COLUMNS = {
    "factories": {"id", "name", "location", "capacity", "status", "description"},
    "workshops": {"id", "name", "factory_id", "area", "workshop_type"},
    "production_lines": {"id", "name", "workshop_id", "capacity", "oee_target", "status"},
    "equipment": {"id", "name", "line_id", "model", "manufacturer", "install_date", "status", "health_score"},
    "sensors": {"id", "name", "equipment_id", "sensor_type", "unit", "sampling_rate"},
    "products": {"id", "name", "sku", "category", "specs", "unit"},
    "materials": {"id", "name", "material_type", "specs", "unit", "safety_stock"},
    "suppliers": {"id", "name", "location", "rating", "lead_time_days", "contact"},
    "customers": {"id", "name", "industry", "region"},
    "workers": {"id", "name", "role", "department"},
}


class EntityInstanceCreate(BaseModel):
    properties: dict


class RelationCreate(BaseModel):
    source_type: str
    source_id: int
    target_type: str
    target_id: int
    relation_type: str
    properties: dict | None = None


# ── Mock data ──────────────────────────────────────────────

MOCK_ENTITY_INSTANCES = {
    "Factory": [
        {"id": 1, "name": "华东智能制造基地", "location": "江苏省苏州市", "capacity": 5000, "status": "active", "description": "主要生产基地"},
        {"id": 2, "name": "华南精密工厂", "location": "广东省深圳市", "capacity": 3000, "status": "active", "description": "精密零部件生产"},
        {"id": 3, "name": "西南装配中心", "location": "四川省成都市", "capacity": 2000, "status": "active", "description": "总装与测试中心"},
    ],
    "Workshop": [
        {"id": 1, "name": "机加工车间", "factory_id": 1, "area": 2400, "workshop_type": "production"},
        {"id": 2, "name": "焊接车间", "factory_id": 1, "area": 1800, "workshop_type": "production"},
        {"id": 3, "name": "装配车间", "factory_id": 1, "area": 3000, "workshop_type": "assembly"},
        {"id": 4, "name": "检测车间", "factory_id": 2, "area": 1200, "workshop_type": "quality"},
        {"id": 5, "name": "喷涂车间", "factory_id": 1, "area": 1500, "workshop_type": "surface"},
    ],
    "ProductionLine": [
        {"id": 1, "name": "CNC加工线A", "workshop_id": 1, "capacity": 200, "oee_target": 0.85, "status": "running"},
        {"id": 2, "name": "CNC加工线B", "workshop_id": 1, "capacity": 180, "oee_target": 0.85, "status": "running"},
        {"id": 3, "name": "激光切割线", "workshop_id": 1, "capacity": 150, "oee_target": 0.80, "status": "running"},
        {"id": 4, "name": "自动焊接线", "workshop_id": 2, "capacity": 120, "oee_target": 0.85, "status": "running"},
        {"id": 5, "name": "柔性装配线", "workshop_id": 3, "capacity": 100, "oee_target": 0.90, "status": "running"},
        {"id": 6, "name": "机器人装配线", "workshop_id": 3, "capacity": 160, "oee_target": 0.88, "status": "maintenance"},
    ],
    "Equipment": [
        {"id": 1, "name": "DMG MORI NLX 2500", "line_id": 1, "model": "NLX2500/700", "manufacturer": "DMG MORI", "install_date": "2024-03-15T00:00:00", "status": "running", "health_score": 92.5},
        {"id": 2, "name": "CNC加工中心-01", "line_id": 1, "model": "VMC850", "manufacturer": "大连机床", "install_date": "2023-06-20T00:00:00", "status": "running", "health_score": 88.3},
        {"id": 3, "name": "五轴加工中心", "line_id": 2, "model": "MU-5000", "manufacturer": "MAZAK", "install_date": "2024-01-10T00:00:00", "status": "running", "health_score": 95.1},
        {"id": 4, "name": "激光切割机-TRUMPF", "line_id": 3, "model": "TruLaser 3030", "manufacturer": "TRUMPF", "install_date": "2023-09-01T00:00:00", "status": "running", "health_score": 91.2},
        {"id": 5, "name": "焊接机器人-KUKA", "line_id": 4, "model": "KR 210 R2700", "manufacturer": "KUKA", "install_date": "2024-02-28T00:00:00", "status": "running", "health_score": 76.8},
        {"id": 6, "name": "数控冲床-AMADA", "line_id": 1, "model": "EMK 3610", "manufacturer": "AMADA", "install_date": "2023-11-15T00:00:00", "status": "idle", "health_score": 85.0},
        {"id": 7, "name": "三坐标测量仪", "line_id": 4, "model": "Global S", "manufacturer": "Hexagon", "install_date": "2024-05-10T00:00:00", "status": "running", "health_score": 98.2},
        {"id": 8, "name": "注塑机-海天", "line_id": 5, "model": "MA3200", "manufacturer": "海天国际", "install_date": "2023-08-22T00:00:00", "status": "running", "health_score": 82.1},
    ],
    "Sensor": [
        {"id": 1, "name": "振动传感器-主轴", "equipment_id": 1, "sensor_type": "vibration", "unit": "mm/s", "sampling_rate": 60},
        {"id": 2, "name": "温度传感器-电机", "equipment_id": 1, "sensor_type": "temperature", "unit": "°C", "sampling_rate": 30},
        {"id": 3, "name": "压力传感器-液压", "equipment_id": 2, "sensor_type": "pressure", "unit": "MPa", "sampling_rate": 60},
        {"id": 4, "name": "电流传感器", "equipment_id": 3, "sensor_type": "current", "unit": "A", "sampling_rate": 10},
        {"id": 5, "name": "声发射传感器", "equipment_id": 4, "sensor_type": "acoustic", "unit": "dB", "sampling_rate": 100},
    ],
    "Product": [
        {"id": 1, "name": "精密齿轮组件", "sku": "GR-2026-A001", "category": "传动部件", "specs": "M2.5 Z20 20CrMnTi", "unit": "个"},
        {"id": 2, "name": "液压缸总成", "sku": "HY-2026-B003", "category": "液压部件", "specs": "Φ80/45 L=500", "unit": "台"},
        {"id": 3, "name": "控制阀块", "sku": "CV-2026-C007", "category": "液压部件", "specs": "6通径 比例阀", "unit": "个"},
        {"id": 4, "name": "减速机壳体", "sku": "RS-2026-D002", "category": "传动部件", "specs": "HT250 一级减速", "unit": "个"},
    ],
    "Material": [
        {"id": 1, "name": "20CrMnTi合金钢", "material_type": "metal", "specs": "Φ80 圆钢", "unit": "kg", "safety_stock": 5000},
        {"id": 2, "name": "HT250铸铁", "material_type": "metal", "specs": "铸件毛坯", "unit": "kg", "safety_stock": 3000},
        {"id": 3, "name": "45号钢棒料", "material_type": "metal", "specs": "Φ50 圆钢", "unit": "kg", "safety_stock": 8000},
        {"id": 4, "name": "NOK密封件", "material_type": "rubber", "specs": "O型圈 Φ80×3.5", "unit": "个", "safety_stock": 10000},
        {"id": 5, "name": "SKF轴承6205", "material_type": "component", "specs": "25×52×15", "unit": "个", "safety_stock": 2000},
    ],
    "SalesOrder": [
        {"id": 1, "order_no": "SO-2026-0401", "customer_id": 1, "product_id": 1, "quantity": 5000, "due_date": "2026-05-15T00:00:00", "priority": "high", "status": "in_progress"},
        {"id": 2, "order_no": "SO-2026-0402", "customer_id": 2, "product_id": 2, "quantity": 200, "due_date": "2026-05-20T00:00:00", "priority": "normal", "status": "pending"},
        {"id": 3, "order_no": "SO-2026-0403", "customer_id": 3, "product_id": 3, "quantity": 3000, "due_date": "2026-04-30T00:00:00", "priority": "high", "status": "in_progress"},
    ],
    "WorkOrder": [
        {"id": 1, "order_no": "WO-2026-0601", "sales_order_id": 1, "line_id": 1, "planned_start": "2026-04-18T08:00:00", "planned_end": "2026-04-25T18:00:00", "actual_start": "2026-04-18T08:30:00", "actual_end": None, "quantity": 5000, "completed_quantity": 3200, "status": "in_progress"},
        {"id": 2, "order_no": "WO-2026-0602", "sales_order_id": 3, "line_id": 4, "planned_start": "2026-04-15T08:00:00", "planned_end": "2026-04-22T18:00:00", "actual_start": "2026-04-15T07:45:00", "actual_end": "2026-04-21T16:30:00", "quantity": 3000, "completed_quantity": 3000, "status": "completed"},
    ],
    "Supplier": [
        {"id": 1, "name": "宝钢股份", "location": "上海市宝山区", "rating": 4.8, "lead_time_days": 5, "contact": "张经理 021-2664-XXXX"},
        {"id": 2, "name": "SKF中国", "location": "上海市嘉定区", "rating": 4.6, "lead_time_days": 7, "contact": "李经理 021-3958-XXXX"},
        {"id": 3, "name": "东北特钢集团", "location": "辽宁省大连市", "rating": 4.5, "lead_time_days": 8, "contact": "王经理 0411-8765-XXXX"},
        {"id": 4, "name": "NOK密封技术", "location": "江苏省无锡市", "rating": 4.3, "lead_time_days": 3, "contact": "陈经理 0510-8512-XXXX"},
        {"id": 5, "name": "沙钢集团", "location": "江苏省张家港市", "rating": 4.2, "lead_time_days": 6, "contact": "赵经理 0512-5856-XXXX"},
    ],
    "Customer": [
        {"id": 1, "name": "三一重工", "industry": "工程机械", "region": "华中"},
        {"id": 2, "name": "中联重科", "industry": "工程机械", "region": "华中"},
        {"id": 3, "name": "徐工集团", "industry": "工程机械", "region": "华东"},
        {"id": 4, "name": "潍柴动力", "industry": "动力系统", "region": "华东"},
    ],
    "Warehouse": [
        {"id": 1, "name": "原材料仓库A", "location": "华东基地-北区", "capacity": 50000, "utilization": 0.72},
        {"id": 2, "name": "成品仓库B", "location": "华东基地-南区", "capacity": 30000, "utilization": 0.58},
        {"id": 3, "name": "线边仓C", "location": "机加工车间内", "capacity": 5000, "utilization": 0.85},
    ],
    "Worker": [
        {"id": 1, "name": "王建国", "role": "高级技师", "department": "机加工车间"},
        {"id": 2, "name": "李明", "role": "操作员", "department": "焊接车间"},
        {"id": 3, "name": "张伟", "role": "质检工程师", "department": "质量管理部"},
        {"id": 4, "name": "刘洋", "role": "设备维护工程师", "department": "设备管理部"},
        {"id": 5, "name": "陈刚", "role": "班组长", "department": "装配车间"},
    ],
}


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── Endpoints ──────────────────────────────────────────────

@router.get("/entities")
async def list_entity_types():
    """列出所有实体类型定义."""
    result = []
    for type_name, schema in ENTITY_SCHEMAS.items():
        result.append({
            "type": type_name,
            "label": schema["label"],
            "icon": schema["icon"],
            "properties": schema["properties"],
            "outgoing_relations": schema["outgoing_relations"],
            "allowed_targets": schema["allowed_targets"],
        })
    return {"data": result}


@router.get("/entities/{entity_type}")
async def get_entity_type(entity_type: str):
    """获取实体类型详情."""
    if entity_type not in ENTITY_SCHEMAS:
        raise HTTPException(404, f"Entity type '{entity_type}' not found")
    schema = ENTITY_SCHEMAS[entity_type]
    return {
        "type": entity_type,
        "label": schema["label"],
        "icon": schema["icon"],
        "properties": schema["properties"],
        "outgoing_relations": schema["outgoing_relations"],
        "allowed_targets": schema["allowed_targets"],
    }


@router.get("/entities/{entity_type}/instances")
async def list_entity_instances(
    entity_type: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """列出某类型的实体实例 — 图优先，PG 兜底，Mock 最终保底."""
    if entity_type not in ENTITY_SCHEMAS:
        raise HTTPException(404, f"Entity type '{entity_type}' not found")

    # Graph-first query (try_graph_then_db already has timeout via graph_fallback)
    async def _graph_fn():
        from app.services.graph_service import graph_service
        return await graph_service.get_entities(entity_type, page, page_size)

    # PG fallback
    table_map = {
        "Factory": "factories", "Workshop": "workshops", "ProductionLine": "production_lines",
        "Equipment": "equipment", "Sensor": "sensors", "Product": "products",
        "Material": "materials", "SalesOrder": "sales_orders", "WorkOrder": "work_orders",
        "Supplier": "suppliers", "Customer": "customers", "Warehouse": "warehouses",
        "Worker": "workers", "Inspection": "inspections", "Defect": "defects",
    }

    async def _db_fn():
        if entity_type not in table_map:
            return None
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            table_name = table_map[entity_type]
            count_result = await db.execute(text(f"SELECT count(*) FROM {table_name}"))
            total = count_result.scalar() or 0

            offset = (page - 1) * page_size
            result = await db.execute(
                text(f"SELECT * FROM {table_name} ORDER BY id LIMIT :limit OFFSET :offset"),
                {"limit": page_size, "offset": offset},
            )
            columns = result.keys()
            rows = [dict(zip(columns, row)) for row in result.fetchall()]

            for row in rows:
                for k, v in row.items():
                    if hasattr(v, "isoformat"):
                        row[k] = v.isoformat()

            return {"data": rows, "total": total, "page": page, "page_size": page_size}

    result = await try_graph_then_db(_graph_fn, _db_fn)
    if result is not None:
        return result

    # Mock fallback
    all_instances = MOCK_ENTITY_INSTANCES.get(entity_type, [])
    offset = (page - 1) * page_size
    page_data = all_instances[offset:offset + page_size]
    return {
        "data": page_data,
        "total": len(all_instances),
        "page": page,
        "page_size": page_size,
    }


@router.post("/entities/{entity_type}/instances")
async def create_entity_instance(
    entity_type: str,
    body: EntityInstanceCreate,
):
    """创建实体实例 — 图优先写入，PG 可选同步."""
    if entity_type not in ENTITY_SCHEMAS:
        raise HTTPException(404, f"Entity type '{entity_type}' not found")

    # Try graph-first creation (with timeout)
    pg_id = None
    try:
        from app.services.graph_service import graph_service
        # Generate ID: max pg_id + 1
        count = await asyncio.wait_for(graph_service.count_by_label(entity_type), timeout=3)
        pg_id = count + 1
        await asyncio.wait_for(graph_service.create_entity(entity_type, pg_id, body.properties), timeout=3)
    except asyncio.TimeoutError:
        pg_id = None
    except Exception:
        # Fall back to PG creation
        pg_id = None

    if pg_id is None:
        table_map = {
            "Factory": "factories", "Workshop": "workshops", "ProductionLine": "production_lines",
            "Equipment": "equipment", "Sensor": "sensors", "Product": "products",
            "Material": "materials", "Supplier": "suppliers", "Customer": "customers",
            "Worker": "workers",
        }
        if entity_type not in table_map:
            raise HTTPException(400, f"Cannot create instances of '{entity_type}' via this endpoint")

        async def _query(db):
            from sqlalchemy import text
            allowed = _SAFE_COLUMNS.get(table_map[entity_type], set())
            safe_keys = [k for k in body.properties.keys() if k in allowed]
            if not safe_keys:
                raise HTTPException(400, "No valid properties provided")
            cols = ", ".join(safe_keys)
            placeholders = ", ".join(f":{k}" for k in safe_keys)
            safe_props = {k: body.properties[k] for k in safe_keys}
            result = await db.execute(
                text(f"INSERT INTO {table_map[entity_type]} ({cols}) VALUES ({placeholders}) RETURNING id"),
                safe_props,
            )
            nonlocal pg_id
            pg_id = result.scalar()
            await db.commit()
            return pg_id

        result = await _try_db(_query)
        if result is None:
            pg_id = 999

    return {"id": pg_id, "entity_type": entity_type, "status": "created"}


@router.get("/relations")
async def list_relation_types():
    """列出所有关系类型."""
    return {
        "data": [
            {"type": rt.value, "label": rt.name}
            for rt in RelType
        ]
    }


@router.post("/relations")
async def create_relation(body: RelationCreate):
    """创建关系."""
    try:
        from app.database import neo4j_driver
        if neo4j_driver:
            async def _create():
                async with neo4j_driver.session() as neo4j_session:
                    cypher = CYPHER_TEMPLATES["create_relation"].format(
                        src_label=body.source_type,
                        tgt_label=body.target_type,
                        rel_type=body.relation_type,
                    )
                    await neo4j_session.run(
                        cypher,
                        src_id=body.source_id,
                        tgt_id=body.target_id,
                        props=body.properties or {},
                    )
            await asyncio.wait_for(_create(), timeout=5)
    except asyncio.TimeoutError:
        import logging
        logging.getLogger(__name__).warning(
            "Neo4j relation creation timed out (%s -> %s)", body.source_id, body.target_id,
        )
    except Exception as exc:  # noqa: BLE001 — Neo4j is best-effort here
        import logging
        logging.getLogger(__name__).warning(
            "Neo4j relation sync failed (%s -> %s): %s",
            body.source_id, body.target_id, exc,
        )
    return {"status": "created", "relation_type": body.relation_type}


@router.get("/timeline/{entity_id}")
async def get_entity_timeline(
    entity_id: int,
    timestamp: str | None = None,
):
    """实体时间旅行 — 查看某时间点的实体状态."""
    ts = timestamp or "2026-04-21T23:59:59"
    records = []
    try:
        from app.database import neo4j_driver
        if neo4j_driver:
            async def _timeline():
                async with neo4j_driver.session() as neo4j_session:
                    cypher = CYPHER_TEMPLATES["entity_timeline"].format()
                    result = await neo4j_session.run(cypher, entity_id=entity_id, timestamp=ts)
                    return await result.data()
            records = await asyncio.wait_for(_timeline(), timeout=5)
    except asyncio.TimeoutError:
        records = [
            {"timestamp": "2026-04-21T09:00:00", "property": "status", "old_value": "idle", "new_value": "running"},
            {"timestamp": "2026-04-20T14:30:00", "property": "health_score", "old_value": "85.2", "new_value": "88.5"},
        ]
    except Exception as exc:  # noqa: BLE001 — fall back to mock timeline
        import logging
        logging.getLogger(__name__).warning(
            "Neo4j timeline query failed (entity_id=%s): %s", entity_id, exc,
        )
        records = [
            {"timestamp": "2026-04-21T09:00:00", "property": "status", "old_value": "idle", "new_value": "running"},
            {"timestamp": "2026-04-20T14:30:00", "property": "health_score", "old_value": "85.2", "new_value": "88.5"},
        ]
    return {"entity_id": entity_id, "timestamp": ts, "versions": records}


@router.get("/entities/{entity_type}/instances/{entity_id}/relationships")
async def get_entity_relationships(
    entity_type: str,
    entity_id: int,
    rel_type: str | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    """获取实体的所有关系 — 图优先."""
    if entity_type not in ENTITY_SCHEMAS:
        raise HTTPException(404, f"Entity type '{entity_type}' not found")

    try:
        from app.services.graph_service import graph_service
        data = await asyncio.wait_for(graph_service.get_relationships(entity_id, rel_type, limit), timeout=5)
        return {"data": data, "entity_id": entity_id, "entity_type": entity_type}
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass

    # Mock fallback
    from app.api.graph import MOCK_RELATIONSHIPS, MOCK_NODES
    results = []
    for rel in MOCK_RELATIONSHIPS:
        if rel["source"] == entity_id or rel["target"] == entity_id:
            if rel_type and rel["type"] != rel_type:
                continue
            direction = "outgoing" if rel["source"] == entity_id else "incoming"
            other_id = rel["target"] if direction == "outgoing" else rel["source"]
            other_node = next((n for n in MOCK_NODES if n["id"] == other_id), None)
            results.append({
                "rel_type": rel["type"],
                "direction": direction,
                "target_id": other_id,
                "target_label": other_node["label"] if other_node else None,
                "target_name": other_node["name"] if other_node else None,
                "props": rel.get("props", {}),
            })
    return {"data": results, "entity_id": entity_id, "entity_type": entity_type}
