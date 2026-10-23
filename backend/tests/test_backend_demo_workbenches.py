import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.mark.asyncio
async def test_graph_session_remains_open_across_query_await(monkeypatch):
    from app import database
    from app.api.graph import _try_neo4j

    class Session:
        active = False
        async def __aenter__(self):
            self.active = True
            return self
        async def __aexit__(self, *args):
            self.active = False

    session = Session()
    monkeypatch.setattr(database, "neo4j_driver", SimpleNamespace(session=lambda: session))
    async def query(current):
        await asyncio.sleep(0)
        assert current.active
        return "loaded"

    assert await _try_neo4j(query) == "loaded"
    assert not session.active


@pytest.mark.asyncio
async def test_database_quality_events_keep_tenant_and_defect_identity(monkeypatch):
    from app.api import quality
    from app.models.relational import Base, Inspection, Defect, CAPA, Worker, Tenant

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[x.__table__ for x in [Tenant, Worker, Inspection, Defect, CAPA]]))
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as db:
            db.add(Inspection(id=1, tenant_id=1, inspection_type="in_process", target_type="WorkOrder", target_id=10, result="fail", inspected_at=datetime(2026, 5, 21, 9, 40)))
            await db.flush()
            db.add(Defect(id=1, tenant_id=1, inspection_id=1, defect_type="焊点虚焊", severity="critical", description="example"))
            await db.commit()
        async def query(fn):
            async with factory() as db:
                return await fn(db)
        monkeypatch.setattr(quality, "_try_db", query)
        event = await quality._resolve_quality_event("QD-1", {"tenant_id": 1})
        assert event["affected"]["defect_id"] == 1
        assert event["id"] == "QD-1"
        with pytest.raises(HTTPException) as exc:
            await quality._resolve_quality_event("QD-1", {"tenant_id": 2})
        assert exc.value.status_code == 404
        preview = await quality.execute_quality_event_action("QD-1", quality.QualityEventAction(action="freeze_batch"), {"tenant_id": 1})
        assert preview["data"]["status"] == "preview_only"
    finally:
        await engine.dispose()
