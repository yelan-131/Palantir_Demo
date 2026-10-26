import { lazy, Suspense } from 'react';
import { Button, Result, Spin, Tabs, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { DATA_WORKSPACES, dataWorkspaceSelection, type DataWorkspace } from '../../config/dataCenter';
import { useAuthStore } from '../../stores/authStore';
import './workspace.css';

const Sources = lazy(() => import('../DataSource'));
const Pipelines = lazy(() => import('../Pipeline'));
const Assets = lazy(() => import('../SystemAdmin/SemanticAssetCenter'));
const Entities = lazy(() => import('../Ontology'));
const Graph = lazy(() => import('../GraphExplorer'));

export default function DataCenterWorkspace({ workspace }: { workspace: DataWorkspace }) {
  const [params, setParams] = useSearchParams();
  const isAdmin = Boolean(useAuthStore(state => state.user?.is_admin));
  const parameter = DATA_WORKSPACES[workspace].parameter;
  const { title, description, tabs, activeKey, forbidden } = dataWorkspaceSelection(workspace, params.get(parameter), isAdmin);
  const selectTab = (key: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set(parameter, key);
      return next;
    });
  };

  let content;
  if (forbidden) {
    content = <Result status="403" title="需要管理员权限" subTitle="资产配置、语义映射与模型设计需要管理员权限。" extra={<Button onClick={() => selectTab(tabs[0].key)}>返回可访问的页面</Button>} />;
  } else if (workspace === 'sources') {
    content = activeKey === 'pipelines' ? <Pipelines /> : <Sources />;
  } else if (workspace === 'assets') {
    content = activeKey === 'entities' ? <Entities /> : <Assets key={activeKey} embedded view={activeKey === 'mapping' ? 'mapping' : 'data'} onViewChange={selectTab} />;
  } else {
    content = activeKey === 'graph' ? <Graph /> : <Assets embedded view="ontology" />;
  }

  return <div className="data-center-workspace">
    <header className="data-center-workspace-heading">
      <Typography.Title level={4}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
    </header>
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
