"""Seed data import script — load JSON data into PostgreSQL and build Neo4j graph."""

import asyncio
import json
import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.core.seed_config import (
    SEED_TABLE_COLUMNS,
    convert_datetimes,
    make_insert_sql,
)
from app.services.graph_service import graph_service

SEED_DIR = Path(__file__).resolve().parent.parent / "data" / "seed"

# Tables processed in order (sensor_readings handled separately due to size)
_SEED_TABLE_ORDER = [
    t for t in SEED_TABLE_COLUMNS if t != "sensor_readings"
]


async def create_tables(engine):
    """Create all tables from SQLAlchemy models."""
    from app.models.relational import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Tables created.")


async def seed_postgresql(engine):
    """Load JSON seed data into PostgreSQL."""
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    for table_name in _SEED_TABLE_ORDER:
        file_path = SEED_DIR / f"{table_name}.json"
        if not file_path.exists():
            print(f"  SKIP {table_name}: file not found")
            continue

        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)

        data = convert_datetimes(table_name, data)
        sql = make_insert_sql(table_name)

        async with async_session() as session:
            try:
                await session.execute(text(sql), data)
                await session.commit()
                print(f"  INSERT {table_name}: {len(data)} rows")
            except Exception as e:
                print(f"  ERROR {table_name}: {e}")
                await session.rollback()

    # Handle sensor_readings separately (large file, batch insert)
    readings_path = SEED_DIR / "sensor_readings.json"
    if readings_path.exists():
        with open(readings_path, encoding="utf-8") as f:
            readings = json.load(f)

        batch_size = 1000
        readings_sql = make_insert_sql("sensor_readings")
        async with async_session() as session:
            for i in range(0, len(readings), batch_size):
                batch = convert_datetimes("sensor_readings", readings[i:i + batch_size])
                try:
                    await session.execute(text(readings_sql), batch)
                    await session.commit()
                except Exception as e:
                    print(f"  ERROR sensor_readings batch {i}: {e}")
                    await session.rollback()
        print(f"  INSERT sensor_readings: {len(readings)} rows")


async def seed_neo4j():
    """Build knowledge graph in Neo4j from seed data."""
    seed_data = {}
    for json_file in SEED_DIR.glob("*.json"):
        key = json_file.stem
        if key not in ("sensor_readings", "spc_points"):
            with open(json_file, encoding="utf-8") as f:
                seed_data[key] = json.load(f)

    await graph_service.build_from_seed(seed_data)
    print("Neo4j graph built.")


async def main():
    print("=== ManuFoundry 数据初始化 ===\n")

    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    print("[1/3] Creating tables...")
    await create_tables(engine)

    print("\n[2/3] Seeding PostgreSQL...")
    await seed_postgresql(engine)

    print("\n[3/3] Building Neo4j graph...")
    try:
        await seed_neo4j()
    except Exception as e:
        print(f"  Neo4j connection failed (skip): {e}")

    await engine.dispose()
    print("\n=== Done! ===")


if __name__ == "__main__":
    asyncio.run(main())
