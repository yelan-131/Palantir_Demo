export type NavigationArea = 'business' | 'studio' | 'data' | 'admin';
export interface NavigationEntry {
  path: string;
  label: string;
  area: NavigationArea;
  adminOnly?: boolean;
}

export const NAVIGATION_AREAS = [
  { key: 'business' as const, label: '业务工作台', home: '/' },
  { key: 'studio' as const, label: '应用工作室', home: '/studio' },
  { key: 'data' as const, label: '数据中心', home: '/data-center' },
  { key: 'admin' as const, label: '管理控制台', home: '/admin', adminOnly: true },
];

export const NAVIGATION_ENTRIES: NavigationEntry[] = [
  { path: '/', label: '我的工作台', area: 'business' },
  { path: '/workflow', label: '流程与待办', area: 'business' },
  { path: '/studio/applications', label: '应用、表单与菜单', area: 'studio', adminOnly: true },
  { path: '/studio/reports', label: '分析与报表', area: 'studio' },
  { path: '/studio/rules', label: '业务规则', area: 'studio' },
  { path: '/studio/templates', label: '模板中心', area: 'studio' },
  { path: '/data-center/sources', label: '数据连接', area: 'data' },
  { path: '/data-center/pipelines', label: '同步与管道', area: 'data' },
  { path: '/data-center/reference', label: '字典与基础档案', area: 'data', adminOnly: true },
  { path: '/data-center/assets', label: '数据资产与映射', area: 'data', adminOnly: true },
  { path: '/data-center/objects', label: '对象与关系模型', area: 'data', adminOnly: true },
  { path: '/data-center/entities', label: '实体与抽取浏览', area: 'data' },
  { path: '/data-center/graph', label: '图谱探索', area: 'data' },
  { path: '/data-center/knowledge', label: '知识库', area: 'data', adminOnly: true },
  { path: '/admin/identity', label: '组织、身份与权限', area: 'admin', adminOnly: true },
  { path: '/admin/ai', label: 'AI 与平台设置', area: 'admin', adminOnly: true },
  { path: '/admin/audit', label: '审计与日志', area: 'admin', adminOnly: true },
];

export const LEGACY_ROUTES: Record<string, string> = {
  '/reports': '/studio/reports', '/rules': '/studio/rules', '/templates': '/studio/templates',
  '/data-sources': '/data-center/sources', '/pipeline': '/data-center/pipelines',
  '/ontology': '/data-center/entities', '/graph': '/data-center/graph',
  '/system-admin': '/studio/applications',
};

export const LEGACY_ACCOUNT_SECTIONS: Record<string, string> = {
  'app-menu': '/studio/applications',
  ai: '/admin/ai', audit: '/admin/audit',
  'identity-access': '/admin/identity',
  tenants: '/admin/identity?tab=tenants', users: '/admin/identity?tab=users',
  roles: '/admin/identity?tab=roles', orgs: '/admin/identity?tab=orgs',
  'ai-role-policies': '/admin/identity?tab=roles',
  'data-assets': '/data-center/assets', 'palantir-config': '/data-center/assets',
  'data-ontology': '/data-center/assets', 'semantic-mapping': '/data-center/assets?view=mapping',
  'ontology-modeling': '/data-center/objects', 'reference-data': '/data-center/reference',
  knowledge: '/data-center/knowledge', 'knowledge-graph': '/data-center/knowledge',
};

export function navigationAreaForPath(path: string): NavigationArea {
  const canonical = LEGACY_ROUTES[path] || path;
  if (canonical === '/studio' || canonical.startsWith('/studio/') || path.startsWith('/form-settings/')) return 'studio';
  if (canonical === '/data-center' || canonical.startsWith('/data-center/')) return 'data';
  if (canonical === '/admin' || canonical.startsWith('/admin/')) return 'admin';
  return 'business';
}

export function visibleNavigationEntries(area: NavigationArea, isAdmin: boolean) {
  return NAVIGATION_ENTRIES.filter(entry => entry.area === area && (!entry.adminOnly || isAdmin));
}
