"""Real official SDK/Node kernel + MCP transport, against a local scripted LLM.

No external model or credentials are used. Business execution still traverses
our real envelope; only the business handler is replaced with a recorder.
"""
import asyncio
import json
import socket
import uuid
from unittest.mock import AsyncMock

import pytest
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse


@pytest.mark.asyncio
@pytest.mark.parametrize('confirmation', [False, True, 'write'])
async def test_official_harness_calls_platform_tools_and_waits_for_confirmation(monkeypatch, tmp_path, confirmation):
    from app.api.ai_harness import router
    from app.services.ai import harness_runtime as mod
    from app.services.ai import agent_registry
    from app.services.ai.tool_envelope import tool_execution_envelope
    from app.services.ai.settings import settings_snapshot
    from app.services.ai.policies import decide_tool_permission

    monkeypatch.setenv('AI_HARNESS_HOME', str(tmp_path))
    user = {'tenant_id': 1, 'sub': 'harness-integration', 'is_admin': True, 'roles': ['admin']}
    settings = settings_snapshot()
    settings.update({'aiEnabled': True, 'qaEnabled': True, 'assistEnabled': True, 'agentMode': 'confirm', 'apiKey': 'local-test-key', 'chatModel': 'test-model', 'reasoningModel': 'test-model', 'timeoutSeconds': 5, 'retryCount': 0, 'maxTokens': 512})
    settings.pop('domains', None)
    settings['compactionPolicy'] = {'enabled': confirmation == 'write'}
    settings['harnessPolicy'] = {
        'reasoning_effort': 'low', 'contextWindow': 16000,
        'initialize_timeout_seconds': 12, 'request_timeout_seconds': 20,
        'streamIdleTimeoutMs': 4000,
        'compaction': {'enabled': confirmation == 'write', 'thresholdRatio': .72, 'retainRatio': .12},
    }
    settings['safetyPolicy']['permissionRules'] = [{'action': 'ask', 'tool': 'forms.query_records'}] if confirmation is True else []
    calls = []
    handler = AsyncMock(return_value={'records': [{'id': 7}], 'record_count': 1, 'form': {'name': '测试'}})
    monkeypatch.setattr(tool_execution_envelope, '_dispatch', handler)
    from app.services.ai import tool_handlers
    monkeypatch.setattr(tool_handlers, 'dispatch_tool_handler', handler)
    monkeypatch.setattr(mod, 'load_persisted_ai_settings', AsyncMock())
    monkeypatch.setattr(mod, 'settings_snapshot', lambda: settings)
    monkeypatch.setattr(agent_registry, 'load_agent_registry', AsyncMock(return_value={}))
    bridge = mod.PlatformBridge(user=user, settings=settings, context={})
    token = uuid.uuid4().hex
    mod.BRIDGES[token] = bridge
    app = FastAPI()
    app.include_router(router, prefix='/api/v1/ai')
    @app.post('/v1/chat/completions')
    async def model(request: Request):
        body = await request.json()
        calls.append(body)
        pattern = 'forms_create_form_definition_' if confirmation == 'write' else 'forms_query_records_'
        query_tool = next(t['function']['name'] for t in body.get('tools', []) if pattern in t['function']['name'])
        if not any(m['role'] == 'tool' for m in body['messages']) and '平台恢复' not in str(body['messages']):
            delta = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'test-call', 'type': 'function', 'function': {'name': query_tool, 'arguments': json.dumps({'form': {'name': '测试表单', 'code': 'test'}, 'fields': [{'field_name': 'name', 'label': '名称', 'field_type': 'string'}]} if confirmation == 'write' else {'form_code': 'test'})}}]}
            reason = 'tool_calls'
        else:
            delta = {'role': 'assistant', 'content': '等待确认' if confirmation else '已读取 1 条记录'}
            reason = 'stop'
        async def stream():
            for item in ({'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]}, {'choices': [{'index': 0, 'delta': {}, 'finish_reason': reason}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 10, 'total_tokens': 20}}):
                yield 'data: ' + json.dumps({'id': 'test', 'object': 'chat.completion.chunk', 'created': 0, 'model': 'test-model', **item}, ensure_ascii=False) + '\n\n'
            yield 'data: [DONE]\n\n'
        return StreamingResponse(stream(), media_type='text/event-stream')
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off'))
    task = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        for _ in range(100):
            if server.started:
                break
            await asyncio.sleep(.02)
        settings['baseUrl'] = f'http://127.0.0.1:{port}/v1'
        session_id = uuid.uuid4().hex
        result = await mod.run_sdk(settings, user, '查询测试表单', session_id, token=token, bridge_url=f'http://127.0.0.1:{port}/api/v1/ai/harness/mcp')
        assert result.finish_reason == 'completed'
        assert result.final_response
        assert len(calls) == 2
        assert calls[0]['model'] == 'test-model'
        assert calls[0]['max_tokens'] == 512
        assert calls[0]['reasoning_effort'] == 'low'
        assert all(t['function']['name'].removeprefix('mcp__platform__') in {mod.tool_alias(tool.name) for tool in mod.tool_registry().values()} for t in calls[0]['tools'])
        settings['maxTokens'] = 384
        resumed = await mod.run_sdk(settings, user, '平台恢复的历史：助手已读取 1 条记录。继续上次的对话', session_id, token=token, bridge_url=f'http://127.0.0.1:{port}/api/v1/ai/harness/mcp')
        assert resumed.finish_reason == 'completed'
        assert len(calls) == 3
        assert calls[-1]['max_tokens'] == 384
        assert '平台恢复的历史' in str(calls[-1]['messages'])
        assert resumed.session_id != result.session_id
        if confirmation:
            handler.assert_not_awaited()
            assert len(bridge.pending) == 1
            assert bridge.pending[0].payload['_harness_tool'] == ('forms.create_form_definition' if confirmation == 'write' else 'forms.query_records')
            if confirmation is True:
                assert decide_tool_permission(user, settings, 'forms.query_records').requires_confirmation
            if confirmation == 'write':
                from app.services.ai.agent_runs import create_agent_run, confirm_agent_run, AGENT_RUNS
                from app.services.ai.schemas import AgentRequest, AgentResponse
                from app.services.ai.agent_items import extract_confirmation_payload
                from app.services.ai.tool_executor import AgentToolExecutor
                response = AgentResponse(answer=result.final_response, actions=bridge.pending, requires_confirmation=True, risk_level='high')
                run = create_agent_run(AgentRequest(message='创建表单'), response, user)
                token_value = extract_confirmation_payload(run['items'])['confirmation_token']
                confirmed = confirm_agent_run(run['run_id'], token_value, user)
                executor = AgentToolExecutor()
                completed = await executor.execute_confirmed_run(confirmed, current_user=user, settings=settings, persist_ai_draft=AsyncMock(), update_ai_draft_status=AsyncMock(), audit_ai_event=None)
                assert completed['status'] == 'completed'
                handler.assert_awaited_once()
                with pytest.raises(ValueError):
                    confirm_agent_run(run['run_id'], token_value, user)
                assert handler.await_count == 1
                AGENT_RUNS.pop(run['run_id'], None)
        else:
            handler.assert_awaited_once()
            assert not bridge.pending
    finally:
        mod.BRIDGES.pop(token, None)
        server.should_exit = True
        await task
