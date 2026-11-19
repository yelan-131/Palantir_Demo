from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import db as db_module
from app.core.application_menu_registry_schema import install_workflow_design_tools
from app.models.relational import (
    AIAgentSkillDefinition, AIAgentToolDefinition, Base, ComponentPage, Form, FormField, Role, Tenant, User, UserRole,
    WorkflowBinding, WorkflowDef,
)
from app.services import form_versions
from app.services.ai import agent_registry, harness_runtime as runtime, tool_handlers, workbench_preview
from app.services.ai.agent_definition import use_agent_registry
from app.services.ai.agent_registry import load_seed_registry
from app.services.ai.settings import merge_ai_settings
from app.services.ai.skill_loader import read_business_skill
from app.services.ai.tool_executor import agent_tool_executor
from app.services.ai.workflow_design_tools import GET, PUBLISH, SAVE, SKILL, VALIDATE, execute_workflow_design_tool

ADMIN = {"tenant_id": 1, "sub": "workflow-design-test", "is_admin": True}


def design():
    return {
        "name": "异常台账流程",
        "nodes": [
            {"id": "start", "type": "startEvent", "label": "提交", "x": 120, "y": 140},
            {"id": "cc", "type": "ccTask", "label": "抄送", "x": 120, "y": 260,
             "ccRecipients": [{"id": "cc-role", "type": "role", "value": "质量人员"}]},
            {"id": "end", "type": "endEvent", "label": "归档", "x": 120, "y": 380},
        ],
        "edges": [
            {"id": "submitted", "source": "start", "target": "cc", "waypoints": [{"x": 240, "y": 200}]},
            {"id": "cc-done", "source": "cc", "target": "end"},
        ],
        "triggerBindings": [{"action": "submit", "label": "提交表单", "enabled": True, "startNodeId": "start"}],
        "annotations": [{"id": "group", "title": "抄送与归档", "nodeIds": ["cc", "end"],
                         "color": "#527d9b", "size": {"width": 260, "height": 260},
                         "titleStyle": {"underline": True}, "frameStyle": {"borderStyle": "dashed"}}],
    }


@pytest.mark.asyncio
async def test_workflow_tools_reject_unresolvable_approval_groups():
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add_all([
                Tenant(id=1, name="Test", slug="test"),
                Form(id=10, tenant_id=1, name="异常台账", code="issues", storage_mode="dynamic", status="draft"),
                Role(id=20, tenant_id=1, name="review", label="审批组"),
                User(id=30, tenant_id=1, username="reviewer", hashed_password="test", is_active=True),
                UserRole(tenant_id=1, user_id=30, role_id=20),
            ])
            await db.commit()
            config = design()
            stage = config["nodes"][1]
            stage.pop("ccRecipients")
            stage.update(type="userTask", label="审批", assigneeRules=[
                {"id": "review", "type": "role", "value": "流程审批人", "approvalMode": "single"},
                {"id": "dynamic", "type": "field", "value": "reviewer"},
            ])
            payload = {"form_id": 10, "design": config}

            async def run(tool, arguments, **kwargs):
                return await execute_workflow_design_tool(tool, db, user=ADMIN, payload=arguments, **kwargs)

            result = (await run(VALIDATE, payload))["data"]
            assert result == {"valid": False, "issues": ["审批节点「审批」的第 1 个处理对象「流程审批人」没有有效审批人"]}
            with pytest.raises(HTTPException, match="没有有效审批人"):
                await run(SAVE, {**payload, "expected_definition": None}, prepare=True)

            stage["assigneeRules"][0]["value"] = "审批组"
            assert (await run(VALIDATE, payload))["data"]["valid"] is True
            pending = await run(SAVE, {**payload, "expected_definition": None}, prepare=True)
            saved = (await run(SAVE, pending))["data"]

            reviewer = await db.get(User, 30)
            reviewer.is_active = False
            await db.commit()
            with pytest.raises(HTTPException, match="没有有效审批人"):
                await run(PUBLISH, {"form_id": 10, "expected_definition": saved["revision"]}, prepare=True)
            assert await db.scalar(select(WorkflowBinding.id)) is None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_workbench_previews_follow_staged_tools_without_saving(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as db:
        await db.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "db_session", factory)
    monkeypatch.setattr(workbench_preview, "db_session", factory)
    monkeypatch.setattr(runtime, "load_persisted_ai_settings", AsyncMock())
    settings = merge_ai_settings({"aiEnabled": True, "agentMode": "confirm"})
    settings.update(rolePolicies=[], domains=["low-code"])
    monkeypatch.setattr(runtime, "settings_snapshot", lambda: settings)
    events = AsyncMock()
    bridge = runtime.PlatformBridge(ADMIN, settings, {"pageControlsSupported": True, "followDesignTools": True}, event_sink=events)
    skills, tools = load_seed_registry()
    try:
        async with factory() as db:
            db.add(Tenant(id=1, name="Test", slug="test"))
            db.add(Form(id=10, tenant_id=1, name="异常台账", code="issues", storage_mode="dynamic", status="draft",
                        config={"formDesignerControls": []}))
            db.add(FormField(tenant_id=1, form_id=10, field_name="title", label="标题", field_type="string"))
            await db.commit()

        async def stage(tool, arguments):
            result = await bridge._call_platform_tool(runtime.tool_alias(tool), arguments)
            assert result["status"] == "waiting_confirmation", result

        with use_agent_registry({"skills": skills, "tools": tools}):
            for name, label in (("note", "补充说明"), ("batch", "批次")):
                await stage("forms.add_form_field", {"form_id": 10, "fields": [
                    {"field_name": name, "label": label, "field_type": "string"},
                ]})
            await stage("pages.create", {"definition": {"title": "异常工作台"}})
            await stage(SAVE, {"form_id": 10, "design": design(), "expected_definition": None})

        previews = [call.args[1] for call in events.await_args_list if call.args[0] == "ui.design_preview"]
        assert [preview["kind"] for preview in previews] == ["form", "form", "page", "workflow"]
        assert [field["name"] for field in previews[1]["fields"]] == ["title", "note", "batch"]
        assert previews[-1]["design"]["nodes"][1]["label"] == "抄送"
        assert [action.skill for action in bridge.pending] == ["forms.add_form_field", "pages.create", SAVE]
        assert all(action.requires_confirmation for action in bridge.pending)
        descriptors = {item["id"]: item["payload"] for item in bridge.items if item["id"].startswith("workbench-preview-")}
        assert [descriptors[f"workbench-preview-{index}"]["kind"] for index in range(3)] == ["form", "page", "workflow"]
        assert "definition" not in descriptors["workbench-preview-1"]
        assert "design" not in descriptors["workbench-preview-2"]
        async with factory() as db:
            assert list(await db.scalars(select(FormField.field_name))) == ["title"]
            assert await db.scalar(select(ComponentPage.id)) is None
            assert await db.scalar(select(WorkflowDef.id)) is None
    finally:
        await engine.dispose()


def test_existing_tenant_registry_installs_workflow_tools_idempotently():
    engine = create_engine("sqlite://")
    with engine.begin() as db:
        Base.metadata.create_all(db)
        tools = AIAgentToolDefinition.__table__
        skills = AIAgentSkillDefinition.__table__
        _default_skills, definitions = load_seed_registry()
        original = definitions[GET]
        db.execute(tools.insert().values(tenant_id=2, name=GET, title=original["title"],
                                         definition=original, handler_key=GET, enabled=False, version=7, source="custom"))
        install_workflow_design_tools(db)
        install_workflow_design_tools(db)
        assert set(db.scalars(select(tools.c.name).where(tools.c.tenant_id == 2))) == {GET, VALIDATE, SAVE, PUBLISH}
        assert db.scalar(select(tools.c.version).where(tools.c.name == GET)) == 7
        assert db.scalar(select(tools.c.enabled).where(tools.c.name == GET)) is False
        assert set(db.scalar(select(skills.c.definition).where(skills.c.name == SKILL))["allowed_tools"]) == {
            GET, VALIDATE, SAVE, PUBLISH,
        }
    engine.dispose()


@pytest.mark.asyncio
async def test_workflow_skill_reads_validates_saves_and_publishes_through_confirmation(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as db:
        await db.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "db_session", factory)
    monkeypatch.setattr(agent_registry, "db_session", factory)
    monkeypatch.setattr(tool_handlers, "db_session", factory)
    monkeypatch.setattr(form_versions, "write_audit_log", AsyncMock())
    settings = merge_ai_settings({"aiEnabled": True, "agentMode": "confirm"})
    settings.update(rolePolicies=[], domains=["low-code"])
    monkeypatch.setattr(runtime, "load_persisted_ai_settings", AsyncMock())
    monkeypatch.setattr(runtime, "settings_snapshot", lambda: settings)
    bridge = runtime.PlatformBridge(ADMIN, settings, {}, native_skills=False)
    skills, tools = load_seed_registry()

    async def call(name, arguments):
        described = await bridge.call_tool(runtime.tool_alias(runtime.DESCRIBE_TOOL), {"name": name})
        assert described["status"] == "completed", described
        return await bridge.call_tool(runtime.tool_alias(runtime.INVOKE_TOOL), {"name": name, "arguments": arguments})

    async def confirm():
        result = await agent_tool_executor.execute_confirmed_run(
            {"status": "confirmed", "actions": [bridge.pending.pop().model_dump()]}, current_user=ADMIN, settings=settings,
            persist_ai_draft=AsyncMock(), update_ai_draft_status=AsyncMock(), audit_ai_event=None,
        )
        assert result["status"] == "completed", result["tool_results"]

    try:
        async with factory() as db:
            db.add(Tenant(id=1, name="Test", slug="test"))
            db.add(Form(id=10, tenant_id=1, name="异常台账", code="issues", storage_mode="dynamic", status="draft",
                        config={"formDesignerControls": []}))
            await db.commit()

        target = {"form_id": 10}
        config = design()
        save_args = {**target, "design": config, "expected_definition": None}
        with use_agent_registry({"skills": skills, "tools": tools}):
            skill = read_business_skill(SKILL, user=ADMIN, settings=settings, context={})
            assert skill["status"] == "completed" and PUBLISH in skill["skill"]["instructions"]
            assert (await call(GET, target))["result"]["data"]["revision"] is None

            invalid = deepcopy(config)
            invalid["nodes"][1].pop("ccRecipients")
            assert (await call(VALIDATE, {**target, "design": invalid}))["result"]["data"]["valid"] is False
            invalid = deepcopy(config)
            invalid["triggerBindings"][0]["startNodeId"] = "cc"
            assert (await call(VALIDATE, {**target, "design": invalid}))["result"]["data"]["valid"] is False
            assert (await call(VALIDATE, {**target, "design": config}))["result"]["data"]["valid"] is True

            assert (await call(SAVE, save_args))["status"] == "waiting_confirmation"
            async with factory() as db:
                assert await db.scalar(select(WorkflowDef.id)) is None
                assert await db.scalar(select(WorkflowBinding.id)) is None
                with pytest.raises(HTTPException, match="重新确认"):
                    await execute_workflow_design_tool(SAVE, db, user=ADMIN, payload=save_args)
            await confirm()

            saved = (await call(GET, target))["result"]["data"]
            assert saved["design"]["annotations"] == config["annotations"]
            assert saved["design"]["edges"] == config["edges"]
            assert saved["status"] == "draft"
            assert (await call(SAVE, save_args))["status"] == "validation_failed"
            revision = saved["revision"]
            config["annotations"][0]["title"] = "质量抄送"
            assert (await call(SAVE, {**target, "design": config, "expected_definition": revision}))["status"] == "waiting_confirmation"
            await confirm()
            revised = (await call(GET, target))["result"]["data"]
            assert revised["revision"] == {**revision, "version": revision["version"] + 1}
            assert revised["design"]["annotations"] == config["annotations"]
            assert (await call(PUBLISH, {**target, "expected_definition": revision}))["status"] == "validation_failed"
            assert (await call(PUBLISH, {**target, "expected_definition": revised["revision"]}))["status"] == "waiting_confirmation"
            async with factory() as db:
                assert await db.scalar(select(WorkflowBinding.id)) is None
            await confirm()
            async with factory() as db:
                binding = await db.scalar(select(WorkflowBinding))
                assert binding.workflow_id == saved["revision"]["id"]
                assert binding.enabled and binding.trigger_action == "submit"
                assert (await db.get(WorkflowDef, binding.workflow_id)).status == "published"
                with pytest.raises(HTTPException) as blocked:
                    await execute_workflow_design_tool(GET, db, user={**ADMIN, "tenant_id": 2}, payload=target)
                assert blocked.value.status_code == 404
    finally:
        await engine.dispose()
