export type DataWorkspace = 'assets' | 'objects';

export const DATA_WORKSPACES = {
  assets: {
    parameter: 'view',
    tabs: [
      { key: 'data', label: '资产目录', adminOnly: true },
      { key: 'connections', label: '连接管理', adminOnly: false },
      { key: 'pipelines', label: '同步任务', adminOnly: false },
    ],
  },
  objects: {
    parameter: 'view',
    tabs: [
      { key: 'browse', label: '对象浏览', adminOnly: false },
      { key: 'ontology', label: '模型设计', adminOnly: true },
      { key: 'graph', label: '关系探索', adminOnly: false },
    ],
  },
};

export function dataWorkspaceSelection(workspace: DataWorkspace, requested: string | null, isAdmin: boolean) {
  const definition = DATA_WORKSPACES[workspace];
  const tabs = definition.tabs.filter(tab => !tab.adminOnly || isAdmin);
  const selected = definition.tabs.find(tab => tab.key === requested) || tabs[0];
  return { ...definition, tabs, activeKey: selected.key, forbidden: selected.adminOnly && !isAdmin };
}
