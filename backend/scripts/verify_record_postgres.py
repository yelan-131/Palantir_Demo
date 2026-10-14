"""Verify record consumers on a disposable PostgreSQL database and live reads.

Run inside the backend container. Connection settings are read in memory;
no passwords or signed tokens are printed. The temporary database is removed
in finally, and live verification never creates business records.
"""
from __future__ import annotations
import asyncio
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def isolated_tests():
    import psycopg2
    from psycopg2 import sql
    from sqlalchemy.engine import make_url
    from app.config import settings
    name = 'record_service_verify_' + uuid4().hex[:12]
    conn = psycopg2.connect(host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER, password=settings.POSTGRES_PASSWORD, dbname='postgres')
    conn.autocommit = True
    try:
        with conn.cursor() as cursor:
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        env = dict(os.environ, POSTGRES_DB=name, DATABASE_BACKEND='postgresql',
            RECORD_TEST_DATABASE_URL=make_url(settings.DATABASE_URL).set(database=name).render_as_string(hide_password=False))
        print('Running dynamic/physical integration cases on PostgreSQL (disposable database)', flush=True)
        result = subprocess.run([sys.executable, '-m', 'pytest', 'tests/test_record_service.py', '-q', '--tb=short'],
            cwd=Path(__file__).resolve().parents[1], env=env)
        if result.returncode:
            raise RuntimeError('PostgreSQL record integration tests failed')
    finally:
        with conn.cursor() as cursor:
            cursor.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()', (name,))
            cursor.execute(sql.SQL('DROP DATABASE IF EXISTS {}').format(sql.Identifier(name)))
        conn.close()
        print('Disposable verification database removed', flush=True)


async def live_reads(base_url):
    import httpx
    from sqlalchemy import select, text
    from app.core.security import create_access_token
    from app.database import AsyncSessionLocal, DB_TYPE, close_connections
    from app.models.relational import User, Form
    from app.services.ai.form_record_tools import query_form_records
    from app.api.workflow import _workflow_business_dataset
    assert DB_TYPE == 'postgresql'
    try:
        async with AsyncSessionLocal() as db:
            actor = await db.scalar(select(User).where(User.is_admin.is_(True), User.is_active.is_(True), User.tenant_id.is_not(None)).order_by(User.id))
            if actor is None:
                raise RuntimeError('No active administrator available for live verification')
            principal = {'uid': actor.id, 'tenant_id': actor.tenant_id, 'is_admin': True}
            token = create_access_token(actor.username, extra=principal)
            print('Live database: ' + (await db.scalar(text('SELECT version()'))).split(' on ')[0], flush=True)
            forms = (await db.scalars(select(Form).where(Form.tenant_id == actor.tenant_id).order_by(Form.id))).all()
            verified = set()
            async with httpx.AsyncClient(base_url=base_url, headers={'Authorization': 'Bearer ' + token}, timeout=60) as client:
                for form in forms:
                    storage = 'physical' if form.table_name and form.storage_mode in {'physical_table', 'business_table'} else 'dynamic'
                    if storage in verified:
                        continue
                    ai = await query_form_records(db, user=principal, payload={'form_id': form.id, 'limit': 5})
                    response = await client.get(f'/api/v1/forms/{form.id}/records', params={'page_size': 5})
                    assert response.status_code == 200, f'Business records HTTP {response.status_code}'
                    ui = response.json()
                    response = await client.get(f'/api/v1/dashboard/programs/{form.code}', params={'limit': 5})
                    assert response.status_code == 200, f'Dashboard HTTP {response.status_code}'
                    board = response.json()
                    assert [row['id'] for row in ui['data']] == [row['id'] for row in ai['records']]
                    assert [row['id'] for row in ui['data']] == [row['recordId'] for row in board['rows']]
                    assert ui['total'] == board['total']
                    print(f'Live {storage}: form_id={form.id}; business/AI/dashboard rows and totals agree; total={ui["total"]}', flush=True)
                    verified.add(storage)
                assert verified == {'physical', 'dynamic'}, 'Both existing storage modes are required for live verification'
                inbox = await _workflow_business_dataset(db, principal)
                print(f'Live approval inbox: {len(inbox["items"])} visible items loaded through shared record service', flush=True)
    finally:
        await close_connections()


if __name__ == '__main__':
    isolated_tests()
    asyncio.run(live_reads(os.getenv('VERIFY_BASE_URL', 'http://127.0.0.1')))
    print('PostgreSQL and live record verification complete', flush=True)
