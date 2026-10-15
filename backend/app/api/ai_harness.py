"""Request-scoped MCP transport for the official Harness subprocess.

This endpoint does not accept caller-supplied identities. A random, short-lived
capability is created by the backend for exactly one authenticated Agent run.
"""
import json
import time
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from app.services.ai.harness_runtime import BRIDGES

router = APIRouter()

@router.post('/harness/mcp')
async def harness_mcp(request: Request):
    auth = request.headers.get('authorization', '')
    token = auth.removeprefix('Bearer ')
    bridge = BRIDGES.get(token) if auth.startswith('Bearer ') else None
    if bridge is None or bridge.expires_at < time.monotonic():
        raise HTTPException(status_code=401, detail='Harness bridge authorization expired or missing')
    body = await request.json()
    method = body.get('method')
    if 'id' not in body:
        return Response(status_code=202)
    if method == 'initialize':
        result = {'protocolVersion': (body.get('params') or {}).get('protocolVersion', '2025-03-26'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'manufoundry-business-tools', 'version': '1.0'}}
    elif method == 'tools/list':
        result = {'tools': bridge.available_tools()}
    elif method == 'tools/call':
        params = body.get('params') or {}
        output = await bridge.call_tool(str(params.get('name') or ''), params.get('arguments') or {})
        result = {'content': [{'type': 'text', 'text': json.dumps(output, ensure_ascii=False, default=str)}], 'isError': output.get('status') in {'blocked', 'failed', 'validation_failed'}}
    elif method == 'ping':
        result = {}
    else:
        return JSONResponse({'jsonrpc': '2.0', 'id': body['id'], 'error': {'code': -32601, 'message': 'Method not supported'}})
    return JSONResponse({'jsonrpc': '2.0', 'id': body['id'], 'result': result})
