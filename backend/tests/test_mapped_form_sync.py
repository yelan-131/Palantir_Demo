import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import data_sources, forms
from app.api.deps import get_current_user, get_db
from app.models.relational import (
    Base, DataSource, DataSourceMetadata, DataSourceSyncStatus, Form, FormVersion, MappedFormSyncBinding,
    MappedFormSyncRun, OntologyMapping, OntologyObject, Tenant,
)
from app.services import mapped_form_sync


ORDER_ID = "WO-260521-017"
SYNC_URL = "/data-sources/1/mapped-form-sync"
BINDINGS_URL = "/data-sources/1/mapped-form-sync-bindings"
SYNC_BODY = {"entity_name": "work_orders", "object_code": "MesWorkOrder", "form_id": 1, "source_key": ORDER_ID}


@pytest_asyncio.fixture(params=["dynamic", "physical_table"])
async def sync_client(request, monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    source_rows = [{"work_order_id": ORDER_ID, "planned_qty": 800, "completed_qty": 356}]
    read_keys = []
    user = {"uid": 1, "tenant_id": 1, "is_admin": True}
    names = {"work_order_id": "work_order_id", "planned": "planned_qty", "completed": "completed_qty"}
    record_fields = [
        {
            "id": 1, "field_name": "work_order_id", "label": "工单号", "required": True,
            "ui_config": {"rules": {"unique": {"enabled": True, "conditions": {"strategy": "form"}}}},
        },
        {"id": 2, "field_name": "planned", "label": "计划量", "field_type": "integer", "required": True},
        {"id": 3, "field_name": "completed", "label": "完成量", "field_type": "integer"},
        {"id": 4, "field_name": "note", "label": "备注", "default_value": "本地默认备注"},
    ]

    def read_source(settings, entity_name, primary_key, columns, source_key):
        assert settings["schema"] == "source"
        assert entity_name == "work_orders"
        assert primary_key == "work_order_id"
        assert columns == names
        read_keys.append(source_key)
        return [row.copy() for row in source_rows if source_key in (None, row["work_order_id"])]

    monkeypatch.setattr(mapped_form_sync, "_read_source_rows", read_source)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions.begin() as db:
            db.add_all([Tenant(id=1, name="One", slug="one"), Tenant(id=2, name="Two", slug="two")])
            db.add(DataSource(id=1, tenant_id=1, name="MES", source_type="postgresql", connection_config=json.dumps({
                "schema": "source", "selected_tables": ["work_orders"],
            })))
            db.add(DataSourceMetadata(tenant_id=1, source_id=1, entity_name="work_orders", fields=[
                {"name": name, "primary_key": name == "work_order_id"} for name in names.values()
            ]))
            db.add(OntologyObject(tenant_id=1, name="工单", code="MesWorkOrder", status="published"))
            db.add_all([OntologyMapping(
                tenant_id=1, source_system="1", source_entity="work_orders", source_field=column,
                target_object_code="MesWorkOrder", target_field_code=field, status="approved",
            ) for field, column in names.items()])
            db.add(Form(
                id=1, tenant_id=1, code="mes-sync", name="工单", status="published", storage_mode=request.param,
                table_name="t1_mes_sync" if request.param == "physical_table" else None,
            ))
            db.add(FormVersion(tenant_id=1, form_id=1, version=1, snapshot={"fields": record_fields}))

        async def open_session():
            async with sessions() as db:
                yield db

        async def current_user():
            return user

        app = FastAPI()
        app.include_router(data_sources.router, prefix="/data-sources")
        app.include_router(forms.router, prefix="/forms")
        app.dependency_overrides[get_db] = open_session
        app.dependency_overrides[get_current_user] = current_user
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, sessions, source_rows, read_keys, user
    finally:
        await engine.dispose()


async def form_records(client):
    response = await client.get("/forms/1/records")
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.mark.asyncio
async def test_mapped_sync_creates_then_updates_one_form_record(sync_client):
    client, _, source_rows, read_keys, _ = sync_client
    counts = {"read": 1, "created": 1, "updated": 0, "unchanged": 0}
    first = await client.post(SYNC_URL, json=SYNC_BODY)
    assert first.status_code == 200, first.text
    assert {key: first.json()["data"][key] for key in counts} == counts
    (original,) = await form_records(client)
    assert original["data"] == {"work_order_id": ORDER_ID, "planned": 800, "completed": 356, "note": "本地默认备注"}

    repeated = await client.post(SYNC_URL, json=SYNC_BODY)
    assert repeated.status_code == 200, repeated.text
    counts.update(created=0, unchanged=1)
    assert {key: repeated.json()["data"][key] for key in counts} == counts
    assert len(await form_records(client)) == 1

    note = await client.put(f"/forms/1/records/{original['id']}", json={"data": {"note": "保留业务备注"}})
    assert note.status_code == 200, note.text
    source_rows[0]["completed_qty"] = 357
    updated = await client.post(SYNC_URL, json=SYNC_BODY)
    assert updated.status_code == 200, updated.text
    counts.update(updated=1, unchanged=0)
    assert {key: updated.json()["data"][key] for key in counts} == counts
    (current,) = await form_records(client)
    assert current["id"] == original["id"]
    assert current["data"] == {"work_order_id": ORDER_ID, "planned": 800, "completed": 357, "note": "保留业务备注"}
    assert read_keys == [ORDER_ID] * 3


@pytest.mark.asyncio
async def test_mapped_sync_rejects_other_users_and_rolls_back_invalid_rows(sync_client):
    client, sessions, source_rows, read_keys, user = sync_client
    user["is_admin"] = False
    denied = await client.post(SYNC_URL, json=SYNC_BODY)
    assert denied.status_code == 403, denied.text
    user.update(is_admin=True, tenant_id=2)
    other_tenant = await client.post(SYNC_URL, json=SYNC_BODY)
    assert other_tenant.status_code == 404, other_tenant.text
    assert not read_keys

    user["tenant_id"] = 1
    source_rows.append({"work_order_id": "WO-260521-018", "planned_qty": None, "completed_qty": 0})
    invalid = await client.post(SYNC_URL, json={**SYNC_BODY, "source_key": None})
    assert invalid.status_code == 422, invalid.text
    assert read_keys == [None]
    assert await form_records(client) == []
    async with sessions() as db:
        assert (await db.get(DataSource, 1)).last_sync is None


@pytest.mark.asyncio
async def test_saved_sync_reuses_binding_and_persists_real_run_history(sync_client, monkeypatch):
    client, sessions, source_rows, read_keys, user = sync_client

    async def using_fixture_db(operation):
        async with sessions() as db:
            return await operation(db)

    @asynccontextmanager
    async def open_fixture_db():
        async with sessions() as db:
            yield db

    monkeypatch.setattr(data_sources, "_try_db", using_fixture_db)
    monkeypatch.setattr("app.core.db.db_session", open_fixture_db)
    target = {name: SYNC_BODY[name] for name in ("entity_name", "object_code", "form_id")}
    first_save = await client.post(BINDINGS_URL, json=target)
    assert first_save.status_code == 200, first_save.text
    binding = first_save.json()["data"]
    repeated_save = await client.post(BINDINGS_URL, json=target)
    assert repeated_save.json()["data"] == binding
    assert not read_keys
    runs_url = f"{BINDINGS_URL}/{binding['id']}/runs"
    assert (await client.get(BINDINGS_URL)).json()["data"] == [{**binding, "last_run": None}]

    first_run = (await client.post(runs_url, json={"source_key": ORDER_ID})).json()["data"]
    assert (first_run["status"], first_run["read"], first_run["created"]) == ("completed", 1, 1)
    again = (await client.post(runs_url, json={"source_key": ORDER_ID})).json()["data"]
    assert (again["status"], again["created"], again["unchanged"]) == ("completed", 0, 1)

    source_rows[0]["completed_qty"] = 357
    source_rows.append({"work_order_id": "WO-260521-018", "planned_qty": None, "completed_qty": 0})
    failed = await client.post(runs_url, json={})
    assert failed.status_code == 422, failed.text
    history = (await client.get(runs_url)).json()["data"]
    assert [run["status"] for run in history] == ["failed", "completed", "completed"]
    failure = history[0]
    assert failure["read"] == 2 and failure["updated"] == 0 and failure["error_message"]
    assert (await client.get(BINDINGS_URL)).json()["data"][0]["last_run"] == failure
    assert (await form_records(client))[0]["data"]["completed"] == 356

    # Metadata scan/legacy last_sync can change independently of real completed record writes.
    async with sessions.begin() as db:
        source = await db.get(DataSource, 1)
        source.last_sync = datetime(2040, 1, 1)
        db.add(DataSourceSyncStatus(tenant_id=1, source_id=1, status="completed", tables_scanned=1,
            last_finished_at=source.last_sync, last_started_at=source.last_sync - timedelta(seconds=2)))
    listed = (await client.get("/data-sources")).json()["data"][0]
    assert listed["last_sync"] == "2040-01-01T00:00:00"
    assert listed["last_record_sync"] == again["finished_at"]
    scan = (await client.get("/data-sources/1/sync-status")).json()["data"]
    assert datetime.fromisoformat(scan["last_finished_at"]) == datetime.fromisoformat(listed["last_sync"]).astimezone()
    assert scan["elapsed_ms"] == 2000

    user["tenant_id"] = 2
    assert (await client.get(runs_url)).status_code == 404
    assert (await client.post(runs_url, json={})).status_code == 404
    user["tenant_id"] = 1
    retry = (await client.post(runs_url, json={"source_key": ORDER_ID})).json()["data"]
    assert (retry["status"], retry["created"], retry["updated"]) == ("completed", 0, 1)
    assert len(await form_records(client)) == 1

    response = await client.delete("/data-sources/1")
    assert response.status_code == 200, response.text
    async with sessions() as db:
        assert not (await db.scalars(select(MappedFormSyncBinding))).all()
        assert not (await db.scalars(select(MappedFormSyncRun))).all()


@pytest.mark.asyncio
async def test_saved_sync_obeys_object_binding_and_disallows_competing_property_owners(sync_client):
    client, sessions, _, read_keys, _ = sync_client
    target = {name: SYNC_BODY[name] for name in ("entity_name", "object_code", "form_id")}
    async with sessions.begin() as db:
        obj = await db.scalar(select(OntologyObject).where(OntologyObject.code == "MesWorkOrder"))
        obj.metadata_json = {"record_binding": {"form_id": 1, "key_field": "work_order_id",
            "property_fields": {"work_order_id": "work_order_id", "planned_qty": "planned", "completed_qty": "completed"}}}
        mapped_fields = (await db.scalars(select(OntologyMapping))).all()
        source = await db.get(DataSource, 1)
        source_metadata = await db.scalar(select(DataSourceMetadata))
        db.add(DataSource(id=2, tenant_id=1, name="Second MES", source_type="postgresql",
                          connection_config=source.connection_config))
        db.add(DataSourceMetadata(tenant_id=1, source_id=2, entity_name="work_orders", fields=source_metadata.fields))
        for mapping in mapped_fields:
            mapping.target_field_code = mapping.source_field
            db.add(OntologyMapping(tenant_id=1, source_system="2", source_entity="work_orders",
                source_field=mapping.source_field, target_object_code="MesWorkOrder",
                target_field_code=mapping.source_field, status="approved"))

    saved = await client.post(BINDINGS_URL, json=target)
    assert saved.status_code == 200, saved.text
    binding_id = saved.json()["data"]["id"]
    competing = await client.post("/data-sources/2/mapped-form-sync-bindings", json=target)
    assert competing.status_code == 409, competing.text
    assert (await client.post("/data-sources/2/mapped-form-sync", json=SYNC_BODY)).status_code == 409
    assert not read_keys
    synced = await client.post(f"{BINDINGS_URL}/{binding_id}/runs", json={"source_key": ORDER_ID})
    assert synced.status_code == 200, synced.text
    assert (await form_records(client))[0]["data"]["completed"] == 356

    async with sessions.begin() as db:
        obj = await db.scalar(select(OntologyObject).where(OntologyObject.code == "MesWorkOrder"))
        obj.metadata_json = {"record_binding": {"form_id": 1, "key_field": "work_order_id",
            "property_fields": {"work_order_id": "work_order_id", "planned_qty": "planned"}}}
    omitted_property = await client.post(f"{BINDINGS_URL}/{binding_id}/runs", json={"source_key": ORDER_ID})
    assert omitted_property.status_code == 422, omitted_property.text
    assert read_keys == [ORDER_ID]
