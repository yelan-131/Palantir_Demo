"""The single parameter projection consumed by both DSH and settings previews."""
from __future__ import annotations

from .model_catalog import resolve_model_settings
from .settings import settings_to_provider_config


def effective_harness_parameters(data: dict, purpose: str = 'reasoning') -> dict:
    effective = resolve_model_settings(data, purpose)
    config = settings_to_provider_config(effective, purpose=purpose)
    native = effective.get('harnessPolicy') or {}
    safety = effective.get('safetyPolicy') or {}
    ref = (data.get('modelAssignments') or {}).get(purpose)
    inherited = not ref and purpose == 'reasoning'
    if inherited:
        ref = (data.get('modelAssignments') or {}).get('chat')
    service = next((s for s in data.get('modelServices', []) if s['id'] == (ref or {}).get('serviceId')), {})
    model = next((m for m in service.get('models', []) if m['id'] == (ref or {}).get('modelId')), {})
    output = int(effective.get('maxTokens') or 2048)
    window = int(native.get('contextWindow') or (int((effective.get('contextPolicy') or {}).get('maxContextTokens', 12000)) + output))
    idle = int(native.get('streamIdleTimeoutMs') or config.timeout_seconds * 1000)
    tool = int(safety.get('toolTimeoutSeconds') or 30)
    # The MCP transport must outlive the handler's own cancellation and serialization.
    transport = tool + 5
    steps = int(safety.get('maxToolSteps') or 5)
    recommended = max(30, int((idle / 1000 * (config.retry_count + 1) + transport) * (steps + 1)))
    execution = int(native.get('request_timeout_seconds') or min(3600, recommended))
    compaction = native.get('compaction') or {}
    message_budget = window - output
    headroom = compaction.get('headroomTokens')
    headroom = int(headroom) if headroom not in (None, '') else min(output, max(1, int(message_budget * .1)))
    summary_output = int(compaction.get('maxTokens') or min(output, headroom or output))
    threshold_tokens = int(min(window * float(compaction.get('thresholdRatio', .8)), message_budget - headroom))
    retained_tokens = int(message_budget * float(compaction.get('retainRatio', .16)))
    if compaction.get('enabled', True) and (threshold_tokens <= 0 or retained_tokens >= threshold_tokens or summary_output > output):
        raise ValueError(f'{purpose} 的压缩预算无效：请减少压缩预留、保留比例或摘要输出上限，或增大模型上下文窗口')
    enabled = purpose != 'document' or (config.vision_model != 'disabled' and ('modelServices' not in data or bool((data.get('modelAssignments') or {}).get('document'))))
    return {
        'purpose': purpose, 'enabled': enabled, 'serviceId': service.get('id'),
        'serviceName': service.get('name') or '默认服务', 'model': (config.vision_model if purpose == 'document' else config.chat_model) if enabled else None,
        'adapter': config.provider, 'inherited': inherited,
        'parameters': {
            'contextWindow': window, 'maxTokens': output,
            'reasoningEffort': native.get('reasoning_effort') or None,
            'retryCount': config.retry_count, 'streamIdleTimeoutMs': idle,
            'initializeTimeoutSeconds': int(native.get('initialize_timeout_seconds') or 30),
            'executionTimeoutSeconds': execution, 'toolTimeoutSeconds': tool,
            'mcpTimeoutMs': transport * 1000, 'maxToolSteps': steps,
            'inputBudgetTokens': min(int((effective.get('contextPolicy') or {}).get('maxContextTokens', 12000)), window - output),
            'compactionEnabled': bool(compaction.get('enabled', True)),
            'thresholdRatio': float(compaction.get('thresholdRatio', .8)),
            'retainRatio': float(compaction.get('retainRatio', .16)),
            'compactionHeadroomTokens': headroom, 'compactionMaxTokens': summary_output,
            'compactionThresholdTokens': threshold_tokens, 'compactionRetainTokens': retained_tokens,
            'inputTypes': model.get('inputTypes') or (['text', 'image'] if purpose == 'document' else ['text']),
        },
        'sources': {
            'contextWindow': '模型配置' if model.get('contextWindow') else '全局配置' if (data.get('harnessPolicy') or {}).get('contextWindow') else '输入预算 + 输出上限',
            'maxTokens': '模型配置' if model.get('maxTokens') else '平台默认',
            'reasoningEffort': '模型配置' if model.get('reasoningEffort') else '全局配置' if native.get('reasoning_effort') else '模型默认',
            'streamIdleTimeoutMs': '服务配置' if service.get('streamIdleTimeoutMs') else '全局配置' if (data.get('harnessPolicy') or {}).get('streamIdleTimeoutMs') else '服务响应等待时间',
            'executionTimeoutSeconds': '全局配置' if native.get('request_timeout_seconds') else '工具预算、等待时间与重试次数计算',
        },
        'warnings': ['执行超时短于建议预算，可能在重试或工具处理完成前结束。'] if enabled and execution < recommended else [],
    }
