"""Tests for the ContextCompactor (Phase 3)."""
import pytest

from app.services.ai.compactor import ContextCompactor, StructuredSummary


def _make_messages(count: int, *, system: bool = True) -> list[dict]:
    """Build a simple message list for testing."""
    msgs = []
    if system:
        msgs.append({"role": "system", "content": "You are an assistant."})
    for i in range(count):
        msgs.append({"role": "user", "content": f"User message {i}"})
        msgs.append({"role": "assistant", "content": f"Assistant reply {i}"})
    return msgs


def _make_tool_messages() -> list[dict]:
    """Build messages with tool_call/result pairs."""
    return [
        {"role": "system", "content": "System"},
        {"role": "user", "content": "Query records"},
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "call-1", "type": "function", "function": {"name": "forms.query_records", "arguments": "{}"}},
        ]},
        {"role": "tool", "tool_call_id": "call-1", "content": '{"records": []}'},
        {"role": "assistant", "content": "No records found."},
        {"role": "user", "content": "Create a form"},
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "call-2", "type": "function", "function": {"name": "forms.create_form_definition", "arguments": "{}"}},
        ]},
        {"role": "tool", "tool_call_id": "call-2", "content": '{"form_id": 1}'},
        {"role": "assistant", "content": "Form created!"},
    ]


class TestCompactMessagesBasic:

    def test_no_compaction_when_within_budget(self):
        compactor = ContextCompactor()
        msgs = _make_messages(5)
        result, summary = compactor.compact_messages(msgs, keep_recent=20)
        assert result == msgs
        assert summary is None

    def test_compaction_happens_when_over_budget(self):
        compactor = ContextCompactor()
        msgs = _make_messages(20)
        result, summary = compactor.compact_messages(msgs, keep_recent=10)
        assert summary is not None
        assert len(result) < len(msgs)

    def test_system_message_always_preserved(self):
        compactor = ContextCompactor()
        msgs = _make_messages(30)
        result, summary = compactor.compact_messages(msgs, keep_recent=10)
        assert result[0]["role"] == "system"
        assert result[0]["content"] == "You are an assistant."

    def test_summary_message_inserted_after_system(self):
        compactor = ContextCompactor()
        msgs = _make_messages(30)
        result, summary = compactor.compact_messages(msgs, keep_recent=10)
        assert result[1]["role"] == "system"
        assert "对话摘要" in result[1]["content"]

    def test_keep_recent_messages_at_end(self):
        compactor = ContextCompactor()
        msgs = _make_messages(30)
        result, summary = compactor.compact_messages(msgs, keep_recent=10)
        last_user = [m for m in reversed(result) if m["role"] == "user"][0]
        assert "29" in last_user["content"]

    def test_summary_original_count(self):
        compactor = ContextCompactor()
        msgs = _make_messages(30)
        result, summary = compactor.compact_messages(msgs, keep_recent=10)
        assert summary is not None
        assert summary.original_count == len(msgs)


class TestToolCallPairIntegrity:

    def test_tool_call_result_not_split(self):
        compactor = ContextCompactor()
        msgs = _make_tool_messages()
        result, summary = compactor.compact_messages(msgs, keep_recent=3)
        for i, m in enumerate(result):
            if m.get("role") == "tool":
                assert i > 0, "Tool result cannot be first message"
                found_call = False
                for j in range(i - 1, -1, -1):
                    if result[j].get("role") == "assistant" and result[j].get("tool_calls"):
                        for tc in result[j]["tool_calls"]:
                            if tc.get("id") == m.get("tool_call_id"):
                                found_call = True
                                break
                    if found_call:
                        break
                assert found_call, f"Tool result at index {i} has no matching tool_call"


class TestExtractStructuredSummary:

    def test_extracts_user_requests(self):
        compactor = ContextCompactor()
        discarded = [
            {"role": "user", "content": "查询生产记录"},
            {"role": "assistant", "content": "好的"},
            {"role": "user", "content": "分析质量数据"},
        ]
        summary = compactor._extract_structured_summary(discarded)
        assert len(summary.user_requests) == 2
        assert "查询生产记录" in summary.user_requests[0]

    def test_extracts_tool_calls(self):
        compactor = ContextCompactor()
        discarded = [
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "c1", "function": {"name": "forms.query_records", "arguments": "{}"}},
                {"id": "c2", "function": {"name": "knowledge.search", "arguments": "{}"}},
            ]},
        ]
        summary = compactor._extract_structured_summary(discarded)
        assert "forms.query_records" in summary.tools_called
        assert "knowledge.search" in summary.tools_called

    def test_extracts_errors(self):
        compactor = ContextCompactor()
        discarded = [
            {"role": "tool", "content": '{"error": "Permission denied"}'},
        ]
        summary = compactor._extract_structured_summary(discarded)
        assert any("Permission denied" in e for e in summary.errors)

    def test_extracts_topics(self):
        compactor = ContextCompactor()
        discarded = [
            {"role": "user", "content": "帮我查看生产车间的质量检测报告"},
        ]
        summary = compactor._extract_structured_summary(discarded)
        assert len(summary.topics) > 0

    def test_deduplicates_tool_calls(self):
        compactor = ContextCompactor()
        discarded = [
            {"role": "assistant", "tool_calls": [
                {"function": {"name": "forms.query_records", "arguments": "{}"}},
            ]},
            {"role": "assistant", "tool_calls": [
                {"function": {"name": "forms.query_records", "arguments": "{}"}},
            ]},
        ]
        summary = compactor._extract_structured_summary(discarded)
        assert summary.tools_called.count("forms.query_records") == 1


class TestBuildSummaryMessage:

    def test_summary_message_is_system_role(self):
        compactor = ContextCompactor()
        summary = StructuredSummary(
            user_requests=["查询记录"],
            tools_called=["forms.query_records"],
            original_count=50,
        )
        msg = compactor._build_summary_message(summary)
        assert msg["role"] == "system"
        assert "对话摘要" in msg["content"]

    def test_summary_includes_all_sections(self):
        compactor = ContextCompactor()
        summary = StructuredSummary(
            user_requests=["查询"],
            tools_called=["forms.query_records"],
            errors=["权限不足"],
            topics=["生产"],
            original_count=50,
        )
        msg = compactor._build_summary_message(summary)
        assert "查询" in msg["content"]
        assert "forms.query_records" in msg["content"]
        assert "权限不足" in msg["content"]
        assert "生产" in msg["content"]
        assert "50" in msg["content"]

    def test_empty_summary_still_has_header(self):
        compactor = ContextCompactor()
        summary = StructuredSummary(original_count=10)
        msg = compactor._build_summary_message(summary)
        assert "对话摘要" in msg["content"]
