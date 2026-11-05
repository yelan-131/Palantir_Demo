import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Flex, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import api from '@/services/api';
import type { PageState } from './model';

interface PageSummary {
  code: string;
  title: string;
  publishedVersion: number;
}

export default function PageDesignWorkspace() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [form] = Form.useForm<{title: string}>();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const createLock = useRef(false);
  const newRequested = params.get('new') === '1';

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await api.get<{items: PageSummary[]}>('/pages', { signal });
      if (!signal?.aborted) setPages(data.items);
    } catch {
      if (!signal?.aborted) setLoadError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const closeNew = () => {
    if (createLock.current) return;
    setNewOpen(false);
    setCreateError(false);
    form.resetFields();
    if (newRequested) {
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  };

  const create = async ({ title }: {title: string}) => {
    if (createLock.current) return;
    createLock.current = true;
    setCreating(true);
    setCreateError(false);
    try {
      const { data } = await api.post<PageState>('/pages', { title: title.trim() });
      navigate(`/pages/${encodeURIComponent(data.code)}?edit=1`, { replace: newRequested });
    } catch {
      setCreateError(true);
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" gap={12} wrap>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 4 }}>页面设计</Typography.Title>
          <Typography.Text type="secondary">组合列表、筛选、指标和图表，为每个组件绑定业务数据。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>新建页面</Button>
      </Flex>
      <Card>
        {loadError && <Alert type="error" showIcon message="页面列表加载失败"
          action={<Button size="small" onClick={() => void load()}>重试</Button>} />}
        <Table<PageSummary>
          rowKey="code"
          size="small"
          loading={loading}
          dataSource={pages}
          locale={{ emptyText: loadError ? '无法读取页面' : '暂无页面，可新建页面并添加组件' }}
          pagination={pages.length > 12 ? { pageSize: 12, showSizeChanger: false } : false}
          columns={[
            { title: '页面名称', dataIndex: 'title' },
            { title: '状态', key: 'status', width: 120, render: (_, page) =>
              page.publishedVersion ? <Tag color="success">已发布 · v{page.publishedVersion}</Tag> : <Tag>草稿</Tag> },
            { title: '操作', key: 'actions', width: 180, render: (_, page) => {
              const path = `/pages/${encodeURIComponent(page.code)}`;
              return <Space size={12}>
                <Link to={`${path}?edit=1`}><EditOutlined /> 编辑页面</Link>
                {page.publishedVersion > 0 && <Link to={path}>查看页面</Link>}
              </Space>;
            } },
          ]}
        />
      </Card>
      <Modal title="新建页面" open={newOpen || newRequested} forceRender
        okText="创建并设计" cancelText="取消" confirmLoading={creating}
        closable={!creating} maskClosable={!creating} keyboard={!creating}
        cancelButtonProps={{ disabled: creating }} onCancel={closeNew} onOk={() => form.submit()}>
        {createError && <Alert type="error" showIcon message="页面创建失败，请重试" />}
        <Form form={form} layout="vertical" disabled={creating} onFinish={create}>
          <Form.Item name="title" label="页面名称" rules={[{ required: true, whitespace: true, message: '请输入页面名称' }]}>
            <Input maxLength={100} placeholder="例如：申请处理" />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
