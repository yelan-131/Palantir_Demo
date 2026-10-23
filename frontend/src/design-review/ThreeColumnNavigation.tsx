import React from 'react';
import { Link } from 'react-router-dom';
import { App, Avatar, Dropdown, Tooltip } from 'antd';
import { ApartmentOutlined, AppstoreOutlined, CheckOutlined, DatabaseOutlined, EllipsisOutlined, FormOutlined, HomeOutlined, SafetyCertificateOutlined, SettingOutlined, ShopOutlined, TableOutlined, ToolOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { applications, type Dataset } from './data';

const icons: Record<number, React.ReactNode> = {
  1: <ApartmentOutlined />,
  2: <SafetyCertificateOutlined />,
  3: <ShopOutlined />,
  4: <ToolOutlined />,
};

export function contextForPath(page: string, data: Dataset) {
  const form = data.forms.find(item => item.route_path === page);
  const application = applications.find(item => item.default_route === page)
    || applications.find(item => item.id === form?.applicationId);
  if (page.startsWith('/studio')) return { key: 'studio', title: '应用配置', category: '构建业务应用', icon: <SettingOutlined />, application: undefined };
  if (page.startsWith('/data-center')) return { key: 'data', title: '数据中心', category: '数据与业务关联', icon: <DatabaseOutlined />, application: undefined };
  if (application) return { key: 'app:' + application.id, title: application.name, category: '业务应用', icon: icons[application.id], application };
  return { key: 'workspace', title: '工作台', category: '个人工作空间', icon: <HomeOutlined />, application: undefined };
}

export default function ThreeColumnNavigation({ data, page, collapsed, onReset }: {
  data: Dataset;
  page: string;
  collapsed: boolean;
  onReset: () => void;
}) {
  const context = contextForPath(page, data);
  const { modal } = App.useApp();
  const railLink = (key: string, name: string, path: string, icon: React.ReactNode) => (
    <Tooltip title={name} placement="right" key={key}>
      <Link to={path} aria-label={name} className={'r3-rail-link ' + (context.key === key ? 'active' : '')} aria-current={context.key === key ? 'page' : undefined}>
        {icon}
      </Link>
    </Tooltip>
  );
  const item = (path: string, name: string, icon: React.ReactNode, count?: number) => (
    <Link to={path} key={path} className={'r3-menu-item ' + (page === path ? 'active' : '')} aria-current={page === path ? 'page' : undefined}>
      {icon}<span>{name}</span>{count !== undefined && <em>{count}</em>}
    </Link>
  );
  const studioFormId = Number(page.match(/^\/studio\/forms\/(\d+)/)?.[1]);
  const relatedForms = context.application ? data.forms.filter(form => form.applicationId === context.application!.id) : data.forms;
  const relatedItems = context.application ? data.items.filter(record => record.application.id === context.application!.id) : data.items;

  return <>
    <nav className="r3-app-rail" aria-label="应用栏">
      <Tooltip title="ManuFoundry" placement="right"><Link to="/" className="r3-brand" aria-label="ManuFoundry 首页"><span /><span /><span /></Link></Tooltip>
      <div className="r3-rail-top">
        {railLink('workspace', '工作台', '/', <HomeOutlined />)}
        {railLink('studio', '应用配置', '/studio', <AppstoreOutlined />)}
        {railLink('data', '数据中心', '/data-center', <DatabaseOutlined />)}
      </div>
      <div className="r3-rail-divider" />
      <div className="r3-rail-apps">
        {applications.map(application => railLink('app:' + application.id, application.name, application.default_route, icons[application.id]))}
      </div>
      <div className="r3-rail-bottom">
        <Tooltip title="关于设计预览" placement="right"><button className="r3-rail-link" aria-label="关于设计预览" onClick={() => modal.info({ title: 'ManuFoundry · 三栏工作空间', content: '应用栏负责切换工作区域，上下文菜单展示区域内的业务页面，工作区承载表单、记录与审批。当前使用符合项目接口结构的本地演示数据。', okText: '知道了' })}><EllipsisOutlined /></button></Tooltip>
        <Dropdown menu={{ items: [{ key: 'reset', label: '重置演示数据' }], onClick: onReset }} trigger={['click']} placement="topLeft"><button className="r3-account" aria-label="个人菜单"><Avatar size={27}>我</Avatar></button></Dropdown>
      </div>
    </nav>
    <aside id="r3-context-menu" className={'r3-context ' + (collapsed ? 'is-collapsed' : '')} aria-label="上下文菜单" aria-hidden={collapsed} {...(collapsed ? { inert: '' } as Record<string, string> : {})}>
      <header className="r3-context-header"><span className="r3-context-icon">{context.icon}</span><div><h2>{context.title}</h2><p>{context.category}</p></div></header>
      <div className="r3-context-scroll">
        {context.key === 'workspace' ? <>
          <div className="r3-menu-label">工作空间</div>
          {item('/', '我的工作台', <HomeOutlined />)}
          {item('/workflow', '流程与待办', <UnorderedListOutlined />, data.view_counts.pending)}
          {item('/forms', '业务表单', <FormOutlined />)}
          <div className="r3-menu-label">业务应用</div>
          {applications.map(application => item(application.default_route, application.name, icons[application.id]))}
        </> : context.application ? <>
          <div className="r3-menu-label">应用页面</div>
          {item(context.application.default_route, context.application.name, <AppstoreOutlined />)}
          <div className="r3-menu-label">业务表单 <span>{relatedForms.length}</span></div>
          {relatedForms.map(form => item(form.route_path, form.name, <TableOutlined />))}
          <div className="r3-menu-label">流程与协作</div>
          {item('/workflow', '流程与待办', <CheckOutlined />, data.view_counts.pending)}
          <div className="r3-menu-hint">申请从业务表单发起，审批进度与来源记录关联。</div>
        </> : context.key === 'studio' ? <>
          <div className="r3-menu-label">应用配置</div>
          {item('/studio', '应用、表单与菜单', <AppstoreOutlined />)}
          <div className="r3-menu-label">表单设计 <span>{data.forms.length}</span></div>
          {data.forms.map(form => <Link key={form.id} to={'/studio/forms/' + form.id} className={'r3-menu-item ' + (studioFormId === form.id ? 'active' : '')} aria-current={studioFormId === form.id ? 'page' : undefined}><FormOutlined /><span>{form.name}</span><small>V{form.version}</small></Link>)}
          <div className="r3-menu-hint">保存为草稿后继续编辑，发布配置后应用到业务页面。</div>
        </> : <>
          <div className="r3-menu-label">数据治理</div>
          {item('/data-center', '数据资产与映射', <DatabaseOutlined />)}
          <div className="r3-menu-label">业务数据 <span>{data.forms.length}</span></div>
          {data.forms.map(form => item(form.route_path, form.name, <TableOutlined />))}
          <div className="r3-menu-hint">业务数据与已发布表单保持一致。点击表单查看关联记录。</div>
        </>}
      </div>
      <footer className="r3-context-footer"><span><i className="r-live-dot" />{context.application ? '应用已发布' : '本地设计预览'}</span><small>{context.application ? `${relatedForms.length} 个表单 · ${relatedItems.length} 条记录` : 'ManuFoundry'}</small></footer>
    </aside>
  </>;
}
