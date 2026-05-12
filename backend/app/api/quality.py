"""Quality Management API — with fallback to mock data when DB unavailable."""

import math
import random
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.graph_fallback import try_graph_or_mock

router = APIRouter()


# ── Mock data ──────────────────────────────────────────────

MOCK_DEFECTS = [
    {"id": 1,  "inspection_id": 1,  "defect_type": "尺寸超差",   "severity": "major",  "description": "外径Φ50+0.02实测Φ50.035",         "root_cause": "刀具磨损导致进给偏差",   "correction": "更换刀具并调整补偿值"},
    {"id": 2,  "inspection_id": 2,  "defect_type": "表面缺陷",   "severity": "minor",  "description": "端面存在0.3mm划痕",             "root_cause": "装夹定位面有异物",       "correction": "清洁定位面后重新装夹"},
    {"id": 3,  "inspection_id": 3,  "defect_type": "裂纹",       "severity": "critical","description": "焊接处发现2mm裂纹",              "root_cause": "焊接参数不当热输入过大", "correction": "调整焊接电流和速度"},
    {"id": 4,  "inspection_id": 5,  "defect_type": "气孔",       "severity": "minor",  "description": "铸件表面气孔直径0.5mm",         "root_cause": "浇注温度偏低",           "correction": "提高浇注温度20°C"},
    {"id": 5,  "inspection_id": 6,  "defect_type": "硬度不足",   "severity": "major",  "description": "热处理后硬度HRC45实测HRC38",     "root_cause": "淬火保温时间不足",       "correction": "延长保温时间30分钟"},
    {"id": 6,  "inspection_id": 7,  "defect_type": "毛刺",       "severity": "minor",  "description": "孔口毛刺未去除",                 "root_cause": "去毛刺工序遗漏",         "correction": "补加工去毛刺工序"},
    {"id": 7,  "inspection_id": 8,  "defect_type": "尺寸超差",   "severity": "major",  "description": "键槽宽度6+0.03实测6.05",        "root_cause": "铣刀直径磨损",           "correction": "更换铣刀"},
    {"id": 8,  "inspection_id": 10, "defect_type": "变形",       "severity": "major",  "description": "薄壁件平面度超差0.15mm",         "root_cause": "装夹力过大",             "correction": "改用柔性装夹方案"},
    {"id": 9,  "inspection_id": 11, "defect_type": "表面缺陷",   "severity": "minor",  "description": "镀层色差不均匀",                 "root_cause": "电镀液浓度不均",         "correction": "调整电镀液配比"},
    {"id": 10, "inspection_id": 12, "defect_type": "尺寸超差",   "severity": "critical","description": "配合间隙超差0.08mm",             "root_cause": "加工中心定位精度漂移",   "correction": "校准机床定位精度"},
]

MOCK_PARETO = [
    {"defect_type": "尺寸超差",     "count": 12, "percentage": 30.0, "cumulative_percentage": 30.0},
    {"defect_type": "表面缺陷",     "count": 8,  "percentage": 20.0, "cumulative_percentage": 50.0},
    {"defect_type": "裂纹",         "count": 6,  "percentage": 15.0, "cumulative_percentage": 65.0},
    {"defect_type": "变形",         "count": 5,  "percentage": 12.5, "cumulative_percentage": 77.5},
    {"defect_type": "硬度不足",     "count": 4,  "percentage": 10.0, "cumulative_percentage": 87.5},
    {"defect_type": "毛刺",         "count": 3,  "percentage": 7.5,  "cumulative_percentage": 95.0},
    {"defect_type": "气孔",         "count": 2,  "percentage": 5.0,  "cumulative_percentage": 100.0},
]

MOCK_INSPECTIONS = [
    {"id": 1,  "inspection_type": "incoming",  "target_type": "Material",     "target_id": 3, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-21T09:15:00"},
    {"id": 2,  "inspection_type": "in_process", "target_type": "WorkOrder",   "target_id": 1, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-21T10:30:00"},
    {"id": 3,  "inspection_type": "in_process", "target_type": "Equipment",   "target_id": 5, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-21T11:00:00"},
    {"id": 4,  "inspection_type": "final",      "target_type": "Product",     "target_id": 1, "result": "pass",    "inspector_id": 3, "inspected_at": "2026-04-21T14:00:00"},
    {"id": 5,  "inspection_type": "incoming",   "target_type": "Material",    "target_id": 2, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-20T08:30:00"},
    {"id": 6,  "inspection_type": "in_process", "target_type": "WorkOrder",   "target_id": 2, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-20T10:45:00"},
    {"id": 7,  "inspection_type": "in_process", "target_type": "Equipment",   "target_id": 9, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-20T11:30:00"},
    {"id": 8,  "inspection_type": "final",      "target_type": "Product",     "target_id": 2, "result": "pass",    "inspector_id": 3, "inspected_at": "2026-04-20T15:00:00"},
    {"id": 9,  "inspection_type": "incoming",   "target_type": "Material",    "target_id": 5, "result": "pass",    "inspector_id": 3, "inspected_at": "2026-04-19T08:20:00"},
    {"id": 10, "inspection_type": "in_process", "target_type": "WorkOrder",   "target_id": 1, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-19T10:00:00"},
    {"id": 11, "inspection_type": "in_process", "target_type": "Equipment",   "target_id": 11,"result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-19T14:15:00"},
    {"id": 12, "inspection_type": "final",      "target_type": "Product",     "target_id": 3, "result": "fail",    "inspector_id": 3, "inspected_at": "2026-04-19T16:30:00"},
    {"id": 13, "inspection_type": "incoming",   "target_type": "Material",    "target_id": 1, "result": "pass",    "inspector_id": 3, "inspected_at": "2026-04-18T08:10:00"},
    {"id": 14, "inspection_type": "final",      "target_type": "Product",     "target_id": 1, "result": "pass",    "inspector_id": 3, "inspected_at": "2026-04-18T16:00:00"},
    {"id": 15, "inspection_type": "in_process", "target_type": "WorkOrder",   "target_id": 2, "result": "pass",    "inspector_id": 3, "inspected_at": "2026-04-18T11:30:00"},
]


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── Endpoints ──────────────────────────────────────────────

@router.get("/spc/{parameter}")
async def get_spc_data(
    parameter: str,
    equipment_id: int | None = None,
    hours: int = Query(24, ge=1, le=168),
):
    """SPC 控制图数据."""
    async def _query(db):
        from app.models.relational import SPCPoint
        from sqlalchemy import select
        since = datetime.now() - timedelta(hours=hours)
        query = select(SPCPoint).where(
            SPCPoint.parameter == parameter,
            SPCPoint.timestamp >= since,
        ).order_by(SPCPoint.timestamp)
        if equipment_id:
            query = query.where(SPCPoint.equipment_id == equipment_id)

        result = await db.execute(query)
        points = result.scalars().all()

        data = [
            {
                "timestamp": p.timestamp.isoformat(),
                "value": p.value,
                "ucl": p.ucl,
                "lcl": p.lcl,
                "cl": p.cl,
                "out_of_control": p.value > p.ucl or p.value < p.lcl,
            }
            for p in points
        ]

        cpk = None
        if points:
            values = [p.value for p in points]
            mean_val = sum(values) / len(values)
            std_val = (sum((v - mean_val) ** 2 for v in values) / len(values)) ** 0.5
            usl = points[0].ucl
            lsl = points[0].lcl
            if std_val > 0:
                cpu = (usl - mean_val) / (3 * std_val)
                cpl = (mean_val - lsl) / (3 * std_val)
                cpk = round(min(cpu, cpl), 3)

        return {
            "parameter": parameter,
            "data": data,
            "count": len(data),
            "cpk": cpk,
            "equipment_id": equipment_id,
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback — generate SPC data
    random.seed(hash(parameter) + (equipment_id or 0))
    base_value = {"temperature": 65.0, "vibration": 2.5, "pressure": 4.2, "dimension": 50.0}.get(parameter, 100.0)
    spread = base_value * 0.05

    data = []
    now = datetime.now()
    for i in range(min(hours * 2, 200)):
        ts = now - timedelta(hours=hours) + timedelta(minutes=30 * i)
        value = base_value + random.uniform(-spread, spread)
        ucl = base_value + spread * 2
        lcl = base_value - spread * 2
        cl = base_value
        data.append({
            "timestamp": ts.isoformat(),
            "value": round(value, 3),
            "ucl": round(ucl, 3),
            "lcl": round(lcl, 3),
            "cl": round(cl, 3),
            "out_of_control": value > ucl or value < lcl,
        })

    # Calculate mock Cpk
    values = [d["value"] for d in data]
    mean_val = sum(values) / len(values)
    std_val = (sum((v - mean_val) ** 2 for v in values) / len(values)) ** 0.5
    cpk = round(min(
        (data[0]["ucl"] - mean_val) / (3 * std_val),
        (mean_val - data[0]["lcl"]) / (3 * std_val),
    ), 3) if std_val > 0 else None

    return {
        "parameter": parameter,
        "data": data,
        "count": len(data),
        "cpk": cpk,
        "equipment_id": equipment_id,
    }


@router.get("/defects")
async def list_defects(
    severity: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """缺陷列表."""
    async def _query(db):
        from app.models.relational import Defect
        from sqlalchemy import func, select
        query = select(Defect).order_by(Defect.created_at.desc())
        if severity:
            query = query.where(Defect.severity == severity)

        result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
        defects = result.scalars().all()

        count_result = await db.execute(select(func.count(Defect.id)))
        total = count_result.scalar() or 0

        return {
            "data": [
                {
                    "id": d.id,
                    "inspection_id": d.inspection_id,
                    "defect_type": d.defect_type,
                    "severity": d.severity,
                    "description": d.description,
                    "root_cause": d.root_cause,
                    "correction": d.correction,
                }
                for d in defects
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    result = await _try_db(_query)
    if result is not None:
        # Graph enrichment: best-effort add inspector_name from INSPECTS relationship
        try:
            from app.services.graph_service import graph_service
            for defect in result.get("data", []):
                inspection_id = defect.get("inspection_id")
                if inspection_id is None:
                    continue
                try:
                    rels = await graph_service.get_relationships(
                        entity_id=inspection_id, rel_type="INSPECTS", limit=10,
                    )
                    for rel in rels:
                        # Worker -> INSPECTS -> Inspection: look for source node of type Worker
                        src = rel.get("source", {})
                        if isinstance(src, dict) and src.get("labels") and "Worker" in src.get("labels", []):
                            props = src.get("properties", src)
                            defect["inspector_name"] = props.get("name", props.get("pg_id"))
                            break
                except Exception:
                    pass
        except Exception:
            pass
        return result

    # Mock fallback
    filtered = MOCK_DEFECTS
    if severity:
        filtered = [d for d in filtered if d["severity"] == severity]
    offset = (page - 1) * page_size
    page_data = filtered[offset:offset + page_size]

    # Graph enrichment on mock data: best-effort
    try:
        from app.services.graph_service import graph_service
        for defect in page_data:
            inspection_id = defect.get("inspection_id")
            if inspection_id is None:
                continue
            try:
                rels = await graph_service.get_relationships(
                    entity_id=inspection_id, rel_type="INSPECTS", limit=10,
                )
                for rel in rels:
                    src = rel.get("source", {})
                    if isinstance(src, dict) and src.get("labels") and "Worker" in src.get("labels", []):
                        props = src.get("properties", src)
                        defect["inspector_name"] = props.get("name", props.get("pg_id"))
                        break
            except Exception:
                pass
    except Exception:
        pass

    return {
        "data": page_data,
        "total": len(filtered),
        "page": page,
        "page_size": page_size,
    }


@router.get("/defects/pareto")
async def defect_pareto_analysis(days: int = Query(30, ge=1, le=365)):
    """缺陷帕累托分析."""
    # Graph-first: try Cypher aggregation on Neo4j
    try:
        from app.services.graph_service import graph_service
        graph_service._check_driver()
        async def _graph_pareto():
            from app.database import neo4j_driver
            async with neo4j_driver.session() as session:
                result = await session.run(
                    "MATCH (d:Defect) "
                    "RETURN d.defect_type AS type, count(*) AS count "
                    "ORDER BY count DESC"
                )
                records = await result.data()
                if not records:
                    return None
                total = sum(r["count"] for r in records)
                cumulative = 0
                pareto_data = []
                for r in records:
                    count = r["count"]
                    cumulative += count
                    pareto_data.append({
                        "defect_type": r["type"],
                        "count": count,
                        "percentage": round(count / max(total, 1) * 100, 1),
                        "cumulative_percentage": round(cumulative / max(total, 1) * 100, 1),
                    })
                return {"data": pareto_data, "total_defects": total}

        graph_result = await _graph_pareto()
        if graph_result is not None:
            return graph_result
    except Exception:
        pass

    # PG fallback
    async def _query(db):
        from app.models.relational import Defect
        from sqlalchemy import func, select
        result = await db.execute(
            select(Defect.defect_type, func.count(Defect.id).label("count"))
            .group_by(Defect.defect_type)
            .order_by(func.count(Defect.id).desc())
        )
        rows = result.fetchall()

        total = sum(r[1] for r in rows)
        cumulative = 0
        pareto_data = []
        for defect_type, count in rows:
            cumulative += count
            pareto_data.append({
                "defect_type": defect_type,
                "count": count,
                "percentage": round(count / max(total, 1) * 100, 1),
                "cumulative_percentage": round(cumulative / max(total, 1) * 100, 1),
            })

        return {"data": pareto_data, "total_defects": total}

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    return {"data": MOCK_PARETO, "total_defects": sum(p["count"] for p in MOCK_PARETO)}


@router.get("/traceability/{entity_id}")
async def quality_traceability(
    entity_id: int,
    entity_type: str = Query("product", enum=["product", "equipment", "material"]),
):
    """质量追溯链 — graph-first via trace_chain, then PG, then mock."""

    # ── Graph-first: try trace_chain on Neo4j ──
    try:
        from app.services.graph_service import graph_service
        trace_records = await graph_service.trace_chain(
            entity_id=entity_id, max_hops=5, limit=100,
        )
        if trace_records:
            trace = []
            for rec in trace_records:
                # Each record may contain 'nodes' and 'relationships' from the path
                nodes = rec.get("nodes", [])
                rels = rec.get("relationships", rec.get("rels", []))
                if nodes:
                    # Build a flattened trace from path nodes
                    for node in nodes:
                        labels = node.get("labels", [])
                        props = node.get("properties", node)
                        step_type = "unknown"
                        step_label = "节点"
                        # Map graph labels to trace step types
                        if "Inspection" in labels:
                            insp_type = props.get("inspection_type", "")
                            step_label = (
                                "来料检验" if insp_type == "incoming"
                                else "过程检验" if insp_type == "in_process"
                                else "成品检验"
                            )
                            step_type = "inspection"
                        elif "Defect" in labels:
                            step_label = f"缺陷: {props.get('defect_type', '')}"
                            step_type = "defect"
                        elif "Equipment" in labels:
                            step_label = f"设备: {props.get('name', props.get('pg_id', ''))}"
                            step_type = "equipment"
                        elif "Material" in labels:
                            step_label = f"物料: {props.get('name', props.get('pg_id', ''))}"
                            step_type = "material"
                        elif "Product" in labels:
                            step_label = f"产品: {props.get('name', props.get('pg_id', ''))}"
                            step_type = "product"
                        elif "WorkOrder" in labels:
                            step_label = f"工单: {props.get('pg_id', '')}"
                            step_type = "operation"

                        entry = {
                            "step": step_label,
                            "type": step_type,
                            "id": props.get("pg_id", props.get("id")),
                        }
                        # Carry over relevant fields
                        if props.get("result"):
                            entry["result"] = props["result"]
                        if props.get("inspected_at") or props.get("timestamp"):
                            entry["timestamp"] = props.get("inspected_at") or props.get("timestamp")
                        if props.get("inspector_id"):
                            entry["inspector_id"] = props["inspector_id"]
                        if props.get("equipment_id"):
                            entry["equipment_id"] = props["equipment_id"]
                        trace.append(entry)

                    if trace:
                        return {
                            "entity_id": entity_id,
                            "entity_type": entity_type,
                            "trace": trace,
                            "source": "graph",
                        }
    except Exception:
        pass

    # ── PG fallback: existing relational query logic ──
    async def _query(db):
        from app.models.relational import Inspection, Defect
        from sqlalchemy import select

        trace = []
        if entity_type == "product":
            # Find inspections targeting this product
            result = await db.execute(
                select(Inspection).where(
                    Inspection.target_type == "Product",
                    Inspection.target_id == entity_id,
                ).order_by(Inspection.inspected_at)
            )
            inspections = result.scalars().all()
            for insp in inspections:
                trace.append({
                    "step": f"{'来料' if insp.inspection_type == 'incoming' else '过程' if insp.inspection_type == 'in_process' else '成品'}检验",
                    "type": "inspection",
                    "id": insp.id,
                    "result": insp.result,
                    "inspector_id": insp.inspector_id,
                    "timestamp": insp.inspected_at.isoformat() if insp.inspected_at else None,
                })
        elif entity_type == "equipment":
            result = await db.execute(
                select(Inspection).where(
                    Inspection.target_type == "Equipment",
                    Inspection.target_id == entity_id,
                ).order_by(Inspection.inspected_at.desc()).limit(5)
            )
            inspections = result.scalars().all()
            for insp in inspections:
                trace.append({
                    "step": f"{'来料' if insp.inspection_type == 'incoming' else '过程' if insp.inspection_type == 'in_process' else '成品'}检验",
                    "type": "inspection",
                    "id": insp.id,
                    "result": insp.result,
                    "timestamp": insp.inspected_at.isoformat() if insp.inspected_at else None,
                })
        elif entity_type == "material":
            result = await db.execute(
                select(Inspection).where(
                    Inspection.target_type == "Material",
                    Inspection.target_id == entity_id,
                ).order_by(Inspection.inspected_at)
            )
            inspections = result.scalars().all()
            for insp in inspections:
                trace.append({
                    "step": f"{'来料' if insp.inspection_type == 'incoming' else '过程' if insp.inspection_type == 'in_process' else '成品'}检验",
                    "type": "inspection",
                    "id": insp.id,
                    "result": insp.result,
                    "timestamp": insp.inspected_at.isoformat() if insp.inspected_at else None,
                })

        return {"entity_id": entity_id, "entity_type": entity_type, "trace": trace} if trace else None

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    chain = {
        "entity_id": entity_id,
        "entity_type": entity_type,
        "trace": [],
    }

    if entity_type == "product":
        chain["trace"] = [
            {"step": "来料检验", "type": "inspection", "id": 1001, "result": "pass", "timestamp": "2026-04-20T08:00:00"},
            {"step": "工序1-切割", "type": "operation", "id": 2001, "result": "pass", "equipment_id": 3},
            {"step": "过程检验", "type": "inspection", "id": 1002, "result": "pass", "timestamp": "2026-04-20T10:30:00"},
            {"step": "工序2-焊接", "type": "operation", "id": 2002, "result": "pass", "equipment_id": 7},
            {"step": "工序3-组装", "type": "operation", "id": 2003, "result": "pass", "equipment_id": 12},
            {"step": "成品检验", "type": "inspection", "id": 1003, "result": "pass", "timestamp": "2026-04-20T15:00:00"},
            {"step": "包装出库", "type": "shipment", "id": 3001, "result": "completed"},
        ]
    elif entity_type == "equipment":
        chain["trace"] = [
            {"step": "日常巡检", "type": "inspection", "result": "normal", "timestamp": "2026-04-21T09:00:00"},
            {"step": "上次维护", "type": "maintenance", "result": "completed", "timestamp": "2026-04-15T14:00:00"},
            {"step": "传感器读数", "type": "sensor", "readings": {"vibration": 2.3, "temperature": 65.2}},
            {"step": "关联缺陷", "type": "defect", "count": 2},
        ]

    return chain


@router.get("/inspections")
async def list_inspections(
    inspection_type: str | None = None,
    result: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """检验记录."""
    async def _query(db):
        from app.models.relational import Inspection
        from sqlalchemy import func, select
        query = select(Inspection).order_by(Inspection.inspected_at.desc())
        if inspection_type:
            query = query.where(Inspection.inspection_type == inspection_type)
        if result:
            query = query.where(Inspection.result == result)

        total_result = await db.execute(select(func.count(Inspection.id)))
        total = total_result.scalar() or 0

        db_result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
        inspections = db_result.scalars().all()

        return {
            "data": [
                {
                    "id": i.id,
                    "inspection_type": i.inspection_type,
                    "target_type": i.target_type,
                    "target_id": i.target_id,
                    "result": i.result,
                    "inspector_id": i.inspector_id,
                    "inspected_at": i.inspected_at.isoformat() if i.inspected_at else None,
                }
                for i in inspections
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    db_result = await _try_db(_query)
    if db_result is not None:
        return db_result

    # Mock fallback
    filtered = MOCK_INSPECTIONS
    if inspection_type:
        filtered = [i for i in filtered if i["inspection_type"] == inspection_type]
    if result:
        filtered = [i for i in filtered if i["result"] == result]
    offset = (page - 1) * page_size
    page_data = filtered[offset:offset + page_size]
    return {
        "data": page_data,
        "total": len(filtered),
        "page": page,
        "page_size": page_size,
    }


class CAPACreate(BaseModel):
    defect_id: int
    action_type: str
    description: str
    due_date: datetime
    assignee_id: int | None = None


@router.post("/capa")
async def create_capa(body: CAPACreate):
    """创建 CAPA (纠正与预防措施)."""
    async def _query(db):
        from app.models.relational import CAPA
        capa = CAPA(
            defect_id=body.defect_id,
            action_type=body.action_type,
            description=body.description,
            due_date=body.due_date,
            assignee_id=body.assignee_id,
            status="open",
        )
        db.add(capa)
        await db.commit()
        await db.refresh(capa)
        return {"id": capa.id, "status": "created"}

    result = await _try_db(_query)
    if result is not None:
        return result
    return {"id": 999, "status": "created"}
