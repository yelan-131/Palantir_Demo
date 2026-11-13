"""Record admin as the creator of the first built-in registry entries."""
import json
from pathlib import Path
import sqlalchemy as sa
from alembic import op

revision = "0041_builtin_skill_creator"
down_revision = "0040_component_canvas_tools"
branch_labels = None
depends_on = None

FIRST_SKILLS = (
    "knowledge.answer_question", "knowledge.ingest_for_rag", "knowledge.intake_document_ontology",
    "quality.create_capa_draft", "maintenance.create_work_order_draft",
    "supply.create_purchase_request_draft", "material.create_material_application_draft",
    "analysis.analyze_form_records", "forms.create_record_draft", "low_code.suggest_model_or_page",
    "low_code.create_form_definition", "low_code.add_form_field", "workflow.submit_after_confirmation",
    "low_code.inspect_form", "analysis.manage_dashboard", "analysis.query_dashboard",
    "low_code.publish_form_to_menu",
)


def upgrade():
    from app.services.ai.component_page_controls import TOOL_DETAILS

    # Read the bundled catalog to include tools installed outside the default import.
    catalog = Path(__file__).resolve().parents[2] / "app/services/ai/assets/tools.json"
    tool_names = tuple(json.loads(catalog.read_text(encoding="utf-8"))) + tuple(TOOL_DETAILS)
    bind = op.get_bind()
    for table_name, names in (
        ("ai_agent_skill_definitions", FIRST_SKILLS), ("ai_agent_tool_definitions", tool_names),
    ):
        table = sa.table(table_name, sa.column("name", sa.String), sa.column("definition", sa.JSON))
        rows = bind.execute(sa.select(table).where(table.c.name.in_(names))).all()
        for name, definition in rows:
            definition = definition or {}
            if not definition.get("created_by"):
                bind.execute(table.update().where(table.c.name == name).values(
                    definition={**definition, "created_by": "admin"},
                ))


def downgrade():
    # Attribution is valid independently of the application version.
    pass
