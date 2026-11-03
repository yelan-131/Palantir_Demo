import copy
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select, func

from app.models.relational import Form
from app.services.ai.dashboard_tools import execute_dashboard_tool
from tests.test_record_service import environment, seed
from tests.test_analytics_editor import published_board
from tests.test_analytics_sources import source_design


@pytest.mark.asyncio
async def test_source_preview_uses_real_data_and_does_not_create_board(environment):
    db, _, form, user, _ = environment
    user['is_admin'] = True
    await seed(db, 'A')
    before = await db.scalar(select(func.count()).select_from(Form))
    result = await execute_dashboard_tool('dashboards.preview_source', db, user=user,
        payload={'source_form_code': form.code})
    assert result['design']['datasets'][0]['source'] == form.code
    assert result['analyticsData']['metricValues']['metric-total'] == 1
    assert not result['analyticsData']['errors']
    assert await db.scalar(select(func.count()).select_from(Form)) == before


@pytest.mark.asyncio
async def test_source_cannot_cross_tenants_or_accept_invented_fields(environment):
    db, _, form, user, _ = environment
    user['is_admin'] = True
    with pytest.raises(HTTPException) as exc:
        await execute_dashboard_tool('dashboards.preview_source', db, user={**user, 'tenant_id': 2},
            payload={'source_form_code': form.code})
    assert exc.value.status_code == 404
    design = source_design()
    design['datasets'][0]['dimensions'].append('invented')
    with pytest.raises(HTTPException) as exc:
        await execute_dashboard_tool('dashboards.preview_source', db, user=user,
            payload={'source_form_code': form.code, 'design': design})
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_ai_query_matches_published_board_and_draft_does_not_change_runtime(environment):
    db, _, form, user, client = environment
    await seed(db, 'A'); await seed(db, 'B')
    await published_board(db, form, user)
    original = await execute_dashboard_tool('dashboards.get', db, user=user, payload={'program_id': form.code})
    query = {'program_id': form.code, 'filters': {'title': 'A'}}
    runtime = await execute_dashboard_tool('dashboards.query', db, user=user, payload=query)
    assert runtime['analyticsData']['metricValues']['metric-total'] == 2
    design = copy.deepcopy(original['design'])
    design['metrics'][0]['expression'] = 'count(*)'
    payload = {'program_id': form.code, 'design': design, 'expectedRevision': original['revision']}
    await execute_dashboard_tool('dashboards.save_draft', db, user=user, payload=payload)
    with pytest.raises(HTTPException) as exc:
        await execute_dashboard_tool('dashboards.publish', db, user=user, payload=payload)
    assert exc.value.status_code == 409
    assert (await execute_dashboard_tool('dashboards.query', db, user=user, payload=query))['analyticsData'] == runtime['analyticsData']
    latest = await execute_dashboard_tool('dashboards.get', db, user=user, payload={'program_id': form.code})
    payload['expectedRevision'] = latest['revision']
    await execute_dashboard_tool('dashboards.publish', db, user=user, payload=payload)
    assert (await execute_dashboard_tool('dashboards.query', db, user=user, payload=query))['analyticsData']['metricValues']['metric-total'] == 1


@pytest.mark.asyncio
async def test_creation_binds_existing_source_and_stays_unpublished(environment, monkeypatch):
    db, _, form, user, client = environment
    user['is_admin'] = True
    await seed(db, 'A')
    from app.services.ai import low_code_tools
    monkeypatch.setattr(low_code_tools, 'write_audit_log', AsyncMock())
    created = await execute_dashboard_tool('dashboards.create', db, user=user,
        payload={'source_form_code': form.code, 'name': '报修看板', 'code': 'ai_repair_board'})
    board = await db.get(Form, created['form']['id'])
    assert board.status == 'draft'
    assert board.config['analyticsDesignDraft']['datasets'][0]['source'] == form.code
    assert 'analyticsDesign' not in board.config
    with pytest.raises(HTTPException) as exc:
        await execute_dashboard_tool('dashboards.query', db, user=user, payload={'program_id': board.code})
    assert exc.value.status_code == 404
    response = await client.post(f'/forms/{board.id}/publish')
    assert response.status_code == 200, response.text
    result = await execute_dashboard_tool('dashboards.query', db, user=user, payload={'program_id': board.code})
    assert result['analyticsData']['metricValues']['metric-total'] == 1


def test_dashboard_tools_are_registered_and_writes_require_confirmation():
    from app.services.ai.agent_registry import load_seed_registry
    _, tools = load_seed_registry()
    for name in ('dashboards.create', 'dashboards.save_draft', 'dashboards.publish'):
        assert tools[name]['side_effect'] == 'configuration_write'
        assert tools[name]['permission_check'] == 'config'


def test_dashboard_request_does_not_enter_business_form_designer():
    from app.services.ai.configuration_completion import expects_configuration, expects_native_designer
    context = {'pageControlsSupported': True, 'designerContext': {'form_id': 1}}
    assert expects_configuration('创建报修看板', context)
    assert not expects_native_designer('创建报修看板', context)
    assert not expects_native_designer('把数量指标改成汇总', {**context, 'designerContext': {'kind': 'analysis'}})


@pytest.mark.asyncio
async def test_harness_prepares_dashboard_confirmation_without_executing(monkeypatch):
    from app.services.ai import harness_runtime as mod, agent_registry, agent_definition
    from app.services.ai.settings import merge_ai_settings
    skills, tools = agent_registry.load_seed_registry()
    monkeypatch.setattr(agent_definition, '_RUNTIME_TOOL_REGISTRY', None)
    agent_definition.load_tool_registry.cache_clear()
    settings = merge_ai_settings({'aiEnabled': True, 'agentMode': 'confirm'})
    monkeypatch.setattr(mod, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock())
    bridge = mod.PlatformBridge(user={'tenant_id': 1, 'sub': 'admin', 'is_admin': True}, settings=settings, context={})
    from app.services.ai.tool_handlers import TOOL_HANDLERS
    execute = AsyncMock()
    monkeypatch.setitem(TOOL_HANDLERS, 'dashboards.create', execute)
    result = await bridge.call_tool(mod.tool_alias('dashboards.create'), {
        'source_form_code': 'repairs', 'name': '报修看板', 'code': 'repair_board'})
    assert result['status'] == 'waiting_confirmation'
    assert bridge.pending[0].skill == 'dashboards.create'
    execute.assert_not_awaited()
    agent_definition.load_tool_registry.cache_clear()
