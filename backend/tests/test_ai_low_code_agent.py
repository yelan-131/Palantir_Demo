from __future__ import annotations

import asyncio
import uuid

from fastapi.testclient import TestClient


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_headers() -> dict[str, str]:
    from app.core.security import create_access_token

    token = create_access_token(
        "admin",
        extra={
            "uid": 1,
            "tenant_id": 1,
            "is_admin": True,
            "roles": [{"id": 1, "name": "admin", "label": "Administrator"}],
        },
    )
    return _headers(token)


def _assert_ok(response, *, context: str) -> dict:
    assert response.status_code < 400, f"{context}: {response.status_code} {response.text}"
    return response.json()


def _confirmation_payload(payload: dict) -> dict:
    for item in reversed(payload.get("items") or []):
        item_payload = item.get("payload") or {}
        if item.get("type") == "confirmation" and item_payload.get("confirmation_token"):
            return item_payload
    return {}


def _confirmation_actions(payload: dict) -> list[dict]:
    actions = _confirmation_payload(payload).get("actions")
    return actions if isinstance(actions, list) else []


def test_admin_agent_can_confirm_low_code_form_creation():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _admin_headers()

        response = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": "create a form for supplier issue handling",
                    "context": {
                        "formName": f"AI Supplier Issue {suffix}",
                        "formCode": f"ai_supplier_issue_{suffix}",
                        "fields": [
                            {"field_name": "supplier_name", "label": "Supplier", "field_type": "string", "required": True},
                            {"field_name": "issue_type", "label": "Issue Type", "field_type": "enum", "enum_values": {"values": ["quality", "delivery"]}},
                        ],
                    },
                },
            ),
            context="agent plan",
        )

        assert response["requires_confirmation"] is True
        assert response["risk_level"] == "high"
        assert _confirmation_actions(response)[0]["skill"] == "low_code.create_form_definition"

        token = _confirmation_payload(response)["confirmation_token"]
        confirmed = _assert_ok(
            client.post(
                f"/api/v1/ai/agent-runs/{response['run_id']}/confirm",
                headers=headers,
                json={"confirmation_token": token, "confirmed": True},
            ),
            context="confirm agent run",
        )["data"]

        assert confirmed["status"] == "completed"
        result = confirmed["tool_results"][0]["result"]
        assert result["form"]["code"] == f"ai_supplier_issue_{suffix}"
        assert len(result["fields"]) == 2

        created = _assert_ok(
            client.get(f"/api/v1/forms/{result['form']['id']}", headers=headers),
            context="get created form",
        )["data"]
        assert created["code"] == f"ai_supplier_issue_{suffix}"
        assert [field["field_name"] for field in created["fields"]] == ["supplier_name", "issue_type"]


def test_agent_conversation_history_restores_run_steps_and_actions():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _admin_headers()
        conversation = _assert_ok(
            client.post(
                "/api/v1/ai/agent/conversations",
                headers=headers,
                json={"title": "History restore", "page": "ai-workbench", "context": {"surface": "global"}},
            ),
            context="create conversation",
        )["data"]

        response = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": "create a form for supplier issue handling",
                    "context": {
                        "conversation_id": conversation["conversation_id"],
                        "formName": f"AI Supplier History {suffix}",
                        "formCode": f"ai_supplier_history_{suffix}",
                        "fields": [
                            {"field_name": "supplier_name", "label": "Supplier", "field_type": "string", "required": True},
                            {"field_name": "risk_level", "label": "Risk Level", "field_type": "string"},
                        ],
                    },
                },
            ),
            context="agent plan",
        )
        assert response["requires_confirmation"] is True

        messages = _assert_ok(
            client.get(
                f"/api/v1/ai/agent/conversations/{conversation['conversation_id']}/messages",
                headers=headers,
            ),
            context="list messages",
        )["data"]
        assistant = [item for item in messages if item["role"] == "assistant"][-1]

        assert assistant["run_id"] == response["run_id"]
        assert assistant["requires_confirmation"] is True
        assert _confirmation_payload(response)["confirmation_token"].startswith("confirm-")
        assert _confirmation_payload(assistant)["confirmation_token"] == "[REDACTED_SECRET]"
        assert _confirmation_actions(assistant)[0]["skill"] == "low_code.create_form_definition"
        assert any(item["id"] == "step-planner" for item in assistant["items"])


def test_confirmed_agent_run_clears_pending_action_state():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _admin_headers()
        conversation = _assert_ok(
            client.post(
                "/api/v1/ai/agent/conversations",
                headers=headers,
                json={"title": "Clear pending", "page": "ai-workbench", "context": {"surface": "global"}},
            ),
            context="create conversation",
        )["data"]

        response = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": "create a form for supplier onboarding",
                    "context": {
                        "conversation_id": conversation["conversation_id"],
                        "formName": f"AI Clear Pending {suffix}",
                        "formCode": f"ai_clear_pending_{suffix}",
                        "fields": [
                            {"field_name": "supplier_name", "label": "Supplier", "field_type": "string", "required": True},
                            {"field_name": "status", "label": "Status", "field_type": "string"},
                        ],
                    },
                },
            ),
            context="agent plan",
        )
        assert response["requires_confirmation"] is True

        before = _assert_ok(
            client.get("/api/v1/ai/agent/conversations", headers=headers, params={"page": "ai-workbench"}),
            context="list conversations before confirm",
        )["data"]
        current_before = next(item for item in before if item["conversation_id"] == conversation["conversation_id"])
        assert current_before["metadata"].get("pending_action_state")

        token = _confirmation_payload(response)["confirmation_token"]
        confirmed = _assert_ok(
            client.post(
                f"/api/v1/ai/agent-runs/{response['run_id']}/confirm",
                headers=headers,
                json={"confirmation_token": token, "confirmed": True},
            ),
            context="confirm agent run",
        )["data"]
        assert confirmed["status"] == "completed"

        after = _assert_ok(
            client.get("/api/v1/ai/agent/conversations", headers=headers, params={"page": "ai-workbench"}),
            context="list conversations after confirm",
        )["data"]
        current_after = next(item for item in after if item["conversation_id"] == conversation["conversation_id"])
        assert "pending_action_state" not in current_after["metadata"]

        messages = _assert_ok(
            client.get(
                f"/api/v1/ai/agent/conversations/{conversation['conversation_id']}/messages",
                headers=headers,
            ),
            context="list messages after confirm",
        )["data"]
        assistant = [item for item in messages if item["role"] == "assistant"][-1]
        assert assistant["run_status"] == "completed"
        assert assistant["requires_confirmation"] is False


def test_confirmed_generic_action_creates_dynamic_record_draft_when_form_exists():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _admin_headers()
        form = _assert_ok(
            client.post(
                "/api/v1/forms",
                headers=headers,
                json={
                    "name": f"CAPA Draft {suffix}",
                    "code": f"capa-{suffix}",
                    "description": "AI CAPA dynamic draft target",
                    "storage_mode": "dynamic",
                    "status": "published",
                },
            ),
            context="create capa form",
        )["data"]
        for index, field in enumerate(
            [
                {"field_name": "problem", "label": "Problem", "field_type": "text", "required": True},
                {"field_name": "containment", "label": "Containment", "field_type": "text", "required": True},
                {"field_name": "owner_or_due_date", "label": "Owner or due date", "field_type": "string", "required": True},
            ]
        ):
            _assert_ok(
                client.post(
                    f"/api/v1/forms/{form['id']}/fields",
                    headers=headers,
                    json={**field, "sort_order": index},
                ),
                context=f"create field {field['field_name']}",
            )

        created = _assert_ok(
            client.post(
                "/api/v1/ai/agent-runs",
                headers=headers,
                json={
                    "message": "draft a quality CAPA for defect issue, containment isolate affected batch, owner due today",
                },
            ),
            context="create agent run",
        )
        token = _confirmation_payload(created)["confirmation_token"]
        confirmed = _assert_ok(
            client.post(
                f"/api/v1/ai/agent-runs/{created['run_id']}/confirm",
                headers=headers,
                json={"confirmation_token": token, "confirmed": True},
            ),
            context="confirm generic draft",
        )["data"]

        result = confirmed["tool_results"][0]["result"]
        assert confirmed["status"] == "completed"
        assert result["form_code"] == f"capa-{suffix}"
        assert result["status"] == "draft"
        assert result["data"]["problem"]
        assert result["data"]["containment"]
        assert result["data"]["owner_or_due_date"]

        records = _assert_ok(
            client.get(f"/api/v1/forms/{form['id']}/records?include_deleted=true", headers=headers),
            context="list capa records",
        )["data"]
        assert any(record["id"] == result["record_id"] and record["status"] == "draft" for record in records)


def test_manual_ai_draft_save_persists_to_database():
    from sqlalchemy import select

    from app.core.db import db_session
    from app.main import app
    from app.models.relational import AIDraft

    async def _load_draft(draft_id: str):
        async with db_session() as session:
            return await session.scalar(select(AIDraft).where(AIDraft.draft_id == draft_id))

    with TestClient(app) as client:
        headers = _admin_headers()
        response = _assert_ok(
            client.post(
                "/api/v1/ai/drafts/save",
                headers=headers,
                json={
                    "skill": "quality.create_capa_draft",
                    "payload": {"problem": "defect issue"},
                    "evidence": [{"document_id": "doc-demo"}],
                    "confirmation": {"confirmed": True},
                },
            ),
            context="save ai draft",
        )["data"]

        assert response["persisted"] is True
        draft = asyncio.run(_load_draft(response["draft_id"]))
        assert draft is not None
        assert draft.skill == "quality.create_capa_draft"
        assert draft.payload["problem"] == "defect issue"
        assert draft.evidence[0]["document_id"] == "doc-demo"

        listed = _assert_ok(
            client.get("/api/v1/ai/drafts", headers=headers),
            context="list ai drafts",
        )["data"]
        assert listed[0]["draft_id"] == response["draft_id"]
        assert listed[0]["persisted"] is True


def test_ai_agent_can_resume_saved_draft_for_confirmation():
    from app.main import app

    with TestClient(app) as client:
        headers = _admin_headers()
        saved = _assert_ok(
            client.post(
                "/api/v1/ai/drafts/save",
                headers=headers,
                json={
                    "skill": "quality.create_capa_draft",
                    "payload": {
                        "problem": "BGA solder void trend",
                        "containment": "hold affected lot",
                        "owner_or_due_date": "QE today",
                    },
                    "evidence": [{"document_id": "doc-demo"}],
                    "confirmation": {"confirmed": True},
                },
            ),
            context="save resumable ai draft",
        )["data"]

        response = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": f"继续处理草稿 {saved['draft_id']}",
                    "context": {"resumeDraftId": saved["draft_id"]},
                },
            ),
            context="resume ai draft",
        )

        assert response["requires_confirmation"] is True
        actions = _confirmation_actions(response)
        assert actions[0]["skill"] == "quality.create_capa_draft"
        assert actions[0]["payload"]["problem"] == "BGA solder void trend"
        assert actions[0]["payload"]["containment"] == "hold affected lot"
        assert response["action_state"]["status"] == "ready_for_confirmation"

        reviewing = _assert_ok(
            client.get("/api/v1/ai/drafts", headers=headers),
            context="list reviewing ai drafts",
        )["data"]
        resumed = next(item for item in reviewing if item["draft_id"] == saved["draft_id"])
        assert resumed["status"] == "reviewing"

        token = _confirmation_payload(response)["confirmation_token"]
        confirmed = _assert_ok(
            client.post(
                f"/api/v1/ai/agent-runs/{response['run_id']}/confirm",
                headers=headers,
                json={"confirmation_token": token, "confirmed": True},
            ),
            context="confirm resumed ai draft",
        )["data"]
        assert confirmed["status"] == "completed"

        completed = _assert_ok(
            client.get("/api/v1/ai/drafts", headers=headers),
            context="list completed ai drafts",
        )["data"]
        completed_draft = next(item for item in completed if item["draft_id"] == saved["draft_id"])
        assert completed_draft["status"] in {"executed", "confirmed"}


def test_action_slot_filling_extracts_followup_details():
    from app.services.ai.action_state import create_or_update_action_state

    first = create_or_update_action_state(
        existing=None,
        skill="quality.create_capa_draft",
        source_message="生成一个 CAPA 草稿，问题：BGA 虚焊",
        extracted_context={},
    )
    assert "containment" in first["missing_slots"]

    second = create_or_update_action_state(
        existing=first,
        skill="quality.create_capa_draft",
        source_message="临时措施：隔离受影响批次；责任人：QE 王工，今天完成",
        extracted_context={},
    )
    assert second["status"] == "ready_for_confirmation"
    assert second["collected_slots"]["containment"] == "隔离受影响批次"
    assert "QE 王工" in second["collected_slots"]["owner_or_due_date"]


def test_action_slot_filling_uses_generic_contract_terms():
    from app.services.ai.action_state import create_or_update_action_state

    first = create_or_update_action_state(
        existing=None,
        skill="supply.create_purchase_request_draft",
        source_message="帮我生成一个采购申请，物料：焊锡膏 S12",
        extracted_context={},
    )
    assert first["collected_slots"]["item"] == "焊锡膏 S12"
    assert "quantity" in first["missing_slots"]
    assert "reason" in first["missing_slots"]

    second = create_or_update_action_state(
        existing=first,
        skill="supply.create_purchase_request_draft",
        source_message="数量：200 件；原因：安全库存不足",
        extracted_context={},
    )
    assert second["status"] == "ready_for_confirmation"
    assert second["collected_slots"]["quantity"] == "200 件"
    assert second["collected_slots"]["reason"] == "安全库存不足"


def test_chinese_low_code_request_uses_backend_planner():
    from app.services.ai.planner import plan_agent_turn
    from app.services.ai.low_code_tools import build_low_code_form_payload

    message = "请你帮我 建立一个物料主数据的表单把"
    plan = plan_agent_turn(message, {"contextNeed": "auto"})
    payload = build_low_code_form_payload(plan.source_message, plan.extracted_context)

    assert plan.intent == "action"
    assert plan.skill == "low_code.create_form_definition"
    assert payload["form"]["name"] == "物料主数据"
    assert payload["form"]["code"] == "ai_material_master_form"
    assert [field["field_name"] for field in payload["fields"][:3]] == [
        "material_code",
        "material_name",
        "material_type",
    ]


def test_low_code_agent_guides_before_write_when_requirements_are_missing():
    from app.main import app

    with TestClient(app) as client:
        headers = _admin_headers()

        response = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={"message": "帮我新建一个物料主数据表单"},
            ),
            context="agent guide",
        )

        assert response["requires_confirmation"] is False
        assert _confirmation_actions(response) == []
        assert "先不直接生成可确认动作" in response["answer"]
        assert any(item["id"] == "step-tool-contract" for item in response["items"])
        assert any(item["id"] == "step-requirement-gap" for item in response["items"])


def test_low_code_agent_prepares_confirmation_after_user_supplies_fields():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _admin_headers()
        conversation = _assert_ok(
            client.post(
                "/api/v1/ai/agent/conversations",
                headers=headers,
                json={"title": "Guided form", "page": "ai-workbench", "context": {"surface": "global"}},
            ),
            context="create conversation",
        )["data"]

        _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": f"帮我新建一个供应商风险{suffix}表单",
                    "context": {"conversation_id": conversation["conversation_id"]},
                },
            ),
            context="first guided turn",
        )
        response = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": "字段包括供应商名称、风险等级、整改负责人；供应商名称必填；创建菜单入口",
                    "context": {"conversation_id": conversation["conversation_id"]},
                },
            ),
            context="requirements followup",
        )

        assert response["requires_confirmation"] is True
        assert _confirmation_actions(response)[0]["skill"] == "low_code.create_form_definition"
        payload = _confirmation_actions(response)[0]["payload"]
        assert payload["menu"]["create"] is True
        assert [field["label"] for field in payload["fields"][:3]] == ["供应商名称", "风险等级", "整改负责人"]


def test_low_code_slot_filling_state_persists_between_turns():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        headers = _admin_headers()
        conversation = _assert_ok(
            client.post(
                "/api/v1/ai/agent/conversations",
                headers=headers,
                json={"title": "Slot fill", "page": "ai-workbench", "context": {"surface": "global"}},
            ),
            context="create conversation",
        )["data"]

        first = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": f"帮我新建一个客户准入{suffix}表单",
                    "context": {"conversation_id": conversation["conversation_id"]},
                },
            ),
            context="first turn",
        )
        assert first["requires_confirmation"] is False
        assert first["action_state"]["status"] == "collecting"
        assert "fields" in first["action_state"]["missing_slots"]

        second = _assert_ok(
            client.post(
                "/api/v1/ai/agent",
                headers=headers,
                json={
                    "message": "字段包括客户名称、准入等级、状态；客户名称必填；创建菜单入口",
                    "context": {"conversation_id": conversation["conversation_id"]},
                },
            ),
            context="second turn",
        )

        assert second["requires_confirmation"] is True
        assert second["action_state"]["status"] == "ready_for_confirmation"
        payload = _confirmation_actions(second)[0]["payload"]
        assert payload["form"]["name"] == f"客户准入{suffix}"
        assert [field["label"] for field in payload["fields"][:3]] == ["客户名称", "准入等级", "状态"]


def test_confirmation_followup_can_reuse_recent_low_code_request():
    from app.services.ai.planner import plan_agent_turn

    plan = plan_agent_turn(
        "好的 就这样",
        {
            "recentMessages": [
                {"role": "user", "content": "我想建立一个关于设备的物料主数据的表单"},
                {"role": "assistant", "content": "我可以先准备表单方案"},
            ]
        },
    )

    assert plan.intent == "action"
    assert plan.reason == "confirmation_followup"
    assert plan.extracted_context["formName"] == "设备的物料主数据"


def test_low_code_followup_uses_supplied_name_before_fields():
    from app.services.ai.planner import plan_agent_turn

    plan = plan_agent_turn(
        "物料主数据；字段：物料编码、物料名称、物料类型、安全库存；物料编码和物料名称必填；创建菜单入口",
        {
            "recentMessages": [
                {"role": "user", "content": "你能帮我新建一个表单吗"},
                {"role": "assistant", "content": "请补充表单名称和字段"},
            ]
        },
    )

    assert plan.skill == "low_code.create_form_definition"
    assert plan.extracted_context["formName"] == "物料主数据"
    fields = plan.extracted_context["fields"]
    assert [field["label"] for field in fields] == ["物料编码", "物料名称", "物料类型", "安全库存"]
    assert [field["required"] for field in fields] == [True, True, False, False]


def test_low_code_confirmation_adjustment_overrides_form_name():
    from app.services.ai.action_state import create_or_update_action_state

    existing = {
        "status": "ready_for_confirmation",
        "skill": "low_code.create_form_definition",
        "source_message": "创建供应商风险表单",
        "collected_slots": {
            "formName": "供应商风险",
            "form_name": "供应商风险",
            "fields": [
                {"field_name": "supplier_name", "label": "供应商名称", "field_type": "string"},
                {"field_name": "risk_level", "label": "风险等级", "field_type": "enum"},
            ],
        },
        "missing_slots": [],
        "notes": [],
    }

    state = create_or_update_action_state(
        existing=existing,
        skill="low_code.create_form_definition",
        source_message="表单名称改为供应商风险复核",
        extracted_context=existing["collected_slots"],
    )

    assert state["status"] == "ready_for_confirmation"
    assert state["collected_slots"]["formName"] == "供应商风险复核"
    assert state["collected_slots"]["form_name"] == "供应商风险复核"
    assert len(state["collected_slots"]["fields"]) == 2


def test_non_admin_ai_policy_cannot_prepare_low_code_write():
    from app.services.ai.policies import decide_skill_permission
    from app.services.ai.schemas import SkillAction
    from app.services.ai.settings import AI_SYSTEM_SETTINGS

    action = SkillAction(
        skill="low_code.create_form_definition",
        title="Low-code form creation plan",
        mode="confirmed_write",
        risk_level="high",
    )
    decision = decide_skill_permission(
        {"sub": "auditor_gu", "roles": [{"name": "viewer"}], "is_admin": False},
        AI_SYSTEM_SETTINGS,
        action,
    )

    assert decision.allowed is False
    assert decision.capability == "config"
