"""Persist role groups for application access."""

import sqlalchemy as sa
from alembic import op

revision = "0047_application_access_groups"
down_revision = "0046_application_code_lock"
branch_labels = None
depends_on = None


def upgrade():
    columns = sa.inspect(op.get_bind()).get_columns("applications")
    if "access_groups" not in {column["name"] for column in columns}:
        op.add_column("applications", sa.Column("access_groups", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("applications", "access_groups")
