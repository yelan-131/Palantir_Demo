"""Two-tier tool loading system for deferred schema loading.

Tier 1: Tool names + brief descriptions only (minimal token cost).
Tier 2: Full OpenAI function schemas loaded on demand.

Inspired by Claude Code's Tool Search mechanism.
"""
from __future__ import annotations

from typing import Any


class ToolLoader:
    """Manages two-tier tool loading for the agent runtime."""

    def __init__(self, user: dict[str, Any], settings: dict[str, Any]):
        self._user = user
        self._settings = settings
        self._loaded_tools: set[str] = set()

    def list_available_tools(self) -> list[dict[str, Any]]:
        """Return Tier 1: brief tool descriptions filtered by user permissions."""
        from .tool_registry import openai_tools_brief_for_user
        return openai_tools_brief_for_user(self._user, self._settings)

    def list_full_tools(self) -> list[dict[str, Any]]:
        """Return all tools with full schemas (the existing behavior)."""
        from .tool_registry import openai_tools_for_user
        return openai_tools_for_user(self._user, self._settings, surface=None)

    def get_full_schema(self, tool_name: str) -> dict[str, Any] | None:
        """Return the full schema for a specific tool (Tier 2 load on demand)."""
        from .tool_registry import get_tool, to_openai_function
        tool_def = get_tool(tool_name)
        if tool_def is None:
            return None
        self._loaded_tools.add(tool_name)
        return to_openai_function(tool_def)

    def get_full_schemas_for_set(self, tool_names: set[str]) -> list[dict[str, Any]]:
        """Batch-load full schemas for a set of tool names."""
        results = []
        for name in tool_names:
            schema = self.get_full_schema(name)
            if schema:
                results.append(schema)
        return results

    def get_active_tools(self) -> list[dict[str, Any]]:
        """Return full schemas for tools that have been loaded + brief for the rest."""
        from .tool_registry import openai_tools_brief_for_user, get_tool, to_openai_function
        all_brief = openai_tools_brief_for_user(self._user, self._settings)
        if not self._loaded_tools:
            return all_brief

        result = []
        for brief in all_brief:
            name = brief["function"]["name"]
            if name in self._loaded_tools:
                tool_def = get_tool(name)
                if tool_def:
                    result.append(to_openai_function(tool_def))
                else:
                    result.append(brief)
            else:
                result.append(brief)
        return result

    @property
    def loaded_tool_names(self) -> frozenset[str]:
        return frozenset(self._loaded_tools)
