"""Install the page lifecycle tools in existing tenant AI registries."""

import sqlalchemy as sa

from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting

INSTALL_KEY = "ai.builtin_component_page_tools.v1"
INSTALL_SOURCE = "component_page_tools_0044"
PAGE_SKILL = "low_code.manage_component_page"


def install_component_page_tools(connection):
    from app.services.ai.agent_definition import _load_registry_seed
    from app.services.ai.component_page_tools import registry_definitions
    from app.services.ai.page_skill_registry import refresh_component_page_skill_metadata

    tools = AIAgentToolDefinition.__table__
    skills = AIAgentSkillDefinition.__table__
    settings = SystemSetting.__table__
    if connection.scalar(sa.select(settings.c.id).where(settings.c.key == INSTALL_KEY)) is not None:
        return

    owners = set(connection.scalars(sa.select(tools.c.tenant_id).union(sa.select(skills.c.tenant_id))))
    for key in connection.scalars(sa.select(settings.c.key).where(
        sa.or_(settings.c.key == "ai.agent_registry", settings.c.key.like("ai.agent_registry:%"))
    )):
        suffix = key.rpartition(":")[2]
        if key == "ai.agent_registry":
            owners.add(1)
        elif suffix.isascii() and suffix.isdecimal():
            owners.add(int(suffix))

    definitions = registry_definitions()
    existing_tools = set(connection.execute(sa.select(tools.c.tenant_id, tools.c.name).where(tools.c.name.in_(definitions))))
    tool_rows = [
        {
            "tenant_id": owner, "name": name, "handler_key": name,
            "title": definition["title"], "description": definition["description"],
            "definition": {**definition, "created_by": "admin"},
            "enabled": True, "version": 1, "source": INSTALL_SOURCE,
        }
        for owner in sorted(owners)
        for name, definition in definitions.items()
        if (owner, name) not in existing_tools
    ]
    if tool_rows:
        connection.execute(tools.insert(), tool_rows)

    definition = _load_registry_seed("skills.json")[PAGE_SKILL]
    existing_skills = set(connection.scalars(sa.select(skills.c.tenant_id).where(skills.c.name == PAGE_SKILL)))
    skill_rows = [
        {
            "tenant_id": owner, "name": PAGE_SKILL,
            "title": definition["title"], "description": definition["description"],
            "definition": {**definition, "created_by": "admin"},
            "enabled": True, "version": 1, "source": INSTALL_SOURCE,
        }
        for owner in sorted(owners - existing_skills)
    ]
    if skill_rows:
        connection.execute(skills.insert(), skill_rows)
    refresh_component_page_skill_metadata(connection)
    connection.execute(settings.insert().values(key=INSTALL_KEY, value={}, description="Component page AI tools installed"))
