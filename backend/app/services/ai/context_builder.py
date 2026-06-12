"""Runtime context assembly for database-backed AI conversations."""

from __future__ import annotations

from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relational import AIMessage

from .memory import memory_service
from .schemas import AgentRequest
from .settings import maybe_mask_sensitive_payload, safety_policy_snapshot
from .tenant_context import require_tenant_id


def estimate_tokens(value: Any) -> int:
    text = value if isinstance(value, str) else str(value or "")
    return max(1, len(text) // 4)


def trim_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}..."


class ContextBuilder:
    async def build(
        self,
        session: AsyncSession,
        *,
        request: AgentRequest,
        user: dict[str, Any],
        settings: dict[str, Any],
        conversation_id: str | None = None,
        page: str | None = None,
        document_id: str | None = None,
        tenant_id: int | None = None,
        user_key: str | None = None,
        evidence: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        tenant_id = require_tenant_id({"tenant_id": tenant_id or user.get("tenant_id") or (request.context or {}).get("_tenant_id")})
        context_policy = settings.get("contextPolicy") or {}
        memory_policy = settings.get("memoryPolicy") or {}
        rag_policy = settings.get("ragPolicy") or {}
        recent_limit = int(context_policy.get("recentMessageLimit") or 10)
        max_context_tokens = int(context_policy.get("maxContextTokens") or 12000)
        memory_limit = int(memory_policy.get("recallLimit") or 5)
        max_evidence_chars = int(rag_policy.get("maxEvidenceChars") or 1200)

        recent_messages = await self._recent_messages(session, conversation_id, recent_limit)
        memories: list[dict[str, Any]] = []
        if memory_policy.get("enabled"):
            memories = await memory_service.retrieve_context(
                session,
                tenant_id=tenant_id,
                user_key=user_key,
                conversation_id=conversation_id,
                page=page,
                document_id=document_id,
                query=request.message,
                limit=memory_limit,
            )

        trimmed_evidence = [
            {**item, "content": trim_text(str(item.get("content") or item.get("text") or item.get("summary") or ""), max_evidence_chars)}
            for item in (evidence or [])
        ]
        payload = {
            "identity": {
                "user": user.get("sub") or user.get("username") or user_key or "unknown",
                "roles": [role.get("name") if isinstance(role, dict) else role for role in user.get("roles", [])],
                "is_admin": bool(user.get("is_admin")),
            },
            "page": page or request.page,
            "document_id": document_id,
            "context_need": (request.context or {}).get("contextNeed") or (request.context or {}).get("context_need"),
            "semantic_context": (request.context or {}).get("semanticContext") or {},
            "recent_messages": recent_messages,
            "memories": memories,
            "evidence": trimmed_evidence,
        }
        payload["estimated_tokens"] = estimate_tokens(payload)
        payload["budget_exceeded"] = payload["estimated_tokens"] > max_context_tokens
        payload["context_sources"] = {
            "recent_messages": len(recent_messages),
            "memories": len(memories),
            "evidence": len(trimmed_evidence),
            "semantic_objects": len((((request.context or {}).get("semanticContext") or {}).get("objects")) or []),
            "semantic_records": ((request.context or {}).get("semanticContext") or {}).get("record_count", 0),
            "max_context_tokens": max_context_tokens,
            "estimated_tokens": payload["estimated_tokens"],
        }
        if payload["budget_exceeded"]:
            payload = self._trim_to_budget(payload, max_context_tokens)
        if safety_policy_snapshot(settings).get("sensitiveMasking", True):
            payload = maybe_mask_sensitive_payload(payload, settings)
        return payload

    async def _recent_messages(self, session: AsyncSession, conversation_id: str | None, limit: int) -> list[dict[str, Any]]:
        if not conversation_id:
            return []
        rows = (
            await session.execute(
                select(AIMessage)
                .where(AIMessage.conversation_id == conversation_id)
                .order_by(desc(AIMessage.id))
                .limit(max(1, min(limit, 50)))
            )
        ).scalars().all()
        return [
            {"role": row.role, "content": row.content, "message_id": row.message_id}
            for row in reversed(rows)
        ]

    def _trim_to_budget(self, payload: dict[str, Any], max_tokens: int) -> dict[str, Any]:
        trimmed = {**payload}
        while estimate_tokens(trimmed) > max_tokens and trimmed.get("memories"):
            trimmed["memories"] = trimmed["memories"][1:]
        while estimate_tokens(trimmed) > max_tokens and trimmed.get("recent_messages"):
            trimmed["recent_messages"] = trimmed["recent_messages"][1:]
        while estimate_tokens(trimmed) > max_tokens and trimmed.get("evidence"):
            trimmed["evidence"] = trimmed["evidence"][:-1]
        trimmed["estimated_tokens"] = estimate_tokens(trimmed)
        trimmed["context_sources"] = {
            **(trimmed.get("context_sources") or {}),
            "recent_messages": len(trimmed.get("recent_messages") or []),
            "memories": len(trimmed.get("memories") or []),
            "evidence": len(trimmed.get("evidence") or []),
            "estimated_tokens": trimmed["estimated_tokens"],
            "trimmed": True,
        }
        return trimmed


context_builder = ContextBuilder()
