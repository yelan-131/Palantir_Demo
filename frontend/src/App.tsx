import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  ConfigProvider,
  Empty,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Spin,
  Skeleton,
  Typography,
  Tooltip,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  CheckOutlined,
  CloseOutlined,
  DatabaseOutlined,
  DownOutlined,
  HomeOutlined,
  HistoryOutlined,
  LeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
  UserOutlined,
} from '@/components/Icon/ant';
import { ApplicationRail, ApplicationLibrary, ExtensionLibrary, shellIcon, useApplicationLibrary, type LibraryApp } from './components/ShellNavigation';
import { normalizeShellMenu, shellMenuAncestors, applicationNavigation, hasApplicationPage, resolveApplicationEntry } from './utils/shellMenu';
import { useShellPreferences } from './hooks/useShellPreferences';
import AiChatWidget from './components/AiChatWidget';
import { AiPageActionRouter } from './components/AiChatWidget/pageControls';
import type { ApplicationNavigationAction } from './components/AiChatWidget/pageControls';
import { resolveNavigationTarget } from './components/AiChatWidget/navigationTarget';
import { AiWorkbenchProvider } from './components/AiChatWidget/context';
import GlobalSearch from './components/GlobalSearch';
import ShellPageTitle, { ShellPageTitleProvider } from './components/ShellPageTitle';
import NotificationCenter from './components/NotificationCenter';
import { useThemeCard } from './theme/ThemeCardProvider';
import { formSettingsRedirect, newBusinessFormDesignPath, settingsNavigationGroups, settingsDestinationKey, LEGACY_ROUTES, NAVIGATION_AREAS, NAVIGATION_ENTRIES, navigationAreaForPath } from './config/navigation';
import { useAuthStore } from './stores/authStore';
import {
  getCurrentRelease,
  listApplicationMenus,
  listApplications,
} from './services/api';
import { CLIENT_RENDER_ERROR } from './services/errorDiagnostics';

const NavigationAreaPage = lazy(() => import('./pages/NavigationArea'));
const AccountEntry = lazy(() => import('./pages/NavigationArea').then(module => ({ default: module.AccountEntry })));

const SchedulerPage = lazy(() => import('./pages/Scheduler'));
const WorkspacePage = lazy(() => import('./pages/Workspace'));
const ComponentPages = lazy(() => import('./pages/ComponentPages'));
const WorkbenchDesignPreview = lazy(() => import('./components/AiChatWidget/WorkbenchDesignPreview'));
const FormPageEntry = lazy(() => import('./pages/ComponentPages/FormPageEntry'));
const FormSettingsPage = lazy(() => import('./pages/FormSettings'));
const WorkflowPage = lazy(() => import('./pages/Workflow'));
const MaterialApplicationsPage = lazy(() => import('./pages/MaterialApplications'));
const LoginPage = lazy(() => import('./pages/Login'));

function WorkspaceRoutes({ allowPreview, children }: { allowPreview: boolean; children: React.ReactNode }) {
  const location = useLocation();
  return allowPreview && location.state?.aiDesignPreviewId
    ? <WorkbenchDesignPreview>{children}</WorkbenchDesignPreview>
    : <>{children}</>;
}

function FormSettingsEntry({isAdmin}: {isAdmin: boolean}) {
  const { formId } = useParams();
  const { search, state } = useLocation();
  if (isAdmin && formId && formId !== 'new' && new URLSearchParams(search).get('tab') === 'permission') {
    return <FormSettingsPage key={formId} formId={formId} initialTab="permission" />;
  }
  return <Navigate to={formSettingsRedirect(formId, search)} state={state} replace />;
}

function NewBusinessFormDesigner() {
  const { search, state } = useLocation();
  const draftId = new URLSearchParams(search).get('draft');
  if (!draftId || state?.aiFormDraft?.id !== draftId) return <Navigate to="/studio/business-data" replace />;
  return <FormSettingsPage key={draftId} formId="new" initialTab="form" />;
}

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
  updated_at?: string | null;
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
  updated_at?: string | null;
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
    updated_at: release.updated_at,
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
  '/dashboard': '/program/production-overview',
  '/maintenance': '/program/device-health',
  '/quality': '/program/quality-overview',
  '/dynamic/equipment-inspection': '/program/equipment-inspection',
  '/dynamic/inventory-impact': '/program/inventory-impact',
  '/dynamic/supplier-scorecard': '/program/supplier-scorecard',
  '/supply-chain': '/program/supply-overview',
};

function normalizeRuntimeRoute(routePath?: string): string {
  if (!routePath) return '';
  return runtimeRouteAliasMap[routePath] || routePath;
}

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
  '/workflow': '流程与待办',
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
}

function PageLoader() {
  return (
    <div className="shell-page-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="shell-loading-label">正在加载页面…</span>
      <div aria-hidden="true"><Skeleton active title={{ width: '36%' }} paragraph={{ rows: 5, width: ['75%', '92%', '84%', '92%', '60%'] }} /></div>
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
            <div>错误码 {CLIENT_RENDER_ERROR}</div>
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
  // The global workspace and material requests have their own navigation.
  items = items.filter(item => {
    const route = (item.route_path || '').split('#')[0].replace(/\/$/, '');
    return item.is_visible !== false && !['/program/material-application', '/workflow?section=materials'].includes(route)
      && item.route_path !== '/';
  });
  if (items.some((item) => item.children?.length)) {
    return items.map((item) => ({
      key: normalizeRuntimeRoute(item.route_path) || `dynamic-${item.id}`,
      icon: shellIcon(item.icon),
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
      icon: shellIcon(item.icon),
      label: item.title,
      children: [],
    });
  }
  for (const item of items) {
    const node = map.get(item.id);
    if (!node) continue;
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots.filter(node => node.children.length || !String(node.key).startsWith('dynamic-'))
    .map(node => (node.children.length ? node : { ...node, children: undefined }));
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
  const { canonTheme } = useThemeCard();
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
  const [menuResult, setMenuResult] = useState<{ app: ApplicationInfo; items?: MenuProps['items']; failed: boolean }>();
  const [menuRetry, setMenuRetry] = useState(0);
  const [applications, setApplications] = useState<ApplicationInfo[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [selectedApplication, setSelectedApplication] = useState<ApplicationInfo | null>(null);
  // A navigation blocked by unsaved edits must keep the previous application selected.
  const routeApplication = applications.find(app => app.id === location.state?.applicationId);
  const currentApplication = location.state?.applicationId ? routeApplication : selectedApplication;
  const currentMenus = menuResult?.app === currentApplication ? menuResult : undefined;
  const dynamicMenus = currentMenus?.items;
  const isApplicationEntry = location.pathname === '/' && Boolean(location.state?.applicationId);
  const applicationEntryRoute = routeApplication && currentMenus && !currentMenus.failed
    ? resolveApplicationEntry(dynamicMenus, normalizeRuntimeRoute(routeApplication.default_route))
    : undefined;
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [acknowledgedRelease, setAcknowledgedRelease] = useState(() => {
    try { return localStorage.getItem('mf_acknowledged_release'); } catch { return null; }
  });
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseRecordIndex, setReleaseRecordIndex] = useState(0);
  const library = useApplicationLibrary(applications);
  const defaultApplicationPending = useRef(location.pathname === '/' && !location.state?.workspaceHome && !location.state?.applicationId);

  useEffect(() => {
    if (!defaultApplicationPending.current) return;
    if (location.pathname !== '/' || location.state?.workspaceHome || location.state?.applicationId) {
      defaultApplicationPending.current = false;
      return;
    }
    const first = library.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned))[0]?.application;
    if (!first) return;
    defaultApplicationPending.current = false;
    navigate('/', { replace: true, state: { ...location.state, applicationId: first.id } });
  }, [library, location.pathname, location.state, navigate]);
  const isApplicationWorkspace = activeArea === 'business' && (isApplicationEntry || !['/', '/workflow', '/account-center', '/scheduler', '/plugins', '/more'].includes(location.pathname));
  const isAccountPage = location.pathname === '/account-center';
  const isKnowledgeWorkspace = ['/data-center/knowledge', '/admin/knowledge'].includes(location.pathname);
  const railKey = isKnowledgeWorkspace ? 'knowledge' : isAccountPage || activeArea === 'admin' || activeArea === 'studio' || activeArea === 'data' || activeArea === 'plugins' ? 'account'
    : location.pathname === '/more' ? 'more'
    : location.pathname === '/workflow' ? 'workflow'
    : location.pathname === '/scheduler' ? 'scheduler'
    : isApplicationWorkspace && currentApplication ? `app:${currentApplication.id}` : 'home';
  const isSettingsWorkspace = isAccountPage || activeArea !== 'business';
  const sidebarTitle = isSettingsWorkspace ? '设置中心'
    : isApplicationWorkspace && currentApplication ? library.find(app => app.id === `app:${currentApplication.id}`)?.name || currentApplication.name : '工作台';



  useEffect(() => {
    const loadApplications = () => listApplications()
      .then((res) => {
        const apps: ApplicationInfo[] = res.data?.data || [];
        setApplications(apps);
        if (!apps.length) {
          setSelectedApplication(null);
          return;
        }
        const storedId = Number(localStorage.getItem('mf_current_app_id'));
        const matched = apps.find((app) => app.id === storedId) || apps[0];
        setSelectedApplication(matched);
        localStorage.setItem('mf_current_app_id', String(matched.id));
      })
      .catch(() => {
        message.error('\u5e94\u7528\u5217\u8868\u52a0\u8f7d\u5931\u8d25');
        setApplications([]);
        setSelectedApplication(null);
      })
      .finally(() => setApplicationsLoading(false));
    loadApplications();
    window.addEventListener('applications-changed', loadApplications);
    return () => window.removeEventListener('applications-changed', loadApplications);
  }, []);

  useEffect(() => {
    if (!routeApplication) return;
    setSelectedApplication(routeApplication);
    localStorage.setItem('mf_current_app_id', String(routeApplication.id));
  }, [routeApplication]);

  useEffect(() => {
    if (!currentApplication) return;
    let cancelled = false;
    listApplicationMenus(currentApplication.id)
      .then((res) => {
        if (cancelled) return;
        setMenuResult({ app: currentApplication, items: buildDynamicMenuTree(res.data?.data || []), failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setMenuResult({ app: currentApplication, failed: true });
      });
    return () => { cancelled = true; };
  }, [currentApplication, activeArea, menuRetry]);

  useEffect(() => {
    if (isApplicationEntry && applicationEntryRoute) {
      navigate(applicationEntryRoute, { replace: true, state: location.state });
    }
  }, [isApplicationEntry, applicationEntryRoute, location.state, navigate]);

  // Resolve bookmarked and search-result runtime pages to their actual application.
  useEffect(() => {
    if (location.state?.applicationId || !isApplicationWorkspace || !currentApplication || !currentMenus || currentMenus.failed || location.pathname === '/') return;
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
            return findMenuLabelPath(buildDynamicMenuTree(response.data?.data || []), route) ? app : undefined;
          } catch { return undefined; }
        }));
        owner = results.find(Boolean);
      }
      if (!cancelled && owner && owner.id !== currentApplication.id) {
        setSelectedApplication(owner);
        localStorage.setItem('mf_current_app_id', String(owner.id));
      }
    };
    void resolve();
    return () => { cancelled = true; };
  }, [location, isApplicationWorkspace, currentApplication, currentMenus, dynamicMenus, applications]);

  useEffect(() => {
    getCurrentRelease()
      .then((res) => {
        const release = res.data;
        if (!release?.version) return;
        setReleaseInfo(release);
      })
      .catch(() => {});
  }, []);

  const acknowledgeRelease = () => {
    if (!releaseInfo?.version) return;
    setAcknowledgedRelease(releaseInfo.version);
    try { localStorage.setItem('mf_acknowledged_release', releaseInfo.version); } catch { /* Acknowledge for this session. */ }
  };
  const openReleaseHistory = () => {
    acknowledgeRelease();
    setReleaseRecordIndex(0);
    setReleaseModalOpen(true);
  };
  const showReleaseNotice = location.pathname === '/' && !isApplicationWorkspace
    && releaseInfo && releaseInfo.show_popup !== false && releaseInfo.version !== acknowledgedRelease;

  const applicationMenuItems = isApplicationWorkspace ? dynamicMenus : undefined;
  const showContextMenu = !isKnowledgeWorkspace && (isSettingsWorkspace || hasApplicationPage(applicationMenuItems));
  const mobileMenuWasOpen = React.useRef(false);
  useEffect(() => {
    const isOpen = showContextMenu && smallViewport && !collapsed;
    const restoreFocus = mobileMenuWasOpen.current && smallViewport;
    if (isOpen) document.getElementById('shell-context-menu')?.querySelector<HTMLButtonElement>('.shell-menu-heading button')?.focus();
    else if (restoreFocus) document.querySelector<HTMLButtonElement>('.shell-mobile-menu-toggle')?.focus();
    mobileMenuWasOpen.current = isOpen;
  }, [showContextMenu, smallViewport, collapsed]);
  useEffect(() => {
    if (!showContextMenu || !smallViewport || collapsed) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTemporaryMenuExpanded(false);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [showContextMenu, smallViewport, collapsed]);

  const rawMenuItems = useMemo<MenuProps['items']>(() => {
    if (isSettingsWorkspace) {
      const icons: Record<string, React.ReactNode> = { personal: <UserOutlined />, applications: <AppstoreOutlined />, data: <DatabaseOutlined />, platform: <SafetyCertificateOutlined />, advanced: <ToolOutlined /> };
      return [
        ...settingsNavigationGroups(isAdmin).map(group => ({ key: group.key, label: group.label, icon: icons[group.icon], children: group.entries.map(entry => ({ key: entry.path, label: entry.label })) })),
      ];
    }
    if (!isApplicationWorkspace) return [workspaceMenuItem];
    return applicationNavigation(workspaceMenuItem, applicationMenuItems);
  }, [applicationMenuItems, isAdmin, isApplicationWorkspace, isSettingsWorkspace]);

  const allMenuItems = useMemo(() => normalizeShellMenu(rawMenuItems, <AppstoreOutlined />), [rawMenuItems]);
  const selectedKey = isSettingsWorkspace ? settingsDestinationKey(location.pathname, location.search) : normalizeRuntimeRoute(location.pathname) || location.pathname;
  const menuScope = isSettingsWorkspace ? 'settings' : activeArea + ':' + railKey + ':' + (currentApplication?.id || 'default');
  const [menuOpenByScope, setMenuOpenByScope] = useState<Record<string, string[]>>({});
  const activeAncestors = useMemo(() => shellMenuAncestors(allMenuItems, selectedKey) || [], [allMenuItems, selectedKey]);
  const menuOpenKeys = menuOpenByScope[menuScope] || activeAncestors;
  useEffect(() => {
    setMenuOpenByScope(previous => {
      const current = previous[menuScope] || [];
      const next = isSettingsWorkspace ? activeAncestors : [...new Set([...current, ...activeAncestors])];
      return previous[menuScope] && next.length === current.length && next.every((key, index) => key === current[index]) ? previous : { ...previous, [menuScope]: next };
    });
  }, [menuScope, selectedKey, activeAncestors, isSettingsWorkspace]);
  const currentMenuTitle = useMemo(() => {
    const path = findMenuLabelPath(allMenuItems, selectedKey);
    return path?.length ? path[path.length - 1] : undefined;
  }, [allMenuItems, selectedKey]);
  const isBusinessDataDesign = /^\/studio\/business-data\/[^/]+\/design\/?$/.test(location.pathname);
  const runtimeTitle = isApplicationEntry ? currentApplication?.name || '应用' : isAccountPage ? '账号设置' : location.pathname === '/more' ? '应用中心' : location.pathname === '/scheduler' ? '日常任务' : location.pathname === '/plugins' ? '插件与扩展' : isBusinessDataDesign ? '业务数据设计' : areaEntry?.label || currentMenuTitle || (activeArea !== 'business' ? activeAreaInfo.label : getRuntimePageTitle(location.pathname));
  const releaseRecords = normalizeReleaseRecords(releaseInfo);
  const activeReleaseIndex = releaseRecords.length
    ? Math.min(releaseRecordIndex, releaseRecords.length - 1)
    : 0;
  const activeRelease = releaseRecords[activeReleaseIndex];

  useEffect(() => {
    if (!releaseModalOpen) return;
    setReleaseRecordIndex(0);
  }, [releaseModalOpen, releaseInfo?.version]);

  const moveReleaseRecord = (direction: -1 | 1) => {
    if (!releaseRecords.length) return;
    setReleaseRecordIndex((current) => Math.max(0, Math.min(current + direction, releaseRecords.length - 1)));
  };


  const switchApplication = (app: ApplicationInfo, target?: { id: string; path?: string }) => {
    navigate(target?.path || '/', { state: { applicationId: app.id, ...(target && { aiNavigationId: target.id }) } });
  };

  const openAiWorkspaceTarget = async (action: ApplicationNavigationAction, active: () => boolean) => {
    const app = action.application
      ? resolveNavigationTarget(applications, action.application, item => item.name, item => item.code)
      : isApplicationWorkspace ? currentApplication : undefined;
    if (!app) throw new Error(action.application ? `没找到可访问的应用「${action.application}」。` : '请先指定菜单页所属的应用。');
    let path = '/';
    let pageName: string | undefined;
    if (action.action === 'open_page') {
      const response = await listApplicationMenus(app.id);
      const flatten = (menus: DynamicMenu[]): DynamicMenu[] => menus.filter(menu => menu.is_visible !== false)
        .flatMap(menu => [menu, ...flatten(menu.children || [])]);
      const menus = flatten(response.data?.data || []).filter(menu => Boolean(menu.route_path));
      const menu = resolveNavigationTarget(menus, action.page, item => item.title);
      if (!menu) throw new Error(`在「${app.name}」里没找到可访问的菜单页「${action.page}」。`);
      path = menu.route_path || '/';
      pageName = menu.title;
    }
    const pathname = path.split(/[?#]/, 1)[0];
    const route = normalizeRuntimeRoute(pathname) + path.slice(pathname.length);
    if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) throw new Error('目标入口地址无效。');
    if (active()) switchApplication(app, { id: action.id, path: route });
    return { application_id: app.id, application_name: app.name, page_name: pageName };
  };

  const openWorkspace = () => navigate('/', { state: { workspaceHome: true } });

  const openLibraryApp = (entry: LibraryApp) => {
    if (entry.application) switchApplication(entry.application);
    else navigate(entry.path);
  };
  const retryApplicationMenus = () => {
    setMenuResult(undefined);
    setMenuRetry(value => value + 1);
  };

  const renderHome = () => {
    if (!isApplicationEntry) {
      return defaultApplicationPending.current && (applicationsLoading || applications.length > 0)
        ? <PageLoader /> : <WorkspacePage />;
    }
    if (applicationsLoading || routeApplication && (!currentMenus || applicationEntryRoute)) return <PageLoader />;
    if (!routeApplication) return <div className="shell-page-error"><Alert type="warning" showIcon message="此应用不可用" /></div>;
    return <div className="shell-page-error">
      <Typography.Title level={2}>{sidebarTitle}</Typography.Title>
      {currentMenus?.failed
        ? <Alert type="error" showIcon message="应用菜单加载失败" action={<Button onClick={retryApplicationMenus}>重试</Button>} />
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此应用暂无可访问的页面" />}
    </div>;
  };


  return (
    <ShellPageTitleProvider fallback={runtimeTitle}>
    <AiWorkbenchProvider>
    <AiPageActionRouter onOpenWorkspaceTarget={openAiWorkspaceTarget}
      applicationReady={location.pathname !== '/' || Boolean(isApplicationEntry && currentMenus && !currentMenus.failed && !applicationEntryRoute)} />
    <Layout className={`app-shell tech-white-shell density-${preferences.density}${isKnowledgeWorkspace ? ' shell-knowledge-workspace' : preferences.layout === 'float' ? ' shell-layout-float' : ''}${showContextMenu && smallViewport && !collapsed ? ' shell-menu-overlay-open' : ''}${loginArrival ? ' login-arrival' : ''}`}>
      <a className="shell-skip-link" href="#workspace-main">跳转到页面内容</a>
      <ApplicationRail library={library} onOpen={openLibraryApp} onHome={openWorkspace} activeKey={railKey} user={user} onLogout={() => { logout(); navigate('/login'); }} />
      {showContextMenu && smallViewport && !collapsed && <button className="shell-menu-backdrop" aria-label="收起菜单栏" onClick={() => setCollapsed(true)} />}
      <ConfigProvider theme={canonTheme}>
      {showContextMenu && <Sider id="shell-context-menu" width={216} collapsedWidth={smallViewport ? 0 : 64} collapsed={collapsed} trigger={null} theme="light" className="app-sider shell-context-menu shell-hierarchy-menu" aria-label="菜单栏" aria-hidden={smallViewport && collapsed || undefined} onTransitionEnd={(event) => { if (smallViewport && !collapsed && event.target === event.currentTarget && event.propertyName === 'width') event.currentTarget.querySelector<HTMLButtonElement>('.shell-menu-heading button')?.focus(); }}>
        <div className="shell-menu-heading">
          {!collapsed && <Typography.Text strong ellipsis>{sidebarTitle}</Typography.Text>}
          <Tooltip title={collapsed ? '展开菜单栏' : '折叠菜单栏'}><Button type="text" aria-label={collapsed ? '展开菜单栏' : '折叠菜单栏'} icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} /></Tooltip>
        </div>
        <Menu key={menuScope + String(collapsed)} className={`app-menu${activeArea === 'business' ? ' shell-workspace-menu' : ''}`} mode="inline" inlineIndent={8} inlineCollapsed={collapsed} selectedKeys={[selectedKey]} {...(!collapsed ? { openKeys: menuOpenKeys, onOpenChange: (keys: string[]) => setMenuOpenByScope(previous => ({ ...previous, [menuScope]: isSettingsWorkspace ? keys.slice(-1) : keys })) } : { defaultOpenKeys: [] })} items={allMenuItems} onClick={({ key }) => { if (smallViewport) setTemporaryMenuExpanded(false); if (String(key).startsWith('application:')) { const app = applications.find(item => item.id === Number(String(key).split(':')[1])); if (app) switchApplication(app); } else if (String(key).startsWith('/')) { if (key === '/') openWorkspace(); else navigate(String(key), { state: isApplicationWorkspace && currentApplication ? { applicationId: currentApplication.id } : undefined }); } }} />
      </Sider>}
      </ConfigProvider>
      <Layout className={`shell-workspace-layout${showContextMenu ? '' : ' shell-without-context-menu'}`} {...(showContextMenu && smallViewport && !collapsed ? { inert: '' } : {})}>
        {!isKnowledgeWorkspace && <ConfigProvider theme={canonTheme}><Header className="app-header">
          {showContextMenu && <Button className="shell-mobile-menu-toggle" type="text" aria-label="打开菜单栏" aria-controls="shell-context-menu" aria-expanded={!collapsed} icon={<MenuUnfoldOutlined />} onClick={() => setCollapsed(false)} />}
          {location.pathname !== '/' && <ShellPageTitle section={showContextMenu ? sidebarTitle : undefined} />}
          {showReleaseNotice && <div className="shell-release-notice">
            <Button type="link" onClick={openReleaseHistory}>版本更新 v{releaseInfo.version}</Button>
            <Button type="text" size="small" onClick={acknowledgeRelease} aria-label="关闭版本提示" icon={<CloseOutlined />} />
          </div>}

          <GlobalSearch />
          <Space className="shell-header-actions" size={4} align="center">
            {releaseInfo && (
              <Tooltip title={`版本记录 · 当前 v${releaseInfo.version}`}>
                <Button
                  type="text"
                  icon={<HistoryOutlined />}
                  aria-label={`v${releaseInfo.version}，查看版本记录`}
                  onClick={openReleaseHistory}
                />
              </Tooltip>
            )}
            <NotificationCenter />

          </Space>
        </Header></ConfigProvider>}

        <Content id="workspace-main" className="app-content" tabIndex={-1} aria-label="页面内容">
          <div className="content-surface">
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <WorkspaceRoutes allowPreview={isAdmin}>
                <Routes>
                  <Route path="/" element={renderHome()} />
                  <Route path="/more" element={<ApplicationLibrary library={library} onOpen={openLibraryApp} />} />
                  <Route path="/scheduler" element={<SchedulerPage />} />
                  <Route path="/plugins" element={<ExtensionLibrary isAdmin={isAdmin} />} />
                  <Route path="/dashboard" element={<Navigate to={normalizeRuntimeRoute('/dashboard') + location.search} replace />} />

                  <Route path="/maintenance" element={<Navigate to={normalizeRuntimeRoute('/maintenance') + location.search} replace />} />
                  <Route path="/quality" element={<Navigate to={normalizeRuntimeRoute('/quality') + location.search} replace />} />
                  <Route path="/supply-chain" element={<Navigate to={normalizeRuntimeRoute('/supply-chain') + location.search} replace />} />
                  <Route path="/ai-assistant" element={<Navigate to="/" replace />} />
                  <Route path="/account-center" element={<AccountEntry currentApplication={currentApplication} />} />

                  <Route path="/dynamic/:slug" element={<FormPageEntry kind="business" />} />
                  <Route path="/pages/:code" element={<ComponentPages />} />
                  <Route path="/program/alert-center" element={<FormPageEntry kind="program" formSlug="alert-center" />} />
                  <Route path="/program/material-application" element={<MaterialApplicationsPage />} />
                  <Route path="/program/:programId" element={<FormPageEntry kind="program" />} />
                  <Route path="/form-settings/:formId" element={<FormSettingsEntry isAdmin={isAdmin} />} />
                  <Route path={newBusinessFormDesignPath} element={isAdmin ? <NewBusinessFormDesigner /> : <Navigate to="/studio/business-data" replace />} />
                  <Route path="/studio/business-data/:slug/design" element={isAdmin
                    ? <FormPageEntry kind="business" businessDataDesign />
                    : <Navigate to="/studio/business-data" replace />} />
                  <Route path="/studio/*" element={<NavigationAreaPage />} />
                  <Route path="/data-center/*" element={<NavigationAreaPage />} />
                  <Route path="/admin/*" element={<NavigationAreaPage />} />
                  {Object.entries(LEGACY_ROUTES).map(([path, target]) => <Route key={path} path={path} element={<Navigate to={target + location.search} replace />} />)}

                  <Route path="/workflow" element={<WorkflowPage />} />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </WorkspaceRoutes>
              </Suspense>
            </ErrorBoundary>
          </div>
        </Content>
      </Layout>

      <AiChatWidget
        enabled={preferences.aiBubbleVisible}
        pageTitle={runtimeTitle}
        applicationName={activeArea === 'business' && !isAccountPage || isBusinessDataDesign ? currentApplication?.name : undefined}
        applicationId={activeArea === 'business' && !isAccountPage || isBusinessDataDesign ? currentApplication?.id : undefined}
      />


      <Modal
        className="release-update-modal"
        title="版本记录"
        open={releaseModalOpen}
        onCancel={() => setReleaseModalOpen(false)}
        width={760}
        footer={null}
      >
        <Space direction="vertical" size={14} className="release-update-content">
          {activeRelease && (
            <div className="release-record-carousel">
              <div className="release-carousel-header">
                <div className="release-carousel-version-meta">
                  <span className="release-record-version">v{activeRelease.version}</span>
                  {(activeRelease.released_at || activeRelease.date || activeRelease.updated_at) && (
                    <span className="release-record-date">
                      {activeRelease.released_at || activeRelease.date || `更新于 ${activeRelease.updated_at}`}
                    </span>
                  )}
                </div>
                <div className="release-carousel-inline-actions">
                  <Button
                    aria-label="上一版本"
                    className="release-carousel-inline-button"
                    disabled={activeReleaseIndex >= releaseRecords.length - 1}
                    icon={<LeftOutlined />}
                    size="small"
                    onClick={() => moveReleaseRecord(1)}
                  >
                    上一版本
                  </Button>
                  <Button
                    aria-label="下一版本"
                    className="release-carousel-inline-button"
                    disabled={activeReleaseIndex === 0}
                    icon={<RightOutlined />}
                    iconPosition="end"
                    size="small"
                    onClick={() => moveReleaseRecord(-1)}
                  >
                    下一版本
                  </Button>
                </div>
              </div>
              <div className="release-record-scroll" key={activeReleaseIndex} tabIndex={0} aria-label="版本变更详情">
                  <section className="release-record-entry">
                    {activeRelease.title && <div className="release-record-title">{activeRelease.title}</div>}
                    {activeRelease.summary && <Typography.Paragraph className="release-record-summary">{activeRelease.summary}</Typography.Paragraph>}
                    {releaseRecordCategories(activeRelease).map(section => (
                      <div className="release-category-block" key={section.key}>
                        <h3 className="release-category-title">{section.label}</h3>
                        <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>
                      </div>
                    ))}
                  </section>
              </div>
            </div>
          )}
        </Space>
      </Modal>
    </Layout>
    </AiWorkbenchProvider>
    </ShellPageTitleProvider>
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
