"""Form-backed dashboard program queries shared by routes and AI tools."""
from __future__ import annotations

from types import SimpleNamespace
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.relational import DynamicRecord, Form
from app.services.analytics_data import load_data as load_analytics_data


def _metric(label: str, value: int | float | str, tone: str, suffix: str | None = None) -> dict:
    payload = {"label": label, "value": value, "tone": tone}
    if suffix:
        payload["suffix"] = suffix
    return payload


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
