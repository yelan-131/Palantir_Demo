"""Dashboard API backed by configured business/analysis tables."""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any
from types import SimpleNamespace

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import current_tenant_id, get_current_user, get_db, require_admin
from app.core.db import safe_db_call as _try_db
from app.models.relational import DynamicRecord, Form
from app.services.alert_service import is_material_request
from app.services.analytics_data import load_data as load_analytics_data, read_filters
from app.services.analytics_editor import AnalyticsPreviewRequest, AnalyticsWriteRequest

router = APIRouter()


# Library endpoints precede program routes and share the same admin boundary.
from app.services.analytics_metric_library import SharedMetricDefinition, SharedMetricWrite, SharedMetricPublish


@router.get('/analytics/metrics')
async def list_shared_metrics(db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_metric_library import list_metrics
    return await list_metrics(db, user)


@router.post('/analytics/metrics')
async def create_shared_metric(body: SharedMetricDefinition, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_metric_library import create_metric
    return await create_metric(db, user, body)


@router.get('/analytics/metrics/{metric_id}')
async def get_shared_metric(metric_id: str, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_metric_library import get_metric
    return await get_metric(db, user, metric_id)


@router.put('/analytics/metrics/{metric_id}/draft')
async def save_shared_metric(metric_id: str, body: SharedMetricWrite, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_metric_library import save_metric
    return await save_metric(db, user, metric_id, body)


@router.get('/analytics/metrics/{metric_id}/references')
async def shared_metric_references(metric_id: str, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_metric_library import references
    return await references(db, user, metric_id)


@router.post('/analytics/metrics/{metric_id}/impact')
async def shared_metric_impact(metric_id: str, body: SharedMetricWrite, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_metric_library import impact
    return await impact(db, user, metric_id, body)


@router.post('/analytics/metrics/{metric_id}/publish')
async def publish_shared_metric(metric_id: str, body: SharedMetricPublish, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_metric_library import publish_metric
    return await publish_metric(db, user, metric_id, body)

MOCK_OVERVIEW = {
    "factories": {"count": 0},
    "equipment": {"total": 0, "running": 0, "utilization_rate": 0},
    "production_lines": {"total": 0, "running": 0},
    "work_orders": {"total": 0, "in_progress": 0, "completed": 0},
    "quality": {"defect_count": 0},
    "avg_equipment_health": 0,
}


@router.get("/overview")
async def get_overview(user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    result = await _try_db(lambda db: _query_overview(db, tenant_id, user=user))
    return result or {**MOCK_OVERVIEW, "source": "fallback"}


@router.get("/oee")
async def get_oee(line_id: int | None = None, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    lines = await _try_db(lambda db: _query_lines(db, tenant_id, line_id, user=user))
    source = "physical_table" if lines else "fallback"
    if not lines:
        lines = [{"id": index, "name": f"Line {index:03d}", "oee_target": 0.86} for index in range(1, 25)]

    oee_data = []
    for line in lines[:80]:
        line_id_value = int(line.get("id") or 0)
        random.seed(line_id_value * 17)
        availability = round(random.uniform(0.82, 0.98), 3)
        performance = round(random.uniform(0.78, 0.96), 3)
        quality_rate = round(random.uniform(0.94, 0.998), 3)
        oee_data.append({
            "line_id": line_id_value,
            "line_name": line.get("name"),
            "availability": availability,
            "performance": performance,
            "quality": quality_rate,
            "oee": round(availability * performance * quality_rate, 3),
            "target": line.get("oee_target", 0.86),
        })
    return {"data": oee_data, "tenant_id": tenant_id, "source": source}


@router.get("/production")
async def get_production_stats(days: int = Query(14, ge=1, le=90), user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    result = await _try_db(lambda db: _query_production_stats(db, tenant_id, days, user=user))
    if result is not None:
        return result
    return {"data": _mock_production_stats(days), "source": "fallback"}


@router.get("/alerts")
async def get_alerts(limit: int = Query(20, ge=1, le=100), user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    result = await _try_db(lambda db: _query_alerts(db, tenant_id, limit, user=user))
    if result is not None:
        return result
    return {"data": [], "total": 0, "source": "fallback"}


@router.get("/programs/{program_id}")
async def get_program_data(
    program_id: str,
    limit: int = Query(500, ge=1, le=1000),
    filters: str | None = Query(None, max_length=8192),
    widget_filters: str | None = Query(None, max_length=8192),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    result = await _query_form_program(db, tenant_id, program_id, limit, user=user,
        filters=read_filters(filters), widget_filters=read_filters(widget_filters, True))
    if result is None:
        return {"data": None, "source": "unsupported", "program_id": program_id}
    result["program_id"] = program_id
    return result


@router.get("/programs/{program_id}/analytics/editor")
async def get_analytics_editor(program_id: str, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_editor import get_editor
    return await get_editor(db, user, program_id)


@router.get("/programs/{program_id}/analytics/versions")
async def list_analytics_versions(program_id: str, limit: int = Query(20, ge=1, le=100),
                                  offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db),
                                  user: dict = Depends(require_admin)):
    from app.services.analytics_editor import list_versions
    return await list_versions(db, user, program_id, limit=limit, offset=offset)


@router.get("/programs/{program_id}/analytics/versions/{version_number}")
async def get_analytics_version(program_id: str, version_number: int,
                                db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_editor import get_version
    return await get_version(db, user, program_id, version_number)


@router.post("/programs/{program_id}/analytics/preview")
async def preview_analytics(program_id: str, body: AnalyticsPreviewRequest, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_editor import preview
    return await preview(db, user, program_id, body)


@router.put("/programs/{program_id}/analytics/draft")
async def save_analytics_draft(program_id: str, body: AnalyticsWriteRequest, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_editor import write_design
    return await write_design(db, user, program_id, body)


@router.post("/programs/{program_id}/analytics/publish")
async def publish_analytics(program_id: str, body: AnalyticsWriteRequest, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    from app.services.analytics_editor import write_design
    return await write_design(db, user, program_id, body, publish=True)


def _metric(label: str, value: int | float | str, tone: str, suffix: str | None = None) -> dict:
    payload = {"label": label, "value": value, "tone": tone}
    if suffix:
        payload["suffix"] = suffix
    return payload


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    assert_safe_identifier(table_name)
    bind = db.get_bind()
    dialect = bind.dialect.name if bind is not None else ""
    if dialect == "sqlite":
        return bool(
            await db.scalar(
                text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
                {"table_name": table_name},
            )
        )
    return bool(await db.scalar(text("SELECT to_regclass(:table_name) IS NOT NULL"), {"table_name": f"public.{table_name}"}))


async def _dashboard_records(db, table_name, tenant_id, user):
    # Legacy metric names are resolved to configured forms, including dynamic storage.
    from app.services.records import authorized_records
    from app.core.permissions import evaluate_form_permission
    code = table_name.removeprefix("business_").removeprefix("analysis_").replace("_", "-")
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id,
        (Form.table_name == table_name) | (Form.code == code)))
    if form is None:
        return []
    if not (await evaluate_form_permission(user, form.id, "view", db))["allowed"]:
        return []
    records = await authorized_records(db, user, form, decorate=False,statistics=True)
    records.sort(key=lambda record: record["id"], reverse=True)
    return [{**record["data"], "id": record["id"]} for record in records
        if table_name != "business_alert_center" or not is_material_request(record["data"])]


async def _count_table_rows(db: AsyncSession, table_name: str, tenant_id: int, *, user: dict) -> int:
    return len(await _dashboard_records(db, table_name, tenant_id, user))


async def _fetch_physical_rows(db: AsyncSession, table_name: str, tenant_id: int, limit: int, *, user: dict) -> list[dict[str, Any]]:
    return (await _dashboard_records(db, table_name, tenant_id, user))[:limit]


async def _query_overview(db: AsyncSession, tenant_id: int, *, user: dict):
    production_total = await _count_table_rows(db, "business_production_plans", tenant_id, user=user)
    alert_total = await _count_table_rows(db, "business_alert_center", tenant_id, user=user)
    maintenance_total = await _count_table_rows(db, "business_maintenance_orders", tenant_id, user=user)
    quality_total = await _count_table_rows(db, "business_quality_events", tenant_id, user=user)
    line_rows = await _fetch_physical_rows(db, "analysis_line_status", tenant_id, 1000, user=user)
    device_rows = await _fetch_physical_rows(db, "analysis_device_health", tenant_id, 1000, user=user)
    running_lines = sum(1 for row in line_rows if str(row.get("status") or "").lower() in {"normal", "running", "正常", "运行"})
    health_values = [_safe_float(row.get("actual") or row.get("health") or row.get("score")) for row in device_rows]
    avg_health = sum(health_values) / max(len(health_values), 1)

    return {
        "factories": {"count": 0},
        "equipment": {
            "total": len(device_rows),
            "running": max(len(device_rows) - alert_total, 0),
            "utilization_rate": round(max(len(device_rows) - alert_total, 0) / max(len(device_rows), 1), 3),
        },
        "production_lines": {"total": len(line_rows), "running": running_lines},
        "work_orders": {
            "total": production_total,
            "in_progress": maintenance_total,
            "completed": max(production_total - maintenance_total, 0),
        },
        "quality": {"defect_count": quality_total},
        "avg_equipment_health": round(avg_health / 100, 3) if avg_health > 1 else round(avg_health, 3),
        "tenant_id": tenant_id,
        "source": "physical_tables",
    }


async def _query_lines(db: AsyncSession, tenant_id: int, line_id: int | None, *, user: dict):
    rows = await _fetch_physical_rows(db, "analysis_line_status", tenant_id, 1000, user=user)
    if line_id:
        rows = [row for row in rows if int(row.get("id") or 0) == int(line_id)]
    return [
        {
            "id": int(row.get("id") or index),
            "name": row.get("subject") or row.get("name") or f"Line {index}",
            "oee_target": (_safe_float(row.get("target")) / 100) if _safe_float(row.get("target")) > 1 else (_safe_float(row.get("target")) or 0.86),
        }
        for index, row in enumerate(rows, start=1)
    ]


async def _query_production_stats(db: AsyncSession, tenant_id: int, days: int, *, user: dict):
    start = datetime.now() - timedelta(days=days - 1)
    rows = await _fetch_physical_rows(db, "analysis_production_overview", tenant_id, days, user=user)
    buckets: dict[str, dict[str, int]] = {}
    for row in rows:
        day = str(row.get("date") or datetime.now().strftime("%Y-%m-%d"))[:10]
        bucket = buckets.setdefault(day, {"planned": 0, "actual": 0, "passed": 0})
        planned = int(_safe_float(row.get("target") or row.get("planned")))
        actual = int(_safe_float(row.get("actual")))
        bucket["planned"] += planned
        bucket["actual"] += actual
        bucket["passed"] += int(actual * 0.985) if str(row.get("status") or "") in {"正常", "completed", "normal"} else int(actual * 0.965)

    data = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).strftime("%Y-%m-%d")
        bucket = buckets.get(day, {"planned": 0, "actual": 0, "passed": 0})
        data.append({
            "date": day,
            "planned": bucket["planned"],
            "actual": bucket["actual"],
            "passed": bucket["passed"],
            "yield_rate": round(bucket["passed"] / max(bucket["actual"], 1), 3),
        })
    return {"data": data, "source": "physical_table"}


def _mock_production_stats(days: int) -> list[dict]:
    now = datetime.now()
    data = []
    for offset in range(days):
        day = now - timedelta(days=days - offset - 1)
        random.seed(day.toordinal())
        planned = random.randint(18000, 36000)
        actual = random.randint(int(planned * 0.78), planned)
        passed = random.randint(int(actual * 0.94), actual)
        data.append({
            "date": day.strftime("%Y-%m-%d"),
            "planned": planned,
            "actual": actual,
            "passed": passed,
            "yield_rate": round(passed / max(actual, 1), 3),
        })
    return data


async def _query_alerts(db: AsyncSession, tenant_id: int, limit: int, *, user: dict):
    alert_rows = await _fetch_physical_rows(db, "business_alert_center", tenant_id, limit, user=user)
    alerts = []
    for row in alert_rows:
        level = str(row.get("level") or "")
        severity = "critical" if level in {"严重", "critical", "high"} else "warning"
        alerts.append({
            "id": row.get("alert_id") or f"alert-{row.get('id')}",
            "type": row.get("source") or "business_alert",
            "severity": severity,
            "title": row.get("title") or row.get("alert_id") or "Alert",
            "message": row.get("resolution") or row.get("device") or "",
            "entity_id": row.get("id"),
            "entity_type": "BusinessAlert",
            "timestamp": _json_safe_cell(row.get("occurred_at") or row.get("created_at")),
        })
    return {"data": alerts, "total": len(alerts), "tenant_id": tenant_id, "source": "physical_table"}


async def _query_form_program(db: AsyncSession, tenant_id: int, program_id: str, limit: int, *, user: dict, filters=None, widget_filters=None):
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == program_id))
    if form is None:
        return None
    from app.services.form_runtime import _latest_form_version
    version=await _latest_form_version(db,tenant_id,form.id)
    form_config=(((version.snapshot or {}).get('form') or {}).get('config') or {}) if version else (form.config or {})
    from app.services.designer_permissions import role_configs
    configs=await role_configs(db,user,form)
    statistics_allowed=not configs or any(((value.get('data') or {}).get('ownership') or {}).get('statistics',True) for value in configs)
    from app.services.records import authorized_records
    records = await authorized_records(db, user, form)
    records.sort(key=lambda record: record["id"], reverse=True)
    total = len(records)
    all_rows = []
    for record in records:
        row = _dynamic_record_row(SimpleNamespace(**record), form)
        if "_approval" in record:
            row["_approval"] = record["_approval"]
        all_rows.append(row)
    rows = all_rows[:limit]
    source = "physical_table" if form.table_name and form.storage_mode in {"physical_table", "business_table"} else "dynamic_records"

    analytics_design = form_config.get("analyticsDesign")
    if not statistics_allowed:analytics_design=None
    analytics_data = None
    analytics_published_version = None
    analytics_published_at = None
    if isinstance(analytics_design, dict):
        analytics_data = await load_analytics_data(db, tenant_id, form, analytics_design,
            user=user, filters=filters, widget_filters=widget_filters, limit=limit)
        analytics_published_version = version.version if version else None
        analytics_published_at = version.published_at.isoformat() if version and version.published_at else (
            (form_config.get("analyticsDesignMeta") or {}).get("publishedAt") or form_config.get("publishedAt"))
    high = sum(1 for row in all_rows if row.get("level") in {"高", "critical", "high", "严重"})
    closed = sum(1 for row in all_rows if row.get("status") in {"已关闭", "closed", "completed"})
    return {
        "metrics": ([
            _metric("表单记录", int(total), "blue"),
            _metric("待处理", max(int(total) - closed, 0), "orange"),
            _metric("高风险", high, "red"),
            _metric("已关闭", closed, "green"),
        ] if statistics_allowed else []),
        "rows": rows,
        "total": int(total),
        "viewConfig": form_config.get("viewConfig"),
        "analyticsDesign": analytics_design if isinstance(analytics_design, dict) else None,
        "analyticsData": analytics_data,
        "analyticsDesignState": "published" if isinstance(analytics_design,dict) else None,
        "analyticsPublishedVersion": analytics_published_version,
        "analyticsPublishedAt": analytics_published_at,
        "form": {"id": form.id, "code": form.code, "name": form.name, "kind": form_config.get("assemblyKind")},
        "source": source,
    }


def _json_safe_cell(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _physical_record_row(row: dict[str, Any], form: Form) -> dict:
    data = {
        key: _json_safe_cell(value)
        for key, value in row.items()
        if key not in {
            "id",
            "tenant_id",
            "record_status",
            "created_by",
            "updated_by",
            "source_dynamic_record_id",
            "deleted_at",
            "created_at",
            "updated_at",
        }
    }
    record_id = row.get("id")
    status = data.get("status") or row.get("record_status")
    return {
        **data,
        "key": f"record-{record_id}",
        "recordId": record_id,
        "formId": form.id,
        "formCode": form.code,
        "_formData": data,
        "_createdAt": _json_safe_cell(row.get("created_at")),
        "_updatedAt": _json_safe_cell(row.get("updated_at")),
        "name": data.get("name") or data.get("title") or data.get("subject") or data.get("plan_no") or f"{form.name} {record_id}",
        "status": status,
    }


def _dynamic_record_row(record: DynamicRecord, form: Form) -> dict:
    data = record.data or {}
    return {
        **data,
        "key": f"record-{record.id}",
        "recordId": record.id,
        "formId": form.id,
        "formCode": form.code,
        "_formData": data,
        "_createdAt": _json_safe_cell(record.created_at),
        "_updatedAt": _json_safe_cell(record.updated_at),
        "name": data.get("name") or data.get("title") or data.get("subject") or data.get("planNo") or f"{form.name} {record.id}",
        "status": data.get("status") or record.status,
    }


def _dynamic_analytics_data(rows: list[dict], analytics_design: dict, total: int) -> dict:
    # Compatibility helper; production loads each dataset through the record permission boundary.
    from app.services.analytics_runtime import build_data
    datasets = {item['id']: rows for item in analytics_design.get('datasets') or []}
    fields = {key: set().union(*(row.keys() for row in rows)) for key in datasets}
    return build_data(analytics_design, datasets, fields)


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0
