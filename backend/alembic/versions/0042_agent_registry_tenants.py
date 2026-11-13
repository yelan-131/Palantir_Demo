"""Scope agent skill and tool definitions to tenants."""

from alembic import op

from app.core.agent_registry_schema import ensure_tenant_registry_schema

revision = "0042_agent_registry_tenants"
down_revision = "0041_builtin_skill_creator"
branch_labels = None
depends_on = None


def upgrade():
    ensure_tenant_registry_schema(op)


def downgrade():
    from sqlalchemy import text

    tables = ("ai_agent_skill_definitions", "ai_agent_tool_definitions")
    for table in tables:
        if op.get_bind().scalar(text(f"SELECT 1 FROM {table} WHERE tenant_id <> 1 LIMIT 1")):
            raise RuntimeError("Cannot restore a global registry while other tenants have saved definitions")
    if op.get_bind().scalar(text(
        "SELECT 1 FROM system_settings WHERE key LIKE 'ai.agent_registry:%' LIMIT 1"
    )):
        raise RuntimeError("Cannot restore a global registry while other tenants have saved configuration")
    for table in tables:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"uq_{table}_tenant_name", type_="unique")
            batch.drop_column("tenant_id")
            batch.create_unique_constraint(f"uq_{table}_name", ["name"])
