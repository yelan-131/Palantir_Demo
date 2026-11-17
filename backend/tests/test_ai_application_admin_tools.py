from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services import applications as applications_service
from app.models.relational import Application, ApplicationForm, ApplicationMenuNode, Base, Form, Tenant
from app.services.ai.application_admin_tools import execute_application_tool


ADMIN = {"tenant_id": 1, "uid": 1, "is_admin": True}


@pytest_asyncio.fixture
async def application_db(monkeypatch):
    audit = AsyncMock()
    monkeypatch.setattr(applications_service, 'write_audit_log', audit)
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as connection:
        await connection.execute(text("PRAGMA foreign_keys=ON"))
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            session.add_all([Tenant(id=1, name="One", slug="one"), Tenant(id=2, name="Two", slug="two")])
            await session.commit()
            yield session, audit
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_application_tools_require_confirmation_and_enforce_lifecycle(application_db):
    session, audit = application_db

    async def run(operation, payload, *, prepare=False, user=ADMIN):
        return await execute_application_tool(f"applications.{operation}", session, user=user, payload=payload, prepare=prepare)

    create = {"name": "巡检", "code": "inspection"}
    with pytest.raises(HTTPException, match="重新确认"):
        await run("create", create)
    preview = await run("create", create, prepare=True)
    assert preview["_preview"]["fields"]["状态"] == "草稿"
    assert await session.scalar(select(func.count(Application.id))) == 0
    audit.assert_not_awaited()

    with pytest.raises(HTTPException, match="重新确认"):
        await run("create", {**preview, "name": "改动后的名称"})
    app = (await run("create", preview))["data"]
    assert app["status"] == "draft"
    assert audit.await_count == 1
    with pytest.raises(HTTPException, match="code already exists"):
        await run("create", create, prepare=True)

    target = {"application_id": app["id"]}
    with pytest.raises(HTTPException) as forbidden:
        await run("update", {**target, "name": "另一个租户"}, prepare=True, user={**ADMIN, "tenant_id": 2})
    assert forbidden.value.status_code == 404
    with pytest.raises(HTTPException) as forbidden:
        await run("update", {**target, "name": "无管理员权限"}, prepare=True, user={**ADMIN, "is_admin": False})
    assert forbidden.value.status_code == 403

    stale_publish = await run("publish", target, prepare=True)
    update = await run("update", {**target, "name": "巡检应用"}, prepare=True)
    assert update["_preview"]["fields"]["应用名称"] == "巡检 → 巡检应用"
    await run("update", update)
    with pytest.raises(HTTPException, match="重新确认"):
        await run("publish", stale_publish)

    for operation, status in (("publish", "published"), ("disable", "disabled"), ("enable", "published")):
        confirmation = await run(operation, target, prepare=True)
        result = await run(operation, confirmation)
        assert result["data"]["status"] == status
    with pytest.raises(HTTPException, match="只能删除草稿"):
        await run("delete", target, prepare=True)


@pytest.mark.asyncio
async def test_confirmation_survives_time_passing_after_preview(application_db):
    session, _ = application_db
    app = Application(tenant_id=1, code="aged", name="Aged", status="draft")
    session.add(app)
    await session.flush()
    await session.execute(text("UPDATE applications SET updated_at = '2020-01-01 00:00:00' WHERE id = :id"), {"id": app.id})
    await session.commit()
    await session.refresh(app)

    async def run(payload, *, prepare=False):
        return await execute_application_tool("applications.publish", session, user=ADMIN, payload=payload, prepare=prepare)

    confirmation = await run({"application_id": app.id}, prepare=True)
    assert (await run(confirmation))["data"]["status"] == "published"


@pytest.mark.asyncio
async def test_delete_draft_reviews_and_removes_only_its_own_menu_and_bindings(application_db):
    session, _ = application_db
    apps = [
        Application(tenant_id=tenant_id, code="draft", name=f"Draft {tenant_id}", status="draft")
        for tenant_id in (1, 2)
    ]
    form = Form(tenant_id=1, code="inspection", name="Inspection")
    session.add_all([*apps, form])
    await session.flush()
    own, other = apps
    group = ApplicationMenuNode(tenant_id=1, application_id=own.id, title="Group", node_type="group")
    other_menu = ApplicationMenuNode(tenant_id=2, application_id=other.id, title="Other")
    session.add_all([group, other_menu, ApplicationForm(tenant_id=1, application_id=own.id, form_id=form.id)])
    await session.flush()
    session.add(ApplicationMenuNode(
        tenant_id=1, application_id=own.id, parent_id=group.id, title="Inspection", form_id=form.id,
    ))
    await session.commit()
    preview = await execute_application_tool(
        "applications.delete", session, user=ADMIN, payload={"application_id": own.id}, prepare=True,
    )
    assert list(preview["_preview"]["fields"].values()) == [2, 1]
    result = await execute_application_tool("applications.delete", session, user=ADMIN, payload=preview)
    assert result == {"ok": True}
    assert (await session.scalars(select(Application.id))).all() == [other.id]
    assert (await session.scalars(select(ApplicationMenuNode.id))).all() == [other_menu.id]
    assert await session.scalar(select(func.count(ApplicationForm.id))) == 0
    assert await session.get(Form, form.id) is not None
