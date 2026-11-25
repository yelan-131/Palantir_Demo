from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
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
EMPTY_RECORD_METADATA = {"tags": None, "properties": []}


def published_field(form_id, name, *, kind="string", unique=False, **settings):
    return {
        "form_id": form_id, "field_name": name, "field_type": kind,
        "ui_config": {"rules": {"unique": {"enabled": unique}}},
        **settings,
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
                    published_field(1, "notes", kind="text"), published_field(1, "eta", kind="date"),
                    published_field(1, "urgent", kind="boolean"),
                    published_field(1, "category", kind="enum", enum_values={"values": [{"value": "standard", "label": "标准"}]}),
                    published_field(1, "tags", kind="enum", enum_values=["red"], ui_config={"typeSettings": {"selectionMode": "multiple"}}),
                    published_field(1, "protected_notes", ui_config={"readonly": True}),
                ]}),
                FormVersion(tenant_id=1, form_id=2, version=1, status="published", snapshot={"fields": [
                    published_field(2, "defect_id", unique=True), published_field(2, "order_ref"),
                ]}),
                OntologyObject(id=1, tenant_id=1, code="WorkOrder", name="生产工单", status="published", fields=[
                    OntologyField(tenant_id=1, code=code, name=code) for code in (
                        "work_order_id", "planned", "completed", "wiki_markdown", "eta", "urgent", "category", "tags", "protected_notes",
                    )
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
        (1, "order_no", {"work_order_id": "order_no", "planned": "planned", "completed": "completed",
                         "wiki_markdown": "notes", "eta": "eta", "urgent": "urgent", "category": "category",
                         "tags": "tags", "protected_notes": "protected_notes"}),
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
    expected_evidence = {"source_field": "work_order_id", "source_value": ORDER,
                         "target_field": "work_order_id", "target_value": ORDER}
    assert order["relations"][0]["evidence"] == expected_evidence

    defect = await instance(client, 2, DEFECTS[0])
    assert defect["relations"][0]["direction"] == "outgoing"
    assert defect["relations"][0]["records"][0]["instance_id"] == order["instance_id"]
    assert defect["relations"][0]["evidence"] == expected_evidence
    orphan = await instance(client, 2, "ORPHAN")
    assert orphan["relations"][0]["state"] == "missing"
    assert "evidence" not in orphan["relations"][0]

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
    assert "evidence" not in ambiguous["relations"][0]


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
    assert "evidence" not in order["relations"][0]
    defect = await instance(client, 2, DEFECTS[0])
    assert defect["values"] == {"defect_id": DEFECTS[0]}
    assert defect["relations"][0]["state"] == "restricted"
    assert "evidence" not in defect["relations"][0]

    user["tenant_id"] = 2
    detail = await client.get(f"{ROOT}/ontology-objects/1/record", params={"key": ORDER})
    assert detail.status_code == 404


@pytest.mark.asyncio
async def test_similarity_features_persist_with_record_binding_and_require_admin(object_client):
    client, sessions, user = object_client
    async with sessions.begin() as db:
        planned = await db.scalar(select(OntologyField).where(OntologyField.object_id == 1, OntologyField.code == "planned"))
        planned.field_type = "integer"
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/similarity-features"
    feature = {"code": "planned", "kind": "number", "dimension": "planned_quantity", "tolerance": 300}
    saved = await client.put(url, json={"features": [feature]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["record_binding"]["key_field"] == "order_no"
    duplicate = await client.put(url, json={"features": [feature, feature]})
    assert duplicate.status_code == 422

    user["is_admin"] = False
    assert (await client.put(url, json={"features": []})).status_code == 403
    catalog = await client.get(f"{ROOT}/ontology-objects")
    order = next(item for item in catalog.json()["data"] if item["db_id"] == 1)
    assert order["similarity_features"] == [feature]
    assert order["record_bound"] and "record_binding" not in order

    user.update(tenant_id=2, is_admin=True)
    assert (await client.put(url, json={"features": []})).status_code == 404


@pytest.mark.asyncio
async def test_object_record_editor_saves_mapped_form_values_and_detects_conflicts(object_client):
    client, sessions, _ = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    editor_response = await client.get(url, params=params)
    assert editor_response.status_code == 200, editor_response.text
    editor = editor_response.json()["data"]
    fields = {item["code"]: item for item in editor["fields"]}
    assert set(fields) == {"work_order_id", "planned", "completed", "wiki_markdown", "eta", "urgent", "category"}
    assert fields["work_order_id"]["required"]
    assert fields["wiki_markdown"]["control_type"] == "textarea"
    assert fields["eta"]["field_type"] == "date"
    assert fields["category"]["options"] == [{"value": "standard", "label": "标准"}]

    changes = {"wiki_markdown": "## 更新说明\n\n已完成复核。", "eta": "2026-11-26", "urgent": False,
               "category": "standard", "completed": 401}
    expected = {code: editor["values"][code] for code in changes}
    body = {"data": changes, "expected_values": expected, "token": editor["token"]}
    response = await client.put(url, params=params, json=body)
    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"key": ORDER}}
    order = await instance(client, 1, ORDER)
    assert order["values"] == {**changes, "work_order_id": ORDER, "planned": 800}
    async with sessions() as db:
        row = await db.get(DynamicRecord, 1)
        assert row.data["notes"] == changes["wiki_markdown"]
        assert "wiki_markdown" not in row.data

    stale_values = await client.put(url, params=params, json=body)
    assert stale_values.status_code == 409
    invalid_date = await client.put(url, params=params, json={"data": {"eta": "tomorrow"},
        "expected_values": {"eta": changes["eta"]}, "token": editor["token"]})
    assert invalid_date.status_code == 422
    invalid_expected = await client.put(url, params=params, json={**body, "expected_values": {"eta": None}})
    assert invalid_expected.status_code == 422

    async with sessions.begin() as db:
        (await db.get(DynamicRecord, 1)).status = "archived"
        db.add(DynamicRecord(tenant_id=1, form_id=1, status="active", data={"order_no": ORDER, "completed": 401}))
    replaced = await client.put(url, params=params, json={"data": {"completed": 402},
        "expected_values": {"completed": 401}, "token": editor["token"]})
    assert replaced.status_code == 409
    assert (await instance(client, 1, ORDER))["values"]["completed"] == 401


@pytest.mark.asyncio
async def test_object_record_editor_only_exposes_visible_writable_properties(object_client):
    client, sessions, user = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    response = await client.get(url, params={"key": "DRAFT"})
    assert response.status_code == 404

    user["is_admin"] = False
    response = await client.get(url, params=params)
    assert response.status_code == 403
    async with sessions.begin() as db:
        db.add_all([
            FormPermission(tenant_id=1, form_id=1, role_id=1, action="edit", effect="allow"),
            FormPermission(tenant_id=1, form_id=1, role_id=1, action="edit", field_name="category", effect="deny"),
        ])

    response = await client.get(url, params=params)
    assert response.status_code == 200, response.text
    editor = response.json()["data"]
    assert set(editor["values"]) == {"work_order_id", "completed", "wiki_markdown", "eta", "urgent"}
    for code in ("planned", "category", "protected_notes", "unmapped"):
        response = await client.put(url, params=params, json={
            "data": {code: "forbidden"}, "expected_values": {code: None}, "token": editor["token"],
        })
        assert response.status_code == 403, response.text
    user["tenant_id"] = 2
    response = await client.put(url, params=params, json={"data": {"completed": 400},
        "expected_values": {"completed": 356}, "token": editor["token"]})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_object_record_editor_rolls_back_when_form_rule_would_rename_the_object(object_client):
    client, sessions, _ = object_client
    await configure(client)
    async with sessions.begin() as db:
        version = await db.scalar(select(FormVersion).where(FormVersion.form_id == 1))
        fields = version.snapshot["fields"]
        notes = next(field for field in fields if field["field_name"] == "notes")
        assignment = {"targetField": "order_no", "sourceAttribute": "self.value"}
        replacement = {**notes, "ui_config": {**notes["ui_config"], "assignmentRules": [assignment]}}
        version.snapshot = {**version.snapshot, "fields": [replacement if field is notes else field for field in fields]}

    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    editor = await client.get(url, params=params)
    assert editor.status_code == 200, editor.text
    response = await client.put(url, params=params, json={"data": {"wiki_markdown": "unexpected-key"},
        "expected_values": {"wiki_markdown": None}, "token": editor.json()["data"]["token"]})
    assert response.status_code == 409, response.text
    order = await instance(client, 1, ORDER)
    assert "wiki_markdown" not in order["values"]


@pytest.mark.asyncio
async def test_object_record_annotations_add_edit_and_delete_without_changing_form_data(object_client):
    client, sessions, _ = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    before = await instance(client, 1, ORDER)
    assert before["record_metadata"] == EMPTY_RECORD_METADATA
    snapshot = (await client.get(url, params=params)).json()["data"]
    assert snapshot["record_metadata"] == EMPTY_RECORD_METADATA

    metadata = {"tags": [" 需复核 "], "properties": [{"id": "inspection", "name": " 复核人 ", "value": "张工"}]}
    response = await client.put(url, params=params, json={
        "token": snapshot["token"], "record_metadata": metadata, "expected_record_metadata": snapshot["record_metadata"],
    })
    assert response.status_code == 200, response.text
    normalized = {"tags": ["需复核"], "properties": [{"id": "inspection", "name": "复核人", "value": "张工"}]}
    after = await instance(client, 1, ORDER)
    assert after["record_metadata"] == normalized
    assert {**after, "record_metadata": EMPTY_RECORD_METADATA} == before
    other_record = await instance(client, 2, DEFECTS[0])
    assert other_record["record_metadata"] == EMPTY_RECORD_METADATA
    async with sessions() as db:
        assert (await db.get(DynamicRecord, 1)).data == {"order_no": ORDER, "planned": 800, "completed": 356}

    edited = {"tags": [], "properties": [{"id": "inspection", "name": "负责人", "value": " 李工 "}]}
    response = await client.put(url, params=params, json={
        "token": snapshot["token"], "record_metadata": edited, "expected_record_metadata": normalized,
    })
    assert response.status_code == 200, response.text
    assert (await instance(client, 1, ORDER))["record_metadata"] == edited

    response = await client.put(url, params=params, json={
        "token": snapshot["token"], "record_metadata": EMPTY_RECORD_METADATA, "expected_record_metadata": edited,
    })
    assert response.status_code == 200, response.text
    assert (await instance(client, 1, ORDER))["record_metadata"] == EMPTY_RECORD_METADATA


@pytest.mark.asyncio
async def test_record_property_labels_are_local_to_one_record_and_keep_model_defaults(object_client):
    client, sessions, _ = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    labels = {**EMPTY_RECORD_METADATA, "property_labels": {"planned": "  计划数量  "}}
    body = {"token": snapshot["token"], "record_metadata": labels, "expected_record_metadata": snapshot["record_metadata"]}
    saved = await client.put(url, params=params, json=body)
    assert saved.status_code == 200, saved.text

    normalized = {**EMPTY_RECORD_METADATA, "property_labels": {"planned": "计划数量"}}
    after = await instance(client, 1, ORDER)
    assert after["record_metadata"] == normalized
    assert after["values"]["planned"] == 800
    edited = (await client.get(url, params=params)).json()["data"]
    assert edited["record_metadata"] == normalized
    assert next(field for field in edited["fields"] if field["code"] == "planned")["label"] == "planned"
    async with sessions.begin() as db:
        db.add(DynamicRecord(tenant_id=1, form_id=1, status="active", data={"order_no": "OTHER", "planned": 100}))
    assert (await instance(client, 1, "OTHER"))["record_metadata"] == EMPTY_RECORD_METADATA

    stale = await client.put(url, params=params, json={**body, "record_metadata": {**labels, "property_labels": {}}})
    assert stale.status_code == 409, stale.text
    blank = await client.put(url, params=params, json={
        **body, "record_metadata": {**labels, "property_labels": {"planned": " "}},
        "expected_record_metadata": normalized,
    })
    assert blank.status_code == 422, blank.text
    reset = await client.put(url, params=params, json={
        **body, "record_metadata": {**labels, "property_labels": {}}, "expected_record_metadata": normalized,
    })
    assert reset.status_code == 200, reset.text
    assert (await instance(client, 1, ORDER))["record_metadata"] == EMPTY_RECORD_METADATA


@pytest.mark.asyncio
async def test_record_property_labels_are_filtered_and_preserved_for_legacy_editors(object_client):
    client, sessions, user = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    metadata = {**EMPTY_RECORD_METADATA, "property_labels": {"planned": "计划数量", "completed": "完工数量"}}
    saved = await client.put(url, params=params, json={
        "token": snapshot["token"], "record_metadata": metadata, "expected_record_metadata": EMPTY_RECORD_METADATA,
    })
    assert saved.status_code == 200, saved.text

    legacy = {"tags": ["需复核"], "properties": []}
    saved = await client.put(url, params=params, json={
        "token": snapshot["token"], "record_metadata": legacy, "expected_record_metadata": EMPTY_RECORD_METADATA,
    })
    assert saved.status_code == 200, saved.text
    assert (await instance(client, 1, ORDER))["record_metadata"] == {**metadata, **legacy}

    async with sessions.begin() as db:
        db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action="edit", effect="allow"))
    user["is_admin"] = False
    allowed = {**legacy, "property_labels": {"completed": "完工数量"}}
    assert (await instance(client, 1, ORDER))["record_metadata"] == allowed
    restricted = (await client.get(url, params=params)).json()["data"]
    assert restricted["record_metadata"] == allowed
    body = {"token": restricted["token"], "expected_record_metadata": allowed}
    for code in ("planned", "protected_notes", "unknown_property"):
        denied = await client.put(url, params=params, json={
            **body, "record_metadata": {**legacy, "property_labels": {code: "禁止修改"}},
        })
        assert denied.status_code == 403, denied.text

    reset = await client.put(url, params=params, json={**body, "record_metadata": {**legacy, "property_labels": {}}})
    assert reset.status_code == 200, reset.text
    assert (await instance(client, 1, ORDER))["record_metadata"] == legacy
    user["is_admin"] = True
    assert (await instance(client, 1, ORDER))["record_metadata"] == {**legacy, "property_labels": {"planned": "计划数量"}}


@pytest.mark.asyncio
async def test_object_annotation_and_form_edit_are_atomic_with_independent_conflict_checks(object_client):
    client, _, _ = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    metadata = {"tags": ["已复核"], "properties": []}
    mixed = {"token": snapshot["token"], "data": {"completed": 410}, "expected_values": {"completed": 356},
             "record_metadata": metadata, "expected_record_metadata": EMPTY_RECORD_METADATA}

    stale_metadata = await client.put(url, params=params, json={**mixed, "expected_record_metadata": {"tags": [], "properties": []}})
    assert stale_metadata.status_code == 409
    stale_field = await client.put(url, params=params, json={**mixed, "expected_values": {"completed": 355}})
    assert stale_field.status_code == 409
    rejected = await instance(client, 1, ORDER)
    assert rejected["values"]["completed"] == 356
    assert rejected["record_metadata"] == EMPTY_RECORD_METADATA

    missing_expected = {key: value for key, value in mixed.items() if key != "expected_record_metadata"}
    assert (await client.put(url, params=params, json=missing_expected)).status_code == 422
    duplicate_tags = {"tags": ["重复", " 重复 "], "properties": []}
    assert (await client.put(url, params=params, json={**mixed, "record_metadata": duplicate_tags})).status_code == 422
    property_item = {"id": "dup", "name": "重复标识", "value": ""}
    duplicate_properties = {"tags": None, "properties": [property_item, property_item]}
    assert (await client.put(url, params=params, json={**mixed, "record_metadata": duplicate_properties})).status_code == 422

    response = await client.put(url, params=params, json=mixed)
    assert response.status_code == 200, response.text
    saved = await instance(client, 1, ORDER)
    assert saved["values"]["completed"] == 410
    assert saved["record_metadata"] == metadata


@pytest.mark.asyncio
async def test_object_annotations_require_source_edit_permission_and_do_not_follow_replacement_rows(object_client):
    client, sessions, user = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/2/record-edit"
    params = {"key": DEFECTS[0]}
    admin_snapshot = (await client.get(url, params=params)).json()["data"]
    metadata = {"tags": ["待处置"], "properties": []}
    body = {"token": admin_snapshot["token"], "record_metadata": metadata, "expected_record_metadata": EMPTY_RECORD_METADATA}

    user["is_admin"] = False
    assert (await client.put(url, params=params, json=body)).status_code == 403
    async with sessions.begin() as db:
        db.add_all([
            FormPermission(tenant_id=1, form_id=2, role_id=1, action="edit", effect="allow"),
            FormPermission(tenant_id=1, form_id=2, role_id=1, action="edit", field_name="defect_id", effect="deny"),
        ])
    snapshot = (await client.get(url, params=params)).json()["data"]
    assert snapshot["fields"] == []
    response = await client.put(url, params=params, json={**body, "token": snapshot["token"]})
    assert response.status_code == 200, response.text
    assert (await instance(client, 2, DEFECTS[0]))["record_metadata"] == metadata

    async with sessions.begin() as db:
        old = await db.get(DynamicRecord, 3)
        created_at = old.created_at or datetime(2026, 11, 25)
        data = dict(old.data)
        await db.delete(old)
        await db.flush()
        db.add(DynamicRecord(id=3, tenant_id=1, form_id=2, status="active", data=data,
                             created_at=created_at + timedelta(days=1)))

    replacement = await instance(client, 2, DEFECTS[0])
    assert replacement["record_metadata"] == EMPTY_RECORD_METADATA
    assert (await client.put(url, params=params, json={**body, "token": snapshot["token"]})).status_code == 409
    user["tenant_id"] = 2
    assert (await client.get(f"{ROOT}/ontology-objects/2/record", params=params)).status_code == 404


@pytest.mark.asyncio
async def test_object_key_edit_preserves_storage_identity_metadata_and_graph_links(object_client):
    client, sessions, _ = object_client
    await configure(client)
    async with sessions.begin() as db:
        await db.execute(delete(MappedFormSyncBinding))
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    renamed = f"{ORDER}-REVISED"
    metadata = {"tags": ["已更名"], "properties": [], "property_labels": {"work_order_id": "新工单编号"}}
    body = {"token": snapshot["token"], "data": {"work_order_id": renamed}, "expected_values": {"work_order_id": ORDER},
            "record_metadata": metadata, "expected_record_metadata": snapshot["record_metadata"]}
    stale = await client.put(url, params=params, json={**body, "expected_values": {"work_order_id": "old key"}})
    assert stale.status_code == 409, stale.text
    saved = await client.put(url, params=params, json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"data": {"key": renamed}}
    assert (await client.put(url, params=params, json=body)).status_code == 404
    assert (await client.get(f"{ROOT}/ontology-objects/1/record", params=params)).status_code == 404

    order = await instance(client, 1, renamed)
    assert order["record_metadata"] == metadata
    assert order["values"]["work_order_id"] == renamed
    assert [row["key"] for row in order["relations"][0]["records"]] == DEFECTS
    for defect_key in DEFECTS:
        defect = await instance(client, 2, defect_key)
        related = defect["relations"][0]
        assert related["records"][0]["instance_id"] == order["instance_id"]
        assert related["evidence"]["source_value"] == related["evidence"]["target_value"] == renamed
    async with sessions() as db:
        assert (await db.get(DynamicRecord, 1)).data["order_no"] == renamed
        assert (await db.get(DynamicRecord, 5)).data["order_ref"] == "LOCAL_404"


@pytest.mark.asyncio
async def test_object_key_edit_checks_uniqueness_and_sync_ownership(object_client):
    client, sessions, _ = object_client
    await configure(client)
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    body = {"token": snapshot["token"], "expected_values": {"work_order_id": ORDER}}
    sync_managed = await client.put(url, params=params, json={**body, "data": {"work_order_id": "renamed"}})
    assert sync_managed.status_code == 409 and "同步配置" in sync_managed.json()["detail"], sync_managed.text
    async with sessions.begin() as db:
        await db.execute(delete(MappedFormSyncBinding))
        db.add(DynamicRecord(tenant_id=1, form_id=1, status="active", data={"order_no": "IN-USE"}))
    for key in ("   ", "x" * 201):
        invalid = await client.put(url, params=params, json={**body, "data": {"work_order_id": key}})
        assert invalid.status_code == 422, invalid.text
    duplicate = await client.put(url, params=params, json={**body, "data": {"work_order_id": "IN-USE"}})
    assert duplicate.status_code in {409, 422}, duplicate.text
    assert (await instance(client, 1, ORDER))["relations"][0]["total"] == 2


@pytest.mark.asyncio
async def test_object_key_edit_rolls_back_when_related_records_are_restricted(object_client):
    client, sessions, user = object_client
    await configure(client)
    async with sessions.begin() as db:
        await db.execute(delete(MappedFormSyncBinding))
        db.add(FormPermission(tenant_id=1, form_id=1, role_id=1, action="edit", effect="allow"))
    user["is_admin"] = False
    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    response = await client.put(url, params=params, json={"token": snapshot["token"],
        "data": {"work_order_id": "renamed", "completed": 400}, "expected_values": {"work_order_id": ORDER, "completed": 356},
        "record_metadata": {"tags": ["rolled back"], "properties": []}, "expected_record_metadata": snapshot["record_metadata"],
    })
    assert response.status_code == 403 and "关联记录" in response.json()["detail"], response.text
    user["is_admin"] = True
    order = await instance(client, 1, ORDER)
    assert order["relations"][0]["total"] == 2
    assert order["values"]["completed"] == 356
    assert order["record_metadata"] == EMPTY_RECORD_METADATA


@pytest.mark.asyncio
async def test_object_key_edit_does_not_break_existing_outgoing_key_links(object_client):
    client, sessions, _ = object_client
    await configure(client)
    async with sessions.begin() as db:
        (await db.get(DynamicRecord, 3)).data = {"defect_id": ORDER, "order_ref": ORDER}
    link = await client.put(f"{ROOT}/ontology-relations/1/record-link", json={
        "source_field": "defect_id", "target_field": "work_order_id",
    })
    assert link.status_code == 200, link.text

    url = f"{ROOT}/ontology-objects/2/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    saved = await client.put(url, params=params, json={"token": snapshot["token"],
        "data": {"defect_id": "DEF-REVISED"}, "expected_values": {"defect_id": ORDER}})
    assert saved.status_code == 409 and "关联其他对象主键" in saved.json()["detail"], saved.text
    assert (await instance(client, 2, ORDER))["relations"][0]["state"] == "matched"


@pytest.mark.asyncio
async def test_object_key_edit_rejects_cascading_a_field_with_another_live_target(object_client):
    client, sessions, _ = object_client
    await configure(client)
    async with sessions.begin() as db:
        await db.execute(delete(MappedFormSyncBinding))
        db.add_all([
            Form(id=4, tenant_id=1, code="runs", name="Assembly Runs", status="published"),
            FormVersion(tenant_id=1, form_id=4, version=1, status="published", snapshot={"fields": [
                published_field(4, "run_id", unique=True),
            ]}),
            DynamicRecord(tenant_id=1, form_id=4, status="active", data={"run_id": ORDER}),
            OntologyObject(id=4, tenant_id=1, code="AssemblyRun", name="总装运行", status="published", fields=[
                OntologyField(tenant_id=1, code="run_id", name="运行编号"),
            ]),
            OntologyRelation(id=2, tenant_id=1, code="DEFECT_OF_RUN", name="缺陷关联运行", status="published",
                             source_object_code="QualityDefect", target_object_code="AssemblyRun"),
        ])
    binding = await client.put(f"{ROOT}/ontology-objects/4/record-binding", json={"form_id": 4, "key_field": "run_id"})
    assert binding.status_code == 200, binding.text
    link = await client.put(f"{ROOT}/ontology-relations/2/record-link", json={
        "source_field": "work_order_id", "target_field": "run_id",
    })
    assert link.status_code == 200, link.text

    url = f"{ROOT}/ontology-objects/1/record-edit"
    params = {"key": ORDER}
    snapshot = (await client.get(url, params=params)).json()["data"]
    saved = await client.put(url, params=params, json={"token": snapshot["token"],
        "data": {"work_order_id": "RENAMED"}, "expected_values": {"work_order_id": ORDER}})
    assert saved.status_code == 409 and "关联其他对象主键" in saved.json()["detail"], saved.text
    assert {relation["state"] for relation in (await instance(client, 2, DEFECTS[0]))["relations"]} == {"matched"}
