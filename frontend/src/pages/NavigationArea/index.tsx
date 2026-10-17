import { lazy } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Result } from 'antd';
import { useAuthStore } from '../../stores/authStore';
import { LEGACY_ACCOUNT_SECTIONS, NAVIGATION_AREAS, NAVIGATION_ENTRIES, navigationAreaForPath, visibleNavigationEntries } from '../../config/navigation';

const AccountCenter = lazy(() => import('../AccountCenter'));
const Applications = lazy(() => import('../SystemAdmin/AppMenuManagement'));
const Reports = lazy(() => import('../ReportCenter'));
const Rules = lazy(() => import('../RuleEngine'));
const Templates = lazy(() => import('../TemplateMarket'));
const Sources = lazy(() => import('../DataSource'));
const Pipelines = lazy(() => import('../Pipeline'));
const Reference = lazy(() => import('../SystemAdmin/ReferenceDataManagement'));
const Assets = lazy(() => import('../SystemAdmin/SemanticAssetCenter'));
const Knowledge = lazy(() => import('../SystemAdmin/SemanticAssetCenter').then(module => ({ default: module.KnowledgeCenter })));
const Entities = lazy(() => import('../Ontology'));
const Graph = lazy(() => import('../GraphExplorer'));
const Identity = lazy(() => import('../SystemAdmin/IdentityAccessManagement'));
const AISettings = lazy(() => import('../AccountCenter').then(module => ({ default: module.AIPlatformPanelV2 })));
const Audit = lazy(() => import('../AccountCenter').then(module => ({ default: module.AuditPanel })));

export function AccountEntry({ currentApplication }: { currentApplication?: { name?: string } | null }) {
  const [params] = useSearchParams();
  const destination = LEGACY_ACCOUNT_SECTIONS[params.get('section') || ''];
  return destination ? <Navigate to={destination} replace /> : <AccountCenter currentApplication={currentApplication} />;
}

export default function NavigationAreaPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isAdmin = Boolean(useAuthStore(state => state.user?.is_admin));
  const area = navigationAreaForPath(pathname);
  const areaInfo = NAVIGATION_AREAS.find(item => item.key === area)!;
  const entry = NAVIGATION_ENTRIES.find(item => item.path === pathname);
  if (area === 'admin' && !isAdmin || entry?.adminOnly && !isAdmin) {
    return <Result status="403" title="需要管理员权限" subTitle="此入口用于平台配置与管理，请使用具备相应权限的账号。" extra={<Button onClick={() => navigate('/')}>返回业务工作台</Button>} />;
  }
  if (pathname === areaInfo.home && area !== 'business') {
    const first = visibleNavigationEntries(area, isAdmin)[0];
    return first ? <Navigate to={first.path} replace /> : <Navigate to="/" replace />;
  }
  if (!entry) return <Result status="404" title="页面不存在" extra={<Button onClick={() => navigate(areaInfo.home)}>返回{areaInfo.label}</Button>} />;

  const navigateAssetView = (view: 'data' | 'mapping' | 'ontology') => navigate(view === 'ontology' ? '/data-center/objects' : `/data-center/assets${view === 'mapping' ? '?view=mapping' : ''}`);

  let content;
  switch (pathname) {
    case '/studio/applications': content = <Applications />; break;
    case '/studio/reports': content = <Reports />; break;
    case '/studio/rules': content = <Rules />; break;
    case '/studio/templates': content = <Templates />; break;
    case '/data-center/sources': content = <Sources />; break;
    case '/data-center/pipelines': content = <Pipelines />; break;
    case '/data-center/reference': content = <Reference />; break;
    case '/data-center/assets': content = <Assets key={params.get('view') || 'data'} view={params.get('view') === 'mapping' ? 'mapping' : 'data'} onViewChange={navigateAssetView} />; break;
    case '/data-center/objects': content = <Assets view="ontology" onViewChange={navigateAssetView} />; break;
    case '/data-center/entities': content = <Entities />; break;
    case '/data-center/graph': content = <Graph />; break;
    case '/data-center/knowledge': content = <Knowledge />; break;
    case '/admin/identity': {
      const tab = params.get('tab') || 'overview';
      content = <Identity key={tab} defaultActiveKey={tab} onTabChange={value => setParams({ tab: value })} />;
      break;
    }
    case '/admin/ai': content = <AISettings />; break;
    case '/admin/audit': content = <Audit />; break;
  }
  return <section className="navigation-area-page" aria-label={entry.label}>
    {content}
  </section>;
}
