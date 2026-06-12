"""Short-term and long-term AI memory helpers."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relational import AIAgentRun, AIConversation, AIMemoryEntry, AIMessage

from .tenant_context import require_tenant_id


def conversation_memory_key(user_id: str | None, session_id: str | None, tenant_id: int | None = None) -> str:
    tenant = tenant_id if tenant_id is not None else "default"
    return f"{tenant}:{user_id or 'anonymous'}:{session_id or 'default'}"


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


SECRET_MARKERS = ("api_key", "apikey", "password", "passwd", "secret", "token", "sk-")


class MemoryService:
    def contains_secret(self, text: str) -> bool:
        normalized = text.lower()
        return any(marker in normalized for marker in SECRET_MARKERS)

    async def append_turn_memory(
        self,
        session: AsyncSession,
        *,
        conversation: AIConversation,
        run: AIAgentRun,
        user_message: AIMessage,
        assistant_message: AIMessage,
        evidence: list[dict[str, Any]],
        tenant_id: int | None = None,
        user_key: str | None = None,
        status: str = "candidate",
    ) -> AIMemoryEntry:
        tenant_id = require_tenant_id({"tenant_id": tenant_id or getattr(conversation, "tenant_id", None)})
        summary = assistant_message.content[:500]
        value = {
            "last_user_message": user_message.content,
            "last_answer": assistant_message.content,
            "evidence_count": len(evidence),
            "source_message_ids": [user_message.message_id, assistant_message.message_id],
        }
        memory = AIMemoryEntry(
            memory_id=f"mem-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation.conversation_id,
            scope="conversation",
            key="last_agent_turn",
            value=value,
            summary=summary,
            status=status,
        )
        self.apply_optional_runtime_fields(
            memory,
            tenant_id=tenant_id,
            user_key=user_key or conversation.user_id,
            page=conversation.page,
            document_id=conversation.document_id,
            run_id=run.run_id,
            user_message_id=user_message.message_id,
            assistant_message_id=assistant_message.message_id,
            memory_type="turn_summary",
            content=summary,
            confidence=0.7,
            importance_score=0.4,
            visibility="private",
            sensitivity="normal",
            content_hash=_content_hash(summary),
        )
        session.add(memory)
        return memory

    async def compact_conversation(
        self,
        session: AsyncSession,
        *,
        conversation: AIConversation,
        tenant_id: int | None = None,
        user_key: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> AIMemoryEntry | None:
        tenant_id = require_tenant_id({"tenant_id": tenant_id or getattr(conversation, "tenant_id", None)})
        compaction_policy = (settings or {}).get("compactionPolicy") or {}
        memory_policy = (settings or {}).get("memoryPolicy") or {}
        safety_policy = (settings or {}).get("safetyPolicy") or {}
        if not compaction_policy.get("enabled", True):
            return None

        rows = (
            await session.execute(
                select(AIMessage)
                .where(AIMessage.conversation_id == conversation.conversation_id)
                .order_by(AIMessage.id)
            )
        ).scalars().all()
        if not rows:
            return None

        last_compacted = (conversation.metadata_json or {}).get("last_compacted_message_id")
        if last_compacted:
            rows = self._after_message(rows, str(last_compacted))
        if len(rows) < 2:
            return None

        transcript = "\n".join(f"{row.role}: {row.content}" for row in rows)
        if safety_policy.get("blockSecretMemory", True) and self.contains_secret(transcript):
            return None

        summary = self._local_compaction_summary(transcript, compaction_policy.get("summaryDetail") or "standard")
        memory = AIMemoryEntry(
            memory_id=f"mem-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation.conversation_id,
            scope="conversation",
            key="conversation_compaction",
            value={
                "summary": summary,
                "source_message_ids": [row.message_id for row in rows],
                "message_count": len(rows),
            },
            summary=summary,
            status="active" if memory_policy.get("enabled") else "candidate",
        )
        self.apply_optional_runtime_fields(
            memory,
            tenant_id=tenant_id,
            user_key=user_key or conversation.user_id,
            page=conversation.page,
            document_id=conversation.document_id,
            memory_type="summary",
            content=summary,
            confidence=0.8,
            importance_score=0.5,
            visibility=memory_policy.get("defaultVisibility") or "private",
            sensitivity="normal",
            content_hash=_content_hash(summary),
        )
        conversation.metadata_json = {
            **(conversation.metadata_json or {}),
            "last_compacted_message_id": rows[-1].message_id,
            "last_compacted_at": datetime.now().isoformat(),
            "memory_version": int((conversation.metadata_json or {}).get("memory_version") or 0) + 1,
        }
        session.add(memory)
        return memory

    async def maybe_compact_conversation(
        self,
        session: AsyncSession,
        *,
        conversation: AIConversation,
        tenant_id: int | None = None,
        user_key: str | None = None,
        settings: dict[str, Any] | None = None,
        force: bool = False,
    ) -> AIMemoryEntry | None:
        tenant_id = require_tenant_id({"tenant_id": tenant_id or getattr(conversation, "tenant_id", None)})
        policy = (settings or {}).get("compactionPolicy") or {}
        if not policy.get("enabled", True):
            return None
        rows = (
            await session.execute(
                select(AIMessage.message_id, AIMessage.content)
                .where(AIMessage.conversation_id == conversation.conversation_id)
                .order_by(AIMessage.id)
            )
        ).all()
        trigger_count = int(policy.get("triggerMessageCount") or 20)
        trigger_tokens = int(policy.get("triggerTokenCount") or 12000)
        estimated_tokens = sum(max(1, len(row.content or "") // 4) for row in rows)
        if not force and len(rows) < trigger_count and estimated_tokens < trigger_tokens:
            return None
        return await self.compact_conversation(
            session,
            conversation=conversation,
            tenant_id=tenant_id,
            user_key=user_key,
            settings=settings,
        )

    async def list_user_memories(
        self,
        session: AsyncSession,
        *,
        tenant_id: int | None = None,
        user_key: str,
        include_candidates: bool = True,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        tenant_id = require_tenant_id({"tenant_id": tenant_id})
        stmt = select(AIMemoryEntry)
        if hasattr(AIMemoryEntry, "tenant_id"):
            stmt = stmt.where(AIMemoryEntry.tenant_id == tenant_id)
        if hasattr(AIMemoryEntry, "user_key"):
            stmt = stmt.where(AIMemoryEntry.user_key == user_key)
        if not include_candidates:
            stmt = stmt.where(AIMemoryEntry.status == "active")
        stmt = stmt.order_by(desc(AIMemoryEntry.updated_at)).limit(max(1, min(limit, 100)))
        rows = (await session.execute(stmt)).scalars().all()
        return [self.serialize(row) for row in rows]

    async def delete_user_memory(
        self,
        session: AsyncSession,
        *,
        memory_id: str,
        tenant_id: int | None = None,
        user_key: str,
    ) -> dict[str, Any] | None:
        tenant_id = require_tenant_id({"tenant_id": tenant_id})
        stmt = select(AIMemoryEntry).where(AIMemoryEntry.memory_id == memory_id)
        if hasattr(AIMemoryEntry, "tenant_id"):
            stmt = stmt.where(AIMemoryEntry.tenant_id == tenant_id)
        if hasattr(AIMemoryEntry, "user_key"):
            stmt = stmt.where(AIMemoryEntry.user_key == user_key)
        memory = await session.scalar(stmt)
        if not memory:
            return None
        memory.status = "deleted"
        return self.serialize(memory)

    def _after_message(self, rows: list[AIMessage], message_id: str) -> list[AIMessage]:
        for index, row in enumerate(rows):
            if row.message_id == message_id:
                return rows[index + 1:]
        return rows

    def _local_compaction_summary(self, transcript: str, detail: str) -> str:
        limit = 1200 if detail == "detailed" else 800 if detail == "standard" else 420
        lines = [line.strip() for line in transcript.splitlines() if line.strip()]
        body = "\n".join(lines[-12:])
        if len(body) > limit:
            body = f"{body[:limit].rstrip()}..."
        return f"会话摘要：{body}"

    async def retrieve_context(
        self,
        session: AsyncSession,
        *,
        tenant_id: int | None = None,
        user_key: str | None = None,
        conversation_id: str | None = None,
        page: str | None = None,
        document_id: str | None = None,
        query: str | None = None,
        limit: int = 8,
    ) -> list[dict[str, Any]]:
        tenant_id = require_tenant_id({"tenant_id": tenant_id})
        stmt = select(AIMemoryEntry).where(AIMemoryEntry.status == "active")
        if conversation_id:
            stmt = stmt.where(AIMemoryEntry.conversation_id == conversation_id)
        if hasattr(AIMemoryEntry, "tenant_id"):
            stmt = stmt.where(AIMemoryEntry.tenant_id == tenant_id)
        if user_key and hasattr(AIMemoryEntry, "user_key"):
            stmt = stmt.where(or_(AIMemoryEntry.user_key == user_key, AIMemoryEntry.user_key.is_(None)))
        if page and hasattr(AIMemoryEntry, "page"):
            stmt = stmt.where(or_(AIMemoryEntry.page == page, AIMemoryEntry.page.is_(None)))
        if document_id and hasattr(AIMemoryEntry, "document_id"):
            stmt = stmt.where(or_(AIMemoryEntry.document_id == document_id, AIMemoryEntry.document_id.is_(None)))
        stmt = stmt.order_by(desc(AIMemoryEntry.updated_at)).limit(max(1, min(limit, 20)))
        rows = (await session.execute(stmt)).scalars().all()
        return [self.serialize(row) for row in rows]

    def build_prompt_context(self, memories: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "memory_id": item.get("memory_id"),
                "scope": item.get("scope"),
                "summary": item.get("summary"),
                "memory_type": item.get("memory_type"),
            }
            for item in memories
            if item.get("summary")
        ]

    def serialize(self, memory: AIMemoryEntry) -> dict[str, Any]:
        payload = {
            "memory_id": memory.memory_id,
            "conversation_id": memory.conversation_id,
            "scope": memory.scope,
            "key": memory.key,
            "value": memory.value,
            "summary": memory.summary,
            "status": memory.status,
        }
        for name in [
            "tenant_id",
            "user_key",
            "page",
            "document_id",
            "run_id",
            "memory_type",
            "content",
            "tags",
            "importance_score",
            "confidence",
            "visibility",
            "sensitivity",
        ]:
            if hasattr(memory, name):
                payload[name] = getattr(memory, name)
        return payload

    def apply_optional_runtime_fields(self, memory: AIMemoryEntry, **fields: Any) -> None:
        for key, value in fields.items():
            if hasattr(memory, key):
                setattr(memory, key, value)

    async def export_vault(
        self,
        session: AsyncSession,
        *,
        tenant_id: int,
        root: str | Path,
        user_key: str | None = None,
    ) -> dict[str, Any]:
        target_root = Path(root).resolve()
        target_root.mkdir(parents=True, exist_ok=True)
        memories = await self.retrieve_context(session, tenant_id=tenant_id, user_key=user_key, limit=100)
        manifest: dict[str, Any] = {"tenant_id": tenant_id, "generated_at": datetime.now().isoformat(), "files": []}
        memories_dir = target_root / "memories"
        memories_dir.mkdir(exist_ok=True)
        for item in memories:
            if item.get("sensitivity") == "restricted":
                continue
            memory_id = str(item["memory_id"])
            path = memories_dir / f"{memory_id}.md"
            body = self._memory_markdown(item)
            path.write_text(body, encoding="utf-8")
            manifest["files"].append({"memory_id": memory_id, "path": str(path), "checksum": _content_hash(body)})
        (target_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return manifest

    def _memory_markdown(self, item: dict[str, Any]) -> str:
        frontmatter = {
            "memory_id": item.get("memory_id"),
            "tenant_id": item.get("tenant_id"),
            "user_key": item.get("user_key"),
            "conversation_id": item.get("conversation_id"),
            "document_id": item.get("document_id"),
            "memory_type": item.get("memory_type"),
            "status": item.get("status"),
            "readonly": True,
        }
        header = "\n".join(["---", *[f"{key}: {value}" for key, value in frontmatter.items() if value is not None], "---"])
        return f"{header}\n\n# {item.get('key') or item.get('memory_id')}\n\n{item.get('summary') or ''}\n"


memory_service = MemoryService()
