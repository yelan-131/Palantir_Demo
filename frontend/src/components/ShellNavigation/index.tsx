import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApartmentOutlined, AppstoreOutlined, BarChartOutlined, ClockCircleOutlined, DatabaseOutlined, EllipsisOutlined, FolderOutlined, HistoryOutlined, HomeOutlined, PlusOutlined, SafetyCertificateOutlined, ShopOutlined, ToolOutlined, CheckOutlined, ApiOutlined, BookOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Form, Input, Modal, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import AccountMenu, { type AccountMenuUser } from '../AccountMenu';
import { useShellPreferences } from '../../hooks/useShellPreferences';

export interface ShellApplication {
  id: number;
  name: string;
  code: string;
  description?: string;
  icon?: string;
  default_route: string;
  status: string;
  is_pinned?: boolean;
}

export const shellIcons: Record<string, React.ReactNode> = {
  HomeOutlined: <HomeOutlined />, FolderOutlined: <FolderOutlined />,
  ClockCircleOutlined: <ClockCircleOutlined />, AppstoreOutlined: <AppstoreOutlined />,
  DashboardOutlined: <BarChartOutlined />, DatabaseOutlined: <DatabaseOutlined />,
  ToolOutlined: <ToolOutlined />, SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  ShopOutlined: <ShopOutlined />, CheckOutlined: <CheckOutlined />, BookOutlined: <BookOutlined />,
};
export function shellIcon(name?: string) { return shellIcons[name || ''] || <AppstoreOutlined />; }

export const fixedShellApps = [
  { id: 'home', name: '工作台', icon: 'HomeOutlined', path: '/' },
  { id: 'workflow', name: '流程与待办', icon: 'CheckOutlined', path: '/workflow' },
  { id: 'scheduler', name: '日常任务', icon: 'ClockCircleOutlined', path: '/scheduler' },
  { id: 'more', name: '更多', icon: '', path: '/more' },
];

export interface LibraryApp {
  id: string;
  name: string;
  icon?: string;
  path: string;
  description?: string;
  pinned: boolean;
  application?: ShellApplication;
}

export function useApplicationLibrary(applications: ShellApplication[]) {
  const { preferences } = useShellPreferences();
  return useMemo<LibraryApp[]>(() => [
    ...applications.map(app => ({ id: `app:${app.id}`, name: app.name, icon: app.icon, path: app.default_route || '/', description: app.description || app.code, pinned: Boolean(app.is_pinned), application: app })),
  ].map(app => ({ ...app, name: preferences.appOverrides[app.id]?.label || app.name, icon: preferences.appOverrides[app.id]?.icon || app.icon, pinned: preferences.appOverrides[app.id]?.pinned ?? app.pinned })), [applications, preferences.appOverrides]);
}

interface ApplicationRailProps {
  library: LibraryApp[];
  onOpen: (app: LibraryApp) => void;
  activeKey: string;
  user: AccountMenuUser | null;
  onLogout: () => void;
  onHome: () => void;
}

export function ApplicationRail({ library, onOpen, activeKey, user, onLogout, onHome }: ApplicationRailProps) {
  const navigate = useNavigate();
  const fixedIcons: Record<string, React.ReactNode> = { home: <HomeOutlined />, workflow: <ApartmentOutlined />, scheduler: <HistoryOutlined />, more: <EllipsisOutlined /> };
  const railButton = (id: string, name: string, icon: React.ReactNode, onClick: () => void) => (
    <Tooltip title={name} placement="right" key={id}>
      <button type="button" className={`shell-rail-button ${activeKey === id ? 'is-active' : ''}`} aria-label={name} aria-pressed={activeKey === id} onClick={onClick}>{icon}</button>
    </Tooltip>
  );
  return <nav className="shell-app-rail" aria-label="应用栏">
    <div className="shell-rail-scroll">
      {fixedShellApps.filter(app => app.id !== 'more').map(app => railButton(app.id, app.name, fixedIcons[app.id], () => app.id === 'home' ? onHome() : navigate(app.path)))}
      {library.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned)).map(app => railButton(app.id, app.name, shellIcon(app.icon), () => onOpen(app)))}
      {user?.is_admin && railButton('knowledge', '知识库', <BookOutlined />, () => navigate('/data-center/knowledge'))}
      {fixedShellApps.filter(app => app.id === 'more').map(app => railButton(app.id, app.name, fixedIcons[app.id], () => navigate(app.path)))}
    </div>
    <div className="shell-rail-user"><AccountMenu compact active={activeKey === 'account'} user={user} onNavigate={navigate} onLogout={onLogout} /></div>
  </nav>;
}

export function ApplicationLibrary({ library, onOpen }: { library: LibraryApp[]; onOpen: (app: LibraryApp) => void }) {
  const navigate = useNavigate();
  const { preferences, updatePreferences } = useShellPreferences();
  const [editing, setEditing] = useState<LibraryApp>();
  const [query, setQuery] = useState('');
  const [form] = Form.useForm();
  useEffect(() => { if (editing) form.setFieldsValue({ label: editing.name, icon: editing.icon && shellIcons[editing.icon] ? editing.icon : 'AppstoreOutlined', pinned: editing.pinned }); }, [editing, form]);
  const filtered = library.filter(app => `${app.name} ${app.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  const save = async () => {
    if (!editing) return;
    let values;
    try { values = await form.validateFields(); } catch { return; }
    updatePreferences({ appOverrides: { ...preferences.appOverrides, [editing.id]: { label: values.label.trim(), icon: values.icon, pinned: values.pinned } } });
    setEditing(undefined);
  };
  return <section className="shell-library-page">
    <p className="page-intro">从左侧主菜单切换业务应用，常用应用优先显示。</p>
    <Input.Search aria-label="搜索应用" placeholder="搜索应用名称或用途" value={query} onChange={event => setQuery(event.target.value)} allowClear className="shell-library-search" />
    {filtered.length ? <div className="shell-library-grid">{filtered.map(app => <Card key={app.id} className="shell-library-card"><div className="shell-library-card-top"><span className="shell-library-icon">{shellIcon(app.icon)}</span><Tag>{app.pinned ? '常用应用' : '业务应用'}</Tag></div><Typography.Title level={4}>{app.name}</Typography.Title><Typography.Paragraph type="secondary">{app.description}</Typography.Paragraph><div className="shell-library-actions"><Button onClick={() => setEditing({ ...app, pinned: true })}>{app.pinned ? '自定义' : '设为常用'}</Button><Button type="text" onClick={() => onOpen(app)}>打开 →</Button></div></Card>)}</div> : <Empty description="没有匹配的应用" />}
    <Modal title="自定义应用入口" open={Boolean(editing)} onCancel={() => setEditing(undefined)} onOk={save} okText="保存" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical"><Form.Item name="label" label="显示名称" rules={[{ required: true, whitespace: true, message: '请输入应用名称' }, { max: 32 }]}><Input maxLength={32} /></Form.Item><Form.Item name="icon" label="应用图标"><Select options={Object.keys(shellIcons).map(value => ({ value, label: <Space>{shellIcon(value)}{({ HomeOutlined: '首页', FolderOutlined: '空间', ClockCircleOutlined: '任务', AppstoreOutlined: '应用', DashboardOutlined: '看板', DatabaseOutlined: '数据', ToolOutlined: '工具', SafetyCertificateOutlined: '质量', ShopOutlined: '供应链', CheckOutlined: '流程', BookOutlined: '知识' } as Record<string, string>)[value]}</Space> }))} /></Form.Item><Form.Item name="pinned" label="在主菜单优先显示" valuePropName="checked"><Switch /></Form.Item></Form>
      <Typography.Text type="secondary">仅调整你的应用入口显示，业务应用配置与权限仍沿用现有设置。</Typography.Text>
    </Modal>
  </section>;
}

export function ExtensionLibrary({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const entries = [
    { name: '数据接入', description: '管理数据连接、同步任务与运行记录。', path: '/data-center/sources', icon: <ApiOutlined /> },
    ...(isAdmin ? [{ name: 'AI 技能与工具', description: '管理已注册的 Agent 技能、工具和平台模型设置。', path: '/admin/ai?tab=agent-registry', icon: <ToolOutlined /> }] : []),
  ];
  return <section><div className="shell-library-grid">{entries.map(entry => <Card key={entry.path}><span className="shell-library-icon">{entry.icon}</span><Typography.Title level={4}>{entry.name}</Typography.Title><Typography.Paragraph type="secondary">{entry.description}</Typography.Paragraph><Button onClick={() => navigate(entry.path)}>进入 →</Button></Card>)}</div></section>;
}
