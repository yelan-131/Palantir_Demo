"""Low-code configuration tools for permissioned AI Agent execution."""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import current_tenant_id, current_user_id
from app.core.audit import write_audit_log
from app.models.relational import Application, ApplicationForm, ApplicationMenuNode, Form, FormField, FormLayout


FIELD_TYPE_ALIASES = {
    "int": "integer",
    "float": "number",
}
SUPPORTED_FIELD_TYPES = {
    "string",
    "text",
    "number",
    "integer",
    "decimal",
    "boolean",
    "date",
    "datetime",
    "enum",
    "json",
    "relation",
}


CREATE_FORM_DEFINITION_CONTRACT = {
    "tool": "forms.create_form_definition",
    "required": ["form.name", "form.code", "fields"],
    "optional": ["form.description", "menu.create", "menu.title", "menu.icon"],
    "field_schema": ["field_name", "label", "field_type", "required", "searchable", "sortable", "enum_values"],
    "supported_field_types": sorted(SUPPORTED_FIELD_TYPES),
}

ADD_FORM_FIELD_CONTRACT = {
    "tool": "forms.add_form_field",
    "required": ["form.id|form.code", "fields"],
    "optional": ["field.required", "field.searchable", "field.sortable", "field.enum_values", "field.ui_config"],
    "field_schema": ["field_name", "label", "field_type", "required", "searchable", "sortable", "enum_values"],
    "supported_field_types": sorted(SUPPORTED_FIELD_TYPES),
}


def describe_create_form_definition_contract() -> dict[str, Any]:
    """Return the platform contract the Agent must consult before proposing a form write."""

    return CREATE_FORM_DEFINITION_CONTRACT


def describe_add_form_field_contract() -> dict[str, Any]:
    """Return the platform contract for adding fields to an existing form."""

    return ADD_FORM_FIELD_CONTRACT


def has_minimum_form_requirements(context: dict[str, Any]) -> bool:
    """Gate form writes until the user has supplied enough design detail."""

    fields = context.get("fields")
    has_name = bool(context.get("formName") or context.get("form_name"))
    has_fields = isinstance(fields, list) and len(fields) >= 2
    has_code = bool(context.get("formCode") or context.get("form_code"))
    return has_name and (has_fields or has_code)


def _slugify(value: str, fallback: str = "ai_form") -> str:
    slug = re.sub(r"[^a-zA-Z0-9_]+", "_", value.strip().lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)
    return slug or fallback


def _safe_code_from_text(text: str) -> str:
    lowered = text.lower()
    hints = [
        ("material_master", ["material master", "material", "inventory", "物料", "主数据", "料号"]),
        ("equipment", ["equipment", "device", "inspection", "maintenance", "设备", "点检", "维保"]),
        ("supplier", ["supplier", "supply", "vendor", "供应商", "供方"]),
        ("quality", ["quality", "capa", "defect", "inspection", "质量", "缺陷", "异常"]),
        ("purchase", ["purchase", "采购"]),
    ]
    for code, tokens in hints:
        if any(token in lowered for token in tokens):
            return f"ai_{code}_form"
    return "ai_generated_form"


def _normalize_field_type(value: Any) -> str:
    field_type = str(value or "string").strip().lower()
    field_type = FIELD_TYPE_ALIASES.get(field_type, field_type)
    return field_type if field_type in SUPPORTED_FIELD_TYPES else "string"


def _default_fields(message: str) -> list[dict[str, Any]]:
    text = message.lower()
    if any(token in text for token in ["material master", "material", "inventory", "物料", "主数据", "料号"]):
        return [
            {"field_name": "material_code", "label": "物料编码", "field_type": "string", "required": True, "searchable": True},
            {"field_name": "material_name", "label": "物料名称", "field_type": "string", "required": True, "searchable": True},
            {"field_name": "material_type", "label": "物料类型", "field_type": "enum", "required": True, "enum_values": {"values": ["raw_material", "semi_finished", "finished_goods", "spare_part"]}},
            {"field_name": "specification", "label": "规格型号", "field_type": "string", "searchable": True},
            {"field_name": "unit", "label": "计量单位", "field_type": "string", "required": True},
            {"field_name": "safety_stock", "label": "安全库存", "field_type": "number", "sortable": True},
            {"field_name": "supplier", "label": "默认供应商", "field_type": "string", "searchable": True},
            {"field_name": "status", "label": "状态", "field_type": "enum", "enum_values": {"values": ["draft", "active", "disabled"]}},
            {"field_name": "remark", "label": "备注", "field_type": "text", "visible_in_list": False},
        ]
    if any(token in text for token in ["equipment", "device", "maintenance", "inspection", "设备", "点检", "维保"]):
        return [
            {"field_name": "inspection_code", "label": "点检单号", "field_type": "string", "required": True, "searchable": True},
            {"field_name": "equipment_name", "label": "设备", "field_type": "string", "required": True, "searchable": True},
            {"field_name": "inspection_item", "label": "点检项", "field_type": "string", "required": True},
            {"field_name": "result", "label": "结果", "field_type": "enum", "enum_values": {"values": ["pass", "fail", "follow_up"]}},
            {"field_name": "inspected_at", "label": "点检时间", "field_type": "datetime", "sortable": True},
            {"field_name": "owner", "label": "负责人", "field_type": "string", "searchable": True},
            {"field_name": "remark", "label": "备注", "field_type": "text", "visible_in_list": False},
        ]
    if any(token in text for token in ["supplier", "vendor", "supply", "供应商", "供方"]):
        return [
            {"field_name": "supplier_name", "label": "Supplier", "field_type": "string", "required": True, "searchable": True},
            {"field_name": "material_code", "label": "Material Code", "field_type": "string", "searchable": True},
            {"field_name": "batch_no", "label": "Batch No", "field_type": "string", "searchable": True},
            {"field_name": "issue_type", "label": "Issue Type", "field_type": "enum", "enum_values": {"values": ["quality", "delivery", "document", "other"]}},
            {"field_name": "severity", "label": "Severity", "field_type": "enum", "enum_values": {"values": ["low", "medium", "high"]}},
            {"field_name": "owner", "label": "Owner", "field_type": "string"},
            {"field_name": "status", "label": "Status", "field_type": "enum", "enum_values": {"values": ["open", "processing", "closed"]}},
        ]
    return [
        {"field_name": "title", "label": "Title", "field_type": "string", "required": True, "searchable": True},
        {"field_name": "code", "label": "Code", "field_type": "string", "searchable": True},
        {"field_name": "status", "label": "Status", "field_type": "enum", "enum_values": {"values": ["draft", "active", "closed"]}},
        {"field_name": "owner", "label": "Owner", "field_type": "string", "searchable": True},
        {"field_name": "description", "label": "Description", "field_type": "text", "visible_in_list": False},
    ]


def build_low_code_form_payload(message: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Create a conservative form-definition draft from a user request."""

    context = context or {}
    raw_name = context.get("form_name") or context.get("formName")
    if not raw_name:
        raw_name = "AI Generated Form"
        for marker in ["named ", "called "]:
            if marker in message.lower():
                raw_name = message.lower().split(marker, 1)[1].strip().split(" with ", 1)[0][:80] or raw_name
                break
        if raw_name == "AI Generated Form":
            match = re.search(r"(?:关于|有关|为|给)?([\u4e00-\u9fa5A-Za-z0-9_\-\s]{2,40}?)(?:的)?表单", message)
            if match:
                candidate = re.sub(
                    r"^(请你|请|麻烦|帮我|给我|为我|建立|新建|创建|设计|生成|做|一个|个|关于|有关|\s)+",
                    "",
                    match.group(1).strip(),
                )
                raw_name = re.sub(r"(就好|即可|就行|吧)$", "", candidate).strip() or raw_name
    code = context.get("form_code") or context.get("formCode") or _safe_code_from_text(message)
    fields = context.get("fields") if isinstance(context.get("fields"), list) else _default_fields(message)

    normalized_fields = []
    for index, field in enumerate(fields):
        if not isinstance(field, dict):
            continue
        field_name = _slugify(str(field.get("field_name") or field.get("name") or f"field_{index + 1}"), f"field_{index + 1}")
        normalized_fields.append(
            {
                "field_name": field_name,
                "label": str(field.get("label") or field_name.replace("_", " ").title()),
                "field_type": _normalize_field_type(field.get("field_type") or field.get("type")),
                "required": bool(field.get("required", False)),
                "visible_in_list": bool(field.get("visible_in_list", True)),
                "visible_in_form": bool(field.get("visible_in_form", True)),
                "searchable": bool(field.get("searchable", False)),
                "sortable": bool(field.get("sortable", False)),
                "enum_values": field.get("enum_values"),
                "ui_config": field.get("ui_config"),
                "sort_order": int(field.get("sort_order", index)),
            }
        )

    return {
        "form": {
            "name": str(raw_name),
            "code": _slugify(str(code)),
            "description": str(context.get("description") or "Created from an AI Agent low-code plan."),
            "status": "draft",
            "storage_mode": "dynamic",
            "application_id": context.get("application_id") or context.get("applicationId"),
            "config": {"createdByAgent": True},
        },
        "fields": normalized_fields,
        "menu": {
            "create": bool(context.get("create_menu", context.get("createMenu", False))),
            "title": str(context.get("menu_title") or context.get("menuTitle") or raw_name),
            "icon": context.get("menu_icon") or context.get("menuIcon") or "FormOutlined",
        },
    }


async def execute_create_form_definition(
    session: AsyncSession,
    *,
    user: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Create form metadata after AI confirmation and admin permission check."""

    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin privilege required for AI low-code configuration writes")

    tenant_id = current_tenant_id(user)
    form_data = dict(payload.get("form") or {})
    fields = payload.get("fields") or []
    menu = dict(payload.get("menu") or {})

    code = _slugify(str(form_data.get("code") or "ai_generated_form"))
    assert_safe_identifier(code)
    if await session.scalar(select(Form.id).where(Form.tenant_id == tenant_id, Form.code == code)):
        if not (code.startswith("ai_") or (form_data.get("config") or {}).get("createdByAgent")):
            raise HTTPException(status_code=409, detail="Form code already exists")
        base_code = code[:56].rstrip("_")
        for index in range(2, 100):
            candidate = f"{base_code}_{index}"
            assert_safe_identifier(candidate)
            if not await session.scalar(select(Form.id).where(Form.tenant_id == tenant_id, Form.code == candidate)):
                code = candidate
                break
        else:
            raise HTTPException(status_code=409, detail="Form code already exists")

    application_id = form_data.get("application_id")
    app = None
    if application_id is not None:
        app = await session.get(Application, int(application_id))
        if not app or app.tenant_id != tenant_id:
            raise HTTPException(status_code=404, detail="Application not found")

    form = Form(
        tenant_id=tenant_id,
        name=str(form_data.get("name") or code),
        code=code,
        description=form_data.get("description"),
        storage_mode=str(form_data.get("storage_mode") or "dynamic"),
        status=str(form_data.get("status") or "draft"),
        owner_id=current_user_id(user),
        config=form_data.get("config") or {"createdByAgent": True},
    )
    session.add(form)
    await session.flush()

    created_fields = []
    seen_names: set[str] = set()
    for index, field_data in enumerate(fields):
        if not isinstance(field_data, dict):
            continue
        field_name = _slugify(str(field_data.get("field_name") or f"field_{index + 1}"), f"field_{index + 1}")
        if field_name in seen_names:
            continue
        seen_names.add(field_name)
        field = FormField(
            tenant_id=tenant_id,
            form_id=form.id,
            field_name=field_name,
            label=str(field_data.get("label") or field_name),
            field_type=_normalize_field_type(field_data.get("field_type")),
            required=bool(field_data.get("required", False)),
            visible_in_list=bool(field_data.get("visible_in_list", True)),
            visible_in_form=bool(field_data.get("visible_in_form", True)),
            searchable=bool(field_data.get("searchable", False)),
            sortable=bool(field_data.get("sortable", False)),
            enum_values=field_data.get("enum_values"),
            ui_config=field_data.get("ui_config"),
            sort_order=int(field_data.get("sort_order", index)),
        )
        session.add(field)
        created_fields.append(field)

    list_columns = [
        {"field_name": field.field_name, "label": field.label, "width": 160}
        for field in created_fields
        if field.visible_in_list
    ]
    form_items = [
        {"field_name": field.field_name, "label": field.label, "col_span": 1}
        for field in created_fields
        if field.visible_in_form
    ]
    session.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="list", config={"columns": list_columns}))
    session.add(FormLayout(tenant_id=tenant_id, form_id=form.id, layout_type="form", config={"sections": [{"title": "Basic", "fields": form_items}]}))

    binding = None
    menu_node = None
    if app is not None:
        binding = ApplicationForm(tenant_id=tenant_id, application_id=app.id, form_id=form.id, alias=form.name)
        session.add(binding)
        if menu.get("create"):
            menu_node = ApplicationMenuNode(
                tenant_id=tenant_id,
                application_id=app.id,
                node_type="form",
                title=str(menu.get("title") or form.name),
                icon=menu.get("icon"),
                form_id=form.id,
                route_path=f"/dynamic/{form.id}",
                visible=True,
                default_entry=False,
            )
            session.add(menu_node)

    await session.commit()
    await session.refresh(form)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="ai_create_form_definition",
        resource_type="form",
        resource_id=form.id,
        new_values=payload,
    )

    return {
        "form": {"id": form.id, "name": form.name, "code": form.code, "status": form.status},
        "fields": [{"id": field.id, "field_name": field.field_name, "label": field.label} for field in created_fields],
        "application_binding": {"id": binding.id, "application_id": binding.application_id} if binding else None,
        "menu_node": {"id": menu_node.id, "route_path": menu_node.route_path} if menu_node else None,
        "route_path": f"/dynamic/{form.id}",
    }


def _field_payload(field: FormField) -> dict[str, Any]:
    return {"id": field.id, "field_name": field.field_name, "label": field.label, "field_type": field.field_type}


def _append_field_to_layouts(layouts: list[FormLayout], field: FormField) -> list[str]:
    changed: list[str] = []
    for layout in layouts:
        config = dict(layout.config or {})
        if layout.layout_type == "list":
            columns = list(config.get("columns") or [])
            if field.visible_in_list and not any(item.get("field_name") == field.field_name for item in columns if isinstance(item, dict)):
                columns.append({"field_name": field.field_name, "label": field.label, "width": 160})
                config["columns"] = columns
                layout.config = config
                changed.append("list")
        elif layout.layout_type == "form":
            sections = list(config.get("sections") or [])
            if not sections:
                sections = [{"title": "Basic", "fields": []}]
            first = dict(sections[0])
            fields = list(first.get("fields") or [])
            already_present = any(
                (item.get("field_name") if isinstance(item, dict) else item) == field.field_name
                for item in fields
            )
            if field.visible_in_form and not already_present:
                fields.append({"field_name": field.field_name, "label": field.label, "col_span": 1})
                first["fields"] = fields
                sections[0] = first
                config["sections"] = sections
                layout.config = config
                changed.append("form")
    return changed


async def execute_add_form_field(
    session: AsyncSession,
    *,
    user: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Add fields to an existing form after AI confirmation and admin policy check."""

    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin privilege required for AI low-code configuration writes")

    tenant_id = current_tenant_id(user)
    form_id = payload.get("form_id") or payload.get("formId")
    form_code = payload.get("form_code") or payload.get("formCode")
    form = None
    if form_id:
        form = await session.get(Form, int(form_id))
        if form and form.tenant_id != tenant_id:
            form = None
    elif form_code:
        form = await session.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == str(form_code)))
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    fields = payload.get("fields") or []
    if not isinstance(fields, list) or not fields:
        raise HTTPException(status_code=422, detail="At least one field is required")

    existing_names = {
        name
        for name in (
            await session.execute(select(FormField.field_name).where(FormField.form_id == form.id, FormField.tenant_id == tenant_id))
        ).scalars().all()
    }
    max_sort_order = await session.scalar(
        select(FormField.sort_order).where(FormField.form_id == form.id, FormField.tenant_id == tenant_id).order_by(FormField.sort_order.desc()).limit(1)
    )
    next_sort_order = int(max_sort_order or 0) + 1
    created_fields: list[FormField] = []
    for index, field_data in enumerate(fields):
        if not isinstance(field_data, dict):
            continue
        field_name = _slugify(str(field_data.get("field_name") or field_data.get("name") or f"field_{next_sort_order + index}"), f"field_{next_sort_order + index}")
        assert_safe_identifier(field_name)
        if field_name in existing_names:
            raise HTTPException(status_code=409, detail=f"Field already exists on this form: {field_name}")
        existing_names.add(field_name)
        field = FormField(
            tenant_id=tenant_id,
            form_id=form.id,
            field_name=field_name,
            label=str(field_data.get("label") or field_name),
            field_type=_normalize_field_type(field_data.get("field_type")),
            required=bool(field_data.get("required", False)),
            visible_in_list=bool(field_data.get("visible_in_list", True)),
            visible_in_form=bool(field_data.get("visible_in_form", True)),
            searchable=bool(field_data.get("searchable", False)),
            sortable=bool(field_data.get("sortable", False)),
            enum_values=field_data.get("enum_values"),
            ui_config=field_data.get("ui_config"),
            sort_order=int(field_data.get("sort_order", next_sort_order + index)),
        )
        session.add(field)
        created_fields.append(field)

    await session.flush()
    layouts = (
        await session.execute(select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.tenant_id == tenant_id))
    ).scalars().all()
    changed_layouts: set[str] = set()
    for field in created_fields:
        changed_layouts.update(_append_field_to_layouts(list(layouts), field))

    await session.commit()
    for field in created_fields:
        await session.refresh(field)
    await write_audit_log(
        tenant_id=tenant_id,
        user_id=current_user_id(user),
        action="ai_add_form_field",
        resource_type="form",
        resource_id=form.id,
        new_values=payload,
    )

    return {
        "form": {"id": form.id, "name": form.name, "code": form.code, "status": form.status},
        "fields": [_field_payload(field) for field in created_fields],
        "changed_layouts": sorted(changed_layouts),
    }
