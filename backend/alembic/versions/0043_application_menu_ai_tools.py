"""Register the built-in application and menu management tools."""

from alembic import op

from app.core.application_menu_registry_schema import INSTALL_KEY, INSTALL_SOURCE, install_application_menu_tools
from app.models.relational import AIAgentToolDefinition, SystemSetting

revision = "0043_application_menu_ai_tools"
down_revision = "0042_agent_registry_tenants"
branch_labels = None
depends_on = None


def upgrade():
    install_application_menu_tools(op.get_bind(), include_workspace=False)


def downgrade():
    tools = AIAgentToolDefinition.__table__
    settings = SystemSetting.__table__
    op.execute(tools.delete().where(tools.c.source == INSTALL_SOURCE))
    op.execute(settings.delete().where(settings.c.key == INSTALL_KEY))
