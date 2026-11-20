from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import semantic_assets
from app.api.deps import get_current_user, get_db
from app.models.relational import (
    Application,
    Base,
    DataSource,
    DataSourceMetadata,
    OntologyCandidate,
    OntologyField,
    OntologyMapping,
    OntologyMappingLayout,
    OntologyObject,
    Tenant,
)


@asynccontextmanager
async def semantic_client(*models):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(
                Base.metadata.create_all,
                tables=[model.__table__ for model in (Tenant, *models)],
            )
        async with sessions.begin() as db:
            db.add(Tenant(id=1, name="Demo", slug="demo"))

        async def open_session():
            async with sessions() as db:
                yield db

        async def current_user():
            return {"uid": 1, "tenant_id": 1, "is_admin": True}

        app = FastAPI()
        app.include_router(semantic_assets.router, prefix="/api/v1/semantic-assets")
        app.dependency_overrides[get_db] = open_session
        app.dependency_overrides[get_current_user] = current_user
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, sessions
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_asset_catalog_reads_sqlite_tables_and_skips_views():
    async with semantic_client(Application, DataSource) as (client, sessions):
        async with sessions.begin() as db:
            await db.execute(text("CREATE VIEW knowledge_object_links AS SELECT 1 AS id"))
            db.add(Application(tenant_id=1, code="catalog-test", name="Catalog test"))
        response = await client.get("/api/v1/semantic-assets/data-assets")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source"] == "database"
    tables = {table["name"]: table for asset in payload["data"] for table in asset["tables"]}
    assert tables["applications"]["rows"] == 1
    assert "knowledge_object_links" not in tables


@pytest.mark.asyncio
async def test_create_and_update_ontology_object_return_persisted_fields():
    url = "/api/v1/semantic-assets/ontology-objects"
    body = {
        "code": "mes_work_order",
        "name": "MES 工单",
        "fields": [{"code": "work_order_id", "label": "工单号"}],
    }
    async with semantic_client(OntologyObject, OntologyField) as (client, _sessions):
        created = await client.post(url, json=body)
        assert created.status_code == 200, created.text
        persisted = created.json()["data"]
        assert [(field["code"], field["label"]) for field in persisted["fields"]] == [
            ("work_order_id", "工单号"),
        ]

        body["fields"] = [
            {"code": "work_order_id", "label": "外部工单号"},
            {"code": "planned_qty", "label": "计划量", "field_type": "integer"},
        ]
        updated = await client.put(f"{url}/{persisted['id']}", json=body)
        assert updated.status_code == 200, updated.text
        assert [(field["code"], field["label"], field["type"]) for field in updated.json()["data"]["fields"]] == [
            ("work_order_id", "外部工单号", "string"),
            ("planned_qty", "计划量", "integer"),
        ]

        readback = await client.get(url)
        assert readback.status_code == 200, readback.text
        assert readback.json()["data"] == [updated.json()["data"]]


@pytest.mark.asyncio
async def test_semantic_mapping_workbench_returns_object_field_nodes():
    async with semantic_client(
        OntologyObject,
        OntologyField,
        DataSource,
        DataSourceMetadata,
        OntologyCandidate,
        OntologyMapping,
        OntologyMappingLayout,
    ) as (client, sessions):
        async with sessions.begin() as db:
            db.add(OntologyObject(
                tenant_id=1,
                code="mes_work_order",
                name="MES 工单",
                status="published",
                fields=[OntologyField(tenant_id=1, code="work_order_id", name="工单号")],
            ))
            db.add(DataSource(id=5, tenant_id=1, name="MES", source_type="postgresql", connection_config="{}"))
            db.add(DataSourceMetadata(
                tenant_id=1,
                source_id=5,
                entity_name="work_orders",
                fields=[{"name": "work_order_id", "type": "text"}],
            ))
        response = await client.get(
            "/api/v1/semantic-assets/semantic-mapping/workbench",
            params={"source_id": 5, "object_code": "mes_work_order"},
        )

    assert response.status_code == 200, response.text
    workbench = response.json()["data"]
    node_id = "object-field:mes_work_order.work_order_id"
    nodes = {node["id"]: node for node in workbench["nodes"]}
    assert "source-field:5:work_orders.work_order_id" in nodes
    assert nodes[node_id]["label"] == "工单号"
    assert nodes[node_id]["data"] == {
        "object_code": "mes_work_order",
        "field": {"code": "work_order_id", "label": "工单号", "type": "string"},
    }
    assert any(edge["target"] == node_id for edge in workbench["edges"])
