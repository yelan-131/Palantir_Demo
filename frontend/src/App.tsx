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
import GlobalSearch from './components/GlobalSearch';
import { useAuthStore } from './stores/authStore';
import {
  listApplicationMenus,
  listApplications,
  wfApproveOrReject,
  wfListNotifications,
  wfMarkAllRead,
  wfMarkNotificationRead,
} from './services/api';
import {
  APP_ASSEMBLY_MENU_EVENT,
  APP_ASSEMBLY_MENUS_STORAGE_KEY,
  getAssemblyMenuDefaultRoute,
  loadAssemblyMenus,
  savedAssemblyMenusToDynamicMenus,
} from './config/appAssemblyMenus';

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

const businessMenuItems: NonNullable<MenuProps['items']> = [
  { key: '/', icon: <HomeOutlined />, label: '我的工作台' },
  { key: '/dashboard', icon: <DashboardOutlined />, label: '生产态势' },
  { key: '/maintenance', icon: <ToolOutlined />, label: '设备维护' },
  { key: '/quality', icon: <SafetyCertificateOutlined />, label: '质量分析' },
  { key: '/supply-chain', icon: <ShopOutlined />, label: '供应链风险' },
];

const workspaceMenuItem: NonNullable<MenuProps['items']>[number] = {
  key: '/',
  icon: <HomeOutlined />,
  label: '我的工作台',
};

const fallbackApplications: ApplicationInfo[] = [
  { id: 1, name: '生产态势', code: 'production-dashboard', description: '生产效率、OEE、产线告警和班次趋势。', icon: 'DashboardOutlined', default_route: '/program/production-overview', status: 'published', is_pinned: true },
  { id: 2, name: '预测性维护', code: 'maintenance-analysis', description: '设备健康总览、健康分析、故障预测和工单管理。', icon: 'ToolOutlined', default_route: '/program/device-health-dashboard', status: 'published', is_pinned: true },
  { id: 3, name: '质量分析', code: 'quality-control', description: '质量缺陷、检验批次、异常追溯和过程能力分析。', icon: 'SafetyCertificateOutlined', default_route: '/program/quality-overview', status: 'published' },
  { id: 4, name: '供应链风险', code: 'supply-risk', description: '供应商交付、库存水位、风险预警和替代方案。', icon: 'ShopOutlined', default_route: '/program/supply-overview', status: 'published' },
];

const fallbackMenusByApplication: Record<number, DynamicMenu[]> = {
  1: [{ id: 1001, parent_id: null, title: '生产态势', icon: 'DashboardOutlined', route_path: '/dashboard', is_visible: true }],
  2: [{ id: 1002, parent_id: null, title: '预测性维护', icon: 'ToolOutlined', route_path: '/maintenance', is_visible: true }],
  3: [{ id: 1003, parent_id: null, title: '质量分析', icon: 'SafetyCertificateOutlined', route_path: '/quality', is_visible: true }],
  4: [{ id: 1004, parent_id: null, title: '供应链风险', icon: 'ShopOutlined', route_path: '/supply-chain', is_visible: true }],
};

const richFallbackMenusByApplication: Record<number, DynamicMenu[]> = {
  1: [
    { id: 1100, parent_id: null, title: '生产态势', icon: 'DashboardOutlined', route_path: '/dashboard', is_visible: true, children: [
      { id: 1101, parent_id: 1100, title: '生产总览', icon: 'DashboardOutlined', route_path: '/program/production-overview', is_visible: true },
      { id: 1102, parent_id: 1100, title: '产线状态', icon: 'DashboardOutlined', route_path: '/program/line-status', is_visible: true },
      { id: 1103, parent_id: 1100, title: '设备运行', icon: 'ToolOutlined', route_path: '/program/device-health', is_visible: true },
      { id: 1104, parent_id: 1100, title: '活动告警', icon: 'SafetyCertificateOutlined', route_path: '/program/alert-center', is_visible: true },
    ] },
  ],
  2: [
    { id: 1200, parent_id: null, title: '预测性维护', icon: 'ToolOutlined', route_path: '/maintenance', is_visible: true, children: [
      { id: 1201, parent_id: 1200, title: '设备健康', icon: 'ToolOutlined', route_path: '/program/device-health', is_visible: true },
      { id: 1202, parent_id: 1200, title: '故障预测', icon: 'ToolOutlined', route_path: '/program/fault-prediction', is_visible: true },
      { id: 1203, parent_id: 1200, title: '维修工单', icon: 'AppstoreOutlined', route_path: '/program/maintenance-order', is_visible: true },
      { id: 1204, parent_id: 1200, title: '告警中心', icon: 'SafetyCertificateOutlined', route_path: '/program/alert-center', is_visible: true },
    ] },
  ],
  3: [
    { id: 1300, parent_id: null, title: '质量分析', icon: 'SafetyCertificateOutlined', route_path: '/quality', is_visible: true, children: [
      { id: 1301, parent_id: 1300, title: '质量总览', icon: 'SafetyCertificateOutlined', route_path: '/program/quality-overview', is_visible: true },
      { id: 1302, parent_id: 1300, title: '检验批次', icon: 'SafetyCertificateOutlined', route_path: '/program/inspection-batch', is_visible: true },
      { id: 1303, parent_id: 1300, title: '缺陷分析', icon: 'SafetyCertificateOutlined', route_path: '/program/defect-analysis', is_visible: true },
      { id: 1304, parent_id: 1300, title: 'CAPA 跟踪', icon: 'AppstoreOutlined', route_path: '/program/quality-event', is_visible: true },
    ] },
  ],
  4: [
    { id: 1400, parent_id: null, title: '供应链风险', icon: 'ShopOutlined', route_path: '/supply-chain', is_visible: true, children: [
      { id: 1401, parent_id: 1400, title: '风险总览', icon: 'ShopOutlined', route_path: '/program/supply-overview', is_visible: true },
      { id: 1402, parent_id: 1400, title: '供应商风险', icon: 'ShopOutlined', route_path: '/program/supplier-risk', is_visible: true },
      { id: 1403, parent_id: 1400, title: '物料影响', icon: 'AppstoreOutlined', route_path: '/program/material-impact', is_visible: true },
      { id: 1404, parent_id: 1400, title: '风险复核', icon: 'SafetyCertificateOutlined', route_path: '/program/risk-review', is_visible: true },
    ] },
  ],
};

const groupedFallbackMenusByApplication: Record<number, DynamicMenu[]> = {
  1: [
    { id: 1100, parent_id: null, title: '生产态势', icon: 'DashboardOutlined', route_path: '/dashboard', is_visible: true, children: [
      { id: 1110, parent_id: 1100, title: '生产监控', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1111, parent_id: 1110, title: '生产总览', icon: 'DashboardOutlined', route_path: '/program/production-overview', is_visible: true },
        { id: 1112, parent_id: 1110, title: '产线状态', icon: 'DashboardOutlined', route_path: '/program/line-status', is_visible: true },
        { id: 1113, parent_id: 1110, title: '设备运行', icon: 'ToolOutlined', route_path: '/program/device-health', is_visible: true },
      ] },
      { id: 1120, parent_id: 1100, title: '异常处理', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1121, parent_id: 1120, title: '活动告警', icon: 'SafetyCertificateOutlined', route_path: '/program/alert-center', is_visible: true },
      ] },
    ] },
  ],
  2: [
    { id: 1200, parent_id: null, title: '预测性维护', icon: 'ToolOutlined', route_path: '/maintenance', is_visible: true, children: [
      { id: 1210, parent_id: 1200, title: '健康与预测', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1211, parent_id: 1210, title: '设备健康', icon: 'ToolOutlined', route_path: '/program/device-health', is_visible: true },
        { id: 1212, parent_id: 1210, title: '故障预测', icon: 'ToolOutlined', route_path: '/program/fault-prediction', is_visible: true },
      ] },
      { id: 1220, parent_id: 1200, title: '维护执行', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1221, parent_id: 1220, title: '维修工单', icon: 'AppstoreOutlined', route_path: '/program/maintenance-order', is_visible: true },
        { id: 1222, parent_id: 1220, title: '告警中心', icon: 'SafetyCertificateOutlined', route_path: '/program/alert-center', is_visible: true },
      ] },
    ] },
  ],
  3: [
    { id: 1300, parent_id: null, title: '质量分析', icon: 'SafetyCertificateOutlined', route_path: '/quality', is_visible: true, children: [
      { id: 1310, parent_id: 1300, title: '质量监控', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1311, parent_id: 1310, title: '质量总览', icon: 'SafetyCertificateOutlined', route_path: '/program/quality-overview', is_visible: true },
        { id: 1312, parent_id: 1310, title: '检验批次', icon: 'SafetyCertificateOutlined', route_path: '/program/inspection-batch', is_visible: true },
      ] },
      { id: 1320, parent_id: 1300, title: '问题改进', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1321, parent_id: 1320, title: '缺陷分析', icon: 'SafetyCertificateOutlined', route_path: '/program/defect-analysis', is_visible: true },
        { id: 1322, parent_id: 1320, title: 'CAPA 跟踪', icon: 'AppstoreOutlined', route_path: '/program/quality-event', is_visible: true },
      ] },
    ] },
  ],
  4: [
    { id: 1400, parent_id: null, title: '供应链风险', icon: 'ShopOutlined', route_path: '/supply-chain', is_visible: true, children: [
      { id: 1410, parent_id: 1400, title: '风险监控', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1411, parent_id: 1410, title: '风险总览', icon: 'ShopOutlined', route_path: '/program/supply-overview', is_visible: true },
        { id: 1412, parent_id: 1410, title: '供应商风险', icon: 'ShopOutlined', route_path: '/program/supplier-risk', is_visible: true },
      ] },
      { id: 1420, parent_id: 1400, title: '影响与复核', icon: 'AppstoreOutlined', route_path: '', is_visible: true, children: [
        { id: 1421, parent_id: 1420, title: '物料影响', icon: 'AppstoreOutlined', route_path: '/program/material-impact', is_visible: true },
        { id: 1422, parent_id: 1420, title: '风险复核', icon: 'SafetyCertificateOutlined', route_path: '/program/risk-review', is_visible: true },
      ] },
    ] },
  ],
};

const pageTitleMap: Record<string, string> = {
  '/': '我的工作台',
  '/dashboard': '生产态势',
  '/maintenance': '设备维护',
  '/quality': '质量分析',
  '/supply-chain': '供应链风险',
  '/ontology': '数据模型',
  '/reports': '报表中心',
  '/templates': '模板市场',
  '/rules': '规则引擎',
  '/ai-assistant': 'AI Assistant',
  '/account-center': '账户中心',
  '/data-sources': '数据源管理',
  '/graph': '图谱探索',
  '/pipeline': '数据管道',
  '/form-settings': '表单设置',
  '/system-admin': '系统管理',
  '/workflow': '流程中心',
};

const programTitleMap: Record<string, string> = {
  'production-overview': '生产总览',
  'oee-trend-report': 'OEE 趋势报表',
  'line-status': '产线状态',
  'line-load-analysis': '产线负荷分析',
  'production-plan-entry': '生产计划填报',
  'device-health': '设备健康',
  'device-health-dashboard': '设备健康看板',
  'fault-prediction': '故障预测',
  'failure-trend-analysis': '故障趋势分析',
  'maintenance-order': '维修工单',
  'alert-center': '告警中心',
  'quality-overview': '质量总览',
  'inspection-batch': '检验批次',
  'defect-analysis-report': '缺陷分析报表',
  'process-capability-dashboard': '过程能力看板',
  'defect-analysis': '缺陷分析',
  'quality-event': '质量事件',
  'supplier-risk': '供应商风险',
  'supply-overview': '供应总览',
  'material-impact-report': '物料影响报表',
  'supply-risk-dashboard': '供应风险看板',
  'material-impact': '物料影响',
  'risk-review': '风险复核',
};

function getRuntimePageTitle(pathname: string): string {
  if (pathname.startsWith('/dynamic/')) {
    return '动态页面';
  }
  if (pathname.startsWith('/program/')) {
    const programId = pathname.split('/').filter(Boolean)[1];
    return programTitleMap[programId] || '业务页面';
  }
  return pageTitleMap[pathname] || '业务页面';
}
function iconFor(name?: string) {
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
          <Button type="primary" onClick={() => window.location.reload()}>重新加载页面</Button>
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

function getFallbackApplicationDefaultRoute(app: ApplicationInfo): string {
  const fallbackItems =
    groupedFallbackMenusByApplication[app.id]
    || richFallbackMenusByApplication[app.id]
    || fallbackMenusByApplication[app.id]
    || [];
  return findFirstDynamicMenuRoute(fallbackItems) || app.default_route || '/';
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
        const apps: ApplicationInfo[] = (res.data?.data || []).length ? res.data.data : fallbackApplications;
        setApplications(apps);
        if (!apps.length) {
          setCurrentApplication(null);
          setDynamicMenus(businessMenuItems);
          return;
        }
        const storedId = Number(localStorage.getItem('mf_current_app_id'));
        const matched = apps.find((app) => app.id === storedId) || apps[0];
        setCurrentApplication(matched);
        localStorage.setItem('mf_current_app_id', String(matched.id));
      })
      .catch(() => {
        const storedId = Number(localStorage.getItem('mf_current_app_id'));
        const matched = fallbackApplications.find((app) => app.id === storedId) || fallbackApplications[0];
        setApplications(fallbackApplications);
        setCurrentApplication(matched);
        localStorage.setItem('mf_current_app_id', String(matched.id));
      });
  }, []);

  useEffect(() => {
    if (!currentApplication) return;
    const loadLocalAssemblyMenus = () => {
      const localMenus = loadAssemblyMenus()[currentApplication.id];
      if (!localMenus?.length) return false;
      setDynamicMenus(buildDynamicMenuTree(savedAssemblyMenusToDynamicMenus(currentApplication.id, localMenus)));
      return true;
    };

    if (loadLocalAssemblyMenus()) {
      const handleAssemblyMenuUpdate = () => {
        loadLocalAssemblyMenus();
      };
      const handleStorage = (event: StorageEvent) => {
        if (event.key === APP_ASSEMBLY_MENUS_STORAGE_KEY) {
          loadLocalAssemblyMenus();
        }
      };
      window.addEventListener(APP_ASSEMBLY_MENU_EVENT, handleAssemblyMenuUpdate);
      window.addEventListener('storage', handleStorage);
      return () => {
        window.removeEventListener(APP_ASSEMBLY_MENU_EVENT, handleAssemblyMenuUpdate);
        window.removeEventListener('storage', handleStorage);
      };
    }

    listApplicationMenus(currentApplication.id)
      .then((res) => {
        const apiItems = res.data?.data || [];
        const localItems = groupedFallbackMenusByApplication[currentApplication.id] || richFallbackMenusByApplication[currentApplication.id] || fallbackMenusByApplication[currentApplication.id] || [];
        const items = (apiItems.length > 1 || apiItems.some((item: DynamicMenu) => item.children?.length) ? apiItems : localItems)
          .filter((m: DynamicMenu) => m.is_visible !== false);
        setDynamicMenus(buildDynamicMenuTree(items));
      })
      .catch(() => setDynamicMenus(buildDynamicMenuTree(groupedFallbackMenusByApplication[currentApplication.id] || richFallbackMenusByApplication[currentApplication.id] || fallbackMenusByApplication[currentApplication.id] || [])));
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

  const allMenuItems = useMemo<MenuProps['items']>(() => {
    const appItems = dynamicMenus?.length ? unwrapApplicationMenuRoot(dynamicMenus) : businessMenuItems.slice(1);
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
      title: action === 'approve' ? '审批通过' : '驳回申请',
      content: <Input.TextArea ref={commentRef} rows={3} placeholder="请输入审批意见" />,
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

  const switchApplication = (app: ApplicationInfo) => {
    setCurrentApplication(app);
    localStorage.setItem('mf_current_app_id', String(app.id));
    const localMenus = loadAssemblyMenus()[app.id];
    const defaultRoute = localMenus?.length
      ? getAssemblyMenuDefaultRoute(localMenus) || getFallbackApplicationDefaultRoute(app)
      : getFallbackApplicationDefaultRoute(app);
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

  const fallbackNotifications = [
    { id: 'demo-pending-1', type: 'approval', category: 'action', title: '设备维修审批待处理', content: '产线 A03 设备维修申请需要你审批', created_at: '2026-05-20 09:45', is_read: false, target_path: '/workflow?tab=pending&itemId=demo-pending-1' },
    { id: 'demo-returned-1', type: 'returned', category: 'action', title: '采购申请退回待修改', content: '预算口径待补充后重新提交', created_at: '2026-05-20 08:30', is_read: false, target_path: '/workflow?tab=returned&itemId=demo-returned-1' },
    { id: 'demo-system-1', type: 'system', category: 'system', title: '应用菜单配置已更新', content: '设备维护分析新增质量复核入口', created_at: '2026-05-19 17:20', is_read: true, target_path: '/account-center?section=app-menu' },
    { id: 'demo-system-2', type: 'system', category: 'system', title: '角色权限发生变更', content: '业务负责人角色新增导出权限', created_at: '2026-05-19 15:12', is_read: true, target_path: '/account-center?section=roles' },
    { id: 'demo-ai-1', type: 'ai', category: 'ai', title: 'AI 供应风险摘要已生成', content: '发现 3 个供应商交付延迟风险', created_at: '2026-05-20 10:10', is_read: false, target_path: '/ai-assistant' },
  ];

  const notificationSource = notifications.length ? notifications : fallbackNotifications;
  const notificationGroups = [
    { key: 'action', title: '待处理', empty: '暂无待处理事项', items: notificationSource.filter((n: any) => n.category === 'action' || n.type === 'approval' || n.type === 'returned') },
    { key: 'system', title: '系统提醒', empty: '暂无系统提醒', items: notificationSource.filter((n: any) => n.category === 'system' || n.type === 'system') },
    { key: 'ai', title: 'AI 与分析', empty: '暂无 AI 与分析通知', items: notificationSource.filter((n: any) => n.category === 'ai' || n.type === 'ai') },
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
            通过
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
            驳回
          </Button>
        </div>
      )}
    </div>
  );

  const notificationMenuItems: NonNullable<MenuProps['items']> = [
    { key: 'header', label: <strong>通知中心</strong>, disabled: true },
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
    label: '全部标记为已读',
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
                <span>{currentApplication?.name || '选择应用'}</span>
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
              搜索应用、数据资产或配置 Ctrl+K
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
                  <Button icon={<PlusOutlined />}>新增</Button>
                  <Button icon={<ReloadOutlined />}>刷新</Button>
                  <Button icon={<DownloadOutlined />}>导出</Button>
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
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={isAuthenticated ? <AppContent /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
