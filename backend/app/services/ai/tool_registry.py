"""Typed tool registry loaded from .agent configuration."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .agent_definition import load_tool_registry
from .skills import get_skill


RiskLevel = Literal["low", "medium", "high", "critical"]
SideEffect = Literal["read", "draft_write", "record_write", "workflow_action", "external_write", "configuration_write"]


class ToolDefinition(BaseModel):
    name: str
    title: str
    description: str
    handler_key: str | None = None
    side_effect: SideEffect = "read"
    risk_level: RiskLevel = "low"
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    domain: str | None = None
    permission_check: str = "qa"
    dry_run_supported: bool = True
    audit_required: bool = False


def _load_tools() -> dict[str, ToolDefinition]:
    return {
        name: ToolDefinition(**{**payload, "name": payload.get("name") or name})
        for name, payload in load_tool_registry().items()
    }


def tool_registry() -> dict[str, ToolDefinition]:
    return _load_tools()


def list_tools() -> list[dict[str, Any]]:
    return [definition.model_dump() for definition in tool_registry().values()]


def get_tool(name: str) -> ToolDefinition | None:
    return tool_registry().get(name)


def validate_tool_call(skill_name: str, tool_name: str) -> tuple[bool, str]:
    skill = get_skill(skill_name)
    tools = tool_registry()
    if not skill:
        return False, "Skill is not registered"
    if tool_name not in tools:
        return False, "Tool is not registered"
    if tool_name not in skill.allowed_tools:
        return False, "Tool is outside the skill allowlist"
    return True, "Allowed"


def to_openai_function(tool: ToolDefinition) -> dict[str, Any]:
    """Convert internal tool definition to OpenAI function calling format."""
    description = f"{tool.title or tool.name}: {tool.description}"
    if tool.side_effect != "read":
        description += f" (副作用类型: {tool.side_effect}, 风险等级: {tool.risk_level})"

    parameters = _normalize_input_schema(tool.input_schema)
    if tool.name == 'platform.form_settings.query':
        parameters.setdefault('properties', {}).update({
            'form_id': {'type': 'integer', 'description': '精确查询表单及其已发布字段'},
            'form_code': {'type': 'string', 'description': '精确查询表单及其已发布字段'},
        })
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": description,
            "parameters": parameters,
        }
    }


def to_openai_function_brief(tool: ToolDefinition) -> dict[str, Any]:
    """Return a minimal tool definition with only name and short description.

    Used for Tier 1 (deferred) tool loading — gives the LLM enough info
    to decide whether to call a tool without consuming full schema tokens.
    """
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.title or tool.name,
            "parameters": {"type": "object", "properties": {}},
        }
    }


def _normalize_input_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Turn legacy shorthand into valid JSON Schema for MCP and model APIs."""
    def normalize(value):
        if isinstance(value, str):
            if value in {"string", "integer", "number", "boolean", "object", "array", "null"}:
                return {"type": value, **({"items": {}} if value == "array" else {})}
            if "|" in value:
                return {"type": "string", "enum": value.split("|")}
            return {"type": "string", "description": value}
        if not isinstance(value, dict):
            raise ValueError("工具参数必须使用 JSON Schema 或类型名称")
        result = dict(value)
        if "properties" in result:
            result["properties"] = {key: normalize(item) for key, item in result["properties"].items()}
        if "items" in result:
            result["items"] = normalize(result["items"])
        return result
    if schema.get("type") == "object":
        return normalize(schema)
    return {"type": "object", "properties": {key: normalize(value) for key, value in schema.items() if key != "required"}, "required": schema.get("required", [])}


def openai_tools_for_user(
    user: dict[str, Any],
    settings: dict[str, Any],
    surface: str | None = None,
) -> list[dict[str, Any]]:
    """Return OpenAI-format tool definitions filtered by user permissions."""
    from .policies import decide_tool_permission
    tools = tool_registry()
    result = []
    for tool_def in tools.values():
        capability = tool_def.permission_check or "qa"
        decision = decide_tool_permission(user, settings, tool_def.name)
        if decision.allowed:
            result.append(to_openai_function(tool_def))
    return result


def openai_tools_brief_for_user(
    user: dict[str, Any],
    settings: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return brief (Tier 1) tool definitions filtered by user permissions."""
    from .policies import decide_tool_permission
    tools = tool_registry()
    result = []
    for tool_def in tools.values():
        capability = tool_def.permission_check or "qa"
        decision = decide_tool_permission(user, settings, tool_def.name)
        if decision.allowed:
            result.append(to_openai_function_brief(tool_def))
    return result
