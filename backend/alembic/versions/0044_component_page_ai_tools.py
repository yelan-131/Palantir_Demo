"""Register AI tools for the component page lifecycle."""

from alembic import op

from app.core.component_page_registry_schema import INSTALL_KEY, INSTALL_SOURCE, install_component_page_tools
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting

revision = "0044_component_page_ai_tools"
down_revision = "0043_application_menu_ai_tools"
branch_labels = None
depends_on = None


def upgrade():
    install_component_page_tools(op.get_bind())


def downgrade():
    for model in (AIAgentSkillDefinition, AIAgentToolDefinition):
        table = model.__table__
        op.execute(table.delete().where(table.c.source == INSTALL_SOURCE))
    settings = SystemSetting.__table__
    op.execute(settings.delete().where(settings.c.key == INSTALL_KEY))
