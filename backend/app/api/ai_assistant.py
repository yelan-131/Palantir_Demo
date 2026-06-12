"""AI Assistant API backed by explicit runtime storage and provider configuration."""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import desc, select

from app.api.deps import current_tenant_id, current_user_id, get_current_user, require_admin
from app.core.db import db_session
from app.core.production_errors import database_unavailable, seed_data_required
from app.models.relational import AIAgentRun, AIConversation, AIDraft, AIMessage, AIToolCall
from app.services.ai.agent_runs import cancel_agent_run, confirm_agent_run, create_agent_run, get_agent_run
from app.services.ai.agent_registry import AgentRegistryError, load_agent_registry, save_agent_registry_payload, seed_agent_registry_from_files
from app.services.ai.agent_items import (
    confirmation_item,
    extract_actions,
    extract_confirmation_payload,
    from_legacy_step,
    items_from_steps,
)
from app.services.ai.audit import list_ai_audit_logs, record_ai_event
from app.services.ai.client import get_provider
from app.services.ai.confirmations import consume_confirmation_token
from app.services.ai.agent_context_router import agent_context_router
from app.services.ai.context_builder import context_builder
from app.services.ai.dynamic_record_drafts import create_dynamic_record_draft_from_agent
from app.services.ai.memory import memory_service
from app.services.ai.orchestrator import run_agent
from app.services.ai.policies import decide_ai_permission, decide_skill_permission
from app.services.ai.providers import ProviderConfigurationError
from app.services.ai.runtime import agent_runtime
from app.services.ai.schemas import AIProviderConfig, AgentRequest, AgentResponse, ChatMessage, ChatOptions, DraftSaveRequest
from app.services.ai.settings import (
    AI_SYSTEM_SETTINGS,
    audit_enabled,
    load_persisted_ai_settings,
    mask_settings as _mask_settings,
    maybe_mask_sensitive_payload,
    merge_ai_settings,
    record_tool_calls_enabled,
    save_persisted_ai_settings,
    settings_to_provider_config as _settings_to_provider_config,
)
from app.services.ai.skills import list_skills
from app.services.ai.tenant_context import require_tenant_id
from app.services.ai.tool_executor import agent_tool_executor
from app.services.ai.tool_registry import list_tools

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


class AnalyzeRequest(BaseModel):
    query: str
    entity_type: str | None = None
    entity_id: int | None = None


class ProviderTestRequest(BaseModel):
    provider_config: AIProviderConfig


class AISettingsRequest(BaseModel):
    settings: dict


class AIAgentRegistryRequest(BaseModel):
    skills: dict[str, Any] | list[dict[str, Any]]
    tools: dict[str, Any] | list[dict[str, Any]]


class AgentRunConfirmRequest(BaseModel):
    confirmation_token: str | None = None
    confirmed: bool = True


class AgentConversationRequest(BaseModel):
    title: str | None = None
    page: str | None = None
    document_id: str | None = None
    document_title: str | None = None
    context: dict[str, Any] | None = None


class AgentConversationUpdateRequest(BaseModel):
    title: str | None = None
    status: str | None = None


def _roles_for_user(user: dict) -> list[dict]:
    if user.get("roles"):
        return user["roles"]
    if user.get("is_admin"):
        return [{"name": "admin", "label": "Admin"}]
    return []


def _normalize_user(user: dict) -> dict:
    normalized = {**user}
    normalized["roles"] = _roles_for_user(normalized)
    return normalized


def _user_key(user: dict[str, Any]) -> str:
    return str(user.get("sub") or user.get("username") or user.get("uid") or "guest")


def _now_iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value.isoformat() if hasattr(value, "isoformat") else None


def _serialize_conversation(row: AIConversation) -> dict[str, Any]:
    return {
        "id": row.conversation_id,
        "tenant_id": row.tenant_id,
        "conversation_id": row.conversation_id,
        "user_id": row.user_id,
        "page": row.page,
        "document_id": row.document_id,
        "title": row.title,
        "status": row.status,
        "last_message": row.last_message,
        "metadata": row.metadata_json or {},
        "created_at": _now_iso(row.created_at),
        "updated_at": _now_iso(row.updated_at),
    }


def _serialize_message(row: AIMessage, run: AIAgentRun | None = None) -> dict[str, Any]:
    payload = {
        "id": row.message_id,
        "tenant_id": row.tenant_id,
        "message_id": row.message_id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "content": row.content,
        "evidence": row.evidence or [],
        "model_name": row.model_name,
        "usage": row.usage,
        "status": row.status,
        "error": row.error,
        "created_at": _now_iso(row.created_at),
        "updated_at": _now_iso(row.updated_at),
    }
    if run:
        items = getattr(run, "items", None) or []
        payload.update(
            {
                "run_id": run.run_id,
                "mode": run.mode,
                "items": items,
                "risk_level": run.risk_level,
                "requires_confirmation": run.requires_confirmation,
                "run_status": run.status,
            }
        )
    return payload


def _serialize_run(row: AIAgentRun) -> dict[str, Any]:
    items = getattr(row, "items", None) or []
    return {
        "id": row.run_id,
        "tenant_id": row.tenant_id,
        "run_id": row.run_id,
        "conversation_id": row.conversation_id,
        "user_message_id": row.user_message_id,
        "assistant_message_id": row.assistant_message_id,
        "status": row.status,
        "mode": row.mode,
        "input_message": row.input_message,
        "answer": row.answer,
        "items": items,
        "evidence": row.evidence or [],
        "risk_level": row.risk_level,
        "requires_confirmation": row.requires_confirmation,
        "created_at": _now_iso(row.created_at),
        "updated_at": _now_iso(row.updated_at),
    }


def _public_agent_run(run: dict[str, Any]) -> dict[str, Any]:
    items = run.get("items") if isinstance(run.get("items"), list) else []
    if not items and isinstance(run.get("steps"), list):
        items = items_from_steps(run.get("steps"), run_id=str(run.get("run_id") or ""))
    return {
        key: value
        for key, value in {
            **run,
            "items": items,
        }.items()
        if key not in {"steps", "actions", "confirmation_payload"}
    }


def _raise_for_ai_decision(decision):
    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.reason or "AI action is not allowed")


def _audit_ai_event(user: dict, event_type: str, payload: dict):
    if not audit_enabled(AI_SYSTEM_SETTINGS):
        return None
    return record_ai_event(user, event_type, maybe_mask_sensitive_payload(payload, AI_SYSTEM_SETTINGS))


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _agent_note_for_step(step: dict[str, Any]) -> str | None:
    step_id = str(step.get("id") or "")
    if step_id == "step-identity":
        return "我先确认当前用户和权限边界。"
    if step_id == "step-ai-permission":
        return "权限检查通过后，我再继续读取上下文和业务信息。"
    if step_id == "step-context-intent":
        return "我会先判断这次问题需要普通对话、知识检索，还是业务数据上下文。"
    if step_id == "step-context-builder":
        sources = step.get("sources") if isinstance(step.get("sources"), dict) else {}
        return (
            "我已把最近消息、记忆和证据整理进本轮上下文。"
            if sources
            else "我已整理本轮可用的对话上下文。"
        )
    if step_id == "step-planner":
        return "我已经规划好接下来要走的任务路径。"
    if step_id == "step-knowledge-search":
        count = step.get("result_count")
        return f"我先检索知识库和证据，找到了 {count} 条相关结果。" if count is not None else "我先检索知识库和证据。"
    if step_id == "step-tool-contract":
        tool = step.get("tool") or "目标工具"
        return f"在准备执行前，我读取了 {tool} 的工具合约，确认必填字段和写入边界。"
    if step_id == "step-skill-selection":
        skill = step.get("skill")
        return f"我选择用 {skill} 来处理这个动作。" if skill else "我已选择可用工具来处理这个动作。"
    if step_id.startswith("step-skill-policy"):
        return "我又复核了一次工具权限，写入类动作会等待你确认。"
    if step_id == "step-confirmation":
        return "我已经整理好待确认动作，确认前不会写入系统。"
    if step_id == "step-answer":
        return "工具和上下文都整理完了，我开始生成最终回复。"
    if str(step.get("type") or "") == "tool":
        tool = step.get("tool")
        return f"我调用 {tool} 获取结果。" if tool else "我调用工具获取结果。"
    return None


def _tool_event_payload(step: dict[str, Any]) -> dict[str, Any] | None:
    if str(step.get("type") or "") != "tool":
        return None
    tool = step.get("tool")
    if not tool:
        return None
    payload = {
        "step_id": step.get("id"),
        "tool": tool,
        "status": step.get("status") or "completed",
    }
    if step.get("result_count") is not None:
        payload["result_count"] = step.get("result_count")
    if step.get("summary"):
        payload["summary"] = step.get("summary")
    return payload


async def _emit_agent_step(event_sink, step: dict[str, Any]) -> None:
    if event_sink:
        item = step if "item_id" in step and "payload" in step else from_legacy_step(step)
        note = _agent_note_for_step(step)
        if note:
            await event_sink("assistant.note", {"message": note, "item_id": item.get("item_id")})
        await event_sink("item.updated", item)


async def _execute_confirmed_agent_run(
    run: dict[str, Any],
    current_user: dict[str, Any],
    event_sink=None,
) -> dict[str, Any]:
    """Execute supported confirmed Agent actions through registered backend tools."""

    return await agent_tool_executor.execute_confirmed_run(
        run,
        current_user=current_user,
        persist_ai_draft=_persist_ai_draft,
        update_ai_draft_status=_update_ai_draft_status,
        audit_ai_event=_audit_ai_event if record_tool_calls_enabled(AI_SYSTEM_SETTINGS) else None,
        event_sink=event_sink,
        settings=AI_SYSTEM_SETTINGS,
    )


async def _persist_ai_draft(
    current_user: dict[str, Any],
    *,
    skill: str,
    payload: dict[str, Any],
    evidence: list[dict[str, Any]] | None = None,
    source: str = "manual_save",
    run_id: str | None = None,
) -> dict[str, Any]:
    draft_id = f"draft-{uuid.uuid4().hex[:12]}"
    record = {
        "draft_id": draft_id,
        "status": "draft",
        "skill": skill,
        "payload": payload,
        "evidence": evidence or [],
        "created_by": _user_key(current_user),
        "created_at": datetime.now().isoformat(),
        "source": source,
        "run_id": run_id or None,
        "persisted": False,
    }
    try:
        async with db_session() as session:
            draft = AIDraft(
                tenant_id=current_tenant_id(current_user),
                draft_id=draft_id,
                skill=skill,
                status="draft",
                payload=payload,
                evidence=evidence or [],
                source=source,
                run_id=run_id or None,
                created_by=_user_key(current_user),
                metadata_json={},
            )
            session.add(draft)
            await session.commit()
            await session.refresh(draft)
            record["persisted"] = True
            record["id"] = draft.id
            record["created_at"] = _now_iso(draft.created_at) or record["created_at"]
    except SQLAlchemyError as exc:
        raise database_unavailable("AI draft storage is unavailable") from exc
    return record


async def _load_ai_draft_for_user(
    *,
    draft_id: str,
    current_user: dict[str, Any],
) -> dict[str, Any] | None:
    tenant_id = current_tenant_id(current_user)
    user_key = _user_key(current_user)
    try:
        async with db_session() as session:
            row = (
                await session.execute(
                    select(AIDraft).where(
                        AIDraft.tenant_id == tenant_id,
                        AIDraft.draft_id == draft_id,
                        AIDraft.created_by == user_key,
                    )
                )
            ).scalar_one_or_none()
            if not row:
                return None
            return {
                "id": row.id,
                "draft_id": row.draft_id,
                "status": row.status,
                "skill": row.skill,
                "payload": row.payload or {},
                "evidence": row.evidence or [],
                "source": row.source,
                "run_id": row.run_id,
                "created_by": row.created_by,
                "created_at": _now_iso(row.created_at),
                "metadata": row.metadata_json or {},
                "persisted": True,
            }
    except SQLAlchemyError as exc:
        raise database_unavailable("AI draft storage is unavailable") from exc
    return None


async def _update_ai_draft_status(
    *,
    draft_id: str | None,
    current_user: dict[str, Any],
    status: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    if not draft_id:
        return
    tenant_id = current_tenant_id(current_user)
    user_key = _user_key(current_user)
    try:
        async with db_session() as session:
            row = await session.scalar(
                select(AIDraft).where(
                    AIDraft.tenant_id == tenant_id,
                    AIDraft.draft_id == draft_id,
                    AIDraft.created_by == user_key,
                )
            )
            if not row:
                return
            row.status = status
            row.metadata_json = {**(row.metadata_json or {}), **(metadata or {})}
            await session.commit()
    except SQLAlchemyError as exc:
        raise database_unavailable("AI draft storage is unavailable") from exc


async def _sync_persisted_agent_run_final_state(
    run_id: str,
    current_user: dict[str, Any],
    *,
    status: str,
    run_state: dict[str, Any] | None = None,
    clear_pending_action_state: bool = True,
) -> None:
    tenant_id = current_tenant_id(current_user)
    try:
        async with db_session() as session:
            persisted_run = await session.scalar(
                select(AIAgentRun).where(
                    AIAgentRun.tenant_id == tenant_id,
                    AIAgentRun.run_id == run_id,
                )
            )
            if not persisted_run:
                return
            persisted_run.status = status
            if run_state and isinstance(run_state.get("items"), list):
                persisted_run.items = run_state["items"]
            if status in {"completed", "cancelled"}:
                persisted_run.requires_confirmation = False
            conversation = await session.scalar(
                select(AIConversation).where(
                    AIConversation.tenant_id == tenant_id,
                    AIConversation.conversation_id == persisted_run.conversation_id,
                    AIConversation.user_id == _user_key(current_user),
                )
            )
            if conversation and clear_pending_action_state:
                metadata = dict(conversation.metadata_json or {})
                metadata.pop("pending_action_state", None)
                conversation.metadata_json = metadata
            await session.commit()
    except SQLAlchemyError:
        return


async def _load_persisted_agent_run_for_confirmation(
    run_id: str,
    token: str,
    current_user: dict[str, Any],
) -> dict[str, Any]:
    tenant_id = current_tenant_id(current_user)
    user_key = _user_key(current_user)
    async with db_session() as session:
        row = await session.scalar(
            select(AIAgentRun).where(
                AIAgentRun.tenant_id == tenant_id,
                AIAgentRun.run_id == run_id,
            )
        )
        if not row:
            raise ValueError("Agent run not found")
        if row.status == "cancelled":
            raise ValueError("Cancelled agent runs cannot be confirmed")
        if row.status in {"confirmed", "completed"}:
            raise ValueError("Agent run has already been confirmed")
        items = getattr(row, "items", None) or []
        confirmation_payload = extract_confirmation_payload(items)
        expected_token = str(confirmation_payload.get("confirmation_token") or "")
        if not expected_token or expected_token != token:
            raise ValueError("Confirmation token does not match this agent run")
        if str(confirmation_payload.get("user") or "") != user_key:
            raise ValueError("Confirmation token does not belong to the current user")
        expires_at = confirmation_payload.get("expires_at")
        if expires_at:
            try:
                if datetime.fromisoformat(str(expires_at)) < datetime.now():
                    raise ValueError("Confirmation token has expired")
            except ValueError as exc:
                if "expired" in str(exc):
                    raise
        return {
            "run_id": row.run_id,
            "status": "confirmed",
            "mode": row.mode,
            "message": row.input_message,
            "page": None,
            "context": {},
            "answer": row.answer,
            "evidence": row.evidence or [],
            "items": items,
            "actions": extract_actions(items),
            "requires_confirmation": row.requires_confirmation,
            "risk_level": row.risk_level,
            "created_by": user_key,
            "created_at": row.created_at.isoformat() if row.created_at else datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "confirmation": {**confirmation_payload, "status": "confirmed", "confirmed_at": datetime.now().isoformat()},
        }


# Simulated AI responses based on intent detection
INTENT_RESPONSES = {
    "oee": {
        "keywords": ["OEE", "oee", "设备综合效率", "综合效率"],
        "handler": "handle_oee_query",
    },
    "equipment": {
        "keywords": ["设备", "健康", "故障", "维修", "machine", "health"],
        "handler": "handle_equipment_query",
    },
    "production": {
        "keywords": ["产量", "产能", "排产", "工单", "production"],
        "handler": "handle_production_query",
    },
    "quality": {
        "keywords": ["质量", "缺陷", "良率", "SPC", "quality", "检验"],
        "handler": "handle_quality_query",
    },
    "supply": {
        "keywords": ["供应链", "库存", "供应商", "物流", "supply"],
        "handler": "handle_supply_query",
    },
}


def detect_intent(message: str) -> str:
    for intent, config in INTENT_RESPONSES.items():
        for kw in config["keywords"]:
            if kw in message:
                return intent
    return "general"


async def handle_oee_query(message: str) -> dict:
    async def _query(db):
        from app.models.relational import ProductionLine

        result = await db.execute(select(ProductionLine))
        lines = result.scalars().all()
        if not lines:
            return None
        line_data = [
            {"line": line.name, "oee_target": f"{float(line.oee_target or 0) * 100:.1f}%"}
            for line in lines
        ]
        return {
            "answer": "Current production-line OEE targets:\n" + "\n".join(f"- {d['line']}: {d['oee_target']}" for d in line_data),
            "data": line_data,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    raise seed_data_required("Production line seed data is required for OEE questions")

async def handle_equipment_query(message: str) -> dict:
    async def _query(db):
        from app.models.relational import Equipment

        result = await db.execute(select(Equipment).where(Equipment.health_score < 80).order_by(Equipment.health_score))
        low_health = result.scalars().all()
        if not low_health:
            return None
        eq_data = [{"name": item.name, "score": round(float(item.health_score or 0), 1)} for item in low_health[:5]]
        return {
            "answer": f"Equipment requiring attention: {len(low_health)}\n" + "\n".join(f"- {item['name']}: health {item['score']}" for item in eq_data),
            "data": eq_data,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    raise seed_data_required("Equipment seed data is required for equipment questions")

async def handle_production_query(message: str) -> dict:
    async def _query(db):
        from app.models.relational import WorkOrder

        wo_result = await db.execute(select(WorkOrder))
        work_orders = wo_result.scalars().all()
        if not work_orders:
            return None
        total = len(work_orders)
        in_progress = sum(1 for item in work_orders if item.status == "in_progress")
        return {
            "answer": f"Current work-order status: {total} total, {in_progress} in progress, {total - in_progress} completed or pending.",
            "data": {"total": total, "in_progress": in_progress},
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    raise seed_data_required("Work order seed data is required for production questions")

async def handle_quality_query(message: str) -> dict:
    raise seed_data_required("Quality question handling requires migrated quality seed data")

async def handle_supply_query(message: str) -> dict:
    raise seed_data_required("Supply-chain question handling requires migrated supply seed data")

# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


async def _run_agent_for_user(body: AgentRequest, current_user: dict, event_sink=None):
    await load_persisted_ai_settings()
    identity_step = {
        "id": "step-identity",
        "type": "identity",
        "status": "completed",
        "user": current_user.get("sub") or current_user.get("username") or "unknown",
        "roles": [role.get("name") if isinstance(role, dict) else role for role in current_user.get("roles", [])],
        "is_admin": bool(current_user.get("is_admin")),
    }
    await _emit_agent_step(event_sink, identity_step)
    base_decision = decide_ai_permission(current_user, AI_SYSTEM_SETTINGS, "qa", risk_level="low")
    _raise_for_ai_decision(base_decision)
    ai_permission_step = {
        "id": "step-ai-permission",
        "type": "policy",
        "status": "completed",
        "capability": base_decision.capability,
        "matched_role": base_decision.matched_role,
        "requires_confirmation": base_decision.requires_confirmation,
        "audit_required": base_decision.audit_required,
    }
    await _emit_agent_step(event_sink, ai_permission_step)
    if body.provider_config is None:
        body.provider_config = _settings_to_provider_config(AI_SYSTEM_SETTINGS)
    context = body.context or {}
    context["_current_user"] = current_user
    context["_tenant_id"] = current_tenant_id(current_user)
    context["_user_key"] = _user_key(current_user)
    resume_draft_id = context.get("resumeDraftId") or context.get("resume_draft_id")
    if resume_draft_id and not context.get("resumeDraft"):
        draft_record = await _load_ai_draft_for_user(draft_id=str(resume_draft_id), current_user=current_user)
        if not draft_record:
            raise HTTPException(status_code=404, detail="待确认操作不存在")
        if draft_record.get("status") in {"executed", "cancelled"}:
            raise HTTPException(status_code=409, detail="待确认操作已不可编辑")
        decision = decide_ai_permission(current_user, AI_SYSTEM_SETTINGS, "draft", risk_level="medium")
        _raise_for_ai_decision(decision)
        resume_step = {
            "id": "step-draft-resume",
            "type": "context",
            "status": "completed",
            "draft_id": draft_record.get("draft_id"),
            "skill": draft_record.get("skill"),
            "draft_status": draft_record.get("status"),
        }
        await _emit_agent_step(event_sink, resume_step)
        await _update_ai_draft_status(
            draft_id=str(resume_draft_id),
            current_user=current_user,
            status="reviewing",
            metadata={"last_resumed_at": datetime.now().isoformat()},
        )
        draft_record["status"] = "reviewing"
        context["resumeDraft"] = draft_record
        if not context.get("pendingActionState"):
            payload = draft_record.get("payload") if isinstance(draft_record.get("payload"), dict) else {}
            payload = {**payload, "_source_draft_id": draft_record.get("draft_id")}
            context["pendingActionState"] = {
                "status": "ready_for_confirmation",
                "skill": draft_record.get("skill"),
                "source_message": payload.get("source_message") or body.message,
                "collected_slots": payload,
                "missing_slots": [],
                "notes": [f"resume pending action {draft_record.get('draft_id')}"],
            }
            context["pending_action_state"] = context["pendingActionState"]
    conversation_id = context.get("conversation_id") or context.get("conversationId")
    if conversation_id and not context.get("recentMessages"):
        tenant_id = current_tenant_id(current_user)
        user_key = _user_key(current_user)
        async with db_session() as session:
            conversation = await session.scalar(
                select(AIConversation).where(
                    AIConversation.tenant_id == tenant_id,
                    AIConversation.conversation_id == str(conversation_id),
                    AIConversation.user_id == user_key,
                    AIConversation.status == "active",
                )
            )
            if conversation:
                pending_action_state = (conversation.metadata_json or {}).get("pending_action_state")
                if pending_action_state and not context.get("pendingActionState"):
                    context["pendingActionState"] = pending_action_state
                    context["pending_action_state"] = pending_action_state
                rows = (
                    await session.execute(
                        select(AIMessage)
                        .where(AIMessage.tenant_id == tenant_id, AIMessage.conversation_id == str(conversation_id))
                        .order_by(desc(AIMessage.id))
                        .limit(8)
                    )
                ).scalars().all()
                context["recentMessages"] = [
                    {"role": row.role, "content": row.content}
                    for row in reversed(rows)
                    if row.role in {"user", "assistant"}
                ]
    body.context = context
    if (body.context or {}).get("surface") == "knowledge":
        result = await _run_knowledge_agent_surface_with_context(body)
    else:
        context_need = agent_context_router.classify(body.message, body.context)
        semantic_context: dict[str, Any] = {"intent": context_need, "objects": [], "records": [], "relations": []}
        if context_need in {"business_query", "visible_dataset", "current_object", "semantic_graph", "draft_action"}:
            async with db_session() as session:
                semantic_context = await agent_context_router.build_semantic_context(
                    session,
                    message=body.message,
                    context=body.context or {},
                    tenant_id=current_tenant_id(current_user),
                )
            body.context = {
                **(body.context or {}),
                "contextNeed": context_need,
                "semanticContext": semantic_context,
            }
        context_intent_step = {
            "id": "step-context-intent",
            "type": "context",
            "status": "completed",
            "intent": context_need,
            "semantic_objects": len(semantic_context.get("objects") or []),
            "semantic_records": semantic_context.get("record_count", 0),
        }
        await _emit_agent_step(event_sink, context_intent_step)
        result = await run_agent(body, current_user, event_sink=event_sink)
        result.items.insert(0, from_legacy_step(context_intent_step, run_id=result.run_id))
        conversation_id = (body.context or {}).get("conversation_id") or (body.context or {}).get("conversationId")
        if conversation_id:
            async with db_session() as session:
                runtime_context = await context_builder.build(
                    session,
                    request=body,
                    user=current_user,
                    settings=AI_SYSTEM_SETTINGS,
                    conversation_id=str(conversation_id),
                    page=(body.context or {}).get("route") or body.page,
                    document_id=(body.context or {}).get("document_id") or (body.context or {}).get("documentId"),
                    tenant_id=current_tenant_id(current_user),
                    user_key=_user_key(current_user),
                    evidence=result.evidence,
                )
            context_builder_step = {
                "id": "step-context-builder",
                "type": "context",
                "status": "completed",
                "sources": runtime_context.get("context_sources") or {},
                "semantic_context": runtime_context.get("semantic_context") or {},
            }
            result.items.insert(0, from_legacy_step(context_builder_step, run_id=result.run_id))
            await _emit_agent_step(event_sink, context_builder_step)
    result.items = [
        from_legacy_step(identity_step, run_id=result.run_id),
        from_legacy_step(ai_permission_step, run_id=result.run_id),
        *result.items,
    ]
    for action in result.actions:
        decision = decide_skill_permission(current_user, AI_SYSTEM_SETTINGS, action)
        _raise_for_ai_decision(decision)
        action.requires_confirmation = action.requires_confirmation or decision.requires_confirmation
        skill_policy_step = {
            "id": f"step-skill-policy-{action.skill}",
            "type": "policy",
            "status": "completed",
            "skill": action.skill,
            "capability": decision.capability,
            "matched_role": decision.matched_role,
            "requires_confirmation": decision.requires_confirmation,
            "audit_required": decision.audit_required,
        }
        result.items.append(from_legacy_step(skill_policy_step, run_id=result.run_id))
        await _emit_agent_step(event_sink, skill_policy_step)
    for internal_key in ("_current_user", "_tenant_id", "_user_key"):
        body.context.pop(internal_key, None)
    run = create_agent_run(body, result, current_user)
    if result.actions:
        _audit_ai_event(
            current_user,
            "agent_actions_prepared",
            {"run_id": run["run_id"], "actions": [action.model_dump() for action in result.actions]},
        )
    else:
        _audit_ai_event(current_user, "agent_qa_completed", {"run_id": run["run_id"], "evidence_count": len(result.evidence)})
    return result


async def _run_knowledge_agent_surface(body: AgentRequest) -> AgentResponse:
    from app.api.knowledge import _document_context_payload_async, _generate_knowledge_agent_answer, _search_knowledge_payload_async

    context = body.context or {}
    document_id = context.get("document_id") or context.get("documentId")
    tenant_id = require_tenant_id(context)
    document_title = context.get("document_title") or context.get("documentTitle") or context.get("pageTitle") or "当前知识文档"
    intent = agent_runtime.classify_knowledge_intent(body.message)
    evidence = await _search_knowledge_payload_async(body.message, limit=5, document_id=document_id, tenant_id=tenant_id) if intent == "knowledge" else []
    if intent == "knowledge" and not evidence and document_id:
        evidence = (await _document_context_payload_async(str(document_id), tenant_id=tenant_id))[:5]
    answer, model_name, usage = await _generate_knowledge_agent_answer(
        query=body.message,
        title=str(document_title),
        evidence=evidence,
        history=[],
        tenant_id=tenant_id,
        memory=[],
        intent=intent,
    )
    steps = [
        {
            "id": "step-knowledge-context",
            "type": "observe",
            "status": "completed",
            "surface": "knowledge",
            "document_id": document_id,
            "document_title": document_title,
        },
        {
            "id": "step-knowledge-search",
            "type": "tool",
            "tool": "knowledge.search",
            "status": "skipped" if intent == "general" else "completed",
            "result_count": len(evidence),
        },
        {
            "id": "step-answer",
            "type": "respond",
            "status": "completed" if usage.get("mode") != "ai_provider_failed" else "failed",
            "model": model_name,
            "provider": usage.get("provider"),
            "fallback_reason": usage.get("fallback_reason"),
        },
    ]
    return AgentResponse(answer=answer, evidence=evidence, steps=steps, mode="qa")


async def _run_knowledge_agent_surface_with_context(body: AgentRequest) -> AgentResponse:
    from app.api.knowledge import _document_context_payload_async, _generate_knowledge_agent_answer, _search_knowledge_payload_async

    context = body.context or {}
    document_id = context.get("document_id") or context.get("documentId")
    document_title = context.get("document_title") or context.get("documentTitle") or context.get("pageTitle") or "当前知识文档"
    conversation_id = context.get("conversation_id") or context.get("conversationId")
    tenant_id = require_tenant_id(context)
    intent = agent_runtime.classify_knowledge_intent(body.message)
    rag_policy = AI_SYSTEM_SETTINGS.get("ragPolicy") or {}
    rag_enabled = rag_policy.get("enabled", True)
    top_k = int(rag_policy.get("topK") or 5)
    evidence = await _search_knowledge_payload_async(body.message, limit=top_k, document_id=document_id, tenant_id=tenant_id) if intent == "knowledge" and rag_enabled else []
    if intent == "knowledge" and not evidence and document_id:
        evidence = (await _document_context_payload_async(str(document_id), tenant_id=tenant_id))[:top_k]
    async with db_session() as session:
        runtime_context = await context_builder.build(
            session,
            request=body,
            user=context.get("_current_user") or {},
            settings=AI_SYSTEM_SETTINGS,
            conversation_id=str(conversation_id) if conversation_id else None,
            page=context.get("route") or body.page,
            document_id=str(document_id) if document_id else None,
            tenant_id=tenant_id,
            user_key=context.get("_user_key"),
            evidence=evidence,
        )
    answer, model_name, usage = await _generate_knowledge_agent_answer(
        query=body.message,
        title=str(document_title),
        evidence=evidence,
        history=[],
        tenant_id=tenant_id,
        memory=runtime_context.get("memories") or [],
        intent=intent,
    )
    steps = [
        {
            "id": "step-knowledge-context",
            "type": "observe",
            "status": "completed",
            "surface": "knowledge",
            "document_id": document_id,
            "document_title": document_title,
        },
        {
            "id": "step-context-builder",
            "type": "context",
            "status": "completed",
            "sources": runtime_context.get("context_sources") or {},
        },
        {
            "id": "step-knowledge-search",
            "type": "tool",
            "tool": "knowledge.search",
            "status": "skipped" if intent == "general" or not rag_enabled else "completed",
            "result_count": len(evidence),
        },
        {
            "id": "step-answer",
            "type": "respond",
            "status": "completed" if usage.get("mode") != "ai_provider_failed" else "failed",
            "model": model_name,
            "provider": usage.get("provider"),
            "fallback_reason": usage.get("fallback_reason"),
        },
    ]
    return AgentResponse(answer=answer, evidence=evidence, steps=steps, mode="qa")


async def _persist_agent_turn(body: AgentRequest, result: AgentResponse, current_user: dict) -> dict[str, Any] | None:
    if not audit_enabled(AI_SYSTEM_SETTINGS):
        return None
    conversation_id = str((body.context or {}).get("conversation_id") or (body.context or {}).get("conversationId") or "")
    if not conversation_id:
        return None

    user_key = _user_key(current_user)
    tenant_id = current_tenant_id(current_user)
    async with db_session() as session:
        conversation = await session.scalar(
            select(AIConversation).where(
                AIConversation.tenant_id == tenant_id,
                AIConversation.conversation_id == conversation_id,
                AIConversation.user_id == user_key,
                AIConversation.status == "active",
            )
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Agent conversation not found")

        safe_message = str(maybe_mask_sensitive_payload(body.message, AI_SYSTEM_SETTINGS))
        safe_answer = str(maybe_mask_sensitive_payload(result.answer, AI_SYSTEM_SETTINGS))
        safe_evidence = maybe_mask_sensitive_payload(result.evidence, AI_SYSTEM_SETTINGS)
        safe_items = maybe_mask_sensitive_payload(result.items, AI_SYSTEM_SETTINGS)
        user_message = AIMessage(
            tenant_id=tenant_id,
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            role="user",
            content=safe_message,
            evidence=[],
            status="completed",
        )
        assistant_message = AIMessage(
            tenant_id=tenant_id,
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            role="assistant",
            content=safe_answer,
            evidence=safe_evidence,
            model_name=next(
                (
                    str(item.get("model") or (item.get("payload") or {}).get("model"))
                    for item in reversed(result.items)
                    if item.get("type") == "answer" and (item.get("model") or (item.get("payload") or {}).get("model"))
                ),
                None,
            ),
            usage={"mode": result.mode},
            status="completed",
        )
        run = AIAgentRun(
            tenant_id=tenant_id,
            run_id=result.run_id or f"run-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            user_message_id=user_message.message_id,
            assistant_message_id=assistant_message.message_id,
            status="waiting_confirmation" if result.requires_confirmation else "completed",
            mode=result.mode,
            input_message=safe_message,
            answer=safe_answer,
            items=safe_items,
            evidence=safe_evidence,
            risk_level=result.risk_level,
            requires_confirmation=result.requires_confirmation,
        )
        records: list[Any] = [user_message, assistant_message, run]
        if record_tool_calls_enabled(AI_SYSTEM_SETTINGS) and (result.evidence or (body.context or {}).get("surface") == "knowledge"):
            records.append(
                AIToolCall(
                    tenant_id=tenant_id,
                    call_id=f"call-{uuid.uuid4().hex[:12]}",
                    run_id=run.run_id,
                    tool_name="knowledge.search",
                    skill_name="knowledge.answer_question",
                    input={
                        "query": safe_message,
                        "document_id": (body.context or {}).get("document_id") or (body.context or {}).get("documentId"),
                    },
                    output={"result_count": len(result.evidence), "results": safe_evidence},
                    status="completed",
                    duration_ms=0,
                )
            )
        conversation.last_message = safe_message
        conversation.metadata_json = {
            **(conversation.metadata_json or {}),
            "last_run_id": run.run_id,
            "last_surface": (body.context or {}).get("surface") or "global",
        }
        if result.action_state:
            conversation.metadata_json["pending_action_state"] = result.action_state
        elif (body.context or {}).get("pendingActionState") and result.requires_confirmation:
            conversation.metadata_json["pending_action_state"] = (body.context or {}).get("pendingActionState")
        session.add_all(records)
        await memory_service.maybe_compact_conversation(
            session,
            conversation=conversation,
            tenant_id=tenant_id,
            user_key=user_key,
            settings=AI_SYSTEM_SETTINGS,
        )
        await session.commit()
        await session.refresh(conversation)
        await session.refresh(user_message)
        await session.refresh(assistant_message)
        await session.refresh(run)

        return {
            "conversation": _serialize_conversation(conversation),
            "user_message": _serialize_message(user_message),
            "assistant_message": _serialize_message(assistant_message),
            "run": _serialize_run(run),
        }


@router.get("/skills")
async def get_ai_skills(user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    base_decision = decide_ai_permission(current_user, AI_SYSTEM_SETTINGS, "qa", risk_level="low")
    _raise_for_ai_decision(base_decision)
    return {"data": list_skills()}


@router.get("/tools")
async def get_ai_tools(user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    base_decision = decide_ai_permission(current_user, AI_SYSTEM_SETTINGS, "qa", risk_level="low")
    _raise_for_ai_decision(base_decision)
    return {"data": list_tools()}


@router.post("/agent/conversations")
async def create_agent_conversation(body: AgentConversationRequest, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    user_key = _user_key(current_user)
    tenant_id = current_tenant_id(current_user)
    context = body.context or {}
    page = body.page or str(context.get("route") or context.get("page") or "global")
    document_id = body.document_id or context.get("document_id") or context.get("documentId")
    document_title = body.document_title or context.get("document_title") or context.get("documentTitle")
    title = body.title or document_title or "当前窗口"
    metadata = {
        **context,
        "surface": context.get("surface") or ("knowledge" if document_id else "global"),
    }
    async with db_session() as session:
        record = AIConversation(
            tenant_id=tenant_id,
            conversation_id=f"conv-{uuid.uuid4().hex[:12]}",
            user_id=user_key,
            page=page,
            document_id=str(document_id) if document_id else None,
            title=title,
            status="active",
            metadata_json=metadata,
        )
        session.add(record)
        await session.commit()
        await session.refresh(record)
        return {"data": _serialize_conversation(record), "ok": True}


@router.get("/agent/conversations")
async def list_agent_conversations(
    page: str | None = None,
    document_id: str | None = None,
    surface: str | None = None,
    include_closed: bool = False,
    limit: int = Query(30, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    current_user = _normalize_user(user)
    user_key = _user_key(current_user)
    tenant_id = current_tenant_id(current_user)
    async with db_session() as session:
        stmt = select(AIConversation).where(AIConversation.tenant_id == tenant_id, AIConversation.user_id == user_key)
        if not include_closed:
            stmt = stmt.where(AIConversation.status == "active")
        else:
            stmt = stmt.where(AIConversation.status != "deleted")
        if page:
            stmt = stmt.where(AIConversation.page == page)
        if document_id:
            stmt = stmt.where(AIConversation.document_id == document_id)
        stmt = stmt.order_by(desc(AIConversation.updated_at)).limit(limit)
        rows = (await session.execute(stmt)).scalars().all()
        if surface:
            rows = [row for row in rows if (row.metadata_json or {}).get("surface") == surface]
        return {"data": [_serialize_conversation(row) for row in rows], "ok": True}


@router.get("/agent/conversations/{conversation_id}/messages")
async def list_agent_conversation_messages(conversation_id: str, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    user_key = _user_key(current_user)
    tenant_id = current_tenant_id(current_user)
    async with db_session() as session:
        conversation = await session.scalar(
            select(AIConversation).where(
                AIConversation.tenant_id == tenant_id,
                AIConversation.conversation_id == conversation_id,
                AIConversation.user_id == user_key,
            )
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Agent conversation not found")
        rows = (
            await session.execute(
                select(AIMessage)
                .where(AIMessage.tenant_id == tenant_id, AIMessage.conversation_id == conversation_id)
                .order_by(AIMessage.id)
            )
        ).scalars().all()
        assistant_message_ids = [row.message_id for row in rows if row.role == "assistant"]
        runs_by_message: dict[str, AIAgentRun] = {}
        if assistant_message_ids:
            runs = (
                await session.execute(
                    select(AIAgentRun).where(
                        AIAgentRun.tenant_id == tenant_id,
                        AIAgentRun.conversation_id == conversation_id,
                        AIAgentRun.assistant_message_id.in_(assistant_message_ids),
                    )
                )
            ).scalars().all()
            runs_by_message = {row.assistant_message_id: row for row in runs if row.assistant_message_id}
        return {"data": [_serialize_message(row, runs_by_message.get(row.message_id)) for row in rows], "ok": True}


@router.patch("/agent/conversations/{conversation_id}")
async def update_agent_conversation(
    conversation_id: str,
    body: AgentConversationUpdateRequest,
    user: dict = Depends(get_current_user),
):
    current_user = _normalize_user(user)
    user_key = _user_key(current_user)
    tenant_id = current_tenant_id(current_user)
    title = (body.title or "").strip()
    status = (body.status or "").strip()
    if body.title is not None and not title:
        raise HTTPException(status_code=400, detail="Conversation title is required")
    if len(title) > 80:
        raise HTTPException(status_code=400, detail="Conversation title is too long")
    if status and status not in {"active", "closed", "deleted"}:
        raise HTTPException(status_code=400, detail="Conversation status is invalid")
    if body.title is None and not status:
        raise HTTPException(status_code=400, detail="Conversation update is empty")
    async with db_session() as session:
        conversation = await session.scalar(
            select(AIConversation).where(
                AIConversation.tenant_id == tenant_id,
                AIConversation.conversation_id == conversation_id,
                AIConversation.user_id == user_key,
            )
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Agent conversation not found")
        if body.title is not None:
            conversation.title = title
        if status:
            conversation.status = status
        await session.commit()
        await session.refresh(conversation)
        return {"data": _serialize_conversation(conversation), "ok": True}


@router.delete("/agent/conversations/{conversation_id}")
async def close_agent_conversation(conversation_id: str, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    user_key = _user_key(current_user)
    tenant_id = current_tenant_id(current_user)
    async with db_session() as session:
        conversation = await session.scalar(
            select(AIConversation).where(
                AIConversation.tenant_id == tenant_id,
                AIConversation.conversation_id == conversation_id,
                AIConversation.user_id == user_key,
            )
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Agent conversation not found")
        conversation.status = "closed"
        await load_persisted_ai_settings()
        if (AI_SYSTEM_SETTINGS.get("compactionPolicy") or {}).get("compactOnClose", True):
            await memory_service.maybe_compact_conversation(
                session,
                conversation=conversation,
                tenant_id=tenant_id,
                user_key=user_key,
                settings=AI_SYSTEM_SETTINGS,
                force=True,
            )
        await session.commit()
        await session.refresh(conversation)
        return {"data": _serialize_conversation(conversation), "ok": True}


@router.get("/memories")
async def list_ai_memories(
    include_candidates: bool = True,
    limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    current_user = _normalize_user(user)
    user_key = _user_key(current_user)
    async with db_session() as session:
        rows = await memory_service.list_user_memories(
            session,
            tenant_id=current_tenant_id(current_user),
            user_key=user_key,
            include_candidates=include_candidates,
            limit=limit,
        )
        return {"data": rows, "ok": True}


@router.delete("/memories/{memory_id}")
async def delete_ai_memory(memory_id: str, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    user_key = _user_key(current_user)
    async with db_session() as session:
        memory = await memory_service.delete_user_memory(
            session,
            memory_id=memory_id,
            tenant_id=current_tenant_id(current_user),
            user_key=user_key,
        )
        if not memory:
            raise HTTPException(status_code=404, detail="AI memory not found")
        await session.commit()
        return {"data": memory, "ok": True}


@router.post("/chat")
async def chat(body: ChatRequest):
    """AI 对话查询 — 自然语言查询制造数据."""
    intent = detect_intent(body.message)

    handler_map = {
        "oee": handle_oee_query,
        "equipment": handle_equipment_query,
        "production": handle_production_query,
        "quality": handle_quality_query,
        "supply": handle_supply_query,
    }

    handler = handler_map.get(intent)
    if handler:
        result = await handler(body.message)
    else:
        result = {
            "answer": "我是当前平台的 AI 助手，可以帮您查询和分析制造数据。您可以问我关于设备健康、OEE、产量、质量、供应链等方面的问题。",
            "data": None,
        }

    return {
        "session_id": body.session_id or f"session-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "message": body.message,
        "intent": intent,
        "response": result["answer"],
        "data": result.get("data"),
        "timestamp": datetime.now().isoformat(),
    }


@router.post("/agent")
async def agent_chat(body: AgentRequest, user: dict = Depends(get_current_user)):
    """Enterprise AI Agent shell: RAG evidence + structured skill actions."""
    current_user = _normalize_user(user)
    result = await _run_agent_for_user(body, current_user)
    payload = result.model_dump()
    persisted = await _persist_agent_turn(body, result, current_user)
    if persisted:
        payload.update(persisted)
    return payload


@router.post("/agent/stream")
async def agent_chat_stream(body: AgentRequest, user: dict = Depends(get_current_user)):
    """Observable Agent run stream.

    This endpoint uses Server-Sent Events over a POST response so the browser can
    include the normal Authorization header while receiving backend-confirmed
    execution events.
    """

    current_user = _normalize_user(user)

    async def event_generator():
        queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()

        async def emit(event: str, data: dict[str, Any]) -> None:
            await queue.put((event, data))

        run_id: str | None = None
        yield _sse("run.accepted", {"status": "accepted", "message": body.message})
        yield _sse("assistant.note", {"message": "我收到请求了，会先整理上下文，再按需要调用工具。"})
        task = asyncio.create_task(_run_agent_for_user(body, current_user, event_sink=emit))
        try:
            while not task.done() or not queue.empty():
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    continue
                yield _sse(event, data)
            result = await task
            payload = result.model_dump()
            run_id = payload.get("run_id")
            persisted = await _persist_agent_turn(body, result, current_user)
            if persisted:
                payload.update(persisted)
                run_id = (persisted.get("run") or {}).get("run_id") or run_id
            yield _sse("answer.completed", payload)
            yield _sse("run.completed", {"run_id": run_id, "status": "waiting_confirmation" if result.requires_confirmation else "completed"})
        except HTTPException as exc:
            yield _sse("run.failed", {"status": "failed", "detail": exc.detail, "status_code": exc.status_code})
        except Exception as exc:  # noqa: BLE001 - stream should report failures as events
            yield _sse("run.failed", {"status": "failed", "detail": str(exc)})
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/agent-runs")
async def create_ai_agent_run(body: AgentRequest, user: dict = Depends(get_current_user)):
    """Create an observable Agent run with steps, evidence, and pending confirmations."""
    current_user = _normalize_user(user)
    result = await _run_agent_for_user(body, current_user)
    return result.model_dump()


@router.get("/agent-runs/{run_id}")
async def get_ai_agent_run(run_id: str, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    base_decision = decide_ai_permission(current_user, AI_SYSTEM_SETTINGS, "qa", risk_level="low")
    _raise_for_ai_decision(base_decision)
    run = get_agent_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return {"data": _public_agent_run(run)}


async def _confirm_agent_run_for_user(
    run_id: str,
    body: AgentRunConfirmRequest,
    current_user: dict[str, Any],
    *,
    event_sink=None,
) -> dict[str, Any]:
    if not body.confirmed:
        try:
            run = cancel_agent_run(run_id, current_user)
        except ValueError as exc:
            status_code = 404 if "not found" in str(exc).lower() else 400
            raise HTTPException(status_code=status_code, detail=str(exc)) from exc
        await _sync_persisted_agent_run_final_state(run_id, current_user, status="cancelled")
        _audit_ai_event(current_user, "agent_run_cancelled", {"run_id": run_id, "source": "confirm_endpoint"})
        if event_sink:
            await event_sink("run.cancelled", {"run_id": run_id, "status": "cancelled", "run": run})
        return _public_agent_run(run)

    if not body.confirmation_token:
        raise HTTPException(status_code=400, detail="Confirmation token is required")
    if event_sink:
        await event_sink("pre.confirmation", {"run_id": run_id, "confirmed": True})
    try:
        run = confirm_agent_run(run_id, body.confirmation_token, current_user)
    except ValueError as exc:
        if "not found" not in str(exc).lower():
            status_code = 404 if "not found" in str(exc).lower() else 400
            raise HTTPException(status_code=status_code, detail=str(exc)) from exc
        try:
            run = await _load_persisted_agent_run_for_confirmation(run_id, body.confirmation_token, current_user)
        except ValueError as persisted_exc:
            status_code = 404 if "not found" in str(persisted_exc).lower() else 400
            raise HTTPException(status_code=status_code, detail=str(persisted_exc)) from persisted_exc

    if event_sink:
        await event_sink(
            "assistant.note",
            {
                "run_id": run_id,
                "message": "确认已接收，继续执行已审核动作。",
                "action_count": len(run.get("actions") or []),
            },
        )
    run = await _execute_confirmed_agent_run(run, current_user, event_sink=event_sink)
    await _sync_persisted_agent_run_final_state(run_id, current_user, status=str(run.get("status") or "completed"), run_state=run)
    if event_sink:
        await event_sink("post.confirmation", {"run_id": run_id, "status": run.get("status") or "completed"})
    _audit_ai_event(current_user, "agent_run_confirmed", {"run_id": run_id})
    return _public_agent_run(run)


@router.post("/agent-runs/{run_id}/confirm")
async def confirm_ai_agent_run(run_id: str, body: AgentRunConfirmRequest, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    run = await _confirm_agent_run_for_user(run_id, body, current_user)
    return {"data": run, "ok": True}


@router.post("/agent-runs/{run_id}/confirm/stream")
async def confirm_ai_agent_run_stream(run_id: str, body: AgentRunConfirmRequest, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)

    async def event_generator():
        queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()

        async def emit(event: str, data: dict[str, Any]) -> None:
            await queue.put((event, data))

        yield _sse("run.accepted", {"status": "accepted", "run_id": run_id, "confirmed": body.confirmed})
        task = asyncio.create_task(_confirm_agent_run_for_user(run_id, body, current_user, event_sink=emit))
        try:
            while not task.done() or not queue.empty():
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    continue
                yield _sse(event, data)
            run = await task
            yield _sse("run.completed", {"status": run.get("status") or "completed", "run_id": run_id, "run": _public_agent_run(run)})
        except HTTPException as exc:
            yield _sse("run.failed", {"status": "failed", "detail": exc.detail, "status_code": exc.status_code})
        except Exception as exc:  # noqa: BLE001 - stream should report failures as events
            yield _sse("run.failed", {"status": "failed", "detail": str(exc)})
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/agent-runs/{run_id}/cancel")
async def cancel_ai_agent_run(run_id: str, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    try:
        run = cancel_agent_run(run_id, current_user)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    await _sync_persisted_agent_run_final_state(run_id, current_user, status="cancelled")
    for action in run.get("actions") or []:
        payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        await _update_ai_draft_status(
            draft_id=str(payload.get("_source_draft_id") or payload.get("_resume_draft_id") or ""),
            current_user=current_user,
            status="cancelled",
            metadata={"cancelled_run_id": run_id},
        )
    _audit_ai_event(current_user, "agent_run_cancelled", {"run_id": run_id})
    return {"data": _public_agent_run(run), "ok": True}


@router.post("/drafts/save")
async def save_ai_draft(body: DraftSaveRequest, user: dict = Depends(get_current_user)):
    """Save a confirmed AI-generated draft without submitting workflow."""
    current_user = _normalize_user(user)
    action_stub = {
        "type": "skill_result",
        "skill": body.skill,
        "title": body.skill,
        "mode": "draft",
        "risk_level": "medium",
        "requires_confirmation": True,
        "payload": body.payload,
        "evidence": body.evidence,
    }
    from app.services.ai.schemas import SkillAction

    decision = decide_skill_permission(current_user, AI_SYSTEM_SETTINGS, SkillAction(**action_stub), capability="save_draft")
    _raise_for_ai_decision(decision)
    confirmation_token = body.confirmation.get("confirmation_token")
    if confirmation_token:
        try:
            consume_confirmation_token(str(confirmation_token), user=current_user)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif not body.confirmation.get("confirmed"):
        raise HTTPException(status_code=400, detail="User confirmation is required before saving AI draft")
    record = await _persist_ai_draft(
        current_user,
        skill=body.skill,
        payload=body.payload,
        evidence=body.evidence,
        source="manual_save",
    )
    _audit_ai_event(current_user, "draft_saved", {"draft_id": record["draft_id"], "skill": body.skill, "persisted": record.get("persisted")})
    return {"ok": True, "data": record}


@router.get("/drafts")
async def list_ai_drafts(limit: int = Query(30, ge=1, le=100), user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    decision = decide_ai_permission(current_user, AI_SYSTEM_SETTINGS, "save_draft", risk_level="low")
    _raise_for_ai_decision(decision)
    tenant_id = current_tenant_id(current_user)
    user_key = _user_key(current_user)
    try:
        async with db_session() as session:
            rows = (
                await session.execute(
                    select(AIDraft)
                    .where(AIDraft.tenant_id == tenant_id, AIDraft.created_by == user_key)
                    .order_by(desc(AIDraft.id))
                    .limit(limit)
                )
            ).scalars().all()
            return {
                "ok": True,
                "data": [
                    {
                        "id": row.id,
                        "draft_id": row.draft_id,
                        "status": row.status,
                        "skill": row.skill,
                        "payload": row.payload or {},
                        "evidence": row.evidence or [],
                        "source": row.source,
                        "run_id": row.run_id,
                        "created_by": row.created_by,
                        "created_at": _now_iso(row.created_at),
                        "persisted": True,
                    }
                    for row in rows
                ],
            }
    except SQLAlchemyError as exc:
        raise database_unavailable("AI draft storage is unavailable") from exc


async def _test_provider_config(provider_config: AIProviderConfig) -> dict[str, Any]:
    provider = get_provider(provider_config)
    try:
        result = await provider.chat(
            [ChatMessage(role="user", content="ping")],
            ChatOptions(model=provider_config.chat_model, max_tokens=32),
        )
        return {"ok": True, "provider": result.provider, "model": result.model, "message": "Provider configuration accepted"}
    except ProviderConfigurationError as exc:
        return {"ok": False, "provider": provider_config.provider, "message": str(exc)}


@router.post("/provider/test")
async def test_provider(body: ProviderTestRequest, user: dict = Depends(require_admin)):
    """Validate provider configuration without persisting secrets."""
    current_tenant_id(user)
    return await _test_provider_config(body.provider_config)


@router.get("/settings")
async def get_ai_settings(user: dict = Depends(require_admin)):
    """Return backend-owned AI system settings with secret values masked."""
    current_tenant_id(user)
    await load_persisted_ai_settings()
    return {"data": _mask_settings(AI_SYSTEM_SETTINGS)}


@router.put("/settings")
async def update_ai_settings(body: AISettingsRequest, user: dict = Depends(require_admin)):
    """Update backend-owned AI system settings for the demo runtime."""
    current_tenant_id(user)
    try:
        merged = await save_persisted_ai_settings(body.settings)
    except Exception:
        merged = merge_ai_settings(body.settings)
        AI_SYSTEM_SETTINGS.clear()
        AI_SYSTEM_SETTINGS.update(merged)
    return {"data": _mask_settings(AI_SYSTEM_SETTINGS), "ok": True}


@router.post("/settings/test")
async def test_saved_ai_settings(user: dict = Depends(require_admin)):
    """Validate the saved backend AI settings."""
    current_tenant_id(user)
    await load_persisted_ai_settings()
    provider_config = _settings_to_provider_config(AI_SYSTEM_SETTINGS)
    return await _test_provider_config(provider_config)


@router.get("/agent-registry")
async def get_agent_registry(user: dict = Depends(require_admin)):
    """Return the active database-backed Agent skill/tool registry."""
    current_tenant_id(user)
    try:
        registry = await load_agent_registry(seed_if_empty=False)
    except AgentRegistryError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "data": registry}


@router.post("/agent-registry/seed")
async def seed_agent_registry(user: dict = Depends(require_admin)):
    """Explicitly import the bundled Agent registry seed into the database."""
    current_tenant_id(user)
    try:
        registry = await seed_agent_registry_from_files(updated_by=str(current_user_id(user) or user.get("sub") or "admin"))
    except AgentRegistryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True, "data": registry}


@router.put("/agent-registry")
async def update_agent_registry(body: AIAgentRegistryRequest, user: dict = Depends(require_admin)):
    """Validate and immediately activate Agent skill/tool registry changes."""
    current_tenant_id(user)
    try:
        registry = await save_agent_registry_payload(
            body.model_dump(),
            updated_by=str(current_user_id(user) or user.get("sub") or "admin"),
        )
    except AgentRegistryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True, "data": registry}


@router.get("/audit")
async def list_ai_audit_logs(user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin privilege required")
    return {"data": list_ai_audit_logs(100)}


@router.get("/sessions")
async def list_sessions(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """Conversation history backed by persisted agent conversations."""
    current_user = _normalize_user(user)
    tenant_id = current_tenant_id(current_user)
    user_key = _user_key(current_user)
    try:
        async with db_session() as session:
            rows = (
                await session.execute(
                    select(AIConversation)
                    .where(AIConversation.tenant_id == tenant_id, AIConversation.user_id == user_key)
                    .order_by(desc(AIConversation.updated_at))
                    .limit(limit)
                )
            ).scalars().all()
    except SQLAlchemyError as exc:
        raise database_unavailable("AI conversation storage is unavailable") from exc
    return {
        "data": [
            {
                "id": row.conversation_id,
                "last_message": row.last_message,
                "timestamp": _now_iso(row.updated_at),
                "message_count": row.message_count,
            }
            for row in rows
        ]
    }


@router.post("/analyze")
async def smart_analyze(body: AnalyzeRequest):
    """Legacy analysis endpoint: no static demo insight fallback."""
    raise seed_data_required("AI analysis must be routed through the migrated Agent runtime or a real analytics service")
