"""Load Agent definitions from the runtime registry seed/cache."""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from typing import Any


AGENT_DIR = Path(__file__).resolve().parents[4] / ".agent"
REGISTRY_SEED_DIR = Path(__file__).resolve().parents[4] / "data" / "agent_registry"
_RUNTIME_SKILL_REGISTRY: dict[str, dict[str, Any]] | None = None
_RUNTIME_TOOL_REGISTRY: dict[str, dict[str, Any]] | None = None
_REQUEST_REGISTRY: ContextVar[dict[str, Any] | None] = ContextVar("request_agent_registry", default=None)


@contextmanager
def use_agent_registry(registry: dict[str, Any]):
    token = _REQUEST_REGISTRY.set(registry)
    try:
        yield
    finally:
        _REQUEST_REGISTRY.reset(token)


def _read_agent_file(name: str) -> str:
    path = AGENT_DIR / name
    if not path.exists():
        path = Path(__file__).with_name("assets") / name
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
    from .low_code_tools import describe_create_form_definition_contract, describe_add_form_field_contract
    contracts = _load_json_block("action-contracts.md")
    for name, native in (("low_code.create_form_definition", describe_create_form_definition_contract()),
                         ("low_code.add_form_field", describe_add_form_field_contract())):
        contracts[name] = {**contracts.get(name, {}), **native}
    return contracts


def load_skill_registry() -> dict[str, dict[str, Any]]:
    registry = _REQUEST_REGISTRY.get()
    if registry is not None:
        return registry["skills"]
    return _legacy_skill_registry()


@lru_cache(maxsize=8)
def _legacy_skill_registry() -> dict[str, dict[str, Any]]:
    if _RUNTIME_SKILL_REGISTRY is not None:
        return dict(_RUNTIME_SKILL_REGISTRY)
    return _load_registry_seed("skills.json")


def load_tool_registry() -> dict[str, dict[str, Any]]:
    registry = _REQUEST_REGISTRY.get()
    if registry is not None:
        return registry["tools"]
    return _legacy_tool_registry()


@lru_cache(maxsize=8)
def _legacy_tool_registry() -> dict[str, dict[str, Any]]:
    if _RUNTIME_TOOL_REGISTRY is not None:
        return dict(_RUNTIME_TOOL_REGISTRY)
    return _load_registry_seed("tools.json")


load_skill_registry.cache_clear = _legacy_skill_registry.cache_clear
load_tool_registry.cache_clear = _legacy_tool_registry.cache_clear


def set_runtime_agent_registry(*, skills: dict[str, dict[str, Any]], tools: dict[str, dict[str, Any]]) -> None:
    global _RUNTIME_SKILL_REGISTRY, _RUNTIME_TOOL_REGISTRY
    _RUNTIME_SKILL_REGISTRY = dict(skills)
    _RUNTIME_TOOL_REGISTRY = dict(tools)
    load_skill_registry.cache_clear()
    load_tool_registry.cache_clear()


def _load_registry_seed(name: str) -> dict[str, dict[str, Any]]:
    path = REGISTRY_SEED_DIR / name
    if not path.exists():
        path = Path(__file__).with_name("assets") / name
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
