import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine, select

from app.core.application_menu_registry_schema import install_application_menu_tools
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, Application, ApplicationMenuNode, Base
from app.services.ai.application_menu_registry import REQUESTS


def test_existing_registries_receive_tools_without_reinstalling_removed_tools():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    table = AIAgentToolDefinition.__table__
    with engine.begin() as db:
        db.execute(AIAgentSkillDefinition.__table__.insert().values(tenant_id=2, name="existing-skill"))
        install_application_menu_tools(db)
        assert set(db.scalars(select(table.c.name).where(table.c.tenant_id == 2))) == set(REQUESTS)
        db.execute(table.delete().where(table.c.name == "menus.reorder"))
        install_application_menu_tools(db)
        assert set(db.scalars(select(table.c.name).where(table.c.tenant_id == 2))) == set(REQUESTS) - {"menus.reorder"}
        assert not db.scalar(select(table.c.id).where(table.c.tenant_id == 1))


@pytest.mark.asyncio
async def test_harness_discovery_and_confirmed_application_menu_writes(monkeypatch):
    from app.core.db import db_session
    from app.database import init_db
    from app.services.ai import harness_runtime as runtime
    from app.services.ai.agent_definition import use_agent_registry
    from app.services.ai.agent_registry import load_agent_registry
    from app.services.ai.settings import merge_ai_settings
    from app.services.ai.tool_executor import agent_tool_executor

    await init_db()
    user = {"tenant_id": 1, "sub": "tool-integration", "is_admin": True}
    settings = merge_ai_settings({"aiEnabled": True, "agentMode": "confirm"})
    settings["rolePolicies"] = []
    monkeypatch.setattr(runtime, "load_persisted_ai_settings", AsyncMock())
    monkeypatch.setattr(runtime, "settings_snapshot", lambda: settings)
    bridge = runtime.PlatformBridge(user, settings, {})
    describe = runtime.tool_alias(runtime.DESCRIBE_TOOL)
    invoke = runtime.tool_alias(runtime.INVOKE_TOOL)
    code = "tool-test-" + uuid.uuid4().hex[:10]

    catalog = await bridge.call_tool(describe, {})
    deletions = {"applications.delete", "menus.delete_entry"}
    names = {tool["name"] for tool in catalog["tools"]}
    assert set(REQUESTS) - deletions <= names
    assert not deletions & names
    settings["forbiddenActions"].remove("delete_data")
    registry = await load_agent_registry(tenant_id=1)
    with use_agent_registry(registry):
        assert deletions <= bridge.tool_definitions().keys()
    regular = runtime.PlatformBridge({**user, "is_admin": False}, settings, {})
    result = await regular.call_tool(describe, {"name": "applications.create"})
    assert result["status"] == "blocked"

    async def prepare(name, arguments):
        definition = await bridge.call_tool(describe, {"name": name})
        assert definition["status"] == "completed"
        output = await bridge.call_tool(invoke, {"name": name, "arguments": arguments})
        assert output["status"] == "waiting_confirmation", output
        assert output["payload"]["_preview"]["target"]
        assert all(not key.endswith("_snapshot") for key in output["payload"])

    async def confirm():
        action = bridge.pending.pop()
        registry = await load_agent_registry(tenant_id=1)
        with use_agent_registry(registry):
            result = await agent_tool_executor.execute_confirmed_run(
                {"status": "confirmed", "actions": [action.model_dump()]}, current_user=user, settings=settings,
                persist_ai_draft=AsyncMock(), update_ai_draft_status=AsyncMock(), audit_ai_event=None,
            )
        assert result["status"] == "completed", result["tool_results"]

    await prepare("applications.create", {"name": "Tool integration", "code": code})
    async with db_session() as db:
        assert not await db.scalar(select(Application.id).where(Application.code == code))
    await confirm()
    async with db_session() as db:
        app_id = await db.scalar(select(Application.id).where(Application.code == code))
        assert app_id

    await prepare("menus.create_group", {"application_id": app_id, "title": "First"})
    async with db_session() as db:
        assert not await db.scalar(select(ApplicationMenuNode.id).where(ApplicationMenuNode.application_id == app_id))
    await confirm()
    await prepare("menus.create_group", {"application_id": app_id, "title": "Second"})
    await confirm()
    async with db_session() as db:
        node_id = await db.scalar(select(ApplicationMenuNode.id).where(
            ApplicationMenuNode.application_id == app_id, ApplicationMenuNode.title == "Second",
        ))
    await prepare("menus.reorder", {"application_id": app_id, "node_id": node_id, "parent_id": None, "position": 1})
    await confirm()
    async with db_session() as db:
        titles = (await db.scalars(select(ApplicationMenuNode.title).where(
            ApplicationMenuNode.application_id == app_id,
        ).order_by(ApplicationMenuNode.sort_order))).all()
        assert titles == ["Second", "First"]
