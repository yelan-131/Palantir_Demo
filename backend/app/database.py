"""Database engine + session factory.

Strategy:
- Try PostgreSQL (asyncpg) first; if the driver is missing or the URL is
  unreachable at first use, fall back to local SQLite (aiosqlite).
- `init_db()` is the only place schema is auto-created (SQLite mode only,
  for demo bootstrap). Production / PG flows must use Alembic migrations.
"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Engine selection ──────────────────────────────────────
_sqlite_path = os.path.join(os.path.dirname(__file__), "..", "manufoundry.db")
_sqlite_url = f"sqlite+aiosqlite:///{os.path.abspath(_sqlite_path)}"

DB_TYPE = "sqlite"
_engine = None

# Prefer PostgreSQL if asyncpg is installed; we don't probe the connection
# here to avoid blocking module import — failures surface on first query
# and are handled by callers.
try:
    import asyncpg  # noqa: F401
    _engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.DEBUG,
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
    )
    DB_TYPE = "postgresql"
except ImportError:
    logger.info("asyncpg not installed; using SQLite fallback")
except Exception as exc:
    logger.warning("PG engine init failed (%s); using SQLite fallback", exc)

if _engine is None:
    try:
        _engine = create_async_engine(_sqlite_url, echo=False)
        DB_TYPE = "sqlite"
    except Exception as exc:
        logger.warning("SQLite file engine failed (%s); using in-memory SQLite", exc)
        _engine = create_async_engine("sqlite+aiosqlite://", echo=False)
        DB_TYPE = "sqlite"

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
    logger.info("SQLite schema ensured")

    from sqlalchemy import func, select
    from app.models.relational import Factory
    async with AsyncSessionLocal() as session:
        count = await session.scalar(select(func.count(Factory.id)))
        if count == 0:
            await _seed_sqlite(session)


async def _build_graph_from_seed() -> None:
    """Build Neo4j graph from seed JSON data if graph is available."""
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
