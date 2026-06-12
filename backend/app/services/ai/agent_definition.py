"""Load Agent definitions from the runtime registry seed/cache."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


AGENT_DIR = Path(__file__).resolve().parents[4] / ".agent"
REGISTRY_SEED_DIR = Path(__file__).resolve().parents[4] / "data" / "agent_registry"
_RUNTIME_SKILL_REGISTRY: dict[str, dict[str, Any]] | None = None
_RUNTIME_TOOL_REGISTRY: dict[str, dict[str, Any]] | None = None


def _read_agent_file(name: str) -> str:
    path = AGENT_DIR / name
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=8)
def load_agent_markdown(name: str) -> str:
    return _read_agent_file(name)


@lru_cache(maxsize=8)
def load_agent_system_prompt() -> str:
    content = _read_agent_file("agent.md")
    match = re.search(r"## System Prompt\s+(.*?)(?:\n## |\Z)", content, flags=re.S)
    return (match.group(1).strip() if match else content.strip())


@lru_cache(maxsize=8)
def load_action_contracts() -> dict[str, dict[str, Any]]:
    return _load_json_block("action-contracts.md")


@lru_cache(maxsize=8)
def load_skill_registry() -> dict[str, dict[str, Any]]:
    if _RUNTIME_SKILL_REGISTRY is not None:
        return dict(_RUNTIME_SKILL_REGISTRY)
    return _load_registry_seed("skills.json")


@lru_cache(maxsize=8)
def load_tool_registry() -> dict[str, dict[str, Any]]:
    if _RUNTIME_TOOL_REGISTRY is not None:
        return dict(_RUNTIME_TOOL_REGISTRY)
    return _load_registry_seed("tools.json")


def set_runtime_agent_registry(*, skills: dict[str, dict[str, Any]], tools: dict[str, dict[str, Any]]) -> None:
    global _RUNTIME_SKILL_REGISTRY, _RUNTIME_TOOL_REGISTRY
    _RUNTIME_SKILL_REGISTRY = dict(skills)
    _RUNTIME_TOOL_REGISTRY = dict(tools)
    load_skill_registry.cache_clear()
    load_tool_registry.cache_clear()


def _load_registry_seed(name: str) -> dict[str, dict[str, Any]]:
    path = REGISTRY_SEED_DIR / name
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _load_json_block(name: str) -> dict[str, dict[str, Any]]:
    content = _read_agent_file(name)
    match = re.search(r"```json\s*(.*?)\s*```", content, flags=re.S)
    if not match:
        return {}
    data = json.loads(match.group(1))
    return data if isinstance(data, dict) else {}
