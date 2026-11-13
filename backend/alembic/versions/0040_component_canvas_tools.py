"""Register the five browser canvas tools without replacing existing entries."""
import sqlalchemy as sa
from alembic import op

revision = '0040_component_canvas_tools'
down_revision = '0039_component_pages'
branch_labels = None
depends_on = None

tools = sa.table(
    'ai_agent_tool_definitions',
    sa.column('name', sa.String), sa.column('title', sa.String),
    sa.column('description', sa.Text), sa.column('handler_key', sa.String),
    sa.column('definition', sa.JSON), sa.column('enabled', sa.Boolean),
    sa.column('version', sa.Integer), sa.column('source', sa.String),
)
source = 'component_canvas_0040'


def upgrade():
    from app.services.ai.component_page_controls import registry_definitions

    bind = op.get_bind()
    for name, definition in registry_definitions().items():
        if bind.scalar(sa.select(tools.c.name).where(tools.c.name == name)) is not None:
            continue
        bind.execute(tools.insert().values(
            name=name, title=definition['title'], description=definition['description'],
            handler_key=name, definition=definition, enabled=True, version=1, source=source,
        ))


def downgrade():
    op.execute(tools.delete().where(tools.c.source == source))
