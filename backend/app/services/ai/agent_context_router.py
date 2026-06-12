"""Intent routing and read-only semantic data context for AI Agent runs."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relational import DynamicRecord, Form, FormField


ContextNeed = Literal[
    "none",
    "ui_page",
    "current_object",
    "visible_dataset",
    "business_query",
    "knowledge_rag",
    "semantic_graph",
    "draft_action",
]
SEMANTIC_CONTEXT_NEEDS = {"business_query", "visible_dataset", "current_object", "semantic_graph", "draft_action"}

DATA_TERMS = [
    "数据",
    "分析",
    "表单",
    "字段",
    "记录",
    "列表",
    "指标",
    "图表",
    "异常",
    "风险",
    "供应商",
    "物料",
    "工单",
    "设备",
    "质量",
    "capa",
    "spc",
    "oee",
]
KNOWLEDGE_TERMS = ["文档", "知识", "sop", "证据", "这篇", "当前文档", "发布清单", "抽取"]
PAGE_TERMS = ["当前页", "这个页面", "这里", "菜单", "配置", "权限", "页面"]
DRAFT_TERMS = ["草稿", "创建", "发起", "提交", "保存", "发布", "生成"]


def classify_context_need(message: str, context: dict[str, Any] | None = None) -> ContextNeed:
    context = context or {}
    explicit = context.get("contextNeed") or context.get("context_need")
    if explicit in {
        "none",
        "ui_page",
        "current_object",
        "visible_dataset",
        "business_query",
        "knowledge_rag",
        "semantic_graph",
        "draft_action",
    }:
        return explicit
    text = message.lower()
    if context.get("surface") == "knowledge" or any(term in text for term in KNOWLEDGE_TERMS):
        return "knowledge_rag"
    if any(term in text for term in DRAFT_TERMS) and any(term in text for term in DATA_TERMS + KNOWLEDGE_TERMS):
        return "draft_action"
    if any(term in text for term in DATA_TERMS):
        return "business_query"
    if any(term in text for term in PAGE_TERMS):
        return "ui_page"
    return "none"


class AgentContextRouter:
    def classify(self, message: str, context: dict[str, Any] | None = None) -> ContextNeed:
        return classify_context_need(message, context)

    async def build_semantic_context(
        self,
        session: AsyncSession,
        *,
        message: str,
        context: dict[str, Any],
        tenant_id: int,
        limit: int = 8,
    ) -> dict[str, Any]:
        need = self.classify(message, context)
        if need not in SEMANTIC_CONTEXT_NEEDS:
            return {"intent": need, "objects": [], "records": [], "relations": []}

        return self._semantic_context_unavailable(
            need,
            "No persisted semantic/page-contract context source is available for AI context routing.",
        )

    def _semantic_context_unavailable(self, intent: ContextNeed, reason: str) -> dict[str, Any]:
        return {
            "intent": intent,
            "status": "semantic_context_unavailable",
            "objects": [],
            "records": [],
            "relations": [],
            "record_count": 0,
            "reason": reason,
        }

    async def _query_matching_forms(
        self,
        session: AsyncSession,
        objects: list[dict[str, Any]],
        *,
        tenant_id: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        if not objects:
            return []
        forms = (
            await session.execute(
                select(Form).where(Form.tenant_id == tenant_id).order_by(Form.id)
            )
        ).scalars().all()
        output: list[dict[str, Any]] = []
        for obj in objects:
            source = str(obj.get("source") or obj.get("code") or obj.get("id") or "").lower()
            matched_form = next(
                (
                    form
                    for form in forms
                    if source
                    and (
                        source in str(form.name or "").lower()
                        or source in str(form.table_name or "").lower()
                        or source in str(form.code or "").lower()
                    )
                ),
                None,
            )
            if not matched_form:
                continue
            fields = (
                await session.execute(
                    select(FormField)
                    .where(FormField.form_id == matched_form.id, FormField.tenant_id == tenant_id)
                    .order_by(FormField.sort_order, FormField.id)
                )
            ).scalars().all()
            records = (
                await session.execute(
                    select(DynamicRecord)
                    .where(
                        DynamicRecord.form_id == matched_form.id,
                        DynamicRecord.tenant_id == tenant_id,
                        DynamicRecord.deleted_at.is_(None),
                    )
                    .order_by(DynamicRecord.id.desc())
                    .limit(limit)
                )
            ).scalars().all()
            output.append(
                {
                    "object": obj,
                    "form": {
                        "id": matched_form.id,
                        "name": matched_form.name,
                        "table_name": matched_form.table_name,
                    },
                    "fields": [
                        {"name": field.field_name, "label": field.label, "type": field.field_type}
                        for field in fields[:12]
                    ],
                    "records": [
                        {"id": record.id, "status": record.status, "data": record.data}
                        for record in records
                    ],
                }
            )
        return output


agent_context_router = AgentContextRouter()
