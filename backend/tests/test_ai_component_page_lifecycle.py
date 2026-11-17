from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine, select

from app.core.component_page_registry_schema import PAGE_SKILL, install_component_page_tools
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, Base, ComponentPage, Form
from app.services.ai.component_page_tools import PAGE_REQUESTS


def test_existing_tenant_receives_page_tools_and_skill():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    tools = AIAgentToolDefinition.__table__
    skills = AIAgentSkillDefinition.__table__
    with engine.begin() as db:
        db.execute(skills.insert().values(tenant_id=2, name="existing-skill"))
        install_component_page_tools(db)
        assert set(db.scalars(select(tools.c.name).where(tools.c.tenant_id == 2))) == set(PAGE_REQUESTS)
        assert PAGE_SKILL in set(db.scalars(select(skills.c.name).where(skills.c.tenant_id == 2)))
        db.execute(tools.delete().where(tools.c.name == "pages.create"))
        install_component_page_tools(db)
        assert "pages.create" not in set(db.scalars(select(tools.c.name).where(tools.c.tenant_id == 2)))


@pytest.mark.asyncio
async def test_harness_creates_and_publishes_pages_only_after_confirmation(monkeypatch):
    from uuid import uuid4

    from app.core.db import db_session
    from app.database import init_db
    from app.services.ai import harness_runtime as runtime
    from app.services.ai.agent_definition import use_agent_registry
    from app.services.ai.agent_registry import load_agent_registry
    from app.services.ai.settings import merge_ai_settings
    from app.services.ai.tool_executor import agent_tool_executor

    await init_db()
    user = {"tenant_id": 1, "sub": "page-tool-test", "is_admin": True}
    settings = merge_ai_settings({"aiEnabled": True, "agentMode": "confirm"})
    settings["rolePolicies"] = []
    settings["safetyPolicy"]["maxToolSteps"] = 8
    monkeypatch.setattr(runtime, "load_persisted_ai_settings", AsyncMock())
    monkeypatch.setattr(runtime, "settings_snapshot", lambda: settings)
    bridge = runtime.PlatformBridge(user, settings, {})
    describe = runtime.tool_alias(runtime.DESCRIBE_TOOL)
    invoke = runtime.tool_alias(runtime.INVOKE_TOOL)
    title = "AI page lifecycle " + uuid4().hex[:8]
    async with db_session() as db:
        form = Form(tenant_id=1, code=title.rsplit(" ", 1)[1], name=title, status="published")
        db.add(form)
        await db.flush()
        form_id = form.id
        await db.commit()

    async def call(name, arguments, status):
        assert (await bridge.call_tool(describe, {"name": name}))["status"] == "completed"
        result = await bridge.call_tool(invoke, {"name": name, "arguments": arguments})
        assert result["status"] == status, result
        return result

    async def confirm():
        action = bridge.pending.pop()
        with use_agent_registry(await load_agent_registry(tenant_id=1)):
            response = await agent_tool_executor.execute_confirmed_run(
                {"status": "confirmed", "actions": [action.model_dump()]},
                current_user=user, settings=settings,
                persist_ai_draft=AsyncMock(), update_ai_draft_status=AsyncMock(), audit_ai_event=None,
            )
        assert response["status"] == "completed", response["tool_results"]
        return response["tool_results"][0]["result"]

    before = await call("pages.list", {"query": title}, "completed")
    assert not before["result"]["items"]
    await call("pages.create", {"definition": {
        "title": title, "sourceFormId": form_id,
        "widgets": [
            {"id": "records", "type": "record-list", "title": "新品登记", "showFilters": True},
        ],
    }}, "waiting_confirmation")
    async with db_session() as db:
        assert not await db.scalar(select(ComponentPage.id).where(ComponentPage.draft["title"].as_string() == title))
    page = await confirm()
    assert page["publishedVersion"] == 0
    saved_title = f"{title} updated"
    await call("pages.save_draft", {
        "page_code": page["code"], "expected_revision": page["revision"],
        "definition": {**page["definition"], "title": saved_title},
    }, "waiting_confirmation")
    page = await confirm()
    assert page["definition"]["title"] == saved_title
    args = {"page_code": page["code"], "expected_revision": page["revision"]}
    await call("pages.publish", args, "waiting_confirmation")
    async with db_session() as db:
        assert await db.scalar(select(ComponentPage.published_version).where(ComponentPage.code == page["code"])) == 0
    page = await confirm()
    assert page["publishedVersion"] == 1
    assert page["publishedDefinition"]["sourceFormId"] == form_id
    assert [widget["type"] for widget in page["publishedDefinition"]["widgets"]] == ["record-list"]
    assert page["publishedDefinition"]["widgets"][0]["showFilters"] is True
    await call("pages.publish", args, "validation_failed")
    runtime_result = await call("pages.query", {"page_code": page["code"]}, "completed")
    assert runtime_result["result"]["publishedVersion"] == 1
