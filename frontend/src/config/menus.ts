/**
 * Centralized menu / breadcrumb / role-mapping config.
 * Extract from App.tsx to keep the layout component small and to make
 * adding new business modules a config-only change.
 */

export interface BusinessMenuMeta {
  /** Route path serving as menu key */
  key: string;
  /** Lucide / Antd icon name (resolved by App.tsx) */
  icon: string;
  /** Display label (i18n-ready in the future) */
  label: string;
}

export interface LowCodeMenuItem {
  key: string;
  icon: string;
  label: string;
}

export const BUSINESS_MENUS: BusinessMenuMeta[] = [
  { key: '/', icon: 'DashboardOutlined', label: '运营总览' },
  { key: '/maintenance', icon: 'ToolOutlined', label: '预测性维护' },
  { key: '/quality', icon: 'SafetyCertificateOutlined', label: '质量管理' },
  { key: '/supply-chain', icon: 'ShopOutlined', label: '供应链协同' },
];

export const LOWCODE_MENUS: LowCodeMenuItem[] = [
  { key: '/model-driven', icon: 'DatabaseOutlined', label: '模型设计' },
  { key: '/reports', icon: 'LayoutOutlined', label: '页面设计' },
  { key: '/templates', icon: 'AppstoreOutlined', label: '模板市场' },
  { key: '/rules', icon: 'ThunderboltOutlined', label: '规则引擎' },
];

export const TOOL_MENUS: BusinessMenuMeta[] = [
  { key: '/ai-assistant', icon: 'RobotOutlined', label: 'AI 助手' },
  { key: '/reports', icon: 'BarChartOutlined', label: '报表中心' },
];

/**
 * Role → allowed business-menu keys.
 * `null` means "all menus visible". Admin role uses `null` by convention.
 */
export const ROLE_MENU_MAP: Record<string, string[] | null> = {
  production_manager: ['/', '/maintenance', '/quality', '/reports', '/ai-assistant'],
  quality_inspector: ['/', '/quality', '/supply-chain', '/ai-assistant'],
  admin: null,
};

export const BREADCRUMB_MAP: Record<string, string> = {
  '/': '运营总览',
  '/maintenance': '预测性维护',
  '/quality': '质量管理',
  '/supply-chain': '供应链协同',
  '/model-driven': '模型设计',
  '/reports': '页面设计',
  '/templates': '模板市场',
  '/rules': '规则引擎',
  '/ai-assistant': 'AI 助手',
  '/data-sources': '数据源管理',
  '/ontology': '本体建模',
  '/graph': '关系图谱',
  '/pipeline': '数据管线',
  '/system-admin': '系统管理',
  '/workflow': '审批流程设计',
  '/my-applications': '我的申请',
};

export const APPROVAL_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: '审批中', color: 'orange' },
  approved: { label: '已通过', color: 'green' },
  rejected: { label: '已驳回', color: 'red' },
  cancelled: { label: '已撤销', color: 'default' },
};
