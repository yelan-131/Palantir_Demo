"""Read a scanned PostgreSQL table and upsert its approved fields into a form."""

from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg2
from fastapi import HTTPException
from psycopg2 import sql
from sqlalchemy import String, and_, cast, delete, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from app.core.logging import get_logger
from app.core.principal import current_tenant_id, current_user_id
from app.core.production_errors import coded_error
from app.models.relational import (
    DataSource, DataSourceMetadata, Form, MappedFormSyncBinding, MappedFormSyncRun, OntologyMapping, OntologyObject,
)
from app.services import field_uniqueness, form_imports, records
from app.services.form_application_lifecycle import enabled as managed_lifecycle
from app.services.form_option_sources import read_snapshot
from app.services.form_rules import config as field_config
from app.services.form_schemas import DynamicRecordCreate, DynamicRecordUpdate
from app.services.metadata_scan_service import connect_postgresql, effective_source_type, parse_connection_config


MAX_SYNC_ROWS = 500
logger = get_logger(__name__)


@dataclass
class SyncPlan:
    source: DataSource
    settings: dict[str, Any]
    form: Form
    fields: list
    target_fields: dict
    primary_key: str
    columns: dict[str, str]
    key_field: Any


@dataclass
class SyncProgress:
    read: int = 0


async def sync_to_form(db, user, *, source_id, entity_name, object_code, form_id, source_key):
    tenant_id = current_tenant_id(user)
    # The same lock protects ordinary record writes, unique rules and form publishing.
    await field_uniqueness.lock(db, tenant_id)
    target = dict(source_id=source_id, entity_name=entity_name, object_code=object_code, form_id=form_id)
    plan = await _prepare_sync(db, user, **target)
    counts = await _apply_sync(db, user, plan, entity_name, source_key, SyncProgress())
    await db.commit()
    return {**target, **counts}


async def _get_source(db, tenant_id, source_id):
    source = await db.get(DataSource, source_id)
    if not source or source.tenant_id != tenant_id:
        raise HTTPException(404, "数据源不存在")
    return source


async def _prepare_sync(db, user, *, source_id, entity_name, object_code, form_id):
    tenant_id = current_tenant_id(user)
    source = await _get_source(db, tenant_id, source_id)
    settings = parse_connection_config(source)
    if not isinstance(settings, dict) or effective_source_type(source, settings) != "postgresql":
        raise HTTPException(422, "映射同步仅支持已登记的 PostgreSQL 连接")
    if source.status == "paused":
        raise HTTPException(409, "请先启用已暂停的数据源")
    selected_tables = settings.get("selected_tables") or []
    if selected_tables and (not isinstance(selected_tables, list) or entity_name not in selected_tables):
        raise HTTPException(422, "请先将来源表纳入此连接的采集范围")

    form, _, fields, writable = await form_imports.context(db, user, form_id)
    if form.status != "published" or await managed_lifecycle(db, form):
        raise HTTPException(409, "请选择已发布且无需提交审批的业务表单")
    await records.require_form_permission(db, user, form_id, "edit")
    target_fields = {field.field_name: field for field in writable}
    primary_key, columns, key_field = await _approved_columns(
        db, tenant_id, source_id, entity_name, object_code, form_id, target_fields,
    )
    return SyncPlan(source, settings, form, fields, target_fields, primary_key, columns, key_field)


async def _apply_sync(db, user, plan, entity_name, source_key, progress):
    source_rows = await run_in_threadpool(
        _read_source_rows, plan.settings, entity_name, plan.primary_key, plan.columns, source_key,
    )
    progress.read = len(source_rows)
    if len(source_rows) > MAX_SYNC_ROWS:
        raise HTTPException(422, f"单次最多同步 {MAX_SYNC_ROWS} 条，请指定来源主键同步单条记录")

    payloads = {}
    for row in source_rows:
        payload = {target: form_imports.convert(row[column], plan.target_fields[target])
                   for target, column in plan.columns.items()}
        identity = field_uniqueness.signature(plan.key_field, payload)
        if identity is None or identity in payloads:
            raise HTTPException(409, "来源主键转换后为空或重复，请检查来源表和目标字段类型")
        payloads[identity] = payload

    async with read_snapshot():
        counts = await _upsert_rows(db, user, plan.form, plan.fields, plan.target_fields, plan.key_field, payloads)
    plan.source.last_sync = datetime.now()
    return {"read": progress.read, **counts}


async def _approved_columns(db, tenant_id, source_id, entity_name, object_code, form_id, target_fields):
    metadata = await db.scalar(select(DataSourceMetadata).where(
        DataSourceMetadata.tenant_id == tenant_id,
        DataSourceMetadata.source_id == source_id,
        DataSourceMetadata.entity_name == entity_name,
        DataSourceMetadata.status == "scanned",
    ))
    if not metadata:
        raise HTTPException(409, "请先扫描来源表的元数据")
    source_fields = {field["name"]: field for field in metadata.fields if field.get("name")}
    primary_keys = [name for name, field in source_fields.items() if field.get("primary_key")]
    if len(primary_keys) != 1:
        raise HTTPException(422, "同步需要来源表有且仅有一个主键字段")
    primary_key = primary_keys[0]

    obj = await db.scalar(select(OntologyObject).where(
        OntologyObject.tenant_id == tenant_id,
        OntologyObject.code == object_code,
        OntologyObject.status == "published",
    ))
    if not obj:
        raise HTTPException(409, "请选择已发布的业务对象")
    record_binding = (obj.metadata_json or {}).get("record_binding") or {}
    if record_binding and record_binding.get("form_id") != form_id:
        raise HTTPException(409, "请选择该对象已绑定的记录来源表单")
    property_fields = record_binding.get("property_fields") or {}
    mappings = (await db.scalars(select(OntologyMapping).where(
        OntologyMapping.tenant_id == tenant_id,
        OntologyMapping.source_system == str(source_id),
        OntologyMapping.source_entity == entity_name,
        OntologyMapping.target_object_code == object_code,
        OntologyMapping.target_field_code.is_not(None),
        OntologyMapping.status.in_(("approved", "published")),
    ))).all()
    columns = {}
    for mapping in mappings:
        if record_binding and mapping.target_field_code not in property_fields:
            raise HTTPException(422, f"属性「{mapping.target_field_code}」未配置对象记录字段")
        target = property_fields.get(mapping.target_field_code, mapping.target_field_code)
        if target not in target_fields or mapping.source_field not in source_fields:
            raise HTTPException(422, f"映射字段「{target}」缺少对应的来源列或可写表单字段")
        if target in columns:
            raise HTTPException(422, f"表单字段「{target}」存在多条已审核映射")
        columns[target] = mapping.source_field

    key_targets = [target for target, column in columns.items() if column == primary_key]
    if len(key_targets) != 1:
        raise HTTPException(422, "请将来源主键审核映射到一个表单字段")
    key_field = target_fields[key_targets[0]]
    if record_binding and record_binding.get("key_field") != key_field.field_name:
        raise HTTPException(409, "来源主键须映射到该对象的记录主键")
    unique_rule = (field_config(key_field).get("rules") or {}).get("unique") or {}
    conditions = unique_rule.get("conditions") or {}
    if (not unique_rule.get("enabled") or unique_rule.get("conditionGroups")
            or set(conditions) - {"strategy"} or conditions.get("strategy", "form") not in {"form", "global"}):
        raise HTTPException(422, f"请为表单主键字段「{key_field.label}」启用无条件的单字段唯一规则并发布")
    await _check_property_owners(
        db, tenant_id, source_id, entity_name, object_code, form_id,
        property_fields, set(columns) - {key_field.field_name},
    )
    return primary_key, columns, key_field


async def _check_property_owners(db, tenant_id, source_id, entity_name, object_code, form_id, aliases, targets):
    if not targets:
        return
    binding = MappedFormSyncBinding
    mapping = OntologyMapping
    other_properties = (await db.scalars(select(mapping.target_field_code).join(binding, and_(
        mapping.tenant_id == binding.tenant_id,
        mapping.source_system == cast(binding.source_id, String),
        mapping.source_entity == binding.entity_name,
        mapping.target_object_code == binding.object_code,
    )).where(
        binding.tenant_id == tenant_id, binding.form_id == form_id, binding.object_code == object_code,
        or_(binding.source_id != source_id, binding.entity_name != entity_name),
        mapping.target_field_code.is_not(None), mapping.status.in_(("approved", "published")),
    ))).all()
    conflicts = targets & {aliases.get(code, code) for code in other_properties}
    if conflicts:
        raise HTTPException(409, f"其他来源已绑定字段「{'、'.join(sorted(conflicts))}」，请检查已审核映射")


def _binding_target(binding):
    return dict(source_id=binding.source_id, entity_name=binding.entity_name,
                object_code=binding.object_code, form_id=binding.form_id)


def _run_payload(run, target):
    return {
        "id": run.id, "binding_id": run.binding_id, **target,
        "source_key": run.source_key, "status": run.status,
        "started_at": run.started_at.astimezone().isoformat(), "finished_at": run.finished_at.astimezone().isoformat(),
        "read": run.read, "created": run.created, "updated": run.updated, "unchanged": run.unchanged,
        "error_message": run.error_message,
    }


async def _get_binding(db, tenant_id, source_id, binding_id):
    binding = await db.scalar(select(MappedFormSyncBinding).where(
        MappedFormSyncBinding.id == binding_id,
        MappedFormSyncBinding.tenant_id == tenant_id,
        MappedFormSyncBinding.source_id == source_id,
    ))
    if not binding:
        raise HTTPException(404, "同步配置不存在")
    return binding


async def list_sync_bindings(db, user, source_id):
    tenant_id = current_tenant_id(user)
    await _get_source(db, tenant_id, source_id)
    binding = MappedFormSyncBinding
    run = MappedFormSyncRun
    recent = (select(run.id, func.row_number().over(partition_by=run.binding_id,
        order_by=(run.finished_at.desc(), run.id.desc())).label("position"))
        .join(binding, binding.id == run.binding_id)
        .where(run.tenant_id == tenant_id, binding.tenant_id == tenant_id, binding.source_id == source_id)
        .subquery())
    rows = (await db.execute(select(binding, run)
        .outerjoin(run, and_(run.binding_id == binding.id, run.id.in_(select(recent.c.id).where(recent.c.position == 1))))
        .where(binding.tenant_id == tenant_id, binding.source_id == source_id)
        .order_by(binding.id))).all()
    return [
        {"id": item.id, **_binding_target(item),
         "last_run": _run_payload(latest, _binding_target(item)) if latest else None}
        for item, latest in rows
    ]


async def save_sync_binding(db, user, *, source_id, entity_name, object_code, form_id):
    tenant_id = current_tenant_id(user)
    await field_uniqueness.lock(db, tenant_id)
    target = dict(source_id=source_id, entity_name=entity_name, object_code=object_code, form_id=form_id)
    await _prepare_sync(db, user, **target)
    binding = await db.scalar(select(MappedFormSyncBinding).filter_by(tenant_id=tenant_id, **target))
    if not binding:
        binding = MappedFormSyncBinding(tenant_id=tenant_id, created_by=current_user_id(user), **target)
        db.add(binding)
        await db.flush()
    payload = {"id": binding.id, **target}
    await db.commit()
    return payload


async def list_sync_runs(db, user, source_id, binding_id, limit):
    tenant_id = current_tenant_id(user)
    binding = await _get_binding(db, tenant_id, source_id, binding_id)
    target = _binding_target(binding)
    runs = (await db.scalars(select(MappedFormSyncRun).where(
        MappedFormSyncRun.binding_id == binding_id,
        MappedFormSyncRun.tenant_id == tenant_id,
    ).order_by(MappedFormSyncRun.finished_at.desc(), MappedFormSyncRun.id.desc()).limit(limit))).all()
    return [_run_payload(run, target) for run in runs]


async def run_sync_binding(db, user, *, source_id, binding_id, source_key):
    tenant_id = current_tenant_id(user)
    await field_uniqueness.lock(db, tenant_id)
    binding = await _get_binding(db, tenant_id, source_id, binding_id)
    target = _binding_target(binding)
    run_fields = dict(tenant_id=tenant_id, binding_id=binding_id, actor_id=current_user_id(user),
                      source_key=source_key, started_at=datetime.now())
    progress = SyncProgress()
    try:
        plan = await _prepare_sync(db, user, **target)
        counts = await _apply_sync(db, user, plan, target["entity_name"], source_key, progress)
        run = MappedFormSyncRun(status="completed", finished_at=datetime.now(), **run_fields, **counts)
        db.add(run)
        await db.flush()
        payload = _run_payload(run, target)
        await db.commit()
        return payload
    except Exception as exc:
        finished_at = datetime.now()
        await db.rollback()
        await _save_failed_run(db, source_id, run_fields, finished_at, progress.read, exc)
        raise


async def _save_failed_run(db, source_id, run_fields, finished_at, read, exc):
    detail = exc.detail if isinstance(exc, HTTPException) else None
    if isinstance(detail, dict):
        detail = detail.get("message")
    error_message = (detail if isinstance(detail, str) else "同步执行失败，请核对连接和应用日志")[:500]
    tenant_id = run_fields["tenant_id"]
    try:
        await field_uniqueness.lock(db, tenant_id)
        await _get_binding(db, tenant_id, source_id, run_fields["binding_id"])
        db.add(MappedFormSyncRun(status="failed", finished_at=finished_at, read=read,
                                 error_message=error_message, **run_fields))
        await db.commit()
    except (HTTPException, SQLAlchemyError):
        await db.rollback()
        logger.warning("Could not persist failed mapped sync receipt for binding %s", run_fields["binding_id"])


async def last_record_sync_by_source(db, tenant_id):
    binding = MappedFormSyncBinding
    run = MappedFormSyncRun
    rows = (await db.execute(select(binding.source_id, func.max(run.finished_at))
        .join(run, run.binding_id == binding.id)
        .where(binding.tenant_id == tenant_id, run.tenant_id == tenant_id, run.status == "completed")
        .group_by(binding.source_id))).all()
    return dict(rows)


async def delete_source_sync_history(db, tenant_id, source_id):
    # Mirror the foreign-key cascades in local SQLite, which can run with FK checks disabled.
    await field_uniqueness.lock(db, tenant_id)
    binding_scope = (MappedFormSyncBinding.tenant_id == tenant_id, MappedFormSyncBinding.source_id == source_id)
    binding_ids = select(MappedFormSyncBinding.id).where(*binding_scope)
    await db.execute(delete(MappedFormSyncRun).where(
        MappedFormSyncRun.tenant_id == tenant_id, MappedFormSyncRun.binding_id.in_(binding_ids),
    ))
    await db.execute(delete(MappedFormSyncBinding).where(*binding_scope))


def _read_source_rows(settings, entity_name, primary_key, columns, source_key):
    schema = str(settings.get("schema") or settings.get("schema_name") or "public")
    names = list(dict.fromkeys(columns.values()))
    pk = sql.Identifier(primary_key)
    query = sql.SQL("SELECT {} FROM {}.{}").format(
        sql.SQL(", ").join(map(sql.Identifier, names)), sql.Identifier(schema), sql.Identifier(entity_name),
    )
    params = []
    if source_key is not None:
        query += sql.SQL(" WHERE {} = %s").format(pk)
        params.append(source_key)
    query += sql.SQL(" ORDER BY {} LIMIT %s").format(pk)
    params.append(MAX_SYNC_ROWS + 1)
    try:
        with closing(connect_postgresql(settings, options="-c statement_timeout=10000 -c lock_timeout=5000")) as conn:
            conn.set_session(readonly=True)
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                return [dict(zip(names, row)) for row in cursor.fetchall()]
    except psycopg2.errors.InvalidTextRepresentation as exc:
        raise HTTPException(422, "来源主键值与来源字段类型不匹配") from exc
    except (psycopg2.Error, RuntimeError, ValueError) as exc:
        raise coded_error(502, "MAPPED_FORM_SYNC_SOURCE_FAILED", "无法读取 PostgreSQL 来源表，请检查连接和表结构") from exc


async def _upsert_rows(db, user, form, fields, target_fields, key_field, payloads):
    matching_records = {}
    if payloads:
        async for record in records.iter_raw(db, form, fields=fields):
            identity = field_uniqueness.signature(key_field, record["data"])
            if identity in payloads:
                if identity in matching_records:
                    raise HTTPException(409, "目标表单已有重复主键，请处理重复记录后重试")
                matching_records[identity] = record

    counts = dict(created=0, updated=0, unchanged=0)
    for identity, payload in payloads.items():
        record = matching_records.get(identity)
        if record is None:
            for name, field in target_fields.items():
                if name not in payload and field.default_value not in (None, ""):
                    payload[name] = form_imports.convert(field.default_value, field)
            await records.create_record(
                form.id, DynamicRecordCreate(data=payload), db, user, defer_commit=True, source="mapped-form-sync",
            )
            counts["created"] += 1
            continue

        changes = {name: value for name, value in payload.items() if record["data"].get(name) != value}
        if changes:
            await records.update_record(form.id, record["id"], DynamicRecordUpdate(data=changes), db, user, defer_commit=True)
            counts["updated"] += 1
        else:
            counts["unchanged"] += 1
    return counts
