"""Model-Driven: dynamic data CRUD over whitelisted relational tables.

All identifiers go through both the SAFE_COLUMNS whitelist AND the
`assert_safe_identifier` regex check (defense in depth). Values pass
through SQLAlchemy bound parameters as usual.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from app.api._model_driven_shared import (
    ENTITY_TABLE_MAP,
    MOCK_DATA,
    SAFE_COLUMNS,
    assert_safe_identifier,
    try_db,
)
from app.core.audit import write_audit_log
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()

# Reverse map: table_name → Neo4j label for graph sync
_TABLE_TO_GRAPH_LABEL = {v: k for k, v in ENTITY_TABLE_MAP.items()}


async def _sync_to_graph(
    action: str, table_name: str, record_id: int, data: dict | None = None
) -> None:
    """Best-effort sync a record change to Neo4j (with timeout)."""
    label = _TABLE_TO_GRAPH_LABEL.get(table_name)
    if not label:
        return
    try:
        from app.services.graph_service import graph_service
        if action == "create":
            props = {k: v for k, v in (data or {}).items() if v is not None}
            await asyncio.wait_for(graph_service.create_entity(label, record_id, props), timeout=3)
        elif action == "update":
            props = {k: v for k, v in (data or {}).items() if v is not None}
            await asyncio.wait_for(graph_service.update_entity(label, record_id, props), timeout=3)
        elif action == "delete":
            await asyncio.wait_for(graph_service.delete_entity(label, record_id), timeout=3)
    except asyncio.TimeoutError:
        logger.warning("Neo4j sync timed out (%s %s/%s)", action, label, record_id)
    except Exception as exc:
        logger.warning("Neo4j sync failed (%s %s/%s): %s", action, label, record_id, exc)


def _resolve_table(model_name: str) -> str:
    """Resolve `model_name` (e.g. 'Equipment' or 'equipment') to a safe table name."""
    table_name = ENTITY_TABLE_MAP.get(model_name.title(), model_name.lower())
    if table_name not in SAFE_COLUMNS:
        raise HTTPException(404, f"Unknown model: {model_name}")
    assert_safe_identifier(table_name)
    return table_name


@router.get("/data/{model_name}")
async def list_data(
    model_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
):
    """动态数据列表."""
    table_name = _resolve_table(model_name)

    async def _query(db):
        cols = SAFE_COLUMNS.get(table_name, set())
        for c in cols:
            assert_safe_identifier(c)
        col_list = ",".join(sorted(cols))
        count_sql = f"SELECT COUNT(*) as cnt FROM {table_name}"
        data_sql = f"SELECT {col_list} FROM {table_name}"

        params: dict = {}
        if search:
            like_clauses = [f"CAST({c} AS TEXT) LIKE :search" for c in cols if c != "id"]
            if like_clauses:
                where = " WHERE " + " OR ".join(like_clauses)
                data_sql += where
                count_sql += where
                params["search"] = f"%{search}%"

        total = (await db.execute(text(count_sql), params)).scalar()
        data_sql += " LIMIT :limit OFFSET :offset"
        params["limit"] = page_size
        params["offset"] = (page - 1) * page_size
        rows = (await db.execute(text(data_sql), params)).mappings().all()
        return {
            "data": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "table_name": table_name,
        }

    result = await try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    mock_rows = MOCK_DATA.get(table_name, [])
    if search:
        mock_rows = [r for r in mock_rows if any(search.lower() in str(v).lower() for v in r.values())]
    start = (page - 1) * page_size
    return {
        "data": mock_rows[start:start + page_size],
        "total": len(mock_rows),
        "page": page,
        "page_size": page_size,
        "table_name": table_name,
    }


@router.post("/data/{model_name}")
async def create_data(model_name: str, body: dict):
    """动态创建数据."""
    table_name = _resolve_table(model_name)

    async def _query(db):
        allowed = SAFE_COLUMNS.get(table_name, set())
        safe_keys = [k for k in body.keys() if k in allowed and k != "id"]
        if not safe_keys:
            raise HTTPException(400, "No valid fields")
        for k in safe_keys:
            assert_safe_identifier(k)
        cols = ",".join(safe_keys)
        vals = ",".join([f":{k}" for k in safe_keys])
        sql = f"INSERT INTO {table_name} ({cols}) VALUES ({vals}) RETURNING id"
        result_row = (await db.execute(text(sql), {k: body[k] for k in safe_keys})).mappings().first()
        await db.commit()

        new_id = result_row["id"] if result_row else body.get("id")

        new_values = {k: body[k] for k in safe_keys}
        await write_audit_log(
            action="create", resource_type=table_name,
            resource_id=int(new_id) if new_id else None,
            new_values=new_values,
        )
        await _sync_to_graph("create", table_name, int(new_id), new_values)

        # Best-effort trigger evaluation
        try:
            from app.api.rules import _evaluate_triggers_sync
            trigger_record = {"id": int(new_id) if new_id else None, **new_values}
            await _evaluate_triggers_sync(table_name, "create", trigger_record)
        except Exception as exc:
            logger.warning("Trigger evaluation after create failed: %s", exc)

        return {"ok": True, "table": table_name, "id": int(new_id) if new_id else None}

    result = await try_db(_query)
    return result or {"ok": True, "table": table_name}


@router.put("/data/{model_name}/{record_id}")
async def update_data(model_name: str, record_id: int, body: dict):
    """动态更新数据."""
    table_name = _resolve_table(model_name)

    async def _query(db):
        allowed = SAFE_COLUMNS.get(table_name, set())
        safe_keys = [k for k in body.keys() if k in allowed and k != "id"]
        if not safe_keys:
            raise HTTPException(400, "No valid fields")
        for k in safe_keys:
            assert_safe_identifier(k)

        # Fetch old values for audit
        col_list = ",".join(sorted(allowed))
        old_row = (await db.execute(
            text(f"SELECT {col_list} FROM {table_name} WHERE id = :id"), {"id": record_id}
        )).mappings().first()

        set_clause = ",".join([f"{k} = :{k}" for k in safe_keys])
        sql = f"UPDATE {table_name} SET {set_clause} WHERE id = :id"
        params = {k: body[k] for k in safe_keys}
        params["id"] = record_id
        await db.execute(text(sql), params)
        await db.commit()

        new_values = {k: body[k] for k in safe_keys}
        await write_audit_log(
            action="update", resource_type=table_name, resource_id=record_id,
            old_values=dict(old_row) if old_row else None,
            new_values=new_values,
        )
        await _sync_to_graph("update", table_name, record_id, new_values)

        # Best-effort trigger evaluation
        try:
            from app.api.rules import _evaluate_triggers_sync
            trigger_record = {"id": record_id, **new_values}
            old_for_trigger = dict(old_row) if old_row else None
            await _evaluate_triggers_sync(table_name, "update", trigger_record, old_for_trigger)
        except Exception as exc:
            logger.warning("Trigger evaluation after update failed: %s", exc)

        return {"ok": True}

    result = await try_db(_query)
    return result or {"ok": True}


@router.delete("/data/{model_name}/{record_id}")
async def delete_data(model_name: str, record_id: int):
    """动态删除数据."""
    table_name = _resolve_table(model_name)

    async def _query(db):
        # Fetch old values for audit
        allowed = SAFE_COLUMNS.get(table_name, set())
        col_list = ",".join(sorted(allowed))
        old_row = (await db.execute(
            text(f"SELECT {col_list} FROM {table_name} WHERE id = :id"), {"id": record_id}
        )).mappings().first()

        await db.execute(text(f"DELETE FROM {table_name} WHERE id = :id"), {"id": record_id})
        await db.commit()

        await write_audit_log(
            action="delete", resource_type=table_name, resource_id=record_id,
            old_values=dict(old_row) if old_row else None,
        )
        await _sync_to_graph("delete", table_name, record_id)

        # Best-effort trigger evaluation
        try:
            from app.api.rules import _evaluate_triggers_sync
            old_for_trigger = dict(old_row) if old_row else {"id": record_id}
            await _evaluate_triggers_sync(table_name, "delete", old_for_trigger)
        except Exception as exc:
            logger.warning("Trigger evaluation after delete failed: %s", exc)

        return {"ok": True}

    result = await try_db(_query)
    return result or {"ok": True}


@router.get("/data/{model_name}/options")
async def get_options(
    model_name: str,
    label_field: str = Query("name"),
    cascade_from: Optional[str] = None,
    cascade_value: Optional[str] = None,
):
    """下拉选项查询（用于关联/级联字段）.

    示例:
      GET /data/workshops/options?cascade_from=factory_id&cascade_value=1
      → [{"id": 3, "label": "CNC加工车间"}, ...]
    """
    table_name = _resolve_table(model_name)

    if label_field not in SAFE_COLUMNS.get(table_name, set()):
        raise HTTPException(400, f"Invalid label_field: {label_field}")
    assert_safe_identifier(label_field)

    async def _query(db):
        sql = f"SELECT id, {label_field} as label FROM {table_name}"
        params: dict = {}

        if cascade_from and cascade_value:
            if cascade_from not in SAFE_COLUMNS.get(table_name, set()):
                raise HTTPException(400, f"Invalid cascade_from: {cascade_from}")
            assert_safe_identifier(cascade_from)
            sql += f" WHERE {cascade_from} = :cv"
            try:
                params["cv"] = int(cascade_value)
            except ValueError:
                params["cv"] = cascade_value

        rows = (await db.execute(text(sql), params)).mappings().all()
        return {"data": [{"id": r["id"], "label": str(r["label"])} for r in rows]}

    result = await try_db(_query)
    if result is not None:
        return result

    mock_rows = MOCK_DATA.get(table_name, [])
    if cascade_from and cascade_value:
        try:
            cv = int(cascade_value)
            mock_rows = [r for r in mock_rows if r.get(cascade_from) == cv]
        except ValueError:
            mock_rows = [r for r in mock_rows if str(r.get(cascade_from, "")) == cascade_value]
    return {"data": [{"id": r["id"], "label": str(r.get(label_field, r["id"]))} for r in mock_rows]}


@router.get("/data/{model_name}/{record_id}/children/{child_table}")
async def get_children(
    model_name: str,
    record_id: int,
    child_table: str,
):
    """查询主从子表数据.

    示例: GET /data/sales_orders/1/children/order_items
    要求 child_table 必须在 SAFE_COLUMNS 白名单中，且包含关联字段。
    """
    _resolve_table(model_name)  # validate parent
    if child_table not in SAFE_COLUMNS:
        raise HTTPException(404, f"Unknown child table: {child_table}")
    assert_safe_identifier(child_table)

    async def _query(db):
        cols = SAFE_COLUMNS.get(child_table, set())
        for c in cols:
            assert_safe_identifier(c)
        col_list = ",".join(sorted(cols))

        # Guess the foreign key field: parent_table singular + _id
        parent_table = _resolve_table(model_name)
        singular = parent_table.rstrip("s")
        fk_candidates = [f"{singular}_id", f"{parent_table}_id"]

        fk_field = None
        for fk in fk_candidates:
            if fk in cols:
                fk_field = fk
                break

        if not fk_field:
            # Fallback: try common patterns
            for c in cols:
                if c.endswith("_id") and c != "id":
                    fk_field = c
                    break

        if not fk_field:
            raise HTTPException(400, f"Cannot determine foreign key for {child_table} → {parent_table}")

        sql = f"SELECT {col_list} FROM {child_table} WHERE {fk_field} = :parent_id"
        rows = (await db.execute(text(sql), {"parent_id": record_id})).mappings().all()
        return {
            "data": [dict(r) for r in rows],
            "parent_table": parent_table,
            "child_table": child_table,
            "fk_field": fk_field,
        }

    result = await try_db(_query)
    if result is not None:
        return result

    return {
        "data": [],
        "parent_table": model_name,
        "child_table": child_table,
        "fk_field": f"{model_name}_id",
    }
