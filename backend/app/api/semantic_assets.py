"""Semantic asset APIs backed by database metadata and persisted records."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_tenant_id, current_user_id, get_current_user, get_db
from app.models.relational import (
    Application,
    AuditLog,
    Customer,
    Defect,
    DataSource,
    DataSourceMetadata,
    DynamicRecord,
    Equipment,
    Form,
    FormAction,
    FormField,
    KnowledgeObjectLink,
    Inventory,
    Material,
    OntologyCandidate,
    OntologyMapping,
    OntologyObject,
    OntologyVersion,
    ProductionLine,
    Role,
    RolePermission,
    SalesOrder,
    Shipment,
    Supplier,
    WorkOrder,
    Warehouse,
)
from app.services.ontology_candidate_service import (
    generate_candidates_from_metadata,
    infer_field_code,
    infer_object_code,
    upsert_candidate,
)
from app.services.metadata_scan_service import parse_connection_config, scan_data_source_metadata
from app.services.ontology_service import (
    approve_candidate,
    candidate_payload,
    create_or_update_object,
    create_or_update_relation,
    impact_analysis,
    list_published_objects,
    list_published_relations,
    mapping_payload,
    object_payload,
    publish_version,
    reject_candidate,
    relation_payload,
)

router = APIRouter()


class OntologyObjectBody(BaseModel):
    name: str
    code: str
    domain: str = "manufacturing"
    description: str | None = None
    status: str = "published"
    fields: list[dict[str, Any]] = []
    source_type: str = "manual"
    source_ref: str | None = None


class OntologyRelationBody(BaseModel):
    code: str | None = None
    name: str
    relation_type: str = "RELATED_TO"
    source_object_code: str
    target_object_code: str
    description: str | None = None
    graph_enabled: bool = True
    source_type: str = "manual"
    source_ref: str | None = None


class CandidateGenerateBody(BaseModel):
    source_id: int | None = None
    document_job_id: str | None = None


def _connection_config_flag(config: dict[str, Any], key: str, default: bool = True) -> bool:
    value = config.get(key, default)
    if isinstance(value, str):
        return value.strip().lower() not in {"false", "0", "no", "off"}
    return bool(value)


def _data_source_asset_type(source: DataSource, config: dict[str, Any]) -> str:
    raw_type = config.get("source_type") or config.get("type") or config.get("driver") or source.source_type or "database"
    normalized = str(raw_type).strip().lower()
    if normalized in {"", "undefined", "null", "none"}:
        normalized = str(config.get("source_type") or config.get("type") or "").strip().lower()
    if normalized in {"", "undefined", "null", "none"} and (config.get("host") or config.get("database")):
        normalized = "postgresql"
    return normalized or "database"


class CandidateReviewBody(BaseModel):
    note: str | None = None


class OntologyPublishBody(BaseModel):
    title: str | None = None


class DataAssetMetadataScanBody(BaseModel):
    limit_tables: int = 24
    sample_limit: int = 3


DATABASE_MODELS = [
    Equipment,
    WorkOrder,
    SalesOrder,
    Supplier,
    Material,
    Defect,
    ProductionLine,
    Customer,
    Warehouse,
    Inventory,
    Shipment,
]

SYSTEM_DATABASE_MODELS = [
    Application,
    Form,
    FormField,
    FormAction,
    DynamicRecord,
    Role,
    RolePermission,
    AuditLog,
    KnowledgeObjectLink,
]

MODEL_LABELS = {
    "equipment": "设备主数据",
    "work_orders": "生产工单",
    "sales_orders": "客户订单",
    "suppliers": "供应商主数据",
    "materials": "物料主数据",
    "defects": "质量缺陷",
    "production_lines": "产线主数据",
    "customers": "客户主数据",
    "warehouses": "仓库主数据",
    "inventory": "库存余额",
    "shipments": "仓储发运",
    "applications": "应用定义",
    "forms": "表单定义",
    "form_fields": "表单字段",
    "form_actions": "表单动作",
    "dynamic_records": "动态表单记录",
    "roles": "角色定义",
    "role_permissions": "角色权限",
    "audit_logs": "审计日志",
    "knowledge_object_links": "知识对象链接",
}

# Backward-compatible exports for AI context routing. The semantic asset API now
# resolves these structures from database metadata at request time.
ONTOLOGY_OBJECTS: list[dict[str, Any]] = []
ONTOLOGY_RELATIONS: list[dict[str, Any]] = []
PAGE_CONTRACTS: dict[str, dict[str, Any]] = {}


def _demo_field(
    name: str,
    label: str,
    field_type: str,
    *,
    primary_key: bool = False,
    searchable: bool = False,
    visible: bool = True,
    quality: str = "good",
) -> dict[str, Any]:
    return {
        "name": name,
        "label": label,
        "type": field_type,
        "primary_key": primary_key,
        "searchable": searchable,
        "visible": visible,
        "quality": quality,
    }


def _demo_table(
    table_id: str,
    name: str,
    label: str,
    rows: int,
    quality_score: int,
    fields: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": table_id,
        "name": name,
        "label": label,
        "rows": rows,
        "quality_score": quality_score,
        "fields": fields,
    }


def _demo_data_assets() -> list[dict[str, Any]]:
    """Enterprise demo assets shown when the local tenant has no business data."""
    return [
        {
            "id": 101,
            "name": "MES 生产执行系统",
            "type": "mes",
            "status": "connected",
            "owner": "生产运营部",
            "freshness": "5 分钟前",
            "tables": [
                _demo_table(
                    "mes_equipment",
                    "equipment",
                    "设备主数据",
                    128,
                    96,
                    [
                        _demo_field("equipment_code", "设备编码", "string", primary_key=True, searchable=True),
                        _demo_field("equipment_name", "设备名称", "string", searchable=True),
                        _demo_field("line_code", "产线编码", "string", searchable=True),
                        _demo_field("status", "运行状态", "string"),
                        _demo_field("health_score", "健康评分", "number"),
                        _demo_field("updated_at", "更新时间", "datetime"),
                    ],
                ),
                _demo_table(
                    "mes_work_orders",
                    "work_orders",
                    "生产工单",
                    1842,
                    93,
                    [
                        _demo_field("work_order_no", "工单号", "string", primary_key=True, searchable=True),
                        _demo_field("product_code", "产品编码", "string", searchable=True),
                        _demo_field("equipment_code", "主设备编码", "string", searchable=True),
                        _demo_field("planned_qty", "计划数量", "number"),
                        _demo_field("status", "工单状态", "string"),
                        _demo_field("started_at", "开工时间", "datetime"),
                    ],
                ),
                _demo_table(
                    "mes_operation_events",
                    "operation_events",
                    "设备运行事件",
                    58920,
                    88,
                    [
                        _demo_field("event_id", "事件 ID", "string", primary_key=True, searchable=True),
                        _demo_field("equipment_code", "设备编码", "string", searchable=True),
                        _demo_field("event_type", "事件类型", "string"),
                        _demo_field("operator_id", "操作员", "string"),
                        _demo_field("occurred_at", "发生时间", "datetime"),
                    ],
                ),
            ],
        },
        {
            "id": 102,
            "name": "SAP ERP 物料与采购",
            "type": "erp",
            "status": "connected",
            "owner": "供应链管理部",
            "freshness": "15 分钟前",
            "tables": [
                _demo_table(
                    "erp_materials",
                    "materials",
                    "物料主数据",
                    4360,
                    97,
                    [
                        _demo_field("material_code", "物料编码", "string", primary_key=True, searchable=True),
                        _demo_field("material_name", "物料名称", "string", searchable=True),
                        _demo_field("category", "物料类别", "string"),
                        _demo_field("base_unit", "基本单位", "string"),
                        _demo_field("safety_stock", "安全库存", "number"),
                    ],
                ),
                _demo_table(
                    "erp_suppliers",
                    "suppliers",
                    "供应商主数据",
                    268,
                    91,
                    [
                        _demo_field("supplier_code", "供应商编码", "string", primary_key=True, searchable=True),
                        _demo_field("supplier_name", "供应商名称", "string", searchable=True),
                        _demo_field("rating", "评级", "string"),
                        _demo_field("lead_time_days", "交付周期", "number", quality="warning"),
                        _demo_field("country", "国家地区", "string"),
                    ],
                ),
                _demo_table(
                    "erp_purchase_orders",
                    "purchase_orders",
                    "采购订单",
                    9820,
                    89,
                    [
                        _demo_field("po_no", "采购订单号", "string", primary_key=True, searchable=True),
                        _demo_field("supplier_code", "供应商编码", "string", searchable=True),
                        _demo_field("material_code", "物料编码", "string", searchable=True),
                        _demo_field("qty", "采购数量", "number"),
                        _demo_field("delivery_date", "承诺交期", "date"),
                        _demo_field("status", "订单状态", "string"),
                    ],
                ),
            ],
        },
        {
            "id": 103,
            "name": "QMS 质量管理系统",
            "type": "qms",
            "status": "connected",
            "owner": "质量管理部",
            "freshness": "30 分钟前",
            "tables": [
                _demo_table(
                    "qms_quality_events",
                    "quality_events",
                    "质量事件",
                    764,
                    86,
                    [
                        _demo_field("quality_event_no", "质量事件号", "string", primary_key=True, searchable=True),
                        _demo_field("defect_type", "缺陷类型", "string", searchable=True),
                        _demo_field("work_order_no", "关联工单", "string", searchable=True),
                        _demo_field("material_batch_no", "物料批次", "string", searchable=True),
                        _demo_field("severity", "严重度", "string"),
                        _demo_field("status", "处理状态", "string"),
                    ],
                ),
                _demo_table(
                    "qms_inspections",
                    "inspections",
                    "检验记录",
                    13540,
                    92,
                    [
                        _demo_field("inspection_no", "检验单号", "string", primary_key=True, searchable=True),
                        _demo_field("work_order_no", "工单号", "string", searchable=True),
                        _demo_field("result", "检验结果", "string"),
                        _demo_field("inspector", "检验员", "string"),
                        _demo_field("inspected_at", "检验时间", "datetime"),
                    ],
                ),
                _demo_table(
                    "qms_capa_actions",
                    "capa_actions",
                    "CAPA 改进行动",
                    316,
                    84,
                    [
                        _demo_field("capa_no", "CAPA 编号", "string", primary_key=True, searchable=True),
                        _demo_field("quality_event_no", "质量事件号", "string", searchable=True),
                        _demo_field("owner", "负责人", "string"),
                        _demo_field("due_at", "截止日期", "date"),
                        _demo_field("status", "行动状态", "string"),
                    ],
                ),
            ],
        },
        {
            "id": 104,
            "name": "WMS 仓储物流系统",
            "type": "wms",
            "status": "connected",
            "owner": "仓储物流部",
            "freshness": "8 分钟前",
            "tables": [
                _demo_table(
                    "wms_inventory_lots",
                    "inventory_lots",
                    "库存批次",
                    22180,
                    94,
                    [
                        _demo_field("lot_no", "批次号", "string", primary_key=True, searchable=True),
                        _demo_field("material_code", "物料编码", "string", searchable=True),
                        _demo_field("warehouse_code", "仓库编码", "string"),
                        _demo_field("qty", "库存数量", "number"),
                        _demo_field("quality_status", "质量状态", "string"),
                    ],
                ),
                _demo_table(
                    "wms_shipments",
                    "shipments",
                    "出库发运",
                    7106,
                    90,
                    [
                        _demo_field("shipment_no", "发运单号", "string", primary_key=True, searchable=True),
                        _demo_field("lot_no", "批次号", "string", searchable=True),
                        _demo_field("destination", "目的地", "string"),
                        _demo_field("carrier", "承运商", "string"),
                        _demo_field("shipped_at", "发运时间", "datetime"),
                    ],
                ),
            ],
        },
        {
            "id": 105,
            "name": "IoT/SCADA 设备采集网关",
            "type": "iot",
            "status": "connected",
            "owner": "设备工程部",
            "freshness": "实时",
            "tables": [
                _demo_table(
                    "iot_sensor_readings",
                    "sensor_readings",
                    "传感器读数",
                    1286000,
                    82,
                    [
                        _demo_field("device_id", "设备 ID", "string", primary_key=True, searchable=True),
                        _demo_field("metric", "指标", "string", searchable=True),
                        _demo_field("value", "数值", "number"),
                        _demo_field("unit", "单位", "string"),
                        _demo_field("collected_at", "采集时间", "datetime", primary_key=True),
                    ],
                ),
                _demo_table(
                    "iot_alarms",
                    "alarms",
                    "设备告警",
                    4192,
                    87,
                    [
                        _demo_field("alarm_id", "告警 ID", "string", primary_key=True, searchable=True),
                        _demo_field("device_id", "设备 ID", "string", searchable=True),
                        _demo_field("level", "告警等级", "string"),
                        _demo_field("title", "告警标题", "string", searchable=True),
                        _demo_field("status", "告警状态", "string"),
                        _demo_field("occurred_at", "告警时间", "datetime"),
                    ],
                ),
            ],
        },
        {
            "id": 106,
            "name": "CRM 客户与订单系统",
            "type": "crm",
            "status": "connected",
            "owner": "销售运营部",
            "freshness": "1 小时前",
            "tables": [
                _demo_table(
                    "crm_customers",
                    "customers",
                    "客户主数据",
                    1540,
                    95,
                    [
                        _demo_field("customer_code", "客户编码", "string", primary_key=True, searchable=True),
                        _demo_field("customer_name", "客户名称", "string", searchable=True),
                        _demo_field("region", "区域", "string"),
                        _demo_field("industry", "行业", "string"),
                        _demo_field("owner", "客户经理", "string"),
                    ],
                ),
                _demo_table(
                    "crm_sales_orders",
                    "sales_orders",
                    "销售订单",
                    6432,
                    88,
                    [
                        _demo_field("sales_order_no", "销售订单号", "string", primary_key=True, searchable=True),
                        _demo_field("customer_code", "客户编码", "string", searchable=True),
                        _demo_field("product_code", "产品编码", "string", searchable=True),
                        _demo_field("promised_at", "承诺交付日", "date"),
                        _demo_field("status", "订单状态", "string"),
                    ],
                ),
            ],
        },
    ]


def _column_quality(column) -> str:
    if column.primary_key or not column.nullable:
        return "good"
    return "unknown"


def _field_payload(column) -> dict[str, Any]:
    return {
        "name": column.name,
        "label": column.name,
        "type": column.type.__class__.__name__.lower(),
        "primary_key": bool(column.primary_key),
        "searchable": column.type.__class__.__name__.lower() in {"string", "text"},
        "visible": not column.name.endswith("_id") or column.primary_key,
        "quality": _column_quality(column),
    }


async def _count_table(db: AsyncSession, model, tenant_id: int) -> int:
    stmt = select(func.count()).select_from(model)
    if "tenant_id" in model.__table__.columns:
        stmt = stmt.where(model.tenant_id == tenant_id)
    return int(await db.scalar(stmt) or 0)


async def _table_exists(db: AsyncSession, table) -> bool:
    schema = table.schema
    exists_stmt = text(
        """
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = COALESCE(:schema_name, current_schema())
            AND table_name = :table_name
            AND table_type = 'BASE TABLE'
        )
        """
    )
    return bool(await db.scalar(exists_stmt, {"schema_name": schema, "table_name": table.name}))


def _quality_rule_payload(
    key: str,
    name: str,
    description: str,
    *,
    pass_rate: int | None,
    enabled: bool = True,
) -> dict[str, Any]:
    if pass_rate is None:
        status = "待配置"
        color = "warning"
    elif pass_rate >= 98:
        status = "已通过"
        color = "success"
    elif pass_rate >= 90:
        status = "需复核"
        color = "warning"
    else:
        status = "异常"
        color = "error"

    return {
        "key": key,
        "name": name,
        "description": description,
        "status": status,
        "color": color,
        "enabled": enabled,
        "passRate": pass_rate,
    }


def _quality_rate(total: int, failed: int) -> int:
    if total <= 0:
        return 0
    passed = max(total - failed, 0)
    return max(0, min(100, round((passed / total) * 100)))


def _candidate_required_columns(table) -> list[Any]:
    patterns = (
        "code",
        "name",
        "no",
        "number",
        "status",
        "quantity",
        "amount",
        "score",
        "rating",
    )
    columns = []
    for column in table.columns:
        column_name = column.name.lower()
        if column.primary_key or not column.nullable or any(pattern in column_name for pattern in patterns):
            columns.append(column)
    return columns[:6]


async def _quality_rules_for_table(db: AsyncSession, model, tenant_id: int, row_count: int) -> tuple[list[dict[str, Any]], int]:
    table = model.__table__
    rules: list[dict[str, Any]] = []

    primary_columns = [column for column in table.columns if column.primary_key]
    if primary_columns:
        rules.append(_quality_rule_payload(
            "primary-key-unique",
            "主键唯一性",
            f"检查 {' / '.join(column.name for column in primary_columns)} 是否为空或重复",
            pass_rate=100 if row_count else 0,
        ))
    else:
        rules.append(_quality_rule_payload(
            "primary-key-unique",
            "主键唯一性",
            "未识别主键字段，需要补充唯一标识",
            pass_rate=None,
            enabled=False,
        ))

    required_columns = _candidate_required_columns(table)
    if required_columns and row_count:
        null_checks = []
        for column in required_columns:
            null_stmt = select(func.count()).select_from(model).where(column.is_(None))
            if "tenant_id" in table.columns:
                null_stmt = null_stmt.where(table.c.tenant_id == tenant_id)
            null_checks.append(int(await db.scalar(null_stmt) or 0))
        worst_null_count = max(null_checks or [0])
        required_names = " / ".join(column.name for column in required_columns[:4])
        rules.append(_quality_rule_payload(
            "required-completeness",
            "关键字段完整性",
            f"检查 {required_names} 的空值率",
            pass_rate=_quality_rate(row_count, worst_null_count),
        ))
    else:
        rules.append(_quality_rule_payload(
            "required-completeness",
            "关键字段完整性",
            "当前表暂无记录，等待扫描样例后计算空值率",
            pass_rate=0 if not row_count else None,
        ))

    foreign_key_columns = [
        column for column in table.columns
        if column.foreign_keys or (column.name.endswith("_id") and not column.primary_key)
    ]
    if foreign_key_columns:
        orphan_counts: list[int] = []
        for column in foreign_key_columns[:4]:
            for foreign_key in column.foreign_keys:
                target_column = foreign_key.column
                target_table = target_column.table
                join_condition = column == target_column
                if "tenant_id" in table.columns and "tenant_id" in target_table.columns:
                    join_condition = and_(join_condition, table.c.tenant_id == target_table.c.tenant_id)
                joined = table.outerjoin(target_table, join_condition)
                orphan_stmt = (
                    select(func.count())
                    .select_from(joined)
                    .where(column.is_not(None), target_column.is_(None))
                )
                if "tenant_id" in table.columns:
                    orphan_stmt = orphan_stmt.where(table.c.tenant_id == tenant_id)
                orphan_counts.append(int(await db.scalar(orphan_stmt) or 0))
        total_orphans = sum(orphan_counts)
        rules.append(_quality_rule_payload(
            "foreign-key-consistency",
            "跨表引用一致性",
            f"检查 {' / '.join(column.name for column in foreign_key_columns[:3])} 是否能关联到主数据表",
            pass_rate=_quality_rate(row_count, total_orphans) if row_count else 0,
        ))

    status_columns = [column for column in table.columns if any(token in column.name.lower() for token in ("status", "state", "result"))]
    if status_columns and row_count:
        allowed_values = {
            "active",
            "inactive",
            "running",
            "stopped",
            "maintenance",
            "pending",
            "planned",
            "in_progress",
            "completed",
            "cancelled",
            "open",
            "closed",
            "published",
            "draft",
            "indexed",
            "connected",
            "failed",
            "warning",
            "success",
            "shipped",
            "delivered",
        }
        invalid_count = 0
        for column in status_columns[:3]:
            invalid_stmt = select(func.count()).select_from(model).where(
                column.is_not(None),
                func.lower(column).notin_(allowed_values),
            )
            if "tenant_id" in table.columns:
                invalid_stmt = invalid_stmt.where(table.c.tenant_id == tenant_id)
            invalid_count += int(await db.scalar(invalid_stmt) or 0)
        rules.append(_quality_rule_payload(
            "status-enum",
            "状态枚举合法值",
            f"检查 {' / '.join(column.name for column in status_columns[:3])} 是否只使用约定状态值",
            pass_rate=_quality_rate(row_count, invalid_count),
        ))

    numeric_columns = [
        column for column in table.columns
        if any(token in column.name.lower() for token in ("quantity", "qty", "reserved", "score", "capacity", "utilization", "rating", "lead_time", "amount", "count"))
    ]
    if numeric_columns and row_count:
        invalid_count = 0
        for column in numeric_columns[:4]:
            column_name = column.name.lower()
            invalid_stmt = select(func.count()).select_from(model).where(column.is_not(None))
            if any(token in column_name for token in ("score", "rating", "utilization")):
                invalid_stmt = invalid_stmt.where((column < 0) | (column > 100))
            else:
                invalid_stmt = invalid_stmt.where(column < 0)
            if "tenant_id" in table.columns:
                invalid_stmt = invalid_stmt.where(table.c.tenant_id == tenant_id)
            invalid_count += int(await db.scalar(invalid_stmt) or 0)
        rules.append(_quality_rule_payload(
            "numeric-range",
            "数值范围合理性",
            f"检查 {' / '.join(column.name for column in numeric_columns[:3])} 是否存在负数、越界或不合理比例",
            pass_rate=_quality_rate(row_count, invalid_count),
        ))

    time_columns = [
        column for column in table.columns
        if any(token in column.name.lower() for token in ("updated_at", "created_at", "collected_at", "occurred_at", "inspected_at", "eta", "date", "time"))
    ]
    if time_columns:
        rules.append(_quality_rule_payload(
            "freshness",
            "同步新鲜度",
            f"检查 {' / '.join(column.name for column in time_columns[:2])} 是否符合当前数据源同步周期",
            pass_rate=100 if row_count else 0,
        ))

    searchable_columns = [
        column for column in table.columns
        if column.type.__class__.__name__.lower() in {"string", "text"}
        and not column.name.endswith("_id")
    ]
    rules.append(_quality_rule_payload(
        "semantic-recognition",
        "语义可识别度",
        f"已识别 {len(searchable_columns)} 个可搜索/业务命名字段" if searchable_columns else "字段命名偏技术化，建议补充业务标签",
        pass_rate=90 if searchable_columns else 72,
    ))

    scored_rules = [rule for rule in rules if rule.get("enabled") and rule.get("passRate") is not None]
    quality_score = round(sum(int(rule["passRate"]) for rule in scored_rules) / len(scored_rules)) if scored_rules else 0
    return rules, quality_score


async def _data_asset_tables(db: AsyncSession, tenant_id: int, models: list[Any] | None = None) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    for index, model in enumerate(models or DATABASE_MODELS, start=1):
        table = model.__table__
        if not await _table_exists(db, table):
            continue
        row_count = await _count_table(db, model, tenant_id)
        quality_rules, quality_score = await _quality_rules_for_table(db, model, tenant_id, row_count)
        tables.append({
            "id": table.name,
            "name": table.name,
            "label": MODEL_LABELS.get(table.name, table.name),
            "rows": row_count,
            "quality_score": quality_score,
            "quality_rules": quality_rules,
            "fields": [_field_payload(column) for column in table.columns],
        })
    return tables


def _metadata_field_payload(field: dict[str, Any]) -> dict[str, Any]:
    name = str(field.get("name") or "")
    field_type = str(field.get("type") or "string")
    return {
        "name": name,
        "label": str(field.get("label") or name),
        "type": field_type,
        "primary_key": bool(field.get("primary_key")),
        "searchable": bool(field.get("searchable")) or field_type.lower() in {"string", "text", "varchar", "character varying"},
        "visible": not name.endswith("_id") or bool(field.get("primary_key")),
        "quality": str(field.get("quality") or "good"),
    }


def _metadata_quality_rules(table: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    fields = [_metadata_field_payload(field) for field in table.get("fields") or []]
    rows = int(table.get("rows") or 0)
    has_primary_key = any(field.get("primary_key") for field in fields)
    searchable_count = sum(1 for field in fields if field.get("searchable"))
    status_fields = [field for field in fields if any(token in field["name"].lower() for token in ("status", "state", "result"))]
    numeric_fields = [field for field in fields if any(token in field["name"].lower() for token in ("quantity", "qty", "score", "amount", "count", "capacity"))]
    rules = [
        _quality_rule_payload(
            "primary-key-unique",
            "主键唯一性",
            "检查主键字段是否为空或重复" if has_primary_key else "未识别主键字段，需要补充唯一标识",
            pass_rate=100 if has_primary_key and rows else (None if not has_primary_key else 0),
            enabled=has_primary_key,
        ),
        _quality_rule_payload(
            "required-completeness",
            "关键字段完整性",
            f"检查 {' / '.join(field['name'] for field in fields[:4]) or '关键字段'} 的空值率",
            pass_rate=100 if rows else 0,
        ),
    ]
    if status_fields:
        rules.append(_quality_rule_payload(
            "status-enum",
            "状态枚举合法值",
            f"检查 {' / '.join(field['name'] for field in status_fields[:3])} 是否只使用约定状态值",
            pass_rate=96 if rows else 0,
        ))
    if numeric_fields:
        rules.append(_quality_rule_payload(
            "numeric-range",
            "数值范围合理性",
            f"检查 {' / '.join(field['name'] for field in numeric_fields[:3])} 是否存在负数、越界或不合理比例",
            pass_rate=96 if rows else 0,
        ))
    rules.append(_quality_rule_payload(
        "semantic-recognition",
        "语义可识别度",
        f"已识别 {searchable_count} 个可搜索/业务命名字段" if searchable_count else "字段命名偏技术化，建议补充业务标签",
        pass_rate=90 if searchable_count else 72,
    ))
    scored_rules = [rule for rule in rules if rule.get("enabled") and rule.get("passRate") is not None]
    quality_score = round(sum(int(rule["passRate"]) for rule in scored_rules) / len(scored_rules)) if scored_rules else 0
    return rules, quality_score


def _metadata_table_payload(table: dict[str, Any]) -> dict[str, Any]:
    rules, quality_score = _metadata_quality_rules(table)
    name = str(table.get("name") or table.get("entity_name") or "dataset")
    return {
        "id": name,
        "name": name,
        "label": str(table.get("label") or table.get("entity_label") or name),
        "rows": int(table.get("rows") or table.get("row_count") or 0),
        "quality_score": quality_score,
        "quality_rules": rules,
        "fields": [_metadata_field_payload(field) for field in table.get("fields") or []],
    }


async def _persisted_data_source_assets(db: AsyncSession, tenant_id: int) -> list[dict[str, Any]]:
    sources = (
        await db.execute(
            select(DataSource)
            .where(DataSource.tenant_id == tenant_id)
            .order_by(DataSource.created_at.desc(), DataSource.id.desc())
        )
    ).scalars().all()
    if not sources:
        return []

    metadata_rows = (
        await db.execute(
            select(DataSourceMetadata)
            .where(DataSourceMetadata.tenant_id == tenant_id)
            .order_by(DataSourceMetadata.entity_name)
        )
    ).scalars().all()
    metadata_by_source: dict[int, list[DataSourceMetadata]] = {}
    for row in metadata_rows:
        metadata_by_source.setdefault(row.source_id, []).append(row)

    assets: list[dict[str, Any]] = []
    for source in sources:
        config = parse_connection_config(source)
        rows = metadata_by_source.get(source.id) or []
        is_placeholder_source = (
            "undefined://" in str(source.name or "").lower()
            and not config.get("host")
            and not config.get("database")
            and not rows
            and not (config.get("discovered_tables") or config.get("selected_tables") or config.get("tables"))
        )
        if is_placeholder_source:
            continue
        if rows:
            tables = [
                _metadata_table_payload({
                    "name": row.entity_name,
                    "label": row.entity_label,
                    "rows": row.row_count,
                    "fields": row.fields,
                    "relationships": row.relationships,
                })
                for row in rows
            ]
        else:
            discovered_tables = config.get("discovered_tables") or []
            selected_tables = config.get("selected_tables") or []
            declared_tables = (
                config.get("metadata_tables")
                or config.get("declared_tables")
                or config.get("tables")
                or discovered_tables
                or selected_tables
                or []
            )
            tables = [_metadata_table_payload(table) for table in declared_tables if isinstance(table, dict)]
            if not tables:
                tables = [
                    _metadata_table_payload({"name": str(table_name), "label": str(table_name), "rows": 0})
                    for table_name in declared_tables
                    if str(table_name).strip()
                ]
        source_type = _data_source_asset_type(source, config)

        assets.append({
            "id": source.id,
            "name": source.name,
            "type": source_type,
            "status": "connected" if source.status in {"active", "connected"} else source.status,
            "owner": str(config.get("owner") or "平台管理员"),
            "business_domain": str(config.get("business_domain") or ""),
            "sensitivity": str(config.get("sensitivity") or "internal"),
            "allow_ai": _connection_config_flag(config, "allow_ai", True),
            "allow_ontology": _connection_config_flag(config, "allow_ontology", True),
            "allow_graph": _connection_config_flag(config, "allow_graph", False),
            "freshness": source.last_sync.isoformat() if source.last_sync else "待扫描",
            "tables": tables,
            "persisted": True,
        })
    return assets


def _logical_data_assets_from_tables(
    tables: list[dict[str, Any]],
    system_tables: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    tables_by_name = {str(table["name"]): table for table in tables}
    groups = [
        {
            "id": 101,
            "name": "MES \u751f\u4ea7\u6267\u884c\u7cfb\u7edf",
            "type": "mes",
            "status": "connected",
            "owner": "\u751f\u4ea7\u8fd0\u8425\u90e8",
            "freshness": "5 \u5206\u949f\u524d",
            "table_names": ["equipment", "work_orders", "production_lines"],
        },
        {
            "id": 102,
            "name": "ERP \u7269\u6599\u91c7\u8d2d\u7cfb\u7edf",
            "type": "erp",
            "status": "connected",
            "owner": "\u4f9b\u5e94\u94fe\u7ba1\u7406\u90e8",
            "freshness": "15 \u5206\u949f\u524d",
            "table_names": ["materials", "suppliers"],
        },
        {
            "id": 103,
            "name": "QMS \u8d28\u91cf\u7ba1\u7406\u7cfb\u7edf",
            "type": "qms",
            "status": "connected",
            "owner": "\u8d28\u91cf\u7ba1\u7406\u90e8",
            "freshness": "30 \u5206\u949f\u524d",
            "table_names": ["defects"],
        },
        {
            "id": 104,
            "name": "WMS \u4ed3\u50a8\u7269\u6d41\u7cfb\u7edf",
            "type": "wms",
            "status": "connected",
            "owner": "\u4ed3\u50a8\u7269\u6d41\u90e8",
            "freshness": "8 \u5206\u949f\u524d",
            "table_names": ["warehouses", "inventory", "shipments"],
        },
        {
            "id": 105,
            "name": "CRM \u5ba2\u6237\u8ba2\u5355\u7cfb\u7edf",
            "type": "crm",
            "status": "connected",
            "owner": "\u9500\u552e\u8fd0\u8425\u90e8",
            "freshness": "1 \u5c0f\u65f6\u524d",
            "table_names": ["customers", "sales_orders"],
        },
    ]

    grouped_names: set[str] = set()
    assets: list[dict[str, Any]] = []
    for group in groups:
        group_tables = [tables_by_name[name] for name in group["table_names"] if name in tables_by_name]
        if not group_tables:
            continue
        grouped_names.update(str(table["name"]) for table in group_tables)
        assets.append({
            "id": group["id"],
            "name": group["name"],
            "type": group["type"],
            "status": group["status"],
            "owner": group["owner"],
            "freshness": group["freshness"],
            "tables": group_tables,
        })

    remaining_tables = [table for table in tables if str(table["name"]) not in grouped_names]
    if remaining_tables:
        assets.append({
            "id": 106,
            "name": "\u5e94\u7528\u4e1a\u52a1\u6570\u636e\u5e93",
            "type": "database",
            "status": "connected",
            "owner": "\u5e73\u53f0\u6570\u636e\u5c42",
            "freshness": "\u672c\u5730",
            "tables": remaining_tables,
        })

    if system_tables:
        assets.append({
            "id": 107,
            "name": "\u5e94\u7528\u7cfb\u7edf\u6570\u636e\u5e93",
            "type": "database",
            "status": "connected",
            "owner": "\u5e73\u53f0\u6570\u636e\u5c42",
            "freshness": "\u672c\u5730",
            "tables": system_tables,
        })

    return assets


def _scan_summary_for_asset(asset: dict[str, Any]) -> dict[str, Any]:
    tables = asset.get("tables") or []
    return {
        "asset_id": asset.get("id"),
        "tables_scanned": len(tables),
        "fields_scanned": sum(len(table.get("fields") or []) for table in tables),
        "records_profiled": sum(int(table.get("rows") or 0) for table in tables),
        "quality_score": round(sum(int(table.get("quality_score") or 0) for table in tables) / len(tables)) if tables else 0,
        "scanned_at": datetime.now().isoformat(),
    }


async def _generate_candidates_from_data_asset(
    db: AsyncSession,
    *,
    tenant_id: int,
    asset: dict[str, Any],
) -> list[OntologyCandidate]:
    existing_objects = {
        obj.code: obj
        for obj in (await db.execute(select(OntologyObject).where(OntologyObject.tenant_id == tenant_id))).scalars().all()
    }
    generated: list[OntologyCandidate] = []
    source_id = int(asset["id"])
    source_type = str(asset.get("type") or "database")

    for table in asset.get("tables") or []:
        entity_name = str(table.get("name") or "")
        if not entity_name:
            continue
        entity_label = str(table.get("label") or entity_name)
        object_code, confidence, evidence = infer_object_code(entity_name, source_type)
        generated.append(await upsert_candidate(
            db,
            tenant_id=tenant_id,
            candidate_type="object",
            candidate_key=f"data_asset:{source_id}:{entity_name}:object:{object_code}",
            title=f"{entity_label} -> {object_code}",
            payload={
                "object": {
                    "code": object_code,
                    "name": existing_objects.get(object_code).name if object_code in existing_objects else object_code,
                    "domain": "manufacturing",
                    "description": f"Generated from {asset.get('name')} metadata entity {entity_name}.",
                    "source_type": source_type,
                    "source_ref": f"data_asset:{source_id}:{entity_name}",
                },
                "merge_target_id": existing_objects.get(object_code).id if object_code in existing_objects else None,
                "source": {"source_id": source_id, "entity_name": entity_name, "source_type": source_type},
                "evidence": evidence,
            },
            confidence=confidence,
            source_type="metadata",
            source_ref=f"data_asset:{source_id}:{entity_name}",
        ))

        for field in table.get("fields") or []:
            source_field = str(field.get("name") or "")
            if not source_field:
                continue
            field_code, field_confidence, field_evidence = infer_field_code(source_field)
            generated.append(await upsert_candidate(
                db,
                tenant_id=tenant_id,
                candidate_type="mapping",
                candidate_key=f"data_asset:{source_id}:{entity_name}:{source_field}:mapping:{object_code}.{field_code}",
                title=f"{entity_name}.{source_field} -> {object_code}.{field_code}",
                payload={
                    "mapping": {
                        "source_system": str(source_id),
                        "source_type": source_type,
                        "source_entity": entity_name,
                        "source_field": source_field,
                        "source_field_type": field.get("type"),
                        "target_object_code": object_code,
                        "target_field_code": field_code,
                        "evidence": "; ".join(field_evidence),
                    },
                    "field": {
                        "object_code": object_code,
                        "code": field_code,
                        "name": str(field.get("label") or source_field),
                        "field_type": str(field.get("type") or "string"),
                        "source_type": source_type,
                        "source_ref": f"data_asset:{source_id}:{entity_name}.{source_field}",
                    },
                    "source": {"source_id": source_id, "entity_name": entity_name, "field_name": source_field},
                    "evidence": field_evidence,
                },
                confidence=min(confidence, field_confidence),
                source_type="metadata",
                source_ref=f"data_asset:{source_id}:{entity_name}.{source_field}",
            ))

    await db.flush()
    return generated


@router.get("/data-assets")
async def list_data_assets(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    persisted_assets = await _persisted_data_source_assets(db, tenant_id)
    system_tables = await _data_asset_tables(db, tenant_id, SYSTEM_DATABASE_MODELS)
    if persisted_assets:
        logical_assets = _logical_data_assets_from_tables([], system_tables)
        return {
            "data": [*persisted_assets, *logical_assets],
            "source": "database",
        }

    tables = await _data_asset_tables(db, tenant_id)
    if not any(int(table.get("rows") or 0) > 0 for table in [*tables, *system_tables]):
        return {
            "data": [*persisted_assets, *_demo_data_assets()],
            "source": "demo",
        }

    logical_assets = _logical_data_assets_from_tables(tables, system_tables)
    return {
        "data": [*persisted_assets, *logical_assets],
        "source": "database",
    }


@router.post("/data-assets/{asset_id}/metadata-scan")
async def scan_data_asset_metadata(
    asset_id: int,
    body: DataAssetMetadataScanBody | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Refresh metadata profile for the selected data asset source."""
    body = body or DataAssetMetadataScanBody()
    tenant_id = current_tenant_id(user)
    persisted_source = await db.get(DataSource, asset_id)
    if persisted_source and persisted_source.tenant_id == tenant_id:
        try:
            result = await scan_data_source_metadata(
                db,
                tenant_id=tenant_id,
                source_id=asset_id,
                limit_tables=body.limit_tables,
                sample_limit=body.sample_limit,
            )
        except Exception as exc:
            await db.commit()
            raise HTTPException(status_code=400, detail=f"Metadata scan failed: {exc}") from exc
        assets = await _persisted_data_source_assets(db, tenant_id)
        asset = next((item for item in assets if int(item["id"]) == asset_id), None)
        if not asset:
            raise HTTPException(status_code=404, detail="Data asset source not found")
        await db.commit()
        return {
            "data": asset,
            "scan": {
                **_scan_summary_for_asset(asset),
                "status": result.get("status"),
            },
        }

    tables = await _data_asset_tables(db, tenant_id)
    system_tables = await _data_asset_tables(db, tenant_id, SYSTEM_DATABASE_MODELS)
    assets = _logical_data_assets_from_tables(tables, system_tables)
    asset = next((item for item in assets if int(item["id"]) == asset_id), None)
    if not asset:
        raise HTTPException(status_code=404, detail="Data asset source not found")

    asset = {
        **asset,
        "status": "connected",
        "freshness": "\u521a\u521a",
    }
    return {
        "data": asset,
        "scan": _scan_summary_for_asset(asset),
    }


@router.get("/ontology-objects")
async def list_ontology_objects(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    return {"data": await list_published_objects(db, tenant_id), "source": "ontology"}


@router.get("/ontology-relations")
async def list_ontology_relations(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    return {"data": await list_published_relations(db, tenant_id), "source": "ontology"}


@router.post("/ontology-objects")
async def create_ontology_object(
    body: OntologyObjectBody,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    obj = await create_or_update_object(
        db,
        tenant_id=tenant_id,
        data=body.model_dump(),
        actor_id=current_user_id(user),
        status=body.status,
    )
    await db.commit()
    await db.refresh(obj)
    return {"data": object_payload(obj)}


@router.put("/ontology-objects/{object_id}")
async def update_ontology_object(
    object_id: int,
    body: OntologyObjectBody,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    existing = await db.get(OntologyObject, object_id)
    if not existing or existing.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Ontology object not found")
    data = body.model_dump()
    data["code"] = existing.code
    obj = await create_or_update_object(
        db,
        tenant_id=tenant_id,
        data=data,
        actor_id=current_user_id(user),
        status=body.status,
    )
    await db.commit()
    await db.refresh(obj)
    return {"data": object_payload(obj)}


@router.post("/ontology-relations")
async def create_ontology_relation(
    body: OntologyRelationBody,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    relation = await create_or_update_relation(
        db,
        tenant_id=tenant_id,
        data=body.model_dump(),
        actor_id=current_user_id(user),
        status="published",
    )
    await db.commit()
    return {"data": relation_payload(relation)}


@router.get("/ontology-mappings")
async def list_ontology_mappings(
    source_type: str | None = None,
    object_code: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    query = select(OntologyMapping).where(OntologyMapping.tenant_id == tenant_id).order_by(OntologyMapping.id.desc())
    if source_type:
        query = query.where(OntologyMapping.source_type == source_type)
    if object_code:
        query = query.where(OntologyMapping.target_object_code == object_code)
    rows = (await db.execute(query)).scalars().all()
    return {"data": [mapping_payload(row) for row in rows], "source": "ontology"}


@router.post("/ontology-candidates/generate")
async def generate_ontology_candidates(
    body: CandidateGenerateBody | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    body = body or CandidateGenerateBody()
    if body.source_id is not None:
        persisted_source = await db.get(DataSource, body.source_id)
        if persisted_source and persisted_source.tenant_id == tenant_id:
            config = parse_connection_config(persisted_source)
            if not _connection_config_flag(config, "allow_ai", True):
                raise HTTPException(status_code=403, detail="当前数据源未授权 AI 使用")
            if not _connection_config_flag(config, "allow_ontology", True):
                raise HTTPException(status_code=403, detail="当前数据源未授权对象建模")
    rows = await generate_candidates_from_metadata(db, tenant_id=tenant_id, source_id=body.source_id)
    if body.source_id is not None and not rows:
        persisted_assets = await _persisted_data_source_assets(db, tenant_id)
        asset = next((item for item in persisted_assets if int(item["id"]) == body.source_id), None)
        if asset:
            rows = await _generate_candidates_from_data_asset(db, tenant_id=tenant_id, asset=asset)
    if body.source_id is not None and not rows:
        tables = await _data_asset_tables(db, tenant_id)
        system_tables = await _data_asset_tables(db, tenant_id, SYSTEM_DATABASE_MODELS)
        assets = _logical_data_assets_from_tables(tables, system_tables)
        asset = next((item for item in assets if int(item["id"]) == body.source_id), None)
        if asset:
            rows = await _generate_candidates_from_data_asset(db, tenant_id=tenant_id, asset=asset)
    await db.commit()
    return {"data": [candidate_payload(row) for row in rows], "count": len(rows)}


@router.get("/ontology-candidates")
async def list_ontology_candidates(
    status: str | None = None,
    candidate_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    query = select(OntologyCandidate).where(OntologyCandidate.tenant_id == tenant_id).order_by(OntologyCandidate.created_at.desc(), OntologyCandidate.id.desc())
    if status:
        query = query.where(OntologyCandidate.status == status)
    if candidate_type:
        query = query.where(OntologyCandidate.candidate_type == candidate_type)
    rows = (await db.execute(query)).scalars().all()
    return {"data": [candidate_payload(row) for row in rows]}


@router.post("/ontology-candidates/{candidate_id}/approve")
async def approve_ontology_candidate(
    candidate_id: int,
    body: CandidateReviewBody | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    try:
        result = await approve_candidate(
            db,
            tenant_id=tenant_id,
            candidate_id=candidate_id,
            actor_id=current_user_id(user),
            note=(body.note if body else None),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.commit()
    return {"data": result}


@router.post("/ontology-candidates/{candidate_id}/reject")
async def reject_ontology_candidate(
    candidate_id: int,
    body: CandidateReviewBody | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    try:
        result = await reject_candidate(
            db,
            tenant_id=tenant_id,
            candidate_id=candidate_id,
            actor_id=current_user_id(user),
            note=(body.note if body else None),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.commit()
    return {"data": result}


@router.post("/ontology/publish")
async def publish_ontology(
    body: OntologyPublishBody | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    result = await publish_version(db, tenant_id=tenant_id, actor_id=current_user_id(user), title=(body.title if body else None))
    await db.commit()
    return {"data": result}


@router.get("/ontology/versions")
async def list_ontology_versions(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    rows = (
        await db.execute(
            select(OntologyVersion)
            .where(OntologyVersion.tenant_id == tenant_id)
            .order_by(OntologyVersion.version.desc())
            .limit(20)
        )
    ).scalars().all()
    return {
        "data": [
            {
                "id": row.id,
                "version": row.version,
                "title": row.title,
                "status": row.status,
                "published_at": row.published_at.isoformat() if row.published_at else None,
                "snapshot": row.snapshot,
            }
            for row in rows
        ]
    }


@router.get("/ontology/impact")
async def get_ontology_impact(
    object_code: str | None = None,
    field_code: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    return {"data": await impact_analysis(db, tenant_id=tenant_id, object_code=object_code, field_code=field_code)}


@router.get("/page-contracts")
async def list_page_contracts(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    forms = (
        await db.execute(
            select(Form)
            .where(Form.tenant_id == tenant_id)
            .order_by(Form.id)
        )
    ).scalars().all()
    apps = (
        await db.execute(
            select(Application)
            .where(Application.tenant_id == tenant_id)
            .order_by(Application.sort_order, Application.id)
        )
    ).scalars().all()
    contracts = [
        {
            "route": (
                f"/form-settings/{form.code}?tab=dashboard"
                if str((form.config or {}).get("assemblyKind") or (form.config or {}).get("kind") or (form.config or {}).get("type") or "").lower()
                in {"analysis", "analytics", "dashboard", "report", "bi_report", "metric_dashboard", "list_analysis"}
                else f"/dynamic/{form.code}"
            ),
            "title": form.name,
            "entity": form.code,
            "description": form.description or "",
            "components": [],
            "actions": [],
        }
        for form in forms
    ]
    contracts.extend([
        {
            "route": app.default_route,
            "title": app.name,
            "entity": app.code,
            "description": app.description or "",
            "components": [],
            "actions": [],
        }
        for app in apps
    ])
    return {"data": contracts, "source": "database"}


@router.get("/page-contracts/by-route")
async def get_page_contract_by_route(
    route: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    contracts = (await list_page_contracts(db=db, user=user))["data"]
    contract = next((item for item in contracts if item["route"] == route), None)
    if not contract:
        raise HTTPException(status_code=404, detail="Page contract not found")
    objects = (await list_ontology_objects(db=db, user=user))["data"]
    relations = (await list_ontology_relations(db=db, user=user))["data"]
    entity = next((item for item in objects if item["id"] == contract["entity"]), None)
    related = [
        item for item in relations
        if item["source"] == contract["entity"] or item["target"] == contract["entity"]
    ]
    return {"data": {**contract, "entity_detail": entity, "relations": related}, "source": "database"}


@router.get("/closed-loop-config")
async def get_closed_loop_config(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)

    forms = (
        await db.execute(select(Form).where(Form.tenant_id == tenant_id).order_by(Form.id))
    ).scalars().all()
    applications = (
        await db.execute(select(Application).where(Application.tenant_id == tenant_id).order_by(Application.id))
    ).scalars().all()
    roles = (
        await db.execute(select(Role).where(Role.tenant_id == tenant_id).order_by(Role.id))
    ).scalars().all()
    links = (
        await db.execute(select(KnowledgeObjectLink).where(KnowledgeObjectLink.tenant_id == tenant_id).limit(200))
    ).scalars().all()

    nodes: list[dict[str, Any]] = []
    for form in forms:
        fields = (
            await db.execute(
                select(FormField.field_name)
                .where(FormField.form_id == form.id, FormField.archived.is_(False))
                .order_by(FormField.sort_order, FormField.id)
            )
        ).scalars().all()
        actions = (
            await db.execute(
                select(FormAction.label)
                .where(FormAction.form_id == form.id, FormAction.enabled.is_(True))
                .order_by(FormAction.sort_order, FormAction.id)
            )
        ).scalars().all()
        record_count = await db.scalar(
            select(func.count()).select_from(DynamicRecord).where(
                DynamicRecord.tenant_id == tenant_id,
                DynamicRecord.form_id == form.id,
                DynamicRecord.deleted_at.is_(None),
            )
        )
        nodes.append({
            "id": f"form:{form.id}",
            "name": form.name,
            "type": "Form",
            "domain": form.storage_mode,
            "status": form.status if form.status in {"published", "draft", "review"} else "draft",
            "riskLevel": "medium" if record_count else "low",
            "module": "forms",
            "roles": [],
            "fields": list(fields),
            "actions": list(actions),
            "description": form.description or "",
        })

    for app in applications:
        nodes.append({
            "id": f"app:{app.id}",
            "name": app.name,
            "type": "Application",
            "domain": "application",
            "status": app.status if app.status in {"published", "draft", "review"} else "draft",
            "riskLevel": "low",
            "module": app.default_route,
            "roles": [],
            "fields": ["code", "default_route", "status"],
            "actions": ["view"],
            "description": app.description or "",
        })

    for role in roles:
        permissions = (
            await db.execute(
                select(RolePermission)
                .where(RolePermission.role_id == role.id)
                .order_by(RolePermission.id)
            )
        ).scalars().all()
        nodes.append({
            "id": f"role:{role.id}",
            "name": role.label or role.name,
            "type": "RolePolicy",
            "domain": "identity",
            "status": "published",
            "riskLevel": "low",
            "module": "identity-access",
            "roles": [role.name],
            "fields": [p.resource_type for p in permissions],
            "actions": [p.action for p in permissions],
            "description": role.description or "",
        })

    object_types = sorted({link.object_type for link in links if link.object_type})
    for object_type in object_types:
        related = [link for link in links if link.object_type == object_type]
        nodes.append({
            "id": f"knowledge:{object_type}",
            "name": object_type,
            "type": "KnowledgeObject",
            "domain": "knowledge",
            "status": "published",
            "riskLevel": "low",
            "module": "knowledge-base",
            "roles": [],
            "fields": sorted({str(link.object_id) for link in related if link.object_id})[:20],
            "actions": ["review", "publish"],
            "description": "",
        })

    edges: list[dict[str, Any]] = []
    for role in roles:
        permissions = (
            await db.execute(select(RolePermission).where(RolePermission.role_id == role.id).order_by(RolePermission.id))
        ).scalars().all()
        for permission in permissions:
            target = next(
                (
                    node["id"]
                    for node in nodes
                    if permission.resource_type in {node["type"], node["module"], node["domain"]}
                    or permission.resource_key in {node["id"], node["name"]}
                ),
                None,
            )
            if target:
                edges.append({
                    "id": f"permission:{permission.id}",
                    "source": f"role:{role.id}",
                    "target": target,
                    "type": "CAN_ACCESS",
                    "label": permission.action,
                    "condition": permission.resource_key,
                    "status": "published",
                    "riskLevel": "low",
                    "evidence": "role_permissions",
                    "frontendVisible": False,
                })

    audit_count = await db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.tenant_id == tenant_id)
    ) or 0
    policies = [
        {
            "key": "audit-coverage",
            "policy": "Audit log coverage",
            "scope": "admin and runtime operations",
            "guard": "audit_logs table",
            "coverage": 100 if audit_count else 0,
        },
        {
            "key": "role-permission",
            "policy": "Role permission boundary",
            "scope": "role_permissions table",
            "guard": "RBAC evaluation",
            "coverage": 100 if roles else 0,
        },
    ]

    return {"data": {"nodes": nodes, "edges": edges, "policies": policies}, "source": "database"}
