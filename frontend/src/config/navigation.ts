export type NavigationArea = 'business' | 'studio' | 'data' | 'admin' | 'plugins';
export interface NavigationEntry {
  path: string;
  label: string;
  area: NavigationArea;
  adminOnly?: boolean;
  group?: string;
}

export const NAVIGATION_AREAS = [
  { key: 'business' as const, label: '业务工作台', home: '/' },
  { key: 'studio' as const, label: '应用配置', home: '/studio' },
  { key: 'plugins' as const, label: '插件与扩展', home: '/plugins' },
  { key: 'data' as const, label: '数据中心', home: '/data-center' },
  { key: 'admin' as const, label: '后台设置', home: '/admin', adminOnly: true },
];

export const ADMIN_NAVIGATION_GROUPS = [
  { key: 'admin-data', label: '数据与集成', description: '连接数据源，管理数据资产与对象关系。' },
  { key: 'admin-analysis', label: '分析与追溯', description: '追踪实体变更，分析质量与关联影响。' },
  { key: 'admin-development', label: '开发与配置', description: '设计模型与页面，管理配置和模块能力。' },
  { key: 'admin-platform', label: '平台管理', description: '管理组织权限、AI 服务与平台审计。' },
] as const;

export const NAVIGATION_ENTRIES: NavigationEntry[] = [
  { path: '/', label: '我的工作台', area: 'business' },
  { path: '/workflow', label: '流程与待办', area: 'business' },
  { path: '/scheduler', label: '日常任务', area: 'business' },
  { path: '/studio/applications', label: '应用、表单与菜单', area: 'studio', adminOnly: true },
  { path: '/studio/templates', label: '模板中心', area: 'studio' },
  { path: '/plugins', label: '插件与扩展', area: 'plugins' },
  { path: '/data-center/sources', label: '数据接入', area: 'data', group: '数据接入' },
  { path: '/data-center/assets', label: '数据资产', area: 'data', group: '数据治理' },
  { path: '/data-center/reference', label: '基础数据', area: 'data', group: '数据治理', adminOnly: true },
  { path: '/data-center/objects', label: '对象与关系', area: 'data', group: '数据探索' },
  { path: '/data-center/knowledge', label: '知识库', area: 'data', group: '数据探索', adminOnly: true },
  { path: '/admin/sources', label: '数据连接', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/pipelines', label: '同步与管道', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/reference', label: '字典与基础档案', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/assets', label: '数据资产与映射', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/objects', label: '对象与关系模型', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/entities', label: '实体与抽取浏览', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/graph', label: '图谱探索', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/knowledge', label: '知识库', area: 'admin', adminOnly: true, group: '数据与集成' },
  { path: '/admin/quality-impact', label: '质量影响与时间线', area: 'admin', adminOnly: true, group: '分析与追溯' },
  { path: '/admin/entity-timeline', label: '实体时间旅行', area: 'admin', adminOnly: true, group: '分析与追溯' },
  { path: '/admin/graph-tools', label: '图谱分析与追溯', area: 'admin', adminOnly: true, group: '分析与追溯' },
  { path: '/admin/model-tools', label: '模型与页面工具', area: 'admin', adminOnly: true, group: '开发与配置' },
  { path: '/admin/ai-builder', label: '模型与页面建议', area: 'admin', adminOnly: true, group: '开发与配置' },
  { path: '/admin/config-transfer', label: '配置导入导出', area: 'admin', adminOnly: true, group: '开发与配置' },
  { path: '/admin/readiness', label: '模块成熟度', area: 'admin', adminOnly: true, group: '开发与配置' },
  { path: '/admin/identity', label: '组织、身份与权限', area: 'admin', adminOnly: true, group: '平台管理' },
  { path: '/admin/ai', label: 'AI 与平台设置', area: 'admin', adminOnly: true, group: '平台管理' },
  { path: '/admin/audit', label: '审计与日志', area: 'admin', adminOnly: true, group: '平台管理' },
];

export const LEGACY_ROUTES: Record<string, string> = {
  '/reports': '/studio', '/studio/reports': '/studio', '/rules': '/studio', '/studio/rules': '/studio', '/templates': '/studio/templates',
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
  if (canonical === '/plugins') return 'plugins';
  if (canonical === '/studio' || canonical.startsWith('/studio/') || path.startsWith('/form-settings/')) return 'studio';
  if (canonical === '/data-center' || canonical.startsWith('/data-center/')) return 'data';
  if (canonical === '/admin' || canonical.startsWith('/admin/')) return 'admin';
  return 'business';
}

export function visibleNavigationEntries(area: NavigationArea, isAdmin: boolean) {
  return NAVIGATION_ENTRIES.filter(entry => entry.area === area && (!entry.adminOnly || isAdmin));
}

export const WORKFLOW_VIEWS = [
  { key: 'pending' as const, label: '待审批' },
  { key: 'initiated' as const, label: '我发起的' },
  { key: 'processed' as const, label: '我已处理的' },
];

export function normalizedWorkflowView(tab: string | null): 'pending' | 'initiated' | 'processed' {
  if (tab === 'pending' || tab === 'initiated' || tab === 'processed') return tab;
  if (tab === 'done' || tab === 'rejected') return 'processed';
  return tab ? 'initiated' : 'pending';
}

export const PERSONAL_SETTINGS_ENTRIES = [
  { path: '/account-center', label: '账号与安全' },
  { path: '/account-center?tab=preferences', label: '工作偏好' },
  { path: '/plugins', label: '插件与扩展' },
];

/** Shared by the account popup and settings sidebar. */
export function settingsNavigationGroups(isAdmin: boolean) {
  const adminEntries = visibleNavigationEntries('admin', isAdmin);
  return [
    { key: 'settings-personal', label: '个人设置', description: '账号安全、工作偏好与个人扩展', icon: 'personal', entries: PERSONAL_SETTINGS_ENTRIES },
    { key: 'settings-applications', label: '应用配置', description: '应用、表单、看板与模板', icon: 'applications', entries: visibleNavigationEntries('studio', isAdmin) },
    { key: 'settings-data', label: '数据中心', description: '数据接入、资产治理与数据探索', icon: 'data', entries: visibleNavigationEntries('data', isAdmin) },
    { key: 'settings-platform', label: '平台管理', description: '组织权限、AI 服务与审计日志', icon: 'platform', entries: adminEntries.filter(entry => entry.group === '平台管理') },
    { key: 'settings-advanced', label: '高级工具', description: '分析追溯、旧版工具与配置迁移', icon: 'advanced', entries: adminEntries.filter(entry => ['分析与追溯', '开发与配置'].includes(entry.group || '')) },
  ].filter(group => group.entries.length);
}

/** Old data URLs keep their filters and open the matching workspace tab. */
export function dataCenterDestination(pathname: string, search = ''): string | undefined {
  const path = pathname.replace(/^\/admin\//, '/data-center/');
  const params = new URLSearchParams(search);
  const aliases: Record<string, { path: string; parameter: string; value: string }> = {
    '/data-center/pipelines': { path: '/data-center/sources', parameter: 'tab', value: 'pipelines' },
    '/data-center/entities': { path: '/data-center/assets', parameter: 'view', value: 'entities' },
    '/data-center/graph': { path: '/data-center/objects', parameter: 'view', value: 'graph' },
  };
  const alias = aliases[path];
  if (alias) params.set(alias.parameter, alias.value);
  const destination = alias?.path || path;
  if (!NAVIGATION_ENTRIES.some(entry => entry.area === 'data' && entry.path === destination)) return undefined;
  return destination + (params.size ? `?${params}` : '');
}

/** All tabs and legacy URLs highlight their parent workspace. */
export function settingsDestinationKey(pathname: string, search = '') {
  if (pathname === '/account-center') return new URLSearchParams(search).get('tab') === 'preferences' ? '/account-center?tab=preferences' : '/account-center';
  if (pathname.startsWith('/form-settings/')) return '/studio/applications';
  const canonical = LEGACY_ROUTES[pathname] || pathname;
  return dataCenterDestination(canonical, search)?.split('?')[0] || canonical;
}
