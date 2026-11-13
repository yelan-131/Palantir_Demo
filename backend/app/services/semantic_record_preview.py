"""Resolve approved property mappings for one form record."""

import asyncio
import json

from fastapi import HTTPException
from sqlalchemy import select

from app.models.relational import DataSource, DataSourceMetadata, OntologyMapping, WorkflowInstance
from app.services.metadata_scan_service import effective_source_type, json_safe, parse_connection_config
from app.services.records import get_record


def _workflow_values(instances, form_id, record_id):
    for instance in instances:
        try:
            state = json.loads(instance.workflow_state or "{}")
        except (TypeError, ValueError):
            continue
        if not isinstance(state, dict):
            continue
        variables = state.get("variables") or {}
        if not isinstance(variables, dict):
            continue
        if variables.get("form_id") == form_id and (
            variables.get("record_id") or state.get("resource_id")
        ) == record_id:
            return {"id": instance.id, "status": instance.status, "created_at": instance.created_at}
    return {}


def read_postgresql_record(config, table, key, value, columns):
    import psycopg2
    from psycopg2 import sql

    conn = psycopg2.connect(
        host=config.get("host"), port=int(config.get("port") or 5432),
        dbname=config.get("database"), user=config.get("username"), password=config.get("password"),
        sslmode="require" if config.get("ssl_enabled") else "prefer",
        connect_timeout=5, options="-c statement_timeout=5000",
    )
    try:
        conn.set_session(readonly=True)
        with conn.cursor() as cursor:
            cursor.execute(sql.SQL("SELECT {} FROM {}.{} WHERE {} = %s LIMIT 2").format(
                sql.SQL(", ").join(map(sql.Identifier, columns)),
                sql.Identifier(str(config.get("schema") or config.get("schema_name") or "public")),
                sql.Identifier(table), sql.Identifier(key),
            ), (value,))
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        conn.close()


async def _external_record(db, tenant_id, link, record):
    source = await db.get(DataSource, link.source_id)
    if not source or source.tenant_id != tenant_id:
        raise HTTPException(404, "外部数据源不存在")
    config = parse_connection_config(source)
    demo = source.source_type == "demo_mes"
    if config.get("sensitivity") == "restricted" or config.get("allow_ontology") is False:
        raise HTTPException(403, "该数据源未授权记录预览")
    metadata = await db.scalar(select(DataSourceMetadata).where(
        DataSourceMetadata.tenant_id == tenant_id, DataSourceMetadata.source_id == source.id,
        DataSourceMetadata.entity_name == link.table, DataSourceMetadata.status == "scanned",
    ))
    columns = [field["name"] for field in (metadata.fields or []) if field.get("name")] if metadata else []
    if link.key_field not in columns:
        raise HTTPException(422, "请选择已扫描的检测表和匹配字段")
    value = record.get(link.form_field)
    evidence = {"source_id": source.id, "source": source.name, "table": link.table,
                "key_field": link.key_field, "key": value, "demo": demo}
    if value is None or value == "":
        return {**evidence, "status": "missing_reference"}
    if not isinstance(value, (str, int, float, bool)):
        raise HTTPException(422, "检测引用必须是单个编号")
    if demo:
        from app.config import settings
        if settings.IS_PRODUCTION:
            raise HTTPException(404, "演示数据源不可用")
        rows = [row for row in metadata.sample_rows or [] if row.get(link.key_field) == value]
    elif effective_source_type(source, config) == "postgresql":
        try:
            rows = await asyncio.to_thread(read_postgresql_record, config, link.table, link.key_field, value, columns)
        except Exception as exc:
            raise HTTPException(502, "无法读取外部检测记录，请检查连接和字段类型") from exc
    else:
        raise HTTPException(422, "检测预览支持已扫描的 PostgreSQL 数据源")
    if len(rows) != 1:
        return {**evidence, "status": "ambiguous" if rows else "not_found"}
    return {**evidence, "status": "matched", "data": json_safe({key: rows[0].get(key) for key in columns})}


async def preview_semantic_record(db, user, tenant_id, body):
    form_source = await db.get(DataSource, body.form_source_id)
    if not form_source or form_source.tenant_id != tenant_id or form_source.source_type != "internal_form":
        raise HTTPException(404, "请选择已登记的表单资产")
    form_id = parse_connection_config(form_source)["resource_id"]
    payload = (await get_record(form_id, body.record_id, db, user))["data"]
    record = payload.get("data") or {}
    mappings = (await db.scalars(select(OntologyMapping).where(
        OntologyMapping.tenant_id == tenant_id, OntologyMapping.target_object_code == body.object_code,
        OntologyMapping.status == "approved", OntologyMapping.target_field_code.is_not(None),
    ).order_by(OntologyMapping.id))).all()
    properties = []
    workflow_values = {}
    for mapping in mappings:
        if mapping.source_system == str(form_source.id) and mapping.source_entity == f"internal_form_{form_id}":
            values, source_name, record_id = record, form_source.name, body.record_id
        else:
            if not mapping.source_system.isdecimal():
                continue
            source = await db.get(DataSource, int(mapping.source_system))
            if not source or source.tenant_id != tenant_id or source.source_type != "internal_workflow":
                continue
            workflow_id = parse_connection_config(source)["resource_id"]
            if mapping.source_entity != f"internal_workflow_{workflow_id}":
                continue
            if workflow_id not in workflow_values:
                instances = await db.scalars(select(WorkflowInstance).where(
                    WorkflowInstance.tenant_id == tenant_id, WorkflowInstance.workflow_id == workflow_id,
                ).order_by(WorkflowInstance.created_at.desc(), WorkflowInstance.id.desc()))
                workflow_values[workflow_id] = _workflow_values(instances, form_id, body.record_id)
            values, source_name = workflow_values[workflow_id], source.name
            record_id = values.get("id")
        properties.append({
            "field": mapping.target_field_code, "value": json_safe(values.get(mapping.source_field)),
            "status": "resolved" if mapping.source_field in values else "missing",
            "source": source_name, "source_field": mapping.source_field, "record_id": record_id,
        })
    counts = {}
    for item in properties:
        counts[item["field"]] = counts.get(item["field"], 0) + 1
    for item in properties:
        if counts[item["field"]] > 1:
            item.update(status="conflict", value=None)
    return {"record_id": body.record_id, "properties": properties,
            "external": await _external_record(db, tenant_id, body.external, record) if body.external else None}
