"""Tests for tool_result_processor — Phase 5: Tool Result Summarization."""
from __future__ import annotations

import json
import sys
import os

import pytest

# Ensure the backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.ai.tool_result_processor import (
    DEFAULT_MAX_RESULT_CHARS,
    ToolResultProcessor,
    format_tool_result,
)


# ---------------------------------------------------------------------------
# 1. Small results pass through unchanged
# ---------------------------------------------------------------------------

class TestPassthrough:
    def test_small_result_unchanged(self):
        processor = ToolResultProcessor(max_result_chars=500)
        raw = {"status": "ok", "rows": 3}
        processed = processor.process(raw, "test_tool")
        assert processed is raw  # same object — no copy made

    def test_empty_result_unchanged(self):
        processor = ToolResultProcessor()
        raw = {}
        processed = processor.process(raw, "test_tool")
        assert processed is raw

    def test_format_small_result_no_truncation_note(self):
        raw = {"answer": 42}
        text = format_tool_result(raw, "test_tool", max_chars=5000)
        assert "[结果已截断" not in text
        parsed = json.loads(text)
        assert parsed["answer"] == 42


# ---------------------------------------------------------------------------
# 2. Large results get truncated with _truncated=True
# ---------------------------------------------------------------------------

class TestTruncation:
    def test_large_result_is_truncated(self):
        processor = ToolResultProcessor(max_result_chars=200)
        raw = {"data": "x" * 500}
        processed = processor.process(raw, "test_tool")
        assert processed.get("_truncated") is True
        assert processed.get("_original_size") > 200
        assert processed.get("_tool_name") == "test_tool"

    def test_truncated_string_is_shortened(self):
        processor = ToolResultProcessor(max_result_chars=200)
        raw = {"text": "A" * 3000}
        processed = processor.process(raw, "test_tool")
        assert processed["text"].endswith("...[truncated]")
        assert len(processed["text"]) <= 2016  # 2000 + suffix


# ---------------------------------------------------------------------------
# 3. Array truncation keeps first 5 items + count
# ---------------------------------------------------------------------------

class TestArrayTruncation:
    def test_array_keeps_first_five_plus_count(self):
        processor = ToolResultProcessor(max_result_chars=200)
        items = [{"id": i, "name": f"item_{i}"} for i in range(50)]
        raw = {"records": items}
        processed = processor.process(raw, "test_tool")
        assert len(processed["records"]) == 5
        assert processed["_total_records"] == 50

    def test_short_array_not_truncated(self):
        processor = ToolResultProcessor(max_result_chars=50000)
        items = [{"id": i} for i in range(3)]
        raw = {"records": items}
        processed = processor.process(raw, "test_tool")
        assert len(processed["records"]) == 3
        assert "_total_records" not in processed


# ---------------------------------------------------------------------------
# 4. format_tool_result includes truncation note
# ---------------------------------------------------------------------------

class TestFormatWithContext:
    def test_truncation_note_present(self):
        raw = {"data": "B" * 10000}
        text = format_tool_result(raw, "my_tool", max_chars=500)
        assert "[结果已截断" in text
        assert "原始大小" in text

    def test_note_contains_original_size(self):
        raw = {"payload": "C" * 5000}
        text = format_tool_result(raw, "tool_x", max_chars=500)
        # The original size should appear somewhere in the output
        serialized_len = len(json.dumps(raw, ensure_ascii=False, default=str))
        assert str(serialized_len) in text


# ---------------------------------------------------------------------------
# 5. Convenience function end-to-end
# ---------------------------------------------------------------------------

class TestConvenienceFunction:
    def test_format_tool_result_returns_string(self):
        raw = {"key": "value"}
        result = format_tool_result(raw, "test_tool")
        assert isinstance(result, str)
        parsed = json.loads(result)
        assert parsed["key"] == "value"

    def test_format_tool_result_with_large_input(self):
        raw = {"items": list(range(1000)), "description": "x" * 5000}
        result = format_tool_result(raw, "big_tool", max_chars=1000)
        assert isinstance(result, str)
        assert "[结果已截断" in result

    def test_default_max_chars_constant(self):
        assert DEFAULT_MAX_RESULT_CHARS == 8000
