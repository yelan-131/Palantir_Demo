"""AI Builder — model and page suggestions from natural language.

Uses simple keyword matching (no external AI call) to suggest model
definitions and page layouts based on user descriptions.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.api._model_driven_shared import MOCK_MODELS
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────

class ModelSuggestionRequest(BaseModel):
    description: str


class PageSuggestionRequest(BaseModel):
    model_name: str


# ── Keyword → field template mappings ─────────────────────

_EQUIPMENT_KEYWORDS = {"设备", "机器", "机床", "机械", "产线", "装备", "cnc", "robot"}
_ORDER_KEYWORDS = {"订单", "工单", "生产", "任务", "排产"}
_SUPPLIER_KEYWORDS = {"供应商", "采购", "物料", "进货", "供货"}
_QUALITY_KEYWORDS = {"质量", "检验", "检测", "缺陷", "质检", "品质"}
_WORKER_KEYWORDS = {"员工", "工人", "人员", "班组", "考勤"}

_GENERIC_FIELDS = [
    {"field_name": "name", "label": "名称", "field_type": "string", "required": True},
    {"field_name": "code", "label": "编号", "field_type": "string", "required": True},
    {"field_name": "status", "label": "状态", "field_type": "enum", "required": False},
    {"field_name": "description", "label": "描述", "field_type": "string", "required": False},
    {"field_name": "created_at", "label": "创建时间", "field_type": "datetime", "required": False},
]

_EQUIPMENT_FIELDS = [
    {"field_name": "name", "label": "设备名称", "field_type": "string", "required": True},
    {"field_name": "code", "label": "设备编号", "field_type": "string", "required": True},
    {"field_name": "model", "label": "设备型号", "field_type": "string", "required": False},
    {"field_name": "manufacturer", "label": "制造商", "field_type": "string", "required": False},
    {"field_name": "status", "label": "状态", "field_type": "enum", "required": False},
    {"field_name": "health_score", "label": "健康评分", "field_type": "float", "required": False},
    {"field_name": "install_date", "label": "安装日期", "field_type": "date", "required": False},
    {"field_name": "location", "label": "位置", "field_type": "string", "required": False},
]

_ORDER_FIELDS = [
    {"field_name": "order_no", "label": "工单号", "field_type": "string", "required": True},
    {"field_name": "product", "label": "产品", "field_type": "string", "required": True},
    {"field_name": "quantity", "label": "数量", "field_type": "int", "required": True},
    {"field_name": "status", "label": "状态", "field_type": "enum", "required": False},
    {"field_name": "priority", "label": "优先级", "field_type": "enum", "required": False},
    {"field_name": "planned_start", "label": "计划开始", "field_type": "datetime", "required": False},
    {"field_name": "planned_end", "label": "计划结束", "field_type": "datetime", "required": False},
    {"field_name": "assignee", "label": "负责人", "field_type": "string", "required": False},
]

_SUPPLIER_FIELDS = [
    {"field_name": "name", "label": "供应商名称", "field_type": "string", "required": True},
    {"field_name": "contact", "label": "联系人", "field_type": "string", "required": False},
    {"field_name": "phone", "label": "联系电话", "field_type": "string", "required": False},
    {"field_name": "location", "label": "地址", "field_type": "string", "required": False},
    {"field_name": "rating", "label": "评级", "field_type": "float", "required": False},
    {"field_name": "lead_time_days", "label": "交货周期(天)", "field_type": "int", "required": False},
]

_QUALITY_FIELDS = [
    {"field_name": "inspection_no", "label": "检测编号", "field_type": "string", "required": True},
    {"field_name": "inspection_type", "label": "检测类型", "field_type": "enum", "required": False},
    {"field_name": "target", "label": "检测对象", "field_type": "string", "required": True},
    {"field_name": "result", "label": "检测结果", "field_type": "enum", "required": False},
    {"field_name": "inspector", "label": "检测员", "field_type": "string", "required": False},
    {"field_name": "inspected_at", "label": "检测时间", "field_type": "datetime", "required": False},
    {"field_name": "defect_count", "label": "缺陷数量", "field_type": "int", "required": False},
]

_WORKER_FIELDS = [
    {"field_name": "name", "label": "姓名", "field_type": "string", "required": True},
    {"field_name": "employee_id", "label": "工号", "field_type": "string", "required": True},
    {"field_name": "department", "label": "部门", "field_type": "string", "required": False},
    {"field_name": "role", "label": "角色", "field_type": "string", "required": False},
    {"field_name": "status", "label": "状态", "field_type": "enum", "required": False},
]


# ── Endpoints ─────────────────────────────────────────────

@router.post("/suggest-model")
async def suggest_model(body: ModelSuggestionRequest):
    """Suggest a model definition from natural language description.

    Uses simple keyword matching to determine domain and suggest fields.
    """
    desc = body.description.lower()

    if any(kw in desc for kw in _EQUIPMENT_KEYWORDS):
        name = "equipment_maintenance"
        label = "设备维修记录"
        fields = _EQUIPMENT_FIELDS + [
            {"field_name": "fault_desc", "label": "故障描述", "field_type": "string", "required": False},
            {"field_name": "repair_type", "label": "维修类型", "field_type": "enum", "required": False},
        ]
    elif any(kw in desc for kw in _ORDER_KEYWORDS):
        name = "production_order"
        label = "生产工单"
        fields = _ORDER_FIELDS
    elif any(kw in desc for kw in _SUPPLIER_KEYWORDS):
        name = "supplier_info"
        label = "供应商信息"
        fields = _SUPPLIER_FIELDS
    elif any(kw in desc for kw in _QUALITY_KEYWORDS):
        name = "quality_inspection"
        label = "质量检测"
        fields = _QUALITY_FIELDS
    elif any(kw in desc for kw in _WORKER_KEYWORDS):
        name = "worker_info"
        label = "员工信息"
        fields = _WORKER_FIELDS
    else:
        name = "custom_model"
        label = "自定义模型"
        fields = _GENERIC_FIELDS

    return {
        "suggestion": {
            "name": name,
            "label": label,
            "fields": fields,
        },
    }


@router.post("/suggest-page")
async def suggest_page(body: PageSuggestionRequest):
    """Suggest page layout from model name.

    Simple heuristic: string -> form-input, enum -> form-select,
    float/int -> form-number, date/datetime -> form-date.
    """
    # Look up model fields from mock models
    model = None
    for m in MOCK_MODELS:
        if m["name"] == body.model_name:
            model = m
            break

    if model is None:
        # Fallback: generic layout
        return {
            "suggestion": {
                "paradigm": "master-detail",
                "layout": [
                    {"type": "form-input", "field_name": "name", "col_span": 2},
                    {"type": "form-input", "field_name": "code", "col_span": 1},
                    {"type": "form-select", "field_name": "status", "col_span": 1},
                ],
            },
        }

    fields = model.get("fields", [])
    layout = []
    for field in fields:
        ft = field.get("field_type", "string")
        fn = field.get("field_name", "")

        if ft in ("string", "text"):
            widget = "form-input"
            col_span = 2 if fn == "name" else 1
        elif ft == "enum":
            widget = "form-select"
            col_span = 1
        elif ft in ("float", "int"):
            widget = "form-number"
            col_span = 1
        elif ft in ("date", "datetime"):
            widget = "form-date"
            col_span = 1
        else:
            widget = "form-input"
            col_span = 1

        layout.append({"type": widget, "field_name": fn, "col_span": col_span})

    return {
        "suggestion": {
            "paradigm": "master-detail",
            "layout": layout,
        },
    }
