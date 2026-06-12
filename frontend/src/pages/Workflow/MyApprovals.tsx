import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Input, Tag, Typography, message,
} from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { wfListInstances, wfApproveOrReject } from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

interface ApprovalItem {
  id: number;
  workflow_id: number;
  title: string;
  initiator_name: string;
  status: string;
  form_data: any;
  approvals: { id: number; node_id: string; approver_id: number; action: string | null; comment: string | null }[];
  created_at: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: 'orange' },
  approved: { label: '已通过', color: 'green' },
  rejected: { label: '已驳回', color: 'red' },
  cancelled: { label: '已撤销', color: 'default' },
};

export default function MyApprovals() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wfListInstances({ status: 'pending' });
      setItems(res.data?.data || []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAction = (inst: ApprovalItem, action: string) => {
    Modal.confirm({
      title: action === 'approve' ? '审批通过' : '驳回申请',
      content: (
        <div style={{ marginTop: 16 }}>
          <p><strong>申请：</strong>{inst.title}</p>
          <p><strong>申请人：</strong>{inst.initiator_name || '用户'}</p>
          <Input.TextArea id="approval-comment" rows={3} placeholder="审批意见（可选）" />
        </div>
      ),
      onOk: async () => {
        const comment = (document.getElementById('approval-comment') as HTMLTextAreaElement)?.value;
        try {
          await wfApproveOrReject(inst.id, { action, comment });
          message.success(action === 'approve' ? '已通过' : '已驳回');
          fetchData();
        } catch { message.error('操作失败'); }
      },
    });
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '申请标题', dataIndex: 'title', width: 200, ellipsis: true },
    { title: '申请人', dataIndex: 'initiator_name', width: 80 },
    {
      title: '表单数据', dataIndex: 'form_data', width: 250, ellipsis: true,
      render: (v: any) => {
        if (!v) return '-';
        const data = typeof v === 'string' ? JSON.parse(v) : v;
        return Object.entries(data).map(([k, val]) => `${k}: ${val}`).join(' | ');
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => { const s = STATUS_MAP[v] || { label: v, color: 'default' }; return <Tag color={s.color}>{s.label}</Tag>; },
    },
    { title: '提交时间', dataIndex: 'created_at', width: 160, render: (value: string) => formatServerDateTime(value) },
    {
      title: '操作', width: 160,
      render: (_: any, r: ApprovalItem) => r.status === 'pending' ? (
        <Space size={4}>
          <Button size="small" type="primary" icon={<CheckOutlined />}
            onClick={() => handleAction(r, 'approve')}>通过</Button>
          <Button size="small" danger icon={<CloseOutlined />}
            onClick={() => handleAction(r, 'reject')}>驳回</Button>
        </Space>
      ) : <Tag>{STATUS_MAP[r.status]?.label || r.status}</Tag>,
    },
  ];

  return (
    <div>
      <Typography.Title level={5} style={{ marginBottom: 16 }}>待我审批</Typography.Title>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" />
    </div>
  );
}
