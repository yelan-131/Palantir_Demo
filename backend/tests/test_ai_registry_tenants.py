import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.services.ai.agent_definition import use_agent_registry
from app.services.ai.agent_registry import load_agent_registry


def test_legacy_registry_migrates_ids_and_allows_same_name_per_tenant():
    from app.core.agent_registry_schema import ensure_sqlite_tenant_registry_schema

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        for kind in ("skill", "tool"):
            table = f"ai_agent_{kind}_definitions"
            connection.execute(text(
                f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, name TEXT NOT NULL, definition JSON, "
                f"CONSTRAINT uq_{table}_name UNIQUE (name))"
            ))
            connection.execute(text(f"INSERT INTO {table} VALUES (17, 'sample', '{{}}')"))
        ensure_sqlite_tenant_registry_schema(connection)
        ensure_sqlite_tenant_registry_schema(connection)
        for kind in ("skill", "tool"):
            table = f"ai_agent_{kind}_definitions"
            assert connection.execute(text(f"SELECT id, tenant_id, name, definition FROM {table}")).one() == (
                17, 1, "sample", "{}",
            )
            assert inspect(connection).get_unique_constraints(table)[0]["column_names"] == ["tenant_id", "name"]
            connection.execute(text(f"INSERT INTO {table} (tenant_id, name) VALUES (2, 'sample')"))
            with pytest.raises(IntegrityError):
                connection.execute(text(f"INSERT INTO {table} (tenant_id, name) VALUES (2, 'sample')"))


@pytest.mark.asyncio
async def test_registry_and_dsh_isolate_same_name_imports(monkeypatch, tmp_path):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.ai_assistant import AIAgentRegistryRequest, get_agent_registry, update_agent_registry
    from app.api.ai_harness import router
    from app.database import init_db
    from app.services.ai import harness_runtime
    from app.services.ai.harness_skills import stage_native_skills
    from app.services.ai.settings import merge_ai_settings
    from app.services.ai.skill_import import parse_skill_markdown
    from app.services.ai.skill_loader import SKILL_TOOL

    await init_db()
    settings = merge_ai_settings({"aiEnabled": True, "agentMode": "confirm"})
    monkeypatch.setattr(harness_runtime, "load_persisted_ai_settings", AsyncMock())
    monkeypatch.setattr(harness_runtime, "settings_snapshot", lambda: settings)
    users = [{"tenant_id": tenant, "uid": tenant, "sub": "admin", "is_admin": True} for tenant in (821, 822)]
    name = "tenant-review"
    tool_name = "forms.query_records"
    for index, user in enumerate(users):
        initial = (await get_agent_registry(user))["data"]
        assert initial["source"] == "bundled"
        assert name not in initial["skills"]
        initial["skills"][name] = {
            **parse_skill_markdown(f"---\nname: {name}\ndescription: Review\n---\nTENANT_BODY_{index}"),
            "title": name,
            "capability_level": "qa",
            "enabled": True,
        }
        if index == 0:
            initial["tools"][tool_name]["enabled"] = False
        await update_agent_registry(AIAgentRegistryRequest(**initial), user)

    app = FastAPI()
    app.include_router(router)
    for user in users:
        token = f"test-tenant-{user['tenant_id']}"
        monkeypatch.setitem(harness_runtime.BRIDGES, token, harness_runtime.PlatformBridge(user, settings, {}, native_skills=False))

    async def verify(index, client):
        user = users[index]
        owner = user["tenant_id"]
        headers = {"Authorization": f"Bearer test-tenant-{owner}"}
        response = await client.post("/harness/mcp", headers=headers, json={"id": 1, "method": "tools/list"})
        describe = harness_runtime.tool_alias(harness_runtime.DESCRIBE_TOOL)
        assert describe in {tool["name"] for tool in response.json()["result"]["tools"]}
        response = await client.post("/harness/mcp", headers=headers, json={
            "id": 2, "method": "tools/call", "params": {"name": describe, "arguments": {"name": tool_name}},
        })
        result = json.loads(response.json()["result"]["content"][0]["text"])
        assert result["status"] == ("completed" if index == 1 else "blocked")
        bridge = harness_runtime.BRIDGES[f"test-tenant-{owner}"]
        loaded = await bridge.call_tool(harness_runtime.tool_alias(SKILL_TOOL), {"name": name})
        assert loaded["skill"]["instructions"] == f"TENANT_BODY_{index}"

        root = tmp_path / str(owner)
        root.mkdir()
        registry = await load_agent_registry(tenant_id=owner)
        with use_agent_registry(registry):
            await asyncio.sleep(0)
            stage_native_skills(root, user, settings, {}, allow_form_designer=False)
        assert (root / name / "SKILL.md").read_text(encoding="utf-8").endswith(f"TENANT_BODY_{index}")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await asyncio.gather(verify(0, client), verify(1, client))

    first = (await get_agent_registry(users[0]))["data"]
    first["skills"][name]["enabled"] = False
    await update_agent_registry(AIAgentRegistryRequest(**first), users[0])
    del first["skills"][name]
    await update_agent_registry(AIAgentRegistryRequest(**first), users[0])
    assert name not in (await get_agent_registry(users[0]))["data"]["skills"]
    assert (await get_agent_registry(users[1]))["data"]["skills"][name]["instructions"] == "TENANT_BODY_1"



@pytest.mark.asyncio
async def test_stored_platform_schemas_follow_current_contract_without_resetting_registry():
    from app.database import init_db
    from app.core.db import db_session
    from app.models.relational import AIAgentToolDefinition
    from app.services.ai.agent_registry import AgentRegistryError, load_seed_registry, save_agent_registry_payload
    from sqlalchemy import select

    await init_db()
    tenant_id = 823
    skills, tools = load_seed_registry()
    names = ("pages.create", "pages.save_draft", "applications.create", "menus.create_entry", "ui.component_page.add")
    tools["pages.create"]["title"] = "Tenant page tool"
    tools["pages.save_draft"]["enabled"] = False
    await save_agent_registry_payload({"skills": skills, "tools": tools}, tenant_id=tenant_id, seed_import=True)

    stale_schema = {"type": "object", "properties": {}}
    query = select(AIAgentToolDefinition).where(
        AIAgentToolDefinition.tenant_id == tenant_id, AIAgentToolDefinition.name.in_(names),
    )
    # Simulate registry rows persisted by an earlier backend.
    async with db_session() as session:
        for row in (await session.scalars(query)).all():
            row.definition = {**row.definition, "input_schema": stale_schema}
        await session.commit()

    active = (await load_agent_registry(tenant_id=tenant_id))["tools"]
    admin = await load_agent_registry(tenant_id=tenant_id, include_disabled=True)
    for name in names:
        assert admin["tools"][name]["input_schema"] == tools[name]["input_schema"]
        if name != "pages.save_draft":
            assert active[name]["input_schema"] == tools[name]["input_schema"]
    assert active["pages.create"]["title"] == "Tenant page tool"
    assert admin["tools"]["pages.save_draft"]["enabled"] is False
    assert "pages.save_draft" not in active

    async with db_session() as session:
        assert all(row.definition["input_schema"] == stale_schema for row in (await session.scalars(query)).all())

    admin["tools"]["pages.create"]["input_schema"] = stale_schema
    with pytest.raises(AgentRegistryError, match=r"pages\.create.*input_schema"):
        await save_agent_registry_payload(admin, tenant_id=tenant_id)
