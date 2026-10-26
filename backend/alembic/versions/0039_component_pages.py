"""Independent draft and published component pages."""
import sqlalchemy as sa
from alembic import op

revision = '0039_component_pages'
down_revision = '0038_analytics_shared_metrics'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('component_pages',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('code', sa.String(100), nullable=False),
        sa.Column('draft', sa.JSON(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('published_version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('tenant_id', 'code', name='uq_component_pages_tenant_code'))
    op.create_index('ix_component_pages_tenant_id', 'component_pages', ['tenant_id'])
    op.create_table('component_page_versions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('page_id', sa.Integer(), sa.ForeignKey('component_pages.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('definition', sa.JSON(), nullable=False),
        sa.Column('published_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('page_id', 'version', name='uq_component_page_version'))
    op.create_index('ix_component_page_versions_tenant_id', 'component_page_versions', ['tenant_id'])
    op.create_index('ix_component_page_versions_page_id', 'component_page_versions', ['page_id'])


def downgrade():
    op.drop_table('component_page_versions')
    op.drop_table('component_pages')
