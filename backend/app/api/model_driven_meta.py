"""Model-Driven: meta-model + page-config CRUD.

Mounted under the parent `model_driven.router` (no prefix here).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, text as sa_text

from app.api._model_driven_shared import (
    ENTITY_TABLE_MAP,
    MetaFieldCreate,
    MetaModelCreate,
    MetaModelUpdate,
    MOCK_MODELS,
    MOCK_PAGES,
    PageConfigCreate,
    try_db,
)

router = APIRouter()


# ── Meta Model CRUD ──────────────────────────────────────

@router.get("/models")
async def list_models():
    """元模型列表."""
    async def _query(db):
        from app.models.relational import MetaField, MetaModel
        result = await db.execute(select(MetaModel).order_by(MetaModel.id))
        models = result.scalars().all()
        out = []
        for m in models:
            fields_result = await db.execute(
                select(MetaField).where(MetaField.model_id == m.id).order_by(MetaField.sort_order)
            )
            fields = fields_result.scalars().all()
            out.append({
                "id": m.id, "name": m.name, "label": m.label, "icon": m.icon,
                "table_name": m.table_name, "description": m.description, "is_system": m.is_system,
                "version": getattr(m, "version", 1),
                "fields": [
                    {"id": f.id, "field_name": f.field_name, "label": f.label, "field_type": f.field_type,
                     "required": f.required, "searchable": f.searchable, "sortable": f.sortable,
                     "visible_in_list": f.visible_in_list, "visible_in_form": f.visible_in_form,
                     "enum_values": f.enum_values, "sort_order": f.sort_order}
                    for f in fields
                ],
            })
        return {"data": out}

    result = await try_db(_query)
    return result or {"data": MOCK_MODELS}


@router.post("/models")
async def create_model(body: MetaModelCreate):
    """创建元模型."""
    async def _query(db):
        from app.models.relational import MetaModel
        m = MetaModel(
            name=body.name, label=body.label, icon=body.icon,
            table_name=body.table_name, description=body.description, is_system=body.is_system,
        )
        db.add(m)
        await db.commit()
        await db.refresh(m)
        return {"id": m.id, "name": m.name, "label": m.label}

    result = await try_db(_query)
    if result is not None:
        return result
    new_id = len(MOCK_MODELS) + 10
    MOCK_MODELS.append({
        "id": new_id, "name": body.name, "label": body.label, "icon": body.icon,
        "table_name": body.table_name, "description": body.description, "is_system": False, "fields": [],
    })
    return {"id": new_id, "name": body.name}


@router.put("/models/{model_id}")
async def update_model(model_id: int, body: MetaModelUpdate):
    """更新元模型."""
    async def _query(db):
        from app.models.relational import MetaModel
        m = await db.get(MetaModel, model_id)
        if not m:
            return None
        if body.label is not None:
            m.label = body.label
        if body.icon is not None:
            m.icon = body.icon
        if body.description is not None:
            m.description = body.description
        await db.commit()
        return {"id": m.id, "name": m.name, "label": m.label}

    result = await try_db(_query)
    if result is not None:
        return result
    for m in MOCK_MODELS:
        if m["id"] == model_id:
            if body.label:
                m["label"] = body.label
            if body.icon:
                m["icon"] = body.icon
            return m
    raise HTTPException(404, "Model not found")


@router.delete("/models/{model_id}")
async def delete_model(model_id: int):
    """删除元模型."""
    async def _query(db):
        from app.models.relational import MetaModel
        m = await db.get(MetaModel, model_id)
        if not m:
            return None
        await db.delete(m)
        await db.commit()
        return {"ok": True}

    result = await try_db(_query)
    return result or {"ok": True}


@router.post("/models/{model_id}/fields")
async def add_field(model_id: int, body: MetaFieldCreate):
    """为模型添加字段."""
    async def _query(db):
        from app.models.relational import MetaField, MetaModel
        m = await db.get(MetaModel, model_id)
        if not m:
            return None
        f = MetaField(
            model_id=model_id, field_name=body.field_name, label=body.label,
            field_type=body.field_type, required=body.required, searchable=body.searchable,
            sortable=body.sortable, visible_in_list=body.visible_in_list,
            visible_in_form=body.visible_in_form, enum_values=body.enum_values,
            relation_config=body.relation_config, default_value=body.default_value,
            sort_order=body.sort_order,
        )
        db.add(f)
        await db.commit()
        await db.refresh(f)
        return {"id": f.id, "field_name": f.field_name}

    result = await try_db(_query)
    if result is not None:
        return result
    return {"id": 100, "field_name": body.field_name}


@router.post("/models/import-from-ontology")
async def import_from_ontology():
    """从本体定义导入元模型."""
    try:
        from app.models.graph_models import ENTITY_SCHEMAS
    except Exception as exc:
        raise HTTPException(500, f"ENTITY_SCHEMAS not available: {exc}")

    async def _query(db):
        from app.models.relational import MetaField, MetaModel
        imported = []
        for entity_name, schema in ENTITY_SCHEMAS.items():
            table_name = ENTITY_TABLE_MAP.get(entity_name, entity_name.lower() + "s")
            existing = await db.scalar(
                select(MetaModel).where(MetaModel.name == entity_name.lower())
            )
            if existing:
                continue
            m = MetaModel(
                name=entity_name.lower(), label=schema.get("label", entity_name),
                icon=schema.get("icon"), table_name=table_name,
                description=schema.get("label", entity_name), is_system=True,
            )
            db.add(m)
            await db.flush()
            for i, (prop_name, prop_def) in enumerate(schema.get("properties", {}).items()):
                f = MetaField(
                    model_id=m.id, field_name=prop_name, label=prop_def.get("label", prop_name),
                    field_type=prop_def.get("type", "string"), required=prop_def.get("required", False),
                    searchable=True, visible_in_list=True, visible_in_form=True, sort_order=i,
                )
                db.add(f)
            imported.append(entity_name)
        await db.commit()
        return {"imported": imported, "count": len(imported)}

    result = await try_db(_query)
    if result is not None:
        return result

    names = [e.value if hasattr(e, "value") else str(e) for e in ENTITY_SCHEMAS.keys()]
    return {"imported": names, "count": len(names)}


# ── Page Config ──────────────────────────────────────────

@router.get("/pages")
async def list_pages():
    """页面配置列表."""
    async def _query(db):
        from app.models.relational import MetaModel, PageConfig
        result = await db.execute(
            select(PageConfig, MetaModel.name.label("model_name"))
            .join(MetaModel, PageConfig.model_id == MetaModel.id)
            .order_by(PageConfig.id)
        )
        rows = result.fetchall()
        return {"data": [
            {"id": pc.id, "name": pc.name, "title": pc.title, "paradigm": pc.paradigm,
             "model_id": pc.model_id, "model_name": mn,
             "config": json.loads(pc.config) if isinstance(pc.config, str) else pc.config,
             "route_path": pc.route_path, "is_published": pc.is_published}
            for pc, mn in rows
        ]}

    result = await try_db(_query)
    return result or {"data": MOCK_PAGES}


@router.post("/pages")
async def create_page(body: PageConfigCreate):
    """创建页面配置."""
    async def _query(db):
        from app.models.relational import MetaModel, PageConfig
        m = await db.scalar(select(MetaModel).where(MetaModel.name == body.model_name))
        if not m:
            raise HTTPException(404, f"Model '{body.model_name}' not found")
        pc = PageConfig(
            name=body.name, title=body.title, paradigm=body.paradigm, model_id=m.id,
            config=json.dumps(body.config or {}, ensure_ascii=False),
            route_path=body.route_path or f"/dynamic/{body.name}",
            is_published=body.is_published,
        )
        db.add(pc)
        await db.commit()
        await db.refresh(pc)
        return {"id": pc.id, "name": pc.name, "route_path": pc.route_path}

    result = await try_db(_query)
    if result is not None:
        return result
    new_id = len(MOCK_PAGES) + 10
    MOCK_PAGES.append({
        "id": new_id, "name": body.name, "title": body.title, "paradigm": body.paradigm,
        "model_id": 0, "model_name": body.model_name, "config": body.config or {},
        "route_path": f"/dynamic/{body.name}", "is_published": body.is_published,
    })
    return {"id": new_id, "name": body.name, "route_path": f"/dynamic/{body.name}"}


@router.post("/pages/generate")
async def generate_page(body: PageConfigCreate):
    """根据模型自动生成页面配置."""
    async def _query(db):
        from app.models.relational import MetaField, MetaModel, PageConfig
        m = await db.scalar(select(MetaModel).where(MetaModel.name == body.model_name))
        if not m:
            raise HTTPException(404, f"Model '{body.model_name}' not found")
        fields_result = await db.execute(
            select(MetaField).where(MetaField.model_id == m.id).order_by(MetaField.sort_order)
        )
        fields = fields_result.scalars().all()

        auto_config = {
            "list_fields": [f.field_name for f in fields if f.visible_in_list],
            "form_fields": [f.field_name for f in fields if f.visible_in_form],
            "search_fields": [f.field_name for f in fields if f.searchable],
            "sort_fields": [f.field_name for f in fields if f.sortable],
        }
        route = body.route_path or f"/dynamic/{body.name}"
        pc = PageConfig(
            name=body.name, title=body.title or m.label,
            paradigm=body.paradigm or "master-detail", model_id=m.id,
            config=json.dumps(auto_config, ensure_ascii=False),
            route_path=route, is_published=True,
        )
        db.add(pc)
        await db.commit()
        await db.refresh(pc)
        return {"id": pc.id, "name": pc.name, "route_path": route, "config": auto_config}

    result = await try_db(_query)
    if result is not None:
        return result
    return {"id": 100, "name": body.name, "route_path": f"/dynamic/{body.name}"}


@router.delete("/pages/{page_id}")
async def delete_page(page_id: int):
    """删除页面配置."""
    async def _query(db):
        from app.models.relational import PageConfig
        pc = await db.get(PageConfig, page_id)
        if not pc:
            return None
        await db.delete(pc)
        await db.commit()
        return {"ok": True}

    result = await try_db(_query)
    return result or {"ok": True}


# ── Version Management ────────────────────────────────────

from pydantic import BaseModel as _BaseModel


class PublishRequest(_BaseModel):
    change_description: str = ""


@router.get("/models/{model_id}/versions")
async def list_model_versions(model_id: int):
    """模型版本历史."""
    async def _query(db):
        from app.models.relational import MetaField, MetaModel, ModelVersion
        m = await db.get(MetaModel, model_id)
        if not m:
            return None

        result = await db.execute(
            select(ModelVersion)
            .where(ModelVersion.model_id == model_id)
            .order_by(ModelVersion.version.desc())
        )
        versions = result.scalars().all()

        # If no version history yet, synthesize one from the current model
        if not versions:
            fields_result = await db.execute(
                select(MetaField).where(MetaField.model_id == model_id).order_by(MetaField.sort_order)
            )
            fields = fields_result.scalars().all()
            snapshot = json.dumps({
                "name": m.name, "label": m.label, "table_name": m.table_name,
                "description": m.description,
                "fields": [
                    {"field_name": f.field_name, "label": f.label, "field_type": f.field_type,
                     "required": f.required, "sort_order": f.sort_order}
                    for f in fields
                ],
            }, ensure_ascii=False)
            return {"data": [{
                "version": getattr(m, "version", 1),
                "changes": "Current version",
                "snapshot": json.loads(snapshot),
                "created_at": m.updated_at.isoformat() if m.updated_at else None,
            }]}

        return {"data": [
            {
                "version": v.version,
                "changes": v.change_description or "",
                "snapshot": json.loads(v.snapshot) if isinstance(v.snapshot, str) else v.snapshot,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in versions
        ]}

    result = await try_db(_query)
    if result is not None:
        return result

    # Mock fallback: return a synthetic version for mock models
    for m in MOCK_MODELS:
        if m["id"] == model_id:
            return {"data": [{
                "version": 1,
                "changes": "Initial version",
                "snapshot": {"name": m["name"], "label": m["label"], "fields": m["fields"]},
                "created_at": None,
            }]}
    raise HTTPException(404, "Model not found")


@router.post("/models/{model_id}/publish")
async def publish_model(model_id: int, body: PublishRequest):
    """发布模型版本 (bump version + record snapshot)."""
    async def _query(db):
        from app.models.relational import MetaField, MetaModel, ModelVersion
        m = await db.get(MetaModel, model_id)
        if not m:
            return None

        # Build snapshot from current model + fields
        fields_result = await db.execute(
            select(MetaField).where(MetaField.model_id == model_id).order_by(MetaField.sort_order)
        )
        fields = fields_result.scalars().all()
        snapshot = json.dumps({
            "name": m.name, "label": m.label, "table_name": m.table_name,
            "description": m.description,
            "fields": [
                {"field_name": f.field_name, "label": f.label, "field_type": f.field_type,
                 "required": f.required, "sort_order": f.sort_order}
                for f in fields
            ],
        }, ensure_ascii=False)

        # Bump version
        current_version = getattr(m, "version", 1)
        new_version = current_version + 1
        m.version = new_version

        # Create version record
        version_record = ModelVersion(
            model_id=model_id,
            version=new_version,
            snapshot=snapshot,
            change_description=body.change_description,
        )
        db.add(version_record)
        await db.commit()
        await db.refresh(version_record)

        return {
            "id": version_record.id,
            "model_id": model_id,
            "version": new_version,
            "change_description": body.change_description,
        }

    result = await try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    for m in MOCK_MODELS:
        if m["id"] == model_id:
            return {
                "id": 100,
                "model_id": model_id,
                "version": 2,
                "change_description": body.change_description,
            }
    raise HTTPException(404, "Model not found")


@router.get("/models/{model_id}/impact")
async def detect_impact(model_id: int):
    """检测模型变更影响范围."""
    async def _query(db):
        from app.models.relational import MetaField, MetaModel, ModelVersion, PageConfig

        m = await db.get(MetaModel, model_id)
        if not m:
            return None

        # Find pages referencing this model
        pages_result = await db.execute(
            select(PageConfig).where(PageConfig.model_id == model_id)
        )
        pages = pages_result.scalars().all()

        affected_pages = [
            {"id": p.id, "name": p.name, "title": p.title, "route_path": p.route_path}
            for p in pages
        ]

        # Find forms (pages with paradigm containing 'form')
        affected_forms = [
            {"id": p.id, "name": p.name, "title": p.title}
            for p in pages if "form" in (p.paradigm or "").lower()
        ]

        # Check rules referencing this model (if rules table exists)
        affected_rules = []
        try:
            rule_result = await db.execute(
                sa_text("SELECT id, name, rule_type FROM rules WHERE model_id = :mid"),
                {"mid": model_id},
            )
            for row in rule_result.fetchall():
                affected_rules.append({"id": row[0], "name": row[1], "rule_type": row[2]})
        except Exception:
            pass  # rules table may not exist yet

        # Data migration flag: true if fields were removed or type changed
        data_migration = False
        try:
            latest = await db.scalar(
                select(ModelVersion)
                .where(ModelVersion.model_id == model_id)
                .order_by(ModelVersion.version.desc())
                .limit(1)
            )
            if latest:
                old_snapshot = json.loads(latest.snapshot) if isinstance(latest.snapshot, str) else latest.snapshot
                old_fields = {f["field_name"]: f["field_type"] for f in old_snapshot.get("fields", [])}
                current_fields = {}
                fields_result = await db.execute(
                    select(MetaField).where(MetaField.model_id == model_id)
                )
                for f in fields_result.scalars().all():
                    current_fields[f.field_name] = f.field_type
                # Check for removed or type-changed fields
                for fname, ftype in old_fields.items():
                    if fname not in current_fields:
                        data_migration = True
                        break
                    if current_fields[fname] != ftype:
                        data_migration = True
                        break
        except Exception:
            pass

        return {
            "forms": affected_forms,
            "pages": affected_pages,
            "rules": affected_rules,
            "data_migration": data_migration,
        }

    result = await try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    mock_pages = [p for p in MOCK_PAGES if p["model_id"] == model_id]
    return {
        "forms": [],
        "pages": [{"id": p["id"], "name": p["name"], "title": p["title"], "route_path": p["route_path"]} for p in mock_pages],
        "rules": [],
        "data_migration": False,
    }
