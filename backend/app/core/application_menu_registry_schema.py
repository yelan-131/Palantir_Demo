"""Install application and menu tools into existing tenant registries once."""

import sqlalchemy as sa

from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting

INSTALL_KEY = "ai.builtin_application_menu_tools.v1"
INSTALL_SOURCE = "application_menu_tools_0043"


def install_application_menu_tools(connection):
    from app.services.ai.application_menu_registry import registry_definitions

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
    existing = set(connection.execute(sa.select(tools.c.tenant_id, tools.c.name).where(tools.c.name.in_(definitions))))
    rows = [
        {
            "tenant_id": owner, "name": name, "handler_key": name,
            "title": definition["title"], "description": definition["description"],
            "definition": {**definition, "created_by": "admin"},
            "enabled": True, "version": 1, "source": INSTALL_SOURCE,
        }
        for owner in sorted(owners)
        for name, definition in definitions.items()
        if (owner, name) not in existing
    ]
    if rows:
        connection.execute(tools.insert(), rows)
    connection.execute(settings.insert().values(key=INSTALL_KEY, value={}, description="Application and menu AI tools installed"))
