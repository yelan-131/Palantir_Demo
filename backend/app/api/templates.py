"""Template Marketplace — pre-built manufacturing templates.

Users can browse templates grouped by category and instantiate them
with one click. Instantiation creates a MetaModel + MetaFields +
PageConfig + MenuItem in a single transaction.

Falls back to mock IDs when DB is unavailable.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.logging import get_logger
from app.core.db import safe_db_call as try_db

logger = get_logger(__name__)

router = APIRouter()


# ── Template definitions (constants) ─────────────────────

TEMPLATES: list[dict] = [
    {
        "id": 1,
        "name": "设备管理",
        "name_en": "equipment_management",
        "category": "生产管理",
        "description": "设备全生命周期管理，包括设备台账、状态监控、健康评分、维保计划",
        "icon": "ToolOutlined",
        "model": {
            "name": "equipment",
            "label": "设备",
            "table_name": "equipment",
            "description": "设备信息管理",
            "icon": "ToolOutlined",
        },
        "fields": [
            {"field_name": "name", "label": "设备名称", "field_type": "string", "required": True, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 1},
            {"field_name": "model", "label": "设备型号", "field_type": "string", "required": False, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 2},
            {"field_name": "manufacturer", "label": "制造商", "field_type": "string", "required": False, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 3},
            {"field_name": "status", "label": "状态", "field_type": "enum", "required": False, "searchable": True, "sortable": True, "visible_in_list": True, "visible_in_form": True, "enum_values": json.dumps(["running", "idle", "maintenance", "fault"]), "sort_order": 4},
            {"field_name": "health_score", "label": "健康评分", "field_type": "float", "required": False, "searchable": False, "sortable": True, "visible_in_list": True, "visible_in_form": True, "sort_order": 5},
            {"field_name": "line_id", "label": "产线ID", "field_type": "int", "required": False, "searchable": False, "sortable": False, "visible_in_list": False, "visible_in_form": True, "sort_order": 6},
        ],
        "page": {
            "name": "equipment-list",
            "title": "设备管理",
            "paradigm": "master-detail",
        },
    },
    {
        "id": 2,
        "name": "质检流程",
        "name_en": "quality_inspection",
        "category": "质量管理",
        "description": "完整的质量检验流程管理，支持来料检验、过程检验、成品检验全流程跟踪",
        "icon": "SafetyCertificateOutlined",
        "model": {
            "name": "inspections",
            "label": "检验记录",
            "table_name": "inspections",
            "description": "质检流程管理",
            "icon": "SafetyCertificateOutlined",
        },
        "fields": [
            {"field_name": "inspection_type", "label": "检验类型", "field_type": "enum", "required": False, "searchable": True, "sortable": True, "visible_in_list": True, "visible_in_form": True, "enum_values": json.dumps(["incoming", "in-process", "final"]), "sort_order": 1},
            {"field_name": "target_type", "label": "检验对象类型", "field_type": "string", "required": False, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 2},
            {"field_name": "target_id", "label": "检验对象ID", "field_type": "int", "required": False, "searchable": False, "sortable": False, "visible_in_list": False, "visible_in_form": True, "sort_order": 3},
            {"field_name": "result", "label": "检验结果", "field_type": "enum", "required": False, "searchable": True, "sortable": True, "visible_in_list": True, "visible_in_form": True, "enum_values": json.dumps(["pass", "fail", "pending"]), "sort_order": 4},
            {"field_name": "inspector_id", "label": "检验员ID", "field_type": "int", "required": False, "searchable": False, "sortable": False, "visible_in_list": False, "visible_in_form": True, "sort_order": 5},
            {"field_name": "notes", "label": "备注", "field_type": "text", "required": False, "searchable": False, "sortable": False, "visible_in_list": False, "visible_in_form": True, "sort_order": 6},
        ],
        "page": {
            "name": "inspection-flow",
            "title": "质检流程",
            "paradigm": "form-flow",
        },
    },
    {
        "id": 3,
        "name": "供应商管理",
        "name_en": "supplier_management",
        "category": "供应链",
        "description": "供应商信息管理，包括资质评级、交货周期跟踪、物料类型分类",
        "icon": "ShopOutlined",
        "model": {
            "name": "suppliers",
            "label": "供应商",
            "table_name": "suppliers",
            "description": "供应商信息管理",
            "icon": "ShopOutlined",
        },
        "fields": [
            {"field_name": "name", "label": "供应商名称", "field_type": "string", "required": True, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 1},
            {"field_name": "location", "label": "所在地区", "field_type": "string", "required": False, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 2},
            {"field_name": "contact", "label": "联系方式", "field_type": "string", "required": False, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 3},
            {"field_name": "rating", "label": "评级", "field_type": "float", "required": False, "searchable": False, "sortable": True, "visible_in_list": True, "visible_in_form": True, "sort_order": 4},
            {"field_name": "lead_time_days", "label": "交货周期(天)", "field_type": "int", "required": False, "searchable": False, "sortable": True, "visible_in_list": True, "visible_in_form": True, "sort_order": 5},
            {"field_name": "material_type", "label": "物料类型", "field_type": "string", "required": False, "searchable": True, "sortable": False, "visible_in_list": True, "visible_in_form": True, "sort_order": 6},
        ],
        "page": {
            "name": "supplier-mgmt",
            "title": "供应商管理",
            "paradigm": "master-detail",
        },
    },
]


# ── Pydantic schemas ─────────────────────────────────────

class InstantiateRequest(BaseModel):
    name: Optional[str] = None
    customizations: Optional[dict] = None


# ── Endpoints ────────────────────────────────────────────

@router.get("")
async def list_templates():
    """List available templates grouped by category."""
    categories: dict[str, list[dict]] = {}
    for t in TEMPLATES:
        cat = t["category"]
        categories.setdefault(cat, []).append({
            "id": t["id"],
            "name": t["name"],
            "name_en": t["name_en"],
            "category": t["category"],
            "description": t["description"],
            "icon": t["icon"],
            "field_count": len(t["fields"]),
            "paradigm": t["page"]["paradigm"],
        })
    return {"data": TEMPLATES, "categories": categories}


@router.get("/{template_id}")
async def get_template(template_id: int):
    """Get template detail with full config."""
    for t in TEMPLATES:
        if t["id"] == template_id:
            return {"data": t}
    raise HTTPException(404, f"Template {template_id} not found")


@router.post("/{template_id}/instantiate")
async def instantiate_template(template_id: int, body: InstantiateRequest = None):
    """Instantiate a template — creates model + fields + page + menu in one go."""
    if body is None:
        body = InstantiateRequest()

    # Find the template
    template = None
    for t in TEMPLATES:
        if t["id"] == template_id:
            template = t
            break
    if template is None:
        raise HTTPException(404, f"Template {template_id} not found")

    # Apply custom name override
    custom_name = body.name or template["name"]
    customizations = body.customizations or {}

    # Build the model name suffix to allow duplicate instantiations
    model_config = template["model"].copy()
    page_config = template["page"].copy()

    # Allow customization overrides
    if "paradigm" in customizations:
        page_config["paradigm"] = customizations["paradigm"]

    # Determine unique names
    base_name = model_config["name"]
    page_name = page_config["name"]
    route_path = f"/dynamic/{page_name}"

    async def _create_all(db):
        from app.models.relational import MetaField, MetaModel, MenuItem, PageConfig
        from sqlalchemy import select

        # Check if model with this name already exists
        existing = await db.scalar(
            select(MetaModel).where(MetaModel.name == base_name)
        )
        if existing:
            # Append a suffix to avoid unique constraint violation
            import time
            suffix = str(int(time.time()))[-5:]
            model_config["name"] = f"{base_name}_{suffix}"
            model_config["table_name"] = f"{base_name}_{suffix}"
            page_name_unique = f"{page_name}-{suffix}"
        else:
            page_name_unique = page_name

        route_path = f"/dynamic/{page_name_unique}"

        # 1. Create MetaModel
        m = MetaModel(
            name=model_config["name"],
            label=custom_name,
            table_name=model_config["table_name"],
            description=model_config.get("description", ""),
            icon=model_config.get("icon"),
            is_system=False,
        )
        db.add(m)
        await db.flush()  # get the id

        # 2. Create MetaFields
        for field_def in template["fields"]:
            f = MetaField(
                model_id=m.id,
                field_name=field_def["field_name"],
                label=field_def["label"],
                field_type=field_def["field_type"],
                required=field_def.get("required", False),
                searchable=field_def.get("searchable", False),
                sortable=field_def.get("sortable", False),
                visible_in_list=field_def.get("visible_in_list", True),
                visible_in_form=field_def.get("visible_in_form", True),
                enum_values=field_def.get("enum_values"),
                sort_order=field_def.get("sort_order", 0),
            )
            db.add(f)

        # 3. Create PageConfig
        pc = PageConfig(
            name=page_name_unique,
            title=custom_name,
            paradigm=page_config["paradigm"],
            model_id=m.id,
            config=json.dumps({}, ensure_ascii=False),
            route_path=route_path,
            is_published=True,
        )
        db.add(pc)

        # 4. Find or create "动态页面" parent menu
        parent_menu = await db.scalar(
            select(MenuItem).where(MenuItem.title == "动态页面", MenuItem.parent_id.is_(None))
        )
        if parent_menu is None:
            parent_menu = MenuItem(
                title="动态页面",
                icon="AppstoreOutlined",
                route_path=None,
                sort_order=100,
                is_visible=True,
            )
            db.add(parent_menu)
            await db.flush()

        # 5. Create MenuItem
        # Determine sort order: max existing child + 1
        max_sort = await db.scalar(
            select(MenuItem.sort_order).where(MenuItem.parent_id == parent_menu.id)
            .order_by(MenuItem.sort_order.desc()).limit(1)
        )
        sort_order = (max_sort or 100) + 1

        mi = MenuItem(
            parent_id=parent_menu.id,
            title=custom_name,
            icon=template.get("icon"),
            route_path=route_path,
            sort_order=sort_order,
            is_visible=True,
        )
        db.add(mi)

        await db.commit()
        await db.refresh(m)
        await db.refresh(pc)
        await db.refresh(mi)

        return {
            "model_id": m.id,
            "page_id": pc.id,
            "menu_id": mi.id,
            "route_path": route_path,
        }

    result = await try_db(_create_all)
    if result is not None:
        return result

    # Mock fallback — return deterministic mock IDs
    return {
        "model_id": 9000 + template_id,
        "page_id": 9000 + template_id,
        "menu_id": 9000 + template_id,
        "route_path": f"/dynamic/{page_name}",
    }
