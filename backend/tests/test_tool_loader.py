"""Tests for tool_loader — Phase 6: Deferred Tool Loading."""
from __future__ import annotations

import sys
import os
from unittest.mock import patch, MagicMock

import pytest

# Ensure the backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.ai.tool_registry import (
    ToolDefinition,
    to_openai_function_brief,
    to_openai_function,
)
from app.services.ai.tool_loader import ToolLoader


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def sample_tool() -> ToolDefinition:
    return ToolDefinition(
        name="query_quality",
        title="质量查询",
        description="查询质量检测数据",
        side_effect="read",
        risk_level="low",
        input_schema={"params": {"type": "object"}},
        permission_check="qa",
    )


@pytest.fixture()
def admin_user() -> dict:
    return {"is_admin": True, "roles": []}


@pytest.fixture()
def admin_settings() -> dict:
    return {
        "guestAccess": "disabled",
        "rolePolicies": [{"role": "admin", "enabled": True, "capabilities": ["qa"]}],
        "riskPolicy": {"low": "allow", "medium": "confirm", "high": "confirm_and_audit", "critical": "blocked"},
    }


# ---------------------------------------------------------------------------
# 1. to_openai_function_brief returns minimal schema
# ---------------------------------------------------------------------------

class TestToOpenaiFunctionBrief:
    def test_returns_minimal_schema(self, sample_tool):
        result = to_openai_function_brief(sample_tool)
        assert result["type"] == "function"
        func = result["function"]
        assert func["name"] == "query_quality"
        assert func["description"] == "质量查询"
        assert func["parameters"] == {"type": "object", "properties": {}}

    def test_falls_back_to_name_when_no_title(self):
        tool = ToolDefinition(
            name="my_tool",
            title="",
            description="Does something",
        )
        result = to_openai_function_brief(tool)
        assert result["function"]["description"] == "my_tool"

    def test_no_side_effect_metadata(self, sample_tool):
        """Brief schema should NOT contain risk/side-effect annotations."""
        result = to_openai_function_brief(sample_tool)
        desc = result["function"]["description"]
        # The full schema appends risk info; brief should not
        assert "副作用" not in desc
        assert "风险" not in desc

    def test_brief_is_smaller_than_full(self, sample_tool):
        brief = to_openai_function_brief(sample_tool)
        full = to_openai_function(sample_tool)
        # Brief parameters should always be empty
        assert brief["function"]["parameters"]["properties"] == {}
        # Full parameters should have content (sample_tool has input_schema)
        assert full["function"]["parameters"] != {"type": "object", "properties": {}}


# ---------------------------------------------------------------------------
# 2. ToolLoader.list_available_tools returns Tier 1 tools
# ---------------------------------------------------------------------------

class TestListAvailableTools:
    def test_returns_brief_tools(self, admin_user, admin_settings, sample_tool):
        mock_registry = {"query_quality": sample_tool}
        with patch("app.services.ai.tool_registry.tool_registry", return_value=mock_registry):
            loader = ToolLoader(admin_user, admin_settings)
            tools = loader.list_available_tools()
        assert len(tools) == 1
        assert tools[0]["function"]["name"] == "query_quality"
        assert tools[0]["function"]["parameters"]["properties"] == {}

    def test_empty_registry(self, admin_user, admin_settings):
        with patch("app.services.ai.tool_registry.tool_registry", return_value={}):
            loader = ToolLoader(admin_user, admin_settings)
            assert loader.list_available_tools() == []


# ---------------------------------------------------------------------------
# 3. ToolLoader.get_full_schema loads Tier 2 for a specific tool
# ---------------------------------------------------------------------------

class TestGetFullSchema:
    def test_returns_full_schema(self, admin_user, admin_settings, sample_tool):
        mock_registry = {"query_quality": sample_tool}
        with patch("app.services.ai.tool_registry.tool_registry", return_value=mock_registry):
            loader = ToolLoader(admin_user, admin_settings)
            schema = loader.get_full_schema("query_quality")
        assert schema is not None
        assert schema["function"]["name"] == "query_quality"
        # Full schema includes the input_schema
        assert "params" in schema["function"]["parameters"]["properties"]

    def test_returns_none_for_unknown_tool(self, admin_user, admin_settings):
        with patch("app.services.ai.tool_registry.tool_registry", return_value={}):
            loader = ToolLoader(admin_user, admin_settings)
            assert loader.get_full_schema("nonexistent") is None

    def test_loading_adds_to_loaded_set(self, admin_user, admin_settings, sample_tool):
        mock_registry = {"query_quality": sample_tool}
        with patch("app.services.ai.tool_registry.tool_registry", return_value=mock_registry):
            loader = ToolLoader(admin_user, admin_settings)
            assert "query_quality" not in loader.loaded_tool_names
            loader.get_full_schema("query_quality")
            assert "query_quality" in loader.loaded_tool_names


# ---------------------------------------------------------------------------
# 4. ToolLoader.get_active_tools returns full for loaded + brief for rest
# ---------------------------------------------------------------------------

class TestGetActiveTools:
    def test_all_brief_when_none_loaded(self, admin_user, admin_settings):
        tool_a = ToolDefinition(name="tool_a", title="Tool A", description="First tool")
        tool_b = ToolDefinition(name="tool_b", title="Tool B", description="Second tool")
        mock_registry = {"tool_a": tool_a, "tool_b": tool_b}
        with patch("app.services.ai.tool_registry.tool_registry", return_value=mock_registry):
            loader = ToolLoader(admin_user, admin_settings)
            active = loader.get_active_tools()
        assert len(active) == 2
        for t in active:
            assert t["function"]["parameters"]["properties"] == {}

    def test_mixed_after_partial_load(self, admin_user, admin_settings):
        tool_a = ToolDefinition(
            name="tool_a", title="Tool A", description="First tool",
            input_schema={"x": {"type": "string"}},
        )
        tool_b = ToolDefinition(name="tool_b", title="Tool B", description="Second tool")
        mock_registry = {"tool_a": tool_a, "tool_b": tool_b}
        with patch("app.services.ai.tool_registry.tool_registry", return_value=mock_registry):
            loader = ToolLoader(admin_user, admin_settings)
            loader.get_full_schema("tool_a")
            active = loader.get_active_tools()
        assert len(active) == 2
        names = {t["function"]["name"]: t for t in active}
        # tool_a was loaded -> full schema with its input_schema
        assert "x" in names["tool_a"]["function"]["parameters"]["properties"]
        # tool_b was not loaded -> brief
        assert names["tool_b"]["function"]["parameters"]["properties"] == {}


# ---------------------------------------------------------------------------
# 5. loaded_tool_names tracks what's been loaded
# ---------------------------------------------------------------------------

class TestLoadedToolNames:
    def test_initially_empty(self, admin_user, admin_settings):
        loader = ToolLoader(admin_user, admin_settings)
        assert loader.loaded_tool_names == frozenset()

    def test_tracks_loaded_tools(self, admin_user, admin_settings):
        tool_a = ToolDefinition(name="tool_a", title="A", description="a")
        tool_b = ToolDefinition(name="tool_b", title="B", description="b")
        mock_registry = {"tool_a": tool_a, "tool_b": tool_b}
        with patch("app.services.ai.tool_registry.tool_registry", return_value=mock_registry):
            loader = ToolLoader(admin_user, admin_settings)
            loader.get_full_schema("tool_a")
            assert loader.loaded_tool_names == frozenset({"tool_a"})
            loader.get_full_schema("tool_b")
            assert loader.loaded_tool_names == frozenset({"tool_a", "tool_b"})

    def test_returns_frozenset(self, admin_user, admin_settings):
        loader = ToolLoader(admin_user, admin_settings)
        assert isinstance(loader.loaded_tool_names, frozenset)


# ---------------------------------------------------------------------------
# 6. get_full_schemas_for_set batch loading
# ---------------------------------------------------------------------------

class TestGetFullSchemasForSet:
    def test_batch_load(self, admin_user, admin_settings):
        tool_a = ToolDefinition(name="tool_a", title="A", description="a")
        tool_b = ToolDefinition(name="tool_b", title="B", description="b")
        mock_registry = {"tool_a": tool_a, "tool_b": tool_b}
        with patch("app.services.ai.tool_registry.tool_registry", return_value=mock_registry):
            loader = ToolLoader(admin_user, admin_settings)
            schemas = loader.get_full_schemas_for_set({"tool_a", "tool_b", "nonexistent"})
        names = {s["function"]["name"] for s in schemas}
        assert names == {"tool_a", "tool_b"}
        assert loader.loaded_tool_names == frozenset({"tool_a", "tool_b"})
