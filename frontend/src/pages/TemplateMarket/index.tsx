import { TECH_WHITE_PALETTE as colors } from '../../theme/techWhite';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Modal, Tag, Empty, Spin, message,
  Space, Typography, Tabs,
} from 'antd';
import {
  AppstoreOutlined, CheckCircleOutlined,
  ShopOutlined, ThunderboltOutlined, SafetyCertificateOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { listTemplates, instantiateTemplate, getTemplate, listApplicationTemplates, instantiateApplicationTemplate } from '@/services/api';
import { shellIcon } from '@/components/ShellNavigation';
import { useAuthStore } from '@/stores/authStore';
import './style.css';

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  production: { label: '生产管理', color: colors.primary, icon: <AppstoreOutlined /> },
  quality: { label: '质量管理', color: colors.success, icon: <SafetyCertificateOutlined /> },
  maintenance: { label: '设备管理', color: colors.warning, icon: <ToolOutlined /> },
  supply_chain: { label: '供应链', color: '#877394', icon: <ShopOutlined /> },
  general: { label: '通用', color: colors.muted, icon: <ThunderboltOutlined /> },
};

const CATEGORY_TABS = [
  { key: 'all', label: '全部' },
  ...Object.entries(CATEGORY_CONFIG).map(([key, { label }]) => ({ key, label })),
];

interface TemplateItem {
  id: number;
  kind?: 'application';
  icon?: string;
  name: string;
  description: string;
  category: string;
  config: {
    models?: any[];
    forms?: number[];
    pages?: any[];
    rules?: any[];
    menus?: any[];
  };
  is_public: boolean;
  created_at: string;
}

const templateKey = (tpl: TemplateItem) => `${tpl.kind ?? 'package'}-${tpl.id}`;

export default function TemplateMarket() {
  const isAdmin = useAuthStore(state => Boolean(state.user?.is_admin));
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [instantiatingKey, setInstantiatingKey] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const [packages, applications] = await Promise.all([listTemplates(), isAdmin ? listApplicationTemplates() : undefined]);
      setTemplates([...(applications?.data.data ?? []), ...(packages.data.data ?? [])]);
    } catch {
      message.error('加载模板列表失败');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const filteredTemplates = activeCategory === 'all'
    ? templates
    : templates.filter((t) => t.category === activeCategory);

  const handleViewDetail = async (tpl: TemplateItem) => {
    if (tpl.kind === 'application') {
      setSelectedTemplate(tpl);
      setDetailVisible(true);
      return;
    }
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
    if (instantiatingKey !== null) return;
    setInstantiatingKey(templateKey(tpl));
    try {
      if (tpl.kind === 'application') {
        const { data } = await instantiateApplicationTemplate(tpl.id);
        window.dispatchEvent(new Event('applications-changed'));
        message.success(`已创建应用草稿「${data.data.name}」`);
      } else {
        const { data } = await instantiateTemplate(tpl.id);
        message.info(data.message);
      }
      setDetailVisible(false);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '应用模板失败';
      message.error(msg);
    } finally {
      setInstantiatingKey(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="加载模板中..." />
      </div>
    );
  }

  return (
    <div className="catalog-page">
      <Tabs
        activeKey={activeCategory}
        onChange={setActiveCategory}
        items={CATEGORY_TABS}
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
        <div className="template-card-grid">
          {filteredTemplates.map((tpl) => {
            const key = templateKey(tpl);
            const cat = CATEGORY_CONFIG[tpl.category] || CATEGORY_CONFIG.general;
            const modelCount = tpl.config?.models?.length || 0;
            const pageCount = tpl.config?.pages?.length || 0;
            const ruleCount = tpl.config?.rules?.length || 0;

            return (
              <Card key={key} className="template-card">
                <div className="template-card-heading">
                  <span className="template-card-icon" aria-hidden="true"
                    style={{ backgroundColor: `${cat.color}15`, color: cat.color }}>
                    {tpl.kind === 'application' ? shellIcon(tpl.icon) : cat.icon}
                  </span>
                  <h2 className="template-card-title">{tpl.name}</h2>
                </div>
                <p className="template-card-description">{tpl.description || '暂无描述'}</p>
                <Space size={4} wrap>
                  <Tag color={cat.color}>{cat.label}</Tag>
                  {tpl.kind === 'application' && <Tag>应用模板</Tag>}
                  {modelCount > 0 && <Tag>模型 ×{modelCount}</Tag>}
                  {pageCount > 0 && <Tag>页面 ×{pageCount}</Tag>}
                  {ruleCount > 0 && <Tag>规则 ×{ruleCount}</Tag>}
                </Space>
                <div className="template-card-actions">
                  <Button onClick={() => handleViewDetail(tpl)}>查看详情</Button>
                  <Button type="primary"
                    loading={instantiatingKey === key}
                    disabled={instantiatingKey !== null && instantiatingKey !== key}
                    onClick={() => handleInstantiate(tpl)}>
                    使用模板
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        title={selectedTemplate?.name || '模板详情'}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailVisible(false)}>关闭</Button>,
          <Button key="use" type="primary" icon={<CheckCircleOutlined />}
            loading={Boolean(selectedTemplate && instantiatingKey === templateKey(selectedTemplate))}
            disabled={instantiatingKey !== null && (!selectedTemplate || instantiatingKey !== templateKey(selectedTemplate))}
            onClick={() => selectedTemplate && handleInstantiate(selectedTemplate)}>
            使用此模板
          </Button>,
        ]}
        width={600}
      >
        {selectedTemplate && (
          <div>
            <p style={{ color: 'var(--mf-muted)' }}>{selectedTemplate.description}</p>
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
              {(selectedTemplate.config?.forms?.length || 0) > 0 && (
                <li>业务表单 {selectedTemplate.config?.forms?.length} 个</li>
              )}
              {(selectedTemplate.config?.rules?.length || 0) > 0 && (
                <li>业务规则 {selectedTemplate.config?.rules?.length ?? 0} 个</li>
              )}
              {(selectedTemplate.config?.menus?.length || 0) > 0 && (
                <li>菜单项 {selectedTemplate.config?.menus?.length ?? 0} 个</li>
              )}
            </ul>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {selectedTemplate.kind === 'application'
                ? '使用模板会创建应用草稿，菜单沿用原有页面和表单。'
                : '行业演示包需要通过其数据初始化入口导入。'}
            </Typography.Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
