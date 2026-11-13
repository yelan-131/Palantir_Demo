"""Register form and workflow schemas in the same catalog as external sources."""

import json

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models.relational import DataSource, DynamicRecord, Form, WorkflowDef, WorkflowInstance
from app.services.metadata_scan_service import parse_connection_config, scan_data_source_metadata
from app.services.records import runtime_fields

INTERNAL_MODELS = {"internal_form": Form, "internal_workflow": WorkflowDef}
WORKFLOW_FIELDS = [
    {"name": "id", "label": "审批实例 ID", "type": "integer", "primary_key": True},
    {"name": "status", "label": "审批状态", "type": "string"},
    {"name": "created_at", "label": "发起时间", "type": "datetime"},
]


async def internal_asset_table(db, tenant_id, kind, resource_id):
    model = INTERNAL_MODELS[kind]
    resource = await db.scalar(select(model).where(model.id == resource_id, model.tenant_id == tenant_id))
    if resource is None:
        raise HTTPException(404, "表单或流程不存在")

    if kind == "internal_form":
        fields = [
            {"name": field.field_name, "label": field.label, "type": field.field_type}
            for field in await runtime_fields(db, resource)
            if not field.archived and field.visible_in_form
        ]
        from app.api.form_engine import _uses_physical_form_table
        from sqlalchemy import text
        if _uses_physical_form_table(resource):
            table = db.bind.dialect.identifier_preparer.quote(resource.table_name)
            count = await db.scalar(
                text(f"SELECT count(*) FROM {table} WHERE tenant_id = :tenant AND deleted_at IS NULL"),
                {"tenant": tenant_id},
            )
        else:
            count = await db.scalar(select(func.count()).select_from(DynamicRecord).where(
                DynamicRecord.tenant_id == tenant_id, DynamicRecord.form_id == resource_id,
                DynamicRecord.deleted_at.is_(None),
            ))
        label = f"{resource.name} · 表单记录"
    else:
        fields = WORKFLOW_FIELDS
        count = await db.scalar(select(func.count()).select_from(WorkflowInstance).where(
            WorkflowInstance.tenant_id == tenant_id, WorkflowInstance.workflow_id == resource_id,
        ))
        label = f"{resource.name} · 流程实例"
    return {"name": f"{kind}_{resource_id}", "label": label, "rows": count, "fields": fields}


async def register_internal_asset(db, tenant_id, kind, resource_id):
    await internal_asset_table(db, tenant_id, kind, resource_id)
    name = f"本系统 · {'表单' if kind == 'internal_form' else '流程'} #{resource_id}"
    query = select(DataSource).where(DataSource.tenant_id == tenant_id, DataSource.name == name)
    source = await db.scalar(query)
    if source is None:
        try:
            async with db.begin_nested():
                source = DataSource(tenant_id=tenant_id, name=name, source_type=kind, status="connected",
                                    connection_config=json.dumps({"resource_id": resource_id, "allow_ai": False}))
                db.add(source)
                await db.flush()
        except IntegrityError:
            source = await db.scalar(query)
            if source is None:
                raise
    if source.source_type != kind or parse_connection_config(source).get("resource_id") != resource_id:
        raise HTTPException(409, "资产登记名称已被占用")
    await scan_data_source_metadata(db, tenant_id=tenant_id, source_id=source.id, sample_limit=0)
    return source.id
