"""Add the object relationship skill and tool to a tenant's AI registry."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.db import db_session
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition
from app.services.ai.agent_registry import load_agent_registry, load_seed_registry
from app.services.ai.skill_loader import OBJECT_RELATIONSHIPS_SKILL


TOOL = "graph.query_object_relationships"
PREVIOUS_TOOL = "graph.query_material_candidates"
PREVIOUS_SKILL = "graph.find_material_candidates"
UPGRADE_ACTOR = "relationship-ai-upgrade"


async def main(tenant_id: int, apply: bool):
    current = await load_agent_registry(include_disabled=True, tenant_id=tenant_id)
    skills, tools = load_seed_registry()
    missing = [
        (model, seed[name], extra_fields)
        for kind, model, seed, name, extra_fields in (
            ("tools", AIAgentToolDefinition, tools, TOOL, {"handler_key": TOOL}),
            ("skills", AIAgentSkillDefinition, skills, OBJECT_RELATIONSHIPS_SKILL, {}),
        )
        if name not in current[kind]
    ]
    superseded = []
    for kind, model, name in (
        ("tools", AIAgentToolDefinition, PREVIOUS_TOOL),
        ("skills", AIAgentSkillDefinition, PREVIOUS_SKILL),
    ):
        old = current[kind].get(name)
        if old and old.get("enabled") and old.get("updated_by") == UPGRADE_ACTOR:
            superseded.append((model, name))
    if not missing and not superseded:
        print(f"The relationship skill and tool are already present in tenant {tenant_id}'s {current['source']} registry.")
        return
    names = [definition["name"] for _, definition, _ in missing]
    if not apply:
        print(f"Tenant {tenant_id}: add {names}, retire untouched version-1 definitions from {[name for _, name in superseded]}.")
        return
    retired = []
    async with db_session() as session:
        insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else postgresql_insert
        for model, seed, extra_fields in missing:
            definition = {**seed, "created_by": "admin", "enabled": True}
            statement = insert(model).values(
                tenant_id=tenant_id, name=definition["name"], **extra_fields,
                title=definition["title"], description=definition["description"], definition=definition,
                enabled=True, version=1, source="database", updated_by=UPGRADE_ACTOR,
            ).on_conflict_do_nothing(index_elements=["tenant_id", "name"])
            await session.execute(statement)
        for model, name in superseded:
            result = await session.execute(update(model).where(
                model.tenant_id == tenant_id, model.name == name, model.enabled.is_(True),
                model.version == 1, model.updated_by == UPGRADE_ACTOR,
            ).values(enabled=False, version=model.version + 1))
            if result.rowcount:
                retired.append(name)
        await session.commit()
    print(f"Tenant {tenant_id} relationship registry upgraded. Added {names}, disabled {retired}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", type=int, required=True)
    parser.add_argument("--apply", action="store_true")
    options = parser.parse_args()
    if options.tenant_id <= 0:
        parser.error("--tenant-id must be positive")
    asyncio.run(main(options.tenant_id, options.apply))
