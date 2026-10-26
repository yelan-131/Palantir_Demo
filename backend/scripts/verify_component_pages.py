"""Run mixed-page contracts on disposable PostgreSQL, including both storage modes.

Run inside the backend container: python scripts/verify_component_pages.py
Connection details remain in process memory; the temporary database is removed.
"""
from pathlib import Path
import os
import subprocess
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    import psycopg2
    from psycopg2 import sql
    from sqlalchemy.engine import make_url
    from app.config import settings

    name = 'record_service_verify_pages_' + uuid4().hex[:8]
    connection = psycopg2.connect(host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER, password=settings.POSTGRES_PASSWORD, dbname='postgres')
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        environment = dict(os.environ, POSTGRES_DB=name, DATABASE_BACKEND='postgresql',
            RECORD_TEST_DATABASE_URL=make_url(settings.DATABASE_URL).set(database=name).render_as_string(hide_password=False))
        return subprocess.run([sys.executable, '-m', 'pytest', 'tests/test_component_pages.py',
            'tests/test_record_service.py', 'tests/test_business_form_approvals.py', 'tests/test_analytics_runtime.py',
            'tests/test_form_shared_services.py', 'tests/test_static_options.py', 'tests/test_multiselect_limits.py',
            'tests/test_publish_cache_recovery.py',
            '-q', '--tb=short', '--maxfail=1'], cwd=Path(__file__).resolve().parents[1], env=environment).returncode
    finally:
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()', (name,))
            cursor.execute(sql.SQL('DROP DATABASE IF EXISTS {}').format(sql.Identifier(name)))
        connection.close()
        print('Disposable component-page verification database removed', flush=True)


if __name__ == '__main__':
    sys.exit(main())
