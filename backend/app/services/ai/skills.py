"""Enterprise AI skill registry loaded from .agent configuration."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .agent_definition import load_skill_registry


RiskLevel = Literal["low", "medium", "high", "critical"]
CapabilityLevel = Literal["qa", "assisted", "agentic"]


class SkillDefinition(BaseModel):
    name: str
    title: str
    description: str
    capability_level: CapabilityLevel
    risk_level: RiskLevel = "low"
    default_tool: str | None = None
    allowed_tools: list[str] = Field(default_factory=list)
    required_permissions: list[str] = Field(default_factory=list)
    confirmation_policy: Literal["none", "confirm", "confirm_token", "blocked"] = "none"
    permission_capability: str | None = None
    domain: str | None = None
    output_schema: dict[str, Any] = Field(default_factory=dict)


def _load_skills() -> dict[str, SkillDefinition]:
    return {
        name: SkillDefinition(**{**payload, "name": payload.get("name") or name})
        for name, payload in load_skill_registry().items()
    }


def skill_registry() -> dict[str, SkillDefinition]:
    return _load_skills()


def list_skills() -> list[dict[str, Any]]:
    return [definition.model_dump() for definition in skill_registry().values()]


def get_skill(name: str) -> SkillDefinition | None:
    return skill_registry().get(name)
