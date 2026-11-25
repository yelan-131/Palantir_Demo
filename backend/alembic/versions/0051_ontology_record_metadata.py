"""Persist tags and custom properties for source-bound ontology records."""

from alembic import op
import sqlalchemy as sa


revision = "0051_ontology_record_metadata"
down_revision = "0050_mapped_form_sync"
branch_labels = None
depends_on = None


def upgrade():
    if not op.get_context().as_sql and sa.inspect(op.get_bind()).has_table("ontology_record_metadata"):
        return
    op.create_table(
        "ontology_record_metadata",
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("object_id", sa.Integer(), sa.ForeignKey("ontology_objects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("record_id", sa.Integer(), primary_key=True),
        sa.Column("record_created_at", sa.String(64), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("ontology_record_metadata")
