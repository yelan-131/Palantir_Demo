"""Isolated SQLite regressions for default configuration and submission."""
import asyncio
import json
import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models.relational import Base, Form, User, Role, UserRole, WorkflowBinding, WorkflowDef, WorkflowDefVersion, WorkflowInstance, DynamicRecord
from app.api.forms import _start_form_workflows, _protect_pending_form_record
from scripts.configure_business_form_approvals import configure


async def isolated(callback):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add_all([User(id=1, tenant_id=1, username='admin', hashed_password='test', is_active=True),
                        Role(id=1, tenant_id=1, name='admin', label='Admin'),
                        UserRole(tenant_id=1, user_id=1, role_id=1),
                        Form(id=1, tenant_id=1, code='production_plan', name='Plan', status='published', storage_mode='physical', table_name='test_plan'),
                        Form(id=2, tenant_id=1, code='quality_check', name='Quality', status='published'),
                        Form(id=3, tenant_id=1, code='metrics-dashboard', name='Dashboard', status='published'),
                        Form(id=4, tenant_id=1, code='material-application', name='Material', status='published')])
            await db.commit()
            await callback(db)
    finally:
        await engine.dispose()


def test_default_dryrun_readonly_and_apply_independent_idempotent():
    async def case(db):
        await db.execute(text('PRAGMA query_only=ON'))
        report = await configure(db, 1)
        assert report['configure_count'] == 2
        assert not db.dirty and not db.new
        assert not (await db.scalars(select(WorkflowDef))).all()
        await db.rollback()
        await db.execute(text('PRAGMA query_only=OFF'))
        await configure(db, 1, True)
        await db.commit()
        repeat = await configure(db, 1, True)
        assert repeat['configure_count'] == 0
        assert len((await db.scalars(select(WorkflowDef))).all()) == 2
        assert len((await db.scalars(select(WorkflowDefVersion))).all()) == 2
        bindings = (await db.scalars(select(WorkflowBinding))).all()
        assert len({row.workflow_id for row in bindings}) == 2
        assert not (await db.scalars(select(WorkflowInstance))).all()
    asyncio.run(isolated(case))


def test_physical_record_identity_snapshot_pin_and_pending_protection():
    async def case(db):
        await configure(db, 1, True)
        await db.commit()
        form = await db.get(Form, 1)
        binding = await db.scalar(select(WorkflowBinding).where(WorkflowBinding.form_id == 1))
        definition = await db.get(WorkflowDef, binding.workflow_id)
        # Live changes are ignored until publishing a fresh snapshot.
        definition.config = json.dumps({'steps': []})
        instances = await _start_form_workflows(db, tenant_id=1, form=form,
                    record_payload={'id': 22, 'data': {'title': 'physical source'}}, user={'uid': 1, 'tenant_id': 1})
        assert len(instances) == 1 and instances[0]['approver_ids'] == [1]
        instance = await db.get(WorkflowInstance, instances[0]['instance_id'])
        assert instance.workflow_version == 1
        assert json.loads(instance.workflow_state)['variables']['record_id'] == 22
        # Protection follows the pinned snapshot even if the live config changed.
        with pytest.raises(HTTPException) as error:
            await _protect_pending_form_record(db, 1, 1, 22)
        assert error.value.status_code == 409
        await _protect_pending_form_record(db, 1, 2, 22)
        instance.status = 'approved'
        await db.flush()
        await _protect_pending_form_record(db, 1, 1, 22)
        await db.rollback()
    asyncio.run(isolated(case))


def test_existing_custom_binding_is_preserved():
    async def case(db):
        definition = WorkflowDef(tenant_id=1, name='Existing custom', config='{"steps":[]}', status='published')
        db.add(definition)
        await db.flush()
        db.add(WorkflowBinding(tenant_id=1, form_id=1, workflow_id=definition.id,
                               trigger_action='custom-event', enabled=True))
        await db.commit()
        report = await configure(db, 1, True)
        assert report['configure_count'] == 1
        assert next(item for item in report['forms'] if item['form_id'] == 1)['action'] == 'preserve_existing'
        await db.commit()
        assert definition.config == '{"steps":[]}'
        bindings = (await db.scalars(select(WorkflowBinding).where(WorkflowBinding.form_id == 1))).all()
        assert len(bindings) == 1 and bindings[0].trigger_action == 'custom-event' and bindings[0].enabled
    asyncio.run(isolated(case))


def test_inactive_approver_rejects_submission_and_rolls_back_record():
    async def case(db):
        await configure(db, 1, True)
        await db.commit()
        user = await db.get(User, 1)
        user.is_active = False
        await db.commit()
        form = await db.get(Form, 2)
        form_id = form.id
        record = DynamicRecord(tenant_id=1, form_id=form_id, data={'title': 'rejected submission'})
        db.add(record)
        await db.flush()
        with pytest.raises(HTTPException) as error:
            await _start_form_workflows(db, tenant_id=1, form=form,
                record_payload={'id': record.id, 'data': record.data}, user={'uid': 1, 'tenant_id': 1})
        assert error.value.status_code == 409
        await db.rollback()
        assert not (await db.scalars(select(DynamicRecord).where(DynamicRecord.form_id == form_id))).all()
        assert not (await db.scalars(select(WorkflowInstance))).all()
    asyncio.run(isolated(case))
