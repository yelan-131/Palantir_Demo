import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Switch, Tag, Popconfirm,
  Typography, message,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { listMenus, createMenu, updateMenu, deleteMenu } from '@/services/api';

interface MenuItem {
  id: number;
  parent_id: number | null;
  title: string;
  icon: string;
  route_path: string;
  sort_order: number;
  is_visible: boolean;
  children?: MenuItem[];
}

export default function MenuManager() {
  const [form] = Form.useForm();
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMenus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMenus();
      const flat = res.data?.data || [];
      // Build tree
      const map = new Map<number, MenuItem>();
      const roots: MenuItem[] = [];
      for (const item of flat) {
        map.set(item.id, { ...item, children: [] });
      }
      for (const item of flat) {
        const node = map.get(item.id)!;
        if (item.parent_id && map.has(item.parent_id)) {
          map.get(item.parent_id)!.children!.push(node);
        } else {
          roots.push(node);
        }
      }
      setMenus(roots);
    } catch { message.error('加载菜单失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMenus(); }, [fetchMenus]);

  const handleCreate = (parentId?: number) => {
    form.resetFields();
    Modal.confirm({
      title: parentId ? '新建子菜单' : '新建菜单',
      content: (
        <Form form={form} layout="vertical" size="small" initialValues={{ sort_order: 0, is_visible: true }} style={{ marginTop: 16 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true }]}><Input id="mi-title" placeholder="菜单标题" /></Form.Item>
          <Form.Item name="icon" label="图标"><Input id="mi-icon" placeholder="如 ToolOutlined" /></Form.Item>
          <Form.Item name="route_path" label="路由"><Input id="mi-route" placeholder="如 /dynamic/equipment-list" /></Form.Item>
          <Form.Item name="sort_order" label="排序"><InputNumber id="mi-sort" min={0} /></Form.Item>
          <Form.Item name="is_visible" label="可见" valuePropName="checked"><Switch id="mi-visible" /></Form.Item>
        </Form>
      ),
      onOk: async () => {
        const values = await form.validateFields();
        try {
          await createMenu({ ...values, parent_id: parentId || null });
          message.success('创建成功');
          fetchMenus();
        } catch { message.error('创建失败'); }
      },
    });
  };

  const columns = [
    { title: '标题', dataIndex: 'title', width: 160 },
    { title: '图标', dataIndex: 'icon', width: 120 },
    {
      title: '路由', dataIndex: 'route_path', width: 200,
      render: (v: string) => v ? <Tag>{v}</Tag> : <span style={{ color: 'var(--mf-faint)' }}>目录</span>,
    },
    { title: '排序', dataIndex: 'sort_order', width: 70 },
    {
      title: '可见', dataIndex: 'is_visible', width: 60,
      render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: '操作', width: 140,
      render: (_: any, r: MenuItem) => (
        <Space size={4}>
          <Button size="small" icon={<PlusOutlined />} onClick={() => handleCreate(r.id)}>子菜单</Button>
          <Popconfirm title="确定删除？" onConfirm={async () => { await deleteMenu(r.id); fetchMenus(); }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>动态菜单管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleCreate()}>新建菜单</Button>
      </div>

      <Table
        dataSource={menus}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        expandable={{ childrenColumnName: 'children' }}
      />
    </div>
  );
}
