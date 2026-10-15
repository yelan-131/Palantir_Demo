import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Spin,
  Typography,
  Tooltip,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  CheckOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  DownOutlined,
  HomeOutlined,
  LeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { ApplicationRail, ApplicationLibrary, ExtensionLibrary, useApplicationLibrary, type LibraryApp } from './components/ShellNavigation';
import { useShellPreferences } from './hooks/useShellPreferences';
import AiChatWidget from './components/AiChatWidget';
import { AiWorkbenchProvider } from './components/AiChatWidget/context';
import GlobalSearch from './components/GlobalSearch';
import NotificationCenter from './components/NotificationCenter';
import { LEGACY_ROUTES, NAVIGATION_AREAS, NAVIGATION_ENTRIES, navigationAreaForPath, visibleNavigationEntries } from './config/navigation';
import { useAuthStore } from './stores/authStore';
import {
  getCurrentRelease,
  listApplicationMenus,
  listApplications,
} from './services/api';

const NavigationAreaPage = lazy(() => import('./pages/NavigationArea'));
const AccountEntry = lazy(() => import('./pages/NavigationArea').then(module => ({ default: module.AccountEntry })));

const SchedulerPage = lazy(() => import('./pages/Scheduler'));
const WorkspacePage = lazy(() => import('./pages/Workspace'));
const AlertCenterPage = lazy(() => import('./pages/AlertCenter'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const MaintenancePage = lazy(() => import('./pages/Maintenance'));
const QualityPage = lazy(() => import('./pages/Quality'));
const SupplyChainPage = lazy(() => import('./pages/SupplyChain'));
const DynamicPage = lazy(() => import('./pages/DynamicPage'));
const AppProgramPage = lazy(() => import('./pages/AppPrograms'));
const FormSettingsPage = lazy(() => import('./pages/FormSettings'));
const WorkflowPage = lazy(() => import('./pages/Workflow'));
const MaterialApplicationsPage = lazy(() => import('./pages/MaterialApplications'));
const LoginPage = lazy(() => import('./pages/Login'));

const { Header, Sider, Content } = Layout;
interface DynamicMenu {
  id: number;
  parent_id: number | null;
  title: string;
  route_path: string;
  icon?: string;
  is_visible: boolean;
  children?: DynamicMenu[];
}

interface ApplicationInfo {
  id: number;
  name: string;
  code: string;
  description?: string;
  icon?: string;
  default_route: string;
  status: string;
  is_pinned?: boolean;
}

interface ReleaseInfo {
  version: string;
  released_at?: string | null;
  title?: string;
  summary?: string;
  highlights?: string[];
  details?: string[];
  records?: ReleaseRecord[];
  history?: ReleaseRecord[];
  show_popup?: boolean;
}

type ReleaseCategoryKey = 'added' | 'improved' | 'removed';

interface ReleaseRecord {
  version: string;
  released_at?: string | null;
  date?: string | null;
  title?: string;
  summary?: string;
  categories?: Partial<Record<ReleaseCategoryKey, string[]>>;
  added?: string[];
  improved?: string[];
  removed?: string[];
}

const releaseCategoryOrder: ReleaseCategoryKey[] = ['added', 'improved', 'removed'];
const releaseCategoryLabels: Record<ReleaseCategoryKey, string> = {
  added: '新增功能',
  improved: '优化功能',
  removed: '删减功能',
};

function normalizeReleaseRecords(release?: ReleaseInfo | null): ReleaseRecord[] {
  if (!release) return [];
  const records = release.records?.length ? release.records : release.history;
  if (records?.length) return records;
  if (!release.version) return [];
  return [{
    version: release.version,
    released_at: release.released_at,
    title: release.title,
    summary: release.summary,
    categories: {
      added: release.highlights || [],
      improved: release.details || [],
    },
  }];
}

function releaseRecordCategories(record: ReleaseRecord) {
  return releaseCategoryOrder
    .map((key) => ({
      key,
      label: releaseCategoryLabels[key],
      items: record.categories?.[key] || record[key] || [],
    }))
    .filter((section) => section.items.length);
}

const runtimeRouteAliasMap: Record<string, string> = {
  '/dynamic/equipment-inspection': '/program/equipment-inspection',
  '/dynamic/inventory-impact': '/program/inventory-impact',
  '/dynamic/supplier-scorecard': '/program/supplier-scorecard',
  '/supply-chain': '/program/supply-overview',
};

function normalizeRuntimeRoute(routePath?: string): string {
  if (!routePath) return '';
  return runtimeRouteAliasMap[routePath] || routePath;
}

const businessMenuItems: NonNullable<MenuProps['items']> = [
  { key: '/', icon: <HomeOutlined />, label: '\u6211\u7684\u5de5\u4f5c\u53f0' },
  { key: '/dashboard', icon: <DashboardOutlined />, label: '\u751f\u4ea7\u6001\u52bf' },
  { key: '/maintenance', icon: <ToolOutlined />, label: '\u8bbe\u5907\u7ef4\u62a4' },
  { key: '/quality', icon: <SafetyCertificateOutlined />, label: '\u8d28\u91cf\u5206\u6790' },
  { key: '/supply-chain', icon: <ShopOutlined />, label: '\u4f9b\u5e94\u94fe\u98ce\u9669' },
];

const workspaceMenuItem: NonNullable<MenuProps['items']>[number] = {
  key: '/',
  icon: <HomeOutlined />,
  label: '\u6211\u7684\u5de5\u4f5c\u53f0',
};

const pageTitleMap: Record<string, string> = {
  '/': '\u6211\u7684\u5de5\u4f5c\u53f0',
  '/dashboard': '\u751f\u4ea7\u6001\u52bf',
  '/maintenance': '\u8bbe\u5907\u7ef4\u62a4',
  '/quality': '\u8d28\u91cf\u5206\u6790',
  '/supply-chain': '\u4f9b\u5e94\u94fe\u98ce\u9669',
  '/ontology': '\u6570\u636e\u6a21\u578b',
  '/reports': '\u62a5\u8868\u4e2d\u5fc3',
  '/templates': '\u6a21\u677f\u5e02\u573a',
  '/rules': '\u89c4\u5219\u5f15\u64ce',
  '/ai-assistant': 'AI Assistant',
  '/account-center': '\u8d26\u6237\u4e2d\u5fc3',
  '/data-sources': '\u6570\u636e\u6e90\u7ba1\u7406',
  '/graph': '\u56fe\u8c31\u63a2\u7d22',
  '/pipeline': '\u6570\u636e\u7ba1\u9053',
  '/form-settings': '\u8868\u5355\u8bbe\u7f6e',
  '/system-admin': '\u7cfb\u7edf\u7ba1\u7406',
  '/workflow': '\u6d41\u7a0b\u4e2d\u5fc3',
};

const programTitleMap: Record<string, string> = {
  'material-application': '料号申请',
  'production-overview': '\u751f\u4ea7\u603b\u89c8',
  'oee-trend-report': 'OEE \u8d8b\u52bf\u62a5\u8868',
  'line-status': '\u4ea7\u7ebf\u72b6\u6001',
  'line-load-analysis': '\u4ea7\u7ebf\u8d1f\u8377\u5206\u6790',
  'production-plan-entry': '\u751f\u4ea7\u8ba1\u5212\u586b\u62a5',
  'device-health': '\u8bbe\u5907\u5065\u5eb7',
  'device-health-dashboard': '\u8bbe\u5907\u5065\u5eb7\u770b\u677f',
  'fault-prediction': '\u6545\u969c\u9884\u6d4b',
  'failure-trend-analysis': '\u6545\u969c\u8d8b\u52bf\u5206\u6790',
  'maintenance-order': '\u7ef4\u4fee\u5de5\u5355',
  'equipment-inspection': '\u70b9\u68c0\u8ba1\u5212',
  'alert-center': '\u544a\u8b66\u4e2d\u5fc3',
  'quality-overview': '\u8d28\u91cf\u603b\u89c8',
  'inspection-batch': '\u68c0\u9a8c\u6279\u6b21',
  'defect-analysis-report': '\u7f3a\u9677\u5206\u6790\u62a5\u8868',
  'process-capability-dashboard': '\u8fc7\u7a0b\u80fd\u529b\u770b\u677f',
  'defect-analysis': '\u7f3a\u9677\u5206\u6790',
  'quality-event': '\u8d28\u91cf\u8ffd\u6eaf',
  'supplier-risk': '\u4f9b\u5e94\u5546\u98ce\u9669',
  'supply-overview': '\u4f9b\u5e94\u603b\u89c8',
  'inventory-impact': '\u5e93\u5b58\u5f71\u54cd',
  'supplier-scorecard': '\u4f9b\u5e94\u5546\u8bc4\u5206',
  'material-impact-report': '\u7269\u6599\u5f71\u54cd\u62a5\u8868',
  'supply-risk-dashboard': '\u4f9b\u5e94\u98ce\u9669\u770b\u677f',
  'material-impact': '\u7269\u6599\u5f71\u54cd',
  'risk-review': '\u98ce\u9669\u590d\u6838',
};

function getRuntimePageTitle(pathname: string): string {
  if (pathname.startsWith('/dynamic/')) {
    return '业务页面';
  }
  if (pathname.startsWith('/program/')) {
    const programId = pathname.split('/').filter(Boolean)[1];
    return programTitleMap[programId] || 'Business Page';
  }
  return pageTitleMap[pathname] || 'Business Page';
}function iconFor(name?: string) {
  const icons: Record<string, React.ReactNode> = {
    DashboardOutlined: <DashboardOutlined />,
    ToolOutlined: <ToolOutlined />,
    SafetyCertificateOutlined: <SafetyCertificateOutlined />,
    ShopOutlined: <ShopOutlined />,
    AppstoreOutlined: <AppstoreOutlined />,
    HomeOutlined: <HomeOutlined />,
  };
  return icons[name || ''] || <AppstoreOutlined />;
}

function PageLoader() {
  return (
    <div className="shell-page-loading" role="status" aria-live="polite">
      <Spin size="large" tip="正在加载页面…">
        <div style={{ minHeight: 200 }} />
      </Spin>
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(err: Error) {
    return { error: err.message };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="shell-page-error">
          <Alert type="error" showIcon message="页面暂时无法显示" description="请重新加载页面。如果问题持续出现，可查看错误详情并联系管理员。" />
          <details className="shell-error-details">
            <summary>错误详情</summary>
            <pre>{this.state.error}</pre>
          </details>
          <Button type="primary" onClick={() => window.location.reload()}>{'\u91cd\u65b0\u52a0\u8f7d\u9875\u9762'}</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
function buildDynamicMenuTree(items: DynamicMenu[]): MenuProps['items'] {
  // Material requests belong to the workflow center rather than application menus.
  items = items.filter(item => !['/program/material-application', '/workflow?section=materials'].includes((item.route_path || '').split('#')[0].replace(/\/$/, '')));
  if (items.some((item) => item.children?.length)) {
    return items.map((item) => ({
      key: normalizeRuntimeRoute(item.route_path) || `dynamic-${item.id}`,
      icon: iconFor(item.icon),
      label: item.title,
      children: item.children?.length ? buildDynamicMenuTree(item.children) : undefined,
    }));
  }
  const map = new Map<number, any>();
  const roots: any[] = [];
  for (const item of items) {
    const routePath = normalizeRuntimeRoute(item.route_path);
    map.set(item.id, {
      key: routePath || `dynamic-${item.id}`,
      icon: iconFor(item.icon),
      label: item.title,
      children: [],
    });
  }
  for (const item of items) {
    const node = map.get(item.id);
    if (!node) continue;
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id).children.push(node);
    } else if (normalizeRuntimeRoute(item.route_path)) {
      roots.push(node);
    }
  }
  return roots.map((node) => (node.children?.length ? node : { ...node, children: undefined }));
}

function unwrapApplicationMenuRoot(items: MenuProps['items']): MenuProps['items'] {
  if (items?.length === 1) {
    const [first] = items;
    if (first && 'children' in first && first.children?.length) {
      return first.children as MenuProps['items'];
    }
  }
  return items;
}

function menuLabelToText(label: React.ReactNode): string {
  if (typeof label === 'string' || typeof label === 'number') return String(label);
  if (Array.isArray(label)) return label.map(menuLabelToText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(label)) {
    return menuLabelToText(label.props.children);
  }
  return '';
}

function findMenuLabelPath(items: MenuProps['items'], route: string): string[] | null {
  for (const item of items || []) {
    if (!item || !('key' in item) || !('label' in item)) continue;
    const label = menuLabelToText(item.label);
    const childPath = 'children' in item && item.children?.length
      ? findMenuLabelPath(item.children as MenuProps['items'], route)
      : null;
    if (String(item.key) === route) return label ? [label] : [];
    if (childPath) return label ? [label, ...childPath] : childPath;
  }
  return null;
}


function findFirstDynamicMenuRoute(items: DynamicMenu[]): string | undefined {
  for (const item of items) {
    if (item.is_visible === false) continue;
    const routePath = normalizeRuntimeRoute(item.route_path);
    if (routePath) return routePath;
    const childRoute = item.children?.length ? findFirstDynamicMenuRoute(item.children) : undefined;
    if (childRoute) return childRoute;
  }
  return undefined;
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loginArrival, setLoginArrival] = useState(() => Boolean(location.state?.loginArrival));
  useEffect(() => {
    if (!loginArrival) return;
    const timer = window.setTimeout(() => setLoginArrival(false), 220);
    return () => window.clearTimeout(timer);
  }, [loginArrival]);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const activeArea = navigationAreaForPath(location.pathname);
  const activeAreaInfo = NAVIGATION_AREAS.find(area => area.key === activeArea)!;
  const isAdmin = Boolean(user?.is_admin);
  const areaEntry = NAVIGATION_ENTRIES.find(entry => entry.path === location.pathname);

  const { preferences, updatePreferences } = useShellPreferences();
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [smallViewport, setSmallViewport] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [temporaryMenuExpanded, setTemporaryMenuExpanded] = useState(false);
  useEffect(() => {
    const compactQuery = window.matchMedia('(max-width: 1100px)');
    const smallQuery = window.matchMedia('(max-width: 760px)');
    const onResize = () => {
      setCompactViewport(compactQuery.matches);
      setSmallViewport(smallQuery.matches);
      setTemporaryMenuExpanded(false);
    };
    compactQuery.addEventListener('change', onResize);
    smallQuery.addEventListener('change', onResize);
    return () => {
      compactQuery.removeEventListener('change', onResize);
      smallQuery.removeEventListener('change', onResize);
    };
  }, []);
  const collapsed = compactViewport ? !temporaryMenuExpanded : preferences.sidebar === 'collapsed';
  const setCollapsed = (value: boolean) => {
    if (compactViewport) setTemporaryMenuExpanded(!value);
    else updatePreferences({ sidebar: value ? 'collapsed' : 'expanded' });
  };
  useEffect(() => { setTemporaryMenuExpanded(false); }, [location.pathname]);
  const mobileMenuWasOpen = React.useRef(false);
  useEffect(() => {
    const isOpen = smallViewport && !collapsed;
    const restoreFocus = mobileMenuWasOpen.current && smallViewport;
    if (isOpen) document.getElementById('shell-context-menu')?.querySelector<HTMLButtonElement>('.shell-menu-heading button')?.focus();
    else if (restoreFocus) document.querySelector<HTMLButtonElement>('.shell-mobile-menu-toggle')?.focus();
    mobileMenuWasOpen.current = isOpen;
  }, [smallViewport, collapsed]);
  useEffect(() => {
    if (!smallViewport || collapsed) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTemporaryMenuExpanded(false);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [smallViewport, collapsed]);
  const [dynamicMenus, setDynamicMenus] = useState<MenuProps['items']>([]);
  const [menusLoadedFor, setMenusLoadedFor] = useState<number | null>(null);
  const [firstApplicationRoute, setFirstApplicationRoute] = useState<string>();
  const [applications, setApplications] = useState<ApplicationInfo[]>([]);
  const [currentApplication, setCurrentApplication] = useState<ApplicationInfo | null>(null);
  const [rootApplicationId, setRootApplicationId] = useState<number | null>(null);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseRecordIndex, setReleaseRecordIndex] = useState(0);
  const library = useApplicationLibrary(applications, isAdmin);
  const isApplicationWorkspace = activeArea === 'business' && (location.pathname === '/' && rootApplicationId === currentApplication?.id || !['/', '/workflow', '/account-center', '/scheduler', '/plugins', '/more'].includes(location.pathname));
  const activeLibraryEntry = library.filter(app => !app.application && app.pinned).find(app => location.pathname === app.path || app.path === '/data-center' && location.pathname.startsWith('/data-center/') || app.path === '/admin' && location.pathname.startsWith('/admin/'));
  const railKey = location.pathname === '/more' ? 'more' : location.pathname === '/scheduler' ? 'scheduler' : location.pathname === '/plugins' ? 'plugins' : activeLibraryEntry?.id || (activeArea !== 'business' ? 'space' : isApplicationWorkspace && currentApplication ? `app:${currentApplication.id}` : 'home');
  const sidebarTitle = location.pathname === '/more' ? '更多' : location.pathname === '/scheduler' ? '定时任务' : location.pathname === '/plugins' ? '插件' : activeLibraryEntry?.name || (activeArea !== 'business' ? '空间' : isApplicationWorkspace && currentApplication ? library.find(app => app.id === `app:${currentApplication.id}`)?.name || currentApplication.name : '首页');



  useEffect(() => {
    listApplications()
      .then((res) => {
        const apps: ApplicationInfo[] = res.data?.data || [];
        setApplications(apps);
        if (!apps.length) {
          setCurrentApplication(null);
          setDynamicMenus([]);
          return;
        }
        const storedId = Number(localStorage.getItem('mf_current_app_id'));
        const matched = apps.find((app) => app.id === storedId) || apps[0];
        setCurrentApplication(matched);
        localStorage.setItem('mf_current_app_id', String(matched.id));
      })
      .catch(() => {
        message.error('\u5e94\u7528\u5217\u8868\u52a0\u8f7d\u5931\u8d25');
        setApplications([]);
        setCurrentApplication(null);
        setDynamicMenus([]);
      });
  }, []);

  useEffect(() => {
    if (!currentApplication) return;
    let cancelled = false;
    listApplicationMenus(currentApplication.id)
      .then((res) => {
        if (cancelled) return;
        const apiItems = res.data?.data || [];
        const items = apiItems
          .filter((m: DynamicMenu) => m.is_visible !== false);
        setDynamicMenus(buildDynamicMenuTree(items));
        setFirstApplicationRoute(findFirstDynamicMenuRoute(apiItems));
        setMenusLoadedFor(currentApplication.id);
      })
      .catch(() => {
        if (cancelled) return;
        setMenusLoadedFor(null);
        message.error('\u5e94\u7528\u83dc\u5355\u52a0\u8f7d\u5931\u8d25');
        setDynamicMenus([]);
      });
    return () => { cancelled = true; };
  }, [currentApplication, activeArea]);

  useEffect(() => {
    if (location.pathname === '/' && rootApplicationId === currentApplication?.id && menusLoadedFor === currentApplication?.id && firstApplicationRoute) {
      setRootApplicationId(null);
      navigate(firstApplicationRoute);
    }
  }, [location.pathname, rootApplicationId, currentApplication?.id, menusLoadedFor, firstApplicationRoute, navigate]);

  // Resolve bookmarked and search-result runtime pages to their actual application.
  useEffect(() => {
    if (!isApplicationWorkspace || !currentApplication || menusLoadedFor !== currentApplication.id || location.pathname === '/') return;
    const route = normalizeRuntimeRoute(location.pathname);
    if (normalizeRuntimeRoute(currentApplication.default_route) === route) return;
    if (findMenuLabelPath(dynamicMenus, route)) return;
    let cancelled = false;
    const resolve = async () => {
      const defaultOwner = applications.find(app => normalizeRuntimeRoute(app.default_route) === route);
      let owner = defaultOwner;
      if (!owner) {
        const candidates = applications.filter(app => app.id !== currentApplication.id);
        const results = await Promise.all(candidates.map(async app => {
          try {
            const response = await listApplicationMenus(app.id);
            return findMenuLabelPath(buildDynamicMenuTree((response.data?.data || []).filter((item: DynamicMenu) => item.is_visible !== false)), route) ? app : undefined;
          } catch { return undefined; }
        }));
        owner = results.find(Boolean);
      }
      if (!cancelled && owner && owner.id !== currentApplication.id) {
        setDynamicMenus([]);
        setCurrentApplication(owner);
        localStorage.setItem('mf_current_app_id', String(owner.id));
      }
    };
    void resolve();
    return () => { cancelled = true; };
  }, [isApplicationWorkspace, currentApplication, menusLoadedFor, dynamicMenus, applications, location.pathname]);

  useEffect(() => {
    getCurrentRelease()
      .then((res) => {
        const release = res.data;
        if (!release?.version || release.show_popup === false) return;
        setReleaseInfo(release);
        setReleaseModalOpen(true);
      })
      .catch(() => {});
  }, []);

  const acknowledgeRelease = () => {
    setReleaseModalOpen(false);
  };

  const allMenuItems = useMemo<MenuProps['items']>(() => {
    if (location.pathname === '/more') return [{ key: '/more', icon: <AppstoreOutlined />, label: '常见应用' }];
    if (location.pathname === '/scheduler') return [{ key: '/scheduler', icon: <CheckOutlined />, label: '定时任务管理' }];
    if (location.pathname === '/plugins') return [{ key: '/plugins', icon: <AppstoreOutlined />, label: '插件与扩展' }];
    if (activeArea !== 'business') {
      const contextArea = activeLibraryEntry?.id === 'data' || activeLibraryEntry?.id === 'knowledge' ? 'data' : activeLibraryEntry?.id === 'admin' ? 'admin' : activeLibraryEntry?.id === 'reports' ? 'studio' : undefined;
      return NAVIGATION_AREAS.filter(area => area.key !== 'business' && (!contextArea || area.key === contextArea) && (!('adminOnly' in area) || isAdmin)).map(area => ({
        key: area.key, type: 'group' as const, label: area.label,
        children: visibleNavigationEntries(area.key, isAdmin).map(entry => ({ key: entry.path, label: entry.label, icon: collapsed ? <AppstoreOutlined /> : undefined })),
      }));
    }
    if (!isApplicationWorkspace) {
      const appLinks = applications.map(app => ({ key: `application:${app.id}`, icon: iconFor(app.icon), label: library.find(entry => entry.id === `app:${app.id}`)?.name || app.name }));
      return [
        { key: 'personal', type: 'group' as const, label: '工作空间', children: [workspaceMenuItem, { key: '/workflow', icon: <CheckOutlined />, label: '工作内容与待办' }] },
        { key: 'business-apps', type: 'group' as const, label: '业务应用', children: appLinks.length ? appLinks : businessMenuItems.filter(item => item?.key !== '/') },
        ...(location.pathname === '/account-center' ? [{ key: '/account-center', label: '个人账号与设置' }] : []),
      ];
    }
    const appItems = dynamicMenus?.length ? unwrapApplicationMenuRoot(dynamicMenus) : [];
    return appItems?.length ? appItems : businessMenuItems;
  }, [activeArea, dynamicMenus, isAdmin, isApplicationWorkspace, applications, library, activeLibraryEntry, location.pathname, collapsed]);

  const openMenuKeys = useMemo(() => {
    return (allMenuItems || [])
      .map((item) => (item && 'key' in item ? String(item.key) : ''))
      .filter(Boolean);
  }, [allMenuItems]);
  const selectedKey = location.pathname.startsWith('/form-settings/') ? '/studio/applications' : normalizeRuntimeRoute(location.pathname) || location.pathname;
  const currentMenuTitle = useMemo(() => {
    const path = findMenuLabelPath(allMenuItems, selectedKey);
    return path?.length ? path[path.length - 1] : undefined;
  }, [allMenuItems, selectedKey]);
  const showRuntimePageBar =
    activeArea === 'business'
    && !location.pathname.startsWith('/program/')
    && !location.pathname.startsWith('/dynamic/')
    && !location.pathname.startsWith('/form-settings/')
    && !['/', '/workflow', '/system-admin', '/account-center', '/scheduler', '/plugins', '/more'].includes(location.pathname);
  const runtimeTitle = location.pathname === '/more' ? '常见应用' : location.pathname === '/scheduler' ? '定时任务' : location.pathname === '/plugins' ? '插件与扩展' : location.pathname.startsWith('/form-settings/') ? '页面设计' : areaEntry?.label || currentMenuTitle || (location.pathname === '/account-center' ? '个人账号' : activeArea !== 'business' ? activeAreaInfo.label : getRuntimePageTitle(location.pathname));
  const releaseRecords = normalizeReleaseRecords(releaseInfo);
  const activeReleaseIndex = releaseRecords.length
    ? Math.min(releaseRecordIndex, releaseRecords.length - 1)
    : 0;

  useEffect(() => {
    if (!releaseModalOpen) return;
    setReleaseRecordIndex(0);
  }, [releaseModalOpen, releaseInfo?.version]);

  const moveReleaseRecord = (direction: -1 | 1) => {
    if (!releaseRecords.length) return;
    setReleaseRecordIndex((current) => (current + direction + releaseRecords.length) % releaseRecords.length);
  };


  const switchApplication = (app: ApplicationInfo) => {
    setRootApplicationId(app.default_route === '/' || !app.default_route ? app.id : null);
    if (currentApplication?.id !== app.id) setDynamicMenus([]);
    setCurrentApplication(app);
    localStorage.setItem('mf_current_app_id', String(app.id));
    const defaultRoute = app.default_route || '/';
    navigate(normalizeRuntimeRoute(defaultRoute) || defaultRoute);
  };

  const openLibraryApp = (entry: LibraryApp) => {
    if (entry.application) switchApplication(entry.application);
    else navigate(entry.path);
  };


  return (
    <AiWorkbenchProvider>
    <Layout className={`app-shell tech-white-shell density-${preferences.density}${smallViewport && !collapsed ? ' shell-menu-overlay-open' : ''}${loginArrival ? ' login-arrival' : ''}`}>
      <ApplicationRail onHome={() => { setRootApplicationId(null); navigate('/'); }} activeKey={railKey} library={library} user={user} onOpen={openLibraryApp} onLogout={() => { logout(); navigate('/login'); }} />
      {smallViewport && !collapsed && <button className="shell-menu-backdrop" aria-label="收起菜单栏" onClick={() => setCollapsed(true)} />}
      <Sider id="shell-context-menu" width={224} collapsedWidth={smallViewport ? 0 : 64} collapsed={collapsed} trigger={null} theme="light" className="app-sider shell-context-menu" aria-label="菜单栏" aria-hidden={smallViewport && collapsed || undefined} onTransitionEnd={(event) => { if (smallViewport && !collapsed && event.target === event.currentTarget && event.propertyName === 'width') event.currentTarget.querySelector<HTMLButtonElement>('.shell-menu-heading button')?.focus(); }}>
        <div className="shell-menu-heading">
          {!collapsed && <Typography.Text strong ellipsis>{sidebarTitle}</Typography.Text>}
          <Tooltip title={collapsed ? '展开菜单栏' : '折叠菜单栏'}><Button type="text" aria-label={collapsed ? '展开菜单栏' : '折叠菜单栏'} icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} /></Tooltip>
        </div>
        <Menu key={`menu-${railKey}-${currentApplication?.id || 'default'}-${openMenuKeys.join('|')}-${collapsed}`} className="app-menu" mode="inline" inlineCollapsed={collapsed} selectedKeys={[selectedKey]} defaultOpenKeys={collapsed ? [] : openMenuKeys} items={allMenuItems} onClick={({ key }) => { if (smallViewport) setTemporaryMenuExpanded(false); if (String(key).startsWith('application:')) { const app = applications.find(item => item.id === Number(String(key).split(':')[1])); if (app) switchApplication(app); } else if (String(key).startsWith('/')) navigate(String(key)); }} />
      </Sider>
      <Layout className="shell-workspace-layout" {...(smallViewport && !collapsed ? { inert: '' } : {})}>
        <Header className="app-header">
          <Button className="shell-mobile-menu-toggle" type="text" aria-label="打开菜单栏" aria-controls="shell-context-menu" aria-expanded={!collapsed} icon={<MenuUnfoldOutlined />} onClick={() => setCollapsed(false)} />
          <Typography.Text className="shell-page-title" ellipsis title={runtimeTitle}>{runtimeTitle}</Typography.Text>

          <GlobalSearch />
          <Space className="shell-header-actions" size={12} align="center">
            <NotificationCenter />

          </Space>
        </Header>

        <Content className="app-content">
          <div className="content-surface">
            {showRuntimePageBar && (
              <div className="runtime-page-bar">
                <div>
                  <Typography.Title level={3}>{runtimeTitle}</Typography.Title>
                </div>
                <Space wrap>
                  <Button icon={<PlusOutlined />}>{'\u65b0\u589e'}</Button>
                  <Button icon={<ReloadOutlined />}>{'\u5237\u65b0'}</Button>
                  <Button icon={<DownloadOutlined />}>{'\u5bfc\u51fa'}</Button>
                </Space>
              </div>
            )}
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<WorkspacePage />} />
                  <Route path="/more" element={<ApplicationLibrary library={library} onOpen={openLibraryApp} isAdmin={isAdmin} />} />
                  <Route path="/scheduler" element={<SchedulerPage />} />
                  <Route path="/plugins" element={<ExtensionLibrary isAdmin={isAdmin} />} />
                  <Route path="/dashboard" element={<DashboardPage />} />

                  <Route path="/maintenance" element={<MaintenancePage />} />
                  <Route path="/quality" element={<QualityPage />} />
                  <Route path="/supply-chain" element={<SupplyChainPage />} />
                  <Route path="/ai-assistant" element={<Navigate to="/" replace />} />
                  <Route path="/account-center" element={<AccountEntry currentApplication={currentApplication} />} />

                  <Route path="/dynamic/:slug" element={<DynamicPage />} />
                  <Route path="/program/alert-center" element={<AlertCenterPage />} />
                  <Route path="/program/material-application" element={<MaterialApplicationsPage />} />
                  <Route path="/program/:programId" element={<AppProgramPage />} />
                  <Route path="/form-settings/:formId" element={<FormSettingsPage />} />
                  <Route path="/studio/*" element={<NavigationAreaPage />} />
                  <Route path="/data-center/*" element={<NavigationAreaPage />} />
                  <Route path="/admin/*" element={<NavigationAreaPage />} />
                  {Object.entries(LEGACY_ROUTES).map(([path, target]) => <Route key={path} path={path} element={<Navigate to={target + location.search} replace />} />)}

                  <Route path="/workflow" element={<WorkflowPage />} />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </div>
        </Content>
      </Layout>

      <AiChatWidget enabled={preferences.aiBubbleVisible} pageTitle={runtimeTitle} applicationName={activeArea === 'business' && location.pathname !== '/account-center' || location.pathname.startsWith('/form-settings/') ? currentApplication?.name : undefined} />


      <Modal
        className="release-update-modal"
        title="版本记录"
        open={releaseModalOpen}
        onCancel={acknowledgeRelease}
        width={760}
        footer={[
          <Button key="ok" type="primary" onClick={acknowledgeRelease}>
            我知道了
          </Button>,
        ]}
      >
        <Space direction="vertical" size={14} className="release-update-content">
          {!!releaseRecords.length && (
            <div className="release-record-carousel">
              <div className="release-carousel-header">
                <div className="release-carousel-version-meta">
                  <span className="release-record-version">v{releaseRecords[activeReleaseIndex]?.version}</span>
                  {(releaseRecords[activeReleaseIndex]?.released_at || releaseRecords[activeReleaseIndex]?.date) && (
                    <span className="release-record-date">
                      {releaseRecords[activeReleaseIndex]?.released_at || releaseRecords[activeReleaseIndex]?.date}
                    </span>
                  )}
                </div>
                <div className="release-carousel-inline-actions">
                  <Button
                    aria-label="上一版本"
                    className="release-carousel-inline-button"
                    disabled={releaseRecords.length < 2}
                    icon={<LeftOutlined />}
                    size="small"
                    onClick={() => moveReleaseRecord(-1)}
                  >
                    上一版本
                  </Button>
                  <Button
                    aria-label="下一版本"
                    className="release-carousel-inline-button"
                    disabled={releaseRecords.length < 2}
                    icon={<RightOutlined />}
                    iconPosition="end"
                    size="small"
                    onClick={() => moveReleaseRecord(1)}
                  >
                    下一版本
                  </Button>
                </div>
              </div>
              <div className="release-carousel-shell">
                <div className="release-carousel-viewport">
                  <div className="release-carousel-track" style={{ transform: `translateX(-${activeReleaseIndex * 100}%)` }}>
                    {releaseRecords.map((record) => {
                      const sections = releaseRecordCategories(record);
                      return (
                        <section className="release-record-entry" key={`${record.version}-${record.released_at || record.date || ''}`}>
                          {record.title && <div className="release-record-title">{record.title}</div>}
                          {record.summary && <Typography.Paragraph className="release-record-summary">{record.summary}</Typography.Paragraph>}
                          <div className="release-category-list">
                            {sections.map((section) => (
                              <div className="release-category-block" key={`${record.version}-${section.key}`}>
                                <div className={`release-category-title release-category-${section.key}`}>{section.label}</div>
                                <ul>
                                  {section.items.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="release-carousel-dots">
                {releaseRecords.map((record, index) => (
                  <button
                    className={index === activeReleaseIndex ? 'release-carousel-dot is-active' : 'release-carousel-dot'}
                    key={`${record.version}-${index}`}
                    type="button"
                    onClick={() => setReleaseRecordIndex(index)}
                  >
                    <span>{record.version}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Space>
      </Modal>
    </Layout>
    </AiWorkbenchProvider>
  );
}

export default function App() {
  const { isAuthenticated, restore } = useAuthStore();
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!restored || isAuthenticated) return;
    // Warm the home route while the login form is visible, without mounting it.
    void import('./pages/Workspace').catch(() => undefined);
  }, [restored, isAuthenticated]);

  useEffect(() => {
    let mounted = true;
    restore().finally(() => {
      if (mounted) setRestored(true);
    });
    return () => {
      mounted = false;
    };
  }, [restore]);

  if (!restored) return <PageLoader />;

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace state={{ loginArrival: document.documentElement.dataset.loginTransition !== 'active' }} /> : <LoginPage />} />
      <Route path="/*" element={isAuthenticated ? <AppContent /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
