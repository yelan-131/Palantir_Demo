"""Tenant dictionary and registered, read-only HTTP option sources."""
import ipaddress
import json
import math
import socket
from contextlib import asynccontextmanager
from contextvars import ContextVar
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from app.api.deps import current_tenant_id
from app.models.relational import DataSource, SystemSetting

MAX_OPTIONS = 1000
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


_snapshot=ContextVar('form_option_snapshot',default=None)

@asynccontextmanager
async def read_snapshot():
    token=_snapshot.set({})
    try:yield
    finally:_snapshot.reset(token)


def connection(source):
    try:
        value = json.loads(source.connection_config) if isinstance(source.connection_config, str) else source.connection_config
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


async def dictionaries(db, tenant_id):
    cache=_snapshot.get();key=('dictionaries',tenant_id)
    if cache is not None and key in cache:return cache[key]
    setting = await db.scalar(select(SystemSetting).where(SystemSetting.key == f'reference_data_admin:{tenant_id}'))
    items=((setting.value or {}).get('dictionaries') or []) if setting else []
    if not isinstance(items,list) or any(not isinstance(item,dict) for item in items):raise HTTPException(422,'字典配置格式无效')
    if cache is not None:cache[key]=items
    return items


async def catalog(db, tenant_id):
    sources = (await db.scalars(select(DataSource).where(DataSource.tenant_id == tenant_id,
        DataSource.source_type.in_(['api', 'rest_api']), DataSource.status.in_(['active','connected'])).order_by(DataSource.id))).all()
    return {'dictionaries': [{'code': item.get('dictCode'), 'name': item.get('dictName') or item.get('dictCode')}
            for item in await dictionaries(db, tenant_id) if item.get('dictCode')],
            'externalApis': [{'id': source.id, 'name': source.name} for source in sources]}


def at_path(value, path):
    if not path:
        return value
    for key in path.split('.'):
        if not isinstance(value, dict) or key not in value:
            raise HTTPException(422, '接口返回数据不包含配置的映射路径')
        value = value[key]
    return value


async def validate_url(url, *, allow_private=False):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ValueError()
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        # Registered LAN APIs are opt-in; loopback, metadata and multicast remain blocked.
        import asyncio
        addresses = await asyncio.wait_for(asyncio.to_thread(socket.getaddrinfo, parsed.hostname, port, type=socket.SOCK_STREAM), timeout=5)
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved or not ip.is_global and not allow_private:
                raise ValueError()
        if not addresses:
            raise ValueError()
        return parsed,str(ipaddress.ip_address(addresses[0][4][0]))
    except (ValueError, OSError, TimeoutError):
        raise HTTPException(422, '接口地址不可访问；内网接口需在已登记数据源中启用 allow_private_network，禁止本机与元数据地址')


async def fetch_json(config):
    url = str(config.get('url') or config.get('endpoint') or config.get('base_url') or '').strip()
    if str(config.get('method') or 'GET').upper() != 'GET':
        raise HTTPException(422, '选项数据源仅支持只读 GET 接口')
    parsed,address=await validate_url(url, allow_private=config.get('allow_private_network') is True)
    headers = config.get('headers') or {}
    params = config.get('params') or {}
    if not isinstance(headers, dict) or not isinstance(params, dict):
        raise HTTPException(422, '数据源 headers / params 必须为对象')
    if any(str(key).lower() in {'host', 'connection', 'content-length', 'transfer-encoding'} for key in headers):
        raise HTTPException(422, '接口请求包含不允许的请求头')
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5), follow_redirects=False, trust_env=False) as client:
            pinned_url=httpx.URL(url).copy_with(host=address)
            safe_headers={**headers,'Host':parsed.netloc}
            async with client.stream('GET',pinned_url,headers=safe_headers,params=params,extensions={'sni_hostname':parsed.hostname}) as response:
                response.raise_for_status()
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_RESPONSE_BYTES:
                        raise HTTPException(422, '接口响应超过 2 MB 上限')
                return json.loads(raw)
    except (httpx.HTTPError, ValueError, TypeError):
        # Never expose URL query credentials, auth headers or response bodies in errors.
        raise HTTPException(422, '外部接口读取失败，请检查数据源连接、认证与 JSON 返回格式')


async def options(db, user, ref, *, selected=None):
    kind = ref.get('source_kind')
    if kind == 'dictionary':
        matches = [item for item in await dictionaries(db, current_tenant_id(user)) if item.get('dictCode') == ref.get('source_code')]
        if len(matches) != 1:
            raise HTTPException(422, '字典不存在或编码重复，请在数据字典中检查')
        items=matches[0].get('options') or []
        if not isinstance(items,list) or any(not isinstance(item,dict) for item in items):raise HTTPException(422,'字典选项格式无效')
        rows = [{'value': item.get('value'), 'label': item.get('label', item.get('value'))}
                for item in items if item.get('enabled', True)]
        value_field, label_field = 'value', 'label'
    elif kind == 'externalApi':
        try:
            source_id = int(ref.get('source_id'))
        except (TypeError, ValueError):
            raise HTTPException(422, '请选择已登记的外部 API 数据源')
        cache=_snapshot.get();key=('source',current_tenant_id(user),source_id)
        source=cache.get(key) if cache is not None else None
        if source is None:
            source=await db.get(DataSource,source_id)
            if cache is not None:cache[key]=source
        if not source or source.tenant_id != current_tenant_id(user) or source.source_type not in {'api', 'rest_api'} or source.status not in {'active','connected'}:
            raise HTTPException(422, '外部 API 数据源不存在、已停用或不属于当前租户')
        payload_key=('response',current_tenant_id(user),source_id)
        if cache is not None and payload_key in cache:payload=cache[payload_key]
        else:
            payload=await fetch_json(connection(source))
            if cache is not None:cache[payload_key]=payload
        rows = at_path(payload, ref.get('items_path', 'data'))
        value_field, label_field = ref.get('value_field') or 'id', ref.get('label_field') or 'name'
    else:
        raise HTTPException(422, '选项来源类型无效')
    if not isinstance(rows, list) or len(rows) > MAX_OPTIONS:
        raise HTTPException(422, f'选项数据必须为数组，且最多 {MAX_OPTIONS} 项')
    result, seen = [], set()
    for row in rows:
        if not isinstance(row, dict):
            raise HTTPException(422, '选项数组的每项必须为对象')
        value, label = at_path(row, value_field), at_path(row, label_field)
        if isinstance(value, bool) or not isinstance(value, (str, int, float)) or value == '' or isinstance(label, (dict, list)) or label is None or isinstance(value,float) and not math.isfinite(value) or isinstance(label,float) and not math.isfinite(label):
            raise HTTPException(422, '选项编码或显示名称格式无效')
        if isinstance(value,float) and value.is_integer():value=int(value)
        if str(value) in seen:
            raise HTTPException(422, '选项编码重复')
        seen.add(str(value))
        if selected is None or str(value) == str(selected):
            result.append({'id': value, 'label': str(label), 'data': {**row, 'id': value, 'value': value, 'label': str(label), 'item_value': value, 'item_label': str(label)}})
    return result
