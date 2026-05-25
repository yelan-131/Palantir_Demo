import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  adminCreateOrgUnit,
  adminDeleteOrgUnit,
  adminListOrgUnits,
  adminUpdateOrgUnit,
} from '@/services/api';

interface OrgUnitItem {
  id: number;
  parent_id?: number | null;
  code: string;
  name: string;
  org_type: string;
  sort_order: number;
  status: string;
  description?: string;
  member_count?: number;
}

const ORG_TYPES = [
  { label: '集团', value: 'company' },
  { label: '工厂', value: 'factory' },
  { label: '部门', value: 'department' },
  { label: '班组', value: 'team' },
];

export default function OrganizationManagement() {
  const [orgUnits, setOrgUnits] = useState<OrgUnitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgUnitItem | null>(null);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListOrgUnits();
      setOrgUnits(res.data?.data || []);
    } catch {
      message.error('加载组织失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const parentOptions = useMemo(
    () => orgUnits
      .filter((org) => org.id !== editingOrg?.id)
      .map((org) => ({ label: org.name, value: org.id })),
    [editingOrg?.id, orgUnits],
  );

  const openCreate = () => {
    setEditingOrg(null);
    form.resetFields();
    form.setFieldsValue({ org_type: 'department', status: 'active', sort_order: 100 });
    setModalOpen(true);
  };

  const openEdit = (record: OrgUnitItem) => {
    setEditingOrg(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const submitOrg = async () => {
    const values = await form.validateFields();
    try {
      if (editingOrg) {
        await adminUpdateOrgUnit(editingOrg.id, values);
        message.success('组织已更新');
      } else {
        await adminCreateOrgUnit(values);
        message.success('组织已创建');
      }
      setModalOpen(false);
      fetchData();
    } catch {
      message.error(editingOrg ? '更新组织失败' : '创建组织失败');
    }
  };

  const columns = [
    { title: '组织名称', dataIndex: 'name', width: 180 },
    { title: '编码', dataIndex: 'code', width: 150 },
    {
      title: '类型',
      dataIndex: 'org_type',
      width: 100,
      render: (value: string) => <Tag>{ORG_TYPES.find((item) => item.value === value)?.label || value}</Tag>,
    },
    {
      title: '上级组织',
      dataIndex: 'parent_id',
      width: 160,
      render: (value?: number) => orgUnits.find((org) => org.id === value)?.name || '-',
    },
    { title: '成员数', dataIndex: 'member_count', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: string) => (value === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, record: OrgUnitItem) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="确定删除该组织？" onConfirm={async () => { await adminDeleteOrgUnit(record.id); fetchData(); }}>
            <Button size="small" danger icon={<DeleteOutlined />} disabled={(record.member_count || 0) > 0} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>组织管理</Typography.Title>
          <Typography.Text type="secondary">组织用于表达工厂、部门、班组等数据范围来源，用户在用户管理中归属到这里。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建组织</Button>
      </div>

      <Table dataSource={orgUnits} columns={columns} rowKey="id" loading={loading} size="small" />

      <Modal
        title={editingOrg ? '编辑组织' : '新建组织'}
        open={modalOpen}
        onOk={submitOrg}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="组织名称" name="name" rules={[{ required: true, message: '请输入组织名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="组织编码" name="code" rules={[{ required: true, message: '请输入组织编码' }]}>
            <Input placeholder="production" />
          </Form.Item>
          <Form.Item label="上级组织" name="parent_id">
            <Select allowClear options={parentOptions} />
          </Form.Item>
          <Form.Item label="组织类型" name="org_type">
            <Select options={ORG_TYPES} />
          </Form.Item>
          <Form.Item label="排序" name="sort_order">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select options={[{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }]} />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
