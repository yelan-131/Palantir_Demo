import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, Select, Switch, InputNumber,
  Tag, Popconfirm, Card, Typography, message, Tooltip,
} from 'antd';
import {
  PlusOutlined, ImportOutlined, DeleteOutlined, EditOutlined,
} from '@ant-design/icons';
import {
  listModels, createModel, deleteModel, addField,
  importFromOntology, updateModel,
} from '@/services/api';

const FIELD_TYPES = [
  { label: '字符串', value: 'string' },
  { label: '整数', value: 'int' },
  { label: '浮点数', value: 'float' },
  { label: '枚举', value: 'enum' },
  { label: '日期', value: 'date' },
  { label: '布尔', value: 'boolean' },
  { label: '文本', value: 'text' },
];

interface MetaModel {
  id: number;
  name: string;
  label: string;
  icon: string;
  table_name: string;
  description: string;
  is_system: boolean;
  fields: MetaField[];
}

interface MetaField {
  id: number;
  field_name: string;
  label: string;
  field_type: string;
  required: boolean;
  searchable: boolean;
  sortable: boolean;
  visible_in_list: boolean;
  visible_in_form: boolean;
  enum_values?: string;
  sort_order: number;
}

export default function ModelDesigner() {
  const [fieldForm] = Form.useForm();
  const [models, setModels] = useState<MetaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listModels();
      setModels(res.data?.data || []);
    } catch { message.error('加载模型失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const handleImport = async () => {
    try {
      const res = await importFromOntology();
      message.success(`已导入 ${res.data?.count || 0} 个模型`);
      fetchModels();
    } catch { message.error('导入失败'); }
  };

  const handleCreate = () => {
    Modal.confirm({
      title: '新建模型',
      content: (
        <Form layout="vertical" size="small" style={{ marginTop: 16 }}>
          <Form.Item label="模型名称(英文)"><Input id="m-name" placeholder="如 equipment" /></Form.Item>
          <Form.Item label="显示名称"><Input id="m-label" placeholder="如 设备" /></Form.Item>
          <Form.Item label="图标"><Input id="m-icon" placeholder="如 ToolOutlined" /></Form.Item>
          <Form.Item label="表名"><Input id="m-table" placeholder="如 equipment" /></Form.Item>
          <Form.Item label="描述"><Input id="m-desc" placeholder="描述" /></Form.Item>
        </Form>
      ),
      onOk: async () => {
        const name = (document.getElementById('m-name') as HTMLInputElement)?.value?.trim();
        const label = (document.getElementById('m-label') as HTMLInputElement)?.value?.trim();
        const icon = (document.getElementById('m-icon') as HTMLInputElement)?.value?.trim();
        const table = (document.getElementById('m-table') as HTMLInputElement)?.value?.trim();
        const desc = (document.getElementById('m-desc') as HTMLInputElement)?.value?.trim();
        if (!name || !label) { message.warning('名称必填'); return; }
        try {
          await createModel({ name, label, icon, table_name: table || name, description: desc });
          message.success('创建成功');
          fetchModels();
        } catch { message.error('创建失败'); }
      },
    });
  };

  const handleAddField = (modelId: number) => {
    fieldForm.resetFields();
    Modal.confirm({
      title: '添加字段',
      content: (
        <Form form={fieldForm} layout="vertical" size="small" initialValues={{ field_type: 'string', searchable: true, sort_order: 0 }} style={{ marginTop: 16 }}>
          <Form.Item name="field_name" label="字段名" rules={[{ required: true, whitespace: true }]}><Input id="f-name" placeholder="如 status" /></Form.Item>
          <Form.Item name="label" label="显示名" rules={[{ required: true, whitespace: true }]}><Input id="f-label" placeholder="如 状态" /></Form.Item>
          <Form.Item name="field_type" label="类型">
            <Select id="f-type" options={FIELD_TYPES} />
          </Form.Item>
          <Form.Item name="required" label="必填" valuePropName="checked"><Switch id="f-required" /></Form.Item>
          <Form.Item name="searchable" label="可搜索" valuePropName="checked"><Switch id="f-searchable" /></Form.Item>
          <Form.Item name="sortable" label="可排序" valuePropName="checked"><Switch id="f-sortable" /></Form.Item>
          <Form.Item name="enum_values" label="枚举值(JSON)"><Input id="f-enum" placeholder='如 ["a","b"]' /></Form.Item>
          <Form.Item name="sort_order" label="排序"><InputNumber id="f-sort" min={0} /></Form.Item>
        </Form>
      ),
      onOk: async () => {
        const values = await fieldForm.validateFields();
        try {
          await addField(modelId, values);
          message.success('字段已添加');
          fetchModels();
        } catch { message.error('添加失败'); }
      },
    });
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '显示名', dataIndex: 'label', width: 100 },
    { title: '表名', dataIndex: 'table_name', width: 140 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '字段数', width: 80,
      render: (_: any, r: MetaModel) => <Tag color="blue">{r.fields?.length || 0}</Tag>,
    },
    {
      title: '系统', dataIndex: 'is_system', width: 60,
      render: (v: boolean) => v ? <Tag color="orange">系统</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '操作', width: 140,
      render: (_: any, r: MetaModel) => (
        <Space size={4}>
          <Tooltip title="添加字段">
            <Button size="small" icon={<PlusOutlined />} onClick={() => handleAddField(r.id)} />
          </Tooltip>
          {!r.is_system && (
            <Popconfirm title="确定删除？" onConfirm={async () => { await deleteModel(r.id); fetchModels(); }}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const fieldColumns = [
    { title: '字段名', dataIndex: 'field_name', width: 120 },
    { title: '显示名', dataIndex: 'label', width: 100 },
    { title: '类型', dataIndex: 'field_type', width: 80, render: (v: string) => <Tag>{v}</Tag> },
    { title: '必填', dataIndex: 'required', width: 50, render: (v: boolean) => v ? '是' : '' },
    { title: '搜索', dataIndex: 'searchable', width: 50, render: (v: boolean) => v ? '是' : '' },
    { title: '排序', dataIndex: 'sortable', width: 50, render: (v: boolean) => v ? '是' : '' },
    { title: '列表', dataIndex: 'visible_in_list', width: 50, render: (v: boolean) => v ? '是' : '' },
    { title: '表单', dataIndex: 'visible_in_form', width: 50, render: (v: boolean) => v ? '是' : '' },
    { title: '序号', dataIndex: 'sort_order', width: 50 },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>元模型管理</Typography.Title>
        <Space>
          <Button icon={<ImportOutlined />} onClick={handleImport}>从本体导入</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建模型</Button>
        </Space>
      </div>

      <Table
        dataSource={models}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as number[]),
          expandedRowRender: (record: MetaModel) => (
            <Table
              dataSource={record.fields || []}
              columns={fieldColumns}
              rowKey="id"
              size="small"
              pagination={false}
              style={{ marginLeft: 48 }}
            />
          ),
        }}
        pagination={{ pageSize: 20 }}
      />
    </div>
  );
}
