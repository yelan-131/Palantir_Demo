import { useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Select, Space, Tag } from 'antd';

export default function EffectiveHarnessPreview({ values, onPreview, onError }: { values: unknown; onPreview: () => Promise<any>; onError: (description: string) => void }) {
  const [preview, setPreview] = useState<any>();
  const [fingerprint, setFingerprint] = useState('');
  const [purpose, setPurpose] = useState('reasoning');
  const [loading, setLoading] = useState(false);
  const stale = !!preview && fingerprint !== JSON.stringify(values);
  const route = preview?.routes?.find((item: any) => item.purpose === purpose);
  const p = route?.parameters || {};
  const source = route?.sources || {};
  const fetchPreview = async () => {
    setLoading(true);
    const requestFingerprint = JSON.stringify(values);
    try { setPreview(await onPreview()); setFingerprint(requestFingerprint); }
    catch (err: any) { const detail = err?.response?.data?.detail; onError(typeof detail === 'string' ? detail : err?.errorFields?.[0]?.errors?.[0] || '无法预览，请检查草稿配置'); }
    finally { setLoading(false); }
  };
  return <Collapse className="ai-effective-preview" items={[{ key: 'effective', label: 'Harness 生效参数', children: <>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="参数预览用途" value={purpose} onChange={setPurpose} options={[{ value: 'chat', label: '对话' }, { value: 'reasoning', label: '推理' }, { value: 'document', label: '文档识别' }]} style={{ width: 150 }} />
      <Button loading={loading} onClick={fetchPreview}>预览当前草稿</Button>
      {preview && <span className="ai-card-note">SDK {preview.runtime?.sdkVersion} · Runtime {preview.runtime?.runtimeVersion}</span>}
      {stale && <Tag color="gold">草稿已变更，请重新预览</Tag>}
    </Space>
    {route && <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
      { key: 'route', label: '模型路由', children: route.enabled ? `${route.serviceName} / ${route.model}${route.inherited ? '（沿用对话）' : ''}` : '未启用' },
      { key: 'adapter', label: '接口适配', children: route.adapter },
      { key: 'window', label: '上下文窗口', children: `${p.contextWindow} · ${source.contextWindow}` },
      { key: 'input-budget', label: '平台输入预算', children: `${p.inputBudgetTokens} Token` },
      { key: 'output', label: '输出上限', children: `${p.maxTokens} · ${source.maxTokens}` },
      { key: 'effort', label: '推理强度', children: `${p.reasoningEffort || '模型默认'} · ${source.reasoningEffort}` },
      { key: 'retry', label: '请求重试次数', children: p.retryCount },
      { key: 'idle', label: '流式空闲等待', children: `${p.streamIdleTimeoutMs} ms · ${source.streamIdleTimeoutMs}` },
      { key: 'execution', label: '执行超时', children: `${p.executionTimeoutSeconds} 秒 · ${source.executionTimeoutSeconds}` },
      { key: 'init', label: '初始化超时', children: `${p.initializeTimeoutSeconds} 秒` },
      { key: 'tool', label: '工具 / MCP 超时', children: `${p.toolTimeoutSeconds} 秒 / ${p.mcpTimeoutMs} ms` },
      { key: 'steps', label: '最大工具调用', children: purpose === 'document' ? '不开放业务工具' : p.maxToolSteps },
      { key: 'compression-budget', label: '压缩预留 / 摘要输出', children: `${p.compactionHeadroomTokens} / ${p.compactionMaxTokens} Token` },
      { key: 'compaction', label: '原生会话压缩', children: p.compactionEnabled ? `启用 · 触发 ${p.thresholdRatio} / 保留 ${p.retainRatio}` : '关闭' },
    ]} />}
    {route?.warnings?.map((warning: string) => <Alert key={warning} type="warning" showIcon message={warning} />)}
    <p className="ai-settings-quiet-note">与实际执行共用后端参数解析；预览不保存草稿，也不调用模型。平台权限与写入审批保持独立。</p>
  </> }]} />;
}
