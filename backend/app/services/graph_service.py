"""Graph Service — Neo4j operations for manufacturing ontology.

Provides entity CRUD, relationship management, graph traversal,
and seed data building for the manufacturing knowledge graph.
"""

from typing import Any

from app.core.logging import get_logger
from app.database import neo4j_driver
from app.models.graph_models import (
    ENTITY_SCHEMAS,
    GRAPH_CONSTRAINTS,
    RELATIONSHIP_SEED_RULES,
    TARGET_TYPE_MAP,
    CYPHER_TEMPLATES,
)

logger = get_logger(__name__)

SAFE_LABELS = list(ENTITY_SCHEMAS.keys())
SAFE_RELS = [
    "CONTAINS", "PRODUCES", "REQUIRES", "SUPPLIES",
    "INSPECTS", "MAINTAINS", "FEEDS", "ASSIGNED_TO",
    "STORED_IN", "SHIPS_TO", "FULFILLS", "FOUND_IN",
    "RELATED_TO",
]

BUSINESS_GRAPH_LABELS = [
    "QualityEvent", "Defect", "InspectionBatch", "MaterialBatch",
    "Supplier", "WorkOrder", "Equipment", "CustomerOrder", "CAPA",
    "KnowledgeCard", "Operation", "ProductBatch", "InventoryLot",
    "Sensor", "TimeSeriesWindow", "Material", "Product", "Customer",
]

BUSINESS_LABEL_ALIASES = {
    "MaterialBatch": ["Material"],
    "InspectionBatch": ["Inspection"],
    "CustomerOrder": ["SalesOrder"],
    "QualityEvent": ["Defect", "Inspection"],
}

BUSINESS_GRAPH_RELS = [
    "HAS_DEFECT", "FOUND_IN", "INSPECTS", "SUPPLIED_BY",
    "USES_BATCH", "USES_EQUIPMENT", "AFFECTS_ORDER", "TRIGGERS",
    "EVIDENCE_FOR", "RUNS_OPERATION", "PRODUCES_BATCH",
    "STORED_AS", "REINSPECTS", "MAY_CAUSE", "MEASURED_BY",
    "HAS_TS_ANOMALY", "CORRELATES_WITH", "RELATED_TO",
]


class GraphService:
    """Service for managing the manufacturing knowledge graph in Neo4j."""

    def _check_driver(self):
        if neo4j_driver is None:
            raise RuntimeError("Neo4j driver not available")

    async def ensure_constraints(self):
        """Create unique constraints on pg_id for all node labels."""
        self._check_driver()
        async with neo4j_driver.session() as session:
            for constraint_cypher in GRAPH_CONSTRAINTS:
                try:
                    await session.run(constraint_cypher)
                except Exception as exc:
                    logger.debug("Constraint creation skipped: %s", exc)

    async def ensure_business_constraints(self):
        """Create unique constraints for business-object graph ids."""
        self._check_driver()
        async with neo4j_driver.session() as session:
            for label in BUSINESS_GRAPH_LABELS:
                try:
                    await session.run(
                        f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE"
                    )
                except Exception as exc:
                    logger.debug("Business constraint creation skipped for %s: %s", label, exc)

    # ── Business graph operations ────────────────────────

    async def upsert_business_node(self, label: str, object_id: str, props: dict) -> dict:
        if label not in BUSINESS_GRAPH_LABELS:
            raise ValueError(f"Invalid business label: {label}")
        self._check_driver()
        payload = {
            **props,
            "id": object_id,
            "object_id": object_id,
            "type": label,
        }
        async with neo4j_driver.session() as session:
            result = await session.run(
                f"MERGE (n:{label} {{id: $id}}) "
                "SET n += $props "
                "RETURN n {.*, labels: labels(n)} AS node",
                id=object_id,
                props=payload,
            )
            records = await result.data()
            return records[0]["node"] if records else {}

    async def upsert_business_edge(
        self,
        src_id: str,
        tgt_id: str,
        rel_type: str,
        props: dict | None = None,
    ) -> dict:
        if rel_type not in BUSINESS_GRAPH_RELS:
            raise ValueError(f"Invalid business relation: {rel_type}")
        self._check_driver()
        payload = {
            **(props or {}),
            "relation_type": rel_type,
        }
        async with neo4j_driver.session() as session:
            result = await session.run(
                "MATCH (a {id: $src_id}) "
                "MATCH (b {id: $tgt_id}) "
                f"MERGE (a)-[r:{rel_type}]->(b) "
                "SET r += $props "
                "RETURN r {.*, type: type(r), source: a.id, target: b.id} AS edge",
                src_id=src_id,
                tgt_id=tgt_id,
                props=payload,
            )
            records = await result.data()
            return records[0]["edge"] if records else {}

    async def impact_analysis_by_object(
        self,
        object_type: str,
        object_id: str,
        max_hops: int = 2,
        limit: int = 80,
    ) -> dict[str, Any] | None:
        allowed_labels = set(BUSINESS_GRAPH_LABELS) | set(SAFE_LABELS)
        if object_type not in allowed_labels:
            raise ValueError(f"Invalid business label: {object_type}")
        self._check_driver()
        max_hops = max(1, min(max_hops, 3))
        limit = max(1, min(limit, 120))
        async with neo4j_driver.session() as session:
            query_labels = [
                label for label in [object_type, *BUSINESS_LABEL_ALIASES.get(object_type, [])]
                if label in allowed_labels
            ]
            for label in query_labels:
                result = await session.run(
                    f"""
                    MATCH (root:{label})
                    WHERE root.id = $object_id
                       OR root.object_id = $object_id
                       OR root.source_id = $object_id
                       OR root.name = $object_id
                       OR toString(root.pg_id) = $object_id
                       OR root.sku = $object_id
                    OPTIONAL MATCH p = (root)-[*1..{max_hops}]-(related)
                    WITH root, collect(DISTINCT related)[0..$limit] AS relatedNodes, collect(relationships(p)) AS relGroups
                    WITH root, [root] + relatedNodes AS nodes, reduce(allRels = [], rels IN relGroups | allRels + rels) AS flattenedRels
                    UNWIND CASE WHEN size(flattenedRels) = 0 THEN [null] ELSE flattenedRels END AS r
                    WITH root, nodes, collect(DISTINCT r) AS rels
                    RETURN
                      root {{.*, id: coalesce(root.id, toString(root.pg_id), root.name), labels: labels(root)}} AS root,
                      [n IN nodes | n {{.*, id: coalesce(n.id, toString(n.pg_id), n.name), labels: labels(n)}}][0..$limit] AS nodes,
                      [r IN rels WHERE r IS NOT NULL | r {{.*, type: type(r), source: coalesce(startNode(r).id, toString(startNode(r).pg_id), startNode(r).name), target: coalesce(endNode(r).id, toString(endNode(r).pg_id), endNode(r).name)}}][0..$limit] AS edges
                    """,
                    object_id=object_id,
                    limit=limit,
                )
                records = await result.data()
                if not records:
                    continue
                record = records[0]
                nodes = record.get("nodes") or []
                edges = record.get("edges") or []
                if not nodes:
                    continue
                return {
                    "root": record.get("root"),
                    "nodes": nodes,
                    "edges": edges,
                    "summary": {
                        "node_count": len(nodes),
                        "edge_count": len(edges),
                        "max_hops": max_hops,
                        "label": label,
                    },
                }
            return None

    # ── Entity CRUD ──────────────────────────────────────

    async def create_entity(self, label: str, pg_id: int, props: dict) -> dict:
        if label not in SAFE_LABELS:
            raise ValueError(f"Invalid label: {label}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["create_entity"].format(label=label)
            result = await session.run(cypher, pg_id=pg_id, props=props)
            records = await result.data()
            return records[0] if records else {}

    async def get_entities(self, label: str, page: int = 1, page_size: int = 50) -> dict:
        if label not in SAFE_LABELS:
            raise ValueError(f"Invalid label: {label}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            skip = (page - 1) * page_size
            cypher = CYPHER_TEMPLATES["get_entities"].format(label=label)
            result = await session.run(cypher, skip=skip, limit=page_size)
            records = await result.data()

            count_cypher = CYPHER_TEMPLATES["count_by_label"].format(label=label)
            count_result = await session.run(count_cypher)
            count_records = await count_result.data()
            total = count_records[0]["count"] if count_records else 0

            return {
                "data": [r["n"] for r in records],
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    async def get_entity(self, label: str, pg_id: int) -> dict | None:
        if label not in SAFE_LABELS:
            raise ValueError(f"Invalid label: {label}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["get_entity_by_id"].format(label=label)
            result = await session.run(cypher, pg_id=pg_id)
            records = await result.data()
            return records[0]["n"] if records else None

    async def update_entity(self, label: str, pg_id: int, props: dict) -> dict:
        if label not in SAFE_LABELS:
            raise ValueError(f"Invalid label: {label}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["update_entity"].format(label=label)
            result = await session.run(cypher, pg_id=pg_id, props=props)
            records = await result.data()
            return records[0] if records else {}

    async def delete_entity(self, label: str, pg_id: int) -> bool:
        if label not in SAFE_LABELS:
            raise ValueError(f"Invalid label: {label}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["delete_entity"].format(label=label)
            await session.run(cypher, pg_id=pg_id)
            return True

    async def count_by_label(self, label: str) -> int:
        if label not in SAFE_LABELS:
            raise ValueError(f"Invalid label: {label}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["count_by_label"].format(label=label)
            result = await session.run(cypher)
            records = await result.data()
            return records[0]["count"] if records else 0

    async def count_by_label_and_property(self, label: str, property: str, value: Any) -> int:
        if label not in SAFE_LABELS:
            raise ValueError(f"Invalid label: {label}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["count_by_label_and_property"].format(
                label=label, property=property
            )
            result = await session.run(cypher, value=value)
            records = await result.data()
            return records[0]["count"] if records else 0

    # ── Relationship operations ──────────────────────────

    async def create_relation(
        self,
        src_label: str,
        src_id: int,
        tgt_label: str,
        tgt_id: int,
        rel_type: str,
        props: dict | None = None,
    ) -> dict:
        if src_label not in SAFE_LABELS:
            raise ValueError(f"Invalid source label: {src_label}")
        if tgt_label not in SAFE_LABELS:
            raise ValueError(f"Invalid target label: {tgt_label}")
        if rel_type not in SAFE_RELS:
            raise ValueError(f"Invalid relation type: {rel_type}")
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["create_relation"].format(
                src_label=src_label, tgt_label=tgt_label, rel_type=rel_type
            )
            result = await session.run(
                cypher, src_id=src_id, tgt_id=tgt_id, props=props or {}
            )
            records = await result.data()
            return records[0] if records else {}

    async def get_neighbors(self, entity_id: int, limit: int = 50) -> list[dict]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["get_neighbors"].format()
            result = await session.run(
                cypher, entity_id=entity_id, limit=limit
            )
            return await result.data()

    async def get_relationships(
        self, entity_id: int, rel_type: str | None = None, limit: int = 100
    ) -> list[dict]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["get_relationships"].format()
            result = await session.run(
                cypher, entity_id=entity_id, rel_type=rel_type, limit=limit
            )
            return await result.data()

    async def get_shortest_path(self, src_id: int, tgt_id: int, max_hops: int = 6) -> list[dict]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["shortest_path"].format(max_hops=max_hops)
            result = await session.run(cypher, src_id=src_id, tgt_id=tgt_id)
            return await result.data()

    async def get_subgraph(self, entity_id: int, depth: int = 2, limit: int = 100) -> list[dict]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["subgraph"].format(depth=depth)
            result = await session.run(cypher, entity_id=entity_id, limit=limit)
            return await result.data()

    async def impact_analysis(self, entity_id: int, max_hops: int = 5, limit: int = 200) -> list[dict]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["impact_analysis"].format(max_hops=max_hops)
            result = await session.run(cypher, entity_id=entity_id, limit=limit)
            return await result.data()

    async def trace_chain(self, entity_id: int, max_hops: int = 5, limit: int = 200) -> list[dict]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["trace_chain"].format(max_hops=max_hops)
            result = await session.run(cypher, entity_id=entity_id, limit=limit)
            return await result.data()

    async def centrality(self, limit: int = 20) -> list[dict]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            cypher = CYPHER_TEMPLATES["centrality"].format()
            result = await session.run(cypher, limit=limit)
            return await result.data()

    # ── Statistics ───────────────────────────────────────

    async def get_stats(self) -> dict[str, Any]:
        self._check_driver()
        async with neo4j_driver.session() as session:
            node_result = await session.run(
                "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC"
            )
            node_data = await node_result.data()

            rel_result = await session.run(
                "MATCH ()-[r]->() RETURN type(r) AS rel_type, count(*) AS count ORDER BY count DESC"
            )
            rel_data = await rel_result.data()

            return {
                "total_nodes": sum(r["count"] for r in node_data),
                "total_relationships": sum(r["count"] for r in rel_data),
                "nodes_by_label": node_data,
                "relationships_by_type": rel_data,
            }

    # ── Seed data building ──────────────────────────────

    async def build_from_seed(self, seed_data: dict[str, list[dict]]):
        """Build the initial graph from seed data.

        Creates nodes for all entities and establishes all relationship types.
        """
        entity_map = {
            "factories": "Factory",
            "workshops": "Workshop",
            "production_lines": "ProductionLine",
            "equipment": "Equipment",
            "sensors": "Sensor",
            "products": "Product",
            "materials": "Material",
            "suppliers": "Supplier",
            "customers": "Customer",
            "workers": "Worker",
            "sales_orders": "SalesOrder",
            "work_orders": "WorkOrder",
            "inspections": "Inspection",
            "defects": "Defect",
        }

        # Phase 1: Create all entity nodes
        total_nodes = 0
        for data_key, label in entity_map.items():
            if data_key not in seed_data:
                continue
            for entity in seed_data[data_key]:
                props = {k: v for k, v in entity.items() if k != "id" and v is not None}
                try:
                    await self.create_entity(label, entity["id"], props)
                    total_nodes += 1
                except Exception as exc:
                    logger.debug("Skip node %s/%s: %s", label, entity["id"], exc)
        logger.info("Created %d graph nodes", total_nodes)

        # Phase 2: Create relationships from RELATIONSHIP_SEED_RULES
        total_rels = 0
        for rule in RELATIONSHIP_SEED_RULES:
            src_label = rule["src"]
            tgt_label = rule["tgt"]
            rel_type = rule["rel"]
            seed_key = rule["seed"]
            fk_field = rule["fk"]

            if seed_key not in seed_data:
                continue

            for item in seed_data[seed_key]:
                src_id = item.get("id")
                tgt_id = item.get(fk_field)
                if src_id is None or tgt_id is None:
                    continue
                try:
                    await self.create_relation(src_label, src_id, tgt_label, tgt_id, rel_type)
                    total_rels += 1
                except Exception as exc:
                    logger.debug("Skip rel %s/%s->%s/%s: %s", src_label, src_id, tgt_label, tgt_id, exc)
        logger.info("Created %d relationships from seed rules", total_rels)

        # Phase 3: INSPECTS — inspections → dynamic target (product/material/equipment)
        inspection_rels = 0
        if "inspections" in seed_data:
            for insp in seed_data["inspections"]:
                target_type = insp.get("target_type")
                target_id = insp.get("target_id")
                if target_type and target_id and target_type in TARGET_TYPE_MAP:
                    tgt_label = TARGET_TYPE_MAP[target_type]
                    try:
                        await self.create_relation(
                            "Inspection", insp["id"], tgt_label, target_id, "INSPECTS",
                            {"inspection_type": insp.get("inspection_type", "")}
                        )
                        inspection_rels += 1
                    except Exception as exc:
                        logger.debug("Skip inspection rel: %s", exc)
        logger.info("Created %d INSPECTS relationships", inspection_rels)

        # Phase 4: INSPECTS — workers → inspections (inspector)
        worker_insp_rels = 0
        if "inspections" in seed_data:
            for insp in seed_data["inspections"]:
                inspector_id = insp.get("inspector_id")
                if inspector_id:
                    try:
                        await self.create_relation(
                            "Worker", inspector_id, "Inspection", insp["id"], "INSPECTS",
                            {"role": "inspector"}
                        )
                        worker_insp_rels += 1
                    except Exception as exc:
                        logger.debug("Skip worker-inspection rel: %s", exc)
        logger.info("Created %d Worker->Inspection relationships", worker_insp_rels)

        # Phase 5: SUPPLIES — heuristic mapping (each supplier supplies 2-3 materials)
        supplier_rels = 0
        if "suppliers" in seed_data and "materials" in seed_data:
            suppliers = seed_data["suppliers"]
            materials = seed_data["materials"]
            mat_count = len(materials)
            if mat_count > 0:
                for i, supplier in enumerate(suppliers):
                    # Distribute materials round-robin, 2-3 per supplier
                    start = (i * 2) % mat_count
                    end = min(start + 2 + (i % 2), mat_count)
                    for j in range(start, end):
                        try:
                            await self.create_relation(
                                "Supplier", supplier["id"],
                                "Material", materials[j]["id"],
                                "SUPPLIES",
                                {"lead_time_days": supplier.get("lead_time_days", 7)}
                            )
                            supplier_rels += 1
                        except Exception as exc:
                            logger.debug("Skip supplier rel: %s", exc)
        logger.info("Created %d SUPPLIES relationships", supplier_rels)

        # Phase 6: MAINTAINS — workers with maintenance roles → equipment
        maint_rels = 0
        if "workers" in seed_data and "equipment" in seed_data:
            equip_list = seed_data["equipment"]
            for worker in seed_data["workers"]:
                role = worker.get("role", "").lower()
                if "维修" in role or "维护" in role or "maintenance" in role:
                    # Assign this worker to 3-5 pieces of equipment
                    assigned = equip_list[worker["id"] % len(equip_list):][:3]
                    for eq in assigned:
                        try:
                            await self.create_relation(
                                "Worker", worker["id"], "Equipment", eq["id"], "MAINTAINS"
                            )
                            maint_rels += 1
                        except Exception as exc:
                            logger.debug("Skip maintain rel: %s", exc)
        logger.info("Created %d MAINTAINS relationships", maint_rels)

        # Phase 7: ASSIGNED_TO — workers → work orders (via operations/work_order assignments)
        wo_assign_rels = 0
        if "workers" in seed_data and "work_orders" in seed_data:
            workers = seed_data["workers"]
            wo_list = seed_data["work_orders"]
            if workers and wo_list:
                for wo in wo_list:
                    # Assign one worker per work order (round-robin)
                    worker = workers[wo["id"] % len(workers)]
                    try:
                        await self.create_relation(
                            "Worker", worker["id"], "WorkOrder", wo["id"], "ASSIGNED_TO"
                        )
                        wo_assign_rels += 1
                    except Exception as exc:
                        logger.debug("Skip wo-assign rel: %s", exc)
        logger.info("Created %d Worker->WorkOrder relationships", wo_assign_rels)

        total_all = total_rels + inspection_rels + worker_insp_rels + supplier_rels + maint_rels + wo_assign_rels
        logger.info("Graph build complete: %d nodes, %d total relationships", total_nodes, total_all)


graph_service = GraphService()
