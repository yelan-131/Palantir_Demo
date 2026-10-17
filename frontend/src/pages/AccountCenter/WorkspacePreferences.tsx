import { useEffect, useState, type ReactNode } from 'react';
import { Button, Collapse, Radio, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { BellOutlined, CheckCircleFilled, DesktopOutlined, LayoutOutlined, MessageOutlined, RobotOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import ThemePalette from '../../components/ThemePalette';
import { useShellPreferences, type ShellPreferences } from '../../hooks/useShellPreferences';

const fields = ['density', 'sidebar', 'aiBubbleVisible', 'home', 'language', 'theme'] as const;
type EditablePreferences = Pick<ShellPreferences, typeof fields[number]>;
const pick = (p: ShellPreferences): EditablePreferences => ({ density: p.density, sidebar: p.sidebar, aiBubbleVisible: p.aiBubbleVisible, home: p.home, language: p.language, theme: p.theme });
const densityLabels = { compact: '紧凑', standard: '标准', relaxed: '宽松' };

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="preferences-setting-row"><div className="preferences-row-label"><strong>{title}</strong><p>{description}</p></div><div className="preferences-row-control">{children}</div></div>;
}
function SettingGroup({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return <section className="preferences-group" aria-label={title}><header className="preferences-group-heading"><span className="preferences-group-icon" aria-hidden="true">{icon}</span><div><h3>{title}</h3><p>{description}</p></div></header>{children}</section>;
}

function WorkspacePreview({ draft }: { draft: EditablePreferences }) {
  const [expanded, setExpanded] = useState(false);
  return <aside className={`preferences-preview${expanded ? ' is-expanded' : ''}`} aria-label="工作空间实时预览">
    <div className="preferences-preview-heading"><h3>工作空间预览</h3><span><i />实时</span><Button className="preferences-preview-toggle" type="text" size="small" aria-expanded={expanded} aria-controls="preferences-preview-mini" onClick={() => setExpanded(value => !value)}>{expanded ? '收起预览' : '展开预览'}</Button></div>
    <p>调整左侧选项，查看布局变化</p>
    <div id="preferences-preview-mini" className={`preferences-mini preferences-mini-${draft.density} preferences-mini-${draft.sidebar}`} role="img" aria-label={`${densityLabels[draft.density]}密度，菜单栏${draft.sidebar === 'expanded' ? '展开' : '折叠'}，AI 助手${draft.aiBubbleVisible ? '显示' : '隐藏'}`}>
      <div className="preferences-mini-rail" aria-hidden="true"><LayoutOutlined /><DesktopOutlined /><RobotOutlined /></div>
      <div className="preferences-mini-menu" aria-hidden="true"><b /><i /><i /><i /></div>
      <div className="preferences-mini-workspace" aria-hidden="true"><div className="preferences-mini-topbar"><b /><i /></div><div className="preferences-mini-content"><div className="preferences-mini-title">我的工作台<span>示例</span></div><div className="preferences-mini-metrics"><div><span>待审批</span><strong>12</strong></div><div><span>进行中</span><strong>8</strong></div></div><div className="preferences-mini-table"><div className="preferences-mini-table-head"><span>工作事项</span><span>状态</span></div>{['生产计划审核', '质量事件复核', '设备维护申请'].map(t => <div className="preferences-mini-table-row" key={t}><span>{t}</span><i /></div>)}</div></div></div>
      {draft.aiBubbleVisible && <span className="preferences-mini-ai" aria-hidden="true"><MessageOutlined /></span>}
    </div>
    <div className="preferences-preview-caption"><span>科技灰白</span><strong>{densityLabels[draft.density]}密度</strong></div>
    <div className="preferences-preview-note"><CheckCircleFilled /><p>先预览，再应用。<br /><span>保存后更新真实工作空间。</span></p></div>
    <div className="preferences-preview-colors" aria-hidden="true">{['#FFFFFF', '#F2F3F5', '#CBD2DA', '#68717D', '#202326', '#394D63'].map(c => <i key={c} style={{ background: c }} />)}</div>
    <Collapse ghost className="preferences-palette" items={[{ key: 'palette', label: '标准色系与设计规范', children: <ThemePalette /> }]} />
  </aside>;
}

export default function WorkspacePreferences() {
  const { preferences, updatePreferences, persisted } = useShellPreferences();
  const [state, setState] = useState(() => ({ baseline: pick(preferences), draft: pick(preferences) }));
  // Merge externally changed fields only when the user has not edited them.
  useEffect(() => {
    const next = pick(preferences);
    setState(previous => ({ baseline: next, draft: fields.reduce((draft, key) => ({ ...draft, [key]: previous.draft[key] === previous.baseline[key] ? next[key] : previous.draft[key] }), { ...previous.draft }) }));
  }, [preferences]);
  const { draft, baseline } = state;
  const changed = fields.filter(key => draft[key] !== baseline[key]);
  const update = <K extends keyof EditablePreferences>(key: K, value: EditablePreferences[K]) => setState(previous => ({ ...previous, draft: { ...previous.draft, [key]: value } }));
  const save = () => {
    const updates = Object.fromEntries(changed.map(key => [key, draft[key]])) as Partial<EditablePreferences>;
    const result = updatePreferences(updates);
    const applied = pick(result.preferences);
    setState({ baseline: applied, draft: applied });
    if (result.persisted) message.success('工作偏好已保存并应用');
    else message.warning('偏好已应用；浏览器存储不可用，刷新后可能无法保留');
  };
  return <section className="workspace-preferences" aria-label="工作偏好设置">
    <div className="preferences-scroll">
      <header className="preferences-page-heading"><div><Typography.Title level={2}>工作偏好</Typography.Title><p>调整界面与工作习惯，找到适合自己的办公节奏。</p></div><Tag>个人偏好</Tag></header>
      <div className="preferences-layout"><div className="preferences-groups">
        <SettingGroup title="外观与布局" description="清晰的灰白层次，舒适的显示密度" icon={<DesktopOutlined />}>
          <SettingRow title="界面主题" description="当前提供科技灰白；深色主题规划中。"><Radio.Group aria-label="界面主题" value={draft.theme} onChange={event => update('theme', event.target.value)} className="preferences-theme-options"><Radio.Button value="tech-white"><span className="preferences-theme-thumb" aria-hidden="true"><i /><i /><i /></span><strong>科技灰白</strong><CheckCircleFilled /></Radio.Button><Radio.Button value="dark" disabled><span className="preferences-dark-dot" />深色 · 规划中</Radio.Button></Radio.Group></SettingRow>
          <SettingRow title="显示密度" description="调整列表、表格与控件的留白。"><Radio.Group aria-label="显示密度" optionType="button" buttonStyle="solid" value={draft.density} onChange={event => update('density', event.target.value)} options={[{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'relaxed', label: '宽松' }]} /></SettingRow>
          <SettingRow title="默认菜单栏" description="设置工作空间导航的展开方式。"><Radio.Group aria-label="默认菜单栏" optionType="button" buttonStyle="solid" value={draft.sidebar} onChange={event => update('sidebar', event.target.value)} options={[{ value: 'expanded', label: '展开' }, { value: 'collapsed', label: '折叠' }]} /></SettingRow>
        </SettingGroup>
        <SettingGroup title="工作习惯" description="保留常用页面与语言偏好" icon={<LayoutOutlined />}>
          <SettingRow title="默认首页" description="保留进入平台时的首页偏好。"><Select aria-label="默认首页" value={draft.home} onChange={value => update('home', value)} options={[{ label: '我的工作台', value: 'workspace' }, { label: '当前应用默认页', value: 'current-app' }, { label: '系统管理', value: 'system-admin' }]} /></SettingRow>
          <SettingRow title="界面语言" description="当前支持简体中文。"><Select aria-label="界面语言" value={draft.language} onChange={value => update('language', value)} options={[{ label: '简体中文', value: 'zh-CN' }, { label: 'English · 规划中', value: 'en-US', disabled: true }]} /></SettingRow>
        </SettingGroup>
        <SettingGroup title="AI 助手" description="在需要的时候，随时发起对话" icon={<RobotOutlined />}>
          <SettingRow title="显示助手气泡" description="在工作区右下角保留 AI 对话入口。"><Switch aria-label="显示助手气泡" checked={draft.aiBubbleVisible} onChange={value => update('aiBubbleVisible', value)} /></SettingRow>
        </SettingGroup>
        <SettingGroup title="通知偏好" description="通知分类预览，尚未接入保存与推送配置" icon={<BellOutlined />}>
          <SettingRow title="待办与审批提醒" description="新的审批任务与申请进展。"><Switch aria-label="待办与审批提醒预览" defaultChecked /></SettingRow>
          <SettingRow title="风险与质量预警" description="需要关注的风险与质量异常。"><Switch aria-label="风险与质量预警预览" defaultChecked /></SettingRow>
          <SettingRow title="数据任务运行结果" description="同步、导入等任务的运行结果。"><Switch aria-label="数据任务运行结果预览" /></SettingRow>
        </SettingGroup>
      </div><WorkspacePreview draft={draft} /></div>
    </div>
    <footer className="preferences-savebar"><div className={`preferences-save-status${changed.length ? ' is-dirty' : ''}`} role="status"><i /><span>{changed.length ? `${changed.length} 项偏好待应用` : !persisted ? '已应用 · 仅当前窗口保留' : '偏好已同步'}<small>{changed.length ? '预览不会改变当前界面' : persisted ? '按账号保存在当前浏览器' : '浏览器存储不可用，刷新后可能无法保留'}</small></span></div><Space wrap><Button icon={<UndoOutlined />} disabled={!changed.length} onClick={() => setState(previous => ({ ...previous, draft: { ...previous.baseline } }))}>还原更改</Button><Button type="primary" icon={<SaveOutlined />} disabled={!changed.length} onClick={save}>保存并应用</Button></Space></footer>
  </section>;
}
