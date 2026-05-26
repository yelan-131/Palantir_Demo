"""Built-in enterprise AI skill registry."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


RiskLevel = Literal["low", "medium", "high", "critical"]
CapabilityLevel = Literal["qa", "assisted", "agentic"]


class SkillDefinition(BaseModel):
    name: str
    title: str
    description: str
    capability_level: CapabilityLevel
    risk_level: RiskLevel = "low"
    allowed_tools: list[str] = Field(default_factory=list)
    required_permissions: list[str] = Field(default_factory=list)
    confirmation_policy: Literal["none", "confirm", "confirm_token", "blocked"] = "none"
    output_schema: dict[str, Any] = Field(default_factory=dict)


SKILL_REGISTRY: dict[str, SkillDefinition] = {
    "knowledge.answer_question": SkillDefinition(
        name="knowledge.answer_question",
        title="Knowledge Q&A",
        description="Search approved knowledge and answer with evidence references.",
        capability_level="qa",
        risk_level="low",
        allowed_tools=["knowledge.search"],
        required_permissions=["rag"],
        confirmation_policy="none",
        output_schema={"type": "answer", "requires_evidence": True},
    ),
    "knowledge.ingest_for_rag": SkillDefinition(
        name="knowledge.ingest_for_rag",
        title="Knowledge ingestion",
        description="Convert uploaded assets into Markdown and searchable chunks.",
        capability_level="assisted",
        risk_level="medium",
        allowed_tools=[
            "knowledge.ingest_document",
            "knowledge.convert_to_markdown",
            "knowledge.chunk_markdown",
            "knowledge.embed_chunks",
        ],
        required_permissions=["rag"],
        confirmation_policy="confirm",
        output_schema={"type": "ingestion_job"},
    ),
    "quality.create_capa_draft": SkillDefinition(
        name="quality.create_capa_draft",
        title="CAPA draft",
        description="Prepare a quality CAPA draft from page context and knowledge evidence.",
        capability_level="assisted",
        risk_level="medium",
        allowed_tools=["knowledge.search", "quality.get_event", "forms.create_dynamic_record_draft"],
        required_permissions=["draft", "quality"],
        confirmation_policy="confirm_token",
        output_schema={"type": "draft_action", "domain": "quality"},
    ),
    "maintenance.create_work_order_draft": SkillDefinition(
        name="maintenance.create_work_order_draft",
        title="Maintenance work order draft",
        description="Prepare a maintenance work order draft with supporting evidence.",
        capability_level="assisted",
        risk_level="medium",
        allowed_tools=["knowledge.search", "inventory.get_stock", "forms.create_dynamic_record_draft"],
        required_permissions=["draft", "maintenance"],
        confirmation_policy="confirm_token",
        output_schema={"type": "draft_action", "domain": "maintenance"},
    ),
    "supply.create_purchase_request_draft": SkillDefinition(
        name="supply.create_purchase_request_draft",
        title="Purchase request draft",
        description="Prepare a purchase request draft without creating an external order.",
        capability_level="assisted",
        risk_level="medium",
        allowed_tools=["knowledge.search", "inventory.get_stock", "forms.create_dynamic_record_draft"],
        required_permissions=["draft", "supply-chain"],
        confirmation_policy="confirm_token",
        output_schema={"type": "draft_action", "domain": "supply-chain"},
    ),
    "material.create_material_application_draft": SkillDefinition(
        name="material.create_material_application_draft",
        title="Material application draft",
        description="Prepare a material application draft for human review.",
        capability_level="assisted",
        risk_level="medium",
        allowed_tools=["knowledge.search", "inventory.get_stock", "forms.create_dynamic_record_draft"],
        required_permissions=["draft", "supply-chain"],
        confirmation_policy="confirm_token",
        output_schema={"type": "draft_action", "domain": "supply-chain"},
    ),
    "low_code.suggest_model_or_page": SkillDefinition(
        name="low_code.suggest_model_or_page",
        title="Low-code design suggestion",
        description="Suggest data model, page, or workflow configuration changes as a draft.",
        capability_level="assisted",
        risk_level="high",
        allowed_tools=["knowledge.search", "graph.query_impact"],
        required_permissions=["config"],
        confirmation_policy="confirm_token",
        output_schema={"type": "configuration_suggestion", "diff_required": True},
    ),
    "workflow.submit_after_confirmation": SkillDefinition(
        name="workflow.submit_after_confirmation",
        title="Workflow submission",
        description="Submit a prepared draft to workflow only after confirmation.",
        capability_level="agentic",
        risk_level="high",
        allowed_tools=["workflow.start", "notifications.create"],
        required_permissions=["workflow"],
        confirmation_policy="confirm_token",
        output_schema={"type": "workflow_result"},
    ),
}


def list_skills() -> list[dict[str, Any]]:
    return [definition.model_dump() for definition in SKILL_REGISTRY.values()]


def get_skill(name: str) -> SkillDefinition | None:
    return SKILL_REGISTRY.get(name)
