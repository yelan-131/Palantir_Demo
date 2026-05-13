import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Button, Modal, Input, Select, Tag, Empty,
  Space, Spin, message, Dropdown, Typography, Popconfirm,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  CopyOutlined, MoreOutlined, FolderOutlined,
} from '@ant-design/icons';
import {
  listReports, getReport, createReport, updateReport,
  deleteReport, createSnapshot, listSnapshots,
} from '@/services/api';
import PageDesigner from './PageDesigner';

const CATEGORY_MAP: Record<string, { label: string; color: string }> = {
  production: { label: '生产', color: '#1677ff' },
  maintenance: { label: '维护', color: '#faad14' },
  quality: { label: '质量', color: '#52c41a' },
  supply_chain: { label: '供应链', color: '#722ed1' },
  general: { label: '通用', color: '#8c8c8c' },
};

interface ReportItem {
  id: number;
  name: string;
  description: string;
  config: any;
  category: string;
  is_published: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

type ViewMode = 'list' | 'edit' | 'preview';

export default function ReportCenter() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('list');
  const [currentReport, setCurrentReport] = useState<ReportItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (categoryFilter) params.category = categoryFilter;
      const res = await listReports(params);
      setReports(res.data?.data || []);
    } catch {
      message.error('加载报表列表失败');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const handleCreate = () => {
    Modal.confirm({
      title: '新建报表',
      content: (
        <div>
          <Input id="report-name" placeholder="报表名称" style={{ marginBottom: 8 }} />
          <Select id="report-category" placeholder="分类" style={{ width: '100%' }}
            options={Object.entries(CATEGORY_MAP).map(([k, v]) => ({ label: v.label, value: k }))}
          />
        </div>
      ),
      onOk: async () => {
        const nameEl = document.getElementById('report-name') as HTMLInputElement;
        const catEl = document.getElementById('report-category') as any;
        const name = nameEl?.value?.trim();
        if (!name) { message.warning('请输入报表名称'); return; }
        try {
          const res = await createReport({
            name,
            category: catEl?.value || 'general',
            config: { canvas: { gridSize: 8 }, widgets: [], filters: [] },
          });
          const newReport = res.data;
          setCurrentReport(newReport);
          setView('edit');
          message.success('报表已创建');
        } catch { message.error('创建失败'); }
      },
    });
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteReport(id);
      message.success('已删除');
      fetchReports();
    } catch { message.error('删除失败'); }
  };

  const handleSave = async (config: any) => {
    if (!currentReport) return;
    try {
      await updateReport(currentReport.id, { config });
      await createSnapshot(currentReport.id);
      message.success('已保存');
      fetchReports();
    } catch { message.error('保存失败'); }
  };

  const handleBack = () => {
    setView('list');
    setCurrentReport(null);
    fetchReports();
  };

  if (view === 'edit' && currentReport) {
    return (
      <PageDesigner
        report={currentReport}
        onSave={handleSave}
        onBack={handleBack}
      />
    );
  }

  if (view === 'preview' && currentReport) {
    return (
      <PageDesigner
        report={currentReport}
        onSave={handleSave}
        onBack={handleBack}
        readOnly
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>报表中心</Typography.Title>
          <Select
            allowClear
            placeholder="按分类筛选"
            style={{ width: 140 }}
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={Object.entries(CATEGORY_MAP).map(([k, v]) => ({ label: v.label, value: k }))}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建报表
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : reports.length === 0 ? (
        <Empty description="暂无报表，点击右上角创建" />
      ) : (
        <Row gutter={[16, 16]}>
          {reports.map((r) => {
            const cat = CATEGORY_MAP[r.category] || CATEGORY_MAP.general;
            const widgetCount = r.config?.widgets?.length || 0;
            return (
              <Col key={r.id} xs={24} sm={12} md={8} lg={6}>
                <Card
                  hoverable
                  style={{ height: '100%' }}
                  actions={[
                    <EyeOutlined key="preview" onClick={() => { setCurrentReport(r); setView('preview'); }} />,
                    <EditOutlined key="edit" onClick={() => { setCurrentReport(r); setView('edit'); }} />,
                    <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
                      <DeleteOutlined key="delete" />
                    </Popconfirm>,
                  ]}
                >
                  <Card.Meta
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        {r.is_published && <Tag color="green" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>已发布</Tag>}
                      </div>
                    }
                    description={
                      <div>
                        <div style={{ marginBottom: 4, color: '#666', minHeight: 20 }}>
                          {r.description || '暂无描述'}
                        </div>
                        <Space size={4}>
                          <Tag color={cat.color}>{cat.label}</Tag>
                          <span style={{ fontSize: 12, color: '#999' }}>{widgetCount} 个组件</span>
                        </Space>
                      </div>
                    }
                  />
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
}
