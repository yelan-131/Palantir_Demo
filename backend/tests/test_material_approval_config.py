"""Isolated in-memory SQLite configuration tests; never use development DB."""
import asyncio
import json

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from scripts.configure_material_approval import configure, workflow_config
from app.models.relational import (Base, Application, ApplicationForm, DynamicRecord, Form,
                                  FormField, Role, User, UserRole, WorkflowBinding,
                                  WorkflowDef, WorkflowDefVersion)


async def seed(db):
    db.add_all([
        User(id=1, tenant_id=1, username="admin", hashed_password="test", is_active=True),
        User(id=2, tenant_id=2, username="admin", hashed_password="test", is_active=True),
        Role(id=1, tenant_id=1, name="admin", label="Admin"),
        Role(id=2, tenant_id=2, name="admin", label="Admin"),
        UserRole(tenant_id=1, user_id=1, role_id=1), UserRole(tenant_id=2, user_id=2, role_id=2),
        Application(id=1, tenant_id=1, code="production-dashboard", name="Production"),
        Form(id=63, tenant_id=1, code="material-application", name="Material", storage_mode="dynamic", config={"migration_marker": "alert-material-split-v1"}),
        FormField(tenant_id=1, form_id=63, field_name="status", label="Status", field_type="enum", default_value="待处理", enum_values={"values": ["待处理"]}),
        ApplicationForm(tenant_id=1, application_id=1, form_id=63, allow_create=True, allow_edit=False, allow_delete=False),
        DynamicRecord(id=1, tenant_id=1, form_id=63, data={"status": "已完成", "migration_marker": "alert-material-split-v1"}),
    ])
    await db.commit()


async def isolated(callback):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as db:
            await seed(db)
            await callback(db)
    finally:
        await engine.dispose()


def test_dry_run_readonly_and_tenant_approver():
    async def case(db):
        await db.execute(text("PRAGMA query_only=ON"))
        report = await configure(db, 1, False)
        assert report["approver"] == {"id": 1, "username": "admin"}
        assert report["changes"]["create_workflow"]
        assert not (await db.execute(select(WorkflowDef))).scalars().all()
        assert (await db.get(DynamicRecord, 1)).data["status"] == "已完成"
        assert not db.new and not db.dirty
        with pytest.raises(ValueError, match="active same-tenant"):
            await configure(db, 1, False, 2)
    asyncio.run(isolated(case))


def test_apply_idempotent_and_history_unchanged():
    async def case(db):
        report = await configure(db, 1, True)
        await db.commit()
        second = await configure(db, 1, False)
        assert not any(second["changes"].values())
        assert second["workflow_id"] == report["workflow_id"]
        await configure(db, 1, True)
        await db.commit()
        assert len((await db.execute(select(WorkflowDefVersion))).scalars().all()) == 1
        binding = (await db.execute(select(WorkflowBinding))).scalar_one()
        assert binding.trigger_action == "manual_submit"
        assert (await db.get(DynamicRecord, 1)).data == {"status": "已完成", "migration_marker": "alert-material-split-v1"}
        application = (await db.execute(select(ApplicationForm))).scalar_one()
        assert application.allow_edit and not application.allow_delete
    asyncio.run(isolated(case))


def test_new_version_preserves_published_snapshot():
    async def case(db):
        await configure(db, 1, True)
        await db.commit()
        old = (await db.execute(select(WorkflowDefVersion))).scalar_one()
        old_config = old.config
        definition = (await db.execute(select(WorkflowDef))).scalar_one()
        definition.config = json.dumps({"domainCode": "material-application-approval", "steps": []})
        await db.commit()
        report = await configure(db, 1, True)
        await db.commit()
        assert report["version"] == 2
        assert old.config == old_config
        assert len((await db.execute(select(WorkflowDefVersion))).scalars().all()) == 2
        assert not any((await configure(db, 1, False))["changes"].values())
    asyncio.run(isolated(case))


def test_runtime_steps_compatible():
    from app.api.workflow import _workflow_config_steps
    steps = _workflow_config_steps(workflow_config(99))
    assert steps[1]["type"] == "approval"
    assert steps[1]["assignee_rules"] == [{"type": "user", "value": ["99"]}]


def test_refuse_unexpected_binding_and_inactive_approver():
    async def case(db):
        definition = WorkflowDef(tenant_id=1, name="Other", config="{}", status="published", version=1)
        db.add(definition)
        await db.flush()
        db.add(WorkflowBinding(tenant_id=1, form_id=63, workflow_id=definition.id, trigger_action="submit", enabled=True))
        await db.commit()
        with pytest.raises(ValueError, match="Unexpected enabled"):
            await configure(db, 1, False)
        user = await db.get(User, 1)
        user.is_active = False
        await db.commit()
        with pytest.raises(ValueError, match="active same-tenant"):
            await configure(db, 1, False)
    asyncio.run(isolated(case))


def test_fixed_approver_resolves_to_active_user():
    from app.api.workflow import _resolve_step_approver_ids
    async def case(db):
        step = workflow_config(1)["steps"][1]
        ids = await _resolve_step_approver_ids(db, 1, step, {}, {}, 999, 999)
        assert ids == [1]
        assert (await configure(db, 1, False))["states"] == ["待提交", "待审批", "已通过", "已驳回"]
    asyncio.run(isolated(case))
