from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import db as db_module
from app.core.application_menu_registry_schema import install_workflow_design_tools
from app.models.relational import (
    AIAgentSkillDefinition, AIAgentToolDefinition, Base, Form, Tenant, WorkflowBinding, WorkflowDef,
)
from app.services import form_versions
from app.services.ai import agent_registry, harness_runtime as runtime, tool_handlers
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
    settings["safetyPolicy"]["maxToolSteps"] = 24
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
