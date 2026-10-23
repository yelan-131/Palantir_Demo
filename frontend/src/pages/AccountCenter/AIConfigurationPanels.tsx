import { createUuid } from '@/utils/uuid';
import { useState } from 'react';
import { PlusOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Collapse, Form, Input, InputNumber, Select, Space, Statistic, Switch, Tag } from 'antd';
import type { FormInstance } from 'antd';

export type TestTarget = { serviceId?: string; modelId?: string; purpose?: string };
const number = (label: string, name: (string | number)[], min: number, max: number, extra?: string) => <Form.Item label={label} name={name} extra={extra}><InputNumber min={min} max={max} precision={0} placeholder="使用默认值" /></Form.Item>;

export function AIStatusSummary({ items }: { items: { label: string; value: string | number }[] }) {
  return <div className="ai-status-summary">{items.map(item => <Card key={item.label}><Statistic title={item.label} value={item.value} /></Card>)}</div>;
}

export function ServiceCatalogPanel({ form, values, onChange, onTest, testing }: { form: FormInstance; values: any; onChange: () => void; onTest: (target: TestTarget) => void; testing: boolean }) {
  const services = values.modelServices || [];
  const [selected, setSelected] = useState('');
  const active = services.some((s: any) => s.id === selected) ? selected : services[0]?.id;
  const used = (sid: string, mid?: string) => Object.values(values.modelAssignments || {}).some((ref: any) => ref?.serviceId === sid && (!mid || ref.modelId === mid));
  const add = () => {
    const id = `service-${createUuid().slice(0, 8)}`;
    form.setFieldsValue({ modelServices: [...services, { id, name: '新模型服务', provider: 'openai-compatible', baseUrl: '', apiKey: '', timeoutSeconds: 30, retryCount: 2, models: [{ id: '', name: '', inputTypes: ['text'] }] }] });
    setSelected(id); onChange();
  };
  return <div className="ai-catalog">
    <AIStatusSummary items={[{ label: '模型服务', value: services.length }, { label: '可用模型配置', value: services.reduce((n: number, service: any) => n + (service.models || []).filter((model: any) => model.id).length, 0) }, { label: '已分配用途', value: Object.values(values.modelAssignments || {}).filter(Boolean).length }]} />
    <div className="ai-catalog-toolbar"><Select aria-label="选择模型服务" value={active} onChange={setSelected} options={services.map((s: any) => ({ value: s.id, label: s.name || s.id }))} /><Button icon={<PlusOutlined />} onClick={add}>添加模型服务</Button></div>
    <Form.List name="modelServices">{(fields, { remove }) => fields.map(field => {
      const service = services[field.name] || {};
      return <section key={field.key} hidden={service.id !== active}>
        <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
        <Card title="连接配置" className="settings-section ai-catalog-connection" extra={<Space><Form.Item name={[field.name, 'provider']} noStyle><Select aria-label="接口适配类型" style={{ width: 180 }} options={[{ value: 'openai-compatible', label: '通用 Chat Completions' }, { value: 'deepseek', label: 'DeepSeek 兼容' }, { value: 'openai', label: 'OpenAI 兼容' }, { value: 'glm', label: 'GLM 兼容' }, { value: 'qwen', label: 'Qwen 兼容' }]} /></Form.Item><Button size="small" icon={<ApiOutlined />} loading={testing} onClick={() => onTest({ serviceId: service.id, modelId: service.models?.[0]?.id })}>测试连接</Button><Button size="small" type="text" danger disabled={services.length === 1 || used(service.id)} title={used(service.id) ? '请先修改引用此服务的模型用途' : undefined} onClick={() => remove(field.name)}>移除服务</Button></Space>}>
          <div className="ai-catalog-field-grid">
            <Form.Item name={[field.name, 'name']} label="服务名称" rules={[{ required: true, whitespace: true, message: '请输入服务名称' }]}><Input placeholder="例如：企业模型网关" /></Form.Item>
            <Form.Item name={[field.name, 'baseUrl']} label="服务地址" rules={[{ required: true, message: '请输入服务地址' }, { validator: (_, value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? Promise.resolve() : Promise.reject(new Error('请输入不含账号密码的 HTTP(S) 地址')); } catch { return Promise.reject(new Error('请输入完整的 HTTP(S) 地址')); } } }]}><Input placeholder="https://gateway.example.com/v1" autoComplete="off" /></Form.Item>
            <Form.Item name={[field.name, 'apiKey']} label={<>API Key <Tag>{service.apiKey === '********' ? '已保存' : service.apiKey ? '待保存' : '未配置'}</Tag></>} tooltip="星号表示保留已存密钥；清空并保存将移除密钥。"><Input.Password autoComplete="new-password" placeholder="输入此服务的 API Key" /></Form.Item>
          </div>
          {/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(service.baseUrl || '') && <Alert showIcon type="warning" message="后端在 Docker 中，访问宿主机服务请使用 host.docker.internal。" />}
        </Card>
        <Card title="模型目录" className="settings-section ai-model-directory">
        <Form.List name={[field.name, 'models']}>{(models, { add: addModel, remove: removeModel }) => <>
          <div className="ai-model-column-head" aria-hidden="true"><span>模型 ID</span><span>显示名称</span><span>输入能力</span><span /></div><div className="ai-catalog-models">{models.map(modelField => {
            const model = service.models?.[modelField.name] || {};
            const path = [modelField.name];
            return <div className="ai-catalog-model" key={modelField.key}>
              <div className="ai-catalog-model-row">
                <Form.Item name={[...path, 'id']} aria-label="模型 ID" rules={[{ required: true, whitespace: true, message: '请输入模型 ID' }]}><Input aria-label="模型 ID" placeholder="例如：deepseek-chat" /></Form.Item>
                <Form.Item name={[...path, 'name']} ><Input aria-label="显示名称" placeholder="可选，默认使用模型 ID" /></Form.Item>
                <Form.Item name={[...path, 'inputTypes']} ><Select aria-label="输入能力" mode="multiple" options={[{ label: '文本', value: 'text' }, { label: '图像', value: 'image' }]} /></Form.Item>
                <Button type="text" aria-label={`移除模型 ${model.id || modelField.name + 1}`} icon={<DeleteOutlined />} disabled={models.length === 1 || used(service.id, model.id)} onClick={() => removeModel(modelField.name)} />
              </div>
              <Collapse ghost items={[{ key: 'model', label: '参数设置', children: <div className="ai-catalog-field-grid">
                {number('上下文窗口 · Token', [...path, 'contextWindow'], 1000, 2000000)}
                {number('最大输出 · Token', [...path, 'maxTokens'], 32, 32768)}
                <Form.Item name={[...path, 'reasoningEffort']} label="推理强度"><Select allowClear placeholder="模型默认" options={['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ value, label: value }))} /></Form.Item>
              </div> }]} />
            </div>;
          })}</div>
          <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => addModel({ id: '', name: '', inputTypes: ['text'] })}>添加模型</Button>
        </>}</Form.List>
        </Card>
        <Collapse className="ai-catalog-advanced" items={[{ key: 'advanced', label: '请求与连接参数', children: <div className="ai-catalog-field-grid">
          {number('响应等待回退 · 秒', [field.name, 'timeoutSeconds'], 1, 300, '未设置流式空闲超时时使用')}
          {number('请求重试次数', [field.name, 'retryCount'], 0, 3)}
          {number('流式空闲超时 · 毫秒', [field.name, 'streamIdleTimeoutMs'], 1, 3600000)}
          <Form.Item name={[field.name, 'organization']} label="Organization"><Input placeholder="可选" /></Form.Item>
          <Form.Item name={[field.name, 'project']} label="Project"><Input placeholder="可选" /></Form.Item>
        </div> }]} />

      </section>;
    })}</Form.List>
    <Collapse className="ai-catalog-advanced" items={[{ key: 'sdk', label: 'Harness 进程设置', children: <div className="ai-catalog-field-grid">
      {number('初始化超时 · 秒', ['harnessPolicy', 'initialize_timeout_seconds'], 1, 180)}
      {number('执行超时 · 秒', ['harnessPolicy', 'request_timeout_seconds'], 1, 3600)}
    </div> }]} />
  </div>;
}

type ModelReference = { serviceId: string; modelId: string };
function PurposeModelSelect({ value, onChange, services, purpose, title, placeholder }: { value?: ModelReference | null; onChange?: (value: ModelReference | null) => void; services: any[]; purpose: string; title: string; placeholder: string }) {
  const eligible = services.map(service => ({ ...service, models: (service.models || []).filter((model: any) => model.id && (purpose !== 'document' || model.inputTypes?.includes('image'))) })).filter(service => service.models.length);
  const active = eligible.find(service => service.id === value?.serviceId);
  return <div className="ai-purpose-selects">
    <Select aria-label={`${title}服务`} value={value?.serviceId} placeholder={placeholder} options={eligible.map(service => ({ value: service.id, label: service.name || service.id }))} onChange={serviceId => { const service = eligible.find(item => item.id === serviceId); if (service) onChange?.({ serviceId, modelId: service.models[0].id }); }} />
    <Select aria-label={`${title}模型`} value={value?.modelId} allowClear={purpose !== 'chat'} showSearch optionFilterProp="label" placeholder={value ? '选择模型' : placeholder} options={(active?.models || []).map((model: any) => ({ value: model.id, label: model.name || model.id }))} onChange={modelId => onChange?.(modelId && value ? { serviceId: value.serviceId, modelId } : null)} />
  </div>;
}

export function PurposeModelsPanel({ values, onTest, testing }: { values: any; onTest: (target: TestTarget) => void; testing: boolean }) {
  const services = values.modelServices || [];
  const assignments = values.modelAssignments || {};
  const displayModel = (ref: ModelReference | undefined) => services.find((service: any) => service.id === ref?.serviceId)?.models?.find((model: any) => model.id === ref?.modelId)?.name || ref?.modelId;
  return <div>
    <AIStatusSummary items={[{ label: '默认对话', value: displayModel(assignments.chat) || '未配置' }, { label: '推理', value: displayModel(assignments.reasoning) || '沿用对话模型' }, { label: '文档视觉增强', value: assignments.document ? '已配置' : '关闭' }]} />
    <Card title="用途路由" className="settings-section ai-purpose-list">
      <p className="ai-settings-quiet-note">按用途分别选择服务与模型，保存后用于后续请求。</p>
      <div className="ai-purpose-column-head" aria-hidden="true"><span>用途</span><span>模型服务</span><span>模型</span><span /></div>
      {[
        { key: 'chat', title: '对话', description: '日常问答、文档问答', placeholder: '选择模型服务' },
        { key: 'reasoning', title: '推理', description: '业务分析、工具规划', placeholder: '沿用对话模型' },
        { key: 'document', title: '文档识别', description: '扫描件、图片视觉增强', placeholder: '关闭视觉增强' },
      ].map(purpose => <div className="ai-purpose-row" key={purpose.key}>
        <div><h2>{purpose.title}</h2><p>{purpose.description}</p></div>
        <Form.Item name={['modelAssignments', purpose.key]} rules={purpose.key === 'chat' ? [{ required: true, message: '请选择默认对话模型' }] : []}>
          <PurposeModelSelect services={services} purpose={purpose.key} title={purpose.title} placeholder={purpose.placeholder} />
        </Form.Item>
        <Button size="small" loading={testing} disabled={purpose.key === 'document' && !assignments.document} onClick={() => onTest({ purpose: purpose.key })}>测试</Button>
      </div>)}
      <p className="ai-settings-quiet-note ai-purpose-note">推理模型需支持工具调用；文档识别仅列出支持图像输入的模型。</p>
    </Card>
  </div>;
}

export function NativeCompactionPanel() {
  return <div className="ai-native-compaction"><div className="ai-native-compaction-heading"><strong>DSH 会话压缩</strong><Form.Item name={['harnessPolicy', 'compaction', 'enabled']} valuePropName="checked" noStyle><Switch aria-label="启用 DSH 会话压缩" /></Form.Item></div><p className="ai-settings-quiet-note">上下文达到阈值时，由 Harness 原生压缩并保留最近的会话内容。</p><div className="ai-catalog-field-grid"><Form.Item name={['harnessPolicy', 'compaction', 'thresholdRatio']} label="触发比例"><InputNumber min={0.01} max={1} step={0.01} /></Form.Item><Form.Item name={['harnessPolicy', 'compaction', 'retainRatio']} label="保留比例"><InputNumber min={0.01} max={0.99} step={0.01} /></Form.Item></div><Collapse ghost items={[{ key: 'compression-budget', label: '高级压缩参数', children: <div className="ai-catalog-field-grid">{number('压缩预留 · Token', ['harnessPolicy', 'compaction', 'headroomTokens'], 0, 32768, '留空时按所选模型计算')}{number('摘要输出上限 · Token', ['harnessPolicy', 'compaction', 'maxTokens'], 1, 32768, '不得超过模型输出上限')}</div> }]} /></div>;
}
