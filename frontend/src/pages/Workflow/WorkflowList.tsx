import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, Select, Tag, Popconfirm,
  Typography, message, Card, Descriptions,
} from 'antd';
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined, EyeOutlined } from '@ant-design/icons';
import { wfListDefinitions, wfCreateDefinition, wfUpdateDefinition, wfDeleteDefinition, wfStartInstance } from '@/services/api';

interface WfDef {
  id: number;
  name: string;
  description: string;
  config: any;
  form_config: any;
  status: string;
  version: number;
}

export default function WorkflowList() {
  const [defs, setDefs] = useState<WfDef[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wfListDefinitions();
      setDefs(res.data?.data || []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleViewFlow = (def: WfDef) => {
    const nodes = def.config?.nodes || [];
    const edges = def.config?.edges || [];
    Modal.info({
      title: `${def.name} — 流程图`,
      width: 700,
      content: (
        <div style={{ marginTop: 16 }}>
          <div style={{
            position: 'relative', minHeight: 200,
            background: 'var(--mf-panel-soft)', borderRadius: 8, padding: 20, border: '1px solid #e8e8e8',
          }}>
            {nodes.map((node: any) => {
              const colors: Record<string, string> = {
                start: '#52c41a', approval: '#1677ff', end: '#8c8c8c', condition: '#faad14',
              };
              return (
                <div key={node.id} style={{
                  position: 'absolute', left: node.position?.x || 0, top: node.position?.y || 0,
                  padding: '8px 16px', borderRadius: 6, color: '#fff', fontSize: 12,
                  background: colors[node.type] || '#1677ff', whiteSpace: 'nowrap',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}>
                  {node.data?.label || node.id}
                </div>
              );
            })}
            {edges.map((edge: any) => (
              <div key={edge.id} style={{ position: 'absolute', left: 0, top: 0, fontSize: 10, color: '#999' }}>
                {edge.label ? `${edge.source} → ${edge.target} (${edge.label})` : ''}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <strong>表单字段：</strong>
            {(def.form_config?.fields || []).map((f: any, i: number) => (
              <Tag key={i} style={{ margin: 2 }}>{f.label} ({f.type})</Tag>
            ))}
          </div>
        </div>
      ),
    });
  };

  const handleStart = (def: WfDef) => {
    const fields = def.form_config?.fields || [];
    Modal.confirm({
      title: `发起 — ${def.name}`,
      width: 500,
      content: (
        <Form layout="vertical" size="small" style={{ marginTop: 16 }}>
          <Form.Item label="申请标题"><Input id="wf-title" placeholder="标题" /></Form.Item>
          {fields.map((f: any) => (
            <Form.Item key={f.name} label={f.label}>
              {f.type === 'enum' ? (
                <Select id={`wf-${f.name}`} options={(f.options || []).map((o: string) => ({ label: o, value: o }))} />
              ) : f.type === 'text' ? (
                <Input.TextArea id={`wf-${f.name}`} rows={2} />
              ) : (
                <Input id={`wf-${f.name}`} />
              )}
            </Form.Item>
          ))}
        </Form>
      ),
      onOk: async () => {
        const title = (document.getElementById('wf-title') as HTMLInputElement)?.value?.trim();
        if (!title) { message.warning('请输入标题'); return; }
        const form_data: Record<string, any> = {};
        for (const f of fields) {
          const el = document.getElementById(`wf-${f.name}`) as any;
          if (el) form_data[f.name] = el.value;
        }
        try {
          await wfStartInstance(def.id, { title, form_data });
          message.success('申请已提交');
        } catch { message.error('提交失败'); }
      },
    });
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => v === 'published' ? <Tag color="green">已发布</Tag> : <Tag>草稿</Tag>,
    },
    { title: '版本', dataIndex: 'version', width: 60 },
    {
      title: '操作', width: 200,
      render: (_: any, r: WfDef) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewFlow(r)}>查看流程</Button>
          <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={() => handleStart(r)}>发起</Button>
          <Popconfirm title="确定删除？" onConfirm={async () => { await wfDeleteDefinition(r.id); fetchData(); }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>工作流管理</Typography.Title>
      </div>
      <Table dataSource={defs} columns={columns} rowKey="id" loading={loading} size="small" />
    </div>
  );
}
