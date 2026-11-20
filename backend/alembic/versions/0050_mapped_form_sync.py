"""Persist reusable mapped form sync bindings and execution receipts."""

from alembic import op
import sqlalchemy as sa


revision = "0050_mapped_form_sync"
down_revision = "0049_workflow_design_ai"
branch_labels = None
depends_on = None


def upgrade():
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "mapped_form_sync_bindings" not in tables:
        op.create_table(
            "mapped_form_sync_bindings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("source_id", sa.Integer(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
            sa.Column("entity_name", sa.String(200), nullable=False),
            sa.Column("object_code", sa.String(120), nullable=False),
            sa.Column("form_id", sa.Integer(), sa.ForeignKey("forms.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("tenant_id", "source_id", "entity_name", "object_code", "form_id",
                                name="uq_mapped_form_sync_binding_target"),
        )
        op.create_index("ix_mapped_form_sync_bindings_scope", "mapped_form_sync_bindings", ["tenant_id", "source_id"])
    if "mapped_form_sync_runs" not in tables:
        op.create_table(
            "mapped_form_sync_runs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("binding_id", sa.Integer(), sa.ForeignKey("mapped_form_sync_bindings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("actor_id", sa.Integer(), nullable=True),
            sa.Column("source_key", sa.String(200), nullable=True),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("finished_at", sa.DateTime(), nullable=False),
            sa.Column("read", sa.Integer(), nullable=False),
            sa.Column("created", sa.Integer(), nullable=False),
            sa.Column("updated", sa.Integer(), nullable=False),
            sa.Column("unchanged", sa.Integer(), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
        )
        op.create_index("ix_mapped_form_sync_runs_scope", "mapped_form_sync_runs",
                        ["tenant_id", "binding_id", "finished_at", "id"])


def downgrade():
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "mapped_form_sync_runs" in tables:
        op.drop_table("mapped_form_sync_runs")
    if "mapped_form_sync_bindings" in tables:
        op.drop_table("mapped_form_sync_bindings")
