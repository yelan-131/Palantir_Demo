import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { createScheduledJob, deleteScheduledJob, listScheduledJobs, triggerJob, updateScheduledJob } from '@/services/api';

interface ScheduledJob {
  id: number;
  name: string;
  cron: string;
  job_type: string;
  config?: Record<string, unknown> | string | null;
  is_active: boolean;
  last_run?: string | null;
}

interface JobForm {
  name: string;
  cron: string;
  job_type: string;
  config: string;
  is_active: boolean;
}

const jobTypes = [
  { value: 'report', label: '报表' },
  { value: 'sync', label: '同步' },
  { value: 'cleanup', label: '清理' },
];

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? `${fallback}：${detail}` : fallback;
}

function parseConfig(value?: string): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置必须是 JSON 对象');
  return parsed as Record<string, unknown>;
}

export default function Scheduler() {
  const [messageApi, messageContext] = message.useMessage();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [fallback, setFallback] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<number[]>([]);
  const [form] = Form.useForm<JobForm>();

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await listScheduledJobs();
      setJobs(Array.isArray(response.data?.data) ? response.data.data : []);
      setFallback(response.data?.source === 'fallback');
    } catch (error) {
      setLoadError(errorText(error, '任务列表加载失败，请重试'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const openEditor = (job: ScheduledJob | null) => {
    setEditing(job);
    form.resetFields();
    form.setFieldsValue({
      name: job?.name || '',
      cron: job?.cron || '0 8 * * *',
      job_type: job?.job_type || 'report',
      config: job?.config ? (typeof job.config === 'string' ? job.config : JSON.stringify(job.config, null, 2)) : '',
      is_active: job?.is_active ?? true,
    });
    setModalOpen(true);
  };

  const save = async () => {
    let values: JobForm;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload = { ...values, name: values.name.trim(), cron: values.cron.trim(), config: parseConfig(values.config) };
      const response = editing ? await updateScheduledJob(editing.id, payload) : await createScheduledJob(payload);
      messageApi.success(response.data?.source === 'fallback' ? '已保存至后端临时数据' : '任务配置已保存');
      setModalOpen(false);
      await reload();
    } catch (error) {
      messageApi.error(errorText(error, '保存任务失败，请重试'));
    } finally { setSaving(false); }
  };

  const runAction = async (job: ScheduledJob, action: 'toggle' | 'trigger' | 'delete') => {
    setPending((previous) => [...previous, job.id]);
    try {
      if (action === 'toggle') {
        await updateScheduledJob(job.id, { is_active: !job.is_active });
        messageApi.success(job.is_active ? '任务已设为暂停' : '任务已设为启用');
      } else if (action === 'trigger') {
        await triggerJob(job.id);
        messageApi.info('手动触发已记录到后端日志；当前接口不执行实际报表、同步或清理。');
      } else {
        await deleteScheduledJob(job.id);
        messageApi.success('任务已删除');
      }
      await reload();
    } catch (error) {
      messageApi.error(errorText(error, '操作失败，请重试'));
    } finally { setPending((previous) => previous.filter((id) => id !== job.id)); }
  };

  const columns: ColumnsType<ScheduledJob> = [
    { title: '任务名称', dataIndex: 'name', render: (name: string) => <Typography.Text strong>{name}</Typography.Text> },
    { title: '类型', dataIndex: 'job_type', width: 90, render: (type: string) => jobTypes.find((item) => item.value === type)?.label || type },
    { title: 'Cron 表达式', dataIndex: 'cron', width: 160, render: (cron: string) => <Typography.Text code>{cron}</Typography.Text> },
    { title: '状态', dataIndex: 'is_active', width: 90, render: (active: boolean) => <Tag color={active ? 'success' : 'default'}>{active ? '启用' : '暂停'}</Tag> },
    { title: '最近记录时间', dataIndex: 'last_run', width: 190, render: (value?: string | null) => value ? value.replace('T', ' ') : <Typography.Text type="secondary">暂无记录</Typography.Text> },
    {
      title: '操作', key: 'actions', width: 310,
      render: (_, job) => (
        <Space size={2}>
          <Button type="text" size="small" icon={<EditOutlined />} disabled={pending.includes(job.id)} onClick={() => openEditor(job)}>编辑</Button>
          <Button type="text" size="small" disabled={pending.includes(job.id)} onClick={() => void runAction(job, 'toggle')}>{job.is_active ? '暂停' : '启用'}</Button>
          <Popconfirm title="记录一次手动触发？" description="当前后端仅写入触发日志，不执行实际任务。" onConfirm={() => runAction(job, 'trigger')} okText="记录触发" cancelText="取消">
            <Button type="text" size="small" icon={<PlayCircleOutlined />} disabled={pending.includes(job.id)}>触发</Button>
          </Popconfirm>
          <Popconfirm title={`删除任务「${job.name}」？`} description="删除后无法恢复。" onConfirm={() => runAction(job, 'delete')} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={pending.includes(job.id)}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  const visibleJobs = jobs.filter((job) => (
    (status === 'all' || job.is_active === (status === 'active'))
    && `${job.name} ${job.cron} ${jobTypes.find((item) => item.value === job.job_type)?.label || job.job_type}`.toLowerCase().includes(query.trim().toLowerCase())
  ));

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
      {messageContext}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: '0 0 6px' }}>定时任务</Typography.Title>
          <Typography.Text type="secondary">管理报表、数据同步和清理任务的配置与状态。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>新建任务</Button>
        </Space>
      </div>
      <Alert type="info" showIcon message="当前页面管理任务配置；后端手动触发接口仅记录日志，配置启用不代表已接入自动执行引擎。" style={{ marginBottom: 16 }} />
      {fallback && <Alert type="warning" showIcon message="后端数据库不可用，正在使用临时回退数据；修改可能在服务重启后丢失。" style={{ marginBottom: 16 }} />}
      {loadError && <Alert type="error" showIcon message={loadError} action={<Button size="small" onClick={() => void reload()}>重试</Button>} style={{ marginBottom: 16 }} />}
      <Card styles={{ body: { padding: 20 } }} style={{ borderRadius: 12 }}>
        <Space wrap style={{ marginBottom: 20 }}>
          <Input prefix={<SearchOutlined />} placeholder="搜索任务、类型或 Cron" aria-label="搜索定时任务" allowClear value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: 280 }} />
          <Select aria-label="任务状态筛选" value={status} onChange={setStatus} style={{ width: 130 }} options={[{ value: 'all', label: '全部状态' }, { value: 'active', label: '启用' }, { value: 'paused', label: '暂停' }]} />
          <Typography.Text type="secondary">共 {visibleJobs.length} 项</Typography.Text>
        </Space>
        <Table rowKey="id" columns={columns} dataSource={visibleJobs} loading={loading} scroll={{ x: 1000 }} pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loadError ? '列表加载失败' : query || status !== 'all' ? '没有符合条件的任务' : '暂无任务'} /> }} />
      </Card>
      <Modal title={editing ? '编辑任务' : '新建任务'} open={modalOpen} onCancel={() => { if (!saving) setModalOpen(false); }} onOk={() => void save()} confirmLoading={saving} okText="保存配置" cancelText="取消" cancelButtonProps={{ disabled: saving }} maskClosable={!saving} closable={!saving} width={560}>
        <Form form={form} layout="vertical" style={{ marginTop: 20 }} disabled={saving}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, whitespace: true, message: '请输入任务名称' }]}><Input placeholder="例如：每日生产报告" /></Form.Item>
          <Form.Item name="job_type" label="任务类型" rules={[{ required: true, message: '请选择任务类型' }]}><Select options={jobTypes} /></Form.Item>
          <Form.Item name="cron" label="Cron 表达式" extra="例如：0 8 * * *（每天 08:00）。实际执行时间及调度由后端决定。" rules={[{ required: true, whitespace: true, message: '请输入 Cron 表达式' }]}><Input placeholder="0 8 * * *" /></Form.Item>
          <Form.Item name="config" label="任务配置（JSON 对象，可选）" rules={[{ validator: async (_, value: string) => { try { parseConfig(value); } catch { throw new Error('请输入合法的 JSON 对象，例如 {"report_type":"daily_production"}'); } } }]}><Input.TextArea rows={5} placeholder={'{\n  "report_type": "daily_production"\n}'} style={{ fontFamily: 'monospace' }} /></Form.Item>
          <Form.Item name="is_active" label="启用状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="暂停" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
