"""Typed tool registry for enterprise AI tools."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .skills import get_skill


RiskLevel = Literal["low", "medium", "high", "critical"]
SideEffect = Literal["read", "draft_write", "workflow_action", "external_write", "configuration_write"]


class ToolDefinition(BaseModel):
    name: str
    title: str
    description: str
    side_effect: SideEffect = "read"
    risk_level: RiskLevel = "low"
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    permission_check: str = "qa"
    dry_run_supported: bool = True
    audit_required: bool = False


TOOL_REGISTRY: dict[str, ToolDefinition] = {
    "knowledge.search": ToolDefinition(
        name="knowledge.search",
        title="Search knowledge",
        description="Search Markdown and vector chunks with permission filtering.",
        input_schema={"query": "string", "limit": "integer"},
        output_schema={"results": "array", "evidence": "array"},
        permission_check="rag",
    ),
    "knowledge.ingest_document": ToolDefinition(
        name="knowledge.ingest_document",
        title="Ingest knowledge document",
        description="Create an ingestion job from an uploaded source file.",
        side_effect="draft_write",
        risk_level="medium",
        input_schema={"asset_id": "string", "permission_scope": "string"},
        output_schema={"job_id": "string", "status": "string"},
        permission_check="rag",
        audit_required=True,
    ),
    "knowledge.convert_to_markdown": ToolDefinition(
        name="knowledge.convert_to_markdown",
        title="Convert to Markdown",
        description="Normalize documents, tables, PDFs, and images into Markdown.",
        input_schema={"asset_id": "string"},
        output_schema={"markdown_content": "string"},
        permission_check="rag",
    ),
    "knowledge.chunk_markdown": ToolDefinition(
        name="knowledge.chunk_markdown",
        title="Chunk Markdown",
        description="Split Markdown into source-linked retrieval chunks.",
        input_schema={"document_id": "string"},
        output_schema={"chunks": "array"},
        permission_check="rag",
    ),
    "knowledge.embed_chunks": ToolDefinition(
        name="knowledge.embed_chunks",
        title="Embed chunks",
        description="Generate embeddings for searchable chunks.",
        input_schema={"chunk_ids": "array"},
        output_schema={"embedding_count": "integer"},
        permission_check="rag",
    ),
    "forms.create_dynamic_record_draft": ToolDefinition(
        name="forms.create_dynamic_record_draft",
        title="Create form draft",
        description="Create an internal business record draft without submitting workflow.",
        side_effect="draft_write",
        risk_level="medium",
        input_schema={"form_key": "string", "payload": "object"},
        output_schema={"draft_id": "string", "status": "draft"},
        permission_check="save_draft",
        audit_required=True,
    ),
    "workflow.start": ToolDefinition(
        name="workflow.start",
        title="Start workflow",
        description="Start an approval workflow from a confirmed draft.",
        side_effect="workflow_action",
        risk_level="high",
        input_schema={"draft_id": "string", "workflow_key": "string"},
        output_schema={"workflow_id": "string", "status": "string"},
        permission_check="workflow",
        audit_required=True,
    ),
    "notifications.create": ToolDefinition(
        name="notifications.create",
        title="Create notification",
        description="Notify users about AI-generated drafts or workflow status.",
        side_effect="draft_write",
        risk_level="medium",
        input_schema={"target_user_ids": "array", "message": "string"},
        output_schema={"notification_id": "string"},
        permission_check="workflow",
        audit_required=True,
    ),
    "inventory.get_stock": ToolDefinition(
        name="inventory.get_stock",
        title="Get stock",
        description="Read inventory availability and safety stock signals.",
        input_schema={"material_code": "string"},
        output_schema={"stock": "object"},
        permission_check="business_query",
    ),
    "quality.get_event": ToolDefinition(
        name="quality.get_event",
        title="Get quality event",
        description="Read quality event details for CAPA draft preparation.",
        input_schema={"event_id": "string"},
        output_schema={"quality_event": "object"},
        permission_check="business_query",
    ),
    "graph.query_impact": ToolDefinition(
        name="graph.query_impact",
        title="Query impact graph",
        description="Analyze affected objects before suggesting configuration changes.",
        input_schema={"object_type": "string", "object_id": "string"},
        output_schema={"impacts": "array"},
        permission_check="business_query",
    ),
}


def list_tools() -> list[dict[str, Any]]:
    return [definition.model_dump() for definition in TOOL_REGISTRY.values()]


def get_tool(name: str) -> ToolDefinition | None:
    return TOOL_REGISTRY.get(name)


def validate_tool_call(skill_name: str, tool_name: str) -> tuple[bool, str]:
    skill = get_skill(skill_name)
    if not skill:
        return False, "Skill is not registered"
    if tool_name not in TOOL_REGISTRY:
        return False, "Tool is not registered"
    if tool_name not in skill.allowed_tools:
        return False, "Tool is outside the skill allowlist"
    return True, "Allowed"
