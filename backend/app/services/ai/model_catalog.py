"""Backend-owned provider catalog and explicit per-purpose model routing."""
from copy import deepcopy
import re
from urllib.parse import urlparse


def catalog_from_legacy(data):
    models = []
    for field in ('chatModel', 'reasoningModel', 'visionModel'):
        model = data.get(field)
        if model and model not in {'disabled', 'local-disabled'} and model not in [m['id'] for m in models]:
            models.append({'id': model, 'name': model, 'inputTypes': ['text', 'image'] if field == 'visionModel' else ['text']})
    chat = data.get('chatModel') or 'local-disabled'
    if not models:
        models = [{'id': chat, 'name': chat, 'inputTypes': ['text']}]
    elif chat not in [m['id'] for m in models]:
        models.insert(0, {'id': chat, 'name': chat, 'inputTypes': ['text']})
    native = data.get('harnessPolicy') or {}
    for model in models:
        model['maxTokens'] = int(data.get('maxTokens') or 2048)
        if native.get('contextWindow'):
            model['contextWindow'] = native['contextWindow']
        if model['id'] == (data.get('reasoningModel') or chat) and native.get('reasoning_effort'):
            model['reasoningEffort'] = native['reasoning_effort']
    service = {key: deepcopy(data.get(key)) for key in ('baseUrl', 'apiKey', 'organization', 'project', 'timeoutSeconds', 'retryCount')}
    service.update(id='default', name='现有模型服务', provider=data.get('provider', 'openai-compatible'), models=models)
    return [service], {
        'chat': {'serviceId': 'default', 'modelId': chat},
        'reasoning': {'serviceId': 'default', 'modelId': data['reasoningModel']} if data.get('reasoningModel') in [m['id'] for m in models] else None,
        'document': {'serviceId': 'default', 'modelId': data['visionModel']} if data.get('visionModel') in [m['id'] for m in models] else None,
    }


def merge_catalog(incoming, existing, merged):
    if 'modelServices' not in incoming and 'modelServices' not in existing:
        return
    services = deepcopy(incoming.get('modelServices', existing.get('modelServices')))
    if not isinstance(services, list) or not services:
        raise ValueError('至少保留一个模型服务')
    old = {s['id']: s for s in existing.get('modelServices', [])}
    ids = set()
    for service in services:
        if not isinstance(service, dict) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', str(service.get('id', ''))):
            raise ValueError('服务 ID 仅支持字母、数字、下划线和连字符')
        sid = service['id']
        if sid in ids:
            raise ValueError('服务 ID 不可重复')
        ids.add(sid)
        if service.get('provider', 'openai-compatible') not in {'openai-compatible', 'openai', 'azure-openai', 'deepseek', 'qwen', 'glm'}:
            raise ValueError('不支持的接口适配器')
        if not isinstance(service.get('name'), str) or not service['name'].strip():
            raise ValueError('服务名称不能为空')
        url = urlparse(str(service.get('baseUrl') or ''))
        if url.scheme not in {'http', 'https'} or not url.hostname or url.username or url.password:
            raise ValueError('请填写不含账号密码的 HTTP(S) 服务地址')
        previous = old.get(sid, {})
        if service.get('apiKey') == '********':
            service['apiKey'] = previous.get('apiKey', '') if service.get('baseUrl') == previous.get('baseUrl') else ''
        models = service.get('models')
        if not isinstance(models, list) or not models:
            raise ValueError('每个服务至少配置一个模型')
        model_ids = set()
        for model in models:
            mid = model.get('id') if isinstance(model, dict) else None
            if not isinstance(mid, str) or not mid.strip() or mid in model_ids:
                raise ValueError('模型 ID 不能为空或重复')
            model_ids.add(mid)
            if not isinstance(model.get('inputTypes', ['text']), list) or not model.get('inputTypes', ['text']) or any(t not in {'text', 'image'} for t in model.get('inputTypes', ['text'])):
                raise ValueError('请选择有效的模型输入能力')
            for key, low, high in (('maxTokens', 32, 32768), ('contextWindow', 1000, 2000000)):
                value = model.get(key)
                if value not in (None, '') and (isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high):
                    raise ValueError(f'模型 {key} 超出支持范围')
            if model.get('contextWindow') and int(model['contextWindow']) <= int(model.get('maxTokens') or merged.get('maxTokens', 2048)):
                raise ValueError('模型上下文窗口必须大于输出上限')
            if model.get('reasoningEffort') not in (None, '', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'):
                raise ValueError('不支持的推理强度')
        for key, low, high in (('timeoutSeconds', 1, 300), ('retryCount', 0, 3), ('streamIdleTimeoutMs', 1, 3600000)):
            value = service.get(key)
            if value not in (None, '') and (isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high):
                raise ValueError(f'服务 {key} 超出支持范围')
    assignments = deepcopy(incoming.get('modelAssignments', existing.get('modelAssignments', {})))
    if not isinstance(assignments, dict) or not assignments.get('chat'):
        raise ValueError('请选择默认对话模型')
    for purpose, ref in assignments.items():
        if purpose not in {'chat', 'reasoning', 'document'}:
            raise ValueError('不支持的模型用途')
        if ref is None and purpose != 'chat':
            continue
        if not isinstance(ref, dict):
            raise ValueError('模型用途必须引用服务和模型')
        service = next((s for s in services if s['id'] == ref.get('serviceId')), None)
        model = next((m for m in service['models'] if m['id'] == ref.get('modelId')), None) if service else None
        if not model:
            raise ValueError('用途引用的服务或模型不存在，请先调整用途')
        if purpose == 'document' and 'image' not in model.get('inputTypes', []):
            raise ValueError('文档识别需要支持图像输入的模型')
    merged.update(modelServices=services, modelAssignments=assignments)


def resolve_model_settings(data, purpose='chat'):
    if 'modelServices' not in data or data.get('_catalogResolved'):
        return data
    assignments = data.get('modelAssignments') or {}
    ref = assignments.get(purpose)
    if not ref and purpose == 'reasoning':
        ref = assignments.get('chat')
    result = deepcopy(data)
    if not ref and purpose == 'document':
        result.update(apiKey='', visionModel='disabled', _catalogResolved=True)
        return result
    service = next((s for s in data['modelServices'] if s['id'] == (ref or {}).get('serviceId')), None)
    model = next((m for m in service['models'] if m['id'] == ref.get('modelId')), None) if service else None
    if not model:
        raise ValueError('用途引用的模型不可用')
    for key in ('baseUrl', 'apiKey', 'organization', 'project'):
        result[key] = service.get(key) or ''
    result['provider'] = service.get('provider') or 'openai-compatible'
    for key in ('timeoutSeconds', 'retryCount'):
        if service.get(key) not in (None, ''):
            result[key] = service[key]
    result.update(chatModel=model['id'], reasoningModel=model['id'], visionModel=model['id'])
    if model.get('maxTokens'):
        result['maxTokens'] = model['maxTokens']
    native = result.setdefault('harnessPolicy', {})
    native['reasoning_effort'] = None
    native['contextWindow'] = int(model.get('contextWindow') or (int((data.get('contextPolicy') or {}).get('maxContextTokens', 12000)) + int(result.get('maxTokens', 2048))))
    for source, target in (('contextWindow', 'contextWindow'), ('reasoningEffort', 'reasoning_effort')):
        if model.get(source) not in (None, ''):
            native[target] = model[source]
    if service.get('streamIdleTimeoutMs'):
        native['streamIdleTimeoutMs'] = service['streamIdleTimeoutMs']
    # An explicit catalog credential never inherits a secret from the environment.
    result['_catalogResolved'] = True
    return result
