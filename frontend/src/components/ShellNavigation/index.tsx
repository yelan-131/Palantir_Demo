import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppstoreOutlined, BarChartOutlined, ClockCircleOutlined, DatabaseOutlined, FolderOutlined, HomeOutlined, PlusOutlined, SafetyCertificateOutlined, ShopOutlined, ToolOutlined, CheckOutlined, ApiOutlined, BookOutlined } from '@ant-design/icons';
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

// The rail uses a lighter line language than the content and configuration icons.
function RailIcon({ name, selected }: { name: string; selected: boolean }) {
  const paths: Record<string, React.ReactNode> = {
    home: selected ? <path fill="currentColor" stroke="none" d="M3.5 10.2 12 3.5l8.5 6.7v9a1.3 1.3 0 0 1-1.3 1.3h-4.5v-6.2H9.3v6.2H4.8a1.3 1.3 0 0 1-1.3-1.3z" /> : <><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9" /></>,
    space: <><path d="m7 6 1-2 4 1 1 2 6 1a2 2 0 0 1 1.5 2.4l-1.6 7.2" /><path d="M4.4 8h4l2 2h5a2 2 0 0 1 2 2l-.8 7a2 2 0 0 1-2 1.8H5.3a2 2 0 0 1-2-1.8l-.9-9a2 2 0 0 1 2-2Z" /></>,
    scheduler: <><path d="M12 3.5a8.5 8.5 0 1 1-8.3 6.6M12 7v5l-3 2M3.5 7.5V4h3.5" /></>,
    plugins: <><path d="M16.8 7a7 7 0 1 0 1.7 8.2M16 8a4.4 4.4 0 1 0-3 7.5h2.5" /><path d="m12.5 9.5-2 3.5h8a3.5 3.5 0 0 0 0-7h-2" /></>,
    data: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" /></>,
    workflow: <><path d="M8 4h8v4H8zM4 16h6v4H4zM16 16h6v4h-6zM12 8v4M7 16v-4h12v4" /></>,
    more: <><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export const fixedShellApps = [
  { id: 'home', name: '首页', icon: 'HomeOutlined', path: '/' },
  { id: 'workflow', name: '流程与待办', icon: 'CheckOutlined', path: '/workflow' },
  { id: 'scheduler', name: '定时任务', icon: 'ClockCircleOutlined', path: '/scheduler' },
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
  activeKey: string;
  library: LibraryApp[];
  user: AccountMenuUser | null;
  onOpen: (app: LibraryApp) => void;
  onLogout: () => void;
  onHome: () => void;
}

export function ApplicationRail({ activeKey, library, user, onOpen, onLogout, onHome }: ApplicationRailProps) {
  const navigate = useNavigate();
  const railButton = (id: string, name: string, icon: React.ReactNode, onClick: () => void) => (
    <Tooltip title={name} placement="right" key={id}>
      <button type="button" className={`shell-rail-button ${activeKey === id ? 'is-active' : ''}`} aria-label={name} aria-pressed={activeKey === id} onClick={onClick}>{icon}</button>
    </Tooltip>
  );
  return <nav className="shell-app-rail" aria-label="应用栏">
    <div className="shell-rail-scroll">
      {fixedShellApps.filter(app => app.id !== 'more').map(app => railButton(app.id, app.name, <RailIcon name={app.id} selected={activeKey === app.id} />, () => app.id === 'home' ? onHome() : navigate(app.path)))}
      {library.filter(app => !fixedShellApps.some(fixed => fixed.id === app.id) && (app.pinned || app.id === activeKey)).map(app => railButton(app.id, app.name, shellIcon(app.icon), () => onOpen(app)))}
      {fixedShellApps.filter(app => app.id === 'more').map(app => railButton(app.id, app.name, <RailIcon name={app.id} selected={activeKey === app.id} />, () => navigate(app.path)))}
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
    <p className="page-intro">打开应用，或将常用应用固定到左侧导航。</p>
    <Input.Search aria-label="搜索应用" placeholder="搜索应用名称或用途" value={query} onChange={event => setQuery(event.target.value)} allowClear className="shell-library-search" />
    {filtered.length ? <div className="shell-library-grid">{filtered.map(app => <Card key={app.id} className="shell-library-card"><div className="shell-library-card-top"><span className="shell-library-icon">{shellIcon(app.icon)}</span><Tag>{app.pinned ? '已固定' : '可添加'}</Tag></div><Typography.Title level={4}>{app.name}</Typography.Title><Typography.Paragraph type="secondary">{app.description}</Typography.Paragraph><div className="shell-library-actions"><Button onClick={() => setEditing({ ...app, pinned: true })}>{app.pinned ? '自定义' : '添加到应用栏'}</Button><Button type="text" onClick={() => onOpen(app)}>打开 →</Button></div></Card>)}</div> : <Empty description="没有匹配的应用" />}
    <Modal title="自定义应用入口" open={Boolean(editing)} onCancel={() => setEditing(undefined)} onOk={save} okText="保存" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical"><Form.Item name="label" label="显示名称" rules={[{ required: true, whitespace: true, message: '请输入应用名称' }, { max: 32 }]}><Input maxLength={32} /></Form.Item><Form.Item name="icon" label="应用图标"><Select options={Object.keys(shellIcons).map(value => ({ value, label: <Space>{shellIcon(value)}{({ HomeOutlined: '首页', FolderOutlined: '空间', ClockCircleOutlined: '任务', AppstoreOutlined: '应用', DashboardOutlined: '看板', DatabaseOutlined: '数据', ToolOutlined: '工具', SafetyCertificateOutlined: '质量', ShopOutlined: '供应链', CheckOutlined: '流程', BookOutlined: '知识' } as Record<string, string>)[value]}</Space> }))} /></Form.Item><Form.Item name="pinned" label="固定到应用栏" valuePropName="checked"><Switch /></Form.Item></Form>
      <Typography.Text type="secondary">仅调整你的应用入口显示，业务应用配置与权限仍沿用现有设置。</Typography.Text>
    </Modal>
  </section>;
}

export function ExtensionLibrary({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const entries = [
    { name: '数据连接', description: '连接数据库和外部数据源，查看真实连接状态。', path: '/data-center/sources', icon: <ApiOutlined /> },
    ...(isAdmin ? [{ name: 'AI 技能与工具', description: '管理已注册的 Agent 技能、工具和平台模型设置。', path: '/admin/ai?tab=agent-registry', icon: <ToolOutlined /> }] : []),
  ];
  return <section><div className="shell-library-grid">{entries.map(entry => <Card key={entry.path}><span className="shell-library-icon">{entry.icon}</span><Typography.Title level={4}>{entry.name}</Typography.Title><Typography.Paragraph type="secondary">{entry.description}</Typography.Paragraph><Button onClick={() => navigate(entry.path)}>进入 →</Button></Card>)}</div></section>;
}
