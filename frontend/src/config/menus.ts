/**
 * Centralized menu / breadcrumb / role-mapping config.
 * App.tsx defines the visual shell, while this file remains a readable source
 * for modules that need labels or permission metadata.
 */

export interface BusinessMenuMeta {
  key: string;
  icon: string;
  label: string;
}

export interface LowCodeMenuItem {
  key: string;
  icon: string;
  label: string;
}

export const BUSINESS_MENUS: BusinessMenuMeta[] = [
  { key: '/', icon: 'HomeOutlined', label: '我的工作台' },
  { key: '/dashboard', icon: 'DashboardOutlined', label: '生产态势' },
  { key: '/maintenance', icon: 'ToolOutlined', label: '设备维护' },
  { key: '/quality', icon: 'SafetyCertificateOutlined', label: '质量分析' },
  { key: '/supply-chain', icon: 'ShopOutlined', label: '供应链风险' },
];

export const LOWCODE_MENUS: LowCodeMenuItem[] = [
  { key: '/model-driven', icon: 'LayoutOutlined', label: 'App Builder' },
  { key: '/ontology', icon: 'ApartmentOutlined', label: 'Data Modeler' },
  { key: '/reports', icon: 'BarChartOutlined', label: 'Report Designer' },
  { key: '/rules', icon: 'ThunderboltOutlined', label: 'Rule Builder' },
  { key: '/data-sources', icon: 'ApiOutlined', label: 'Data Sources' },
  { key: '/pipeline', icon: 'DatabaseOutlined', label: 'Data Pipeline' },
  { key: '/graph', icon: 'NodeIndexOutlined', label: 'Graph Explorer' },
];

export const TOOL_MENUS: BusinessMenuMeta[] = [
  { key: '/ai-assistant', icon: 'RobotOutlined', label: 'AI Assistant' },
  { key: '/templates', icon: 'AppstoreOutlined', label: '模板市场' },
];

export const ROLE_MENU_MAP: Record<string, string[] | null> = {
  production_manager: ['/', '/dashboard', '/maintenance', '/quality', '/reports', '/ai-assistant'],
  quality_inspector: ['/', '/dashboard', '/quality', '/supply-chain', '/ai-assistant'],
  admin: null,
};

export const BREADCRUMB_MAP: Record<string, string> = {
  '/': '我的工作台',
  '/dashboard': '生产态势',
  '/maintenance': '设备维护',
  '/quality': '质量分析',
  '/supply-chain': '供应链风险',
  '/model-driven': 'App Builder',
  '/reports': 'Report Designer',
  '/templates': '模板市场',
  '/rules': 'Rule Builder',
  '/ai-assistant': 'AI Assistant',
  '/data-sources': 'Data Sources',
  '/ontology': 'Data Modeler',
  '/graph': 'Graph Explorer',
  '/pipeline': 'Data Pipeline',
  '/system-admin': '系统管理',
  '/workflow': '流程中心',
  '/my-applications': '我的申请',
};

export const APPROVAL_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: 'orange' },
  approved: { label: '已通过', color: 'green' },
  rejected: { label: '已驳回', color: 'red' },
  cancelled: { label: '已取消', color: 'default' },
};
