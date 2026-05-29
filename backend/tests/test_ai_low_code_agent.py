from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _assert_ok(response, *, context: str) -> dict:
    assert response.status_code < 400, f"{context}: {response.status_code} {response.text}"
    return response.json()


def test_admin_agent_can_confirm_low_code_form_creation():
    from app.main import app

    suffix = uuid.uuid4().hex[:8]
    with TestClient(app) as client:
        login = _assert_ok(
            client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"}),
            context="login",
        )
        headers = _headers(login["token"])

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
        assert response["actions"][0]["skill"] == "low_code.create_form_definition"

        token = response["confirmation_payload"]["confirmation_token"]
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
        login = _assert_ok(
            client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"}),
            context="login",
        )
        headers = _headers(login["token"])
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
        assert assistant["confirmation_payload"]["confirmation_token"] == response["confirmation_payload"]["confirmation_token"]
        assert assistant["actions"][0]["skill"] == "low_code.create_form_definition"
        assert any(step["id"] == "step-planner" for step in assistant["steps"])


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
