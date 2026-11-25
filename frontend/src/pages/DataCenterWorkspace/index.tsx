import { lazy, Suspense } from 'react';
import { Button, Result, Spin, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { DATA_WORKSPACES, dataWorkspaceSelection, type DataWorkspace } from '../../config/dataCenter';
import { useAuthStore } from '../../stores/authStore';
import './workspace.css';

const Sources = lazy(() => import('../DataSource'));
const Pipelines = lazy(() => import('../Pipeline'));
const Assets = lazy(() => import('../SystemAdmin/SemanticAssetCenter'));
const ObjectBrowser = lazy(() => import('./ObjectBrowser'));
const RelationshipExplorer = lazy(() => import('./RelationshipExplorer'));

export default function DataCenterWorkspace({ workspace }: { workspace: DataWorkspace }) {
  const [params, setParams] = useSearchParams();
  const user = useAuthStore(state => state.user);
  const isAdmin = Boolean(user?.is_admin);
  const accountKey = user ? `${user.tenant_id ?? 'default'}:${user.id}` : 'anonymous';
  const parameter = DATA_WORKSPACES[workspace].parameter;
  const { tabs, activeKey, forbidden } = dataWorkspaceSelection(workspace, params.get(parameter), isAdmin);
  const selectTab = (key: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set(parameter, key);
      return next;
    });
  };

  let content;
  if (forbidden) {
    content = <Result status="403" title="需要管理员权限" extra={<Button onClick={() => selectTab(tabs[0].key)}>返回{tabs[0].label}</Button>} />;
  } else if (workspace === 'assets') {
    content = activeKey === 'data' ? <Assets embedded view="data" /> : activeKey === 'pipelines' ? <Pipelines /> : <Sources />;
  } else {
    content = activeKey === 'browse'
      ? <ObjectBrowser isAdmin={isAdmin} openModelDesign={() => selectTab('ontology')} />
      : activeKey === 'graph' ? <RelationshipExplorer key={accountKey} isAdmin={isAdmin} /> : <Assets embedded view="ontology" />;
  }

  return <div className="data-center-workspace">
    <Tabs activeKey={forbidden ? undefined : activeKey} onChange={selectTab} destroyInactiveTabPane items={tabs.map(tab => ({
      key: tab.key,
      label: tab.label,
      children: !forbidden && tab.key === activeKey
        ? <Suspense fallback={<div className="data-center-workspace-loading"><Spin /></div>}>{content}</Suspense>
        : null,
    }))} />
    {forbidden && content}
  </div>;
}
