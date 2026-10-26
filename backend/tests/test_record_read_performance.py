"""Query budgets and fresh authorization on real authenticated read requests."""
import pytest
from sqlalchemy import event

from tests.test_multi_user_business_acceptance import matrix, create_request


async def counted(matrix, operation):
    queries = []
    engine = matrix.factory.kw['bind'].sync_engine
    def capture(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        response = await operation()
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    return len(queries), response.json()


@pytest.mark.asyncio
async def test_inbox_sql_budget_is_independent_of_workflow_count_and_revocation_is_fresh(matrix):
    async def submit():
        row = await create_request(matrix)
        response = await matrix.clients['a'].post(f'/forms/1/records/{row["id"]}/submit', json={'expected_status': 'draft'})
        assert response.status_code == 200, response.text
    await submit()
    small, _ = await counted(matrix, lambda: matrix.clients['d'].get('/workflow/business-items'))
    for _ in range(8): await submit()
    large, payload = await counted(matrix, lambda: matrix.clients['d'].get('/workflow/business-items'))
    assert len([item for item in payload['data']['items'] if item['can_approve']]) == 9
    assert large <= small + 3, (small, large)
    assert large <= 40, large
    # Same JWT, next HTTP request: no TTL/cache may retain the old grant.
    permissions = (await matrix.clients['admin'].get('/forms/1/permissions')).json()['data']
    grant = next(row for row in permissions if row['role_id'] == 2 and row['action'] == 'view')
    response = await matrix.clients['admin'].put(f'/forms/1/permissions/{grant["id"]}', json={'effect': 'deny'})
    assert response.status_code == 200, response.text
    assert (await matrix.clients['d'].get('/forms/1/records')).status_code == 403
    items = (await matrix.clients['d'].get('/workflow/business-items')).json()['data']['items']
    assert all((item.get('form') or {}).get('id') != 1 for item in items)


@pytest.mark.asyncio
async def test_paginated_list_batches_histories_without_query_growth_and_keeps_full_history(matrix):
    await create_request(matrix)
    small, _ = await counted(matrix, lambda: matrix.clients['a'].get('/forms/1/records', params={'page_size': 5}))
    for _ in range(24): await create_request(matrix)
    large, payload = await counted(matrix, lambda: matrix.clients['a'].get('/forms/1/records', params={'page_size': 5}))
    assert payload['total'] == 25 and len(payload['data']) == 5
    assert all(row['_approval']['history'][0]['action'] == 'draft' for row in payload['data'])
    assert large <= small + 3, (small, large)
    assert large <= 25, large


@pytest.mark.asyncio
async def test_prefetch_does_not_cache_conditional_denial_results_between_rows(matrix):
    from app.models.relational import Form, RolePermission
    from app.core.permissions import prefetch_form_permissions, evaluate_form_permission
    async with matrix.factory() as db:
        db.add(RolePermission(tenant_id=1, role_id=2, resource_type='form', resource_key='1',
            action='view', effect='deny', condition_json={'rules': [{'field': 'title', 'op': 'equals', 'value': 'Blocked'}]}))
        await db.commit()
        form = await db.get(Form, 1)
        user = {'uid': 4, 'tenant_id': 1, 'is_admin': False}
        cache = {}
        await prefetch_form_permissions(user, [form], db, cache)
        for title, expected in [('Allowed', True), ('Blocked', False), ('Allowed', True)]:
            decision = await evaluate_form_permission(user, 1, 'view', db, record_data={'title': title}, cache=cache)
            assert decision['allowed'] is expected


def test_sql_trace_is_opt_in_and_independent_of_web_debug(monkeypatch):
    from app.config import Settings
    monkeypatch.delenv('SQL_ECHO', raising=False)
    assert Settings(DEBUG=True, _env_file=None).SQL_ECHO is False
    assert Settings(DEBUG=False, SQL_ECHO=True, _env_file=None).SQL_ECHO is True
