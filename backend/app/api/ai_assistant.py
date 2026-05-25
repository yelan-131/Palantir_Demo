"""AI Assistant API — with fallback to mock data when DB unavailable."""

import json
import random
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.services.ai.client import get_provider
from app.services.ai.orchestrator import run_agent
from app.services.ai.policies import decide_ai_permission, decide_skill_permission
from app.services.ai.providers import ProviderConfigurationError
from app.services.ai.schemas import AIProviderConfig, AgentRequest, ChatMessage, ChatOptions, DraftSaveRequest

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


DEFAULT_ROLE_POLICIES = [
    {
        "role": "admin",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft", "workflow", "config"],
        "domains": ["production", "quality", "maintenance", "supply-chain", "workflow", "low-code"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "production_manager",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft", "workflow"],
        "domains": ["production", "maintenance", "workflow"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "quality_engineer",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft"],
        "domains": ["quality"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "maintenance_manager",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft"],
        "domains": ["maintenance"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "supply_chain_manager",
        "enabled": True,
        "capabilities": ["qa", "rag", "business_query", "report", "draft", "save_draft"],
        "domains": ["supply-chain"],
        "agentMode": "save_after_confirm",
    },
    {
        "role": "viewer",
        "enabled": True,
        "capabilities": ["qa", "rag", "report"],
        "domains": ["production", "quality", "maintenance", "supply-chain"],
        "agentMode": "readonly",
    },
]


AI_SYSTEM_SETTINGS = {
    "aiEnabled": True,
    "provider": "mock",
    "baseUrl": "",
    "apiKey": "",
    "chatModel": "mock-chat",
    "reasoningModel": "mock-reasoning",
    "embeddingModel": "mock-embedding",
    "visionModel": "disabled",
    "agentMode": "draft",
    "ragEnabled": True,
    "guestAccess": "disabled",
    "rolePolicies": DEFAULT_ROLE_POLICIES,
    "riskPolicy": {
        "low": "allow",
        "medium": "confirm",
        "high": "confirm_and_audit",
        "critical": "blocked",
    },
    "forbiddenActions": ["auto_order", "delete_data", "change_permission"],
}

AI_DRAFT_STORE: dict[str, dict] = {}
AI_AUDIT_LOGS: list[dict] = []


def _settings_to_provider_config(settings_data: dict) -> AIProviderConfig:
    return AIProviderConfig(
        provider=settings_data.get("provider") or "mock",
        base_url=settings_data.get("baseUrl") or settings_data.get("base_url") or "",
        api_key=settings_data.get("apiKey") or settings_data.get("api_key") or "",
        organization=settings_data.get("organization") or "",
        project=settings_data.get("project") or "",
        chat_model=settings_data.get("chatModel") or settings_data.get("chat_model") or "mock-chat",
        reasoning_model=settings_data.get("reasoningModel") or settings_data.get("reasoning_model") or "mock-reasoning",
        embedding_model=settings_data.get("embeddingModel") or settings_data.get("embedding_model") or "mock-embedding",
        vision_model=settings_data.get("visionModel") or settings_data.get("vision_model") or "disabled",
        timeout_seconds=int(settings_data.get("timeoutSeconds") or settings_data.get("timeout_seconds") or 30),
    )


def _mask_settings(settings_data: dict) -> dict:
    masked = {**settings_data}
    if masked.get("apiKey"):
        masked["apiKey"] = "********"
    return masked


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


def _raise_for_ai_decision(decision):
    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.reason or "AI action is not allowed")


def _audit_ai_event(user: dict, event_type: str, payload: dict):
    AI_AUDIT_LOGS.append({
        "id": f"audit-{uuid.uuid4().hex[:12]}",
        "event_type": event_type,
        "user": user.get("sub") or user.get("username") or "unknown",
        "payload": payload,
        "created_at": datetime.now().isoformat(),
    })


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
            "answer": "我是 ManuFoundry AI 助手，可以帮您查询和分析制造数据。您可以问我关于设备健康、OEE、产量、质量、供应链等方面的问题。",
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
    base_decision = decide_ai_permission(current_user, AI_SYSTEM_SETTINGS, "qa", risk_level="low")
    _raise_for_ai_decision(base_decision)
    if body.provider_config is None:
        body.provider_config = _settings_to_provider_config(AI_SYSTEM_SETTINGS)
    result = await run_agent(body)
    for action in result.actions:
        decision = decide_skill_permission(current_user, AI_SYSTEM_SETTINGS, action)
        _raise_for_ai_decision(decision)
        action.requires_confirmation = action.requires_confirmation or decision.requires_confirmation
    if result.actions:
        _audit_ai_event(current_user, "agent_actions_prepared", {"actions": [action.model_dump() for action in result.actions]})
    return result.model_dump()


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
    if not body.confirmation.get("confirmed"):
        raise HTTPException(status_code=400, detail="User confirmation is required before saving AI draft")
    draft_id = f"draft-{uuid.uuid4().hex[:12]}"
    record = {
        "draft_id": draft_id,
        "status": "draft",
        "skill": body.skill,
        "payload": body.payload,
        "evidence": body.evidence,
        "created_by": current_user.get("sub") or current_user.get("username"),
        "created_at": datetime.now().isoformat(),
    }
    AI_DRAFT_STORE[draft_id] = record
    _audit_ai_event(current_user, "draft_saved", {"draft_id": draft_id, "skill": body.skill})
    return {"ok": True, "data": record}


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
    return {"data": _mask_settings(AI_SYSTEM_SETTINGS)}


@router.put("/settings")
async def update_ai_settings(body: AISettingsRequest):
    """Update backend-owned AI system settings for the demo runtime."""
    merged = {**AI_SYSTEM_SETTINGS, **body.settings}
    merged.setdefault("guestAccess", "disabled")
    merged.setdefault("rolePolicies", DEFAULT_ROLE_POLICIES)
    merged.setdefault("riskPolicy", {"low": "allow", "medium": "confirm", "high": "confirm_and_audit", "critical": "blocked"})
    merged.setdefault("forbiddenActions", ["auto_order", "delete_data", "change_permission"])
    AI_SYSTEM_SETTINGS.clear()
    AI_SYSTEM_SETTINGS.update(merged)
    return {"data": _mask_settings(AI_SYSTEM_SETTINGS), "ok": True}


@router.post("/settings/test")
async def test_saved_ai_settings():
    """Validate the saved backend AI settings."""
    provider_config = _settings_to_provider_config(AI_SYSTEM_SETTINGS)
    return await test_provider(ProviderTestRequest(provider_config=provider_config))


@router.get("/audit")
async def list_ai_audit_logs(user: dict = Depends(get_current_user)):
    current_user = _normalize_user(user)
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin privilege required")
    return {"data": AI_AUDIT_LOGS[-100:]}


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
