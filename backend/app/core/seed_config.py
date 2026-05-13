"""Shared seed data configuration — single source of truth for table columns,
datetime column mappings, and SQL generation. Used by both `scripts/seed_data.py`
and `backend/app/database.py`."""

from __future__ import annotations

from datetime import datetime

# Table name → ordered column list for INSERT statements
SEED_TABLE_COLUMNS: dict[str, list[str]] = {
    "factories": ["id", "name", "location", "capacity", "status", "description"],
    "workshops": ["id", "name", "factory_id", "area", "workshop_type"],
    "production_lines": ["id", "name", "workshop_id", "capacity", "oee_target", "status"],
    "equipment": ["id", "name", "line_id", "model", "manufacturer", "install_date", "status", "health_score"],
    "sensors": ["id", "name", "equipment_id", "sensor_type", "unit", "sampling_rate"],
    "products": ["id", "name", "sku", "category", "specs", "unit"],
    "materials": ["id", "name", "material_type", "specs", "unit", "safety_stock"],
    "suppliers": ["id", "name", "location", "rating", "lead_time_days", "contact"],
    "customers": ["id", "name", "industry", "region"],
    "workers": ["id", "name", "role", "department"],
    "sales_orders": ["id", "order_no", "customer_id", "product_id", "quantity", "due_date", "priority", "status"],
    "work_orders": ["id", "order_no", "sales_order_id", "line_id", "planned_start", "planned_end",
                     "actual_start", "actual_end", "quantity", "completed_quantity", "status"],
    "inspections": ["id", "inspection_type", "target_type", "target_id", "result", "inspector_id", "inspected_at"],
    "defects": ["id", "inspection_id", "defect_type", "severity", "description", "root_cause", "correction"],
    "spc_points": ["id", "parameter", "value", "ucl", "lcl", "cl", "equipment_id", "timestamp"],
    "sensor_readings": ["id", "sensor_id", "value", "timestamp"],
}

# Table name → set of DateTime column names (asyncpg requires datetime objects, not strings)
DATETIME_COLUMNS: dict[str, set[str]] = {
    "equipment": {"install_date"},
    "sensor_readings": {"timestamp"},
    "work_orders": {"planned_start", "planned_end", "actual_start", "actual_end"},
    "inspections": {"inspected_at"},
    "spc_points": {"timestamp"},
    "sales_orders": {"due_date"},
}


def make_insert_sql(table_name: str, conflict: str = "") -> str:
    """Generate INSERT SQL from SEED_TABLE_COLUMNS.

    conflict: "" → plain INSERT
              "OR IGNORE" → SQLite upsert-safe
              "ON CONFLICT DO NOTHING" → PostgreSQL equivalent
    """
    cols = SEED_TABLE_COLUMNS[table_name]
    col_str = ", ".join(cols)
    val_str = ", ".join(f":{c}" for c in cols)
    if conflict:
        return f"INSERT {conflict} INTO {table_name} ({col_str}) VALUES ({val_str})"
    return f"INSERT INTO {table_name} ({col_str}) VALUES ({val_str})"


def convert_datetimes(table_name: str, rows: list[dict]) -> list[dict]:
    """Convert ISO date strings to datetime objects for asyncpg compatibility."""
    dt_cols = DATETIME_COLUMNS.get(table_name)
    if not dt_cols:
        return rows
    for row in rows:
        for col in dt_cols:
            val = row.get(col)
            if isinstance(val, str):
                row[col] = datetime.fromisoformat(val)
    return rows
