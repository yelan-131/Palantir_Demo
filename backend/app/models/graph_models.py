"""Neo4j graph models for ManuFoundry Ontology layer.

Entity nodes, relationship types, entity schemas, seed rules,
Cypher templates, and graph constraints for the manufacturing knowledge graph.
"""

from enum import Enum
from typing import Any


# ── Node Labels ──────────────────────────────────────────

class NodeLabel(str, Enum):
    FACTORY = "Factory"
    WORKSHOP = "Workshop"
    PRODUCTION_LINE = "ProductionLine"
    EQUIPMENT = "Equipment"
    SENSOR = "Sensor"
    PRODUCT = "Product"
    MATERIAL = "Material"
    SALES_ORDER = "SalesOrder"
    WORK_ORDER = "WorkOrder"
    SUPPLIER = "Supplier"
    CUSTOMER = "Customer"
    WAREHOUSE = "Warehouse"
    INSPECTION = "Inspection"
    DEFECT = "Defect"
    WORKER = "Worker"


# ── Relationship Types ──────────────────────────────────

class RelType(str, Enum):
    CONTAINS = "CONTAINS"
    PRODUCES = "PRODUCES"
    REQUIRES = "REQUIRES"
    SUPPLIES = "SUPPLIES"
    INSPECTS = "INSPECTS"
    MAINTAINS = "MAINTAINS"
    FEEDS = "FEEDS"
    ASSIGNED_TO = "ASSIGNED_TO"
    STORED_IN = "STORED_IN"
    SHIPS_TO = "SHIPS_TO"
    FULFILLS = "FULFILLS"
    FOUND_IN = "FOUND_IN"


# ── Ontology Entity Schema Definitions ──────────────────

ENTITY_SCHEMAS: dict[str, dict[str, Any]] = {
    "Factory": {
        "label": "工厂",
        "icon": "factory",
        "properties": {
            "name": {"type": "string", "required": True, "label": "工厂名称"},
            "location": {"type": "string", "required": True, "label": "地理位置"},
            "capacity": {"type": "float", "required": False, "label": "产能"},
            "status": {"type": "string", "required": False, "label": "状态"},
        },
        "outgoing_relations": ["CONTAINS"],
        "allowed_targets": {"CONTAINS": ["Workshop"]},
    },
    "Workshop": {
        "label": "车间",
        "icon": "workshop",
        "properties": {
            "name": {"type": "string", "required": True, "label": "车间名称"},
            "area": {"type": "float", "required": False, "label": "面积(㎡)"},
            "workshop_type": {"type": "string", "required": False, "label": "车间类型"},
        },
        "outgoing_relations": ["CONTAINS"],
        "allowed_targets": {"CONTAINS": ["ProductionLine"]},
    },
    "ProductionLine": {
        "label": "产线",
        "icon": "production-line",
        "properties": {
            "name": {"type": "string", "required": True, "label": "产线名称"},
            "capacity": {"type": "float", "required": False, "label": "产能"},
            "oee_target": {"type": "float", "required": False, "label": "OEE目标"},
            "status": {"type": "string", "required": False, "label": "状态"},
        },
        "outgoing_relations": ["CONTAINS", "PRODUCES"],
        "allowed_targets": {
            "CONTAINS": ["Equipment"],
            "PRODUCES": ["Product"],
        },
    },
    "Equipment": {
        "label": "设备",
        "icon": "equipment",
        "properties": {
            "name": {"type": "string", "required": True, "label": "设备名称"},
            "model": {"type": "string", "required": False, "label": "设备型号"},
            "manufacturer": {"type": "string", "required": False, "label": "制造商"},
            "status": {"type": "string", "required": False, "label": "状态"},
            "health_score": {"type": "float", "required": False, "label": "健康评分"},
        },
        "outgoing_relations": ["FEEDS"],
        "allowed_targets": {"FEEDS": ["Sensor"]},
    },
    "Sensor": {
        "label": "传感器",
        "icon": "sensor",
        "properties": {
            "name": {"type": "string", "required": True, "label": "传感器名称"},
            "sensor_type": {"type": "string", "required": False, "label": "类型"},
            "unit": {"type": "string", "required": False, "label": "单位"},
            "sampling_rate": {"type": "int", "required": False, "label": "采样频率(秒)"},
        },
        "outgoing_relations": [],
        "allowed_targets": {},
    },
    "Product": {
        "label": "产品",
        "icon": "product",
        "properties": {
            "name": {"type": "string", "required": True, "label": "产品名称"},
            "sku": {"type": "string", "required": True, "label": "SKU"},
            "category": {"type": "string", "required": False, "label": "分类"},
            "specs": {"type": "string", "required": False, "label": "规格"},
        },
        "outgoing_relations": ["REQUIRES"],
        "allowed_targets": {"REQUIRES": ["Material"]},
    },
    "Material": {
        "label": "物料",
        "icon": "material",
        "properties": {
            "name": {"type": "string", "required": True, "label": "物料名称"},
            "material_type": {"type": "string", "required": False, "label": "物料类型"},
            "specs": {"type": "string", "required": False, "label": "规格"},
            "safety_stock": {"type": "float", "required": False, "label": "安全库存"},
        },
        "outgoing_relations": [],
        "allowed_targets": {},
    },
    "Supplier": {
        "label": "供应商",
        "icon": "supplier",
        "properties": {
            "name": {"type": "string", "required": True, "label": "供应商名称"},
            "location": {"type": "string", "required": False, "label": "地区"},
            "rating": {"type": "float", "required": False, "label": "评级(1-5)"},
            "lead_time_days": {"type": "int", "required": False, "label": "交货周期(天)"},
        },
        "outgoing_relations": ["SUPPLIES"],
        "allowed_targets": {"SUPPLIES": ["Material"]},
    },
    "Customer": {
        "label": "客户",
        "icon": "customer",
        "properties": {
            "name": {"type": "string", "required": True, "label": "客户名称"},
            "industry": {"type": "string", "required": False, "label": "行业"},
            "region": {"type": "string", "required": False, "label": "区域"},
        },
        "outgoing_relations": [],
        "allowed_targets": {},
    },
    "Worker": {
        "label": "工人",
        "icon": "worker",
        "properties": {
            "name": {"type": "string", "required": True, "label": "姓名"},
            "role": {"type": "string", "required": False, "label": "角色"},
            "department": {"type": "string", "required": False, "label": "部门"},
        },
        "outgoing_relations": ["ASSIGNED_TO", "MAINTAINS", "INSPECTS"],
        "allowed_targets": {
            "ASSIGNED_TO": ["Equipment", "WorkOrder"],
            "MAINTAINS": ["Equipment"],
            "INSPECTS": ["Inspection"],
        },
    },
    "SalesOrder": {
        "label": "销售订单",
        "icon": "sales-order",
        "properties": {
            "order_no": {"type": "string", "required": True, "label": "订单号"},
            "quantity": {"type": "float", "required": False, "label": "数量"},
            "due_date": {"type": "string", "required": False, "label": "交付日期"},
            "priority": {"type": "string", "required": False, "label": "优先级"},
            "status": {"type": "string", "required": False, "label": "状态"},
        },
        "outgoing_relations": ["PRODUCES", "ASSIGNED_TO"],
        "allowed_targets": {
            "PRODUCES": ["Product"],
            "ASSIGNED_TO": ["Customer"],
        },
    },
    "WorkOrder": {
        "label": "工单",
        "icon": "work-order",
        "properties": {
            "order_no": {"type": "string", "required": True, "label": "工单号"},
            "quantity": {"type": "float", "required": False, "label": "计划数量"},
            "completed_quantity": {"type": "float", "required": False, "label": "完成数量"},
            "status": {"type": "string", "required": False, "label": "状态"},
        },
        "outgoing_relations": ["FULFILLS", "ASSIGNED_TO"],
        "allowed_targets": {
            "FULFILLS": ["SalesOrder"],
            "ASSIGNED_TO": ["ProductionLine"],
        },
    },
    "Warehouse": {
        "label": "仓库",
        "icon": "warehouse",
        "properties": {
            "name": {"type": "string", "required": True, "label": "仓库名称"},
            "location": {"type": "string", "required": False, "label": "位置"},
            "capacity": {"type": "float", "required": False, "label": "容量"},
            "utilization": {"type": "float", "required": False, "label": "利用率"},
        },
        "outgoing_relations": [],
        "allowed_targets": {},
    },
    "Inspection": {
        "label": "质检",
        "icon": "inspection",
        "properties": {
            "inspection_type": {"type": "string", "required": False, "label": "检验类型"},
            "target_type": {"type": "string", "required": False, "label": "检验对象类型"},
            "result": {"type": "string", "required": False, "label": "结果"},
            "inspected_at": {"type": "string", "required": False, "label": "检验时间"},
        },
        "outgoing_relations": ["INSPECTS"],
        "allowed_targets": {
            "INSPECTS": ["Product", "Material", "Equipment"],
        },
    },
    "Defect": {
        "label": "缺陷",
        "icon": "defect",
        "properties": {
            "defect_type": {"type": "string", "required": False, "label": "缺陷类型"},
            "severity": {"type": "string", "required": False, "label": "严重程度"},
            "description": {"type": "string", "required": False, "label": "描述"},
            "root_cause": {"type": "string", "required": False, "label": "根因"},
            "correction": {"type": "string", "required": False, "label": "纠正措施"},
        },
        "outgoing_relations": ["FOUND_IN"],
        "allowed_targets": {"FOUND_IN": ["Inspection"]},
    },
}


# ── Target type to NodeLabel mapping ────────────────────

TARGET_TYPE_MAP: dict[str, str] = {
    "product": "Product",
    "material": "Material",
    "equipment": "Equipment",
}


# ── Relationship Seed Rules ─────────────────────────────
# Each rule: (rel_type, source_label, target_label, source_fk_field, target_fk_field)
# source_fk_field: field in TARGET data that references source id (for CONTAINS-like)
# target_fk_field: field in SOURCE data that references target id (for FK-like)

RELATIONSHIP_SEED_RULES: list[dict[str, Any]] = [
    # ── CONTAINS (hierarchy) ──
    {"rel": "CONTAINS", "src": "Factory", "tgt": "Workshop",
     "seed": "workshops", "fk": "factory_id"},
    {"rel": "CONTAINS", "src": "Workshop", "tgt": "ProductionLine",
     "seed": "production_lines", "fk": "workshop_id"},
    {"rel": "CONTAINS", "src": "ProductionLine", "tgt": "Equipment",
     "seed": "equipment", "fk": "line_id"},
    # ── FEEDS ──
    {"rel": "FEEDS", "src": "Equipment", "tgt": "Sensor",
     "seed": "sensors", "fk": "equipment_id"},
    # ── PRODUCES (orders → products) ──
    {"rel": "PRODUCES", "src": "SalesOrder", "tgt": "Product",
     "seed": "sales_orders", "fk": "product_id"},
    # ── ASSIGNED_TO (orders → customers/lines) ──
    {"rel": "ASSIGNED_TO", "src": "SalesOrder", "tgt": "Customer",
     "seed": "sales_orders", "fk": "customer_id"},
    {"rel": "ASSIGNED_TO", "src": "WorkOrder", "tgt": "ProductionLine",
     "seed": "work_orders", "fk": "line_id"},
    # ── FULFILLS (work orders → sales orders) ──
    {"rel": "FULFILLS", "src": "WorkOrder", "tgt": "SalesOrder",
     "seed": "work_orders", "fk": "sales_order_id"},
    # ── INSPECTS (inspections → targets) ──
    # Handled separately in build_from_seed due to dynamic target_type
    # ── FOUND_IN (defects → inspections) ──
    {"rel": "FOUND_IN", "src": "Defect", "tgt": "Inspection",
     "seed": "defects", "fk": "inspection_id"},
    # ── INSPECTS (workers → inspections) ──
    # Handled separately: from inspection.inspector_id → Worker
    # ── SUPPLIES (suppliers → materials) ──
    # Heuristic: each supplier supplies materials matching their specialty
    # Will be built from supplier_material mapping derived from seed data
]


# ── Cypher Query Templates ──────────────────────────────

CYPHER_TEMPLATES = {
    "create_entity": (
        "CREATE (n:{label} {{pg_id: $pg_id}}) SET n += $props RETURN n"
    ),
    "create_relation": (
        "MATCH (a:{src_label} {{pg_id: $src_id}}) "
        "MATCH (b:{tgt_label} {{pg_id: $tgt_id}}) "
        "CREATE (a)-[r:{rel_type}]->(b) SET r += $props RETURN r"
    ),
    "get_entity_by_id": (
        "MATCH (n:{label} {{pg_id: $pg_id}}) RETURN n"
    ),
    "get_entities": (
        "MATCH (n:{label}) RETURN n SKIP $skip LIMIT $limit"
    ),
    "count_by_label": (
        "MATCH (n:{label}) RETURN count(n) AS count"
    ),
    "count_by_label_and_property": (
        "MATCH (n:{label}) WHERE n.{property} = $value RETURN count(n) AS count"
    ),
    "update_entity": (
        "MATCH (n:{label} {{pg_id: $pg_id}}) SET n += $props RETURN n"
    ),
    "delete_entity": (
        "MATCH (n:{label} {{pg_id: $pg_id}}) DETACH DELETE n"
    ),
    "get_neighbors": (
        "MATCH (n {{pg_id: $entity_id}})-[r]-(m) "
        "RETURN n, type(r) AS rel_type, m LIMIT $limit"
    ),
    "get_relationships": (
        "MATCH (n {{pg_id: $entity_id}})-[r]-(m) "
        "WHERE ($rel_type IS NULL OR type(r) = $rel_type) "
        "RETURN n, type(r) AS rel_type, labels(m) AS target_labels, m AS target, "
        "CASE WHEN startNode(r) = n THEN 'outgoing' ELSE 'incoming' END AS direction "
        "LIMIT $limit"
    ),
    "impact_analysis": (
        "MATCH (src {{pg_id: $entity_id}})-[r*1..{max_hops}]->(affected) "
        "RETURN src, r, affected, length(r) AS distance "
        "ORDER BY distance "
        "LIMIT $limit"
    ),
    "trace_chain": (
        "MATCH path = (start {{pg_id: $entity_id}})-[r*1..{max_hops}]-(related) "
        "RETURN path, length(path) AS distance "
        "ORDER BY distance "
        "LIMIT $limit"
    ),
    "centrality": (
        "MATCH (n) "
        "WITH n, [(n)-[r]-() | type(r)] AS rel_types, "
        "     [(n)-[r]->(m) | labels(m)[0]] AS outgoing_targets, "
        "     [(n)<-[r]-(m) | labels(m)[0]] AS incoming_sources "
        "RETURN labels(n)[0] AS label, n.pg_id AS pg_id, n.name AS name, "
        "size(rel_types) AS degree, rel_types, outgoing_targets, incoming_sources "
        "ORDER BY degree DESC LIMIT $limit"
    ),
    "entity_timeline": (
        "MATCH (n {{pg_id: $entity_id}}) "
        "MATCH (n)-[r:VERSION_OF]->(v:EntityVersion) "
        "WHERE v.valid_from <= $timestamp "
        "RETURN v ORDER BY v.valid_from DESC LIMIT 1"
    ),
    "stats": (
        "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count "
        "ORDER BY count DESC"
    ),
}


# ── Graph Constraints ───────────────────────────────────

GRAPH_CONSTRAINTS = [
    f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label.value}) REQUIRE n.pg_id IS UNIQUE"
    for label in NodeLabel
]


# ── Supplier-Material mapping for seed ──────────────────
# Derived from domain knowledge: which suppliers supply which materials

SUPPLIER_MATERIAL_MAP: dict[int, list[int]] = {
    # supplier_id: [material_ids]
    # Populated during seed from BOM data or heuristic
}
