"""Configure missing independent business approvals in local DB; default dry-run."""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def eligible(form):
    config = form.config or {}
    kind = str(config.get('assemblyKind') or config.get('kind') or config.get('type') or '').lower()
    code = str(form.code or '').lower()
    return (form.status == 'published' and kind not in
            {'analysis', 'analytics', 'dashboard', 'report', 'bi_report', 'metric_dashboard', 'list_analysis', 'bi'}
            and not any(word in code for word in ('dashboard', 'overview', 'report', 'analysis'))
            and code not in {'material-application', 'alert-center'})


async def configure(db, tenant_id, apply=False, approver_id=None):
    from sqlalchemy import select
    from app.models.relational import Form, WorkflowBinding, User, UserRole, Role
    from app.services.form_approval_config import save_approval_settings
    query = select(User).where(User.tenant_id == tenant_id, User.is_active.is_(True))
    if approver_id is not None:
        query = query.where(User.id == approver_id)
    else:
        query = query.join(UserRole, UserRole.user_id == User.id).join(Role, Role.id == UserRole.role_id).where(
            UserRole.tenant_id == tenant_id, Role.tenant_id == tenant_id, Role.name == 'admin')
    candidates = (await db.execute(query.order_by(User.id))).scalars().unique().all()
    approver = next((user for user in candidates if user.username == 'admin'), candidates[0] if candidates else None)
    if not approver:
        raise ValueError('An active same-tenant approver is required')
    forms = (await db.execute(select(Form).where(Form.tenant_id == tenant_id).order_by(Form.id))).scalars().all()
    bindings = (await db.execute(select(WorkflowBinding).where(WorkflowBinding.tenant_id == tenant_id,
                                WorkflowBinding.enabled.is_(True)))).scalars().all()
    bound = {item.form_id for item in bindings}
    reports = []
    for form in forms:
        if not eligible(form):
            continue
        row = {'form_id': form.id, 'name': form.name, 'code': form.code,
               'action': 'preserve_existing' if form.id in bound else 'configure',
               'domain_code': f'form-approval:{form.id}'}
        if apply and form.id not in bound:
            row['settings'] = await save_approval_settings(db, tenant_id, form.id, approver.id,
                {'enabled': True, 'stages': [{'name': f'{form.name}审批', 'approver_ids': [approver.id],
                 'approval_mode': 'single'}], 'replace_existing': False})
        reports.append(row)
    return {'mode': 'apply' if apply else 'dry-run', 'tenant_id': tenant_id,
            'approver': {'id': approver.id, 'username': approver.username}, 'forms': reports,
            'configure_count': sum(row['action'] == 'configure' for row in reports),
            'records_and_existing_instances_unchanged': True}


async def run(tenant_id, apply, approver_id=None):
    from sqlalchemy import text
    from app.config import settings
    from app.database import AsyncSessionLocal, _engine
    if urlparse(settings.APP_PUBLIC_URL).hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise ValueError('Only an explicitly local APP_PUBLIC_URL is allowed')
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                if db.bind.dialect.name == 'postgresql':
                    if apply:
                        await db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': 7422000 + tenant_id})
                    else:
                        await db.execute(text('SET TRANSACTION READ ONLY'))
                elif not apply:
                    await db.execute(text('PRAGMA query_only=ON'))
                return await configure(db, tenant_id, apply, approver_id)
    finally:
        await _engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tenant-id', type=int, default=1)
    parser.add_argument('--approver-id', type=int)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args.tenant_id, args.apply, args.approver_id)), ensure_ascii=False, indent=2))
