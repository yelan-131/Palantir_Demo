import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine, select

from app.core.application_menu_registry_schema import (
    WORKSPACE_SKILL, install_application_menu_tools, install_application_workspace_tools,
)
from app.models.relational import (
    AIAgentSkillDefinition, AIAgentToolDefinition, Application, ApplicationMenuNode, Base, Role, RolePermission,
)
from app.services.ai.application_menu_registry import LEGACY_REQUESTS, REQUESTS


def test_existing_registries_receive_tools_without_reinstalling_removed_tools():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    table = AIAgentToolDefinition.__table__
    with engine.begin() as db:
        db.execute(AIAgentSkillDefinition.__table__.insert().values(tenant_id=2, name="existing-skill"))
        install_application_menu_tools(db, include_workspace=False)
        assert set(db.scalars(select(table.c.name).where(table.c.tenant_id == 2))) == set(LEGACY_REQUESTS)
        db.execute(table.delete().where(table.c.name == "menus.reorder"))
        install_application_menu_tools(db)
        assert set(db.scalars(select(table.c.name).where(table.c.tenant_id == 2))) == set(REQUESTS) - {"menus.reorder"}
        skills = AIAgentSkillDefinition.__table__
        skill = db.scalar(select(skills.c.definition).where(skills.c.tenant_id == 2, skills.c.name == WORKSPACE_SKILL))
        assert skill["domain"] == "low-code"
        assert "menus.copy" in skill["allowed_tools"]
        assert "menus.reorder" not in skill["allowed_tools"]
        db.execute(table.delete().where(table.c.name == "menus.copy"))
        install_application_workspace_tools(db)
        assert not db.scalar(select(table.c.id).where(table.c.name == "menus.copy"))
        assert not db.scalar(select(table.c.id).where(table.c.tenant_id == 1))


@pytest.mark.asyncio
async def test_harness_discovery_and_confirmed_application_menu_writes(monkeypatch):
    from app.core.db import db_session
    from app.database import init_db
    from app.services.ai import harness_runtime as runtime
    from app.services.ai.agent_definition import use_agent_registry
    from app.services.ai.agent_registry import load_agent_registry
    from app.services.ai.settings import merge_ai_settings
    from app.services.ai.skill_loader import read_business_skill
    from app.services.ai.tool_executor import agent_tool_executor

    await init_db()
    user = {"tenant_id": 1, "sub": "tool-integration", "is_admin": True}
    settings = merge_ai_settings({"aiEnabled": True, "agentMode": "confirm"})
    settings["rolePolicies"] = []
    settings["domains"] = ["low-code"]
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
        skill = read_business_skill(WORKSPACE_SKILL, user=user, settings=settings, context={})
        assert skill["status"] == "completed"
        assert "menus.copy" in skill["skill"]["instructions"]
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

    async def read(name, arguments):
        definition = await bridge.call_tool(describe, {"name": name})
        assert definition["status"] == "completed"
        output = await bridge.call_tool(invoke, {"name": name, "arguments": arguments})
        assert output["status"] == "completed", output
        return output["result"]

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

    await prepare("applications.update", {"application_id": app_id, "access_groups": [
        {"id": "app-group", "name": "App reviewers", "roleIds": []},
    ]})
    await confirm()
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

    await prepare("menus.update_properties", {
        "application_id": app_id, "node_id": node_id, "description": "Copied group",
        "permission_mode": "custom", "access_groups": [{"id": "group-1", "name": "Reviewers", "roleIds": []}],
    })
    await confirm()
    role_name = "test_reviewer_" + uuid.uuid4().hex[:10]
    await prepare("menus.update_properties", {
        "application_id": app_id, "node_id": node_id,
        "add_access_group": {"id": "group-2", "name": "Second reviewers", "roleIds": []},
        "new_role": {"name": role_name, "label": "Second reviewer"},
    })
    async with db_session() as db:
        assert not await db.scalar(select(Role.id).where(Role.name == role_name))
    await confirm()
    async with db_session() as db:
        role_id = await db.scalar(select(Role.id).where(Role.name == role_name, Role.tenant_id == 1))
        assert role_id
        grant = await db.scalar(select(RolePermission).where(
            RolePermission.resource_key == f"menu_node:{node_id}", RolePermission.role_id == role_id,
        ))
        assert grant.enabled and grant.effect == "allow"
    await prepare("applications.update", {"application_id": app_id, "add_access_group":
        {"id": "app-group-2", "name": "Second app reviewers", "roleIds": [role_id]},
    })
    await confirm()
    await prepare("menus.create_page_draft", {"application_id": app_id, "parent_id": node_id, "title": "Child"})
    await confirm()
    inspected = await read("applications.inspect", {"application_id": app_id})
    app_groups = inspected["application"]["access_groups"]
    assert [group["name"] for group in app_groups] == ["App reviewers", "Second app reviewers"]
    assert app_groups[1]["roleIds"] == [role_id]
    group = next(node for node in inspected["menu_nodes"] if node["id"] == node_id)
    menu_groups = group["config"]["access_groups"]
    assert [group["name"] for group in menu_groups] == ["Reviewers", "Second reviewers"]
    assert menu_groups[1]["roleIds"] == [role_id]
    child = next(node for node in inspected["menu_nodes"] if node["parent_id"] == node_id)
    assert child["title"] == "Child"

    target_code = code + "-target"
    await prepare("applications.create", {"name": "Copy destination", "code": target_code})
    await confirm()
    async with db_session() as db:
        target_id = await db.scalar(select(Application.id).where(Application.code == target_code))
    await prepare("menus.copy", {"application_id": target_id, "source_application_id": app_id, "node_ids": [node_id]})
    await confirm()
    copied = (await read("applications.inspect", {"application_id": target_id}))["menu_nodes"]
    copied_group = next(node for node in copied if node["title"] == "Second")
    copied_child = next(node for node in copied if node["parent_id"] == copied_group["id"])
    assert copied_child["title"] == "Child"

    await prepare("applications.save_template", {"application_id": app_id})
    await confirm()
    templates = await read("applications.list_templates", {})
    template = next(item for item in templates["items"] if item["name"] == "Tool integration")
    await prepare("applications.instantiate_template", {"template_id": template["id"]})
    await confirm()

    await prepare("applications.reorder", {"application_id": target_id, "position": 1})
    await confirm()
    async with db_session() as db:
        assert await db.scalar(select(Application.id).where(Application.tenant_id == 1)
                               .order_by(Application.sort_order, Application.id).limit(1)) == target_id

    await prepare("applications.copy_draft", {"application_id": app_id})
    await confirm()
    async with db_session() as db:
        app_copy = await db.scalar(select(Application).where(Application.name == "Tool integration 副本"))
        assert app_copy.status == "draft"
        assert not await db.scalar(select(ApplicationMenuNode.id).where(ApplicationMenuNode.application_id == app_copy.id))
