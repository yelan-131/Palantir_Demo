"""Install application and menu tools into existing tenant registries once."""

import sqlalchemy as sa

from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting

INSTALL_KEY = "ai.builtin_application_menu_tools.v1"
INSTALL_SOURCE = "application_menu_tools_0043"
WORKSPACE_INSTALL_KEY = "ai.builtin_application_workspace_tools.v1"
WORKSPACE_INSTALL_SOURCE = "application_workspace_tools_0048"
WORKSPACE_SKILL = "low_code.manage_application"
WORKFLOW_INSTALL_KEY = "ai.builtin_workflow_design_tools.v1"
WORKFLOW_INSTALL_SOURCE = "workflow_design_tools_0049"


def install_application_menu_tools(connection, *, include_workspace=True):
    from app.services.ai.application_menu_registry import LEGACY_REQUESTS, registry_definitions

    definitions = {name: definition for name, definition in registry_definitions().items() if name in LEGACY_REQUESTS}
    _install_application_tools(connection, definitions, INSTALL_KEY, INSTALL_SOURCE)
    if include_workspace:
        install_application_workspace_tools(connection)


def install_application_workspace_tools(connection):
    from app.services.ai.application_menu_registry import registry_definitions
    from app.services.ai.application_workspace_tools import WORKSPACE_REQUESTS

    definitions = {name: definition for name, definition in registry_definitions().items() if name in WORKSPACE_REQUESTS}
    _install_application_tools(connection, definitions, WORKSPACE_INSTALL_KEY, WORKSPACE_INSTALL_SOURCE, WORKSPACE_SKILL)


def install_workflow_design_tools(connection):
    from app.services.ai.workflow_design_tools import SKILL, registry_definitions

    _install_application_tools(connection, registry_definitions(), WORKFLOW_INSTALL_KEY, WORKFLOW_INSTALL_SOURCE, SKILL,
                               description="Form workflow design AI tools installed")


def _install_application_tools(connection, definitions, install_key, install_source, skill_name=None, *,
                               description="Application and menu AI tools installed"):

    tools = AIAgentToolDefinition.__table__
    skills = AIAgentSkillDefinition.__table__
    settings = SystemSetting.__table__
    if connection.scalar(sa.select(settings.c.id).where(settings.c.key == install_key)) is not None:
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

    existing = set(connection.execute(sa.select(tools.c.tenant_id, tools.c.name).where(tools.c.name.in_(definitions))))
    rows = [
        {
            "tenant_id": owner, "name": name, "handler_key": name,
            "title": definition["title"], "description": definition["description"],
            "definition": {**definition, "created_by": "admin"},
            "enabled": True, "version": 1, "source": install_source,
        }
        for owner in sorted(owners)
        for name, definition in definitions.items()
        if (owner, name) not in existing
    ]
    if rows:
        connection.execute(tools.insert(), rows)
    if skill_name:
        from app.services.ai.agent_definition import _load_registry_seed

        definition = _load_registry_seed("skills.json")[skill_name]
        existing_owners = set(connection.scalars(sa.select(skills.c.tenant_id).where(skills.c.name == skill_name)))
        for owner in sorted(owners - existing_owners):
            registered = set(connection.scalars(sa.select(tools.c.name).where(tools.c.tenant_id == owner)))
            allowed = [name for name in definition["allowed_tools"] if name in registered]
            connection.execute(skills.insert().values(
                tenant_id=owner, name=skill_name, title=definition["title"], description=definition["description"],
                definition={**definition, "allowed_tools": allowed, "created_by": "admin"},
                enabled=True, version=1, source=install_source,
            ))
    connection.execute(settings.insert().values(key=install_key, value={}, description=description))
