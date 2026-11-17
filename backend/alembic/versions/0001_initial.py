"""initial schema baseline

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-26

This migration uses `Base.metadata.create_all` against the alembic
connection to materialize the current SQLAlchemy schema as the v0
baseline. Subsequent migrations should use proper `op.add_column /
op.create_table` etc. and be generated via `alembic revision --autogenerate`.

Because the baseline is the *current* schema, every later migration must
tolerate tables, columns and indexes that already exist on a fresh database.
"""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

from app.models.relational import Base

# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def _literal(value) -> str | None:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (str, dict, list)):
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        return "'" + text.replace("'", "''") + "'"
    return None


def _mirror_scalar_defaults(bind) -> None:
    """Later seed migrations insert rows with raw SQL written for older
    schemas, so NOT NULL columns that only carry a Python-side default need
    the same value as a database default on a fresh install."""
    if bind.dialect.name != "postgresql":
        return
    preparer = bind.dialect.identifier_preparer
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            default = column.default
            if column.nullable or column.server_default is not None or default is None:
                continue
            if default.is_scalar:
                value = default.arg
            elif default.is_callable:
                # Only container factories such as `default=dict`; time and id
                # factories must stay per-row.
                try:
                    value = default.arg(None)
                except Exception:
                    continue
                if not isinstance(value, (dict, list)):
                    continue
            else:
                continue
            literal = _literal(value)
            if literal is None:
                continue
            bind.execute(sa.text(
                f"ALTER TABLE {preparer.format_table(table)} "
                f"ALTER COLUMN {preparer.quote(column.name)} SET DEFAULT {literal}"
            ))


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)
    _mirror_scalar_defaults(bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
