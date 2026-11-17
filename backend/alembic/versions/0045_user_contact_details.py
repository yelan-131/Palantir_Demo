"""Store user phone numbers and uploaded avatar images."""

import sqlalchemy as sa
from alembic import op

revision = "0045_user_contact_details"
down_revision = "0044_component_page_ai_tools"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"]: column["type"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "phone" not in columns:
            batch.add_column(sa.Column("phone", sa.String(40), nullable=True))
        if not isinstance(columns["avatar_url"], sa.Text):
            batch.alter_column("avatar_url", existing_type=columns["avatar_url"], type_=sa.Text())


def downgrade():
    op.execute("UPDATE users SET avatar_url = NULL WHERE length(avatar_url) > 1000")
    with op.batch_alter_table("users") as batch:
        batch.alter_column("avatar_url", existing_type=sa.Text(), type_=sa.String(1000))
        batch.drop_column("phone")
