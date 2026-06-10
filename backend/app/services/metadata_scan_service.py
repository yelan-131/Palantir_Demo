"""External metadata scanning for data sources."""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relational import DataSource, DataSourceMetadata, DataSourceSyncStatus


def parse_connection_config(source: DataSource) -> dict[str, Any]:
    if not source.connection_config:
        return {}
    try:
        return json.loads(source.connection_config)
    except json.JSONDecodeError:
        return {"raw": source.connection_config}


def effective_source_type(source: DataSource, config: dict[str, Any] | None = None) -> str:
    config = config or {}
    raw_type = config.get("source_type") or config.get("type") or config.get("driver") or source.source_type or "database"
    normalized = str(raw_type).strip().lower()
    if normalized in {"", "undefined", "null", "none"}:
        normalized = str(config.get("source_type") or config.get("type") or "").strip().lower()
    if normalized in {"", "undefined", "null", "none"} and (config.get("host") or config.get("database")):
        normalized = "postgresql"
    return normalized or "database"


def normalize_source_type(source_type: Any) -> str:
    normalized = str(source_type or "database").strip().lower()
    if normalized in {"", "undefined", "null", "none"}:
        normalized = "database"
    if normalized in {"postgresql", "mysql", "sqlserver", "oracle", "database"}:
        return "database"
    return normalized


async def scan_data_source_metadata(
    db: AsyncSession,
    *,
    tenant_id: int,
    source_id: int,
    limit_tables: int = 24,
    sample_limit: int = 3,
) -> dict[str, Any]:
    source = await db.get(DataSource, source_id)
    if not source or source.tenant_id != tenant_id:
        raise ValueError("Data source not found")

    status = await ensure_sync_status(db, tenant_id=tenant_id, source_id=source_id)
    status.status = "running"
    status.last_started_at = datetime.now()
    status.last_error = None
    await db.flush()

    try:
        config = parse_connection_config(source)
        if str(config.get("sensitivity") or "").strip().lower() == "restricted":
            sample_limit = 0
        source_type = effective_source_type(source, config)
        if str(source.source_type or "").strip().lower() in {"", "undefined", "null", "none"}:
            source.source_type = source_type
        selected_tables = [
            str(name)
            for name in (config.get("selected_tables") or [])
            if str(name).strip()
        ]
        declared_tables = config.get("metadata_tables") or config.get("declared_tables")
        if source_type in {"postgresql", "database"} or config.get("type") == "postgresql":
            tables = scan_postgresql(
                config,
                limit_tables=limit_tables,
                sample_limit=sample_limit,
                selected_tables=selected_tables,
            )
        elif isinstance(declared_tables, list) and declared_tables:
            tables = [coerce_manual_table(table) for table in declared_tables]
        elif source_type in {"mysql", "sqlserver", "oracle"}:
            tables = scan_sql_placeholder(source, config)
        elif source_type in {"api", "rest_api"}:
            tables = scan_openapi_schema(source, config)
        else:
            tables = scan_enterprise_connector(source, config)

        await db.execute(delete(DataSourceMetadata).where(DataSourceMetadata.tenant_id == tenant_id, DataSourceMetadata.source_id == source_id))
        for table in tables:
            fields = json_safe(table.get("fields") or [])
            relationships = json_safe(table.get("relationships") or [])
            sample_rows = json_safe(table.get("sample_rows") or [])
            db.add(DataSourceMetadata(
                tenant_id=tenant_id,
                source_id=source_id,
                source_type=normalize_source_type(source_type),
                entity_name=table["name"],
                entity_label=table.get("label") or table["name"],
                row_count=int(table.get("rows") or 0),
                fields=fields,
                relationships=relationships,
                sample_rows=sample_rows,
                status="scanned",
            ))
        status.status = "completed"
        status.last_finished_at = datetime.now()
        status.tables_scanned = len(tables)
        status.fields_scanned = sum(len(table.get("fields") or []) for table in tables)
        source.last_sync = datetime.now()
        await db.flush()
        return {"source_id": source_id, "status": status.status, "tables": tables}
    except Exception as exc:
        await db.rollback()
        status = await ensure_sync_status(db, tenant_id=tenant_id, source_id=source_id)
        status.status = "failed"
        status.last_finished_at = datetime.now()
        status.last_error = str(exc)
        await db.flush()
        raise


async def ensure_sync_status(db: AsyncSession, *, tenant_id: int, source_id: int) -> DataSourceSyncStatus:
    status = await db.scalar(
        select(DataSourceSyncStatus).where(
            DataSourceSyncStatus.tenant_id == tenant_id,
            DataSourceSyncStatus.source_id == source_id,
        )
    )
    if status:
        return status
    status = DataSourceSyncStatus(tenant_id=tenant_id, source_id=source_id, status="idle")
    db.add(status)
    await db.flush()
    return status


def scan_postgresql(
    config: dict[str, Any],
    *,
    limit_tables: int,
    sample_limit: int,
    selected_tables: list[str] | None = None,
) -> list[dict[str, Any]]:
    try:
        import psycopg2
        from psycopg2 import sql
    except ImportError as exc:
        raise RuntimeError("PostgreSQL driver is not installed") from exc

    missing = [
        label
        for label, value in {
            "host": config.get("host"),
            "database": config.get("database"),
            "username": config.get("username"),
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"PostgreSQL 连接配置不完整，缺少：{', '.join(missing)}")

    schema = str(config.get("schema") or config.get("schema_name") or "public")
    conn = psycopg2.connect(
        host=config.get("host"),
        port=int(config.get("port") or 5432),
        dbname=config.get("database"),
        user=config.get("username"),
        password=config.get("password"),
        connect_timeout=5,
        sslmode="require" if config.get("ssl_enabled") else "prefer",
    )
    try:
        with conn.cursor() as cur:
            if selected_tables:
                cur.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = %s
                      AND table_type = 'BASE TABLE'
                      AND table_name = ANY(%s)
                    ORDER BY table_name
                    """,
                    (schema, selected_tables),
                )
            else:
                cur.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = %s AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                    LIMIT %s
                    """,
                    (schema, limit_tables),
                )
            table_names = [row[0] for row in cur.fetchall()]
            primary_keys = read_postgresql_primary_keys(cur, schema)
            relationships = read_postgresql_foreign_keys(cur, schema)
            tables = []
            for table_name in table_names:
                cur.execute(
                    """
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (schema, table_name),
                )
                fields = [
                    {
                        "name": name,
                        "label": name,
                        "type": dtype,
                        "nullable": nullable == "YES",
                        "primary_key": name in primary_keys.get(table_name, set()),
                        "searchable": name in primary_keys.get(table_name, set()) or dtype in {"text", "character varying", "varchar"},
                    }
                    for name, dtype, nullable in cur.fetchall()
                ]
                cur.execute(sql.SQL("SELECT count(*) FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(table_name)))
                row_count = cur.fetchone()[0]
                sample_rows: list[dict[str, Any]] = []
                try:
                    cur.execute(sql.SQL("SELECT * FROM {}.{} LIMIT {}").format(sql.Identifier(schema), sql.Identifier(table_name), sql.Literal(sample_limit)))
                    columns = [desc[0] for desc in cur.description or []]
                    sample_rows = [json_safe(dict(zip(columns, row))) for row in cur.fetchall()]
                except Exception:
                    sample_rows = []
                tables.append({
                    "name": table_name,
                    "label": table_name,
                    "rows": row_count,
                    "fields": fields,
                    "relationships": [rel for rel in relationships if rel["source_entity"] == table_name],
                    "sample_rows": sample_rows,
                })
            return tables
    finally:
        conn.close()


def json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(item) for item in value]
    return value


def read_postgresql_primary_keys(cur, schema: str) -> dict[str, set[str]]:
    cur.execute(
        """
        SELECT cls.relname AS table_name, attr.attname AS column_name
        FROM pg_index idx
        JOIN pg_class cls ON cls.oid = idx.indrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        JOIN pg_attribute attr ON attr.attrelid = cls.oid AND attr.attnum = ANY(idx.indkey)
        WHERE idx.indisprimary AND ns.nspname = %s
        ORDER BY cls.relname, attr.attnum
        """,
        (schema,),
    )
    keys: dict[str, set[str]] = {}
    for table_name, column_name in cur.fetchall():
        keys.setdefault(table_name, set()).add(column_name)
    return keys


def read_postgresql_foreign_keys(cur, schema: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT
          src_cls.relname AS source_table,
          src_attr.attname AS source_field,
          tgt_cls.relname AS target_table,
          tgt_attr.attname AS target_field
        FROM pg_constraint con
        JOIN pg_class src_cls ON src_cls.oid = con.conrelid
        JOIN pg_namespace src_ns ON src_ns.oid = src_cls.relnamespace
        JOIN pg_class tgt_cls ON tgt_cls.oid = con.confrelid
        JOIN unnest(con.conkey) WITH ORDINALITY AS src_col(attnum, ord) ON TRUE
        JOIN unnest(con.confkey) WITH ORDINALITY AS tgt_col(attnum, ord) ON tgt_col.ord = src_col.ord
        JOIN pg_attribute src_attr ON src_attr.attrelid = src_cls.oid AND src_attr.attnum = src_col.attnum
        JOIN pg_attribute tgt_attr ON tgt_attr.attrelid = tgt_cls.oid AND tgt_attr.attnum = tgt_col.attnum
        WHERE con.contype = 'f' AND src_ns.nspname = %s
        ORDER BY src_cls.relname, src_attr.attnum
        """,
        (schema,),
    )
    return [
        {
            "source_entity": source_table,
            "source_field": source_field,
            "target_entity": target_table,
            "target_field": target_field,
            "relation_type": "REFERENCES",
            "description": f"{source_table}.{source_field} -> {target_table}.{target_field}",
        }
        for source_table, source_field, target_table, target_field in cur.fetchall()
    ]


def scan_sql_placeholder(source: DataSource, config: dict[str, Any]) -> list[dict[str, Any]]:
    tables = config.get("tables")
    if isinstance(tables, list) and tables:
        return [coerce_manual_table(table) for table in tables]
    raise RuntimeError(f"{source.source_type} connector is configured but no metadata adapter/table list was provided")


def scan_openapi_schema(source: DataSource, config: dict[str, Any]) -> list[dict[str, Any]]:
    schema = config.get("openapi") or config.get("schema")
    if isinstance(schema, str):
        schema = json.loads(schema)
    if not isinstance(schema, dict):
        endpoints = config.get("endpoints")
        if isinstance(endpoints, list):
            return [coerce_manual_table(endpoint) for endpoint in endpoints]
        raise RuntimeError("API source requires OpenAPI schema or endpoint metadata")
    tables = []
    for path, methods in (schema.get("paths") or {}).items():
        if not isinstance(methods, dict):
            continue
        for method, spec in methods.items():
            response_schema = (((spec or {}).get("responses") or {}).get("200") or {}).get("content", {}).get("application/json", {}).get("schema", {})
            fields = schema_fields(response_schema, schema)
            tables.append({
                "name": f"{method.upper()} {path}",
                "label": (spec or {}).get("summary") or path,
                "rows": 0,
                "fields": fields,
                "relationships": [],
                "sample_rows": [],
            })
    return tables


def schema_fields(schema: dict[str, Any], openapi: dict[str, Any]) -> list[dict[str, Any]]:
    if "$ref" in schema:
        ref = schema["$ref"].split("/")[-1]
        schema = (((openapi.get("components") or {}).get("schemas") or {}).get(ref) or {})
    if schema.get("type") == "array":
        return schema_fields(schema.get("items") or {}, openapi)
    properties = schema.get("properties") or {}
    return [{"name": name, "label": name, "type": str(defn.get("type") or "object"), "nullable": False} for name, defn in properties.items()]


def scan_enterprise_connector(source: DataSource, config: dict[str, Any]) -> list[dict[str, Any]]:
    entities = config.get("entities") or config.get("tables")
    if isinstance(entities, list) and entities:
        return [coerce_manual_table(entity) for entity in entities]
    templates = {
        "mes": ["work_orders", "equipment", "operation_events"],
        "erp": ["materials", "suppliers", "purchase_orders"],
        "qms": ["quality_events", "inspections", "capa_actions"],
        "wms": ["inventory_lots", "shipments", "warehouse_locations"],
        "crm": ["customers", "sales_orders", "complaints"],
        "iot": ["devices", "sensor_readings", "alarms"],
        "plc": ["plc_tags", "machine_states"],
    }
    source_type = effective_source_type(source, config)
    names = templates.get(source_type)
    if not names:
        raise RuntimeError(f"No metadata adapter for source type {source_type}")
    return [
        {
            "name": name,
            "label": name.replace("_", " ").title(),
            "rows": 0,
            "fields": [
                {"name": "id", "label": "ID", "type": "string", "primary_key": True, "searchable": True},
                {"name": "name", "label": "Name", "type": "string", "searchable": True},
                {"name": "status", "label": "Status", "type": "string", "searchable": True},
                {"name": "updated_at", "label": "Updated At", "type": "datetime", "searchable": False},
            ],
            "relationships": [],
            "sample_rows": [],
        }
        for name in names
    ]


def coerce_manual_table(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        return {"name": raw, "label": raw, "rows": 0, "fields": [], "relationships": [], "sample_rows": []}
    if not isinstance(raw, dict):
        raise RuntimeError("Invalid manual metadata table entry")
    name = str(raw.get("name") or raw.get("path") or raw.get("entity") or "entity")
    fields = raw.get("fields") or raw.get("columns") or []
    return {
        "name": name,
        "label": raw.get("label") or raw.get("summary") or name,
        "rows": int(raw.get("rows") or raw.get("row_count") or 0),
        "fields": [
            field if isinstance(field, dict) else {"name": str(field), "label": str(field), "type": "string"}
            for field in fields
        ],
        "relationships": raw.get("relationships") or [],
        "sample_rows": raw.get("sample_rows") or [],
    }
