"""Tests for context_layers -- Phase 2: Layered Context Assembly."""
from __future__ import annotations

import os
import sys

import pytest

# Ensure the backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.ai.context_layers import ContextLayer, LayeredContext
from app.services.ai.schemas import ChatMessage, ToolCall, ToolCallFunction


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _msg(role: str = "user", content: str = "hello") -> ChatMessage:
    return ChatMessage(role=role, content=content)


def _dict_msg(role: str = "user", content: str = "hello") -> dict:
    return {"role": role, "content": content}


# ---------------------------------------------------------------------------
# 1. Layer ordering: SYSTEM first, CURRENT_TURN near end, HISTORY last
# ---------------------------------------------------------------------------

class TestLayerOrdering:
    def test_system_always_first(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", "hist")])
        ctx.add_layer(ContextLayer.CURRENT_TURN, [_dict_msg("user", "current")])
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.EVIDENCE, [_dict_msg("user", "evidence")])

        assembled = ctx.assemble()
        assert assembled[0]["role"] == "system"
        assert assembled[0]["content"] == "sys"

    def test_history_always_last(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.CURRENT_TURN, [_dict_msg("user", "current")])
        ctx.add_layer(ContextLayer.EVIDENCE, [_dict_msg("user", "ev")])
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", "hist")])

        assembled = ctx.assemble()
        assert assembled[-1]["content"] == "hist"

    def test_current_turn_near_end_before_history(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", "hist")])
        ctx.add_layer(ContextLayer.CURRENT_TURN, [_dict_msg("user", "current")])

        assembled = ctx.assemble()
        # SYSTEM at index 0, CURRENT_TURN, then HISTORY at the end
        idx_current = next(i for i, m in enumerate(assembled) if m["content"] == "current")
        idx_history = next(i for i, m in enumerate(assembled) if m["content"] == "hist")
        assert idx_current < idx_history

    def test_middle_layers_sorted_descending_priority(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.EVIDENCE, [_dict_msg("user", "evidence")])       # 40
        ctx.add_layer(ContextLayer.MEMORY, [_dict_msg("user", "memory")])           # 50
        ctx.add_layer(ContextLayer.PROJECT, [_dict_msg("user", "project")])         # 60
        ctx.add_layer(ContextLayer.POLICY, [_dict_msg("user", "policy")])           # 80
        ctx.add_layer(ContextLayer.IDENTITY, [_dict_msg("user", "identity")])       # 90
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])            # 100
        ctx.add_layer(ContextLayer.CURRENT_TURN, [_dict_msg("user", "current")])    # 70
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", "hist")])            # 30

        assembled = ctx.assemble()
        contents = [m["content"] for m in assembled]
        # Expected: sys, identity, policy, project, memory, evidence, current, hist
        assert contents == ["sys", "identity", "policy", "project", "memory", "evidence", "current", "hist"]


# ---------------------------------------------------------------------------
# 2. assemble() produces correct message sequence
# ---------------------------------------------------------------------------

class TestAssemble:
    def test_empty_context_returns_empty(self):
        ctx = LayeredContext()
        assert ctx.assemble() == []

    def test_single_layer_returns_its_messages(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        assembled = ctx.assemble()
        assert len(assembled) == 1
        assert assembled[0]["content"] == "sys"

    def test_multiple_messages_per_layer(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.HISTORY, [
            _dict_msg("user", "h1"),
            _dict_msg("assistant", "h2"),
            _dict_msg("user", "h3"),
        ])
        assembled = ctx.assemble()
        assert len(assembled) == 3
        assert [m["content"] for m in assembled] == ["h1", "h2", "h3"]

    def test_layers_flatten_in_correct_order(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.HISTORY, [
            _dict_msg("user", "h1"),
            _dict_msg("assistant", "h2"),
        ])
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])

        assembled = ctx.assemble()
        assert len(assembled) == 3
        assert assembled[0]["content"] == "sys"
        assert assembled[1]["content"] == "h1"
        assert assembled[2]["content"] == "h2"


# ---------------------------------------------------------------------------
# 3. trim_to_budget() trims lowest-priority layers first
# ---------------------------------------------------------------------------

class TestTrimToBudget:
    def test_no_trim_when_within_budget(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.CURRENT_TURN, [_dict_msg("user", "q")])
        trimmed = ctx.trim_to_budget(max_messages=10)
        assert trimmed == []
        assert len(ctx.assemble()) == 2

    def test_trims_lowest_priority_first(self):
        ctx = LayeredContext()
        # HISTORY (30) -- lowest priority among non-protected layers
        ctx.add_layer(ContextLayer.HISTORY, [
            _dict_msg("user", f"h{i}") for i in range(20)
        ])
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.CURRENT_TURN, [_dict_msg("user", "current")])

        trimmed = ctx.trim_to_budget(max_messages=5)
        assert ContextLayer.HISTORY in trimmed
        assert ContextLayer.SYSTEM not in trimmed
        assert ContextLayer.CURRENT_TURN not in trimmed

    def test_trims_multiple_layers_as_needed(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", f"h{i}") for i in range(10)])
        ctx.add_layer(ContextLayer.EVIDENCE, [_dict_msg("user", f"ev{i}") for i in range(10)])
        ctx.add_layer(ContextLayer.MEMORY, [_dict_msg("user", f"mem{i}") for i in range(10)])
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])

        trimmed = ctx.trim_to_budget(max_messages=5)
        # HISTORY (30) and EVIDENCE (40) should be trimmed, MEMORY (50) may also be trimmed
        assert ContextLayer.HISTORY in trimmed
        assert ContextLayer.EVIDENCE in trimmed

    def test_assemble_after_trim_reflects_removal(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.HISTORY, [
            _dict_msg("user", f"h{i}") for i in range(20)
        ])
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.CURRENT_TURN, [_dict_msg("user", "current")])

        ctx.trim_to_budget(max_messages=5)
        assembled = ctx.assemble()
        # After trimming HISTORY, only SYSTEM + CURRENT_TURN remain
        contents = [m["content"] for m in assembled]
        assert "sys" in contents
        assert "current" in contents
        # History messages should be gone
        assert all(m["content"] != "h0" for m in assembled)


# ---------------------------------------------------------------------------
# 4. SYSTEM and IDENTITY layers are never trimmed
# ---------------------------------------------------------------------------

class TestProtectedLayers:
    def test_system_never_trimmed(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        # Add many low-priority messages
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", f"h{i}") for i in range(50)])

        trimmed = ctx.trim_to_budget(max_messages=1)
        assert ContextLayer.SYSTEM not in trimmed

    def test_identity_never_trimmed(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.IDENTITY, [_dict_msg("user", "identity")])
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", f"h{i}") for i in range(50)])

        trimmed = ctx.trim_to_budget(max_messages=1)
        assert ContextLayer.IDENTITY not in trimmed
        assert ContextLayer.HISTORY in trimmed

    def test_both_protected_layers_survive(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.IDENTITY, [_dict_msg("user", "id")])
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", f"h{i}") for i in range(50)])

        ctx.trim_to_budget(max_messages=1)
        assembled = ctx.assemble()
        contents = [m["content"] for m in assembled]
        assert "sys" in contents
        assert "id" in contents


# ---------------------------------------------------------------------------
# 5. total_messages and layer_count properties
# ---------------------------------------------------------------------------

class TestProperties:
    def test_layer_count_empty(self):
        ctx = LayeredContext()
        assert ctx.layer_count == 0

    def test_layer_count_with_layers(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", "h1")])
        assert ctx.layer_count == 2

    def test_total_messages_empty(self):
        ctx = LayeredContext()
        assert ctx.total_messages == 0

    def test_total_messages_counts_all(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [_dict_msg("system", "sys")])
        ctx.add_layer(ContextLayer.HISTORY, [
            _dict_msg("user", "h1"),
            _dict_msg("assistant", "h2"),
            _dict_msg("user", "h3"),
        ])
        assert ctx.total_messages == 4


# ---------------------------------------------------------------------------
# 6. ChatMessage objects are converted to dicts correctly
# ---------------------------------------------------------------------------

class TestChatMessageConversion:
    def test_chat_message_converted_to_dict(self):
        ctx = LayeredContext()
        msg = ChatMessage(role="system", content="hello")
        ctx.add_layer(ContextLayer.SYSTEM, [msg])

        assembled = ctx.assemble()
        assert len(assembled) == 1
        # Result should be a plain dict, not a ChatMessage
        assert isinstance(assembled[0], dict)
        assert assembled[0]["role"] == "system"
        assert assembled[0]["content"] == "hello"

    def test_chat_message_with_tool_calls_converted(self):
        ctx = LayeredContext()
        msg = ChatMessage(
            role="assistant",
            content=None,
            tool_calls=[ToolCall(
                id="call_123",
                type="function",
                function=ToolCallFunction(name="search", arguments="{}"),
            )],
        )
        ctx.add_layer(ContextLayer.HISTORY, [msg])

        assembled = ctx.assemble()
        assert len(assembled) == 1
        assert "tool_calls" in assembled[0]
        assert assembled[0]["tool_calls"][0]["id"] == "call_123"

    def test_mixed_chat_message_and_dict(self):
        ctx = LayeredContext()
        chat_msg = ChatMessage(role="system", content="sys")
        ctx.add_layer(ContextLayer.SYSTEM, [chat_msg])
        ctx.add_layer(ContextLayer.HISTORY, [_dict_msg("user", "hist")])

        assembled = ctx.assemble()
        assert len(assembled) == 2
        assert assembled[0]["role"] == "system"
        assert assembled[1]["role"] == "user"
        assert assembled[1]["content"] == "hist"

    def test_empty_message_list_handled(self):
        ctx = LayeredContext()
        ctx.add_layer(ContextLayer.SYSTEM, [])
        assert ctx.layer_count == 1
        assert ctx.total_messages == 0
        assert ctx.assemble() == []
