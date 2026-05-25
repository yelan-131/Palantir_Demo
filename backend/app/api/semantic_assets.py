"""Semantic asset APIs for the low-code ontology demo.

This module intentionally returns a stable demo contract first. The existing
data-source, ontology, and graph APIs remain available for deeper CRUD/query
work; these endpoints provide the product-shaped layer used by admin screens
and page settings.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()


DATA_ASSETS = [
    {
        "id": 1,
        "name": "Manufacturing PostgreSQL",
        "type": "postgresql",
        "status": "connected",
        "owner": "平台管理员",
        "freshness": "5 分钟前",
        "tables": [
            {
                "id": 101,
                "name": "equipment",
                "label": "设备主数据",
                "rows": 128,
                "quality_score": 98,
                "fields": [
                    {"name": "id", "label": "设备ID", "type": "integer", "primary_key": True, "searchable": True, "visible": False, "quality": "good"},
                    {"name": "name", "label": "设备名称", "type": "string", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "line_id", "label": "产线ID", "type": "integer", "primary_key": False, "searchable": True, "visible": False, "quality": "good"},
                    {"name": "model", "label": "型号", "type": "string", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "status", "label": "状态", "type": "enum", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "health_score", "label": "健康分", "type": "float", "primary_key": False, "searchable": False, "visible": True, "quality": "warning"},
                ],
            },
            {
                "id": 102,
                "name": "work_orders",
                "label": "维修/生产工单",
                "rows": 246,
                "quality_score": 94,
                "fields": [
                    {"name": "id", "label": "工单ID", "type": "integer", "primary_key": True, "searchable": True, "visible": False, "quality": "good"},
                    {"name": "order_no", "label": "工单编号", "type": "string", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "line_id", "label": "产线ID", "type": "integer", "primary_key": False, "searchable": True, "visible": False, "quality": "good"},
                    {"name": "status", "label": "状态", "type": "enum", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "planned_start", "label": "计划开始", "type": "datetime", "primary_key": False, "searchable": False, "visible": True, "quality": "good"},
                ],
            },
        ],
    },
    {
        "id": 2,
        "name": "Supply Chain API",
        "type": "rest_api",
        "status": "connected",
        "owner": "供应链团队",
        "freshness": "12 分钟前",
        "tables": [
            {
                "id": 201,
                "name": "suppliers",
                "label": "供应商档案",
                "rows": 56,
                "quality_score": 91,
                "fields": [
                    {"name": "id", "label": "供应商ID", "type": "integer", "primary_key": True, "searchable": True, "visible": False, "quality": "good"},
                    {"name": "name", "label": "供应商名称", "type": "string", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "rating", "label": "评级", "type": "float", "primary_key": False, "searchable": False, "visible": True, "quality": "good"},
                    {"name": "lead_time_days", "label": "交付周期", "type": "integer", "primary_key": False, "searchable": False, "visible": True, "quality": "warning"},
                ],
            },
            {
                "id": 202,
                "name": "materials",
                "label": "物料主数据",
                "rows": 430,
                "quality_score": 96,
                "fields": [
                    {"name": "id", "label": "物料ID", "type": "integer", "primary_key": True, "searchable": True, "visible": False, "quality": "good"},
                    {"name": "name", "label": "物料名称", "type": "string", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "material_type", "label": "物料类型", "type": "string", "primary_key": False, "searchable": True, "visible": True, "quality": "good"},
                    {"name": "safety_stock", "label": "安全库存", "type": "float", "primary_key": False, "searchable": False, "visible": True, "quality": "good"},
                ],
            },
        ],
    },
]


ONTOLOGY_OBJECTS = [
    {
        "id": "Device",
        "name": "设备",
        "code": "Device",
        "icon": "tool",
        "source": "equipment",
        "description": "制造现场的核心设备对象，承载健康分、状态、产线归属和维护动作。",
        "fields": [
            {"name": "name", "label": "设备名称", "type": "string", "source_field": "equipment.name", "list": True, "form": True, "search": True},
            {"name": "model", "label": "型号", "type": "string", "source_field": "equipment.model", "list": True, "form": True, "search": True},
            {"name": "status", "label": "运行状态", "type": "enum", "source_field": "equipment.status", "list": True, "form": True, "search": True},
            {"name": "health_score", "label": "健康分", "type": "float", "source_field": "equipment.health_score", "list": True, "form": False, "search": False},
        ],
    },
    {
        "id": "WorkOrder",
        "name": "工单",
        "code": "WorkOrder",
        "icon": "file",
        "source": "work_orders",
        "description": "生产和维修任务的统一工单对象。",
        "fields": [
            {"name": "order_no", "label": "工单编号", "type": "string", "source_field": "work_orders.order_no", "list": True, "form": True, "search": True},
            {"name": "status", "label": "状态", "type": "enum", "source_field": "work_orders.status", "list": True, "form": True, "search": True},
            {"name": "planned_start", "label": "计划开始", "type": "datetime", "source_field": "work_orders.planned_start", "list": True, "form": True, "search": False},
        ],
    },
    {
        "id": "Supplier",
        "name": "供应商",
        "code": "Supplier",
        "icon": "shop",
        "source": "suppliers",
        "description": "供应链中的供应商对象，承载评级、交付周期和风险动作。",
        "fields": [
            {"name": "name", "label": "供应商名称", "type": "string", "source_field": "suppliers.name", "list": True, "form": True, "search": True},
            {"name": "rating", "label": "评级", "type": "float", "source_field": "suppliers.rating", "list": True, "form": True, "search": False},
            {"name": "lead_time_days", "label": "交付周期", "type": "integer", "source_field": "suppliers.lead_time_days", "list": True, "form": True, "search": False},
        ],
    },
    {
        "id": "Material",
        "name": "物料",
        "code": "Material",
        "icon": "database",
        "source": "materials",
        "description": "供应链、库存和生产计划共用的物料对象。",
        "fields": [
            {"name": "name", "label": "物料名称", "type": "string", "source_field": "materials.name", "list": True, "form": True, "search": True},
            {"name": "material_type", "label": "物料类型", "type": "string", "source_field": "materials.material_type", "list": True, "form": True, "search": True},
            {"name": "safety_stock", "label": "安全库存", "type": "float", "source_field": "materials.safety_stock", "list": True, "form": True, "search": False},
        ],
    },
    {
        "id": "Alert",
        "name": "告警",
        "code": "Alert",
        "icon": "alert",
        "source": "alerts",
        "description": "设备、质量和供应链风险触发的异常事件。",
        "fields": [
            {"name": "title", "label": "告警标题", "type": "string", "source_field": "alerts.title", "list": True, "form": True, "search": True},
            {"name": "severity", "label": "严重度", "type": "enum", "source_field": "alerts.severity", "list": True, "form": True, "search": True},
            {"name": "created_at", "label": "触发时间", "type": "datetime", "source_field": "alerts.created_at", "list": True, "form": False, "search": False},
        ],
    },
    {
        "id": "QualityEvent",
        "name": "质量事件",
        "code": "QualityEvent",
        "icon": "check",
        "source": "defects",
        "description": "检验、缺陷、CAPA 形成的质量事件对象。",
        "fields": [
            {"name": "defect_type", "label": "缺陷类型", "type": "string", "source_field": "defects.defect_type", "list": True, "form": True, "search": True},
            {"name": "severity", "label": "严重度", "type": "enum", "source_field": "defects.severity", "list": True, "form": True, "search": True},
            {"name": "root_cause", "label": "根因", "type": "text", "source_field": "defects.root_cause", "list": False, "form": True, "search": False},
        ],
    },
]


ONTOLOGY_RELATIONS = [
    {"id": 1, "source": "Device", "type": "LOCATED_IN", "label": "位于", "target": "ProductionLine", "graph": True, "description": "设备归属到产线"},
    {"id": 2, "source": "Device", "type": "GENERATES", "label": "产生", "target": "Alert", "graph": True, "description": "设备健康异常产生告警"},
    {"id": 3, "source": "Alert", "type": "CREATES", "label": "触发", "target": "WorkOrder", "graph": True, "description": "告警触发工单处理"},
    {"id": 4, "source": "Supplier", "type": "SUPPLIES", "label": "供应", "target": "Material", "graph": True, "description": "供应商供应物料"},
    {"id": 5, "source": "QualityEvent", "type": "AFFECTS", "label": "影响", "target": "Device", "graph": True, "description": "质量事件影响设备/产线稳定性"},
    {"id": 6, "source": "Material", "type": "USED_BY", "label": "被使用于", "target": "WorkOrder", "graph": True, "description": "物料被工单消耗"},
]


PAGE_CONTRACTS = {
    "/dashboard": {
        "route": "/dashboard",
        "title": "生产态势",
        "entity": "Device",
        "description": "围绕设备和产线的生产态势总览。",
        "components": ["工厂 KPI", "OEE 趋势", "产线状态", "活动告警"],
        "actions": ["刷新数据", "导出报表", "创建告警规则"],
    },
    "/maintenance": {
        "route": "/maintenance",
        "title": "预测性维护",
        "entity": "Device",
        "description": "以设备为主对象，配置健康总览、故障预测和工单流转。",
        "components": ["设备健康总览", "健康分析", "故障预测", "工单管理"],
        "actions": ["创建维修工单", "确认告警", "查看关联图谱"],
    },
    "/quality": {
        "route": "/quality",
        "title": "质量分析",
        "entity": "QualityEvent",
        "description": "以质量事件为主对象，配置缺陷、SPC 和 CAPA 流程。",
        "components": ["质量指标", "SPC 控制图", "缺陷列表", "CAPA 跟踪"],
        "actions": ["发起复核", "创建 CAPA", "导出质量报告"],
    },
    "/supply-chain": {
        "route": "/supply-chain",
        "title": "供应链风险",
        "entity": "Supplier",
        "description": "以供应商为主对象，配置风险评分、物料影响和复核流程。",
        "components": ["供应商指标", "风险雷达", "物料影响", "供应商列表"],
        "actions": ["发起供应商复核", "查看影响路径", "生成风险报告"],
    },
    "/": {
        "route": "/",
        "title": "我的工作台",
        "entity": "Device",
        "description": "个人工作台消费多个对象的摘要，不作为单对象表单。",
        "components": ["待办任务", "最近应用", "平台状态", "数据新鲜度"],
        "actions": ["打开应用", "处理审批", "查看告警"],
    },
}


@router.get("/data-assets")
async def list_data_assets():
    return {"data": DATA_ASSETS}


@router.get("/ontology-objects")
async def list_ontology_objects():
    return {"data": ONTOLOGY_OBJECTS}


@router.get("/ontology-relations")
async def list_ontology_relations():
    return {"data": ONTOLOGY_RELATIONS}


@router.get("/page-contracts")
async def list_page_contracts():
    return {"data": list(PAGE_CONTRACTS.values())}


@router.get("/page-contracts/by-route")
async def get_page_contract_by_route(route: str):
    contract = PAGE_CONTRACTS.get(route)
    if not contract:
        raise HTTPException(status_code=404, detail="Page contract not found")
    entity = next((item for item in ONTOLOGY_OBJECTS if item["id"] == contract["entity"]), None)
    relations = [
        item
        for item in ONTOLOGY_RELATIONS
        if item["source"] == contract["entity"] or item["target"] == contract["entity"]
    ]
    return {"data": {**contract, "entity_detail": entity, "relations": relations}}

