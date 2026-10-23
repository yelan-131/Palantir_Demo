"""Versioned, tenant-scoped shared analytics metric library."""
import sqlalchemy as sa
from alembic import op

revision = '0038_analytics_shared_metrics'
down_revision = '0037_workflow_def_versions'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('analytics_shared_metrics',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('draft', sa.JSON(), nullable=False),
        sa.Column('published_version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_analytics_shared_metrics_tenant_id', 'analytics_shared_metrics', ['tenant_id'])
    op.create_table('analytics_shared_metric_versions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('metric_id', sa.String(64), sa.ForeignKey('analytics_shared_metrics.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('definition', sa.JSON(), nullable=False),
        sa.Column('note', sa.String(500), nullable=True),
        sa.Column('published_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('published_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('metric_id', 'version', name='uq_analytics_shared_metric_version'))
    op.create_index('ix_analytics_shared_metric_versions_tenant_id', 'analytics_shared_metric_versions', ['tenant_id'])
    op.create_index('ix_analytics_shared_metric_versions_metric_id', 'analytics_shared_metric_versions', ['metric_id'])


def downgrade():
    op.drop_table('analytics_shared_metric_versions')
    op.drop_table('analytics_shared_metrics')
