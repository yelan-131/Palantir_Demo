"""Repair local business interaction form schemas and sample records.

This script is intentionally idempotent. It fills empty business form shells
with fields, list view config, form layout, and a few dynamic records without
deleting user-created data.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.relational import DynamicRecord, Form, FormField, FormLayout


ANALYTICS_FORM_CODES = {"inventory-impact", "supplier-scorecard"}


BUSINESS_FORM_DEFINITIONS: dict[str, dict] = {
    "production-plan-entry": {
        "name": "生产计划填报",
        "fields": [
            ("planNo", "计划单号", "string", True, True, True, True, True),
            ("product", "产品", "string", True, True, True, True, False),
            ("line", "产线", "string", True, True, True, True, False),
            ("quantity", "计划数量", "integer", True, True, True, False, True),
            ("status", "状态", "enum", False, True, True, True, False),
        ],
        "records": [
            {"planNo": "WO-2026-00014", "product": "密封组件-0311", "line": "上海ASSEMBLY-530-C线", "quantity": 170, "status": "待确认"},
            {"planNo": "WO-2026-00134", "product": "传感器-0228", "line": "上海TESTING-150-C线", "quantity": 137, "status": "执行中"},
            {"planNo": "WO-2026-00277", "product": "密封组件-0367", "line": "武汉PACKAGING-063-D线", "quantity": 220, "status": "执行中"},
            {"planNo": "WO-2026-00546", "product": "传感器-0140", "line": "无锡WAREHOUSE-276-A线", "quantity": 1182, "status": "待确认"},
        ],
    },
    "maintenance-order": {
        "name": "维修工单",
        "fields": [
            ("orderNo", "工单号", "string", True, True, True, True, True),
            ("asset", "设备", "string", True, True, True, True, False),
            ("owner", "负责人", "string", False, True, True, True, False),
            ("priority", "优先级", "enum", False, True, True, True, False),
            ("status", "进度", "enum", False, True, True, True, False),
        ],
        "records": [
            {"orderNo": "MO-2026-0101", "asset": "SMT-03 回流焊", "owner": "孙浩", "priority": "高", "status": "处理中"},
            {"orderNo": "MO-2026-0102", "asset": "AIR-COMP-02", "owner": "周强", "priority": "中", "status": "已完成"},
            {"orderNo": "MO-2026-0103", "asset": "Assembly-A 主线", "owner": "李明", "priority": "高", "status": "待备件"},
        ],
    },
    "equipment-inspection": {
        "name": "点检计划",
        "fields": [
            ("planNo", "点检单号", "string", True, True, True, True, True),
            ("asset", "设备", "string", True, True, True, True, False),
            ("item", "点检项", "string", True, True, True, True, False),
            ("cycle", "周期", "string", False, True, True, True, False),
            ("owner", "负责人", "string", False, True, True, True, False),
            ("status", "状态", "enum", False, True, True, True, False),
        ],
        "records": [
            {"planNo": "INS-2026-001", "asset": "SMT-01 贴片机", "item": "吸嘴磨损检查", "cycle": "每日", "owner": "陈晨", "status": "执行中"},
            {"planNo": "INS-2026-002", "asset": "空压站 2#", "item": "压力与泄漏检查", "cycle": "每周", "owner": "周强", "status": "待点检"},
            {"planNo": "INS-2026-003", "asset": "终检 E 线", "item": "光学检测校准", "cycle": "每日", "owner": "赵敏", "status": "已完成"},
        ],
    },
    "inspection-batch": {
        "name": "检验批次",
        "fields": [
            ("batch", "批次号", "string", True, True, True, True, True),
            ("material", "物料", "string", True, True, True, True, False),
            ("type", "检验类型", "enum", False, True, True, True, False),
            ("sample", "抽检数", "integer", False, True, True, False, True),
            ("result", "结论", "enum", False, True, True, True, False),
        ],
        "records": [
            {"batch": "IQC-2026-0518-001", "material": "BGA-载板-022", "type": "来料", "sample": 80, "result": "放行"},
            {"batch": "PQC-2026-0520-014", "material": "传感器-0228", "type": "过程", "sample": 120, "result": "隔离"},
            {"batch": "OQC-2026-0524-006", "material": "密封组件-0311", "type": "出货", "sample": 60, "result": "放行"},
        ],
    },
    "quality-event": {
        "name": "质量事件",
        "fields": [
            ("eventNo", "事件编号", "string", True, True, True, True, True),
            ("subject", "事件主题", "string", True, True, True, True, False),
            ("owner", "归属", "string", False, True, True, True, False),
            ("stage", "阶段", "enum", False, True, True, True, False),
            ("status", "状态", "enum", False, True, True, True, False),
        ],
        "records": [
            {"eventNo": "QE-2026-001", "subject": "SMT 焊点空洞复检", "owner": "质量部", "stage": "根因分析", "status": "处理中"},
            {"eventNo": "QE-2026-002", "subject": "来料尺寸偏差", "owner": "供应质量", "stage": "遏制措施", "status": "待关闭"},
            {"eventNo": "QE-2026-003", "subject": "终检误判率偏高", "owner": "测试工程", "stage": "验证", "status": "已关闭"},
        ],
    },
    "capa-tracking": {
        "name": "CAPA 跟踪",
        "fields": [
            ("capaNo", "CAPA 编号", "string", True, True, True, True, True),
            ("issue", "问题描述", "string", True, True, True, True, False),
            ("owner", "责任人", "string", False, True, True, True, False),
            ("dueAt", "完成期限", "date", False, True, True, False, True),
            ("status", "状态", "enum", False, True, True, True, False),
        ],
        "records": [
            {"capaNo": "CAPA-2026-001", "issue": "焊接空洞率超阈值", "owner": "王敏", "dueAt": "2026-06-15", "status": "措施执行"},
            {"capaNo": "CAPA-2026-002", "issue": "供应商来料批次波动", "owner": "刘洋", "dueAt": "2026-06-18", "status": "验证中"},
        ],
    },
    "inventory-impact": {
        "name": "库存影响",
        "fields": [
            ("material", "物料", "string", True, True, True, True, False),
            ("gap", "缺口", "integer", False, True, True, False, True),
            ("line", "影响产线", "string", False, True, True, True, False),
            ("action", "缓解动作", "string", False, True, True, False, False),
            ("status", "状态", "enum", False, True, True, True, False),
        ],
        "records": [
            {"material": "锡膏 SAC305", "gap": 420, "line": "SMT-03", "action": "加急采购", "status": "处理中"},
            {"material": "BGA-载板-022", "gap": 180, "line": "Assembly-A", "action": "替代料评估", "status": "待确认"},
        ],
    },
    "supplier-scorecard": {
        "name": "供应商评分",
        "fields": [
            ("supplier", "供应商", "string", True, True, True, True, False),
            ("category", "品类", "string", False, True, True, True, False),
            ("score", "评分", "decimal", False, True, True, False, True),
            ("level", "等级", "enum", False, True, True, True, False),
            ("status", "状态", "enum", False, True, True, True, False),
        ],
        "records": [
            {"supplier": "北辰材料", "category": "电子料", "score": 82.5, "level": "B", "status": "观察"},
            {"supplier": "华东精密", "category": "结构件", "score": 91.2, "level": "A", "status": "正常"},
            {"supplier": "明达物流", "category": "运输", "score": 76.8, "level": "C", "status": "整改"},
        ],
    },
}


MATERIAL_MASTER_RECORDS = [
    {"field_1": "FG-0001", "field_2": "传感器模块", "field_3": "产成品", "field_4": "SM-22A", "field_5": "件", "field_6": "1200", "field_7": "启用"},
    {"field_1": "FG-0002", "field_2": "密封组件", "field_3": "产成品", "field_4": "SEAL-18", "field_5": "件", "field_6": "800", "field_7": "启用"},
    {"field_1": "FG-0003", "field_2": "精密壳体", "field_3": "产成品", "field_4": "CASE-07", "field_5": "件", "field_6": "600", "field_7": "维护中"},
]


def field_payload(field: tuple, index: int) -> dict:
    name, label, field_type, required, visible_list, visible_form, searchable, sortable = field
    enum_values = None
    if field_type == "enum":
        enum_values = {"values": ["待确认", "执行中", "处理中", "已完成", "已关闭", "正常", "观察", "整改"]}
    return {
        "field_name": name,
        "label": label,
        "field_type": field_type,
        "required": required,
        "visible_in_list": visible_list,
        "visible_in_form": visible_form,
        "searchable": searchable,
        "sortable": sortable,
        "archived": False,
        "enum_values": enum_values,
        "sort_order": index,
    }


def view_config(fields: list[dict]) -> dict:
    columns = [
        {
            "id": f"column-{field['field_name']}",
            "fieldName": field["field_name"],
            "label": field["label"],
            "enabled": True,
            "width": 160 if index == 0 else 140,
            "sortable": field["sortable"],
            "renderType": "tag" if field["field_type"] == "enum" else "number" if field["field_type"] in {"integer", "decimal"} else "text",
            "emptyText": "-",
            "sortOrder": index,
        }
        for index, field in enumerate(fields)
        if field["visible_in_list"]
    ]
    filters = [
        {
            "id": f"filter-{field['field_name']}",
            "fieldName": field["field_name"],
            "label": field["label"],
            "controlType": "select" if field["field_type"] == "enum" else "keyword",
            "operator": "equals" if field["field_type"] == "enum" else "contains",
            "enabled": True,
            "advanced": index > 2,
            "sortOrder": index,
        }
        for index, field in enumerate(fields)
        if field["searchable"]
    ]
    return {
        "filters": filters,
        "table": {
            "columns": columns,
            "pageSize": 20,
            "density": "middle",
            "rowClickAction": "detail",
            "toolbarActions": ["create", "refresh", "export", "settings"],
            "rowActions": ["detail", "edit"],
        },
    }


def form_layout(fields: list[dict]) -> dict:
    return {
        "sections": [
            {
                "id": "section-business-info",
                "title": "业务信息",
                "fields": [
                    {
                        "fieldName": field["field_name"],
                        "label": field["label"],
                        "colSpan": 2 if field["field_type"] in {"text", "json"} else 1,
                    }
                    for field in fields
                    if field["visible_in_form"]
                ],
            }
        ]
    }


async def ensure_layout(db, form: Form, layout_type: str, config: dict) -> bool:
    layout = await db.scalar(select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.layout_type == layout_type))
    if layout is None:
        db.add(FormLayout(tenant_id=form.tenant_id, form_id=form.id, layout_type=layout_type, config=config))
        return True
    if not layout.config:
        layout.config = config
        return True
    return False


async def repair_form(db, form: Form, definition: dict) -> dict:
    changed = False
    fields = [field_payload(item, index) for index, item in enumerate(definition["fields"])]
    existing_fields = {
        field.field_name: field
        for field in (await db.execute(select(FormField).where(FormField.form_id == form.id))).scalars().all()
    }
    for field in fields:
        existing = existing_fields.get(field["field_name"])
        if existing is None:
            db.add(FormField(tenant_id=form.tenant_id, form_id=form.id, **field))
            changed = True
        elif existing.archived:
            existing.archived = False
            changed = True

    next_view_config = view_config(fields)
    next_form_layout = form_layout(fields)
    config = dict(form.config or {})
    if config.get("assemblyKind") != "business":
        config["assemblyKind"] = "business"
        changed = True
    if not isinstance(config.get("viewConfig"), dict) or not (config["viewConfig"].get("table") or {}).get("columns"):
        config["viewConfig"] = next_view_config
        config["viewConfigDraft"] = next_view_config
        changed = True
    if not isinstance(config.get("formLayout"), dict):
        config["formLayout"] = next_form_layout
        changed = True
    if not isinstance(config.get("viewConfigMeta"), dict):
        now = datetime.now().isoformat()
        config["viewConfigMeta"] = {
            "draftVersion": 1,
            "publishedVersion": 1,
            "draftSavedAt": now,
            "publishedAt": now,
            "status": "published",
        }
        changed = True
    if config.get("source") is None:
        config["source"] = "business-interaction-repair"
        changed = True
    form.name = definition.get("name") or form.name
    form.status = "published"
    form.storage_mode = "dynamic"
    form.config = config

    changed = await ensure_layout(db, form, "list", {"viewConfig": config["viewConfig"]}) or changed
    changed = await ensure_layout(db, form, "form", next_form_layout) or changed
    changed = await ensure_layout(db, form, "view", {"draft": config["viewConfigDraft"], "published": config["viewConfig"], "meta": config["viewConfigMeta"]}) or changed

    record_count = await db.scalar(
        select(func.count(DynamicRecord.id)).where(DynamicRecord.form_id == form.id, DynamicRecord.deleted_at.is_(None))
    ) or 0
    if record_count == 0:
        for offset, data in enumerate(definition["records"]):
            db.add(
                DynamicRecord(
                    tenant_id=form.tenant_id,
                    form_id=form.id,
                    data=data,
                    status=str(data.get("status") or "active"),
                    schema_version=1,
                    created_at=datetime.now() - timedelta(days=offset),
                    updated_at=datetime.now() - timedelta(days=offset),
                )
            )
        changed = True
    return {"code": form.code, "changed": changed, "records_before": record_count}


async def repair_material_master(db, form: Form) -> dict:
    record_count = await db.scalar(
        select(func.count(DynamicRecord.id)).where(DynamicRecord.form_id == form.id, DynamicRecord.deleted_at.is_(None))
    ) or 0
    changed = False
    if record_count == 0:
        for offset, data in enumerate(MATERIAL_MASTER_RECORDS):
            db.add(
                DynamicRecord(
                    tenant_id=form.tenant_id,
                    form_id=form.id,
                    data=data,
                    status=str(data.get("field_7") or "active"),
                    schema_version=1,
                    created_at=datetime.now() - timedelta(days=offset),
                    updated_at=datetime.now() - timedelta(days=offset),
                )
            )
        changed = True
    return {"code": form.code, "changed": changed, "records_before": record_count}


async def main() -> None:
    async with AsyncSessionLocal() as db:
        results = []
        for code, definition in BUSINESS_FORM_DEFINITIONS.items():
            if code in ANALYTICS_FORM_CODES:
                continue
            form = await db.scalar(select(Form).where(Form.code == code))
            if form is None:
                continue
            results.append(await repair_form(db, form, definition))

        material_form = await db.scalar(select(Form).where(Form.code == "ai_material_master_form_5"))
        if material_form is not None:
            results.append(await repair_material_master(db, material_form))

        await db.commit()

    for result in results:
        flag = "updated" if result["changed"] else "unchanged"
        print(f"{result['code']}: {flag}, records_before={result['records_before']}")


if __name__ == "__main__":
    asyncio.run(main())
