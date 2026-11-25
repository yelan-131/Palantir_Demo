"""Graph APIs for knowledge assets, quality impact, and analysis tools."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.api.deps import get_current_user
from app.core.logging import get_logger
from app.core.production_errors import graph_unavailable, seed_data_required

logger = get_logger(__name__)
router = APIRouter(dependencies=[Depends(get_current_user)])


def _neo4j_query_timeout(default_seconds: float) -> float:
    """Keep demo-mode graph fallbacks responsive when Neo4j is unavailable."""
    if settings.IS_PRODUCTION:
        return default_seconds
    return min(default_seconds, 0.8)

QUALITY_BUSINESS_ID_MAP = {
    "event-qe-001": "quality-event-qe-20260521-001",
    "defect-001": "defect-001",
    "inspection-iqc-088": "inspection-batch-ipqc-260521-088",
    "material-batch-mb-7781": "material-batch-mb-7781",
    "supplier-s-023": "supplier-s-023",
    "workorder-260521-017": "workorder-260521-017",
    "equipment-smt-03": "equipment-smt-03",
    "order-so-8821": "customer-order-so-8821",
    "capa-072": "capa-072",
    "operation-reflow-01": "operation-reflow-01",
    "product-batch-pb-260521-a": "product-batch-pb-260521-a",
    "inventory-lot-inv-7781-a": "inventory-lot-inv-7781-a",
    "inspection-recheck-091": "inspection-batch-recheck-260521-091",
    "sensor-reflow-temp-05": "sensor-reflow-temp-05",
    "ts-window-reflow-temp-260521-0930": "ts-window-reflow-temp-260521-0930",
}

QUALITY_EDGE_REL_MAP = {
    "r1": ("HAS_DEFECT", "event-qe-001", "defect-001"),
    "r2": ("FOUND_IN", "defect-001", "inspection-iqc-088"),
    "r3": ("INSPECTS", "inspection-iqc-088", "material-batch-mb-7781"),
    "r4": ("SUPPLIED_BY", "material-batch-mb-7781", "supplier-s-023"),
    "r5": ("USES_BATCH", "workorder-260521-017", "material-batch-mb-7781"),
    "r6": ("USES_EQUIPMENT", "workorder-260521-017", "equipment-smt-03"),
    "r7": ("AFFECTS_ORDER", "workorder-260521-017", "order-so-8821"),
    "r8": ("TRIGGERS", "event-qe-001", "capa-072"),
    "r9": ("RUNS_OPERATION", "workorder-260521-017", "operation-reflow-01"),
    "r10": ("USES_EQUIPMENT", "operation-reflow-01", "equipment-smt-03"),
    "r11": ("MAY_CAUSE", "operation-reflow-01", "defect-001"),
    "r12": ("PRODUCES_BATCH", "workorder-260521-017", "product-batch-pb-260521-a"),
    "r13": ("AFFECTS_ORDER", "product-batch-pb-260521-a", "order-so-8821"),
    "r14": ("STORED_AS", "material-batch-mb-7781", "inventory-lot-inv-7781-a"),
    "r15": ("REINSPECTS", "capa-072", "inspection-recheck-091"),
    "r16": ("REINSPECTS", "inspection-recheck-091", "product-batch-pb-260521-a"),
    "r17": ("MEASURED_BY", "equipment-smt-03", "sensor-reflow-temp-05"),
    "r18": ("HAS_TS_ANOMALY", "sensor-reflow-temp-05", "ts-window-reflow-temp-260521-0930"),
    "r19": ("CORRELATES_WITH", "ts-window-reflow-temp-260521-0930", "operation-reflow-01"),
    "r20": ("CORRELATES_WITH", "ts-window-reflow-temp-260521-0930", "defect-001"),
}


def normalize_quality_event_graph_id(event_id: str) -> str:
    return f"quality-event-{event_id.lower()}"


def _quality_graph_fallback(event_id: str | None = None, source: str = "backend-demo") -> dict:
    from app.api.quality import QUALITY_EVENT_DEMO

    event = next((item for item in QUALITY_EVENT_DEMO["events"] if item["id"] == event_id), None)
    if event is None:
        event = QUALITY_EVENT_DEMO["events"][0]
    return {
        "event": event,
        "root": QUALITY_EVENT_DEMO["nodes"][0],
        "nodes": QUALITY_EVENT_DEMO["nodes"],
        "edges": QUALITY_EVENT_DEMO["edges"],
        "summary": {
            "node_count": len(QUALITY_EVENT_DEMO["nodes"]),
            "edge_count": len(QUALITY_EVENT_DEMO["edges"]),
            "affected": event.get("affected", {}),
            "risk_score": event.get("risk_score"),
        },
        "source": source,
    }


def _business_node_from_quality_node(node: dict, event_id: str) -> dict:
    business_id = QUALITY_BUSINESS_ID_MAP.get(node["id"], node["id"])
    source_id = node["name"]
    if node["type"] == "QualityEvent":
        business_id = normalize_quality_event_graph_id(event_id)
        source_id = event_id
    return {
        **node,
        "id": business_id,
        "object_id": business_id,
        "source_id": source_id,
        "source_system": "quality-demo",
        "updated_at": "2026-05-22T00:00:00",
    }


def _frontend_node_from_graph_node(node: dict) -> dict:
    return {
        "id": node.get("id") or node.get("object_id"),
        "label": node.get("label") or node.get("type") or "对象",
        "type": node.get("type") or (node.get("labels") or ["Object"])[0],
        "name": node.get("name") or node.get("source_id") or node.get("id"),
        "status": node.get("status") or "unknown",
        "risk": node.get("risk") or "medium",
        "summary": node.get("summary") or "",
        "actions": node.get("actions") or [],
        "source_id": node.get("source_id"),
        "source_system": node.get("source_system"),
        "occurred_at": node.get("occurred_at"),
    }


def _frontend_edge_from_graph_edge(edge: dict, index: int) -> dict:
    return {
        "id": edge.get("id") or f"graph-r{index + 1}",
        "source": edge.get("source"),
        "target": edge.get("target"),
        "label": edge.get("label") or edge.get("relation_label") or edge.get("type") or edge.get("relation_type"),
        "relation_type": edge.get("relation_type") or edge.get("type"),
        "occurred_at": edge.get("occurred_at"),
    }


def quality_graph_payload_from_result(event_id: str, result: dict, source: str = "graph") -> dict:
    from app.api.quality import QUALITY_EVENT_DEMO

    event = next((item for item in QUALITY_EVENT_DEMO["events"] if item["id"] == event_id), None)
    nodes = [_frontend_node_from_graph_node(node) for node in (result.get("nodes") or [])]
    edges = [_frontend_edge_from_graph_edge(edge, index) for index, edge in enumerate(result.get("edges") or [])]
    if not nodes:
        raise seed_data_required("Quality graph seed data is required")
    return {
        "event": event or QUALITY_EVENT_DEMO["events"][0],
        "root": _frontend_node_from_graph_node(result.get("root") or result["nodes"][0]),
        "nodes": nodes,
        "edges": edges,
        "summary": result.get("summary") or {"node_count": len(nodes), "edge_count": len(edges)},
        "source": source,
    }

# Demo data used by the ontology relationship API.

MOCK_NODES = [
    {"id": 1,  "label": "Factory",        "name": "华东制造基地",       "props": {"location": "上海市松江区", "area": 45000}},
    {"id": 2,  "label": "Workshop",        "name": "精密加工车间",       "props": {"workshop_type": "machining"}},
    {"id": 3,  "label": "ProductionLine",  "name": "齿轮产线-A",        "props": {"status": "running", "capacity": 500}},
    {"id": 4,  "label": "Equipment",       "name": "DMG MORI NLX 2500", "props": {"status": "running", "health_score": 92.5}},
    {"id": 5,  "label": "Equipment",       "name": "焊接机器人-KUKA",   "props": {"status": "running", "health_score": 76.8}},
    {"id": 6,  "label": "Sensor",          "name": "温度传感器-T01",    "props": {"sensor_type": "temperature", "unit": "℃"}},
    {"id": 7,  "label": "Product",         "name": "精密齿轮组件-GA01", "props": {"spec": "M2.5 Z20", "sku": "GA01"}},
    {"id": 8,  "label": "Material",        "name": "20CrMnTi合金钢",   "props": {"grade": "20CrMnTi", "stock": 12000}},
    {"id": 9,  "label": "Supplier",        "name": "宝钢股份",         "props": {"rating": 4.8, "location": "上海市宝山区"}},
    {"id": 10, "label": "Customer",        "name": "博世汽车",         "props": {"industry": "汽车零部件", "region": "华东"}},
    {"id": 11, "label": "Worker",          "name": "张师傅",           "props": {"role": "维修工", "department": "设备部"}},
    {"id": 12, "label": "SalesOrder",      "name": "SO-2026-0401",    "props": {"status": "in_progress", "quantity": 500}},
    {"id": 13, "label": "WorkOrder",       "name": "WO-2026-0401",    "props": {"status": "in_progress", "quantity": 200}},
    {"id": 14, "label": "Inspection",      "name": "来料检-IQC-20260421", "props": {"result": "pass", "inspection_type": "incoming"}},
    {"id": 15, "label": "Defect",          "name": "表面划伤-001",     "props": {"defect_type": "表面划伤", "severity": "major"}},
]

MOCK_RELATIONSHIPS = [
    # CONTAINS (hierarchy)
    {"source": 1,  "target": 2,  "type": "CONTAINS",   "props": {}},
    {"source": 2,  "target": 3,  "type": "CONTAINS",   "props": {}},
    {"source": 3,  "target": 4,  "type": "CONTAINS",   "props": {}},
    {"source": 3,  "target": 5,  "type": "CONTAINS",   "props": {}},
    # FEEDS
    {"source": 4,  "target": 6,  "type": "FEEDS",      "props": {}},
    # PRODUCES
    {"source": 3,  "target": 7,  "type": "PRODUCES",   "props": {}},
    {"source": 12, "target": 7,  "type": "PRODUCES",   "props": {"quantity": 500}},
    # REQUIRES
    {"source": 7,  "target": 8,  "type": "REQUIRES",   "props": {"quantity": 2.5}},
    # SUPPLIES
    {"source": 9,  "target": 8,  "type": "SUPPLIES",   "props": {"lead_time_days": 7}},
    # ASSIGNED_TO
    {"source": 12, "target": 10, "type": "ASSIGNED_TO", "props": {}},
    {"source": 13, "target": 3,  "type": "ASSIGNED_TO", "props": {}},
    {"source": 11, "target": 13, "type": "ASSIGNED_TO", "props": {}},
    # FULFILLS
    {"source": 13, "target": 12, "type": "FULFILLS",   "props": {}},
    # INSPECTS
    {"source": 14, "target": 8,  "type": "INSPECTS",   "props": {"inspection_type": "incoming"}},
    {"source": 11, "target": 14, "type": "INSPECTS",   "props": {"role": "inspector"}},
    # FOUND_IN
    {"source": 15, "target": 14, "type": "FOUND_IN",   "props": {}},
    # MAINTAINS
    {"source": 11, "target": 4,  "type": "MAINTAINS",  "props": {}},
]

async def _try_neo4j(fn):
    """Run a Neo4j query or fail explicitly when the graph backend is unavailable."""
    timeout = _neo4j_query_timeout(5)
    try:
        from app.database import neo4j_driver

        if neo4j_driver is None:
            raise graph_unavailable("Neo4j driver is not configured")
        async with neo4j_driver.session() as session:
            return await asyncio.wait_for(fn(session), timeout=timeout)
    except HTTPException:
        raise
    except asyncio.TimeoutError as exc:
        logger.warning("Neo4j query timed out (%ss)", timeout)
        raise graph_unavailable(f"Neo4j query timed out after {timeout}s") from exc
    except Exception as exc:  # noqa: BLE001
        logger.warning("Neo4j query failed: %s", exc)
        raise graph_unavailable("Neo4j query failed") from exc

@router.get("/assets/nodes")
async def graph_asset_nodes(
    search: str | None = Query(None),
    entity_type: str | None = Query(None),
):
    """Backend graph-center node assets produced by reviewed knowledge extraction."""
    from app.services.ai.ontology_extraction import list_graph_asset_nodes

    nodes = await list_graph_asset_nodes(search=search, entity_type=entity_type)
    return {"data": nodes, "total": len(nodes)}


@router.get("/assets/relationships")
async def graph_asset_relationships(
    search: str | None = Query(None),
    relation_type: str | None = Query(None),
):
    """Backend graph-center relationship assets produced by reviewed knowledge extraction."""
    from app.services.ai.ontology_extraction import list_graph_asset_relationships

    relationships = await list_graph_asset_relationships(search=search, relation_type=relation_type)
    return {"data": relationships, "total": len(relationships)}


@router.get("/assets/nodes/{node_id}")
async def graph_asset_node_detail(node_id: str):
    from app.services.ai.ontology_extraction import get_graph_asset_node, list_graph_asset_evidence

    node = await get_graph_asset_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Graph asset node not found")
    evidence = [item for item in await list_graph_asset_evidence() if item.get("asset_id") == node_id]
    return {"data": {**node, "evidence": evidence}}


@router.get("/assets/relationships/{relationship_id}")
async def graph_asset_relationship_detail(relationship_id: str):
    from app.services.ai.ontology_extraction import get_graph_asset_relationship, list_graph_asset_evidence

    relationship = await get_graph_asset_relationship(relationship_id)
    if not relationship:
        raise HTTPException(status_code=404, detail="Graph asset relationship not found")
    evidence = [item for item in await list_graph_asset_evidence() if item.get("asset_id") == relationship_id]
    return {"data": {**relationship, "evidence": evidence}}


@router.get("/assets/quality")
async def graph_asset_quality():
    from app.services.ai.ontology_extraction import get_graph_asset_quality

    return {"data": await get_graph_asset_quality()}


@router.get("/assets/evidence")
async def graph_asset_evidence():
    from app.services.ai.ontology_extraction import list_graph_asset_evidence

    evidence = await list_graph_asset_evidence()
    return {"data": evidence, "total": len(evidence)}


@router.get("/stats")
async def graph_stats():
    """图谱统计."""
    async def _query(neo4j_session):
        from app.models.graph_models import CYPHER_TEMPLATES
        result = await neo4j_session.run(CYPHER_TEMPLATES["stats"].format())
        records = await result.data()

        rel_result = await neo4j_session.run(
            "MATCH ()-[r]->() RETURN type(r) AS rel_type, count(*) AS count ORDER BY count DESC"
        )
        rel_records = await rel_result.data()

        total_nodes = sum(r["count"] for r in records)
        total_rels = sum(r["count"] for r in rel_records)

        return {
            "total_nodes": total_nodes,
            "total_relationships": total_rels,
            "nodes_by_label": records,
            "rels_by_type": rel_records,
        }

    result = await _try_neo4j(_query)
    if result is not None:
        return result
    raise seed_data_required("Graph statistics are required")


@router.post("/sync/quality-demo")
async def sync_quality_demo_graph():
    """Upsert the quality closure demo graph into Neo4j using stable business ids."""
    async def _sync():
        from app.api.knowledge import KNOWLEDGE_CARDS
        from app.api.quality import QUALITY_EVENT_DEMO
        from app.services.graph_service import graph_service

        event_id = QUALITY_EVENT_DEMO["events"][0]["id"]
        await graph_service.ensure_business_constraints()

        synced_nodes: list[dict] = []
        for node in QUALITY_EVENT_DEMO["nodes"]:
            business_node = _business_node_from_quality_node(node, event_id)
            synced_nodes.append(await graph_service.upsert_business_node(
                business_node["type"],
                business_node["id"],
                business_node,
            ))

        synced_edges: list[dict] = []
        for edge in QUALITY_EVENT_DEMO["edges"]:
            rel_type, raw_src, raw_tgt = QUALITY_EDGE_REL_MAP.get(
                edge["id"],
                ("RELATED_TO", edge["source"], edge["target"]),
            )
            if rel_type == "RELATED_TO":
                continue
            synced_edges.append(await graph_service.upsert_business_edge(
                QUALITY_BUSINESS_ID_MAP.get(raw_src, raw_src),
                QUALITY_BUSINESS_ID_MAP.get(raw_tgt, raw_tgt),
                rel_type,
                {
                    "label": edge.get("label"),
                    "relation_label": edge.get("label"),
                    "confidence": 0.92,
                    "source_system": "quality-demo",
                },
            ))

        node_lookup: dict[tuple[str, str], str] = {}
        for node in QUALITY_EVENT_DEMO["nodes"]:
            business_node = _business_node_from_quality_node(node, event_id)
            node_lookup[(business_node["type"], business_node["source_id"])] = business_node["id"]
            node_lookup[(business_node["type"], business_node["name"])] = business_node["id"]
            node_lookup[(business_node["type"], business_node["id"])] = business_node["id"]

        for card in KNOWLEDGE_CARDS:
            card_id = card["id"]
            await graph_service.upsert_business_node("KnowledgeCard", card_id, {
                "id": card_id,
                "label": "知识条目",
                "name": card["title"],
                "status": card["status"],
                "risk": "low",
                "summary": card["scenario"],
                "actions": card["steps"][:3],
                "source_id": card_id,
                "source_system": "knowledge-base",
                "updated_at": card["updated_at"],
            })
            synced_nodes.append({"id": card_id, "type": "KnowledgeCard", "name": card["title"]})
            for linked in card["linked_objects"]:
                target_id = (
                    node_lookup.get((linked["type"], linked["id"]))
                    or node_lookup.get((linked["type"], linked["name"]))
                )
                if target_id:
                    synced_edges.append(await graph_service.upsert_business_edge(
                        card_id,
                        target_id,
                        "EVIDENCE_FOR",
                        {
                            "label": "证据支持",
                            "relation_label": "证据支持",
                            "confidence": 0.88,
                            "source_system": "knowledge-base",
                        },
                    ))

        return {
            "data": {
                "nodes": len(synced_nodes),
                "edges": len(synced_edges),
                "root": normalize_quality_event_graph_id(event_id),
                "source": "neo4j",
            }
        }

    try:
        return await asyncio.wait_for(_sync(), timeout=8)
    except asyncio.TimeoutError:
        logger.warning("Quality demo graph sync timed out")
        raise graph_unavailable("Quality graph sync timed out")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Quality demo graph sync failed: %s", exc)
        raise graph_unavailable("Quality graph sync failed") from exc


@router.get("/impact-analysis-by-object")
async def impact_analysis_by_object(
    object_type: str,
    object_id: str,
    max_hops: int = Query(2, ge=1, le=3),
    limit: int = Query(80, ge=1, le=120),
):
    """Business object impact graph with stable string ids."""
    try:
        from app.services.graph_service import graph_service
        data = await asyncio.wait_for(
            graph_service.impact_analysis_by_object(object_type, object_id, max_hops, limit),
            timeout=_neo4j_query_timeout(3),
        )
        if data:
            return {"data": {**data, "source": "neo4j"}}
    except asyncio.TimeoutError:
        logger.warning("Business impact analysis timed out")
        raise graph_unavailable("Business impact analysis timed out")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Business impact analysis failed: %s", exc)
        raise graph_unavailable("Business impact analysis failed") from exc

    raise seed_data_required("Impact graph data is required")


# ── New graph-first endpoints ─────────────────────────────


@router.get("/entity/{label}/{entity_id}")
async def get_graph_entity(label: str, entity_id: int):
    """获取单个实体 — 图优先."""
    from app.models.graph_models import ENTITY_SCHEMAS
    if label not in ENTITY_SCHEMAS:
        raise HTTPException(404, f"Label '{label}' not found")

    try:
        from app.services.graph_service import graph_service
        node = await asyncio.wait_for(graph_service.get_entity(label, entity_id), timeout=5)
        if node:
            return {"data": node}
    except asyncio.TimeoutError as exc:
        raise graph_unavailable("Graph entity lookup timed out") from exc
    except Exception as exc:
        raise graph_unavailable("Graph entity lookup failed") from exc

    raise HTTPException(404, f"Entity {label}/{entity_id} not found")


@router.get("/entity/{label}/{entity_id}/relationships")
async def get_graph_relationships(
    label: str,
    entity_id: int,
    rel_type: str | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    """获取实体关系 — 图优先."""
    from app.models.graph_models import ENTITY_SCHEMAS
    if label not in ENTITY_SCHEMAS:
        raise HTTPException(404, f"Label '{label}' not found")

    try:
        from app.services.graph_service import graph_service
        data = await asyncio.wait_for(graph_service.get_relationships(entity_id, rel_type, limit), timeout=5)
        return {"data": data}
    except asyncio.TimeoutError as exc:
        raise graph_unavailable("Graph relationship lookup timed out") from exc
    except Exception as exc:
        raise graph_unavailable("Graph relationship lookup failed") from exc


@router.get("/impact-analysis/{entity_id}")
async def impact_analysis(
    entity_id: int,
    max_hops: int = Query(5, ge=1, le=10),
    limit: int = Query(200, ge=1, le=500),
):
    """多跳影响分析 — 追踪下游影响."""
    try:
        from app.services.graph_service import graph_service
        data = await asyncio.wait_for(graph_service.impact_analysis(entity_id, max_hops, limit), timeout=5)
        return {"data": data, "entity_id": entity_id}
    except asyncio.TimeoutError as exc:
        raise graph_unavailable("Graph impact analysis timed out") from exc
    except Exception as exc:
        raise graph_unavailable("Graph impact analysis failed") from exc


@router.get("/trace/{entity_id}")
async def trace_chain(
    entity_id: int,
    max_hops: int = Query(5, ge=1, le=10),
    limit: int = Query(200, ge=1, le=500),
):
    """全链路追溯 — 双向遍历."""
    try:
        from app.services.graph_service import graph_service
        data = await asyncio.wait_for(graph_service.trace_chain(entity_id, max_hops, limit), timeout=5)
        return {"data": data, "entity_id": entity_id}
    except asyncio.TimeoutError as exc:
        raise graph_unavailable("Graph trace timed out") from exc
    except Exception as exc:
        raise graph_unavailable("Graph trace failed") from exc


@router.get("/analytics/centrality")
async def centrality_analysis(limit: int = Query(20, ge=1, le=100)):
    """中心度分析 — 哪些实体连接最多."""
    try:
        from app.services.graph_service import graph_service
        data = await asyncio.wait_for(graph_service.centrality(limit), timeout=5)
        return {"data": data}
    except asyncio.TimeoutError as exc:
        raise graph_unavailable("Graph centrality analysis timed out") from exc
    except Exception as exc:
        raise graph_unavailable("Graph centrality analysis failed") from exc
