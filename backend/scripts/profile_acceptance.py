"""Read-only service profiling of dedicated acceptance users in the live DB.

Run inside the backend container. SQL parameters and business values are never
recorded. This excludes HTTP/auth latency and does not instrument the server.
"""
import asyncio
from collections import Counter
import cProfile
import json
from pathlib import Path
import pstats
import time

from sqlalchemy import event
from app.database import _engine
from app.core.db import db_session
from app.api.workflow import _workflow_business_dataset
from app.services.records import list_records, get_record


async def main():
    # Avoid printing SQL parameters, and make profiling overhead consistent.
    _engine.echo = False
    results = {}
    for label, uid, operation in [
        ('reviewer_inbox', 36, lambda db, user: _workflow_business_dataset(db, user)),
        ('applicant_list', 33, lambda db, user: list_records(98, db, user, page_size=20)),
        ('applicant_detail', 33, lambda db, user: get_record(98, 1, db, user)),
    ]:
        queries = Counter()
        def before(conn, cursor, statement, parameters, context, executemany):
            queries[' '.join(statement.split())] += 1
        event.listen(_engine.sync_engine, 'before_cursor_execute', before)
        profile = cProfile.Profile()
        started = time.perf_counter()
        profile.enable()
        for _ in range(3):
            async with db_session() as db:
                await operation(db, {'uid': uid, 'tenant_id': 1, 'is_admin': False})
        profile.disable()
        event.remove(_engine.sync_engine, 'before_cursor_execute', before)
        stats = pstats.Stats(profile)
        app_functions = sorted(({'file': key[0], 'line': key[1], 'function': key[2],
                                'calls': value[1], 'self_s': round(value[2], 4), 'cumulative_s': round(value[3], 4)}
                                for key, value in stats.stats.items() if '/app/app/' in key[0]),
                               key=lambda row: row['cumulative_s'], reverse=True)[:20]
        result = {'iterations': 3, 'sql_echo_in_profile': False, 'elapsed_s': round(time.perf_counter() - started, 3),
                  'sql_count': sum(queries.values()), 'sql_per_call': round(sum(queries.values())/3, 2),
                  'top_queries': [{'sql': key, 'count': value} for key, value in queries.most_common(8)],
                  'top_app_functions': app_functions}
        results[label] = result
        print(label, 'SQL per call', result['sql_per_call'], 'elapsed', result['elapsed_s'], flush=True)
    Path('/tmp/acceptance-service-profile.json').write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n')
    await _engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
