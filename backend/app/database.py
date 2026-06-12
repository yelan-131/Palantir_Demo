"""Database engine + session factory.

Strategy:
- Use SQLite only when DATABASE_BACKEND=sqlite is explicitly configured.
- Otherwise create the PostgreSQL engine and let runtime connection failures
  surface as DATABASE_UNAVAILABLE through the request/session boundary.
- `init_db()` is the only place schema is auto-created (SQLite mode only).
"""
from __future__ import annotations

import asyncio
import json
import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _json_serializer(value):
    return json.dumps(value, ensure_ascii=False)

# ── Engine selection ──────────────────────────────────────
_sqlite_path = settings.SQLITE_DB_PATH or os.path.join(os.path.dirname(__file__), "..", "manufoundry.db")
_sqlite_url = f"sqlite+aiosqlite:///{os.path.abspath(_sqlite_path)}"

DB_TYPE = "postgresql"
_engine = None

if settings.DATABASE_BACKEND.lower() == "sqlite":
    if settings.IS_PRODUCTION:
        raise RuntimeError("SQLite fallback is disabled when APP_MODE=production")
    logger.info("DATABASE_BACKEND=sqlite; using explicitly configured SQLite")
    try:
        _engine = create_async_engine(_sqlite_url, echo=False, json_serializer=_json_serializer)
        DB_TYPE = "sqlite"
    except Exception as exc:
        raise RuntimeError(f"SQLite engine init failed: {exc}") from exc
else:
    try:
        import asyncpg  # noqa: F401
        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=settings.DEBUG,
            json_serializer=_json_serializer,
            pool_size=5,
            max_overflow=5,
            pool_pre_ping=True,
        )
        DB_TYPE = "postgresql"
    except ImportError as exc:
        raise RuntimeError("asyncpg is required for PostgreSQL database access") from exc
    except Exception as exc:
        raise RuntimeError(f"PostgreSQL engine init failed: {exc}") from exc

logger.info("Database backend: %s", DB_TYPE)

AsyncSessionLocal = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


# ── Neo4j (optional) ──────────────────────────────────────
neo4j_driver = None
try:
    from neo4j import AsyncGraphDatabase
    neo4j_driver = AsyncGraphDatabase.driver(
        settings.NEO4J_URI,
        auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        connection_timeout=2,
    )
    logger.info("Neo4j driver created (connection verified on first query)")
except ImportError:
    logger.info("neo4j driver not installed; graph features disabled")
except Exception as exc:
    logger.warning("Neo4j driver init failed (%s); graph features disabled", exc)


# ── Dependencies ──────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def get_neo4j():
    if neo4j_driver:
        async with neo4j_driver.session() as session:
            yield session
    else:
        yield None


async def close_connections():
    try:
        await _engine.dispose()
    except Exception as exc:
        logger.debug("engine.dispose error: %s", exc)
    if neo4j_driver:
        try:
            await neo4j_driver.close()
        except Exception as exc:
            logger.debug("neo4j_driver.close error: %s", exc)


# ── Bootstrap (SQLite demo mode only) ─────────────────────
async def init_db():
    """Auto-create tables and seed data for SQLite mode.

    PostgreSQL deployments must use Alembic migrations and a separate
    seed script (`scripts/seed_data.py`).
    """
    if DB_TYPE != "sqlite":
        logger.info("init_db skipped: DB_TYPE=%s (use Alembic for non-SQLite)", DB_TYPE)
        return

    from app.models.relational import Base
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_sqlite_ai_memory_columns(conn)
        await _ensure_sqlite_system_settings_table(conn)
        await _ensure_sqlite_knowledge_columns(conn)
        await _ensure_sqlite_identity_access_columns(conn)
        await _ensure_sqlite_tenant_onboarding(conn)
        await _ensure_sqlite_business_tenant_columns(conn)
        await _ensure_sqlite_saas_hardening_columns(conn)
    logger.info("SQLite schema ensured")

    if os.getenv("ENABLE_MANUFACTURING_DEMO_SEED") == "1":
        async with AsyncSessionLocal() as session:
            await _seed_sqlite(session)
    else:
        logger.info("Manufacturing demo seed skipped; set ENABLE_MANUFACTURING_DEMO_SEED=1 to load demo data")


async def _build_graph_from_seed() -> None:
    """Build Neo4j graph from seed JSON data if graph is available."""
    if os.getenv("PYTEST_CURRENT_TEST"):
        logger.info("pytest detected; skipping Neo4j graph build")
        return
    if neo4j_driver is None:
        logger.info("Neo4j not available, skipping graph build")
        return

    import json
    from pathlib import Path

    from app.services.graph_service import graph_service

    seed_dir = Path(__file__).resolve().parent.parent.parent / "data" / "seed"
    if not seed_dir.exists():
        logger.info("No seed data found at %s; skipping graph build", seed_dir)
        return

    seed_data: dict[str, list[dict]] = {}
    for json_file in seed_dir.glob("*.json"):
        key = json_file.stem
        with open(json_file, encoding="utf-8") as f:
            seed_data[key] = json.load(f)

    logger.info("Building graph from %d seed files ...", len(seed_data))
    try:
        await asyncio.wait_for(graph_service.ensure_constraints(), timeout=10)
        await asyncio.wait_for(graph_service.build_from_seed(seed_data), timeout=60)
        logger.info("Graph build from seed completed")
    except Exception as exc:
        logger.warning("Graph build failed: %s", exc)


async def _seed_sqlite(session: AsyncSession) -> None:
    """Import seed JSON files into SQLite (demo bootstrap)."""
    import json
    from pathlib import Path

    from sqlalchemy import text

    from app.core.seed_config import (
        SEED_TABLE_COLUMNS,
        convert_datetimes,
        make_insert_sql,
    )

    seed_dir = Path(__file__).resolve().parent.parent.parent / "data" / "seed"
    if not seed_dir.exists():
        logger.info("No seed data found at %s; skipping", seed_dir)
        return

    logger.info("Seeding SQLite from %s ...", seed_dir)

    total_rows = 0
    for table_name in SEED_TABLE_COLUMNS:
        if table_name == "sensor_readings":
            continue
        fpath = seed_dir / f"{table_name}.json"
        if not fpath.exists():
            continue
        with open(fpath, encoding="utf-8") as f:
            rows = json.load(f)
        rows = convert_datetimes(table_name, rows)
        sql = make_insert_sql(table_name, conflict="OR IGNORE")
        try:
            await session.execute(text(sql), rows)
            await session.commit()
            total_rows += len(rows)
        except Exception as exc:
            logger.warning("Seed %s failed: %s", table_name, exc)
            await session.rollback()

    # Sensor readings can be very large; batch them.
    readings_path = seed_dir / "sensor_readings.json"
    if readings_path.exists():
        with open(readings_path, encoding="utf-8") as f:
            readings = json.load(f)
        readings_sql = make_insert_sql("sensor_readings", conflict="OR IGNORE")
        batch_size = 5000
        for i in range(0, len(readings), batch_size):
            batch = convert_datetimes("sensor_readings", readings[i:i + batch_size])
            try:
                await session.execute(text(readings_sql), batch)
                await session.commit()
            except Exception as exc:
                logger.warning("Seed sensor_readings batch %d failed: %s", i, exc)
                await session.rollback()
        total_rows += len(readings)

    logger.info("Seeded %d rows", total_rows)

    # Build Neo4j graph from seed data
    await _build_graph_from_seed()


async def _ensure_sqlite_ai_memory_columns(conn) -> None:
    """Patch old demo SQLite schemas that predate expanded AI memory metadata."""
    from sqlalchemy import text

    existing = await conn.execute(text("PRAGMA table_info(ai_memory_entries)"))
    columns = {row[1] for row in existing.fetchall()}
    if not columns:
        return

    definitions = {
        "tenant_id": "INTEGER",
        "user_key": "VARCHAR(100)",
        "page": "VARCHAR(100)",
        "document_id": "VARCHAR(100)",
        "run_id": "VARCHAR(100)",
        "user_message_id": "VARCHAR(100)",
        "assistant_message_id": "VARCHAR(100)",
        "source_type": "VARCHAR(80)",
        "source_id": "VARCHAR(200)",
        "memory_type": "VARCHAR(80) NOT NULL DEFAULT 'turn_summary'",
        "content": "TEXT",
        "tags": "JSON NOT NULL DEFAULT '[]'",
        "importance_score": "FLOAT NOT NULL DEFAULT 0",
        "confidence": "FLOAT NOT NULL DEFAULT 0",
        "visibility": "VARCHAR(50) NOT NULL DEFAULT 'private'",
        "sensitivity": "VARCHAR(50) NOT NULL DEFAULT 'normal'",
        "redaction_status": "VARCHAR(50) NOT NULL DEFAULT 'clean'",
        "expires_at": "DATETIME",
        "last_accessed_at": "DATETIME",
        "access_count": "INTEGER NOT NULL DEFAULT 0",
        "pinned": "BOOLEAN NOT NULL DEFAULT 0",
        "content_hash": "VARCHAR(128)",
        "version": "INTEGER NOT NULL DEFAULT 1",
        "vault_path": "VARCHAR(500)",
        "exported_at": "DATETIME",
        "export_checksum": "VARCHAR(128)",
    }
    for column_name, definition in definitions.items():
        if column_name not in columns:
            await conn.execute(text(f"ALTER TABLE ai_memory_entries ADD COLUMN {column_name} {definition}"))


async def _ensure_sqlite_system_settings_table(conn) -> None:
    """Patch old demo SQLite schemas with platform settings persistence."""
    from sqlalchemy import text

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key VARCHAR(120) NOT NULL UNIQUE,
                value JSON NOT NULL DEFAULT '{}',
                description TEXT,
                updated_by VARCHAR(120),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_system_settings_key ON system_settings (key)"))


async def _ensure_sqlite_knowledge_columns(conn) -> None:
    """Patch old demo SQLite schemas with persisted knowledge ingestion fields."""
    from sqlalchemy import text

    existing = await conn.execute(text("PRAGMA table_info(knowledge_documents)"))
    document_columns = {row[1] for row in existing.fetchall()}
    document_definitions = {
        "ocr_result": "JSON",
        "owner_user_id": "VARCHAR(100)",
        "source_path": "VARCHAR(1000)",
    }
    for column_name, definition in document_definitions.items():
        if document_columns and column_name not in document_columns:
            await conn.execute(text(f"ALTER TABLE knowledge_documents ADD COLUMN {column_name} {definition}"))

    existing = await conn.execute(text("PRAGMA table_info(knowledge_object_links)"))
    link_columns = {row[1] for row in existing.fetchall()}
    link_definitions = {
        "job_id": "VARCHAR(100)",
        "source_location": "VARCHAR(200)",
        "status": "VARCHAR(50) NOT NULL DEFAULT 'candidate'",
    }
    for column_name, definition in link_definitions.items():
        if link_columns and column_name not in link_columns:
            await conn.execute(text(f"ALTER TABLE knowledge_object_links ADD COLUMN {column_name} {definition}"))


async def _ensure_sqlite_saas_hardening_columns(conn) -> None:
    """Patch old demo SQLite schemas with SaaS tenant hardening fields."""
    from sqlalchemy import text

    tenant_tables = {
        "notifications": ["CREATE INDEX IF NOT EXISTS ix_notifications_tenant_user_read ON notifications (tenant_id, user_id, is_read)"],
        "rules": ["CREATE INDEX IF NOT EXISTS ix_rules_tenant_model_type ON rules (tenant_id, model_id, rule_type)"],
        "scheduled_jobs": ["CREATE INDEX IF NOT EXISTS ix_scheduled_jobs_tenant_active ON scheduled_jobs (tenant_id, is_active)"],
        "knowledge_documents": [],
        "knowledge_chunks": [],
        "knowledge_ingestion_jobs": [],
        "knowledge_extraction_results": [],
        "knowledge_object_links": ["CREATE INDEX IF NOT EXISTS ix_knowledge_object_links_tenant_object ON knowledge_object_links (tenant_id, object_type, object_id)"],
        "ai_conversations": [],
        "ai_messages": [],
        "ai_agent_runs": [],
        "ai_tool_calls": [],
    }
    for table_name, indexes in tenant_tables.items():
        existing = await conn.execute(text(f"PRAGMA table_info({table_name})"))
        columns = {row[1] for row in existing.fetchall()}
        if columns and "tenant_id" not in columns:
            await conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1"))
        for index_sql in indexes:
            await conn.execute(text(index_sql))

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenant_exports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                requested_by INTEGER,
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                format VARCHAR(20) NOT NULL DEFAULT 'zip',
                file_path VARCHAR(1000),
                checksum VARCHAR(128),
                size_bytes INTEGER,
                error TEXT,
                completed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_exports_tenant_id ON tenant_exports (tenant_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_exports_tenant_status ON tenant_exports (tenant_id, status)"))


async def _ensure_sqlite_identity_access_columns(conn) -> None:
    """Patch old demo SQLite schemas with identity/access-center fields."""
    from sqlalchemy import text

    existing = await conn.execute(text("PRAGMA table_info(users)"))
    user_columns = {row[1] for row in existing.fetchall()}
    user_definitions = {
        "login_failed_count": "INTEGER NOT NULL DEFAULT 0",
        "avatar_url": "VARCHAR(1000)",
        "locked_until": "DATETIME",
        "force_password_change": "BOOLEAN NOT NULL DEFAULT 0",
        "last_login_at": "DATETIME",
        "last_login_ip": "VARCHAR(100)",
        "mfa_enabled": "BOOLEAN NOT NULL DEFAULT 0",
        "mfa_secret": "VARCHAR(128)",
        "sso_provider": "VARCHAR(80)",
        "sso_subject": "VARCHAR(255)",
    }
    for column_name, definition in user_definitions.items():
        if user_columns and column_name not in user_columns:
            await conn.execute(text(f"ALTER TABLE users ADD COLUMN {column_name} {definition}"))

    existing = await conn.execute(text("PRAGMA table_info(role_permissions)"))
    permission_columns = {row[1] for row in existing.fetchall()}
    permission_definitions = {
        "effect": "VARCHAR(20) NOT NULL DEFAULT 'allow'",
        "data_scope": "VARCHAR(50) NOT NULL DEFAULT 'all'",
        "condition_json": "JSON",
        "field_rules_json": "JSON",
        "priority": "INTEGER NOT NULL DEFAULT 0",
        "enabled": "BOOLEAN NOT NULL DEFAULT 1",
    }
    for column_name, definition in permission_definitions.items():
        if permission_columns and column_name not in permission_columns:
            await conn.execute(text(f"ALTER TABLE role_permissions ADD COLUMN {column_name} {definition}"))

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id VARCHAR(120) NOT NULL UNIQUE,
                tenant_id INTEGER NOT NULL DEFAULT 1,
                user_id INTEGER NOT NULL,
                login_method VARCHAR(50) NOT NULL DEFAULT 'local',
                ip_address VARCHAR(100),
                user_agent TEXT,
                expires_at DATETIME NOT NULL,
                revoked_at DATETIME,
                revoked_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions (user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_sessions_tenant_id ON user_sessions (tenant_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_sessions_session_id ON user_sessions (session_id)"))

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS password_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL DEFAULT 1,
                user_id INTEGER NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_password_history_user_id ON password_history (user_id)"))

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS oidc_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                state VARCHAR(160) NOT NULL UNIQUE,
                nonce VARCHAR(160) NOT NULL,
                tenant_id INTEGER NOT NULL DEFAULT 1,
                redirect_uri VARCHAR(500),
                expires_at DATETIME NOT NULL,
                consumed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_oidc_states_state ON oidc_states (state)"))


async def _ensure_sqlite_tenant_onboarding(conn) -> None:
    """Patch old demo SQLite schemas with tenant onboarding fields."""
    import json

    from sqlalchemy import text

    from app.services.tenant_onboarding import DEFAULT_TENANT_CONFIG, DEFAULT_TENANT_LIMITS

    existing = await conn.execute(text("PRAGMA table_info(tenants)"))
    tenant_columns = {row[1] for row in existing.fetchall()}
    tenant_definitions = {
        "config": "JSON",
        "limits": "JSON",
        "opened_by": "INTEGER",
        "suspended_reason": "TEXT",
    }
    for column_name, definition in tenant_definitions.items():
        if tenant_columns and column_name not in tenant_columns:
            await conn.execute(text(f"ALTER TABLE tenants ADD COLUMN {column_name} {definition}"))

    await conn.execute(text("UPDATE tenants SET status = 'active' WHERE status IS NULL OR status = ''"))
    await conn.execute(text("UPDATE tenants SET config = '{}' WHERE config IS NULL"))
    await conn.execute(text("UPDATE tenants SET limits = '{}' WHERE limits IS NULL"))
    await conn.execute(
        text(
            """
            INSERT OR IGNORE INTO tenants (id, name, slug, status, config, limits)
            VALUES (1, 'Default Tenant', 'default', 'active', :config, :limits)
            """
        ),
        {
            "config": json.dumps(DEFAULT_TENANT_CONFIG),
            "limits": json.dumps(DEFAULT_TENANT_LIMITS),
        },
    )

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenant_domains (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                domain VARCHAR(255) NOT NULL UNIQUE,
                status VARCHAR(50) NOT NULL DEFAULT 'active',
                is_primary BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_domains_tenant_id ON tenant_domains (tenant_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_domains_domain ON tenant_domains (domain)"))
    await conn.execute(
        text(
            """
            INSERT OR IGNORE INTO tenant_domains (tenant_id, domain, status, is_primary)
            VALUES (1, 'manufoundry.local', 'active', 1)
            """
        )
    )

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenant_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                email VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'member',
                token_hash VARCHAR(128) NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                accepted_at DATETIME,
                invited_by INTEGER,
                user_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_invites_tenant_id ON tenant_invites (tenant_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_invites_email ON tenant_invites (email)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_invites_token_hash ON tenant_invites (token_hash)"))
    existing = await conn.execute(text("PRAGMA table_info(tenant_invites)"))
    invite_columns = {row[1] for row in existing.fetchall()}
    for column_name, definition in {
        "revoked_at": "DATETIME",
        "revoked_by": "INTEGER",
        "replaced_by_invite_id": "INTEGER",
    }.items():
        if column_name not in invite_columns:
            await conn.execute(text(f"ALTER TABLE tenant_invites ADD COLUMN {column_name} {definition}"))

    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                token_hash VARCHAR(128) NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                used_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_tenant_id ON password_reset_tokens (tenant_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id ON password_reset_tokens (user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_token_hash ON password_reset_tokens (token_hash)"))


async def _ensure_sqlite_business_tenant_columns(conn) -> None:
    """Patch domain-neutral SQLite schemas with tenant_id."""
    from sqlalchemy import text

    tables = [
        "data_sources",
        "pipelines",
        "pipeline_runs",
    ]
    for table_name in tables:
        existing = await conn.execute(text(f"PRAGMA table_info({table_name})"))
        columns = {row[1] for row in existing.fetchall()}
        if columns and "tenant_id" not in columns:
            await conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1"))
        await conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table_name}_tenant_id ON {table_name} (tenant_id)"))
