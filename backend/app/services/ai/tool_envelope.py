"""Unified execution envelope for AI tools."""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import Application, Form, Role, User, UserRole

from .agent_items import tool_call_item, tool_result_item
from .agent_validation import agent_validation_service
from .events import AgentEvent, EventBus
from .form_record_tools import get_form_record, query_form_records
from .hooks import register_builtin_hooks
from .knowledge_ingestion import search_ingested_knowledge
from .low_code_tools import execute_add_form_field, execute_create_form_definition
from .semantic_planner import plan_agent_turn_semantic
from .settings import safety_policy_snapshot
from .tenant_context import require_tenant_id
from .tool_handlers import dispatch_tool_handler
from .tool_registry import get_tool


AgentEventSink = Callable[[str, dict[str, Any]], Awaitable[None]]
AuditEvent = Callable[[dict[str, Any], str, dict[str, Any]], Any]


class ToolExecutionEnvelope:
    """Runs all AI tools through one observable, timeout-aware path."""

    async def execute_tool(
        self,
        *,
        tool_name: str,
        payload: dict[str, Any] | None = None,
        current_user: dict[str, Any] | None = None,
        skill_name: str | None = None,
        settings: dict[str, Any] | None = None,
        confirmed: bool = False,
        event_sink: AgentEventSink | None = None,
        audit_ai_event: AuditEvent | None = None,
        run_id: str | None = None,
        event_bus: EventBus | None = None,
    ) -> dict[str, Any]:
        bus = self._event_bus(settings, event_bus)
        tool_def = get_tool(tool_name)
        side_effect = tool_def.side_effect if tool_def else "read"
        risk_level = tool_def.risk_level if tool_def else "low"
        payload = payload or {}
        emitted_items: list[dict[str, Any]] = []
        call_item = tool_call_item(
            tool=tool_name,
            skill=skill_name,
            payload=payload,
            run_id=run_id,
            side_effect=side_effect,
            risk_level=risk_level,
        )
        emitted_items.append(call_item)
        if event_sink:
            await event_sink("item.created", call_item)
        await bus.emit(AgentEvent.ITEM_CREATED, call_item)

        hook_result = await bus.intercept(
            AgentEvent.PRE_TOOL_USE,
            {
                "tool": tool_name,
                "tool_name": tool_name,
                "skill": skill_name,
                "payload": payload,
                "user": current_user or {},
                "risk_level": risk_level,
                "side_effect": side_effect,
                "run_id": run_id,
            },
        )
        if hook_result.modified_payload is not None:
            payload = self._modified_tool_payload(hook_result.modified_payload, payload)
        if hook_result.action == "abort":
            validation = agent_validation_service.validate_tool_payload(
                tool_name=tool_name,
                payload=payload,
                settings=settings,
                skill_name=skill_name,
            )
            validation.issues.append(
                self._validation_issue("error", "hook_aborted", hook_result.reason or "Tool use aborted by hook", tool_name)
            )
            validation_item = await self._emit_validation(validation, event_sink=event_sink, bus=bus, run_id=run_id)
            emitted_items.append(validation_item)
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "blocked", "message": hook_result.reason or "Tool use aborted by hook"},
                status="failed",
                error=hook_result.reason or "hook_aborted",
                started_at=time.perf_counter(),
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )

        if agent_validation_service.enabled("validate_before_tool", settings):
            validation = agent_validation_service.validate_tool_payload(
                tool_name=tool_name,
                payload=payload,
                settings=settings,
                skill_name=skill_name,
            )
            validation_item = await self._emit_validation(validation, event_sink=event_sink, bus=bus, run_id=run_id)
            emitted_items.append(validation_item)
            if not validation.valid:
                return await self._finish(
                    tool_name=tool_name,
                    skill_name=skill_name,
                    output={"status": "validation_failed", "issues": [issue.as_dict() for issue in validation.errors]},
                    status="failed",
                    error=validation.summary(),
                    started_at=time.perf_counter(),
                    side_effect=side_effect,
                    risk_level=risk_level,
                    event_sink=event_sink,
                    audit_ai_event=audit_ai_event,
                    current_user=current_user,
                    run_id=run_id,
                    event_bus=bus,
                    emitted_items=emitted_items,
                )

        if tool_def is None:
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "not_implemented", "message": "Tool is not registered"},
                status="failed",
                error="not_implemented",
                started_at=time.perf_counter(),
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )

        if side_effect not in {"read", "analyze"} and not confirmed:
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "waiting_confirmation", "message": "Tool requires confirmation before execution"},
                status="waiting_confirmation",
                error=None,
                started_at=time.perf_counter(),
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )

        timeout_seconds = max(1, min(int(safety_policy_snapshot(settings).get("toolTimeoutSeconds") or 30), 600))
        started_at = time.perf_counter()
        try:
            output = await asyncio.wait_for(
                self._dispatch(tool_name, payload, current_user=current_user, settings=settings),
                timeout=timeout_seconds,
            )
            output_status = str(output.get("status") or "")
            result_status = "failed" if output_status in {"failed", "error", "not_implemented"} else "completed"
            result_error = output_status if result_status == "failed" else None
            if agent_validation_service.enabled("validate_after_tool", settings):
                validation = agent_validation_service.validate_tool_result(
                    tool_name=tool_name,
                    result=output,
                    settings=settings,
                    skill_name=skill_name,
                )
                validation_item = await self._emit_validation(validation, event_sink=event_sink, bus=bus, run_id=run_id)
                emitted_items.append(validation_item)
                if not validation.valid:
                    result_status = "failed"
                    result_error = validation.summary()
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output=output,
                status=result_status,
                error=result_error,
                started_at=started_at,
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )
        except asyncio.TimeoutError:
            if audit_ai_event and current_user:
                audit_ai_event(
                    current_user,
                    "agent_tool_timeout",
                    {"tool": tool_name, "skill": skill_name, "timeout_seconds": timeout_seconds},
                )
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "timeout", "timeout_seconds": timeout_seconds},
                status="failed",
                error=f"Tool execution exceeded {timeout_seconds} seconds",
                started_at=started_at,
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )
        except Exception as exc:  # noqa: BLE001 - envelope converts failures to items
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "failed"},
                status="failed",
                error=str(exc),
                started_at=started_at,
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )

    async def execute_callable(
        self,
        *,
        tool_name: str,
        skill_name: str | None,
        payload: dict[str, Any],
        current_user: dict[str, Any],
        callback: Callable[[], Awaitable[dict[str, Any]]],
        settings: dict[str, Any] | None = None,
        event_sink: AgentEventSink | None = None,
        audit_ai_event: AuditEvent | None = None,
        run_id: str | None = None,
        event_bus: EventBus | None = None,
    ) -> dict[str, Any]:
        bus = self._event_bus(settings, event_bus)
        tool_def = get_tool(tool_name)
        side_effect = tool_def.side_effect if tool_def else "configuration_write"
        risk_level = tool_def.risk_level if tool_def else "high"
        emitted_items: list[dict[str, Any]] = []
        call_item = tool_call_item(
            tool=tool_name,
            skill=skill_name,
            payload=payload,
            run_id=run_id,
            side_effect=side_effect,
            risk_level=risk_level,
        )
        emitted_items.append(call_item)
        if event_sink:
            await event_sink("item.created", call_item)
        await bus.emit(AgentEvent.ITEM_CREATED, call_item)
        hook_result = await bus.intercept(
            AgentEvent.PRE_TOOL_USE,
            {
                "tool": tool_name,
                "tool_name": tool_name,
                "skill": skill_name,
                "payload": payload,
                "user": current_user,
                "risk_level": risk_level,
                "side_effect": side_effect,
                "run_id": run_id,
            },
        )
        if hook_result.modified_payload is not None:
            payload = self._modified_tool_payload(hook_result.modified_payload, payload)
        if hook_result.action == "abort":
            validation = agent_validation_service.validate_tool_payload(tool_name=tool_name, payload=payload, settings=settings, skill_name=skill_name)
            validation.issues.append(self._validation_issue("error", "hook_aborted", hook_result.reason or "Tool use aborted by hook", tool_name))
            validation_item = await self._emit_validation(validation, event_sink=event_sink, bus=bus, run_id=run_id)
            emitted_items.append(validation_item)
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "blocked", "message": hook_result.reason or "Tool use aborted by hook"},
                status="failed",
                error=hook_result.reason or "hook_aborted",
                started_at=time.perf_counter(),
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )
        if agent_validation_service.enabled("validate_before_tool", settings):
            validation = agent_validation_service.validate_tool_payload(tool_name=tool_name, payload=payload, settings=settings, skill_name=skill_name)
            validation_item = await self._emit_validation(validation, event_sink=event_sink, bus=bus, run_id=run_id)
            emitted_items.append(validation_item)
            if not validation.valid:
                return await self._finish(
                    tool_name=tool_name,
                    skill_name=skill_name,
                    output={"status": "validation_failed", "issues": [issue.as_dict() for issue in validation.errors]},
                    status="failed",
                    error=validation.summary(),
                    started_at=time.perf_counter(),
                    side_effect=side_effect,
                    risk_level=risk_level,
                    event_sink=event_sink,
                    audit_ai_event=audit_ai_event,
                    current_user=current_user,
                    run_id=run_id,
                    event_bus=bus,
                    emitted_items=emitted_items,
                )
        timeout_seconds = max(1, min(int(safety_policy_snapshot(settings).get("toolTimeoutSeconds") or 30), 600))
        started_at = time.perf_counter()
        try:
            raw_output = await asyncio.wait_for(self._invoke_callback(callback, payload), timeout=timeout_seconds)
            output_status = str(raw_output.get("status") or "") if isinstance(raw_output, dict) else ""
            output = raw_output.get("result") if isinstance(raw_output, dict) and "result" in raw_output else raw_output
            if not isinstance(output, dict):
                output = {"value": output}
            result_status = "failed" if output_status in {"failed", "error", "not_implemented"} else "completed"
            result_error = output_status if result_status == "failed" else None
            if agent_validation_service.enabled("validate_after_tool", settings):
                validation = agent_validation_service.validate_tool_result(tool_name=tool_name, result=output, settings=settings, skill_name=skill_name)
                validation_item = await self._emit_validation(validation, event_sink=event_sink, bus=bus, run_id=run_id)
                emitted_items.append(validation_item)
                if not validation.valid:
                    result_status = "failed"
                    result_error = validation.summary()
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output=output,
                status=result_status,
                error=result_error,
                started_at=started_at,
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )
        except asyncio.TimeoutError:
            if audit_ai_event and current_user:
                audit_ai_event(
                    current_user,
                    "agent_tool_timeout",
                    {"tool": tool_name, "skill": skill_name, "timeout_seconds": timeout_seconds},
                )
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "timeout", "timeout_seconds": timeout_seconds},
                status="failed",
                error=f"Tool execution exceeded {timeout_seconds} seconds",
                started_at=started_at,
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )
        except Exception as exc:  # noqa: BLE001
            return await self._finish(
                tool_name=tool_name,
                skill_name=skill_name,
                output={"status": "failed"},
                status="failed",
                error=str(exc),
                started_at=started_at,
                side_effect=side_effect,
                risk_level=risk_level,
                event_sink=event_sink,
                audit_ai_event=audit_ai_event,
                current_user=current_user,
                run_id=run_id,
                event_bus=bus,
                emitted_items=emitted_items,
            )

    async def _dispatch(
        self,
        tool_name: str,
        payload: dict[str, Any],
        *,
        current_user: dict[str, Any] | None,
        settings: dict[str, Any] | None,
    ) -> dict[str, Any]:
        return await dispatch_tool_handler(tool_name, payload, current_user=current_user, settings=settings)

    async def _query_platform(
        self,
        tool_name: str,
        payload: dict[str, Any],
        *,
        current_user: dict[str, Any] | None,
    ) -> dict[str, Any]:
        tenant_id = require_tenant_id(current_user)
        limit = max(1, min(int(payload.get("limit") or 20), 100))
        async with db_session() as session:
            if tool_name == "platform.application_settings.query":
                rows = (
                    await session.execute(
                        select(Application).where(Application.tenant_id == tenant_id).order_by(Application.sort_order, Application.id).limit(limit)
                    )
                ).scalars().all()
                items = [{"id": row.id, "name": row.name, "code": row.code, "status": row.status} for row in rows]
                return {"items": items, "count": len(items), "subject": "applications"}

            if tool_name == "platform.form_settings.query":
                rows = (
                    await session.execute(
                        select(Form).where(Form.tenant_id == tenant_id).order_by(Form.id).limit(limit)
                    )
                ).scalars().all()
                items = [{"id": row.id, "name": row.name, "code": row.code, "status": row.status} for row in rows]
                return {"items": items, "count": len(items), "subject": "forms"}

            if tool_name == "platform.identity_settings.query":
                rows = (
                    await session.execute(
                        select(User).where(User.tenant_id == tenant_id).order_by(User.id).limit(limit)
                    )
                ).scalars().all()
                user_ids = [row.id for row in rows]
                role_rows = []
                if user_ids:
                    role_rows = (
                        await session.execute(
                            select(UserRole.user_id, Role.name, Role.label)
                            .join(Role, Role.id == UserRole.role_id)
                            .where(UserRole.tenant_id == tenant_id, UserRole.user_id.in_(user_ids))
                        )
                    ).all()
                roles_by_user: dict[int, list[dict[str, str]]] = {}
                for user_id, name, label in role_rows:
                    roles_by_user.setdefault(int(user_id), []).append({"name": name, "label": label})
                items = [
                    {
                        "id": row.id,
                        "username": row.username,
                        "display_name": row.display_name,
                        "email": row.email,
                        "is_active": row.is_active,
                        "roles": roles_by_user.get(row.id, []),
                    }
                    for row in rows
                ]
                return {"items": items, "count": len(items), "subject": "users"}

        return {"status": "not_implemented", "message": f"{tool_name} query is not implemented"}

    async def _finish(
        self,
        *,
        tool_name: str,
        skill_name: str | None,
        output: dict[str, Any],
        status: str,
        error: str | None,
        started_at: float,
        side_effect: str,
        risk_level: str,
        event_sink: AgentEventSink | None,
        audit_ai_event: AuditEvent | None,
        current_user: dict[str, Any] | None,
        run_id: str | None,
        event_bus: EventBus | None = None,
        emitted_items: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        item = tool_result_item(
            tool=tool_name,
            skill=skill_name,
            output=output,
            run_id=run_id,
            status=status,
            duration_ms=duration_ms,
            error=error,
            side_effect=side_effect,
            risk_level=risk_level,
        )
        if event_sink:
            await event_sink("item.updated", item)
        if event_bus:
            await event_bus.emit(
                AgentEvent.POST_TOOL_USE,
                {
                    "tool": tool_name,
                    "tool_name": tool_name,
                    "skill": skill_name,
                    "status": status,
                    "result": output,
                    "error": error,
                    "item": item,
                    "user": current_user or {},
                    "run_id": run_id,
                },
            )
        if audit_ai_event and current_user:
            audit_ai_event(
                current_user,
                "agent_tool_envelope_result",
                {"tool": tool_name, "skill": skill_name, "status": status, "duration_ms": duration_ms, "error": error},
            )
        return {
            "skill": skill_name,
            "tool": tool_name,
            "status": status,
            "result": output,
            "error": error,
            "duration_ms": duration_ms,
            "item": item,
            "items": [*(emitted_items or []), item],
        }

    @staticmethod
    def _event_bus(settings: dict[str, Any] | None, event_bus: EventBus | None) -> EventBus:
        if event_bus:
            return event_bus
        bus = EventBus()
        register_builtin_hooks(bus, settings or {})
        return bus

    @staticmethod
    def _modified_tool_payload(modified_payload: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        nested = modified_payload.get("payload")
        if isinstance(nested, dict):
            return nested
        return modified_payload if isinstance(modified_payload, dict) else fallback

    @staticmethod
    def _validation_issue(severity: str, code: str, message: str, tool_name: str):
        from .agent_validation import ValidationIssue

        return ValidationIssue("error" if severity == "error" else "warning", code, message, tool=tool_name)

    async def _emit_validation(self, validation, *, event_sink: AgentEventSink | None, bus: EventBus, run_id: str | None) -> dict[str, Any]:
        await bus.emit(AgentEvent.VALIDATION_STARTED, {"phase": validation.phase, "tool": validation.tool, "run_id": run_id})
        item = validation.as_item(run_id=run_id)
        if event_sink:
            await event_sink("item.created", item)
            await event_sink("validation.completed", item)
        await bus.emit(AgentEvent.VALIDATION_COMPLETED, item)
        return item

    @staticmethod
    async def _invoke_callback(callback: Callable[..., Awaitable[dict[str, Any]]], payload: dict[str, Any]) -> dict[str, Any]:
        try:
            signature = inspect.signature(callback)
            if signature.parameters:
                return await callback(payload)
        except (TypeError, ValueError):
            pass
        return await callback()


tool_execution_envelope = ToolExecutionEnvelope()
