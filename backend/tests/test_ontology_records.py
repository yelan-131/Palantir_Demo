import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import semantic_assets
from app.api.deps import get_current_user, get_db
from app.models.relational import (
    Base, DataSource, DynamicRecord, Form, FormPermission, FormVersion, MappedFormSyncBinding,
    OntologyField, OntologyMapping, OntologyObject, OntologyRelation, Role, Tenant, User, UserRole,
)


ROOT = "/semantic-assets"
ORDER = "WO-260521-017"
DEFECTS = ["DEF-260526-001", "DEF-260526-002"]


def published_field(form_id, name, *, kind="string", unique=False):
    return {
        "form_id": form_id, "field_name": name, "field_type": kind,
        "ui_config": {"rules": {"unique": {"enabled": unique}}},
    }


@pytest_asyncio.fixture
async def object_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    user = {"uid": 1, "tenant_id": 1, "is_admin": True}
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions.begin() as db:
            db.add_all([Tenant(id=1, name="One", slug="one"), Tenant(id=2, name="Two", slug="two")])
            db.add(User(id=1, tenant_id=1, username="reader", hashed_password="test"))
            db.add(Role(id=1, tenant_id=1, name="reader", label="Reader"))
            db.add(UserRole(tenant_id=1, user_id=1, role_id=1))
            db.add_all([
                Form(id=1, tenant_id=1, code="orders", name="MES 工单", status="published"),
                Form(id=2, tenant_id=1, code="defects", name="QMS 缺陷", status="published"),
                Form(id=3, tenant_id=2, code="orders", name="其他租户工单", status="published"),
                FormPermission(tenant_id=1, form_id=1, role_id=1, action="view", effect="allow"),
                FormPermission(tenant_id=1, form_id=2, role_id=1, action="view", effect="allow"),
                FormPermission(tenant_id=1, form_id=1, role_id=1, action="view", field_name="planned", effect="deny"),
                FormPermission(tenant_id=1, form_id=2, role_id=1, action="view", field_name="order_ref", effect="deny"),
                FormVersion(tenant_id=1, form_id=1, version=1, status="published", snapshot={"fields": [
                    published_field(1, "order_no", unique=True), published_field(1, "planned", kind="integer"),
                    published_field(1, "completed", kind="integer"),
                ]}),
                FormVersion(tenant_id=1, form_id=2, version=1, status="published", snapshot={"fields": [
                    published_field(2, "defect_id", unique=True), published_field(2, "order_ref"),
                ]}),
                OntologyObject(id=1, tenant_id=1, code="WorkOrder", name="生产工单", status="published", fields=[
                    OntologyField(tenant_id=1, code=code, name=code) for code in ("work_order_id", "planned", "completed")
                ]),
                OntologyObject(id=2, tenant_id=1, code="QualityDefect", name="质量缺陷", status="published", fields=[
                    OntologyField(tenant_id=1, code=code, name=code) for code in ("defect_id", "work_order_id")
                ]),
                OntologyRelation(id=1, tenant_id=1, code="DEFECT_OF", name="缺陷关联工单", status="published",
                                 source_object_code="QualityDefect", target_object_code="WorkOrder"),
                DynamicRecord(id=1, tenant_id=1, form_id=1, status="active",
                              data={"order_no": ORDER, "planned": 800, "completed": 356}),
                DynamicRecord(id=2, tenant_id=1, form_id=1, status="draft",
                              data={"order_no": "DRAFT", "planned": 1, "completed": 0}),
                DynamicRecord(id=3, tenant_id=1, form_id=2, status="active",
                              data={"defect_id": DEFECTS[0], "order_ref": ORDER}),
                DynamicRecord(id=4, tenant_id=1, form_id=2, status="active",
                              data={"defect_id": DEFECTS[1], "order_ref": ORDER}),
                DynamicRecord(id=5, tenant_id=1, form_id=2, status="active",
                              data={"defect_id": "ORPHAN", "order_ref": "LOCAL_404"}),
                DataSource(id=1, tenant_id=1, name="MES", source_type="postgresql", connection_config="{}"),
                MappedFormSyncBinding(tenant_id=1, source_id=1, entity_name="work_orders", object_code="WorkOrder", form_id=1),
                OntologyMapping(tenant_id=1, source_system="1", source_entity="work_orders", source_field="planned_qty",
                                target_object_code="WorkOrder", target_field_code="planned", status="approved"),
            ])

        async def session_dependency():
            async with sessions() as db:
                yield db

        app = FastAPI()
        app.include_router(semantic_assets.router, prefix=ROOT)
        app.dependency_overrides[get_db] = session_dependency
        app.dependency_overrides[get_current_user] = lambda: user
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, sessions, user
    finally:
        await engine.dispose()


async def configure(client):
    for object_id, key, properties in (
        (1, "order_no", {"work_order_id": "order_no", "planned": "planned", "completed": "completed"}),
        (2, "defect_id", {"defect_id": "defect_id", "work_order_id": "order_ref"}),
    ):
        response = await client.put(f"{ROOT}/ontology-objects/{object_id}/record-binding", json={
            "form_id": object_id, "key_field": key, "property_fields": properties,
        })
        assert response.status_code == 200, response.text
        assert response.json()["data"]["record_binding"]["property_fields"] == properties
    response = await client.put(f"{ROOT}/ontology-relations/1/record-link", json={
        "source_field": "work_order_id", "target_field": "work_order_id",
    })
    assert response.status_code == 200, response.text


async def instance(client, object_id, key):
    response = await client.get(f"{ROOT}/ontology-objects/{object_id}/record", params={"key": key})
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.mark.asyncio
async def test_bound_records_preview_links_in_both_directions(object_client):
    client, sessions, _ = object_client
    await configure(client)
    listing = await client.get(f"{ROOT}/ontology-objects/1/records")
    assert listing.status_code == 200, listing.text
    assert listing.json()["data"]["total"] == 1

    order = await instance(client, 1, ORDER)
    assert order["values"] == {"work_order_id": ORDER, "planned": 800, "completed": 356}
    assert order["sources"]["planned"]["source_name"] == "MES"
    assert order["relations"][0]["state"] == "matched"
    assert order["relations"][0]["total"] == 2
    assert [row["key"] for row in order["relations"][0]["records"]] == DEFECTS

    defect = await instance(client, 2, DEFECTS[0])
    assert defect["relations"][0]["direction"] == "outgoing"
    assert defect["relations"][0]["records"][0]["instance_id"] == order["instance_id"]
    orphan = await instance(client, 2, "ORPHAN")
    assert orphan["relations"][0]["state"] == "missing"

    async with sessions.begin() as db:
        (await db.get(DynamicRecord, 1)).data = {"order_no": ORDER, "planned": 800, "completed": 357}
    updated = await instance(client, 1, ORDER)
    assert updated["instance_id"] == order["instance_id"]
    assert updated["values"]["completed"] == 357

    async with sessions.begin() as db:
        db.add(DynamicRecord(tenant_id=1, form_id=1, status="active", data={"order_no": ORDER}))
    ambiguous = await instance(client, 2, DEFECTS[0])
    assert ambiguous["relations"][0]["state"] == "ambiguous"
    assert ambiguous["relations"][0]["records"] == []


@pytest.mark.asyncio
async def test_object_records_and_links_respect_tenant_and_field_access(object_client):
    client, _, user = object_client
    other_form = await client.put(f"{ROOT}/ontology-objects/1/record-binding", json={"form_id": 3, "key_field": "order_no"})
    assert other_form.status_code == 404
    await configure(client)
    user["is_admin"] = False
    writes = await client.put(f"{ROOT}/ontology-objects/1/record-binding", json={"form_id": 1, "key_field": "order_no"})
    assert writes.status_code == 403
    catalog = await client.get(f"{ROOT}/ontology-objects")
    assert all(row["record_bound"] and "record_binding" not in row for row in catalog.json()["data"])

    order = await instance(client, 1, ORDER)
    assert "planned" not in order["values"] and "planned" not in order["sources"]
    assert order["relations"][0]["total"] == 0
    defect = await instance(client, 2, DEFECTS[0])
    assert defect["values"] == {"defect_id": DEFECTS[0]}
    assert defect["relations"][0]["state"] == "restricted"

    user["tenant_id"] = 2
    detail = await client.get(f"{ROOT}/ontology-objects/1/record", params={"key": ORDER})
    assert detail.status_code == 404
