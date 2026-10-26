export type DataWorkspace = 'sources' | 'assets' | 'objects';

export const DATA_WORKSPACES = {
  sources: {
    title: '数据接入',
    description: '管理数据连接，配置同步任务并查看运行记录。',
    parameter: 'tab',
    tabs: [
      { key: 'connections', label: '连接管理', adminOnly: false },
      { key: 'pipelines', label: '同步任务', adminOnly: false },
    ],
  },
  assets: {
    title: '数据资产',
    description: '查看资产与字段映射，浏览业务实体和文档抽取结果。',
    parameter: 'view',
    tabs: [
      { key: 'data', label: '资产目录', adminOnly: true },
      { key: 'mapping', label: '字段与语义映射', adminOnly: true },
      { key: 'entities', label: '实体与抽取', adminOnly: false },
    ],
  },
  objects: {
    title: '对象与关系',
    description: '定义业务对象与关系模型，探索实际数据之间的关联。',
    parameter: 'view',
    tabs: [
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
