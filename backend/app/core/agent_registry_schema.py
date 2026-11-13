"""Upgrade the registry tables for both Alembic and SQLite bootstrap."""

from sqlalchemy import Column, Integer, inspect


def ensure_tenant_registry_schema(operations):
    connection = operations.get_bind()
    for table in ("ai_agent_skill_definitions", "ai_agent_tool_definitions"):
        if "tenant_id" in {column["name"] for column in inspect(connection).get_columns(table)}:
            continue
        with operations.batch_alter_table(table) as batch:
            # The old registry had no owner. Keep those rows in the original tenant.
            batch.add_column(Column("tenant_id", Integer, nullable=False, server_default="1"))
            batch.drop_constraint(f"uq_{table}_name", type_="unique")
            batch.create_unique_constraint(f"uq_{table}_tenant_name", ["tenant_id", "name"])


def ensure_sqlite_tenant_registry_schema(connection):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    ensure_tenant_registry_schema(Operations(MigrationContext.configure(connection)))
