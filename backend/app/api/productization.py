"""Production-readiness boundaries for the first SaaS delivery path."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


READY_PATH = [
    "tenant",
    "user",
    "role",
    "application",
    "form",
    "dynamic_record",
    "permission",
    "workflow",
    "report",
    "audit",
]


MODULE_MATURITY = [
    {
        "module": "low_code_core",
        "status": "ready_foundation",
        "production_scope": "tenant, application, form, dynamic records, permissions, workflow, reports, audit",
        "boundary": "first SaaS acceptance path",
    },
    {
        "module": "rules_engine",
        "status": "ready_foundation",
        "production_scope": "database-backed validation and trigger rules",
        "boundary": "production mode must not silently use mock rules or mock trigger writes",
    },
    {
        "module": "quality",
        "status": "beta_demo",
        "production_scope": "demo analytics and quality event workflows",
        "boundary": "not part of first SaaS acceptance unless explicitly hardened",
    },
    {
        "module": "maintenance",
        "status": "beta_demo",
        "production_scope": "demo equipment health and maintenance workflows",
        "boundary": "not part of first SaaS acceptance unless explicitly hardened",
    },
    {
        "module": "supply_chain",
        "status": "beta_demo",
        "production_scope": "demo supplier/material risk views",
        "boundary": "simulated data only until a real connector is implemented",
    },
    {
        "module": "ai_assistant",
        "status": "beta_demo",
        "production_scope": "assistant surface and draft recommendations",
        "boundary": "must not be the sole source of production correctness",
    },
    {
        "module": "knowledge_base",
        "status": "demo",
        "production_scope": "static/local retrieval and upload simulation",
        "boundary": "requires persistent documents, chunks, indexing, evidence, review, and rollback before production",
    },
    {
        "module": "graph_ontology_semantic_assets",
        "status": "beta_demo",
        "production_scope": "basic graph visualization and semantic asset direction",
        "boundary": "not a dependency of the first SaaS acceptance path",
    },
    {
        "module": "data_integration_connectors",
        "status": "roadmap",
        "production_scope": "file/database/ERP/MES/IoT connectors",
        "boundary": "current MES/ERP/IoT/PLC code is simulator/demo generator only",
    },
]


@router.get("/readiness")
async def get_productization_readiness():
    """Return the current production acceptance path and module maturity map."""
    return {
        "ready_path": READY_PATH,
        "modules": MODULE_MATURITY,
        "acceptance_rule": (
            "Only ready_foundation modules are part of the first production acceptance path; "
            "beta_demo, demo, and roadmap modules must be presented as bounded capabilities."
        ),
    }
