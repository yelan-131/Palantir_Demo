"""PostgreSQL schema edits must not make the next publication preview fail."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from tests.test_record_service import environment, seed
from app.models.relational import Form
from app.services.form_definition import _build_publish_preview


@pytest.mark.asyncio
async def test_external_schema_change_recovers_cached_preview_without_losing_draft(environment):
    db, _, form, user, _ = environment
    if db.bind.dialect.name != 'postgresql' or form.storage_mode != 'physical_table':
        pytest.skip('Requires a disposable PostgreSQL physical form')
    await seed(db, 'Existing record')
    # Keep one driver connection alive while a separate engine changes the
    # table, as happens when another pooled HTTP request adds a form field.
    async with db.bind.connect() as connection:
        async with AsyncSession(bind=connection, expire_on_commit=False) as session:
            source = await session.get(Form, form.id)
            await _build_publish_preview(session, form.tenant_id, source)
            await session.commit()
            external = create_async_engine(db.bind.url)
            try:
                async with external.begin() as other:
                    await other.execute(text('ALTER TABLE t1_business_contract ADD COLUMN publish_cache_probe TEXT'))
            finally:
                await external.dispose()
            source.name = 'Pending draft must survive'
            result, snapshot = await _build_publish_preview(session, form.tenant_id, source)
            assert result['blocking_count'] == 0
            assert snapshot['form']['name'] == 'Pending draft must survive'
            assert (await session.get(Form, form.id)).name == 'Pending draft must survive'
            await session.rollback()
