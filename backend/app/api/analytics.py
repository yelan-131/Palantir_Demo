"""General Analytics API — with fallback to mock data when DB unavailable.

Includes chart-binding endpoints (aggregate, timeseries, distribution) that
power dynamic dashboard widgets with data-driven queries.
"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from app.api._model_driven_shared import (
    ENTITY_TABLE_MAP,
    SAFE_COLUMNS,
    assert_safe_identifier,
)
from app.api.deps import current_tenant_id, get_current_user
from app.core.logging import get_logger
from app.core.production_errors import seed_data_required

logger = get_logger(__name__)

router = APIRouter()


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── Mock data ──────────────────────────────────────────────

MOCK_OVERVIEW = {
    "equipment_utilization": 80.5,
    "work_order_completion": 85.3,
    "production_lines": 6,
    "active_lines": 5,
}

MOCK_AGGREGATE: dict[str, dict] = {
    "equipment": {"count": 5, "avg_health_score": 89.2},
    "work_orders": {"count": 12, "pending": 3, "completed": 7},
}

MOCK_TIMESERIES: list[dict] = [
    {"time": "2026-05-07", "value": 82},
    {"time": "2026-05-08", "value": 78},
    {"time": "2026-05-09", "value": 91},
    {"time": "2026-05-10", "value": 85},
    {"time": "2026-05-11", "value": 89},
    {"time": "2026-05-12", "value": 93},
    {"time": "2026-05-13", "value": 87},
]

MOCK_DISTRIBUTION: dict[str, list[dict]] = {
    "status": [
        {"label": "running", "value": 3, "count": 3},
        {"label": "idle", "value": 1, "count": 1},
        {"label": "maintenance", "value": 1, "count": 1},
    ],
    "category": [
        {"label": "轴承", "value": 1, "count": 1},
        {"label": "电路板", "value": 1, "count": 1},
        {"label": "阀块", "value": 1, "count": 1},
    ],
}


# ── Helpers ────────────────────────────────────────────────

def _resolve_table(model_name: str) -> str:
    """Resolve model_name to a validated, safe table name."""
    table_name = ENTITY_TABLE_MAP.get(model_name.title(), model_name.lower())
    if table_name not in SAFE_COLUMNS:
        raise HTTPException(404, f"Unknown model: {model_name}")
    assert_safe_identifier(table_name)
    return table_name


def _parse_filters(filters_json: Optional[str]) -> list[tuple[str, str]]:
    """Parse a JSON filter string into [(field, value), ...] pairs.

    Accepts ``{"field": "value"}`` or ``[{"field": "f", "op": "=", "value": "v"}]``.
    Only simple equality is supported to keep the API safe.
    """
    if not filters_json:
        return []
    try:
        parsed = json.loads(filters_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid filters JSON: {exc}") from exc

    if isinstance(parsed, dict):
        return [(k, str(v)) for k, v in parsed.items()]
    if isinstance(parsed, list):
        pairs = []
        for item in parsed:
            if isinstance(item, dict) and "field" in item and "value" in item:
                pairs.append((str(item["field"]), str(item["value"])))
        return pairs
    return []


def _build_where_clause(
    table_name: str, filters: list[tuple[str, str]], params: dict, tenant_id: int | None = None
) -> tuple[str, dict]:
    """Build a WHERE clause from filter pairs, validating each field name."""
    if not filters:
        if tenant_id is not None and "tenant_id" in SAFE_COLUMNS.get(table_name, set()):
            params["tenant_id"] = tenant_id
            return " WHERE tenant_id = :tenant_id", params
        return "", params

    allowed = SAFE_COLUMNS.get(table_name, set())
    clauses = []
    for field, value in filters:
        if field not in allowed:
            raise HTTPException(400, f"Invalid filter field: {field}")
        assert_safe_identifier(field)
        param_key = f"flt_{field}"
        clauses.append(f"{field} = :{param_key}")
        params[param_key] = value

    if tenant_id is not None and "tenant_id" in allowed:
        clauses.append("tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id

    return " WHERE " + " AND ".join(clauses), params


# ── Endpoints ──────────────────────────────────────────────

@router.get("/overview")
async def analytics_overview(user: dict = Depends(get_current_user)):
    """分析总览数据."""
    async def _query(db):
        from app.models.relational import Equipment, ProductionLine, WorkOrder
        from sqlalchemy import func, select
        tenant_id = current_tenant_id(user)

        lines = await db.execute(select(ProductionLine).where(ProductionLine.tenant_id == tenant_id))
        line_list = lines.scalars().all()

        eq_total = await db.scalar(select(func.count(Equipment.id)).where(Equipment.tenant_id == tenant_id))
        eq_running = await db.scalar(
            select(func.count(Equipment.id)).where(Equipment.tenant_id == tenant_id, Equipment.status == "running")
        )

        wo_total = await db.scalar(select(func.count(WorkOrder.id)).where(WorkOrder.tenant_id == tenant_id))
        wo_completed = await db.scalar(
            select(func.count(WorkOrder.id)).where(WorkOrder.tenant_id == tenant_id, WorkOrder.status == "completed")
        )

        return {
            "equipment_utilization": round((eq_running or 0) / max(eq_total or 1, 1) * 100, 1),
            "work_order_completion": round((wo_completed or 0) / max(wo_total or 1, 1) * 100, 1),
            "production_lines": len(line_list),
            "active_lines": sum(1 for l in line_list if l.status == "running"),
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    raise seed_data_required("Analytics overview seed data is required")


# ── Chart-binding aggregation endpoints ───────────────────

@router.get("/aggregate")
async def aggregate(
    model_name: str = Query(..., description="Model name (e.g. equipment, work_orders)"),
    metric: str = Query("count", description="Aggregation: count|sum|avg|min|max"),
    field: Optional[str] = Query(None, description="Field for sum/avg/min/max"),
    group_by: Optional[str] = Query(None, description="Field to group results by"),
    filters: Optional[str] = Query(None, description="JSON filter string"),
    user: dict = Depends(get_current_user),
):
    """Aggregate data for chart widgets.

    - Without ``group_by``: returns ``{data: {value: <number>}}``
    - With ``group_by``: returns ``{data: [{label, value}, ...]}``
    """
    table_name = _resolve_table(model_name)
    allowed_cols = SAFE_COLUMNS.get(table_name, set())

    # Validate metric
    valid_metrics = {"count", "sum", "avg", "min", "max"}
    if metric not in valid_metrics:
        raise HTTPException(400, f"Invalid metric: {metric!r}. Must be one of {valid_metrics}")

    # For non-count metrics, field is required
    if metric != "count" and not field:
        raise HTTPException(400, f"'{metric}' metric requires a 'field' parameter")

    # Validate field names
    if field:
        if field not in allowed_cols:
            raise HTTPException(400, f"Invalid field: {field!r}")
        assert_safe_identifier(field)

    if group_by:
        if group_by not in allowed_cols:
            raise HTTPException(400, f"Invalid group_by field: {group_by!r}")
        assert_safe_identifier(group_by)

    # Parse filters
    filter_pairs = _parse_filters(filters)

    async def _query(db):
        params: dict = {}
        where_clause, params = _build_where_clause(table_name, filter_pairs, params, current_tenant_id(user))

        # Build SQL expression for the aggregate value
        if metric == "count":
            agg_expr = "COUNT(*)"
        else:
            agg_expr = f"{metric.upper()}({field})"

        if group_by:
            sql = f"SELECT {group_by} AS label, {agg_expr} AS value FROM {table_name}{where_clause} GROUP BY {group_by} ORDER BY value DESC"
            rows = (await db.execute(text(sql), params)).mappings().all()
            return {"data": [{"label": str(r["label"]), "value": float(r["value"])} for r in rows]}
        else:
            sql = f"SELECT {agg_expr} AS value FROM {table_name}{where_clause}"
            row = (await db.execute(text(sql), params)).mappings().first()
            return {"data": {"value": float(row["value"]) if row and row["value"] is not None else 0}}

    result = await _try_db(_query)
    if result is not None:
        return result

    raise seed_data_required("Analytics aggregate seed data is required")


@router.get("/timeseries")
async def timeseries(
    model_name: str = Query(..., description="Model name"),
    time_field: str = Query(..., description="Timestamp/datetime field"),
    metric: str = Query("count", description="Aggregation: count|sum|avg|min|max"),
    value_field: Optional[str] = Query(None, description="Field for sum/avg/min/max"),
    interval: str = Query("day", description="Time bucket: hour|day|week|month"),
    start: Optional[str] = Query(None, description="Start datetime (ISO)"),
    end: Optional[str] = Query(None, description="End datetime (ISO)"),
    filters: Optional[str] = Query(None, description="JSON filter string"),
    user: dict = Depends(get_current_user),
):
    """Time-series data for trend charts.

    Returns ``{data: [{time, value}, ...]}``.
    """
    table_name = _resolve_table(model_name)
    allowed_cols = SAFE_COLUMNS.get(table_name, set())

    # Validate fields
    if time_field not in allowed_cols:
        raise HTTPException(400, f"Invalid time_field: {time_field!r}")
    assert_safe_identifier(time_field)

    valid_intervals = {"hour", "day", "week", "month"}
    if interval not in valid_intervals:
        raise HTTPException(400, f"Invalid interval: {interval!r}. Must be one of {valid_intervals}")

    valid_metrics = {"count", "sum", "avg", "min", "max"}
    if metric not in valid_metrics:
        raise HTTPException(400, f"Invalid metric: {metric!r}")

    if metric != "count" and not value_field:
        raise HTTPException(400, f"'{metric}' metric requires 'value_field'")

    if value_field:
        if value_field not in allowed_cols:
            raise HTTPException(400, f"Invalid value_field: {value_field!r}")
        assert_safe_identifier(value_field)

    filter_pairs = _parse_filters(filters)

    async def _query(db):
        params: dict = {}
        where_clause, params = _build_where_clause(table_name, filter_pairs, params, current_tenant_id(user))

        # Add time range filters
        time_conditions = []
        if start:
            params["ts_start"] = start
            time_conditions.append(f"{time_field} >= :ts_start")
        if end:
            params["ts_end"] = end
            time_conditions.append(f"{time_field} <= :ts_end")

        if time_conditions:
            connector = " AND " if where_clause else " WHERE "
            where_clause += connector + " AND ".join(time_conditions)

        # Build aggregate expression
        if metric == "count":
            agg_expr = "COUNT(*)"
        else:
            agg_expr = f"{metric.upper()}({value_field})"

        # SQLite date truncation patterns (used as DB engine in this project)
        trunc_map = {
            "hour": f"strftime('%Y-%m-%d %H:00:00', {time_field})",
            "day": f"strftime('%Y-%m-%d', {time_field})",
            "week": f"strftime('%Y-W%W', {time_field})",
            "month": f"strftime('%Y-%m', {time_field})",
        }
        trunc_expr = trunc_map[interval]

        sql = (
            f"SELECT {trunc_expr} AS time, {agg_expr} AS value "
            f"FROM {table_name}{where_clause} "
            f"GROUP BY time ORDER BY time"
        )
        rows = (await db.execute(text(sql), params)).mappings().all()
        return {"data": [{"time": str(r["time"]), "value": float(r["value"]) if r["value"] is not None else 0} for r in rows]}

    result = await _try_db(_query)
    if result is not None:
        return result

    raise seed_data_required("Analytics time-series seed data is required")


@router.get("/distribution")
async def distribution(
    model_name: str = Query(..., description="Model name"),
    field: str = Query(..., description="Field to compute distribution on"),
    limit: int = Query(10, ge=1, le=100, description="Max number of groups"),
    filters: Optional[str] = Query(None, description="JSON filter string"),
    user: dict = Depends(get_current_user),
):
    """Field value distribution for pie / donut charts.

    Returns ``{data: [{label, value, count}, ...]}`` where ``value`` and
    ``count`` are the number of rows in each group (identical for now).
    """
    table_name = _resolve_table(model_name)
    allowed_cols = SAFE_COLUMNS.get(table_name, set())

    if field not in allowed_cols:
        raise HTTPException(400, f"Invalid field: {field!r}")
    assert_safe_identifier(field)

    filter_pairs = _parse_filters(filters)

    async def _query(db):
        params: dict = {}
        where_clause, params = _build_where_clause(table_name, filter_pairs, params, current_tenant_id(user))

        sql = (
            f"SELECT CAST({field} AS TEXT) AS label, COUNT(*) AS cnt "
            f"FROM {table_name}{where_clause} "
            f"GROUP BY {field} ORDER BY cnt DESC LIMIT :lim"
        )
        params["lim"] = limit
        rows = (await db.execute(text(sql), params)).mappings().all()
        return {
            "data": [
                {"label": str(r["label"]), "value": int(r["cnt"]), "count": int(r["cnt"])}
                for r in rows
            ]
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    raise seed_data_required("Analytics distribution seed data is required")
