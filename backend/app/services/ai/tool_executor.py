"""Confirmed Agent tool execution dispatcher."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.core.db import db_session

from .dynamic_record_drafts import create_dynamic_record_draft_from_agent
from .form_analysis import analyze_form_records
from .form_record_tools import get_form_record
from .low_code_tools import execute_add_form_field, execute_create_form_definition
from .skills import get_skill
from .tool_envelope import tool_execution_envelope


PersistDraft = Callable[..., Awaitable[dict[str, Any]]]
UpdateDraftStatus = Callable[..., Awaitable[None]]
AuditEvent = Callable[[dict[str, Any], str, dict[str, Any]], Any]
AgentEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]


class AgentToolExecutor:
    async def execute_confirmed_run(
        self,
        run: dict[str, Any],
        *,
        current_user: dict[str, Any],
        persist_ai_draft: PersistDraft,
        update_ai_draft_status: UpdateDraftStatus,
        audit_ai_event: AuditEvent | None,
        event_sink: AgentEventSink | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if run.get("status") != "confirmed":
            return run
        results: list[dict[str, Any]] = []
        safety_policy = (settings or {}).get("safetyPolicy") or {}
        timeout_seconds = max(1, min(int(safety_policy.get("toolTimeoutSeconds") or 30), 600))
        for index, action in enumerate(run.get("actions") or []):
            skill = action.get("skill")
            payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
            source_draft_id = str(payload.get("_source_draft_id") or payload.get("_resume_draft_id") or "")
            try:
                result_item = await tool_execution_envelope.execute_callable(
                    tool_name=self._tool_for_skill(str(skill or ""), payload),
                    skill_name=str(skill or ""),
                    payload=payload,
                    current_user=current_user,
                    settings=settings,
                    event_sink=event_sink,
                    audit_ai_event=audit_ai_event,
                    run_id=str(run.get("run_id") or ""),
                    callback=lambda payload_override=None, skill=str(skill or ""), payload=payload, evidence=action.get("evidence") or [], source_draft_id=source_draft_id: self._execute_action(
                        skill=str(skill or ""),
                        payload=payload_override if isinstance(payload_override, dict) else payload,
                        evidence=evidence,
                        run=run,
                        current_user=current_user,
                        persist_ai_draft=persist_ai_draft,
                        update_ai_draft_status=update_ai_draft_status,
                        audit_ai_event=audit_ai_event,
                        source_draft_id=source_draft_id,
                    ),
                )
            except asyncio.TimeoutError:
                result_item = {
                    "skill": skill,
                    "tool": self._tool_for_skill(str(skill or ""), payload),
                    "status": "failed",
                    "error": f"Tool execution exceeded {timeout_seconds} seconds",
                }
                if audit_ai_event:
                    audit_ai_event(
                        current_user,
                        "agent_tool_timeout",
                        {"skill": skill, "tool": result_item["tool"], "timeout_seconds": timeout_seconds},
                    )
            results.append(result_item)
            run.setdefault("items", []).extend(
                item for item in (result_item.get("items") or [result_item.get("item")]) if isinstance(item, dict) and item
            )
            if result_item.get("status") == "failed":
                break

        run["tool_results"] = results
        if any(item.get("status") == "failed" for item in results):
            run["status"] = "failed"
        elif any(item.get("status") == "completed" for item in results):
            run["status"] = "completed"
        return run

    @staticmethod
    def _tool_for_skill(skill: str, payload: dict[str, Any]) -> str:
        contract = payload.get("_contract") if isinstance(payload.get("_contract"), dict) else {}
        if contract.get("tool"):
            return str(contract["tool"])
        skill_def = get_skill(skill)
        if skill_def and skill_def.default_tool:
            return skill_def.default_tool
        return "ai.drafts.save"

    @staticmethod
    def _summarize_result(result: Any) -> str:
        if not isinstance(result, dict):
            return ""
        route_path = result.get("route_path")
        if route_path:
            return f"route_path={route_path}"
        record_id = result.get("record_id")
        form_code = result.get("form_code")
        if record_id is not None and form_code:
            return f"{form_code} record_id={record_id}"
        draft_id = result.get("draft_id")
        if draft_id:
            return f"draft_id={draft_id}"
        return ""

    async def _execute_action(
        self,
        *,
        skill: str,
        payload: dict[str, Any],
        evidence: list[dict[str, Any]],
        run: dict[str, Any],
        current_user: dict[str, Any],
        persist_ai_draft: PersistDraft,
        update_ai_draft_status: UpdateDraftStatus,
        audit_ai_event: AuditEvent | None,
        source_draft_id: str,
    ) -> dict[str, Any]:
        if skill == "low_code.create_form_definition":
            async with db_session() as session:
                result = await execute_create_form_definition(session, user=current_user, payload=payload)
            await self._mark_executed(update_ai_draft_status, source_draft_id, current_user, run, result)
            if audit_ai_event:
                audit_ai_event(current_user, "agent_tool_executed", {"skill": skill, "tool": "forms.create_form_definition", "result": result})
            return {"skill": skill, "tool": "forms.create_form_definition", "status": "completed", "result": result}

        if skill == "low_code.add_form_field":
            async with db_session() as session:
                result = await execute_add_form_field(session, user=current_user, payload=payload)
            await self._mark_executed(update_ai_draft_status, source_draft_id, current_user, run, result)
            if audit_ai_event:
                audit_ai_event(current_user, "agent_tool_executed", {"skill": skill, "tool": "forms.add_form_field", "result": result})
            return {"skill": skill, "tool": "forms.add_form_field", "status": "completed", "result": result}

        if skill == "analysis.analyze_form_records":
            async with db_session() as session:
                result = await analyze_form_records(
                    session,
                    user=current_user,
                    payload=payload,
                    question=str(payload.get("question") or payload.get("source_message") or ""),
                    provider_config=None,
                )
            summary = result.get("summary") or {}
            if audit_ai_event:
                audit_ai_event(current_user, "agent_tool_executed", {"skill": skill, "tool": "forms.query_records", "result": {"record_count": summary.get("record_count")}})
            return {"skill": skill, "tool": "forms.query_records", "status": "completed", "result": result}

        if skill == "forms.get_record":
            async with db_session() as session:
                result = await get_form_record(session, user=current_user, payload=payload)
            if audit_ai_event:
                audit_ai_event(current_user, "agent_tool_executed", {"skill": skill, "tool": "forms.get_record", "result": {"record_id": result.get("record", {}).get("id")}})
            return {"skill": skill, "tool": "forms.get_record", "status": "completed", "result": result}

        dynamic_result = None
        try:
            async with db_session() as session:
                dynamic_result = await create_dynamic_record_draft_from_agent(
                    session,
                    user=current_user,
                    skill=skill,
                    payload=payload,
                    evidence=evidence,
                )
        except (HTTPException, SQLAlchemyError):
            dynamic_result = None
        if dynamic_result:
            await self._mark_executed(update_ai_draft_status, source_draft_id, current_user, run, dynamic_result)
            if audit_ai_event:
                audit_ai_event(current_user, "agent_dynamic_record_draft_created", {"skill": skill, "result": dynamic_result})
            return {"skill": skill, "tool": "forms.create_dynamic_record_draft", "status": "completed", "result": dynamic_result}

        draft_record = await persist_ai_draft(
            current_user,
            skill=skill,
            payload=payload,
            evidence=evidence,
            source="agent_run_confirmation",
            run_id=str(run.get("run_id") or ""),
        )
        if audit_ai_event:
            audit_ai_event(current_user, "agent_draft_saved", {"skill": skill, "draft_id": draft_record["draft_id"], "persisted": draft_record.get("persisted")})
        await update_ai_draft_status(
            draft_id=source_draft_id,
            current_user=current_user,
            status="confirmed",
            metadata={"confirmed_result": draft_record, "run_id": run.get("run_id")},
        )
        tool = (payload.get("_contract") or {}).get("tool") or "ai.drafts.save"
        return {"skill": skill, "tool": tool, "status": "completed", "result": draft_record}

    @staticmethod
    async def _mark_executed(
        update_ai_draft_status: UpdateDraftStatus,
        source_draft_id: str,
        current_user: dict[str, Any],
        run: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        await update_ai_draft_status(
            draft_id=source_draft_id,
            current_user=current_user,
            status="executed",
            metadata={"executed_result": result, "run_id": run.get("run_id")},
        )


agent_tool_executor = AgentToolExecutor()
