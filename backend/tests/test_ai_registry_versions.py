from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, Base, SystemSetting
from app.services.ai import agent_registry


TENANT_ID = 51
SKILL = "example.review"
TOOL = "example.search"


@pytest_asyncio.fixture
async def registry_sessions(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite://")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    tables = [AIAgentSkillDefinition.__table__, AIAgentToolDefinition.__table__, SystemSetting.__table__]
    async with engine.begin() as connection:
        await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=tables))

    @asynccontextmanager
    async def db_session():
        async with factory() as session:
            yield session

    monkeypatch.setattr(agent_registry, "db_session", db_session)
    try:
        yield factory
    finally:
        await engine.dispose()


async def load():
    return await agent_registry.load_agent_registry(tenant_id=TENANT_ID, include_disabled=True)


async def save(registry):
    return await agent_registry.save_agent_registry_payload(registry, tenant_id=TENANT_ID, updated_by="admin")


def versions(registry):
    return registry["skills"][SKILL]["release_version"], registry["tools"][TOOL]["release_version"]


@pytest.mark.asyncio
async def test_release_version_is_controlled_by_item_content_and_explicit_major(registry_sessions):
    registry = await load()
    assert registry["source"] == "bundled"
    assert {item["release_version"] for entries in (registry["skills"], registry["tools"]) for item in entries.values()} == {
        "1.0",
    }
    fake_version = {"version": 82, "release_version": "99.0", "_release_version_revision": 82, "version_bump": "major"}
    registry["skills"][SKILL] = {
        "title": "Review", "description": "Review a document", "capability_level": "qa", **fake_version,
    }
    registry["tools"][TOOL] = {
        "title": "Search", "description": "Search documents", "handler_key": "knowledge.search",
        "permission_check": "rag", **fake_version,
    }
    registry = await save(registry)
    assert versions(registry) == ("1.0", "1.0")
    for item in (registry["skills"][SKILL], registry["tools"][TOOL]):
        assert not ({"version", "version_bump", "_release_version_revision"} & item.keys())

    registry["skills"][SKILL].update(enabled=False, **fake_version)
    registry["tools"][TOOL].update(enabled=False, output_schema={}, risk_level="low", **fake_version)
    registry = await save(registry)
    assert versions(registry) == ("1.0", "1.0")
    assert registry["skills"][SKILL]["enabled"] is False
    assert registry["tools"][TOOL]["enabled"] is False

    registry["skills"][SKILL]["description"] = "Review a submitted document"
    registry["tools"][TOOL]["description"] = "Search readable documents"
    registry = await save(registry)
    assert versions(registry) == ("1.1", "1.1")

    registry["skills"][SKILL].update(title="New review workflow", **fake_version)
    registry["tools"][TOOL].update(title="Document search", release_version="1.0", version=1)
    registry = await save(registry)
    assert versions(registry) == ("2.0", "1.2")
    registry["tools"][TOOL].update(title="New document search", version_bump="major")
    registry = await save(registry)
    assert versions(registry) == ("2.0", "2.0")

    async with registry_sessions() as db:
        skill = await db.scalar(select(AIAgentSkillDefinition).where(AIAgentSkillDefinition.name == SKILL))
        tool = await db.scalar(select(AIAgentToolDefinition).where(AIAgentToolDefinition.name == TOOL))
        assert (skill.version, tool.version) == (3, 4)
        assert skill.definition["release_version"] == tool.definition["release_version"] == "2.0"
        skill.version += 2
        tool.version += 1
        await db.commit()

    registry = await load()
    assert versions(registry) == ("2.2", "2.1")
    assert versions(await save(registry)) == ("2.2", "2.1")
    registry["skills"][SKILL].update(enabled=True, description="Updated review instructions")
    registry["tools"][TOOL].update(enabled=True, description="Updated search instructions")
    assert versions(await save(registry)) == ("2.3", "2.2")


@pytest.mark.asyncio
async def test_legacy_revisions_and_projected_schemas_round_trip_without_bumping(registry_sessions):
    registry = await save(await load())
    skill_name = "low_code.create_form_definition"
    tool_name = "forms.create_form_definition"
    legacy_schema = agent_registry.LEGACY_FORM_TOOL_SCHEMAS[tool_name]
    async with registry_sessions() as db:
        skill = await db.scalar(select(AIAgentSkillDefinition).where(AIAgentSkillDefinition.name == skill_name))
        tool = await db.scalar(select(AIAgentToolDefinition).where(AIAgentToolDefinition.name == tool_name))
        # Simulate existing rows predating the public release version.
        skill.definition = {key: value for key, value in skill.definition.items()
                            if key not in {"release_version", "_release_version_revision"}}
        tool.definition = {key: value for key, value in tool.definition.items()
                           if key not in {"release_version", "_release_version_revision"}}
        tool.definition = {**tool.definition, "input_schema": legacy_schema}
        skill.version = 4
        tool.version = 7
        await db.commit()

    registry = await load()
    assert registry["skills"][skill_name]["release_version"] == "1.3"
    assert registry["tools"][tool_name]["release_version"] == "1.6"
    projected_schema = registry["tools"][tool_name]["input_schema"]
    assert projected_schema != legacy_schema
    saved = await save(registry)
    assert saved["skills"][skill_name]["release_version"] == "1.3"
    assert saved["tools"][tool_name]["release_version"] == "1.6"
    assert saved["tools"][tool_name]["input_schema"] == projected_schema
    assert await load() == saved

    registry["skills"][skill_name]["description"] = "Review a business form draft"
    registry["tools"][tool_name].update(description="Save a draft form", version_bump="major")
    saved = await save(registry)
    assert saved["skills"][skill_name]["release_version"] == "1.4"
    assert saved["tools"][tool_name]["release_version"] == "2.0"


@pytest.mark.asyncio
async def test_stored_three_segment_versions_keep_the_major_and_numeric_anchor(registry_sessions):
    await save(await load())
    skill_name = "low_code.create_form_definition"
    tool_name = "forms.create_form_definition"
    skill_query = select(AIAgentSkillDefinition).where(AIAgentSkillDefinition.name == skill_name)
    tool_query = select(AIAgentToolDefinition).where(AIAgentToolDefinition.name == tool_name)
    async with registry_sessions() as db:
        skill = await db.scalar(skill_query)
        tool = await db.scalar(tool_query)
        skill.version = 8
        tool.version = 9
        skill.definition = {**skill.definition, "release_version": "3.0.5", "_release_version_revision": 6}
        tool.definition = {**tool.definition, "release_version": "5.0.4", "_release_version_revision": 9}
        await db.commit()

    registry = await load()
    assert registry["skills"][skill_name]["release_version"] == "3.7"
    assert registry["tools"][tool_name]["release_version"] == "5.4"
    assert await save(registry) == registry

    registry["skills"][skill_name].update(description="Review a new form draft", version_bump="patch")
    registry["tools"][tool_name].update(description="Save a draft form", version_bump="major")
    saved = await save(registry)
    assert saved["skills"][skill_name]["release_version"] == "3.8"
    assert saved["tools"][tool_name]["release_version"] == "6.0"
    async with registry_sessions() as db:
        skill = await db.scalar(skill_query)
        tool = await db.scalar(tool_query)
        assert skill.version == skill.definition["_release_version_revision"] == 9
        assert tool.version == tool.definition["_release_version_revision"] == 10
        assert skill.definition["release_version"] == "3.8"
        assert tool.definition["release_version"] == "6.0"
