"""Remember whether an application's code has been locked by publication."""

import sqlalchemy as sa
from alembic import op

revision = "0046_application_code_lock"
down_revision = "0045_user_contact_details"
branch_labels = None
depends_on = None


def upgrade():
    if "code_locked" not in {column["name"] for column in sa.inspect(op.get_bind()).get_columns("applications")}:
        op.add_column("applications", sa.Column("code_locked", sa.Boolean(), nullable=False, server_default=sa.false()))
    applications = sa.table("applications", sa.column("status"), sa.column("code_locked", sa.Boolean()))
    op.execute(applications.update().where(applications.c.status.in_(["published", "active", "disabled"]))
               .values(code_locked=True))


def downgrade():
    op.drop_column("applications", "code_locked")
