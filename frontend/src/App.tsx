import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Input,
  Layout,
  Menu,
  Modal,
  Segmented,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  CheckOutlined,
  CloseOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  HomeOutlined,
  LayoutOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
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
import GlobalSearch from './components/GlobalSearch';
import { useAuthStore } from './stores/authStore';
import {
  listMenus,
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
const AIAssistantPage = lazy(() => import('./pages/AIAssistant'));
const ReportCenterPage = lazy(() => import('./pages/ReportCenter'));
const ModelDrivenPage = lazy(() => import('./pages/ModelDriven'));
const DynamicPage = lazy(() => import('./pages/DynamicPage'));
const SystemAdminPage = lazy(() => import('./pages/SystemAdmin'));
const WorkflowPage = lazy(() => import('./pages/Workflow'));
const LoginPage = lazy(() => import('./pages/Login'));
const MyApplicationsPage = lazy(() => import('./pages/Workflow/MyApplications'));
const TemplateMarketPage = lazy(() => import('./pages/TemplateMarket'));
const RuleEnginePage = lazy(() => import('./pages/RuleEngine'));

const { Header, Sider, Content } = Layout;

type Density = 'compact' | 'standard' | 'relaxed';

interface DynamicMenu {
  id: number;
  parent_id: number | null;
  title: string;
  route_path: string;
  is_visible: boolean;
}

const businessMenuItems: MenuProps['items'] = [
  { key: '/', icon: <HomeOutlined />, label: '我的工作台' },
  { key: '/dashboard', icon: <DashboardOutlined />, label: '生产态势' },
  { key: '/maintenance', icon: <ToolOutlined />, label: '设备维护' },
  { key: '/quality', icon: <SafetyCertificateOutlined />, label: '质量分析' },
  { key: '/supply-chain', icon: <ShopOutlined />, label: '供应链风险' },
];

const lowCodeMenuItems: MenuProps['items'] = [
  {
    key: 'lowcode-group',
    icon: <AppstoreOutlined />,
    label: '低代码配置',
    children: [
      { key: '/model-driven', icon: <LayoutOutlined />, label: 'App Builder' },
      { key: '/ontology', icon: <ApartmentOutlined />, label: 'Data Modeler' },
      { key: '/reports', icon: <BarChartOutlined />, label: 'Report Designer' },
      { key: '/rules', icon: <ThunderboltOutlined />, label: 'Rule Builder' },
      { key: '/data-sources', icon: <ApiOutlined />, label: 'Data Sources' },
      { key: '/pipeline', icon: <DatabaseOutlined />, label: 'Data Pipeline' },
      { key: '/graph', icon: <NodeIndexOutlined />, label: 'Graph Explorer' },
    ],
  },
];

const toolMenuItems: MenuProps['items'] = [
  { key: '/ai-assistant', icon: <RobotOutlined />, label: 'AI Assistant' },
  { key: '/templates', icon: <AppstoreOutlined />, label: '模板市场' },
];

const adminMenuItems: MenuProps['items'] = [
  { key: '/workflow', icon: <CheckOutlined />, label: '流程中心' },
  { key: '/system-admin', icon: <SettingOutlined />, label: '系统管理' },
];

const breadcrumbMap: Record<string, string> = {
  '/': '我的工作台',
  '/dashboard': '生产态势',
  '/maintenance': '设备维护',
  '/quality': '质量分析',
  '/supply-chain': '供应链风险',
  '/model-driven': 'App Builder',
  '/ontology': 'Data Modeler',
  '/reports': 'Report Designer',
  '/templates': '模板市场',
  '/rules': 'Rule Builder',
  '/ai-assistant': 'AI Assistant',
  '/data-sources': 'Data Sources',
  '/graph': 'Graph Explorer',
  '/pipeline': 'Data Pipeline',
  '/system-admin': '系统管理',
  '/workflow': '流程中心',
  '/my-applications': '我的申请',
};

function PageLoader() {
  return (
    <div style={{ padding: 40 }}>
      <Spin size="large" tip="加载工作台...">
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
          <Typography.Title level={4} type="danger">页面渲染失败</Typography.Title>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#fff', padding: 16, borderRadius: 6 }}>
            {this.state.error}
          </pre>
          <Button type="primary" onClick={() => window.location.reload()}>刷新页面</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function buildDynamicMenuTree(items: DynamicMenu[]): MenuProps['items'] {
  const map = new Map<number, any>();
  const roots: any[] = [];
  for (const item of items) {
    map.set(item.id, {
      key: item.route_path || `dynamic-${item.id}`,
      icon: <AppstoreOutlined />,
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

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [collapsed, setCollapsed] = useState(false);
  const [dynamicMenus, setDynamicMenus] = useState<MenuProps['items']>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [density, setDensity] = useState<Density>(() => (localStorage.getItem('mf_density') as Density) || 'standard');

  useEffect(() => {
    localStorage.setItem('mf_density', density);
  }, [density]);

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
    listMenus()
      .then((res) => {
        const items = (res.data?.data || []).filter((m: DynamicMenu) => m.is_visible);
        setDynamicMenus(buildDynamicMenuTree(items));
      })
      .catch(() => setDynamicMenus([]));
  }, []);

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

  const allMenuItems = useMemo<MenuProps['items']>(() => {
    const items: MenuProps['items'] = [
      ...(businessMenuItems || []),
      { type: 'divider' },
      ...(lowCodeMenuItems || []),
      { type: 'divider' },
      ...(toolMenuItems || []),
    ];
    if (user?.is_admin) {
      items.push({ type: 'divider' }, ...(adminMenuItems || []));
    }
    if (dynamicMenus?.length) {
      items.push({ type: 'divider' }, ...dynamicMenus);
    }
    return items;
  }, [dynamicMenus, user?.is_admin]);

  const selectedKey = location.pathname === '/dashboard' ? '/dashboard' : location.pathname;
  const breadcrumbItems = useMemo(() => {
    const title = location.pathname.startsWith('/dynamic/')
      ? '动态应用'
      : breadcrumbMap[location.pathname] || '工作台';
    return [
      { title: <a onClick={() => navigate('/')}><HomeOutlined /></a> },
      { title },
    ];
  }, [location.pathname, navigate]);

  const handleApproval = (instId: number, action: string) => {
    const commentRef = React.createRef<any>();
    Modal.confirm({
      title: action === 'approve' ? '审批通过' : '驳回申请',
      content: <Input.TextArea ref={commentRef} rows={3} placeholder="填写审批意见" />,
      onOk: async () => {
        const comment = commentRef.current?.resizableTextArea?.textArea?.value
          ?? commentRef.current?.input?.value
          ?? '';
        try {
          await wfApproveOrReject(instId, { action, comment });
          message.success(action === 'approve' ? '已审批通过' : '已驳回');
          loadNotifications();
        } catch {
          message.error('审批操作失败');
        }
      },
    });
  };

  const notificationMenu: MenuProps = {
    items: [
      { key: 'header', label: <strong>通知中心</strong>, disabled: true },
      { type: 'divider' },
      ...(notifications.length === 0
        ? [{ key: 'empty', label: '暂无通知', disabled: true }]
        : notifications.slice(0, 8).map((n: any) => ({
            key: String(n.id),
            label: (
              <div style={{ opacity: n.is_read ? 0.55 : 1, maxWidth: 320 }}>
                <div style={{ fontWeight: n.is_read ? 500 : 700 }}>{n.title}</div>
                {n.content && <div style={{ fontSize: 12, color: '#5d6972', marginTop: 2 }}>{n.content}</div>}
                <div style={{ fontSize: 11, color: '#8a97a1', marginTop: 2 }}>{n.created_at?.slice(0, 16)}</div>
                {n.type === 'approval' && !n.is_read && (
                  <div style={{ marginTop: 8 }}>
                    <Button size="small" type="primary" icon={<CheckOutlined />}
                      onClick={(e) => { e.stopPropagation(); handleApproval(n.related_id || n.id, 'approve'); }}>通过</Button>
                    <Button size="small" danger icon={<CloseOutlined />} style={{ marginLeft: 8 }}
                      onClick={(e) => { e.stopPropagation(); handleApproval(n.related_id || n.id, 'reject'); }}>驳回</Button>
                  </div>
                )}
              </div>
            ),
          }))
      ),
      { type: 'divider' },
      {
        key: 'mark-all',
        label: '全部标记已读',
        onClick: async () => {
          if (!user) return;
          await wfMarkAllRead(user.id);
          setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
          setUnread(0);
        },
      },
    ],
    onClick: ({ key }) => {
      if (key === 'header' || key === 'empty' || key === 'mark-all') return;
      wfMarkNotificationRead(Number(key)).catch(() => {});
      setNotifications((prev) => prev.map((n) => (String(n.id) === key ? { ...n, is_read: true } : n)));
      setUnread((prev) => Math.max(0, prev - 1));
    },
  };

  const userMenu: MenuProps = {
    items: [
      { key: 'my-apps', label: '我的申请', icon: <AppstoreOutlined />, onClick: () => navigate('/my-applications') },
      { key: 'workflow', label: '流程中心', icon: <CheckOutlined />, onClick: () => navigate('/workflow') },
      { type: 'divider' },
      ...(user?.is_admin
        ? [{ key: 'admin', label: '系统管理', icon: <SettingOutlined />, onClick: () => navigate('/system-admin') }]
        : []),
      { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true, onClick: () => { logout(); navigate('/login'); } },
    ],
  };

  const siderWidth = collapsed ? 68 : 236;

  return (
    <Layout className={`app-shell density-${density}`}>
      <Sider
        width={236}
        collapsedWidth={68}
        collapsed={collapsed}
        trigger={null}
        theme="light"
        className="app-sider"
        style={{ height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0 }}
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
          className="app-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['lowcode-group']}
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
            <Breadcrumb items={breadcrumbItems} />
          </Space>

          <Space size={12} align="center">
            <Button
              className="app-search-button"
              icon={<SearchOutlined />}
              onClick={() => setSearchOpen(true)}
            >
              搜索应用、数据资产或配置 Ctrl+K
            </Button>
            <Segmented
              size="small"
              value={density}
              options={[
                { label: 'Compact', value: 'compact' },
                { label: 'Standard', value: 'standard' },
                { label: 'Relaxed', value: 'relaxed' },
              ]}
              onChange={(value) => setDensity(value as Density)}
            />
            <Dropdown menu={notificationMenu} trigger={['click']}>
              <Badge count={unread} size="small">
                <Button type="text" icon={<BellOutlined />} />
              </Badge>
            </Dropdown>
            <Dropdown menu={userMenu} trigger={['click']}>
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#2f5f73' }} />
                <span style={{ fontSize: 13, color: '#273640' }}>{user?.display_name || '用户'}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content className="app-content">
          <div className="content-surface">
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
                  <Route path="/ai-assistant" element={<AIAssistantPage />} />
                  <Route path="/reports" element={<ReportCenterPage />} />
                  <Route path="/model-driven" element={<ModelDrivenPage />} />
                  <Route path="/dynamic/:slug" element={<DynamicPage />} />
                  <Route path="/system-admin" element={<SystemAdminPage />} />
                  <Route path="/workflow" element={<WorkflowPage />} />
                  <Route path="/my-applications" element={<MyApplicationsPage />} />
                  <Route path="/templates" element={<TemplateMarketPage />} />
                  <Route path="/rules" element={<RuleEnginePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </div>
        </Content>
      </Layout>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}

export default function App() {
  const { isAuthenticated, restore } = useAuthStore();
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    restore();
    setRestored(true);
  }, [restore]);

  if (!restored) return <PageLoader />;

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Suspense fallback={<PageLoader />}><LoginPage /></Suspense>}
      />
      <Route path="/*" element={isAuthenticated ? <AppContent /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
