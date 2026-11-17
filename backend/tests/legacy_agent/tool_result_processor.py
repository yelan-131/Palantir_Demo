"""Tool result processing and truncation for the agent runtime.

Prevents large tool outputs from flooding the LLM context window.
Inspired by Claude Code's large-result-capping behavior.
"""
from __future__ import annotations

import json
from typing import Any

DEFAULT_MAX_RESULT_CHARS = 8000


class ToolResultProcessor:
    """Caps large tool results to prevent context window bloat."""

    def __init__(self, max_result_chars: int = DEFAULT_MAX_RESULT_CHARS):
        self.max_result_chars = max_result_chars

    def process(self, raw_result: dict[str, Any], tool_name: str) -> dict[str, Any]:
        """Process a tool result. If it exceeds the char limit, truncate smartly."""
        serialized = json.dumps(raw_result, ensure_ascii=False, default=str)
        if len(serialized) <= self.max_result_chars:
            return raw_result

        # Smart truncation
        truncated = self._truncate(raw_result, tool_name)
        truncated["_truncated"] = True
        truncated["_original_size"] = len(serialized)
        truncated["_tool_name"] = tool_name
        return truncated

    def _truncate(self, result: dict[str, Any], tool_name: str) -> dict[str, Any]:
        """Smart truncation: keep top-level keys, shorten arrays and long strings."""
        truncated = {}
        for key, value in result.items():
            if isinstance(value, list):
                # Keep first 5 items + count
                truncated[key] = value[:5]
                truncated[f"_total_{key}"] = len(value)
            elif isinstance(value, str) and len(value) > 2000:
                truncated[key] = value[:2000] + "...[truncated]"
            elif isinstance(value, dict):
                # For nested dicts, try serializing and truncating
                serialized = json.dumps(value, ensure_ascii=False, default=str)
                if len(serialized) > 3000:
                    truncated[key] = {
                        "_summary": f"Object with {len(value)} keys",
                        "_keys": list(value.keys())[:10],
                    }
                else:
                    truncated[key] = value
            else:
                truncated[key] = value
        return truncated

    def format_for_context(self, result: dict[str, Any]) -> str:
        """Serialize a (possibly truncated) result for LLM context insertion."""
        serialized = json.dumps(result, ensure_ascii=False, default=str)
        if result.get("_truncated"):
            note = (
                f"\n\n[结果已截断，原始大小 {result.get('_original_size', '?')} 字符。"
                f"如需完整数据，请使用更精确的查询条件。]"
            )
            return serialized[:self.max_result_chars] + note
        return serialized


def format_tool_result(raw_result: dict[str, Any], tool_name: str, *, max_chars: int = DEFAULT_MAX_RESULT_CHARS) -> str:
    """Convenience function: process and format in one step."""
    processor = ToolResultProcessor(max_result_chars=max_chars)
    processed = processor.process(raw_result, tool_name)
    return processor.format_for_context(processed)
