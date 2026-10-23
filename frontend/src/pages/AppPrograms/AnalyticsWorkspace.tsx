import React from 'react';
import { Alert, Button, Dropdown, Empty, Input, Modal, Select, Space, Spin, Tooltip, Typography, message } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, DatabaseOutlined, EditOutlined, FilterOutlined, HistoryOutlined, MoreOutlined, PlusOutlined, RedoOutlined, SafetyCertificateOutlined, SaveOutlined, SkinOutlined, UndoOutlined } from '@ant-design/icons';
import { Link, useBlocker, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import AnalyticsDashboard, { type AnalyticsDataQuery } from './AnalyticsDashboard';
import AnalyticsEditorPanel from './AnalyticsEditorPanel';
import AnalyticsVersionHistory from './AnalyticsVersionHistory';
import AnalyticsMetricLibrary from './AnalyticsMetricLibrary';
import { formatAnalyticsVersionTime } from './analyticsVersionUtils';
import { getAnalyticsEditor, loadPublishedAnalytics, previewAnalyticsDesign, publishAnalyticsDesign, saveAnalyticsDraft } from './analyticsApi';
import { analyticsErrorMessage, copyAnalyticsDesign, normalizeAnalyticsDesign, sameAnalyticsDesign, moveAnalyticsWidget } from './analyticsEditorState';
import type { AnalyticsEditorPanelName, AnalyticsEditorState, AnalyticsVersionDetail, AnalyticsWidgetTabName, RuntimeAnalyticsData, RuntimeAnalyticsDesign } from './analyticsTypes';
import './analytics-workspace.css';

interface Props {
  program: { id: string; title?: string; subtitle: string };
  payload: { analyticsDesign: RuntimeAnalyticsDesign; analyticsData?: RuntimeAnalyticsData; analyticsPublishedVersion?: number | null; analyticsPublishedAt?: string | null };
  onSettings?: () => void;
  onReload?: () => void;
  loading?: boolean;
}

interface EditorTarget {
  panel?: AnalyticsEditorPanelName | null;
  widgetId?: string;
  widgetTab?: AnalyticsWidgetTabName;
}

export default function AnalyticsWorkspace({program, payload}: Props) {
  const admin = useAuthStore(store => Boolean(store.user?.is_admin));
  const [searchParams, setSearchParams] = useSearchParams();
  const [configurationOpen, setConfigurationOpen] = React.useState(false);
  const configuring = admin && configurationOpen;
  const [editor, setEditor] = React.useState<AnalyticsEditorState>();
  const [draft, setDraft] = React.useState(() => normalizeAnalyticsDesign(payload.analyticsDesign));
  const [saved, setSaved] = React.useState(draft);
  const [published, setPublished] = React.useState(payload);
  const [panel, setPanel] = React.useState<AnalyticsEditorPanelName | null>('widget');
  const [selectedWidgetId, setSelectedWidgetId] = React.useState<string>();
  const [widgetTab, setWidgetTab] = React.useState<AnalyticsWidgetTabName>('data');
  const [contextWidgetId, setContextWidgetId] = React.useState<string>();
  const [contextMenuOpen, setContextMenuOpen] = React.useState(false);
  const [past, setPast] = React.useState<RuntimeAnalyticsDesign[]>([]);
  const [future, setFuture] = React.useState<RuntimeAnalyticsDesign[]>([]);
  const [operation, setOperation] = React.useState<'load' | 'save' | 'check' | 'publish' | null>(null);
  const operationRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const [conflict, setConflict] = React.useState(false);
  const [exitPrompt, setExitPrompt] = React.useState(false);
  const [publishCheck, setPublishCheck] = React.useState<{errors: string[]} | null>(null);
  const [releaseNote, setReleaseNote] = React.useState('');
  const [historicalPreview, setHistoricalPreview] = React.useState<AnalyticsVersionDetail>();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const autoEntered = React.useRef(false);
  const alive = React.useRef(true);
  const [libraryFocusId, setLibraryFocusId] = React.useState<string>();
  const [libraryDirty, setLibraryDirty] = React.useState(false);
  const [libraryBusy, setLibraryBusy] = React.useState(false);
  const libraryBusyRef = React.useRef(false);
  libraryBusyRef.current = libraryBusy;
  const locked = !!operation || libraryBusy;
  const dirty = configuring && !sameAnalyticsDesign(draft, saved);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty || libraryDirty;
  const blocker = useBlocker(({currentLocation, nextLocation}) => (dirty || libraryDirty || locked) && currentLocation.pathname !== nextLocation.pathname);
  const [modal, modalContext] = Modal.useModal();
  const confirmation = React.useRef<{destroy: () => void}>();

  React.useEffect(() => { alive.current = true; return () => { alive.current = false; confirmation.current?.destroy(); }; }, []);
  React.useEffect(() => { setPublished(payload); }, [payload]);
  React.useEffect(() => {
    if (!admin) { setConfigurationOpen(false); setContextMenuOpen(false); setExitPrompt(false); setPublishCheck(null); setHistoricalPreview(undefined); setError(''); confirmation.current?.destroy(); }
  }, [admin]);
  React.useEffect(() => {
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || operationRef.current || libraryBusyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, []);

  const showError = (cause: unknown, fallback: string) => {
    if (!alive.current) return;
    setError(analyticsErrorMessage(cause, fallback));
    setConflict((cause as {response?: {status?: number}})?.response?.status === 409 && !analyticsErrorMessage(cause, '').includes('首次发布'));
  };

  const enterEditor = React.useCallback(async (target?: EditorTarget) => {
    if (!admin || operationRef.current) return;
    operationRef.current = true; setOperation('load'); setError(''); setConflict(false);
    try {
      const {data} = await getAnalyticsEditor(program.id);
      if (!alive.current) return;
      const next = normalizeAnalyticsDesign(data.design || data.publishedDesign || payload.analyticsDesign);
      setEditor(data); setDraft(next); setSaved(copyAnalyticsDesign(next));
      if (data.publishedDesign) setPublished({analyticsDesign: data.publishedDesign, analyticsPublishedVersion: data.publishedVersion, analyticsPublishedAt: data.publishedAt});
      const requestedPanel = target?.panel === undefined ? searchParams.get('panel') : target.panel;
      const initialPanel = target?.panel === null ? 'style' : ['widget', 'data', 'library', 'filters', 'style', 'add', 'permissions', 'versions'].includes(requestedPanel || '') ? requestedPanel as AnalyticsEditorPanelName : 'widget';
      const selected = target?.widgetId ? next.widgets?.find(widget => widget.id === target.widgetId)?.id : next.widgets?.[0]?.id;
      if (target?.widgetId && !selected) message.info('该组件已在草稿中移除，请选择其他组件。');
      setSelectedWidgetId(selected); setWidgetTab(target?.widgetTab || 'data'); setPanel(initialPanel); setPast([]); setFuture([]); setHistoricalPreview(undefined); setReleaseNote(''); setConfigurationOpen(true);
    } catch (cause) { showError(cause, '无法读取看板草稿，请重试。'); }
    finally { operationRef.current = false; if (alive.current) setOperation(null); }
  }, [admin, program.id, payload.analyticsDesign, searchParams]);

  React.useEffect(() => {
    if (admin && searchParams.get('edit') === '1' && !autoEntered.current) { autoEntered.current = true; void enterEditor(); }
  }, [admin, searchParams, enterEditor]);

  const changeDesign = (next: RuntimeAnalyticsDesign) => {
    if (!admin || operationRef.current || sameAnalyticsDesign(next, draft)) return;
    setPast(current => [...current.slice(-79), copyAnalyticsDesign(draft)]);
    setFuture([]); setDraft(copyAnalyticsDesign(next)); setPublishCheck(null); setHistoricalPreview(undefined);
  };
  const undo = () => {
    if (!past.length || operationRef.current || libraryBusyRef.current) return;
    setHistoricalPreview(undefined); setPublishCheck(null);
    setFuture(current => [copyAnalyticsDesign(draft), ...current]);
    setDraft(past[past.length - 1]); setPast(current => current.slice(0, -1));
  };
  const redo = () => {
    if (!future.length || operationRef.current || libraryBusyRef.current) return;
    setHistoricalPreview(undefined); setPublishCheck(null);
    setPast(current => [...current, copyAnalyticsDesign(draft)]); setDraft(future[0]); setFuture(current => current.slice(1));
  };

  const save = async () => {
    if (!editor || operationRef.current || libraryBusyRef.current || libraryDirty) return false;
    operationRef.current = true; setOperation('save'); setError(''); setConflict(false);
    try {
      const {data} = await saveAnalyticsDraft(program.id, draft, editor.revision);
      if (!alive.current) return false;
      setEditor(data); setSaved(copyAnalyticsDesign(draft)); message.success('草稿已保存，已发布看板保持不变');
      return true;
    } catch (cause) { showError(cause, '草稿保存失败，当前修改仍保留。'); return false; }
    finally { operationRef.current = false; if (alive.current) setOperation(null); }
  };

  const leave = () => {
    setExitPrompt(false); setLibraryDirty(false);
    if (blocker.state === 'blocked') { blocker.proceed(); return; }
    setConfigurationOpen(false); setHistoricalPreview(undefined); setError(''); setConflict(false);
    if (searchParams.has('edit')) { const next = new URLSearchParams(searchParams); next.delete('edit'); next.delete('panel'); setSearchParams(next, {replace: true}); }
  };
  const cancelLeave = () => { setExitPrompt(false); if (blocker.state === 'blocked') blocker.reset(); };
  const requestExit = () => { if (locked) return; if (dirty || libraryDirty) setExitPrompt(true); else leave(); };

  const checkPublish = async () => {
    if (!editor || operationRef.current || libraryBusyRef.current || libraryDirty) return;
    operationRef.current = true; setOperation('check'); setError(''); setConflict(false);
    try {
      const {data} = await previewAnalyticsDesign(program.id, draft);
      if (alive.current) setPublishCheck({errors: data.analyticsData?.errors || []});
    } catch (cause) { showError(cause, '发布检查失败，当前修改仍保留。'); }
    finally { operationRef.current = false; if (alive.current) setOperation(null); }
  };

  const publish = async () => {
    if (!editor || operationRef.current || libraryBusyRef.current || libraryDirty || publishCheck?.errors.length) return;
    operationRef.current = true; setOperation('publish'); setError(''); setConflict(false);
    try {
      const {data} = await publishAnalyticsDesign(program.id, draft, editor.revision, releaseNote.trim());
      if (!alive.current) return;
      setEditor(data); setSaved(copyAnalyticsDesign(draft)); setPublishCheck(null);
      setPublished({analyticsDesign: data.publishedDesign || draft, analyticsPublishedVersion: data.publishedVersion, analyticsPublishedAt: data.publishedAt});
      setPast([]); setFuture([]); setHistoricalPreview(undefined); setReleaseNote(''); setConfigurationOpen(false); setRefreshKey(key => key + 1);
      message.success(`看板 v${data.publishedVersion} 已发布`);
      if (searchParams.has('edit')) { const next = new URLSearchParams(searchParams); next.delete('edit'); next.delete('panel'); setSearchParams(next, {replace: true}); }
    } catch (cause) { showError(cause, '发布失败，当前草稿仍保留。'); setPublishCheck(null); }
    finally { operationRef.current = false; if (alive.current) setOperation(null); }
  };

  const previewDesign = historicalPreview?.design || draft;
  const previewData = React.useCallback(async (query: AnalyticsDataQuery) => {
    const {data} = await previewAnalyticsDesign(program.id, previewDesign, query);
    return data.analyticsData;
  }, [program.id, previewDesign]);
  const reloadPublished = React.useCallback(async (query: AnalyticsDataQuery) => {
    const {data} = await loadPublishedAnalytics(program.id, query);
    // A different editor may have published a new schema since this page opened.
    // Keep the chart bindings and the data from this response on the same version.
    if ('analyticsDesign' in data) {
      const nextDesign = data.analyticsDesign || {};
      setPublished(current => sameAnalyticsDesign(current.analyticsDesign, nextDesign) && current.analyticsPublishedVersion === data.analyticsPublishedVersion ? current : {analyticsDesign: nextDesign, analyticsData: data.analyticsData, analyticsPublishedVersion: data.analyticsPublishedVersion, analyticsPublishedAt: data.analyticsPublishedAt});
    }
    return (data.analyticsData || {}) as RuntimeAnalyticsData;
  }, [program.id]);
  const canSwitchPanel = (next: AnalyticsEditorPanelName) => {
    if (libraryBusyRef.current) return false;
    if (panel === 'library' && next !== 'library' && libraryDirty) { message.info('请先保存指标草稿或还原编辑，再切换配置。'); return false; }
    return true;
  };
  const switchPanel = (next: AnalyticsEditorPanelName) => { if (!canSwitchPanel(next)) return; if (next !== 'versions') setHistoricalPreview(undefined); setPanel(next); };
  const openMetricLibrary = (id?: string) => { if (!canSwitchPanel('library')) return; setLibraryFocusId(id); switchPanel('library'); };
  const selectWidget = (id: string) => { if (!canSwitchPanel('widget')) return; setSelectedWidgetId(id); switchPanel('widget'); };
  const hasUnpublishedDraft = editor && (configuring || editor.publishedVersion === published.analyticsPublishedVersion) && !sameAnalyticsDesign(saved, normalizeAnalyticsDesign(configuring ? editor.publishedDesign || {} : published.analyticsDesign));
  const publishable = !!editor && (!editor.publishedVersion || !sameAnalyticsDesign(draft, normalizeAnalyticsDesign(editor.publishedDesign || {})));
  const restoreVersion = (version: AnalyticsVersionDetail) => {
    if (!admin || operationRef.current) return;
    confirmation.current = modal.confirm({title: `将 v${version.version} 恢复到草稿？`,
      content: <><p>{dirty ? '当前未保存的配置会被替换，可通过撤销恢复。' : '历史配置会载入当前草稿，可继续修改或撤销。'}</p><p>保存并发布后才会对查看者生效，业务数据不受影响。</p></>,
      okText: '恢复到草稿', cancelText: '取消', onOk: () => {
        if (!alive.current || operationRef.current || !useAuthStore.getState().user?.is_admin) return;
        const next = normalizeAnalyticsDesign(version.design);
        changeDesign(next); setHistoricalPreview(undefined); setSelectedWidgetId(next.widgets?.[0]?.id);
        setReleaseNote(`基于 v${version.version} 恢复看板配置`);
        message.success(`已载入 v${version.version}，保存并发布后生效`);
      }});
  };
  const pageSections: Array<[AnalyticsEditorPanelName, string, React.ReactNode]> = [
    ['style', '页面与主题', <SkinOutlined />], ['filters', '全局筛选', <FilterOutlined />], ['add', '添加组件', <PlusOutlined />],
    ['data', '数据与指标', <DatabaseOutlined />], ['library', '共享指标库', <DatabaseOutlined />], ['versions', '版本历史', <HistoryOutlined />], ['permissions', '权限说明', <SafetyCertificateOutlined />],
  ];
  const activePayload = configuring ? {analyticsDesign: previewDesign} : published;
  const contextWidget = activePayload.analyticsDesign.widgets?.find(widget => widget.id === contextWidgetId);
  const openConfiguration = (target: EditorTarget) => {
    setContextMenuOpen(false);
    if (!admin || operationRef.current || !canSwitchPanel(target.panel ?? 'style')) return;
    if (!configuring) { void enterEditor(target); return; }
    if (target.widgetTab) setWidgetTab(target.widgetTab);
    // Switching the embedded page keeps both the draft and the live canvas.
    if (target.widgetId) {
      const selected = draft.widgets?.find(widget => widget.id === target.widgetId)?.id;
      setSelectedWidgetId(selected);
      if (!selected) message.info('此组件不在当前草稿中，可先从历史版本恢复。');
    }
    switchPanel(target.panel ?? 'style');
  };
  const canvas = <main className="analytics-workspace-canvas" aria-label="看板画布" tabIndex={admin ? 0 : undefined}
    onContextMenuCapture={admin ? event => {
      const element = event.target instanceof Element ? event.target : null;
      // Preserve native text editing menus inside filter controls.
      if (element?.closest('input, textarea, [contenteditable="true"], [role="combobox"]')) {
        event.stopPropagation(); setContextMenuOpen(false); return;
      }
      setContextWidgetId(element?.closest<HTMLElement>('[data-analytics-widget-id]')?.dataset.analyticsWidgetId);
    } : undefined}>
    <Spin spinning={operation === 'load'}>
      {!activePayload.analyticsDesign.widgets?.length ? <Empty description="尚未添加看板组件" /> :
        <AnalyticsDashboard key={program.id} program={program} payload={activePayload} hideHeader editing={configuring && !locked && !historicalPreview} onSelectWidget={selectWidget} onReorder={(source, target) => { if (configuring && !locked && !historicalPreview && !libraryDirty) changeDesign(moveAnalyticsWidget(draft, source, target)); }} selectedWidgetId={configuring && panel === 'widget' ? selectedWidgetId : undefined} requestData={configuring ? previewData : reloadPublished} refreshKey={refreshKey} />}
    </Spin>
  </main>;

  const errorNotice = error && <Alert type="error" showIcon message={error} action={conflict && <Button size="small" onClick={() => { confirmation.current = modal.confirm({title:'重新加载服务器草稿？',content:'当前本地修改将被服务器草稿替换。取消可继续保留本地修改。',okText:'重新加载',cancelText:'保留修改',onOk:() => enterEditor({panel, widgetId: selectedWidgetId})}); }}>重新加载草稿</Button>} />;
  return <div className={`analytics-workspace${configuring ? ' analytics-workspace-configuring' : ''}`}>
    {modalContext}
    {!configuring && errorNotice}
    <div className="analytics-workspace-body">
      {admin ? <Dropdown trigger={['contextMenu']} disabled={locked} open={contextMenuOpen} onOpenChange={setContextMenuOpen} overlayClassName="analytics-context-menu" menu={{
        'aria-label': contextWidget ? `${contextWidget.title}配置菜单` : '看板配置菜单',
        items: [
          {key: 'context', type: 'group', label: contextWidget?.title || '看板', children: [
            {key: 'edit', icon: <EditOutlined />, label: contextWidget ? '编辑此组件' : '编辑看板'},
            ...(contextWidget ? [
              {key: 'widget-style', icon: <SkinOutlined />, label: '调整外观'},
              {key: 'widget-interaction', icon: <FilterOutlined />, label: '设置交互'},
            ] : []),
          ]},
          {type: 'divider'},
          ...(contextWidget ? [{key: 'page', label: '看板设置', children: pageSections.map(([key, label, icon]) => ({key, label, icon}))}] : pageSections.map(([key, label, icon]) => ({key, label, icon}))),
        ],
        onClick: ({key}) => openConfiguration(key === 'edit' || key.startsWith('widget-') ? {panel: contextWidget ? 'widget' : null, widgetId: contextWidget?.id, widgetTab: key === 'widget-style' ? 'style' : key === 'widget-interaction' ? 'interaction' : 'data'} : {panel: key as AnalyticsEditorPanelName}),
      }}>{canvas}</Dropdown> : canvas}
      {configuring && <div className={`analytics-settings-page${panel === 'library' ? ' analytics-settings-page-library' : ''}`}>
        <AnalyticsEditorPanel embedded panel={panel || 'widget'} design={draft} programId={program.id} selectedWidgetId={selectedWidgetId} onSelectWidget={selectWidget} onChange={changeDesign} onClose={requestExit} disabled={locked} widgetTab={widgetTab} onWidgetTabChange={setWidgetTab} onOpenMetricLibrary={openMetricLibrary}
          navigation={panel==='widget' ? <Dropdown trigger={['click']} disabled={locked} menu={{items:[
            {key:'widgets',label:'切换组件',children:(draft.widgets || []).map(widget=>({key:`select-widget:${widget.id}`,label:widget.title}))},
            {key:'settings',label:'看板设置',children:pageSections.map(([key,label,icon])=>({key,label,icon}))},
          ],onClick:({key})=>key.startsWith('select-widget:')?selectWidget(key.slice('select-widget:'.length)):switchPanel(key as AnalyticsEditorPanelName)}}><Button type="text" size="small" aria-label="组件配置操作" title="切换组件或打开看板设置" icon={<MoreOutlined />} /></Dropdown> : <div className="analytics-object-navigation"><Select aria-label="看板设置分类" size="small" value={panel || 'style'} options={pageSections.map(([value,label])=>({value,label}))} disabled={locked} onChange={switchPanel} /><Button type="text" size="small" disabled={locked} onClick={()=>switchPanel('widget')}>组件属性</Button></div>}
          status={<div className="analytics-settings-status">
            <div className="analytics-settings-history"><Tooltip title={editor?.draftSavedAt ? `最近保存 ${formatAnalyticsVersionTime(editor.draftSavedAt)}` : '修改在左侧即时预览'}><span className={`analytics-save-status ${dirty ? 'analytics-save-dirty' : hasUnpublishedDraft ? 'analytics-save-pending' : ''}`} role="status">{dirty ? <><EditOutlined /> 未保存修改</> : hasUnpublishedDraft ? <><ClockCircleOutlined /> 草稿待发布</> : <><CheckCircleOutlined /> 与线上版本一致</>}</span></Tooltip><Space size={0}>
              <Tooltip title="撤销"><Button aria-label="撤销" type="text" icon={<UndoOutlined />} disabled={!past.length || locked} onClick={undo} /></Tooltip>
              <Tooltip title="重做"><Button aria-label="重做" type="text" icon={<RedoOutlined />} disabled={!future.length || locked} onClick={redo} /></Tooltip>
            </Space></div>
            {errorNotice}
            {editor && !editor.publishedVersion && !editor.publishedDesign && <Alert type="info" showIcon message="请先完成新表单的首次发布" description={<Link to={`/form-settings/${encodeURIComponent(program.id)}?legacy=1&tab=dashboard`}>前往表单设置</Link>} />}
          </div>}
          content={panel === 'library' ? <AnalyticsMetricLibrary design={draft} focusId={libraryFocusId} refreshKey={editor?.revision} disabled={!!operation} hasUnsavedBoardChanges={dirty} onChange={changeDesign} onPublished={async () => { await enterEditor({panel:'library'}); setRefreshKey(key => key + 1); }} onDirtyChange={setLibraryDirty} onBusyChange={setLibraryBusy} /> : panel === 'versions' ? <AnalyticsVersionHistory programId={program.id} draft={draft} refreshKey={editor?.revision} previewVersion={historicalPreview?.version} disabled={locked} onPreview={setHistoricalPreview} onStopPreview={() => setHistoricalPreview(undefined)} onRestore={restoreVersion} /> : undefined}
          actions={<div className="analytics-settings-actions">{(panel==='library' || historicalPreview) && <span>{panel==='library'?'以下操作仅保存或发布当前看板配置。':`正在预览 v${historicalPreview?.version}，返回草稿后可保存或发布。`}</span>}<div>
            <Button icon={<SaveOutlined />} loading={operation === 'save'} disabled={!dirty || libraryDirty || libraryBusy || !!historicalPreview || (!!operation && operation !== 'save')} onClick={() => { void save(); }}>{panel === 'library' ? '保存看板草稿' : '保存草稿'}</Button>
            <Button type="primary" loading={operation === 'check' || operation === 'publish'} disabled={!publishable || libraryDirty || libraryBusy || !!historicalPreview || (!!operation && !['check', 'publish'].includes(operation))} onClick={() => { void checkPublish(); }}>{panel === 'library' ? '发布当前看板' : editor?.publishedVersion ? '发布新版本' : '创建首个版本'}</Button>
          </div></div>} />
      </div>}
    </div>
    <Modal title={blocker.state === 'blocked' ? '离开当前看板' : '关闭看板配置'} open={admin && (exitPrompt || blocker.state === 'blocked')} onCancel={cancelLeave} closable={!locked} maskClosable={false} footer={<Space wrap><Button disabled={locked} onClick={cancelLeave}>继续配置</Button><Button danger disabled={locked} onClick={leave}>放弃未保存修改</Button><Button type="primary" loading={operation === 'save'} disabled={libraryDirty || libraryBusy || (!!operation && operation !== 'save')} onClick={async () => { if (await save()) leave(); }}>{blocker.state === 'blocked' ? '保存并离开' : '保存并关闭'}</Button></Space>}>
      <Typography.Paragraph>{locked ? '当前操作完成后才能关闭配置。' : libraryDirty ? '共享指标口径尚未保存，请返回指标库保存指标草稿，或放弃未保存修改。' : '当前修改尚未保存。保存草稿后可继续配置，查看者仍看到已发布版本。'}</Typography.Paragraph>
    </Modal>
    <Modal title={`发布看板${editor?.publishedVersion ? ` · v${editor.publishedVersion + 1}` : ''}`} open={admin && !!publishCheck} onCancel={() => setPublishCheck(null)} okText="确认发布" cancelText="继续配置" onOk={() => { void publish(); }} confirmLoading={operation === 'publish'} okButtonProps={{disabled: !!publishCheck?.errors.length}} cancelButtonProps={{disabled: operation === 'publish'}} closable={operation !== 'publish'} maskClosable={false}>
      {publishCheck?.errors.length ? <Alert type="error" showIcon message="发布检查未通过" description={<ul>{publishCheck.errors.map((item, index) => <li key={index}>{item}</li>)}</ul>} /> : <Alert type="success" showIcon message="数据源、指标和组件检查通过" />}
      <Typography.Paragraph className="analytics-publish-summary">将发布 {draft.widgets?.length || 0} 个组件、{draft.datasets?.length || 0} 个数据集和 {draft.metrics?.length || 0} 个指标。查看者的数据权限沿用来源表单。</Typography.Paragraph>
      <div className="analytics-release-note"><label htmlFor="analytics-release-note">版本说明 <span>选填</span></label><Input.TextArea id="analytics-release-note" placeholder="例如：调整产量统计口径，新增班次对比图" value={releaseNote} onChange={event => setReleaseNote(event.target.value)} maxLength={500} showCount rows={3} disabled={operation === 'publish'} /></div>
      <Typography.Text type="secondary">本次仅发布看板配置，其他表单草稿保留。</Typography.Text>
    </Modal>
  </div>;
}
