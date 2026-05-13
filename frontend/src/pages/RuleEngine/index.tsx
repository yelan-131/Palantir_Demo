import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, InputNumber,
  Switch, Tag, Space, Empty, Spin, message, Typography, Popconfirm,
} from 'antd';
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { listRules, createRule, updateRule, deleteRule, validateRule } from '@/services/api';
import { listModels } from '@/services/api';

const RULE_TYPE_MAP: Record<string, { label: string; color: string }> = {
  validation: { label: '校验规则', color: '#1677ff' },
  trigger: { label: '触发规则', color: '#722ed1' },
};

const OPERATOR_OPTIONS = [
  { label: '必填 (required)', value: 'required' },
  { label: '最小值 (min)', value: 'min' },
  { label: '最大值 (max)', value: 'max' },
  { label: '最小长度 (min_length)', value: 'min_length' },
  { label: '最大长度 (max_length)', value: 'max_length' },
  { label: '正则匹配 (regex)', value: 'regex' },
  { label: '唯一 (unique)', value: 'unique' },
];

const ACTION_OPTIONS = [
  { label: '创建记录', value: 'create_record' },
  { label: '更新记录', value: 'update_record' },
  { label: '记录日志', value: 'log_event' },
];

interface RuleItem {
  id: number;
  model_id: number;
  name: string;
  rule_type: string;
  field_name: string;
  condition: Record<string, any>;
  action: Record<string, any>;
  message: string;
  is_active: boolean;
  priority: number;
}

interface ModelItem {
  id: number;
  name: string;
  display_name: string;
}

export default function RuleEngine() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleItem | null>(null);
  const [form] = Form.useForm();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (selectedModelId) params.model_id = selectedModelId;
      const res = await listRules(params);
      setRules(res.data?.data || res.data || []);
    } catch {
      message.error('加载规则列表失败');
    } finally {
      setLoading(false);
    }
  }, [selectedModelId]);

  const fetchModels = useCallback(async () => {
    try {
      const res = await listModels();
      setModels(res.data?.data || res.data || []);
    } catch {
      // Models may not be available
    }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);
  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleCreate = () => {
    setEditingRule(null);
    form.resetFields();
    form.setFieldsValue({ rule_type: 'validation', is_active: true, priority: 10 });
    setModalVisible(true);
  };

  const handleEdit = (rule: RuleItem) => {
    setEditingRule(rule);
    form.setFieldsValue({
      name: rule.name,
      model_id: rule.model_id,
      rule_type: rule.rule_type,
      field_name: rule.field_name,
      condition: rule.condition ? JSON.stringify(rule.condition, null, 2) : '',
      action: rule.action ? JSON.stringify(rule.action, null, 2) : '',
      message: rule.message,
      is_active: rule.is_active,
      priority: rule.priority,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        condition: values.condition ? JSON.parse(values.condition) : {},
        action: values.action ? JSON.parse(values.action) : {},
      };

      if (editingRule) {
        await updateRule(editingRule.id, payload);
        message.success('规则已更新');
      } else {
        await createRule(payload);
        message.success('规则已创建');
      }
      setModalVisible(false);
      fetchRules();
    } catch (err: any) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail);
      }
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteRule(id);
      message.success('规则已删除');
      fetchRules();
    } catch {
      message.error('删除失败');
    }
  };

  const handleToggleActive = async (rule: RuleItem) => {
    try {
      await updateRule(rule.id, { is_active: !rule.is_active });
      fetchRules();
    } catch {
      message.error('状态切换失败');
    }
  };

  const handleValidate = async (id: number) => {
    try {
      await validateRule(id);
      message.success('规则验证通过');
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '验证失败');
    }
  };

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'rule_type',
      key: 'rule_type',
      width: 100,
      render: (type: string) => {
        const cfg = RULE_TYPE_MAP[type] || { label: type, color: '#8c8c8c' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '字段',
      dataIndex: 'field_name',
      key: 'field_name',
      width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: '提示信息',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      sorter: (a: RuleItem, b: RuleItem) => a.priority - b.priority,
    },
    {
      title: '启用',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (active: boolean, record: RuleItem) => (
        <Switch checked={active} size="small" onChange={() => handleToggleActive(record)} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: any, record: RuleItem) => (
        <Space size={4}>
          <Button size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Button size="small" onClick={() => handleValidate(record.id)}>验证</Button>
          <Popconfirm title="确定删除此规则？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <ThunderboltOutlined style={{ marginRight: 8, color: '#722ed1' }} />
            规则引擎
          </Typography.Title>
          <Select
            allowClear
            placeholder="按模型筛选"
            style={{ width: 180 }}
            value={selectedModelId}
            onChange={setSelectedModelId}
            options={models.map((m) => ({
              label: m.display_name || m.name,
              value: m.id,
            }))}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建规则
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : rules.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={selectedModelId ? '该模型暂无规则' : '暂无规则，点击右上角创建'}
        />
      ) : (
        <Table
          dataSource={rules}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 15, showSizeChanger: false }}
        />
      )}

      <Modal
        title={editingRule ? '编辑规则' : '新建规则'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
        okText="保存"
        styles={{ body: { paddingTop: 16 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如：设备名称必填" />
          </Form.Item>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="model_id" label="所属模型" rules={[{ required: true }]} style={{ width: 260 }}>
              <Select
                placeholder="选择模型"
                options={models.map((m) => ({
                  label: m.display_name || m.name,
                  value: m.id,
                }))}
              />
            </Form.Item>
            <Form.Item name="rule_type" label="规则类型" rules={[{ required: true }]} style={{ width: 260 }}>
              <Select
                options={Object.entries(RULE_TYPE_MAP).map(([k, v]) => ({
                  label: v.label,
                  value: k,
                }))}
              />
            </Form.Item>
          </Space>
          <Form.Item name="field_name" label="目标字段">
            <Input placeholder="例如：name, status, quantity" />
          </Form.Item>
          <Form.Item
            name="condition"
            label="条件 (JSON)"
            extra="校验规则: {&quot;operator&quot;: &quot;required&quot;} 或 {&quot;operator&quot;: &quot;min&quot;, &quot;value&quot;: 0}"
          >
            <Input.TextArea rows={3} placeholder='{"operator": "required"}' />
          </Form.Item>
          <Form.Item
            name="action"
            label="动作 (JSON)"
            extra="触发规则: {&quot;type&quot;: &quot;log_event&quot;, &quot;template&quot;: &quot;字段变更&quot;}"
          >
            <Input.TextArea rows={3} placeholder='{"type": "log_event", "template": "值已变更"}' />
          </Form.Item>
          <Form.Item name="message" label="提示信息">
            <Input placeholder="规则不满足时的提示消息" />
          </Form.Item>
          <Space>
            <Form.Item name="priority" label="优先级" initialValue={10}>
              <InputNumber min={0} max={1000} />
            </Form.Item>
            <Form.Item name="is_active" label="启用" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
