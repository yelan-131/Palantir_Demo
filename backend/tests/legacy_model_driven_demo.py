"""Manufacturing demo catalogue used by legacy model-driven tests.

The platform defaults in `app.api._model_driven_shared` are domain-neutral and
start empty. Tests that exercise the legacy model-driven, rules, search and
config import/export paths install this catalogue through the
`legacy_model_driven_demo` fixture.
"""
from __future__ import annotations

import copy
import json

SAFE_COLUMNS: dict[str, set[str]] = {
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
    "sales_orders": {"id", "order_no", "customer_id", "product_id", "quantity", "due_date", "priority", "status"},
    "work_orders": {
        "id", "order_no", "sales_order_id", "line_id", "planned_start", "planned_end",
        "actual_start", "actual_end", "quantity", "completed_quantity", "status",
    },
    "inspections": {"id", "inspection_type", "target_type", "target_id", "result", "inspector_id", "inspected_at"},
    "defects": {"id", "inspection_id", "defect_type", "severity", "description", "root_cause", "correction"},
}
for _columns in SAFE_COLUMNS.values():
    _columns.add("tenant_id")

ENTITY_TABLE_MAP: dict[str, str] = {
    "Factory": "factories", "Workshop": "workshops", "ProductionLine": "production_lines",
    "Equipment": "equipment", "Sensor": "sensors", "Product": "products",
    "Material": "materials", "Supplier": "suppliers", "Customer": "customers",
    "Worker": "workers", "SalesOrder": "sales_orders", "WorkOrder": "work_orders",
}


def _field(id_, name, label, field_type, *, required=False, searchable=False, sortable=False,
           in_list=True, in_form=True, order=1, **extra):
    return {
        "id": id_, "field_name": name, "label": label, "field_type": field_type, "required": required,
        "searchable": searchable, "sortable": sortable, "visible_in_list": in_list,
        "visible_in_form": in_form, "sort_order": order, **extra,
    }


MOCK_MODELS: list[dict] = [
    {
        "id": 1, "name": "equipment", "label": "设备", "icon": "ToolOutlined", "table_name": "equipment",
        "description": "生产设备管理", "is_system": True,
        "fields": [
            _field(1, "name", "设备名称", "string", required=True, searchable=True, order=1),
            _field(2, "model", "设备型号", "string", searchable=True, order=2),
            _field(3, "manufacturer", "制造商", "string", searchable=True, order=3),
            _field(4, "status", "状态", "enum", searchable=True, sortable=True, order=4,
                   enum_values=json.dumps(["running", "idle", "maintenance", "fault", "offline"])),
            _field(5, "health_score", "健康评分", "float", sortable=True, in_form=False, order=5),
        ],
    },
    {
        "id": 2, "name": "supplier", "label": "供应商", "icon": "ShopOutlined", "table_name": "suppliers",
        "description": "供应商信息管理", "is_system": True,
        "fields": [
            _field(10, "name", "供应商名称", "string", required=True, searchable=True, order=1),
            _field(11, "location", "所在地区", "string", searchable=True, order=2),
            _field(12, "rating", "评级", "float", sortable=True, order=3),
            _field(13, "lead_time_days", "交货周期(天)", "int", sortable=True, order=4),
            _field(14, "contact", "联系方式", "string", searchable=True, order=5),
        ],
    },
    {
        "id": 3, "name": "product", "label": "产品", "icon": "AppstoreOutlined", "table_name": "products",
        "description": "产品信息管理", "is_system": True,
        "fields": [
            _field(20, "name", "产品名称", "string", required=True, searchable=True, order=1),
            _field(21, "sku", "SKU", "string", required=True, searchable=True, sortable=True, order=2),
            _field(22, "category", "分类", "string", searchable=True, sortable=True, order=3),
        ],
    },
]

MOCK_PAGES: list[dict] = [
    {"id": 1, "name": "equipment-list", "title": "设备管理", "paradigm": "master-detail",
     "model_id": 1, "model_name": "equipment", "config": {}, "route_path": "/dynamic/equipment-list", "is_published": True},
    {"id": 2, "name": "supplier-list", "title": "供应商管理", "paradigm": "master-detail",
     "model_id": 2, "model_name": "supplier", "config": {}, "route_path": "/dynamic/supplier-list", "is_published": True},
]

MOCK_MENUS: list[dict] = [
    {"id": 1, "parent_id": None, "title": "动态页面", "icon": "AppstoreOutlined", "route_path": None, "sort_order": 100, "is_visible": True},
    {"id": 2, "parent_id": 1, "title": "设备管理", "icon": "ToolOutlined", "route_path": "/dynamic/equipment-list", "sort_order": 101, "is_visible": True},
    {"id": 3, "parent_id": 1, "title": "供应商管理", "icon": "ShopOutlined", "route_path": "/dynamic/supplier-list", "sort_order": 102, "is_visible": True},
]

MOCK_DATA: dict[str, list[dict]] = {
    "equipment": [
        {"id": 1, "name": "DMG MORI NLX 2500", "line_id": 1, "model": "NLX2500/700", "manufacturer": "DMG MORI", "status": "running", "health_score": 92.5},
        {"id": 2, "name": "CNC加工中心-01", "line_id": 1, "model": "VMC850", "manufacturer": "大连机床", "status": "running", "health_score": 88.3},
        {"id": 3, "name": "焊接机器人-01", "line_id": 2, "model": "IRB 6700", "manufacturer": "ABB", "status": "running", "health_score": 95.1},
        {"id": 4, "name": "液压机-01", "line_id": 3, "model": "YH32-315", "manufacturer": "南通锻压", "status": "maintenance", "health_score": 72.0},
        {"id": 5, "name": "AGV-01", "line_id": 1, "model": "AGV-X100", "manufacturer": "新松机器人", "status": "idle", "health_score": 98.2},
    ],
    "suppliers": [
        {"id": 1, "name": "宝钢股份", "location": "上海市宝山区", "rating": 4.8, "lead_time_days": 5, "contact": "张经理"},
        {"id": 2, "name": "SKF中国", "location": "上海市嘉定区", "rating": 4.6, "lead_time_days": 7, "contact": "李经理"},
        {"id": 3, "name": "东北特钢集团", "location": "辽宁省大连市", "rating": 4.5, "lead_time_days": 8, "contact": "王经理"},
        {"id": 4, "name": "NOK密封技术", "location": "江苏省无锡市", "rating": 4.3, "lead_time_days": 3, "contact": "陈经理"},
    ],
    "products": [
        {"id": 1, "name": "轴承组件A-100", "sku": "BRG-A100", "category": "轴承", "specs": "外径100mm", "unit": "个"},
        {"id": 2, "name": "PCBA主控板V2", "sku": "PCB-V2", "category": "电路板", "specs": "4层板", "unit": "片"},
        {"id": 3, "name": "液压阀块HV-50", "sku": "VLV-50", "category": "阀块", "specs": "通径50mm", "unit": "个"},
    ],
}


def install(shared) -> dict:
    """Fill the shared containers in place, returning a snapshot for `restore`."""
    names = ("SAFE_COLUMNS", "ENTITY_TABLE_MAP", "MOCK_MODELS", "MOCK_PAGES", "MOCK_MENUS", "MOCK_DATA")
    snapshot = {name: copy.deepcopy(getattr(shared, name)) for name in names}
    for name in names:
        _replace(getattr(shared, name), copy.deepcopy(globals()[name]))
    return snapshot


def restore(shared, snapshot: dict) -> None:
    for name, value in snapshot.items():
        _replace(getattr(shared, name), value)


def _replace(target, value) -> None:
    target.clear()
    if isinstance(target, dict):
        target.update(value)
    else:
        target.extend(value)
