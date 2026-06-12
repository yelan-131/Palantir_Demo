"""Database-backed Agent skill/tool registry."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting

from .agent_definition import _load_registry_seed, set_runtime_agent_registry
from .skills import SkillDefinition
from .tool_handlers import list_tool_handler_keys
from .tool_registry import ToolDefinition


AGENT_REGISTRY_SETTINGS_KEY = "ai.agent_registry"


class AgentRegistryError(ValueError):
    """Raised when registry definitions are missing or invalid."""


def _as_name_map(value: Any, *, kind: str) -> dict[str, dict[str, Any]]:
    if isinstance(value, dict):
        items = value.items()
    elif isinstance(value, list):
        items = ((str(item.get("name") or ""), item) for item in value if isinstance(item, dict))
    else:
        raise AgentRegistryError(f"{kind} registry must be an object or array")
    result: dict[str, dict[str, Any]] = {}
    for name, payload in items:
        if not isinstance(payload, dict):
            raise AgentRegistryError(f"{kind} registry item {name!r} must be an object")
        item_name = str(payload.get("name") or name).strip()
        if not item_name:
            raise AgentRegistryError(f"{kind} registry contains an item without name")
        result[item_name] = {**payload, "name": item_name}
    return result


def validate_registry_payload(skills: Any, tools: Any) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    skill_map = _as_name_map(skills, kind="skill")
    tool_map = _as_name_map(tools, kind="tool")
    allowed_handlers = set(list_tool_handler_keys())

    for name, payload in tool_map.items():
        handler_key = str(payload.get("handler_key") or payload.get("handlerKey") or name)
        payload["handler_key"] = handler_key
        if handler_key not in allowed_handlers:
            raise AgentRegistryError(f"Tool {name} references unregistered handler_key {handler_key!r}")
        ToolDefinition(**payload)

    for name, payload in skill_map.items():
        if payload.get("default_tool") and payload["default_tool"] not in tool_map:
            raise AgentRegistryError(f"Skill {name} references unknown default_tool {payload['default_tool']!r}")
        for tool_name in payload.get("allowed_tools") or []:
            if tool_name not in tool_map:
                raise AgentRegistryError(f"Skill {name} allowlists unknown tool {tool_name!r}")
        SkillDefinition(**payload)

    return skill_map, tool_map


def load_seed_registry() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    skills = _load_registry_seed("skills.json")
    tools = _load_registry_seed("tools.json")
    if not skills or not tools:
        raise AgentRegistryError("Agent registry seed is missing. Run the Agent registry seed before starting Runtime.")
    return validate_registry_payload(skills, tools)


async def seed_agent_registry_from_files(*, updated_by: str | None = None) -> dict[str, Any]:
    skills, tools = load_seed_registry()
    return await save_agent_registry_payload({"skills": skills, "tools": tools}, updated_by=updated_by or "seed")


async def load_agent_registry(*, seed_if_empty: bool = False) -> dict[str, Any]:
    async with db_session() as session:
        skill_rows = (await session.execute(select(AIAgentSkillDefinition).order_by(AIAgentSkillDefinition.name))).scalars().all()
        tool_rows = (await session.execute(select(AIAgentToolDefinition).order_by(AIAgentToolDefinition.name))).scalars().all()

    if not skill_rows and not tool_rows:
        detail = "Agent registry is empty. Seed it explicitly before starting Runtime."
        if seed_if_empty:
            detail = "Automatic Agent registry seed is disabled. Use the explicit registry seed endpoint or seed command."
        raise AgentRegistryError(detail)

    skills = {
        row.name: {**(row.definition or {}), "name": row.name}
        for row in skill_rows
        if row.enabled
    }
    tools = {
        row.name: {**(row.definition or {}), "name": row.name, "handler_key": row.handler_key}
        for row in tool_rows
        if row.enabled
    }
    skills, tools = validate_registry_payload(skills, tools)
    set_runtime_agent_registry(skills=skills, tools=tools)
    return {"skills": skills, "tools": tools, "source": "database", "handlerKeys": list_tool_handler_keys()}


async def save_agent_registry_payload(payload: dict[str, Any], *, updated_by: str | None = None) -> dict[str, Any]:
    skills, tools = validate_registry_payload(payload.get("skills"), payload.get("tools"))
    async with db_session() as session:
        skill_rows = {
            row.name: row
            for row in (await session.execute(select(AIAgentSkillDefinition))).scalars().all()
        }
        tool_rows = {
            row.name: row
            for row in (await session.execute(select(AIAgentToolDefinition))).scalars().all()
        }

        for name, definition in skills.items():
            row = skill_rows.get(name)
            if row is None:
                row = AIAgentSkillDefinition(name=name)
                session.add(row)
            row.title = str(definition.get("title") or name)
            row.description = str(definition.get("description") or "")
            row.definition = definition
            row.enabled = bool(definition.get("enabled", True))
            row.version = int(definition.get("version") or (row.version or 1))
            row.source = "database"
            row.updated_by = updated_by

        for name, definition in tools.items():
            row = tool_rows.get(name)
            if row is None:
                row = AIAgentToolDefinition(name=name)
                session.add(row)
            row.title = str(definition.get("title") or name)
            row.description = str(definition.get("description") or "")
            row.handler_key = str(definition.get("handler_key") or "not_implemented")
            row.definition = definition
            row.enabled = bool(definition.get("enabled", True))
            row.version = int(definition.get("version") or (row.version or 1))
            row.source = "database"
            row.updated_by = updated_by

        await _save_registry_settings(session, updated_by=updated_by, source="database")
        await session.commit()

    set_runtime_agent_registry(skills=skills, tools=tools)
    return {"skills": skills, "tools": tools, "source": "database", "handlerKeys": list_tool_handler_keys()}


async def _save_registry_settings(session, *, updated_by: str | None, source: str) -> None:
    record = await session.scalar(select(SystemSetting).where(SystemSetting.key == AGENT_REGISTRY_SETTINGS_KEY))
    value = {
        "source": source,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "immediateActivation": True,
    }
    if record is None:
        record = SystemSetting(
            key=AGENT_REGISTRY_SETTINGS_KEY,
            value=value,
            description="AI Agent registry activation metadata",
            updated_by=updated_by,
        )
        session.add(record)
    else:
        record.value = value
        record.updated_by = updated_by
