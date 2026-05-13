import { Layout, Menu, Badge, Dropdown, Avatar, Space, Modal, Button, Input, Tag, Breadcrumb } from 'antd';
import {
  DashboardOutlined, ToolOutlined, SafetyCertificateOutlined, ShopOutlined,
  RobotOutlined, BarChartOutlined, AppstoreOutlined, BellOutlined, UserOutlined,
  LogoutOutlined, SettingOutlined, CheckOutlined, CloseOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, SearchOutlined,
  HomeOutlined, DatabaseOutlined, LayoutOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo } from 'react';
import { Spin, message, Typography } from 'antd';
import { useAuthStore, getAdminMenus } from './stores/authStore';
import GlobalSearch from './components/GlobalSearch';
import {
  listMenus,
  wfListNotifications,
  wfApproveOrReject,
  wfMarkAllRead,
  wfMarkNotificationRead,
} from './services/api';
import {
  ROLE_MENU_MAP as ROLE_MENU_MAP_CFG,
  BREADCRUMB_MAP as BREADCRUMB_MAP_CFG,
  LOWCODE_MENUS as LOWCODE_MENUS_CFG,
} from './config/menus';

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

// Business menus
const businessMenuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '运营总览' },
  { key: '/maintenance', icon: <ToolOutlined />, label: '预测性维护' },
  { key: '/quality', icon: <SafetyCertificateOutlined />, label: '质量管理' },
  { key: '/supply-chain', icon: <ShopOutlined />, label: '供应链协同' },
];

// Icon mapping for low-code menus
const lowCodeIconMap: Record<string, React.ReactNode> = {
  DatabaseOutlined: <DatabaseOutlined />,
  LayoutOutlined: <LayoutOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
  ThunderboltOutlined: <ThunderboltOutlined />,
};

const lowCodeMenuItems = {
  key: 'lowcode-group',
  icon: <AppstoreOutlined />,
  label: '低代码平台',
  children: LOWCODE_MENUS_CFG.map((m) => ({
    key: m.key,
    icon: lowCodeIconMap[m.icon] || <AppstoreOutlined />,
    label: m.label,
  })),
};

// Tool menus
const toolMenuItems = [
  { key: '/ai-assistant', icon: <RobotOutlined />, label: 'AI 助手' },
];

// Pulled from src/config/menus.ts (single source of truth)
const ROLE_MENU_MAP = ROLE_MENU_MAP_CFG;
const BREADCRUMB_MAP = BREADCRUMB_MAP_CFG;

// Status tag component for my-applications
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: '审批中', color: 'orange' },
  approved: { label: '已通过', color: 'green' },
  rejected: { label: '已驳回', color: 'red' },
  cancelled: { label: '已撤销', color: 'default' },
};

function PageLoader() {
  return (
    <div style={{ padding: 40 }}>
      <Spin size="large" tip="加载中...">
        <div style={{ minHeight: 200 }} />
      </Spin>
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40 }}>
          <Typography.Title level={4} type="danger">页面渲染错误</Typography.Title>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#fafafa', padding: 16, borderRadius: 8 }}>
            {this.state.error}
          </pre>
          <Button type="primary" onClick={() => window.location.reload()}>刷新页面</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface DynamicMenu {
  id: number; parent_id: number | null; title: string; icon: string;
  route_path: string; sort_order: number; is_visible: boolean;
}

function buildMenuTree(items: DynamicMenu[]) {
  const map = new Map<number, any>();
  const roots: any[] = [];
  for (const item of items) {
    map.set(item.id, { key: item.route_path || `dyn-${item.id}`, icon: <AppstoreOutlined />, label: item.title, children: [] });
  }
  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node);
    } else if (item.route_path) {
      roots.push(node);
    }
  }
  return roots;
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [collapsed, setCollapsed] = useState(false);
  const [dynamicMenus, setDynamicMenus] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K global search shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Load dynamic menus
  useEffect(() => {
    listMenus()
      .then((res) => {
        const items = (res.data?.data || []).filter((m: DynamicMenu) => m.is_visible);
        setDynamicMenus(buildMenuTree(items));
      })
      .catch(() => {});
  }, []);

  // Poll notifications
  const loadNotifs = useCallback(() => {
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
    loadNotifs();
    const interval = setInterval(loadNotifs, 60000);
    return () => clearInterval(interval);
  }, [loadNotifs]);

  // Filter business menus by role
  const visibleBusinessMenus = businessMenuItems.filter((menu) => {
    if (!user) return false;
    if (user.is_admin) return true;
    const allowed = ROLE_MENU_MAP[user.roles?.[0]?.name || ''];
    if (!allowed) return true;
    return allowed.includes(menu.key);
  });

  const allMenuItems = [
    ...visibleBusinessMenus,
    { type: 'divider' as const },
    lowCodeMenuItems,
    { type: 'divider' as const },
    ...toolMenuItems,
    ...dynamicMenus,
  ];
  const adminMenus = getAdminMenus(user);

  // Breadcrumb items
  const breadcrumbItems = useMemo(() => {
    const path = location.pathname;
    const crumbs: { title: React.ReactNode }[] = [{ title: <a onClick={() => navigate('/')}><HomeOutlined /></a> }];

    // Dynamic pages: /dynamic/slug
    if (path.startsWith('/dynamic/')) {
      crumbs.push({ title: '动态页面' });
      const slug = path.replace('/dynamic/', '');
      const dynMenu = dynamicMenus.find((m: any) => m.key === path);
      if (dynMenu) crumbs.push({ title: dynMenu.label });
      else crumbs.push({ title: slug });
    } else if (BREADCRUMB_MAP[path]) {
      crumbs.push({ title: BREADCRUMB_MAP[path] });
    }

    return crumbs;
  }, [location.pathname, navigate, dynamicMenus]);

  // Page title from breadcrumb
  const pageTitle = useMemo(() => {
    const crumbs = breadcrumbItems;
    return crumbs.length > 1 ? (crumbs[crumbs.length - 1].title as string) : '';
  }, [breadcrumbItems]);

  // Approval action — capture textarea value via React ref instead of DOM lookup
  const handleApproval = (instId: number, action: string) => {
    const commentRef = React.createRef<any>();
    Modal.confirm({
      title: action === 'approve' ? '审批通过' : '驳回申请',
      content: <Input.TextArea ref={commentRef} rows={3} placeholder="审批意见（可选）" />,
      onOk: async () => {
        const comment = commentRef.current?.resizableTextArea?.textArea?.value
          ?? commentRef.current?.input?.value
          ?? '';
        try {
          await wfApproveOrReject(instId, { action, comment });
          message.success(action === 'approve' ? '已通过' : '已驳回');
          loadNotifs();
        } catch {
          message.error('操作失败');
        }
      },
    });
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Notification dropdown
  const notifMenuItems = {
    items: [
      { key: 'header', label: <span style={{ fontWeight: 600 }}>通知</span>, disabled: true },
      { type: 'divider' as const },
      ...(notifications.length === 0
        ? [{ key: 'empty', label: <span style={{ color: '#999' }}>暂无通知</span>, disabled: true }]
        : notifications.slice(0, 8).map((n: any) => ({
            key: String(n.id),
            label: (
              <div style={{ opacity: n.is_read ? 0.5 : 1, maxWidth: 300 }}>
                <div style={{ fontWeight: n.is_read ? 400 : 600, fontSize: 13 }}>{n.title}</div>
                {n.content && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{n.content}</div>}
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{n.created_at?.slice(0, 16)}</div>
                {n.type === 'approval' && !n.is_read && (
                  <div style={{ marginTop: 6 }}>
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
      { type: 'divider' as const },
      {
        key: 'mark-all',
        label: '全部标为已读',
        onClick: async () => {
          if (!user) return;
          await wfMarkAllRead(user.id);
          setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
          setUnread(0);
        },
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'header' || key === 'empty' || key === 'mark-all') return;
      wfMarkNotificationRead(Number(key)).catch(() => {});
      setNotifications((prev) => prev.map((n) => (String(n.id) === key ? { ...n, is_read: true } : n)));
      setUnread((prev) => Math.max(0, prev - 1));
    },
  };

  // Avatar dropdown — "我的申请" navigates to dedicated page
  const userMenuItems = {
    items: [
      { key: 'my-apps', label: '我的申请', icon: <AppstoreOutlined />, onClick: () => navigate('/my-applications') },
      { type: 'divider' as const },
      ...(adminMenus.map((m: any) => ({
        key: m.key, label: m.label, icon: <SettingOutlined />,
        onClick: () => navigate(m.key),
      }))),
      ...(adminMenus.length > 0 ? [{ type: 'divider' as const }] : []),
      { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true, onClick: handleLogout },
    ],
  };

  const siderWidth = collapsed ? 64 : 200;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={200}
        collapsedWidth={64}
        collapsed={collapsed}
        trigger={null}
        theme="dark"
        style={{ overflow: 'auto', height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0 }}
      >
        <div style={{
          height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: collapsed ? 20 : 18, fontWeight: 700, whiteSpace: 'nowrap',
          overflow: 'hidden', transition: 'all 0.2s',
        }}>
          {collapsed ? 'MF' : '制造数智平台'}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={allMenuItems}
          onClick={({ key }) => navigate(key)} />
      </Sider>
      <Layout style={{ marginLeft: siderWidth, transition: 'margin-left 0.2s' }}>
        <Header style={{
          background: '#fff', padding: '0 24px', borderBottom: '1px solid #f0f0f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Space size={16} align="center">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 16, width: 40, height: 40 }}
            />
            <Breadcrumb items={breadcrumbItems} />
          </Space>
          <Space size={20}>
            <Button
              type="text"
              icon={<SearchOutlined />}
              onClick={() => setSearchOpen(true)}
              style={{ fontSize: 16, color: '#666' }}
              title="全局搜索 (Ctrl+K)"
            />
            <Dropdown menu={notifMenuItems} trigger={['click']}>
              <Badge count={unread} size="small">
                <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
              </Badge>
            </Dropdown>
            <Dropdown menu={userMenuItems} trigger={['click']}>
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#1677ff' }} />
                <span style={{ fontSize: 13 }}>{user?.display_name || '用户'}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: '#fff', borderRadius: 8, minHeight: 400, overflow: 'auto' }}>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
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
              </Routes>
            </Suspense>
          </ErrorBoundary>
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
  }, []);

  if (!restored) return <PageLoader />;

  return (
    <Routes>
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/" replace /> : <Suspense fallback={<PageLoader />}><LoginPage /></Suspense>
      } />
      <Route path="/*" element={
        isAuthenticated ? <AppContent /> : <Navigate to="/login" replace />
      } />
    </Routes>
  );
}
