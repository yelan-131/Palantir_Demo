"""Intent routing and read-only semantic data context for AI Agent runs."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession



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
        user: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        need = self.classify(message, context)
        if need not in SEMANTIC_CONTEXT_NEEDS:
            return {"intent": need, "objects": [], "records": [], "relations": []}

        if not user or user.get("tenant_id") != tenant_id:
            return self._semantic_context_unavailable(need, "Authenticated form context is required.")
        form_id = context.get("form_id") or context.get("formId")
        form_code = context.get("form_code") or context.get("formCode")
        route = str(context.get("route") or "").split("?")[0]
        if not form_id and not form_code and route.startswith(("/program/", "/dynamic/")):
            from urllib.parse import unquote
            slug = unquote(route.split("/", 2)[2])
            if route.startswith("/dynamic/") and slug.isdigit():
                form_id = int(slug)
            else:
                form_code = slug
        if not form_id and not form_code:
            return self._semantic_context_unavailable(need, "No explicit form or page contract was provided.")
        from app.services.records import resolve_form, list_records, runtime_fields
        from fastapi import HTTPException
        try:
            form = await resolve_form(session, user, form_id=form_id, form_code=form_code)
            result = await list_records(form.id, session, user, page_size=max(1, min(limit, 100)))
        except HTTPException as exc:
            if exc.status_code not in {403, 404}:
                raise
            return self._semantic_context_unavailable(need, "Requested form context is unavailable or unauthorized.")
        visible = {key for row in result["data"] for key in row["data"]}
        fields = [field for field in await runtime_fields(session, form) if field.field_name in visible]
        return {"intent": need, "status": "ready", "objects": [{"code": form.code, "name": form.name, "form_id": form.id}],
            "records": result["data"], "relations": [], "record_count": len(result["data"]), "total": result["total"],
            "fields": [{"name": field.field_name, "label": field.label, "type": field.field_type} for field in fields],
            "source": "record_service"}

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


agent_context_router = AgentContextRouter()
