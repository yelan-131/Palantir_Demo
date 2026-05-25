/**
 * Centralized menu / breadcrumb / role-mapping config.
 * The sidebar keeps business entry points only. System, template, and
 * configuration entries live in the user menu; AI is exposed as a floating
 * assistant entry.
 */

export interface BusinessMenuMeta {
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

export const ROLE_MENU_MAP: Record<string, string[] | null> = {
  production_manager: ['/', '/dashboard', '/maintenance', '/quality'],
  quality_inspector: ['/', '/dashboard', '/quality', '/supply-chain'],
  admin: null,
};

export const BREADCRUMB_MAP: Record<string, string> = {
  '/': '我的工作台',
  '/dashboard': '生产态势',
  '/maintenance': '设备维护',
  '/quality': '质量分析',
  '/supply-chain': '供应链风险',
  '/reports': '报表中心',
  '/templates': '模板市场',
  '/rules': '规则引擎',
  '/ai-assistant': 'AI Assistant',
  '/data-sources': '数据源管理',
  '/ontology': '数据模型',
  '/graph': '图谱探索',
  '/pipeline': '数据管道',
  '/system-admin': '系统管理',
  '/workflow': '流程中心',
};

export const APPROVAL_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: 'orange' },
  approved: { label: '已通过', color: 'green' },
  rejected: { label: '已驳回', color: 'red' },
  cancelled: { label: '已取消', color: 'default' },
};
