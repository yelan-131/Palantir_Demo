"""Structured context compaction for the agent runtime.

Replaces the simple middle-truncation with a structured summary that
preserves key information from discarded messages.  Inspired by Claude
Code's compaction mechanism that keeps intent, files touched, errors,
and key decisions while dropping verbose tool outputs.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class StructuredSummary:
    """Summary extracted from discarded conversation messages."""
    user_requests: list[str] = field(default_factory=list)
    tools_called: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    message_range: tuple[int, int] = (0, 0)
    original_count: int = 0


class ContextCompactor:
    """Compacts conversation messages by replacing old ones with a structured summary."""

    def compact_messages(
        self,
        messages: list[dict[str, Any]],
        keep_recent: int = 20,
    ) -> tuple[list[dict[str, Any]], StructuredSummary | None]:
        """Remove old messages and produce a structured summary.

        Always keeps:
        - The first message (system prompt)
        - The last `keep_recent` messages
        - Tool_call/result pairs are never split

        Returns (remaining_messages, summary_or_none).
        """
        if len(messages) <= keep_recent + 1:
            return messages, None

        system_msg = messages[0] if messages and messages[0].get("role") == "system" else None
        rest = messages[1:] if system_msg else messages[:]

        if len(rest) <= keep_recent:
            return messages, None

        # Find a safe split point -- don't split tool_call/result pairs
        split_at = len(rest) - keep_recent
        split_at = self._find_safe_split(rest, split_at)

        discarded = rest[:split_at]
        kept = rest[split_at:]

        summary = self._extract_structured_summary(discarded)
        summary.message_range = (1, split_at)
        summary.original_count = len(messages)

        # Build summary message
        summary_msg = self._build_summary_message(summary)

        result = []
        if system_msg:
            result.append(system_msg)
        result.append(summary_msg)
        result.extend(kept)
        return result, summary

    def _find_safe_split(self, messages: list[dict[str, Any]], proposed: int) -> int:
        """Adjust split point to avoid splitting tool_call/result pairs."""
        if proposed <= 0:
            return 0
        if proposed >= len(messages):
            return len(messages)

        # If the message at split point is a tool result, move back to include its tool_call
        if messages[proposed].get("role") == "tool":
            for i in range(proposed - 1, -1, -1):
                if messages[i].get("role") == "assistant" and messages[i].get("tool_calls"):
                    return i
            # No matching tool_call found, split here is fine
        return proposed

    def _extract_structured_summary(self, discarded: list[dict[str, Any]]) -> StructuredSummary:
        """Extract key information from discarded messages using heuristics."""
        summary = StructuredSummary()

        for msg in discarded:
            role = msg.get("role", "")
            content = msg.get("content", "")

            # Extract user requests
            if role == "user" and content:
                summary.user_requests.append(content[:200])

            # Extract tool calls
            if role == "assistant" and msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    func = tc.get("function", {})
                    name = func.get("name", "")
                    if name and name not in summary.tools_called:
                        summary.tools_called.append(name)

            # Extract errors
            if role == "tool" and content:
                try:
                    data = json.loads(content)
                    if isinstance(data, dict) and "error" in data:
                        summary.errors.append(str(data["error"])[:200])
                except (json.JSONDecodeError, TypeError):
                    pass
                if '"error"' in content:
                    summary.errors.append(content[:200])

            # Extract topics from content keywords
            if content and role in ("user", "assistant"):
                # Simple keyword extraction for manufacturing domain
                keywords = re.findall(r'[一-鿿]{2,6}', content)
                for kw in keywords[:3]:
                    if kw not in summary.topics:
                        summary.topics.append(kw)

        # Keep lists bounded
        summary.user_requests = summary.user_requests[:8]
        summary.tools_called = summary.tools_called[:15]
        summary.errors = summary.errors[:5]
        summary.topics = summary.topics[:10]
        summary.decisions = summary.decisions[:5]

        return summary

    def _build_summary_message(self, summary: StructuredSummary) -> dict[str, Any]:
        """Format the summary as a system message for context injection."""
        parts = ["[对话摘要 -- 早期对话已压缩]"]

        if summary.user_requests:
            parts.append("用户请求：" + "；".join(summary.user_requests[:3]))

        if summary.tools_called:
            parts.append("已调用工具：" + "、".join(summary.tools_called[:8]))

        if summary.errors:
            parts.append("遇到的错误：" + "；".join(summary.errors[:3]))

        if summary.topics:
            parts.append("涉及主题：" + "、".join(summary.topics[:5]))

        parts.append(f"(原始 {summary.original_count} 条消息已压缩为摘要)")

        return {
            "role": "system",
            "content": "\n".join(parts),
        }
