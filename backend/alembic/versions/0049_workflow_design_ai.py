"""Register workflow design tools and skill for existing tenant registries."""

from alembic import op

from app.core.application_menu_registry_schema import (
    WORKFLOW_INSTALL_KEY, WORKFLOW_INSTALL_SOURCE, install_workflow_design_tools,
)
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting

revision = "0049_workflow_design_ai"
down_revision = "0048_application_workspace_ai"
branch_labels = None
depends_on = None


def upgrade():
    install_workflow_design_tools(op.get_bind())


def downgrade():
    for model in (AIAgentSkillDefinition, AIAgentToolDefinition):
        table = model.__table__
        op.execute(table.delete().where(table.c.source == WORKFLOW_INSTALL_SOURCE))
    settings = SystemSetting.__table__
    op.execute(settings.delete().where(settings.c.key == WORKFLOW_INSTALL_KEY))
