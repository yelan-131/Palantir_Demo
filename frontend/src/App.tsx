import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  BellOutlined,
  CheckOutlined,
  CloseOutlined,
  DashboardOutlined,
  DownloadOutlined,
  DownOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ShopOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import AccountMenu from './components/AccountMenu';
import AiChatWidget from './components/AiChatWidget';
import { AiWorkbenchProvider } from './components/AiChatWidget/context';
import GlobalSearch from './components/GlobalSearch';
import { useAuthStore } from './stores/authStore';
import {
  getCurrentRelease,
  listApplicationMenus,
  listApplications,
  wfApproveOrReject,
  wfListNotifications,
  wfMarkAllRead,
  wfMarkNotificationRead,
} from './services/api';

const WorkspacePage = lazy(() => import('./pages/Workspace'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const DataSourcePage = lazy(() => import('./pages/DataSource'));
const OntologyPage = lazy(() => import('./pages/Ontology'));
const GraphExplorerPage = lazy(() => import('./pages/GraphExplorer'));
const PipelinePage = lazy(() => import('./pages/Pipeline'));
const MaintenancePage = lazy(() => import('./pages/Maintenance'));
const QualityPage = lazy(() => import('./pages/Quality'));
const SupplyChainPage = lazy(() => import('./pages/SupplyChain'));
const AccountCenterPage = lazy(() => import('./pages/AccountCenter'));
const ReportCenterPage = lazy(() => import('./pages/ReportCenter'));
const DynamicPage = lazy(() => import('./pages/DynamicPage'));
const AppProgramPage = lazy(() => import('./pages/AppPrograms'));
const FormSettingsPage = lazy(() => import('./pages/FormSettings'));
const SystemAdminPage = lazy(() => import('./pages/SystemAdmin'));
const WorkflowPage = lazy(() => import('./pages/Workflow'));
const LoginPage = lazy(() => import('./pages/Login'));
const TemplateMarketPage = lazy(() => import('./pages/TemplateMarket'));
const RuleEnginePage = lazy(() => import('./pages/RuleEngine'));

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
  show_popup?: boolean;
}

const RELEASE_SEEN_STORAGE_KEY = 'mf_seen_release_version';

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
  'production-overview': '\u751f\u4ea7\u603b\u89c8',
  'oee-trend-report': 'OEE Trend Report',
  'line-status': '\u4ea7\u7ebf\u72b6\u6001',
  'line-load-analysis': 'Line Load Analysis',
  'production-plan-entry': 'Production Plan Entry',
  'device-health': '\u8bbe\u5907\u5065\u5eb7',
  'device-health-dashboard': 'Device Health Dashboard',
  'fault-prediction': 'Fault Prediction',
  'failure-trend-analysis': 'Failure Trend Analysis',
  'maintenance-order': 'Maintenance Order',
  'alert-center': '\u544a\u8b66\u4e2d\u5fc3',
  'quality-overview': '\u8d28\u91cf\u603b\u89c8',
  'inspection-batch': '\u68c0\u9a8c\u6279\u6b21',
  'defect-analysis-report': 'Defect Analysis Report',
  'process-capability-dashboard': 'Process Capability Dashboard',
  'defect-analysis': 'Defect Analysis',
  'quality-event': 'Quality Traceability',
  'supplier-risk': '\u4f9b\u5e94\u5546\u98ce\u9669',
  'supply-overview': '\u4f9b\u5e94\u603b\u89c8',
  'material-impact-report': 'Material Impact Report',
  'supply-risk-dashboard': 'Supply Risk Dashboard',
  'material-impact': '\u7269\u6599\u5f71\u54cd',
  'risk-review': '\u98ce\u9669\u590d\u6838',
};

function getRuntimePageTitle(pathname: string): string {
  if (pathname.startsWith('/dynamic/')) {
    return 'Dynamic Page';
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
    <div style={{ padding: 40 }}>
      <Spin size="large" tip={'\u52a0\u8f7d\u5de5\u4f5c\u53f0...'}>
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
        <div style={{ padding: 40 }}>
          <Typography.Title level={4} type="danger">{'\u9875\u9762\u6e32\u67d3\u5931\u8d25'}</Typography.Title>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#fff', padding: 16, borderRadius: 6 }}>
            {this.state.error}
          </pre>
          <Button type="primary" onClick={() => window.location.reload()}>{'\u91cd\u65b0\u52a0\u8f7d\u9875\u9762'}</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
function buildDynamicMenuTree(items: DynamicMenu[]): MenuProps['items'] {
  if (items.some((item) => item.children?.length)) {
    return items.map((item) => ({
      key: item.route_path || `dynamic-${item.id}`,
      icon: iconFor(item.icon),
      label: item.title,
      children: item.children?.length ? buildDynamicMenuTree(item.children) : undefined,
    }));
  }
  const map = new Map<number, any>();
  const roots: any[] = [];
  for (const item of items) {
    map.set(item.id, {
      key: item.route_path || `dynamic-${item.id}`,
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
    } else if (item.route_path) {
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

function findFirstDynamicMenuRoute(items: DynamicMenu[]): string | undefined {
  for (const item of items) {
    if (item.is_visible === false) continue;
    if (item.route_path) return item.route_path;
    const childRoute = item.children?.length ? findFirstDynamicMenuRoute(item.children) : undefined;
    if (childRoute) return childRoute;
  }
  return undefined;
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [collapsed, setCollapsed] = useState(false);
  const [dynamicMenus, setDynamicMenus] = useState<MenuProps['items']>([]);
  const [applications, setApplications] = useState<ApplicationInfo[]>([]);
  const [currentApplication, setCurrentApplication] = useState<ApplicationInfo | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
    listApplicationMenus(currentApplication.id)
      .then((res) => {
        const apiItems = res.data?.data || [];
        const items = apiItems
          .filter((m: DynamicMenu) => m.is_visible !== false);
        setDynamicMenus(buildDynamicMenuTree(items));
      })
      .catch(() => {
        message.error('\u5e94\u7528\u83dc\u5355\u52a0\u8f7d\u5931\u8d25');
        setDynamicMenus([]);
      });
  }, [currentApplication]);

  const loadNotifications = useCallback(() => {
    if (!user) return;
    wfListNotifications(user.id)
      .then((res) => {
        const data = res.data?.data || [];
        setNotifications(data);
        setUnread(data.filter((n: any) => !n.is_read).length);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useEffect(() => {
    getCurrentRelease()
      .then((res) => {
        const release = res.data;
        if (!release?.version || release.show_popup === false) return;
        const seenVersion = localStorage.getItem(RELEASE_SEEN_STORAGE_KEY);
        if (seenVersion === release.version) return;
        setReleaseInfo(release);
        setReleaseModalOpen(true);
      })
      .catch(() => {});
  }, []);

  const acknowledgeRelease = () => {
    if (releaseInfo?.version) {
      localStorage.setItem(RELEASE_SEEN_STORAGE_KEY, releaseInfo.version);
    }
    setReleaseModalOpen(false);
  };

  const allMenuItems = useMemo<MenuProps['items']>(() => {
    const appItems = dynamicMenus?.length ? unwrapApplicationMenuRoot(dynamicMenus) : [];
    return [workspaceMenuItem, { type: 'divider' }, ...(appItems || [])];
  }, [dynamicMenus]);
  const openMenuKeys = useMemo(() => {
    return (allMenuItems || [])
      .map((item) => (item && 'key' in item ? String(item.key) : ''))
      .filter(Boolean);
  }, [allMenuItems]);
  const selectedKey = location.pathname;
  const showRuntimePageBar =
    !location.pathname.startsWith('/program/')
    && !location.pathname.startsWith('/form-settings/')
    && !['/', '/workflow', '/system-admin', '/account-center'].includes(location.pathname);
  const runtimeTitle = getRuntimePageTitle(location.pathname);


  const breadcrumbItems = useMemo(() => {
    const title = getRuntimePageTitle(location.pathname);
    return [
      { title: <a onClick={() => navigate('/')}><HomeOutlined /></a> },
      { title },
    ];
  }, [location.pathname, navigate]);

  const handleApproval = (instId: number, action: string) => {
    const commentRef = React.createRef<any>();
    Modal.confirm({
      title: action === 'approve' ? 'Approve request' : 'Reject request',
      content: <Input.TextArea ref={commentRef} rows={3} placeholder="Approval comment" />,
      onOk: async () => {
        const comment = commentRef.current?.resizableTextArea?.textArea?.value
          ?? commentRef.current?.input?.value
          ?? '';
        try {
          await wfApproveOrReject(instId, { action, comment });
          message.success(action === 'approve' ? 'Approved' : 'Rejected');
          loadNotifications();
        } catch {
          message.error('Approval action failed');
        }
      },
    });
  };

  const switchApplication = (app: ApplicationInfo) => {
    setCurrentApplication(app);
    localStorage.setItem('mf_current_app_id', String(app.id));
    const defaultRoute = app.default_route || '/';
    navigate(defaultRoute);
  };

  const applicationMenu: MenuProps = {
    items: applications.map((app) => ({
      key: String(app.id),
      icon: iconFor(app.icon),
      label: (
        <div className="application-switch-item">
          <strong>{app.name}</strong>
          <span>{app.description || app.code}</span>
        </div>
      ),
      onClick: () => switchApplication(app),
    })),
  };

  const notificationSource = notifications;
  const notificationGroups = [
    { key: 'action', title: 'Action', empty: 'No action items', items: notificationSource.filter((n: any) => n.category === 'action' || n.type === 'approval' || n.type === 'returned') },
    { key: 'system', title: 'System', empty: 'No system notifications', items: notificationSource.filter((n: any) => n.category === 'system' || n.type === 'system') },
    { key: 'ai', title: 'AI', empty: 'No AI notifications', items: notificationSource.filter((n: any) => n.category === 'ai' || n.type === 'ai') },
  ];

  const renderNotificationLabel = (n: any) => (
    <div className="notification-menu-item" style={{ opacity: n.is_read ? 0.58 : 1 }}>
      <div style={{ fontWeight: n.is_read ? 500 : 700 }}>{n.title}</div>
      {n.content && <div style={{ fontSize: 12, color: '#5d6972', marginTop: 2 }}>{n.content}</div>}
      <div style={{ fontSize: 11, color: '#8a97a1', marginTop: 2 }}>{n.created_at?.slice(0, 16)}</div>
      {n.type === 'approval' && !n.is_read && (
        <div style={{ marginTop: 8 }}>
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleApproval(n.related_id || n.id, 'approve');
            }}
          >
            {'\u901a\u8fc7'}
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            style={{ marginLeft: 8 }}
            onClick={(e) => {
              e.stopPropagation();
              handleApproval(n.related_id || n.id, 'reject');
            }}
          >
            {'\u9a73\u56de'}
          </Button>
        </div>
      )}
    </div>
  );

  const notificationMenuItems: NonNullable<MenuProps['items']> = [
    { key: 'header', label: <strong>{'\u901a\u77e5\u4e2d\u5fc3'}</strong>, disabled: true },
    { type: 'divider' },
  ];

  notificationGroups.forEach((group) => {
    notificationMenuItems.push({ key: 'group-' + group.key, label: <strong>{group.title}</strong>, disabled: true });
    if (group.items.length) {
      group.items.slice(0, 4).forEach((n: any) => {
        notificationMenuItems.push({ key: String(n.id), label: renderNotificationLabel(n) });
      });
    } else {
      notificationMenuItems.push({ key: 'empty-' + group.key, label: group.empty, disabled: true });
    }
    notificationMenuItems.push({ type: 'divider' });
  });

  notificationMenuItems.push({
    key: 'mark-all',
    label: 'Mark all as read',
    onClick: async () => {
      if (!user) return;
      await wfMarkAllRead(user.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnread(0);
    },
  });

  const notificationMenu: MenuProps = {
    items: notificationMenuItems,
    onClick: ({ key }) => {
      const keyText = String(key);
      if (keyText === 'header' || keyText === 'mark-all' || keyText.startsWith('group-') || keyText.startsWith('empty-')) return;
      const matched = notificationSource.find((n: any) => String(n.id) === keyText);
      if (!matched) return;
      if (typeof matched.id === 'number') wfMarkNotificationRead(matched.id).catch(() => {});
      setNotifications((prev) => prev.map((n) => (String(n.id) === keyText ? { ...n, is_read: true } : n)));
      if (!matched.is_read) setUnread((prev) => Math.max(0, prev - 1));
      navigate(matched.target_path || (matched.category === 'ai' ? '/ai-assistant' : matched.category === 'system' ? '/account-center?section=app-menu' : '/workflow'));
    },
  };

  const siderWidth = collapsed ? 68 : 236;

  return (
    <AiWorkbenchProvider>
    <Layout className="app-shell density-standard">
      <Sider
        width={236}
        collapsedWidth={68}
        collapsed={collapsed}
        trigger={null}
        theme="light"
        className="app-sider"
        style={{ height: 'calc(100vh / var(--app-ui-scale))', position: 'fixed', left: 0, top: 0, bottom: 0 }}
      >
        <div className="app-brand">
          <span className="app-brand-mark">MF</span>
          {!collapsed && (
            <span className="app-brand-title">
              <strong>ManuFoundry</strong>
              <span>Low-code Analytics</span>
            </span>
          )}
        </div>
        <Menu
          key={`menu-${currentApplication?.id || 'default'}-${openMenuKeys.join('|')}-${collapsed ? 'collapsed' : 'open'}`}
          className="app-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={collapsed ? [] : openMenuKeys}
          items={allMenuItems}
          onClick={({ key }) => navigate(String(key))}
        />
      </Sider>

      <Layout style={{ marginLeft: siderWidth, transition: 'margin-left 0.2s' }}>
        <Header className="app-header">
          <Space size={14} align="center">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Dropdown menu={applicationMenu} trigger={['click']} disabled={!applications.length}>
              <Button className="application-switch-button" icon={iconFor(currentApplication?.icon)}>
                <span>{currentApplication?.name || '\u9009\u62e9\u5e94\u7528'}</span>
                <DownOutlined />
              </Button>
            </Dropdown>
            <Breadcrumb items={breadcrumbItems} />
          </Space>

          <Space size={12} align="center">
            <Button
              className="app-search-button"
              icon={<SearchOutlined />}
              onClick={() => setSearchOpen(true)}
            >
              {'\u641c\u7d22\u5e94\u7528\u3001\u6570\u636e\u8d44\u4ea7\u6216\u914d\u7f6e Ctrl+K'}
            </Button>
            <Dropdown menu={notificationMenu} trigger={['click']}>
              <Badge count={unread} size="small">
                <Button type="text" icon={<BellOutlined />} />
              </Badge>
            </Dropdown>
            <AccountMenu
              user={user}
              onNavigate={navigate}
              onLogout={() => {
                logout();
                navigate('/login');
              }}
            />
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
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/data-sources" element={<DataSourcePage />} />
                  <Route path="/ontology" element={<OntologyPage />} />
                  <Route path="/graph" element={<GraphExplorerPage />} />
                  <Route path="/pipeline" element={<PipelinePage />} />
                  <Route path="/maintenance" element={<MaintenancePage />} />
                  <Route path="/quality" element={<QualityPage />} />
                  <Route path="/supply-chain" element={<SupplyChainPage />} />
                  <Route path="/ai-assistant" element={<Navigate to="/" replace />} />
                  <Route path="/account-center" element={<AccountCenterPage currentApplication={currentApplication} />} />
                  <Route path="/reports" element={<ReportCenterPage />} />
                  <Route path="/dynamic/:slug" element={<DynamicPage />} />
                  <Route path="/program/:programId" element={<AppProgramPage />} />
                  <Route path="/form-settings/:formId" element={<FormSettingsPage />} />
                  <Route path="/system-admin" element={<SystemAdminPage />} />
                  <Route path="/workflow" element={<WorkflowPage />} />
                  <Route path="/templates" element={<TemplateMarketPage />} />
                  <Route path="/rules" element={<RuleEnginePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </div>
        </Content>
      </Layout>

      <AiChatWidget pageTitle={runtimeTitle} applicationName={currentApplication?.name} />

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <Modal
        title={releaseInfo?.title || 'Release update'}
        open={releaseModalOpen}
        onCancel={acknowledgeRelease}
        footer={[
          <Button key="ok" type="primary" onClick={acknowledgeRelease}>
            Got it
          </Button>,
        ]}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">Current version</Typography.Text>
            <Typography.Title level={4} style={{ margin: '4px 0 0' }}>
              v{releaseInfo?.version}
            </Typography.Title>
            {releaseInfo?.released_at && (
              <Typography.Text type="secondary">Released at: {releaseInfo.released_at}</Typography.Text>
            )}
          </div>
          {releaseInfo?.summary && <Typography.Paragraph>{releaseInfo.summary}</Typography.Paragraph>}
          {!!releaseInfo?.highlights?.length && (
            <div>
              <Typography.Text strong>Highlights</Typography.Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {releaseInfo.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {!!releaseInfo?.details?.length && (
            <div>
              <Typography.Text strong>Details</Typography.Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {releaseInfo.details.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
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
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={isAuthenticated ? <AppContent /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
