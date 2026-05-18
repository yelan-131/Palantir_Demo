import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Button, Modal, Tag, Empty, Spin, message,
  Space, Typography, Input, Tabs,
} from 'antd';
import {
  AppstoreOutlined, CheckCircleOutlined, EyeOutlined,
  ShopOutlined, ThunderboltOutlined, SafetyCertificateOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { listTemplates, instantiateTemplate, getTemplate } from '@/services/api';

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  production: { label: '生产管理', color: '#1677ff', icon: <AppstoreOutlined /> },
  quality: { label: '质量管理', color: '#52c41a', icon: <SafetyCertificateOutlined /> },
  maintenance: { label: '设备管理', color: '#faad14', icon: <ToolOutlined /> },
  supply_chain: { label: '供应链', color: '#722ed1', icon: <ShopOutlined /> },
  general: { label: '通用', color: '#8c8c8c', icon: <ThunderboltOutlined /> },
};

interface TemplateItem {
  id: number;
  name: string;
  description: string;
  category: string;
  config: {
    models?: any[];
    pages?: any[];
    rules?: any[];
    menus?: any[];
  };
  is_public: boolean;
  created_at: string;
}

export default function TemplateMarket() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [instantiating, setInstantiating] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTemplates();
      setTemplates(res.data?.data || res.data || []);
    } catch {
      message.error('加载模板列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const filteredTemplates = activeCategory === 'all'
    ? templates
    : templates.filter((t) => t.category === activeCategory);

  const handleViewDetail = async (tpl: TemplateItem) => {
    try {
      const res = await getTemplate(tpl.id);
      setSelectedTemplate(res.data?.data || res.data || tpl);
      setDetailVisible(true);
    } catch {
      setSelectedTemplate(tpl);
      setDetailVisible(true);
    }
  };

  const handleInstantiate = async (tpl: TemplateItem) => {
    setInstantiating(true);
    try {
      await instantiateTemplate(tpl.id);
      message.success(`模板「${tpl.name}」已成功应用`);
      setDetailVisible(false);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '应用模板失败';
      message.error(msg);
    } finally {
      setInstantiating(false);
    }
  };

  const categoryTabs = [
    { key: 'all', label: '全部' },
    ...Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({ key: k, label: v.label })),
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="加载模板中..." />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>模板市场</Typography.Title>
          <Tag color="blue">{templates.length} 个模板</Tag>
        </Space>
      </div>

      <Tabs
        activeKey={activeCategory}
        onChange={setActiveCategory}
        items={categoryTabs}
        style={{ marginBottom: 16 }}
      />

      {filteredTemplates.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            activeCategory === 'all'
              ? '暂无模板，等待系统管理员添加'
              : `暂无「${CATEGORY_CONFIG[activeCategory]?.label || activeCategory}」类模板`
          }
        />
      ) : (
        <Row gutter={[16, 16]}>
          {filteredTemplates.map((tpl) => {
            const cat = CATEGORY_CONFIG[tpl.category] || CATEGORY_CONFIG.general;
            const modelCount = tpl.config?.models?.length || 0;
            const pageCount = tpl.config?.pages?.length || 0;
            const ruleCount = tpl.config?.rules?.length || 0;

            return (
              <Col key={tpl.id} xs={24} sm={12} md={8} lg={6}>
                <Card
                  hoverable
                  style={{ height: '100%' }}
                  actions={[
                    <EyeOutlined key="view" onClick={() => handleViewDetail(tpl)} />,
                    <CheckCircleOutlined key="use" onClick={() => handleInstantiate(tpl)} />,
                  ]}
                >
                  <Card.Meta
                    avatar={
                      <div style={{
                        width: 40, height: 40, borderRadius: 8, background: `${cat.color}15`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: cat.color, fontSize: 20,
                      }}>
                        {cat.icon}
                      </div>
                    }
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tpl.name}
                        </span>
                      </div>
                    }
                    description={
                      <div>
                        <div style={{ marginBottom: 8, color: '#666', minHeight: 20 }}>
                          {tpl.description || '暂无描述'}
                        </div>
                        <Space size={4} wrap>
                          <Tag color={cat.color}>{cat.label}</Tag>
                          {modelCount > 0 && <Tag>模型 ×{modelCount}</Tag>}
                          {pageCount > 0 && <Tag>页面 ×{pageCount}</Tag>}
                          {ruleCount > 0 && <Tag>规则 ×{ruleCount}</Tag>}
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

      <Modal
        title={selectedTemplate?.name || '模板详情'}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailVisible(false)}>关闭</Button>,
          <Button key="use" type="primary" icon={<CheckCircleOutlined />}
            loading={instantiating}
            onClick={() => selectedTemplate && handleInstantiate(selectedTemplate)}>
            使用此模板
          </Button>,
        ]}
        width={600}
      >
        {selectedTemplate && (
          <div>
            <p style={{ color: '#666' }}>{selectedTemplate.description}</p>
            <div style={{ marginBottom: 16 }}>
              <Tag color={CATEGORY_CONFIG[selectedTemplate.category]?.color}>
                {CATEGORY_CONFIG[selectedTemplate.category]?.label || selectedTemplate.category}
              </Tag>
            </div>
            <Typography.Text strong>包含内容：</Typography.Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              {(selectedTemplate.config?.models?.length || 0) > 0 && (
                <li>数据模型 {selectedTemplate.config?.models?.length ?? 0} 个</li>
              )}
              {(selectedTemplate.config?.pages?.length || 0) > 0 && (
                <li>业务页面 {selectedTemplate.config?.pages?.length ?? 0} 个</li>
              )}
              {(selectedTemplate.config?.rules?.length || 0) > 0 && (
                <li>业务规则 {selectedTemplate.config?.rules?.length ?? 0} 个</li>
              )}
              {(selectedTemplate.config?.menus?.length || 0) > 0 && (
                <li>菜单项 {selectedTemplate.config?.menus?.length ?? 0} 个</li>
              )}
            </ul>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              点击「使用此模板」将自动创建对应的模型、页面和规则
            </Typography.Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
