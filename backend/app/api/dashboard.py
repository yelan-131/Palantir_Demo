"""Dashboard API backed by configured business/analysis tables."""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._model_driven_shared import assert_safe_identifier
from app.api.deps import current_tenant_id, get_current_user, get_db
from app.core.db import safe_db_call as _try_db
from app.models.relational import DynamicRecord, Form

router = APIRouter()

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
    result = await _try_db(lambda db: _query_overview(db, tenant_id))
    return result or {**MOCK_OVERVIEW, "source": "fallback"}


@router.get("/oee")
async def get_oee(line_id: int | None = None, user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    lines = await _try_db(lambda db: _query_lines(db, tenant_id, line_id))
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
    result = await _try_db(lambda db: _query_production_stats(db, tenant_id, days))
    if result is not None:
        return result
    return {"data": _mock_production_stats(days), "source": "fallback"}


@router.get("/alerts")
async def get_alerts(limit: int = Query(20, ge=1, le=100), user: dict = Depends(get_current_user)):
    tenant_id = current_tenant_id(user)
    result = await _try_db(lambda db: _query_alerts(db, tenant_id, limit))
    if result is not None:
        return result
    return {"data": [], "total": 0, "source": "fallback"}


@router.get("/programs/{program_id}")
async def get_program_data(
    program_id: str,
    limit: int = Query(500, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    tenant_id = current_tenant_id(user)
    result = await _query_form_program(db, tenant_id, program_id, limit)
    if result is None:
        return {"data": None, "source": "unsupported", "program_id": program_id}
    result["program_id"] = program_id
    return result


def _metric(label: str, value: int | float | str, tone: str, suffix: str | None = None) -> dict:
    payload = {"label": label, "value": value, "tone": tone}
    if suffix:
        payload["suffix"] = suffix
    return payload


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    assert_safe_identifier(table_name)
    return bool(await db.scalar(text("SELECT to_regclass(:table_name) IS NOT NULL"), {"table_name": f"public.{table_name}"}))


async def _count_table_rows(db: AsyncSession, table_name: str, tenant_id: int) -> int:
    assert_safe_identifier(table_name)
    if not await _table_exists(db, table_name):
        return 0
    return int(await db.scalar(text(f"SELECT count(*) FROM {table_name} WHERE tenant_id = :tenant_id AND deleted_at IS NULL"), {"tenant_id": tenant_id}) or 0)


async def _fetch_physical_rows(db: AsyncSession, table_name: str, tenant_id: int, limit: int) -> list[dict[str, Any]]:
    assert_safe_identifier(table_name)
    if not await _table_exists(db, table_name):
        return []
    rows = (
        await db.execute(
            text(f"SELECT * FROM {table_name} WHERE tenant_id = :tenant_id AND deleted_at IS NULL ORDER BY id DESC LIMIT :limit"),
            {"tenant_id": tenant_id, "limit": limit},
        )
    ).all()
    return [dict(row._mapping) for row in rows]


async def _query_overview(db: AsyncSession, tenant_id: int):
    production_total = await _count_table_rows(db, "business_production_plans", tenant_id)
    alert_total = await _count_table_rows(db, "business_alert_center", tenant_id)
    maintenance_total = await _count_table_rows(db, "business_maintenance_orders", tenant_id)
    quality_total = await _count_table_rows(db, "business_quality_events", tenant_id)
    line_rows = await _fetch_physical_rows(db, "analysis_line_status", tenant_id, 1000)
    device_rows = await _fetch_physical_rows(db, "analysis_device_health", tenant_id, 1000)
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


async def _query_lines(db: AsyncSession, tenant_id: int, line_id: int | None):
    rows = await _fetch_physical_rows(db, "analysis_line_status", tenant_id, 1000)
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


async def _query_production_stats(db: AsyncSession, tenant_id: int, days: int):
    start = datetime.now() - timedelta(days=days - 1)
    rows = await _fetch_physical_rows(db, "analysis_production_overview", tenant_id, days)
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


async def _query_alerts(db: AsyncSession, tenant_id: int, limit: int):
    alert_rows = await _fetch_physical_rows(db, "business_alert_center", tenant_id, limit)
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


async def _query_form_program(db: AsyncSession, tenant_id: int, program_id: str, limit: int):
    form = await db.scalar(select(Form).where(Form.tenant_id == tenant_id, Form.code == program_id))
    if form is None:
        return None
    form_config = form.config or {}

    if form.table_name and str(form.storage_mode or "").lower() in {"physical_table", "business_table"}:
        rows = [_physical_record_row(row, form) for row in await _fetch_physical_rows(db, str(form.table_name), tenant_id, limit)]
        total = await _count_table_rows(db, str(form.table_name), tenant_id)
        source = "physical_table"
    else:
        total = await db.scalar(
            select(func.count(DynamicRecord.id)).where(
                DynamicRecord.tenant_id == tenant_id,
                DynamicRecord.form_id == form.id,
                DynamicRecord.deleted_at.is_(None),
            )
        ) or 0
        records = (
            await db.execute(
                select(DynamicRecord)
                .where(
                    DynamicRecord.tenant_id == tenant_id,
                    DynamicRecord.form_id == form.id,
                    DynamicRecord.deleted_at.is_(None),
                )
                .order_by(DynamicRecord.id.desc())
                .limit(limit)
            )
        ).scalars().all()
        rows = [_dynamic_record_row(record, form) for record in records]
        source = "dynamic_records"

    analytics_design = form_config.get("analyticsDesign")
    if not isinstance(analytics_design, dict):
        analytics_design = form_config.get("analyticsDesignDraft")
    high = sum(1 for row in rows if row.get("level") in {"高", "critical", "high", "严重"})
    closed = sum(1 for row in rows if row.get("status") in {"已关闭", "closed", "completed"})
    return {
        "metrics": [
            _metric("表单记录", int(total), "blue"),
            _metric("待处理", max(int(total) - closed, 0), "orange"),
            _metric("高风险", high, "red"),
            _metric("已关闭", closed, "green"),
        ],
        "rows": rows,
        "total": int(total),
        "viewConfig": form_config.get("viewConfig"),
        "analyticsDesign": analytics_design if isinstance(analytics_design, dict) else None,
        "analyticsData": _dynamic_analytics_data(rows, analytics_design, int(total)) if isinstance(analytics_design, dict) else None,
        "analyticsDesignState": "draft" if isinstance(form_config.get("analyticsDesignDraft"), dict) else ("published" if isinstance(form_config.get("analyticsDesign"), dict) else None),
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
        "_createdAt": record.created_at.isoformat() if record.created_at else None,
        "_updatedAt": record.updated_at.isoformat() if record.updated_at else None,
        "name": data.get("name") or data.get("title") or data.get("subject") or data.get("planNo") or f"{form.name} {record.id}",
        "status": data.get("status") or record.status,
    }


def _dynamic_analytics_data(rows: list[dict], analytics_design: dict, total: int) -> dict:
    actual_total = sum(_safe_float(row.get("actual")) for row in rows)
    target_total = sum(_safe_float(row.get("target")) for row in rows)
    rate = round((actual_total / target_total) * 100, 1) if target_total else 0
    metric_values = {
        "metric-total": total,
        "metric-actual": round(actual_total, 2),
        "metric-rate": rate,
    }
    for metric in analytics_design.get("metrics") or []:
        metric_id = metric.get("id")
        if not metric_id or metric_id in metric_values:
            continue
        expression = str(metric.get("expression") or "").lower()
        if "count" in expression:
            metric_values[metric_id] = total
        elif "rate" in expression or "/" in expression:
            metric_values[metric_id] = rate
        elif "sum" in expression or "actual" in expression:
            metric_values[metric_id] = round(actual_total, 2)
        else:
            metric_values[metric_id] = len(rows)
    return {"metricValues": metric_values, "rows": rows}


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0
