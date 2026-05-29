"""AI Assistant API with database fallback for local availability."""

import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import desc, select

from app.api.deps import current_tenant_id, get_current_user
from app.core.db import db_session
from app.models.relational import AIAgentRun, AIConversation, AIDraft, AIMessage, AIToolCall
from app.services.ai.agent_runs import cancel_agent_run, confirm_agent_run, create_agent_run, get_agent_run
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
from app.services.ai.low_code_tools import execute_add_form_field, execute_create_form_definition
from app.services.ai.runtime import agent_runtime
from app.services.ai.schemas import AIProviderConfig, AgentRequest, AgentResponse, ChatMessage, ChatOptions, DraftSaveRequest
from app.services.ai.settings import (
    AI_SYSTEM_SETTINGS,
    load_persisted_ai_settings,
    mask_settings as _mask_settings,
    merge_ai_settings,
    save_persisted_ai_settings,
    settings_to_provider_config as _settings_to_provider_config,
)
from app.services.ai.skills import list_skills
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


class AgentRunConfirmRequest(BaseModel):
    confirmation_token: str | None = None
    confirmed: bool = True


class AgentConversationRequest(BaseModel):
    title: str | None = None
    page: str | None = None
    document_id: str | None = None
    document_title: str | None = None
    context: dict[str, Any] | None = None


AI_DRAFT_STORE: dict[str, dict] = {}


def _roles_for_demo_user(user: dict) -> list[dict]:
    if user.get("roles"):
        return user["roles"]
    if user.get("is_admin"):
        return [{"name": "admin", "label": "Admin"}]
    role_map = {
        "zhangsan": [{"name": "production_manager", "label": "Production manager"}],
        "pm_li": [{"name": "production_manager", "label": "Production manager"}, {"name": "approval_lead", "label": "Approval lead"}],
        "lisi": [{"name": "quality_inspector", "label": "Quality inspector"}],
        "qe_wang": [{"name": "quality_engineer", "label": "Quality engineer"}],
        "mm_zhou": [{"name": "maintenance_manager", "label": "Maintenance manager"}],
        "scm_liu": [{"name": "supply_chain_manager", "label": "Supply chain manager"}],
        "auditor_gu": [{"name": "viewer", "label": "Viewer"}],
    }
    return role_map.get(str(user.get("sub") or ""), [])


def _normalize_user(user: dict) -> dict:
    normalized = {**user}
    normalized["roles"] = _roles_for_demo_user(normalized)
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
        payload.update(
            {
                "run_id": run.run_id,
                "mode": run.mode,
                "steps": run.steps or [],
                "actions": run.actions or [],
                "risk_level": run.risk_level,
                "requires_confirmation": run.requires_confirmation,
                "confirmation_payload": run.confirmation_payload,
                "run_status": run.status,
            }
        )
    return payload


def _serialize_run(row: AIAgentRun) -> dict[str, Any]:
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
        "steps": row.steps or [],
        "evidence": row.evidence or [],
        "actions": row.actions or [],
        "risk_level": row.risk_level,
        "requires_confirmation": row.requires_confirmation,
        "confirmation_payload": row.confirmation_payload,
        "created_at": _now_iso(row.created_at),
        "updated_at": _now_iso(row.updated_at),
    }


def _raise_for_ai_decision(decision):
    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.reason or "AI action is not allowed")


def _audit_ai_event(user: dict, event_type: str, payload: dict):
    return record_ai_event(user, event_type, payload)


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


async def _emit_agent_step(event_sink, step: dict[str, Any]) -> None:
    if event_sink:
        await event_sink("step.completed", {"step": step})


async def _execute_confirmed_agent_run(run: dict[str, Any], current_user: dict[str, Any]) -> dict[str, Any]:
    """Execute supported confirmed Agent actions through registered backend tools."""

    if run.get("status") != "confirmed":
        return run
    results: list[dict[str, Any]] = []
    for action in run.get("actions") or []:
        skill = action.get("skill")
        action_payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        source_draft_id = str(action_payload.get("_source_draft_id") or action_payload.get("_resume_draft_id") or "")
        if skill == "low_code.add_form_field":
            async with db_session() as session:
                result = await execute_add_form_field(session, user=current_user, payload=action_payload)
            results.append({
                "skill": skill,
                "tool": "forms.add_form_field",
                "status": "completed",
                "result": result,
            })
            _audit_ai_event(current_user, "agent_tool_executed", {"skill": skill, "tool": "forms.add_form_field", "result": result})
            await _update_ai_draft_status(
                draft_id=source_draft_id,
                current_user=current_user,
                status="executed",
                metadata={"executed_result": result, "run_id": run.get("run_id")},
            )
            continue

        if skill != "low_code.create_form_definition":
            payload = action_payload
            dynamic_result = None
            try:
                async with db_session() as session:
                    dynamic_result = await create_dynamic_record_draft_from_agent(
                        session,
                        user=current_user,
                        skill=str(skill or ""),
                        payload=payload,
                        evidence=action.get("evidence") or [],
                    )
            except SQLAlchemyError:
                dynamic_result = None
            if dynamic_result:
                results.append({
                    "skill": skill,
                    "tool": "forms.create_dynamic_record_draft",
                    "status": "completed",
                    "result": dynamic_result,
                })
                _audit_ai_event(current_user, "agent_dynamic_record_draft_created", {"skill": skill, "result": dynamic_result})
                await _update_ai_draft_status(
                    draft_id=source_draft_id,
                    current_user=current_user,
                    status="executed",
                    metadata={"executed_result": dynamic_result, "run_id": run.get("run_id")},
                )
                continue

            draft_record = await _persist_ai_draft(
                current_user,
                skill=str(skill or ""),
                payload=payload,
                evidence=action.get("evidence") or [],
                source="agent_run_confirmation",
                run_id=str(run.get("run_id") or ""),
            )
            results.append({
                "skill": skill,
                "tool": (payload.get("_contract") or {}).get("tool") or "ai.drafts.save",
                "status": "completed",
                "result": draft_record,
            })
            _audit_ai_event(current_user, "agent_draft_saved", {"skill": skill, "draft_id": draft_record["draft_id"], "persisted": draft_record.get("persisted")})
            await _update_ai_draft_status(
                draft_id=source_draft_id,
                current_user=current_user,
                status="confirmed",
                metadata={"confirmed_result": draft_record, "run_id": run.get("run_id")},
            )
            continue

        async with db_session() as session:
            result = await execute_create_form_definition(session, user=current_user, payload=action_payload)
        results.append({
            "skill": skill,
            "tool": "forms.create_form_definition",
            "status": "completed",
            "result": result,
        })
        _audit_ai_event(current_user, "agent_tool_executed", {"skill": skill, "tool": "forms.create_form_definition", "result": result})
        await _update_ai_draft_status(
            draft_id=source_draft_id,
            current_user=current_user,
            status="executed",
            metadata={"executed_result": result, "run_id": run.get("run_id")},
        )

    run["tool_results"] = results
    if any(item.get("status") == "completed" for item in results):
        run["status"] = "completed"
    return run


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
    except SQLAlchemyError:
        record["persisted"] = False
    AI_DRAFT_STORE[draft_id] = record
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
    except SQLAlchemyError:
        fallback = AI_DRAFT_STORE.get(draft_id)
        if fallback and fallback.get("created_by") == user_key:
            return fallback
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
    stored = AI_DRAFT_STORE.get(draft_id)
    if stored and stored.get("created_by") == user_key:
        stored["status"] = status
        stored["metadata"] = {**(stored.get("metadata") or {}), **(metadata or {})}
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
    except SQLAlchemyError:
        return


async def _sync_persisted_agent_run_final_state(
    run_id: str,
    current_user: dict[str, Any],
    *,
    status: str,
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
        confirmation_payload = dict(row.confirmation_payload or {})
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
            "steps": row.steps or [],
            "actions": row.actions or [],
            "requires_confirmation": row.requires_confirmation,
            "confirmation_payload": confirmation_payload,
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
        from sqlalchemy import select
        from app.models.relational import ProductionLine
        result = await db.execute(select(ProductionLine))
        lines = result.scalars().all()
        if not lines:
            return None
        line_data = []
        for line in lines:
            random.seed(line.id)
            oee = round(random.uniform(0.75, 0.92), 3)
            line_data.append({"line": line.name, "oee": f"{oee*100:.1f}%"})
        return {
            "answer": f"当前各产线OEE如下：\n" + "\n".join(f"- {d['line']}: {d['oee']}" for d in line_data),
            "data": line_data,
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    line_data = [
        {"line": "齿轮产线-A", "oee": "85.2%"},
        {"line": "齿轮产线-B", "oee": "82.7%"},
        {"line": "壳体产线", "oee": "88.1%"},
        {"line": "轴类产线", "oee": "79.5%"},
        {"line": "热处理产线", "oee": "91.3%"},
    ]
    return {
        "answer": f"当前各产线OEE如下：\n" + "\n".join(f"- {d['line']}: {d['oee']}" for d in line_data),
        "data": line_data,
    }


async def handle_equipment_query(message: str) -> dict:
    async def _query(db):
        from sqlalchemy import select
        from app.models.relational import Equipment
        result = await db.execute(
            select(Equipment).where(Equipment.health_score < 80).order_by(Equipment.health_score)
        )
        low_health = result.scalars().all()
        if not low_health:
            return None
        eq_data = [{"name": e.name, "score": round(e.health_score, 1)} for e in low_health[:5]]
        return {
            "answer": f"有 {len(low_health)} 台设备需要关注：\n"
            + "\n".join(f"- {e.name}: 健康评分 {e.health_score:.1f}" for e in low_health[:5]),
            "data": eq_data,
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    return {
        "answer": "有 6 台设备需要关注：\n- 空压机-阿特拉斯: 健康评分 38.9\n- 磨床-上海机床: 健康评分 45.2\n- 数控车床-沈阳机床: 健康评分 68.5\n- 电火花机-沙迪克: 健康评分 72.3\n- 焊接机器人-KUKA: 健康评分 76.8",
        "data": [
            {"name": "空压机-阿特拉斯", "score": 38.9},
            {"name": "磨床-上海机床", "score": 45.2},
            {"name": "数控车床-沈阳机床", "score": 68.5},
            {"name": "电火花机-沙迪克", "score": 72.3},
            {"name": "焊接机器人-KUKA", "score": 76.8},
        ],
    }


async def handle_production_query(message: str) -> dict:
    async def _query(db):
        from sqlalchemy import select
        from app.models.relational import WorkOrder
        wo_result = await db.execute(select(WorkOrder))
        work_orders = wo_result.scalars().all()
        total = len(work_orders)
        in_progress = sum(1 for wo in work_orders if wo.status == "in_progress")
        return {
            "answer": f"当前工单状态：共 {total} 个工单，其中 {in_progress} 个正在执行，{total - in_progress} 个已完成/待处理。",
            "data": {"total": total, "in_progress": in_progress},
        }

    result = await _try_db(_query)
    if result is not None:
        return result

    # Mock fallback
    return {
        "answer": "当前工单状态：共 18 个工单，其中 7 个正在执行，11 个已完成/待处理。",
        "data": {"total": 18, "in_progress": 7},
    }


async def handle_quality_query(message: str) -> dict:
    return {
        "answer": "近30天质量概况：\n- 整体良率: 98.2%\n- SPC异常点: 3个\n- 待处理CAPA: 2个\n建议关注焊接工序的温度参数波动。",
        "data": {"yield_rate": 98.2, "spc_exceptions": 3, "pending_capa": 2},
    }


async def handle_supply_query(message: str) -> dict:
    return {
        "answer": "供应链概况：\n- 活跃供应商: 8家\n- 库存预警物料: 3个\n- 在途物流: 2单\n- 准时交付率: 91.2%",
        "data": {"suppliers": 8, "inventory_alerts": 3, "in_transit": 2, "otd_rate": 91.2},
    }


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
            raise HTTPException(status_code=404, detail="AI draft not found")
        if draft_record.get("status") in {"executed", "cancelled"}:
            raise HTTPException(status_code=409, detail="AI draft is no longer editable")
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
                "notes": [f"resume draft {draft_record.get('draft_id')}"],
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
        result.steps.insert(0, context_intent_step)
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
            }
            result.steps.insert(0, context_builder_step)
            await _emit_agent_step(event_sink, context_builder_step)
    result.steps = [identity_step, ai_permission_step, *result.steps]
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
        result.steps.append(skill_policy_step)
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
    document_title = context.get("document_title") or context.get("documentTitle") or context.get("pageTitle") or "当前知识文档"
    intent = agent_runtime.classify_knowledge_intent(body.message)
    evidence = await _search_knowledge_payload_async(body.message, limit=5, document_id=document_id) if intent == "knowledge" else []
    if intent == "knowledge" and not evidence and document_id:
        evidence = (await _document_context_payload_async(str(document_id)))[:5]
    answer, model_name, usage = await _generate_knowledge_agent_answer(
        query=body.message,
        title=str(document_title),
        evidence=evidence,
        history=[],
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
    intent = agent_runtime.classify_knowledge_intent(body.message)
    rag_policy = AI_SYSTEM_SETTINGS.get("ragPolicy") or {}
    rag_enabled = rag_policy.get("enabled", True)
    top_k = int(rag_policy.get("topK") or 5)
    evidence = await _search_knowledge_payload_async(body.message, limit=top_k, document_id=document_id) if intent == "knowledge" and rag_enabled else []
    if intent == "knowledge" and not evidence and document_id:
        evidence = (await _document_context_payload_async(str(document_id)))[:top_k]
    async with db_session() as session:
        runtime_context = await context_builder.build(
            session,
            request=body,
            user=context.get("_current_user") or {},
            settings=AI_SYSTEM_SETTINGS,
            conversation_id=str(conversation_id) if conversation_id else None,
            page=context.get("route") or body.page,
            document_id=str(document_id) if document_id else None,
            tenant_id=int(context.get("_tenant_id") or 1),
            user_key=context.get("_user_key"),
            evidence=evidence,
        )
    answer, model_name, usage = await _generate_knowledge_agent_answer(
        query=body.message,
        title=str(document_title),
        evidence=evidence,
        history=[],
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

        user_message = AIMessage(
            tenant_id=tenant_id,
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            role="user",
            content=body.message,
            evidence=[],
            status="completed",
        )
        assistant_message = AIMessage(
            tenant_id=tenant_id,
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            conversation_id=conversation_id,
            role="assistant",
            content=result.answer,
            evidence=result.evidence,
            model_name=next(
                (
                    str(step.get("model"))
                    for step in reversed(result.steps)
                    if step.get("type") == "respond" and step.get("model")
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
            input_message=body.message,
            answer=result.answer,
            steps=result.steps,
            evidence=result.evidence,
            actions=[action.model_dump() for action in result.actions],
            risk_level=result.risk_level,
            requires_confirmation=result.requires_confirmation,
            confirmation_payload=result.confirmation_payload or None,
        )
        records: list[Any] = [user_message, assistant_message, run]
        if result.evidence or (body.context or {}).get("surface") == "knowledge":
            records.append(
                AIToolCall(
                    tenant_id=tenant_id,
                    call_id=f"call-{uuid.uuid4().hex[:12]}",
                    run_id=run.run_id,
                    tool_name="knowledge.search",
                    skill_name="knowledge.answer_question",
                    input={
                        "query": body.message,
                        "document_id": (body.context or {}).get("document_id") or (body.context or {}).get("documentId"),
                    },
                    output={"result_count": len(result.evidence), "results": result.evidence},
                    status="completed",
                    duration_ms=0,
                )
            )
        conversation.last_message = body.message
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
        events: list[tuple[str, dict[str, Any]]] = []

        async def emit(event: str, data: dict[str, Any]) -> None:
            events.append((event, data))

        run_id: str | None = None
        yield _sse("run.accepted", {"status": "accepted", "message": body.message})
        try:
            result = await _run_agent_for_user(body, current_user, event_sink=emit)
            for event, data in events:
                yield _sse(event, data)
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
    return {"data": run}


@router.post("/agent-runs/{run_id}/confirm")
async def confirm_ai_agent_run(run_id: str, body: AgentRunConfirmRequest, user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    if not body.confirmed:
        try:
            run = cancel_agent_run(run_id, current_user)
        except ValueError as exc:
            status_code = 404 if "not found" in str(exc).lower() else 400
            raise HTTPException(status_code=status_code, detail=str(exc)) from exc
        await _sync_persisted_agent_run_final_state(run_id, current_user, status="cancelled")
        _audit_ai_event(current_user, "agent_run_cancelled", {"run_id": run_id, "source": "confirm_endpoint"})
        return {"data": run, "ok": True}
    if not body.confirmation_token:
        raise HTTPException(status_code=400, detail="Confirmation token is required")
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
    run = await _execute_confirmed_agent_run(run, current_user)
    await _sync_persisted_agent_run_final_state(run_id, current_user, status=str(run.get("status") or "completed"))
    _audit_ai_event(current_user, "agent_run_confirmed", {"run_id": run_id})
    return {"data": run, "ok": True}


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
    return {"data": run, "ok": True}


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
    except SQLAlchemyError:
        fallback = [
            item
            for item in AI_DRAFT_STORE.values()
            if item.get("created_by") == user_key
        ]
        fallback.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return {"ok": True, "data": fallback[:limit]}


@router.post("/provider/test")
async def test_provider(body: ProviderTestRequest):
    """Validate provider configuration without persisting secrets."""
    provider = get_provider(body.provider_config)
    try:
        result = await provider.chat(
            [ChatMessage(role="user", content="ping")],
            ChatOptions(model=body.provider_config.chat_model, max_tokens=32),
        )
        return {"ok": True, "provider": result.provider, "model": result.model, "message": "Provider configuration accepted"}
    except ProviderConfigurationError as exc:
        return {"ok": False, "provider": body.provider_config.provider, "message": str(exc)}


@router.get("/settings")
async def get_ai_settings():
    """Return backend-owned AI system settings with secret values masked."""
    await load_persisted_ai_settings()
    return {"data": _mask_settings(AI_SYSTEM_SETTINGS)}


@router.put("/settings")
async def update_ai_settings(body: AISettingsRequest):
    """Update backend-owned AI system settings for the demo runtime."""
    try:
        merged = await save_persisted_ai_settings(body.settings)
    except Exception:
        merged = merge_ai_settings(body.settings)
        AI_SYSTEM_SETTINGS.clear()
        AI_SYSTEM_SETTINGS.update(merged)
    return {"data": _mask_settings(AI_SYSTEM_SETTINGS), "ok": True}


@router.post("/settings/test")
async def test_saved_ai_settings():
    """Validate the saved backend AI settings."""
    await load_persisted_ai_settings()
    provider_config = _settings_to_provider_config(AI_SYSTEM_SETTINGS)
    return await test_provider(ProviderTestRequest(provider_config=provider_config))


@router.get("/audit")
async def list_ai_audit_logs(user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin privilege required")
    return {"data": list_ai_audit_logs(100)}


@router.get("/sessions")
async def list_sessions(
    limit: int = Query(20, ge=1, le=100),
):
    """对话历史（模拟）."""
    sessions = [
        {
            "id": f"session-{i:04d}",
            "last_message": "3号产线今天的OEE是多少？",
            "timestamp": (datetime.now() - timedelta(days=random.randint(0, 7))).isoformat(),
            "message_count": random.randint(2, 15),
        }
        for i in range(1, min(limit + 1, 11))
    ]
    return {"data": sessions}


@router.post("/analyze")
async def smart_analyze(body: AnalyzeRequest):
    """智能分析."""
    analysis = {
        "query": body.query,
        "analysis_type": "trend",
        "insights": [
            {
                "title": "产量趋势",
                "description": "近7天日均产量 1,050 件，环比上升 3.2%。",
                "confidence": 0.92,
            },
            {
                "title": "设备利用率",
                "description": "当前设备利用率 87.5%，高于目标值 85%。",
                "confidence": 0.88,
            },
            {
                "title": "质量预警",
                "description": "焊接工序温度波动增大，建议加强SPC监控。",
                "confidence": 0.78,
            },
        ],
        "recommendations": [
            "建议对3号产线进行预防性维护，预计可将OEE提升2-3%。",
            "物料M-0042库存低于安全线，建议立即补货。",
        ],
        "timestamp": datetime.now().isoformat(),
    }
    return analysis
