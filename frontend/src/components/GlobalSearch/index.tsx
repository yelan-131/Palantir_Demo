import React, { useState, useEffect, useRef } from 'react';
import { Modal, Input, List, Typography, Space, Tag } from 'antd';
import {
  DashboardOutlined, ToolOutlined, SafetyCertificateOutlined, ShopOutlined,
  RobotOutlined, BarChartOutlined, AppstoreOutlined, SearchOutlined,
  DatabaseOutlined, ApartmentOutlined, NodeIndexOutlined,
  SettingOutlined, UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface SearchItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  category: string;
}

const SEARCH_ITEMS: SearchItem[] = [
  { key: '/', label: '运营总览', icon: <DashboardOutlined />, category: '业务' },
  { key: '/maintenance', label: '预测性维护', icon: <ToolOutlined />, category: '业务' },
  { key: '/quality', label: '质量管理', icon: <SafetyCertificateOutlined />, category: '业务' },
  { key: '/supply-chain', label: '供应链协同', icon: <ShopOutlined />, category: '业务' },
  { key: '/ai-assistant', label: 'AI 助手', icon: <RobotOutlined />, category: '业务' },
  { key: '/reports', label: '报表中心', icon: <BarChartOutlined />, category: '业务' },
  { key: '/my-applications', label: '我的申请', icon: <AppstoreOutlined />, category: '个人' },
  { key: '/data-sources', label: '数据源管理', icon: <DatabaseOutlined />, category: '管理' },
  { key: '/ontology', label: '本体建模', icon: <ApartmentOutlined />, category: '管理' },
  { key: '/graph', label: '关系图谱', icon: <NodeIndexOutlined />, category: '管理' },
  { key: '/pipeline', label: '数据管线', icon: <AppstoreOutlined />, category: '管理' },
  { key: '/model-driven', label: '模型驱动', icon: <SettingOutlined />, category: '管理' },
  { key: '/system-admin', label: '系统管理', icon: <UserOutlined />, category: '管理' },
  { key: '/workflow', label: '审批流程设计', icon: <AppstoreOutlined />, category: '管理' },
];

const categoryColors: Record<string, string> = {
  '业务': 'blue',
  '个人': 'green',
  '管理': 'orange',
};

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const inputRef = useRef<any>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const filtered = query.trim()
    ? SEARCH_ITEMS.filter(item =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.category.includes(query)
      )
    : SEARCH_ITEMS;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={520}
      style={{ top: 120 }}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <Input
          ref={inputRef}
          prefix={<SearchOutlined style={{ color: '#999' }} />}
          placeholder="搜索页面、功能..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          bordered={false}
          style={{ fontSize: 16 }}
          allowClear
        />
      </div>
      <List
        style={{ maxHeight: 360, overflow: 'auto' }}
        dataSource={filtered}
        renderItem={(item) => (
          <List.Item
            style={{ padding: '8px 16px', cursor: 'pointer' }}
            onClick={() => { navigate(item.key); onClose(); }}
          >
            <Space>
              <span style={{ fontSize: 16, color: '#666' }}>{item.icon}</span>
              <span>{item.label}</span>
              <Tag color={categoryColors[item.category]} style={{ marginLeft: 8, fontSize: 11 }}>
                {item.category}
              </Tag>
            </Space>
          </List.Item>
        )}
        locale={{ emptyText: '未找到匹配项' }}
      />
    </Modal>
  );
}
