import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tabs, Timeline, Typography, message } from 'antd';
import './style.css';
import { exportConfig, importConfig, exportModelConfig, getEntityTimeline, getModuleReadiness, getCentrality, getTraceChain, getImpactAnalysis, suggestModel, suggestPage } from '../../services/api';

const ModelDesigner = lazy(() => import('../ModelDriven/ModelDesigner'));
const PageGenerator = lazy(() => import('../ModelDriven/PageGenerator'));
const MenuManager = lazy(() => import('../ModelDriven/MenuManager'));
const AppBuilder = lazy(() => import('../ModelDriven/AppBuilder'));

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const labels: Record<string, string> = { field_name: '字段名', label: '显示名称', field_type: '字段类型', required: '必填', type: '控件类型', col_span: '占用列数', name: '名称', pg_id: '实体 ID', degree: '连接数量', rel_types: '关系类型', outgoing_targets: '下游对象', incoming_sources: '上游对象', distance: '关系层数', src: '来源对象', affected: '受影响对象', r: '关系', path: '追溯路径', module: '模块', status: '成熟度', production_scope: '适用范围', boundary: '能力边界' };
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return <Table size="small" scroll={{ x: true }} dataSource={rows.map((row, index) => ({ ...row, _rowKey: index }))} rowKey="_rowKey" pagination={{ pageSize: 10 }} columns={keys.map(key => ({ title: labels[key] || key, dataIndex: key, render: (value: unknown) => value == null ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'object' ? JSON.stringify(value) : String(value) }))} />;
}

function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BackendSettings({ section }: { section: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [graphKind, setGraphKind] = useState('centrality');
  const [suggestionKind, setSuggestionKind] = useState('model');
  const [configText, setConfigText] = useState('');
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(''); setResult(null);
    try { await operation(); }
    catch (err: any) { const detail = err?.response?.data?.detail; setError(typeof detail === 'string' ? detail : err?.message || '操作失败，请稍后重试'); }
    finally { setBusy(false); }
  };

  if (section === 'model-tools') return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert type="info" showIcon message="旧版模型工具" description="管理旧版元模型、动态页面与菜单。新业务表单请使用「应用配置 → 应用、表单与菜单」。应用构建器保留为配置预览。" />
    <Suspense fallback={<Spin />}><Tabs destroyOnHidden items={[
      { key: 'models', label: '模型设计器', children: <ModelDesigner /> },
      { key: 'pages', label: '页面生成器', children: <PageGenerator /> },
      { key: 'menus', label: '菜单管理器', children: <MenuManager /> },
      { key: 'builder', label: '应用构建器预览', children: <AppBuilder /> },
    ]} /></Suspense>
  </Space>;

  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    {error && <Alert type="error" showIcon message="操作未完成" description={error} />}
    {section === 'entity-timeline' && <>
      <Alert type="info" showIcon message="实体变更时间线（实验功能）" description="查询指定时点以前的变更记录。当前后端存在演示回退数据，结果不代表完整的历史状态重建。" />
      <Typography.Text type="secondary">本地示例：实体 ID 810000，查询日期 2026-05-21，可分别查看 09:45 和 10:00 的版本。</Typography.Text>
      <Form layout="inline" onFinish={values => run(async () => { const response = await getEntityTimeline(values.entityId, values.timestamp.format('YYYY-MM-DDTHH:mm:ss')); setResult(response.data); })}>
        <Form.Item name="entityId" label="实体 ID" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item>
        <Form.Item name="timestamp" label="查询时点" rules={[{ required: true }]}><DatePicker showTime /></Form.Item>
        <Form.Item><Button type="primary" htmlType="submit" loading={busy}>查询时间线</Button></Form.Item>
      </Form>
      {result && <Card title={`实体 ${result.entity_id} · ${result.timestamp}`}>
        {result.versions?.length ? <Timeline items={result.versions.map((version: any) => ({ children: version.v ? <><Typography.Text strong>{version.v.valid_from || '历史版本'}</Typography.Text><ResultTable rows={[version.v]} /></> : <><Typography.Text strong>{version.timestamp}</Typography.Text><div>{version.property}：{String(version.old_value ?? '—')} → {String(version.new_value ?? '—')}</div></> }))} /> : <Empty description="该时点前没有变更记录" />}
      </Card>}
    </>}
    {section === 'graph-tools' && <>
      <Typography.Paragraph type="secondary">查询实体的关联影响、追溯链，或按连接数量查看关键实体。</Typography.Paragraph>
      <Typography.Text type="secondary">本地示例实体 ID：810000（焊点虚焊）、810100（孔位尺寸漂移）、810200（端子压接高度偏差）。</Typography.Text>
      <Form layout="inline" initialValues={{ kind: 'centrality', limit: 20, hops: 5 }} onFinish={values => run(async () => {
        const response = values.kind === 'centrality' ? await getCentrality(values.limit) : values.kind === 'trace' ? await getTraceChain(values.entityId, values.hops) : await getImpactAnalysis(values.entityId, values.hops);
        setResult(response.data.data);
      })}>
        <Form.Item name="kind" label="分析方式"><Select style={{ width: 150 }} onChange={setGraphKind} options={[{ value: 'centrality', label: '中心性分析' }, { value: 'trace', label: '追溯链' }, { value: 'impact', label: '影响分析' }]} /></Form.Item>
        {graphKind === 'centrality' ? <Form.Item name="limit" label="结果数量" rules={[{ required: true }]}><InputNumber min={1} max={100} precision={0} /></Form.Item> : <>
          <Form.Item name="entityId" label="实体 ID" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item>
          <Form.Item name="hops" label="关系层数" rules={[{ required: true }]}><InputNumber min={1} max={10} precision={0} /></Form.Item>
        </>}
        <Form.Item><Button type="primary" htmlType="submit" loading={busy}>开始分析</Button></Form.Item>
      </Form>
      {result && <Card title="分析结果"><ResultTable rows={Array.isArray(result) ? result : [result]} /></Card>}
    </>}
    {section === 'ai-builder' && <>
      <Alert type="info" showIcon message="模型与页面建议（规则模板）" description="当前服务使用关键词和预置模型生成建议，不调用大模型，也不会自动创建或发布配置。可下载建议后用于设计参考。" />
      <Form layout="vertical" initialValues={{ kind: 'model' }} onFinish={values => run(async () => { const response = values.kind === 'model' ? await suggestModel(values.description) : await suggestPage(values.modelName); setResult(response.data.suggestion); })}>
        <Form.Item name="kind" label="建议类型"><Select onChange={value => { setSuggestionKind(value); setResult(null); }} options={[{ value: 'model', label: '模型字段建议' }, { value: 'page', label: '页面布局建议' }]} /></Form.Item>
        {suggestionKind === 'model' ? <Form.Item name="description" label="业务需求" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} placeholder="例如：记录设备故障、维修情况和健康评分" /></Form.Item> : <Form.Item name="modelName" label="模型名称" rules={[{ required: true, whitespace: true }]}><Input placeholder="输入已有模型名称" /></Form.Item>}
        <Button type="primary" htmlType="submit" loading={busy}>生成建议</Button>
      </Form>
      {result && <Card title={result.label || '布局建议'} extra={<Button onClick={() => downloadJson(result, 'design-suggestion.json')}>下载建议</Button>}><ResultTable rows={result.fields || result.layout || []} /></Card>}
    </>}
    {section === 'config-transfer' && <>
      <Alert type="info" showIcon message="旧版配置迁移" description="导入导出范围为旧版模型、页面、菜单与规则，不包含新版表单、业务记录和附件。导出服务可能返回演示配置，请核对下载内容。导入采用合并模式，跳过同名配置。" />
      <Card title="导出配置"><Space direction="vertical" style={{ width: '100%' }}>
        <Button loading={busy} onClick={() => run(async () => { const response = await exportConfig(); downloadJson(response.data, 'platform-config.json'); })}>导出全部配置</Button>
        <Form layout="inline" onFinish={values => run(async () => { const response = await exportModelConfig(values.modelName.trim()); downloadJson(response.data, 'model-config.json'); })}><Form.Item name="modelName" label="单个模型" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item><Button htmlType="submit" loading={busy}>导出模型</Button></Form>
      </Space></Card>
      <Card title="导入配置"><Space direction="vertical" style={{ width: '100%' }}>
        <Input type="file" accept=".json,application/json" aria-label="选择配置文件" onChange={event => { const file = event.target.files?.[0]; if (file) { setError(''); setResult(null); void file.text().then(setConfigText).catch(() => setError('读取文件失败')); } }} />
        <Input.TextArea rows={10} aria-label="配置 JSON" placeholder="选择 JSON 文件或粘贴配置，可核对后再导入" value={configText} onChange={event => { setConfigText(event.target.value); setResult(null); }} />
        <Button type="primary" disabled={!configText.trim()} loading={busy} onClick={() => {
          let config: any;
          try { config = JSON.parse(configText); if (!config || typeof config !== 'object' || Array.isArray(config) || !['models', 'pages', 'menus', 'rules'].some(key => Array.isArray(config[key]))) throw new Error(); }
          catch { setError('请输入包含 models、pages、menus 或 rules 数组的有效配置 JSON'); return; }
          Modal.confirm({ title: '合并导入配置', content: '将创建配置中尚不存在的旧版模型、页面、菜单和规则，同名配置将跳过。请确认已核对配置内容。', okText: '合并导入', cancelText: '取消', onOk: () => run(async () => { const response = await importConfig(config, 'merge'); setResult(response.data); message.success('导入请求已完成，请核对结果'); }) });
        }}>核对并导入</Button>
      </Space></Card>
      {result && <Card title="导入结果"><Typography.Paragraph><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</pre></Typography.Paragraph></Card>}
    </>}
    {section === 'readiness' && <>
      <Typography.Paragraph type="secondary">查看后端声明的模块成熟度及交付范围。此信息不是实时健康检查。</Typography.Paragraph>
      <Button loading={busy} onClick={() => run(async () => { const response = await getModuleReadiness(); setResult(response.data); })}>读取模块状态</Button>
      {result && <Card title="模块成熟度"><ResultTable rows={result.modules || []} /></Card>}
    </>}
  </Space>;
}
