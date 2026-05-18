import React, { useEffect, useRef, useState } from 'react';
import { Modal, Input, List, Space, Tag } from 'antd';
import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  NodeIndexOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface SearchItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  category: string;
}

const SEARCH_ITEMS: SearchItem[] = [
  { key: '/', label: '我的工作台', icon: <DashboardOutlined />, category: '个人空间' },
  { key: '/dashboard', label: '生产态势', icon: <DashboardOutlined />, category: '业务分析' },
  { key: '/maintenance', label: '设备维护', icon: <ToolOutlined />, category: '业务分析' },
  { key: '/quality', label: '质量分析', icon: <SafetyCertificateOutlined />, category: '业务分析' },
  { key: '/supply-chain', label: '供应链风险', icon: <ShopOutlined />, category: '业务分析' },
  { key: '/model-driven', label: 'App Builder', icon: <AppstoreOutlined />, category: '低代码配置' },
  { key: '/ontology', label: 'Data Modeler', icon: <ApartmentOutlined />, category: '低代码配置' },
  { key: '/reports', label: 'Report Designer', icon: <BarChartOutlined />, category: '低代码配置' },
  { key: '/rules', label: 'Rule Builder', icon: <ThunderboltOutlined />, category: '低代码配置' },
  { key: '/data-sources', label: 'Data Sources', icon: <ApiOutlined />, category: '数据资产' },
  { key: '/pipeline', label: 'Data Pipeline', icon: <DatabaseOutlined />, category: '数据资产' },
  { key: '/graph', label: 'Graph Explorer', icon: <NodeIndexOutlined />, category: '数据资产' },
  { key: '/ai-assistant', label: 'AI Assistant', icon: <RobotOutlined />, category: '工具' },
  { key: '/templates', label: '模板市场', icon: <AppstoreOutlined />, category: '工具' },
  { key: '/my-applications', label: '我的申请', icon: <UserOutlined />, category: '个人空间' },
  { key: '/system-admin', label: '系统管理', icon: <SettingOutlined />, category: '管理' },
];

const categoryColors: Record<string, string> = {
  个人空间: 'green',
  业务分析: 'blue',
  低代码配置: 'geekblue',
  数据资产: 'cyan',
  工具: 'purple',
  管理: 'orange',
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
    ? SEARCH_ITEMS.filter((item) =>
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
      width={560}
      style={{ top: 110 }}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #d8dee4' }}>
        <Input
          ref={inputRef}
          prefix={<SearchOutlined style={{ color: '#8a97a1' }} />}
          placeholder="搜索应用、数据资产、配置器..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          bordered={false}
          style={{ fontSize: 15 }}
          allowClear
        />
      </div>
      <List
        style={{ maxHeight: 380, overflow: 'auto' }}
        dataSource={filtered}
        renderItem={(item) => (
          <List.Item
            style={{ padding: '9px 16px', cursor: 'pointer' }}
            onClick={() => { navigate(item.key); onClose(); }}
          >
            <Space>
              <span style={{ fontSize: 16, color: '#2f5f73' }}>{item.icon}</span>
              <span>{item.label}</span>
              <Tag color={categoryColors[item.category]} style={{ marginLeft: 8, fontSize: 11 }}>
                {item.category}
              </Tag>
            </Space>
          </List.Item>
        )}
        locale={{ emptyText: '没有找到匹配项' }}
      />
    </Modal>
  );
}
