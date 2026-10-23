import { lazy } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Result } from 'antd';
import { useAuthStore } from '../../stores/authStore';
import { LEGACY_ACCOUNT_SECTIONS, NAVIGATION_AREAS, NAVIGATION_ENTRIES, navigationAreaForPath, visibleNavigationEntries } from '../../config/navigation';

const AccountCenter = lazy(() => import('../AccountCenter'));
const Applications = lazy(() => import('../SystemAdmin/AppMenuManagement'));
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

const QualityImpact = lazy(() => import('../QualityImpact'));
const BackendTools = lazy(() => import('../BackendSettings'));

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
  if (pathname === '/admin/overview') return <Navigate to="/account-center" replace />;
  if (!entry) return <Result status="404" title="页面不存在" extra={<Button onClick={() => navigate(areaInfo.home)}>返回{areaInfo.label}</Button>} />;

  const navigateAssetView = (view: 'data' | 'mapping' | 'ontology') => navigate(view === 'ontology' ? `${area === 'admin' ? '/admin' : '/data-center'}/objects` : `${area === 'admin' ? '/admin' : '/data-center'}/assets${view === 'mapping' ? '?view=mapping' : ''}`);

  let content;
  switch (pathname) {
    case '/studio/applications': content = <Applications />; break;
    case '/studio/templates': content = <Templates />; break;
    case '/admin/sources':
    case '/data-center/sources': content = <Sources />; break;
    case '/admin/pipelines':
    case '/data-center/pipelines': content = <Pipelines />; break;
    case '/admin/reference':
    case '/data-center/reference': content = <Reference />; break;
    case '/admin/assets':
    case '/data-center/assets': content = <Assets key={params.get('view') || 'data'} view={params.get('view') === 'mapping' ? 'mapping' : 'data'} onViewChange={navigateAssetView} />; break;
    case '/admin/objects':
    case '/data-center/objects': content = <Assets view="ontology" onViewChange={navigateAssetView} />; break;
    case '/admin/entities':
    case '/data-center/entities': content = <Entities />; break;
    case '/admin/graph':
    case '/data-center/graph': content = <Graph />; break;
    case '/admin/knowledge':
    case '/data-center/knowledge': content = <Knowledge />; break;
    case '/admin/quality-impact': content = <><Alert type="info" showIcon message="质量影响与时间线（实验功能）" description="示例业务数据已入库。带时间戳的节点与关系按记录时间展示，拖动可查看关联形成过程；不代表完整历史状态回放。" /><QualityImpact /></>; break;
    case '/admin/entity-timeline': content = <BackendTools key="entity-timeline" section="entity-timeline" />; break;
    case '/admin/graph-tools': content = <BackendTools key="graph-tools" section="graph-tools" />; break;
    case '/admin/model-tools': content = <BackendTools key="model-tools" section="model-tools" />; break;
    case '/admin/ai-builder': content = <BackendTools key="ai-builder" section="ai-builder" />; break;
    case '/admin/config-transfer': content = <BackendTools key="config-transfer" section="config-transfer" />; break;
    case '/admin/readiness': content = <BackendTools key="readiness" section="readiness" />; break;
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
