import { ApiOutlined, ArrowRightOutlined, FileTextOutlined, MessageOutlined, RobotOutlined } from '@ant-design/icons';
import { Alert, AutoComplete, Button, Collapse, Form, Input, InputNumber, Select, Switch, Tag } from 'antd';
import type { FormInstance } from 'antd';

export const MODEL_PROVIDER_CHOICES = [
  { id: 'deepseek', name: 'DeepSeek', mark: 'DS', detail: 'DeepSeek API' },
  { id: 'glm', name: '智谱 GLM', mark: 'GLM', detail: '普通 API / Coding Plan' },
  { id: 'openai', name: 'OpenAI', mark: 'O', detail: 'OpenAI API' },
  { id: 'qwen', name: '通义千问', mark: 'Q', detail: '兼容模式 API' },
  { id: 'openai-compatible', name: '自定义服务', mark: '</>', detail: 'OpenAI 兼容接口' },
];

const modelExamples: Record<string, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  glm: ['glm-5.1', 'GLM-5.1', 'glm-4-flash', 'glm-4v-plus'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  qwen: ['qwen-plus', 'qwen-turbo'],
};

export function ModelConnectionPanel({ form, values, runtime, onProvider, onGlmPreset, onNext }: {
  form: FormInstance; values: Record<string, any>; runtime: Record<string, any>;
  onProvider: (id: string) => void; onGlmPreset: (preset: 'api' | 'coding') => void; onNext: () => void;
}) {
  const selected = MODEL_PROVIDER_CHOICES.find(item => item.id === values.provider) || MODEL_PROVIDER_CHOICES[4];
  const keySaved = values.apiKey === '********';
  const hasKey = Boolean(values.apiKey);
  const modelReady = Boolean(values.chatModel && values.chatModel !== 'local-disabled');
  let loopback = false;
  try { loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(values.baseUrl).hostname); } catch { /* validation owns invalid URLs */ }
  return <div className="ai-model-connection">
    <Form.Item name="provider" label="服务商" rules={[{ required: true, message: '请选择模型服务商' }]} extra="选择服务商后配置连接地址与凭据，模型用途在下一项中单独设置。">
      <Select showSearch optionFilterProp="label" placeholder="选择模型服务商或自定义兼容服务" options={MODEL_PROVIDER_CHOICES.map(item => ({ value: item.id, label: item.name, detail: item.detail }))} onChange={onProvider} optionRender={option => <div className="ai-provider-select-option"><strong>{option.label}</strong><small>{option.data.detail}</small></div>} />
    </Form.Item>
    <div className="ai-provider-editor">
      <div className="ai-provider-editor-heading"><div className="ai-provider-editor-identity"><span className="ai-provider-mark">{selected.mark}</span><div><h3>{selected.name} 连接</h3><span>填写服务地址和 API Key</span></div></div><Tag>API Key 接入</Tag></div>
      {values.provider === 'glm' && <div className="ai-glm-access-mode"><span>接口类型</span><Select aria-label="GLM 接口类型" value={String(values.baseUrl).includes('/coding/') ? 'coding' : 'api'} options={[{ value: 'api', label: '普通 API' }, { value: 'coding', label: 'Coding Plan' }]} onChange={onGlmPreset} /></div>}
      <Form.Item name="baseUrl" label="服务地址" rules={[{ required: true, message: '请填写模型服务地址' }, { validator: (_, value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? Promise.resolve() : Promise.reject(new Error('请输入不含账号密码的 HTTP(S) 地址')); } catch { return Promise.reject(new Error('请输入有效的 HTTP(S) 地址')); } } }]} extra="Base URL · 按服务商文档填写 API 根地址，无需追加 /chat/completions。"><Input autoComplete="off" spellCheck={false} placeholder="https://your-model-service.example/v1" /></Form.Item>
      {loopback && <div className="ai-inline-guidance"><ApiOutlined /><span>后端运行在 Docker 中。连接宿主机模型服务时，请使用 host.docker.internal 对应地址。</span></div>}
      <Form.Item name="apiKey" label={<span>API Key <span className={`ai-credential-state ${hasKey ? 'configured' : ''}`}>{keySaved ? '已保存' : hasKey ? '待保存' : '未配置'}</span></span>} extra="密钥在后端加密保存，浏览器不缓存。星号代表已有密钥；清空后保存会清除已存密钥。"><Input.Password autoComplete="new-password" placeholder="输入当前服务的 API Key" /></Form.Item>
      <div className="ai-provider-protocol"><span>请求协议</span><code>OpenAI Chat Completions</code><span>由 Harness 统一调用</span></div>
      <Collapse ghost className="ai-connection-advanced" items={[{ key: 'headers', label: '高级连接选项', children: <div className="ai-connection-advanced-fields"><p>仅在服务商要求时填写，会作为 Organization / Project 请求头发送。</p><Form.Item name="organization" label="Organization"><Input placeholder="可选" /></Form.Item><Form.Item name="project" label="Project"><Input placeholder="可选" /></Form.Item></div> }]} />
    </div>
    <div className="ai-connection-checklist"><div><h3>接入检查</h3><span>配置完成后测试连接，确认服务实际可用。</span></div><ul><li><span className={values.baseUrl && !loopback ? 'ai-state-dot ready' : 'ai-state-dot warning'} /><span>服务地址</span><strong>{!values.baseUrl ? '待填写' : loopback ? '请确认容器可访问' : '已填写，待测试'}</strong></li><li><span className={hasKey ? 'ai-state-dot ready' : 'ai-state-dot warning'} /><span>访问凭据</span><strong>{keySaved ? '已保存' : hasKey ? '草稿已填写' : '待填写'}</strong></li><li><span className={modelReady ? 'ai-state-dot ready' : 'ai-state-dot warning'} /><span>对话模型</span><strong>{modelReady ? values.chatModel : '待选择'}</strong></li></ul><Button type="link" onClick={onNext}>前往分配模型 <ArrowRightOutlined /></Button></div>
    {!runtime.sdkVersion && <Alert showIcon type="warning" message="执行依赖尚未就绪" description="后端需要安装 DeepSeek Harness SDK 及配套运行时，才能进行连接测试。" />}
    <Form.Item shouldUpdate noStyle>{() => form.getFieldError('provider').length ? <Alert type="error" message={form.getFieldError('provider')[0]} /> : null}</Form.Item>
  </div>;
}

export function ModelAssignmentsPanel({ values, onConnection }: { values: Record<string, any>; onConnection: () => void }) {
  const provider = MODEL_PROVIDER_CHOICES.find(item => item.id === values.provider)?.name || '自定义服务';
  const options = (modelExamples[values.provider] || []).map(value => ({ value, label: value }));
  const cards = [
    { key: 'visionModel', title: '文档', icon: <FileTextOutlined />, badge: '可选', description: '用于文档图像识别与 OCR 增强，需要模型支持图像输入。填写 disabled 关闭远程增强。', placeholder: '文档识别模型 ID，或 disabled', required: false },
    { key: 'chatModel', title: '对话', icon: <MessageOutlined />, badge: '默认模型', description: '用于日常问答与文档问答，也是推理模型未单独设置时的默认选择。', placeholder: '输入对话模型 ID', required: true },
    { key: 'reasoningModel', title: '推理', icon: <RobotOutlined />, badge: '可沿用对话', description: '用于复杂业务分析、Agent 工具规划和操作准备。请选择支持工具调用的模型。', placeholder: `留空沿用 ${values.chatModel || '对话模型'}`, required: false },
  ];
  return <div className="ai-model-assignments"><div className="ai-active-connection-line"><ApiOutlined /><span>共用连接</span><strong>{provider}</strong><code>{values.baseUrl || '尚未填写地址'}</code><Button type="link" onClick={onConnection}>管理连接</Button></div><p className="ai-model-selection-note">模型 ID 必须与你的服务端一致，可直接输入自定义名称。下拉选项仅为示例，可用性以连接测试为准。</p>{cards.map(card => <div className="ai-model-assignment" key={card.key}><div className="ai-model-assignment-icon">{card.icon}</div><div className="ai-model-assignment-body"><div className="ai-model-assignment-heading"><h3>{card.title}</h3><Tag>{card.badge}</Tag></div><p>{card.description}</p><Form.Item name={card.key} label={`${card.title}模型 ID`} rules={card.required ? [{ required: true, whitespace: true, message: '请填写对话模型 ID' }] : []}><AutoComplete allowClear options={card.key === 'visionModel' ? [...options, { label: '关闭远程视觉增强', value: 'disabled' }] : options} placeholder={card.placeholder} /></Form.Item>{card.key === 'reasoningModel' && <span className="ai-effective-model">当前将使用 <code>{values.reasoningModel || values.chatModel || '待设置'}</code></span>}{card.key === 'chatModel' && values.chatModel === 'local-disabled' && <span className="ai-inline-warning">当前是测试占位值，请替换为服务端可用的模型 ID。</span>}</div></div>)}</div>;
}

export function ModelExecutionFields({ values }: { values: Record<string, any> }) {
  const automaticWindow = Number(values.contextPolicy?.maxContextTokens || 12000) + Number(values.maxTokens || 2048);
  const automaticIdle = Number(values.timeoutSeconds || 30) * 1000;
  return <div className="ai-execution-fields">
    <div className="ai-setting-block-heading"><h3>模型请求</h3><p>对应当前 DSH SDK 与 llm-pi-ai 适配器的参数；留空的可选项沿用默认值。</p></div>
    <div className="ai-execution-field-grid">
      <Form.Item name="maxTokens" label="最大输出 Token" extra={<code>max_tokens</code>}><InputNumber min={32} max={32768} precision={0} /></Form.Item>
      <Form.Item name={['harnessPolicy', 'contextWindow']} label="模型上下文窗口" extra={<code>models[].contextWindow</code>}><InputNumber min={1000} max={2000000} precision={0} placeholder={`自动：${automaticWindow}`} /></Form.Item>
      <Form.Item name={['harnessPolicy', 'reasoning_effort']} label="推理强度" extra={<code>reasoning_effort</code>}><Select allowClear placeholder="模型默认" options={['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ value, label: value }))} /></Form.Item>
      <Form.Item name={['harnessPolicy', 'streamIdleTimeoutMs']} label="流式空闲超时 · 毫秒" extra={<code>streamIdleTimeoutMs · DSH 默认 300000</code>}><InputNumber min={1} max={3600000} precision={0} placeholder={`沿用已有配置：${automaticIdle}`} /></Form.Item>
      <Form.Item name="retryCount" label="请求重试次数" extra={<code>retryPolicy.maxRetries</code>}><InputNumber min={0} max={3} precision={0} /></Form.Item>
    </div>
    <div className="ai-settings-quiet-note">推理强度仅用于推理用途的模型，服务端需支持选定级别；留空使用模型默认值。上下文窗口指模型总容量，需大于输出上限。</div>
    <div className="ai-setting-block-heading"><h3>SDK 超时</h3><p>控制 Harness 进程初始化和单次执行等待时间，单位为秒。</p></div>
    <div className="ai-execution-field-grid">
      <Form.Item name={['harnessPolicy', 'initialize_timeout_seconds']} label="初始化超时 · 秒" extra={<code>initialize_timeout_seconds</code>}><InputNumber min={1} max={180} precision={0} /></Form.Item>
      <Form.Item name={['harnessPolicy', 'request_timeout_seconds']} label="请求执行超时 · 秒" extra={<code>request_timeout_seconds</code>}><InputNumber min={1} max={3600} precision={0} placeholder="自动，按空闲超时与工具步数计算" /></Form.Item>
    </div>
    <div className="ai-setting-block-heading"><h3>DSH 会话压缩</h3><p>直接配置 compaction-basic 插件，比例按模型上下文容量计算。</p></div>
    <Form.Item name={['harnessPolicy', 'compaction', 'enabled']} label="启用会话压缩" valuePropName="checked"><Switch /></Form.Item>
    <div className="ai-execution-field-grid">
      <Form.Item name={['harnessPolicy', 'compaction', 'thresholdRatio']} label="触发比例" extra={<code>thresholdRatio · 默认 0.8</code>}><InputNumber min={0.01} max={1} step={0.01} /></Form.Item>
      <Form.Item name={['harnessPolicy', 'compaction', 'retainRatio']} label="保留比例" extra={<code>retainRatio · 默认 0.16</code>}><InputNumber min={0.01} max={0.99} step={0.01} /></Form.Item>
    </div>
    <div className="ai-settings-quiet-note">保留比例需小于触发比例。上述设置直接传入当前固定版本的 DSH，不包含未适配的采样或并行执行选项。</div>
  </div>;
}
