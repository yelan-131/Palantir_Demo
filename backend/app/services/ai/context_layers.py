"""Layered context assembly for the agent runtime.

Organizes conversation context into distinct layers with priorities,
inspired by Claude Code's 4-layer context model:
  System Prompt -> Project Context -> Conversation History -> Current Turn

Higher-priority layers are preserved during trimming; lower-priority
layers are trimmed first.
"""
from __future__ import annotations

from enum import IntEnum
from typing import Any

from .schemas import ChatMessage


class ContextLayer(IntEnum):
    """Named context layers with trim priority (higher = kept longer)."""
    HISTORY = 30        # Conversation history -- trimmed first
    EVIDENCE = 40       # Knowledge evidence [S1], [S2]
    MEMORY = 50         # Long-term/session memory [M1]
    PROJECT = 60        # CLAUDE.md, tenant profile
    CURRENT_TURN = 70   # The user's new message
    POLICY = 80         # Safety rules, tool policy
    IDENTITY = 90       # User identity and roles
    SYSTEM = 100        # System prompt -- never trimmed


class LayeredContext:
    """Assembles messages in distinct layers with priority-based trimming."""

    def __init__(self) -> None:
        self._layers: list[tuple[ContextLayer, list[dict[str, Any]]]] = []

    def add_layer(
        self, layer: ContextLayer, messages: list[ChatMessage] | list[dict[str, Any]]
    ) -> None:
        """Add a named context layer."""
        # Convert ChatMessage objects to dicts if needed
        if messages and isinstance(messages[0], ChatMessage):
            msgs = [m.to_api_dict() for m in messages]
        else:
            msgs = list(messages)  # type: ignore[arg-type]
        self._layers.append((layer, msgs))

    def assemble(self) -> list[dict[str, Any]]:
        """Produce the final ordered message list.

        Layers are ordered by: SYSTEM first, then by layer enum value descending,
        with CURRENT_TURN always last before HISTORY.
        """
        if not self._layers:
            return []

        # Sort: SYSTEM first (100), then descending priority, CURRENT_TURN always near end
        def sort_key(item: tuple[ContextLayer, list[dict[str, Any]]]) -> tuple[int, int]:
            layer = item[0]
            if layer == ContextLayer.SYSTEM:
                return (0, 0)  # Always first
            if layer == ContextLayer.CURRENT_TURN:
                return (2, 0)  # Always near end
            if layer == ContextLayer.HISTORY:
                return (3, 0)  # Always last
            return (1, -int(layer))  # Middle layers: higher priority first

        sorted_layers = sorted(self._layers, key=sort_key)
        result: list[dict[str, Any]] = []
        for _layer, msgs in sorted_layers:
            result.extend(msgs)
        return result

    def trim_to_budget(
        self, max_messages: int = 40
    ) -> list[ContextLayer]:
        """Trim layers to fit within a message budget.

        Trims lowest-priority layers first. Removes trimmed layers from
        this context so that subsequent ``assemble()`` calls reflect the
        trimming.  Returns list of layers that were trimmed.

        System and Identity layers are never trimmed.
        """
        total = self.total_messages
        if total <= max_messages:
            return []

        trimmed_layers: list[ContextLayer] = []

        # Sort layers by priority ascending (trim lowest first)
        layers_by_priority = sorted(self._layers, key=lambda x: int(x[0]))

        remaining = total
        for layer, msgs in layers_by_priority:
            # Never trim SYSTEM or IDENTITY
            if layer in (ContextLayer.SYSTEM, ContextLayer.IDENTITY):
                continue

            if remaining <= max_messages:
                break

            remaining -= len(msgs)
            trimmed_layers.append(layer)

        # Actually remove trimmed layers from internal storage
        if trimmed_layers:
            trimmed_set = set(trimmed_layers)
            self._layers = [(l, ms) for l, ms in self._layers if l not in trimmed_set]

        return trimmed_layers

    @property
    def layer_count(self) -> int:
        return len(self._layers)

    @property
    def total_messages(self) -> int:
        return sum(len(msgs) for _, msgs in self._layers)
