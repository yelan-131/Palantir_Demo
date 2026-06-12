"""Whitelisted AI tool handlers.

Database registry rows may only reference keys registered in this module.  The
registry can change metadata and route a tool to a known handler, but it cannot
introduce arbitrary code, scripts, or external endpoints.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import Application, Form, Role, User, UserRole

from .form_record_tools import get_form_record, query_form_records
from .knowledge_ingestion import search_ingested_knowledge
from .low_code_tools import execute_add_form_field, execute_create_form_definition
from .semantic_planner import plan_agent_turn_semantic
from .tenant_context import require_tenant_id
from .tool_registry import get_tool


@dataclass(frozen=True)
class ToolHandlerContext:
    tool_name: str
    current_user: dict[str, Any] | None
    settings: dict[str, Any] | None


ToolHandler = Callable[[dict[str, Any], ToolHandlerContext], Awaitable[dict[str, Any]]]


async def _not_implemented(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    return {"status": "not_implemented", "message": f"{context.tool_name} is not implemented by a registered handler"}


async def _knowledge_search(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    query = str(payload.get("query") or "")
    limit = int(payload.get("limit") or 5)
    tenant_id = require_tenant_id(context.current_user)
    results = search_ingested_knowledge(query, tenant_id=tenant_id, limit=limit)
    return {"results": results, "result_count": len(results)}


async def _forms_query_records(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    async with db_session() as session:
        return await query_form_records(session, user=context.current_user or {}, payload=payload)


async def _forms_get_record(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    async with db_session() as session:
        return await get_form_record(session, user=context.current_user or {}, payload=payload)


async def _forms_create_form_definition(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    async with db_session() as session:
        return await execute_create_form_definition(session, user=context.current_user or {}, payload=payload)


async def _forms_add_form_field(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    async with db_session() as session:
        return await execute_add_form_field(session, user=context.current_user or {}, payload=payload)


async def _semantic_low_code_plan(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    plan = await plan_agent_turn_semantic(
        str(payload.get("message") or ""),
        {
            "recentMessages": payload.get("recent_messages") or [],
            "pendingActionState": payload.get("pending_slots") or {},
        },
    )
    return plan.__dict__


async def _platform_query(payload: dict[str, Any], context: ToolHandlerContext) -> dict[str, Any]:
    tenant_id = require_tenant_id(context.current_user)
    limit = max(1, min(int(payload.get("limit") or 20), 100))
    async with db_session() as session:
        if context.tool_name == "platform.application_settings.query":
            rows = (
                await session.execute(
                    select(Application).where(Application.tenant_id == tenant_id).order_by(Application.sort_order, Application.id).limit(limit)
                )
            ).scalars().all()
            items = [{"id": row.id, "name": row.name, "code": row.code, "status": row.status} for row in rows]
            return {"items": items, "count": len(items), "subject": "applications"}

        if context.tool_name == "platform.form_settings.query":
            rows = (
                await session.execute(select(Form).where(Form.tenant_id == tenant_id).order_by(Form.id).limit(limit))
            ).scalars().all()
            items = [{"id": row.id, "name": row.name, "code": row.code, "status": row.status} for row in rows]
            return {"items": items, "count": len(items), "subject": "forms"}

        if context.tool_name == "platform.identity_settings.query":
            rows = (
                await session.execute(select(User).where(User.tenant_id == tenant_id).order_by(User.id).limit(limit))
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
    return await _not_implemented(payload, context)


TOOL_HANDLERS: dict[str, ToolHandler] = {
    "not_implemented": _not_implemented,
    "knowledge.search": _knowledge_search,
    "forms.query_records": _forms_query_records,
    "forms.get_record": _forms_get_record,
    "forms.create_form_definition": _forms_create_form_definition,
    "forms.add_form_field": _forms_add_form_field,
    "ai.semantic_plan_low_code_form": _semantic_low_code_plan,
    "platform.query": _platform_query,
}


def list_tool_handler_keys() -> list[str]:
    return sorted(TOOL_HANDLERS)


async def dispatch_tool_handler(
    tool_name: str,
    payload: dict[str, Any],
    *,
    current_user: dict[str, Any] | None,
    settings: dict[str, Any] | None,
) -> dict[str, Any]:
    tool_def = get_tool(tool_name)
    handler_key = tool_def.handler_key if tool_def and tool_def.handler_key else tool_name
    handler = TOOL_HANDLERS.get(handler_key)
    if handler is None:
        handler = TOOL_HANDLERS["not_implemented"]
    return await handler(payload, ToolHandlerContext(tool_name=tool_name, current_user=current_user, settings=settings))
