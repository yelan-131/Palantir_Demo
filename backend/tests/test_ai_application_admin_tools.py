from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import applications
from app.services import applications as applications_service
from app.models.relational import Application, ApplicationForm, ApplicationMenuNode, Base, Form, Role, RolePermission, Tenant
from app.services.application_menu_nodes import _create_application_menu_node, _update_application_menu_node
from app.services.form_schemas import MenuNodeCreate, MenuNodeUpdate
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
async def test_application_code_stays_locked_after_first_publish(application_db):
    session, _ = application_db
    app = Application(tenant_id=1, code="draft-code", name="巡检", status="draft")
    session.add(app)
    await session.commit()

    async def update(**values):
        return (await applications_service.update_application(
            session, app, applications.ApplicationUpdate(**values), ADMIN,
        ))["data"]

    assert (await update(code="revised-draft"))["code_locked"] is False
    published = await update(code="final-code", status="published")
    assert published["code"] == "final-code"
    assert published["code_locked"] is True
    for status in ("published", "disabled", "draft"):
        await update(status=status)
        with pytest.raises(HTTPException, match="首次发布后不可修改"):
            await update(code="changed-code")
        with pytest.raises(HTTPException, match="首次发布后不可修改"):
            await execute_application_tool(
                "applications.update", session, user=ADMIN,
                payload={"application_id": app.id, "code": "changed-code"}, prepare=True,
            )
        assert (await update(code="final-code", name="巡检应用"))["code"] == "final-code"


@pytest.mark.asyncio
async def test_application_settings_save_roles_and_validate_tenant(application_db):
    session, _ = application_db
    session.add_all([
        Role(id=1, tenant_id=1, name="viewer", label="查看"),
        Role(id=2, tenant_id=2, name="viewer", label="其他租户查看"),
    ])
    await session.commit()
    created = (await applications_service.create_application(
        session, applications.ApplicationCreate(name="巡检", code="inspection", role_ids=[1]), ADMIN,
    ))["data"]
    app = await session.get(Application, created["id"])
    assert [role["id"] for role in created["roles"]] == [1]

    async def update(**values):
        return (await applications_service.update_application(
            session, app, applications.ApplicationUpdate(**values), ADMIN,
        ))["data"]

    with pytest.raises(HTTPException, match="当前租户"):
        await update(role_ids=[2])
    cleared = await update(role_ids=[], expected_token=created["edit_token"])
    assert cleared["roles"] == []
    with pytest.raises(HTTPException, match="其他编辑更新"):
        await update(role_ids=[1], expected_token=created["edit_token"])
    saved = await update(role_ids=[1], name="巡检应用", expected_token=cleared["edit_token"])
    assert saved["name"] == "巡检应用"
    assert [role["id"] for role in saved["roles"]] == [1]


@pytest.mark.asyncio
async def test_application_access_groups_save_and_follow_role_bindings(application_db):
    session, _ = application_db
    session.add_all([
        Role(id=1, tenant_id=1, name="viewer", label="查看"),
        Role(id=2, tenant_id=1, name="editor", label="编辑"),
        Role(id=3, tenant_id=2, name="viewer", label="其他租户查看"),
    ])
    await session.commit()
    created = (await applications_service.create_application(
        session, applications.ApplicationCreate(name="巡检", code="access-groups", role_ids=[1]), ADMIN,
    ))["data"]
    assert created["access_groups"] == [{"id": "default-access", "name": "默认权限组", "roleIds": [1]}]
    app = await session.get(Application, created["id"])

    async def update(**values):
        return (await applications_service.update_application(
            session, app, applications.ApplicationUpdate(**values), ADMIN,
        ))["data"]

    groups = [
        {"id": "default-access", "name": "默认权限组", "roleIds": [1]},
        {"id": "operators", "name": "操作员", "roleIds": [1, 2]},
    ]
    saved = await update(access_groups=groups, expected_token=created["edit_token"])
    await session.refresh(app)
    assert app.access_groups == saved["access_groups"] == groups
    assert [role["id"] for role in saved["roles"]] == [1, 2]

    renamed = await update(access_groups=[{**groups[0], "name": "巡检员"}, groups[1]])
    assert renamed["edit_token"] != saved["edit_token"]
    with pytest.raises(HTTPException, match="其他编辑更新"):
        await update(access_groups=groups, expected_token=saved["edit_token"])
    with pytest.raises(HTTPException, match="当前租户"):
        await update(access_groups=[{**groups[0], "roleIds": [3]}])
    await session.rollback()
    await session.refresh(app)
    assert app.access_groups == renamed["access_groups"]

    legacy = await update(role_ids=[2])
    assert [group["roleIds"] for group in legacy["access_groups"]] == [[], [2]]
    cleared = await update(access_groups=[])
    assert cleared["access_groups"] == cleared["roles"] == []


@pytest.mark.asyncio
async def test_menu_permission_groups_save_union_and_restore_visibility(application_db):
    db, _ = application_db
    db.add_all([
        Role(id=1, tenant_id=1, name="viewer", label="查看"),
        Role(id=2, tenant_id=1, name="editor", label="编辑"),
        Role(id=3, tenant_id=2, name="viewer", label="其他租户查看"),
        Application(id=1, tenant_id=1, name="巡检", code="inspection"),
    ])
    await db.commit()
    groups = [
        {"id": "first", "name": "查看", "roleIds": [1]},
        {"id": "second", "name": "编辑", "roleIds": [1, 2]},
    ]
    created = (await _create_application_menu_node(1, MenuNodeCreate(
        title="巡检菜单", node_type="group", config={"permission_mode": "custom", "access_groups": groups},
    ), db, ADMIN))["data"]
    assert created["config"]["access_groups"] == groups
    assert created["config"]["role_ids"] == [1, 2]

    async def update(**values):
        return (await _update_application_menu_node(1, created["id"], MenuNodeUpdate(**values), db, ADMIN))["data"]

    async def grants():
        rows = (await db.scalars(select(RolePermission).order_by(RolePermission.role_id))).all()
        return [(row.role_id, row.enabled) for row in rows]

    assert await grants() == [(1, True), (2, True)]
    assert (await update(visible=False))["config"]["access_groups"] == groups
    assert await grants() == [(1, False), (2, False)]
    await update(visible=True)
    assert await grants() == [(1, True), (2, True)]
    with pytest.raises(HTTPException, match="当前租户"):
        await update(config={"permission_mode": "custom", "access_groups": [{**groups[0], "roleIds": [3]}]})
    await db.rollback()
    assert await grants() == [(1, True), (2, True)]
    inherited = await update(config={"permission_mode": "inherit", "access_groups": groups})
    assert inherited["config"]["permission_mode"] == "inherit"
    assert "access_groups" not in inherited["config"]
    assert await grants() == []


@pytest.mark.asyncio
async def test_application_order_is_tenant_scoped_and_rejects_stale_order(application_db, monkeypatch):
    session, _ = application_db
    session.add_all([
        Application(id=1, tenant_id=1, name="甲", code="first", sort_order=10),
        Application(id=2, tenant_id=1, name="乙", code="second", sort_order=20),
        Application(id=3, tenant_id=2, name="其他租户", code="other", sort_order=30),
    ])
    await session.commit()

    async def query_fixture_database(query):
        return await query(session)

    monkeypatch.setattr(applications, "safe_db_call", query_fixture_database)
    with pytest.raises(HTTPException, match="全部应用"):
        await applications.admin_reorder_applications(
            applications.ApplicationOrderUpdate(expected=[1, 2], order=[2, 3]), ADMIN,
        )
    saved = await applications.admin_reorder_applications(
        applications.ApplicationOrderUpdate(expected=[1, 2], order=[2, 1]), ADMIN,
    )
    assert [(app["id"], app["sort_order"]) for app in saved["data"]] == [(2, 1), (1, 2)]
    assert (await session.get(Application, 3)).sort_order == 30
    with pytest.raises(HTTPException, match="应用顺序已变化"):
        await applications.admin_reorder_applications(
            applications.ApplicationOrderUpdate(expected=[1, 2], order=[2, 1]), ADMIN,
        )


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
