"""Placeholder for future short-term and long-term AI memory."""

from __future__ import annotations


def conversation_memory_key(user_id: str | None, session_id: str | None) -> str:
    return f"{user_id or 'anonymous'}:{session_id or 'default'}"

