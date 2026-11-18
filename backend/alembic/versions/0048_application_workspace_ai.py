"""Register the new built-in tools and skill for the application workspace."""

from alembic import op

from app.core.application_menu_registry_schema import (
    WORKSPACE_INSTALL_KEY, WORKSPACE_INSTALL_SOURCE, install_application_workspace_tools,
)
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting

revision = "0048_application_workspace_ai"
down_revision = "0047_application_access_groups"
branch_labels = None
depends_on = None


def upgrade():
    install_application_workspace_tools(op.get_bind())


def downgrade():
    for model in (AIAgentSkillDefinition, AIAgentToolDefinition):
        table = model.__table__
        op.execute(table.delete().where(table.c.source == WORKSPACE_INSTALL_SOURCE))
    settings = SystemSetting.__table__
    op.execute(settings.delete().where(settings.c.key == WORKSPACE_INSTALL_KEY))
