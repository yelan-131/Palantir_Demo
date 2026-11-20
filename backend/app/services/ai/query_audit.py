"""Persist business-query outcomes without copying AI inputs or record data."""

from __future__ import annotations

from typing import Any

from anyio import CancelScope
from sqlalchemy import select

from app.core.audit import write_audit_log
from app.core.db import db_session
from app.models.relational import AuditLog

from .schemas import AIPermissionDecision
from .settings import audit_enabled
from .tenant_context import TenantContextError, require_tenant_id


AI_ASSISTANT_RESOURCE = "ai_assistant"
FORM_QUERY_TOOLS = frozenset({"forms.get_record", "forms.query_records"})
POLICY_DENIED = "AI_QUERY_POLICY_DENIED"
ACCESS_DENIED = "AI_QUERY_ACCESS_DENIED"

_POLICY_REASONS = {
    "AI 已关闭": "平台 AI 已关闭，业务查询被拦截。",
    "Agent 已关闭": "AI Agent 已关闭，业务查询被拦截。",
    "问答与查询能力已关闭": "平台问答与查询能力已关闭。",
    "AI capability or domain is not allowed for this role": "当前角色的 AI 策略未放行业务查询（business_query）。",
    "No matching AI role policy": "当前角色没有启用的 AI 策略。",
    "Tool is not registered": "该业务查询工具未注册。",
    "Action is disabled by AI safety policy": "AI 安全策略禁止此业务查询。",
}
_ACCESS_REASONS = {
    "Form permission denied": "当前用户没有该表单的查看权限。",
    "Record permission denied": "当前用户的数据范围不允许查看该记录。",
}


def _positive_id(value: Any) -> int | None:
    if type(value) is int and value > 0:
        return value
    if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 18:
        return int(value) or None
    return None


async def _write_query_audit(*, user: dict, settings: dict, action: str, details: dict) -> None:
    if not audit_enabled(settings):
        return
    try:
        tenant_id = require_tenant_id(user)
    except TenantContextError:
        return
    user_id = _positive_id(user.get("uid"))
    if user_id is None:
        return
    # The query outcome has already happened when the UI disconnects.
    with CancelScope(shield=True):
        await write_audit_log(
            action=action,
            resource_type=AI_ASSISTANT_RESOURCE,
            resource_id=details.get("record_id") or details.get("form_id"),
            new_values=details,
            user_id=user_id,
            tenant_id=tenant_id,
        )


async def audit_query_policy_denial(
    user: dict, settings: dict, decision: AIPermissionDecision, *, tool: str | None = None, run_id: str | None = None,
) -> None:
    details = {
        "result": "denied",
        "reason_code": POLICY_DENIED,
        "reason": _POLICY_REASONS.get(decision.reason, "AI 权限或风险策略未放行此业务查询。"),
        "stage": "tool_policy" if tool else "ai_policy",
        "capability": "business_query",
    }
    if decision.matched_role:
        details["matched_role"] = decision.matched_role[:180]
    if tool:
        details["tool"] = tool
    if run_id:
        details["run_id"] = run_id
    await _write_query_audit(user=user, settings=settings, action="ai_query_denied", details=details)


async def audit_form_query_result(
    user: dict, settings: dict, *, tool: str, status: str, output: dict, run_id: str | None = None,
    denied_detail: str | None = None,
) -> None:
    if tool not in FORM_QUERY_TOOLS:
        return
    details: dict[str, Any] = {"capability": "business_query", "tool": tool}
    if run_id:
        details["run_id"] = run_id
    if denied_detail is not None:
        details.update(
            result="denied", reason_code=ACCESS_DENIED, stage="form_data",
            reason=_ACCESS_REASONS.get(denied_detail, "业务数据权限拒绝查询，未返回记录。"),
        )
        await _write_query_audit(user=user, settings=settings, action="ai_query_denied", details=details)
        return
    if status != "completed":
        return
    form = output.get("form")
    if not isinstance(form, dict) or (form_id := _positive_id(form.get("id"))) is None:
        return
    details["form_id"] = form_id
    if isinstance(form.get("code"), str):
        details["form_code"] = form["code"][:100]
    if tool == "forms.get_record":
        record = output.get("record")
        if not isinstance(record, dict) or (record_id := _positive_id(record.get("id"))) is None:
            return
        details.update(record_id=record_id, reason="通过表单和记录查看权限检查，已读取一条业务记录。")
    else:
        records = output.get("records")
        if not isinstance(records, list):
            return
        details.update(record_count=len(records), reason=f"通过表单查看权限检查，返回 {len(records)} 条当前用户可见的记录。")
    details.update(result="succeeded", stage="tool_result")
    await _write_query_audit(user=user, settings=settings, action="ai_query_succeeded", details=details)


async def list_query_audits(tenant_id: int, limit: int) -> list[dict[str, Any]]:
    async with db_session() as session:
        rows = (await session.scalars(
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant_id, AuditLog.resource_type == AI_ASSISTANT_RESOURCE)
            .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
            .limit(limit)
        )).all()
        return [
            {
                "id": row.id, "tenant_id": row.tenant_id, "user_id": row.user_id, "action": row.action,
                "resource_type": row.resource_type, "resource_id": row.resource_id,
                "old_values": row.old_values, "new_values": row.new_values,
                "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            }
            for row in rows
        ]
