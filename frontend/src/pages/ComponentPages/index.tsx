import {flushSync} from 'react-dom';
import React, {lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useBlocker, useNavigate, useParams, useSearchParams} from 'react-router-dom';
import {Alert, Button, Card, Col, Dropdown, Drawer, Modal, Row, Select, Space, Spin, Tooltip, Typography, message} from 'antd';
import {DatabaseOutlined, FilterOutlined, HolderOutlined, HistoryOutlined, PlusOutlined, RedoOutlined, SaveOutlined, SkinOutlined, UndoOutlined} from '@ant-design/icons';
import StatisticalWidget from './StatisticalWidget';
import FilterWidget from './FilterWidget';
import ResizeHandle from './ResizeHandle';
import {dashboardStyleDefaults} from '../AppPrograms/analyticsWidgetAppearance';
import api, {getPlatformForm, listPlatformForms, type PlatformForm} from '@/services/api';
import {useAuthStore} from '@/stores/authStore';
import {useShellPageTitle} from '@/components/ShellPageTitle';
import DynamicPage from '../DynamicPage';
import type {RuntimeAnalyticsData} from '../AppPrograms/analyticsTypes';
import {ensureListFilter, componentQuery, type FilterContribution, listFilters, moveWidget, pageDataSignature, retainFilters, widgetSourceId, type PageDefinition, type PageState, type PageWidget, type WidgetType} from './model';
import {pagePresentation} from './model';
import Inspector, {sections, type BusinessTab, type Panel, type WidgetTab} from './Inspector';
import {buildAnalyticsContextMenu} from '../AppPrograms/AnalyticsContextMenu';
import '../AppPrograms/analytics-workspace.css';
import './style.css';
import '../AppPrograms/analytics-paper.css';

const names: Record<WidgetType, string> = {'record-list': '业务列表', 'record-filter': '业务筛选', metric: '指标卡', chart: '分组图表'};
const FormSettings = lazy(() => import('../FormSettings'));
const errorText = (error: unknown) => {
  const detail = (error as {response?: {data?: {detail?: unknown}}})?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if(Array.isArray(detail))return detail.map(item=>`${(item.loc||[]).filter((part:unknown)=>part!=='body').join(' / ')}：${item.msg||'配置无效'}`).join('；');
  if (detail && typeof detail === 'object' && 'errors' in detail) return String((detail as {errors: unknown[]}).errors.join('；'));
  return '操作失败，请重试';
};
const unwrap = <T,>(response: {data: unknown}): T => {
  const value = response.data as {data?: T};
  return (value?.data ?? value) as T;
};
type RouteExit = {proceed: () => void; reset: () => void};
function NavigationGuard({enabled,onBlocked}: {enabled: boolean;onBlocked:(value: RouteExit)=>void}) {
  const blocker = useBlocker(({currentLocation,nextLocation})=>enabled&&(
    currentLocation.pathname !== nextLocation.pathname ||
    new URLSearchParams(currentLocation.search).get('edit') !== new URLSearchParams(nextLocation.search).get('edit')
  ));
  useEffect(()=>{if(blocker.state==='blocked')onBlocked({proceed:blocker.proceed,reset:blocker.reset});},[blocker.state,onBlocked]);
  return null;
}

export default function ComponentPages({pageCode}: {pageCode?: string} = {}) {
  const navigate = useNavigate();
  const {code: routeCode} = useParams<{code: string}>();
  const code = pageCode || routeCode;
  const admin = Boolean(useAuthStore(state => state.user?.is_admin));
  const [searchParams] = useSearchParams();
  const startInEditor = admin && !pageCode && searchParams.get('edit') === '1';
  const accountKey = useAuthStore(state=>state.user?`${state.user.tenant_id}:${state.user.id}:${state.user.is_admin}`:'anonymous');
  const [forms, setForms] = useState<PlatformForm[]>([]);
  const [roles, setRoles] = useState<Array<{id: number; name: string; label?: string}>>([]);
  const [state, setState] = useState<PageState>();
  const [sectionHistory, setSectionHistory] = useState<{widgetId:string; tab:'basic'|'data'; items:Array<{version:number;pageVersion:number;snapshot:Partial<PageWidget>}>}>();
  const [historyLoading,setHistoryLoading] = useState(false);
  const [pageHistory,setPageHistory] = useState<Array<{version:number;publishedAt:string;definition:PageDefinition}>>();
  const [draft, setDraft] = useState<PageDefinition>();
  const [sources, setSources] = useState<Record<number, PlatformForm>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<number,string>>({});
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [panel,setPanel] = useState<Panel>('widget');
  const [widgetTab,setWidgetTab] = useState<WidgetTab>('basic');
  const [past,setPast] = useState<PageDefinition[]>([]);
  const [future,setFuture] = useState<PageDefinition[]>([]);
  const [exitPrompt,setExitPrompt] = useState(false);
  const [publishCheck,setPublishCheck] = useState<{errors:string[]}>();
  const routeExit = useRef<RouteExit>();
  const [contextOpen, setContextOpen] = useState(false);
  const [contextWidgetId, setContextWidgetId] = useState<string>();
  const [sourcePropertiesTarget,setSourcePropertiesTarget] = useState<HTMLDivElement|null>(null);
  const [sourceActionsTarget,setSourceActionsTarget] = useState<HTMLDivElement|null>(null);
  const [sourceFooterTarget,setSourceFooterTarget] = useState<HTMLDivElement|null>(null);
  const [sourceStatusTarget,setSourceStatusTarget] = useState<HTMLDivElement|null>(null);
  const [sourceEditor, setSourceEditor] = useState<BusinessTab>();
  const sourceInitialTab = useRef<BusinessTab>();
  const sourceExitRequest = useRef<(()=>void)|null>(null);
  const pendingWidgetTab = useRef<WidgetTab>();
  const pageElement = useRef<HTMLDivElement>(null);
  const [chartFilters, setChartFilters] = useState<Record<string,string>>({});
  const [drilldown, setDrilldown] = useState<{formId:number;field:string;value:string;title:string;search:string;filters:FilterContribution['filters']}>();
  const [widgetFilters, setWidgetFilters] = useState<Record<string, FilterContribution>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<RuntimeAnalyticsData & {widgetErrors?: Record<string,string[]>}>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dataError, setDataError] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const request = useRef(0);
  const resolvedIdentity = useRef<string>();
  const dirty = Boolean(draft && state && JSON.stringify(draft) !== JSON.stringify(state.definition));
  const {draftPreview, definition:active} = pagePresentation(state,admin,editing,draft);
  const selectedWidget = active?.widgets.find(item=>item.id===selected);
  const sourceId = panel === 'widget' || sourceEditor ? widgetSourceId(active, selectedWidget) : active?.sourceFormId;
  const sourceActive = Boolean(editing && draft && sourceEditor && sourceId);
  const source = sourceId ? sources[sourceId] : undefined;
  const globalSource = active?.sourceFormId ? sources[active.sourceFormId] : undefined;
  const globalFields = globalSource?.fields?.filter(field=>!field.archived) || [];
  const globalLabels = Object.fromEntries(globalFields.map(field=>[field.field_name,field.label]));
  const fields = source?.fields?.filter(field => !field.archived) || [];
  useShellPageTitle(active?.title || '页面与组件');

  useEffect(() => {
    const identity = JSON.stringify([code,accountKey,startInEditor]);
    // Fast Refresh reruns effects: keep a loaded session for the same page/user kind.
    // Mark only completed loads, so StrictMode's cancelled first request still retries.
    if(resolvedIdentity.current===identity)return;
    resolvedIdentity.current=undefined;
    let current = true;
    setSourceEditor(undefined);sourceInitialTab.current=undefined;pendingWidgetTab.current=undefined;setWidgetTab('basic');
    setLoading(true); setError(''); setState(undefined); setDraft(undefined); setData(undefined); setFilters({}); setEditing(false); setSources({}); setSelected(undefined); setPanel('widget');setPast([]);setFuture([]);
    (async () => {
      try {
        if (!code) return;
        if (admin) {
          const response = await api.get<PageState>(`/pages/${code}/editor`);
          if (current) {
            const definition = response.data.definition;
            resolvedIdentity.current = identity;
            setState(response.data);
            setDraft(definition);
            setEditing(startInEditor || pagePresentation(response.data, admin, false).startEditing);
            setPanel(definition.widgets.length ? 'widget' : startInEditor ? 'add' : 'style');
            if (startInEditor) setSelected(definition.widgets[0]?.id);
          }
        } else {
          const response = await api.get(`/pages/${code}`);
          if (current) {resolvedIdentity.current=identity;setState({...response.data, revision: 0, publishedDefinition: response.data.definition});}
        }
      } catch (failure) { if (current) setError(errorText(failure)); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [code, admin, accountKey, startInEditor]);

  useEffect(() => {
    if (!admin) return;
    let current = true;
    Promise.allSettled([listPlatformForms(), api.get('/admin/roles')]).then(results => {
      if (!current) return;
      if (results[0].status === 'fulfilled') {
        const items = unwrap<PlatformForm[]>(results[0].value).filter(form => form.config?.analyticsDesign || !['analysis', 'analytics', 'dashboard', 'report'].includes(String(form.config?.assemblyKind)));
        setForms(items);
      } else setError(errorText(results[0].reason));
      if (results[1].status === 'fulfilled') setRoles(unwrap(results[1].value));
    });
    return () => { current = false; };
  }, [admin, refreshKey]);

  const sourceIdsKey = JSON.stringify([...new Set([active?.sourceFormId, ...(active?.widgets || []).map(item=>widgetSourceId(active,item))].filter((id): id is number=>Boolean(id)))].sort());
  useEffect(() => {
    let current = true;
    const ids: number[] = JSON.parse(sourceIdsKey);
    setSources(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>ids.includes(Number(id)))));
    setSourceErrors({});
    Promise.all(ids.map(async id => {
      try {
        const response = await getPlatformForm(id, editing && admin ? {schema:'draft', scope:'designer'} : {schema:'published',scope:'list'});
        if(current)setSources(previous=>({...previous,[id]:unwrap<PlatformForm>(response)}));
      } catch(failure) { if(current)setSourceErrors(previous=>({...previous,[id]:errorText(failure)})); }
    }));
    return ()=>{current=false;};
  }, [sourceIdsKey, refreshKey, editing, admin]);

  const filterFieldsKey = JSON.stringify(active?.filterFields || []);
  useEffect(() => { setFilters(previous => retainFilters(previous, JSON.parse(filterFieldsKey))); }, [filterFieldsKey]);
  const publishedVersion = state?.publishedVersion;
  const dataSignature = pageDataSignature(active);
  const filterSignature = JSON.stringify([filters,chartFilters,widgetFilters]);
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  useEffect(() => {
    if (editing || !publishedVersion) return;
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [editing, publishedVersion, refresh]);
  const bindingsSignature = JSON.stringify(active?.widgets.map(item=>[item.id,widgetSourceId(active,item),item.targetWidgetIds,item.dimension,item.interaction,item.filterFields,item.filterSettings]));
  useEffect(() => {setChartFilters({});setWidgetFilters({});setDrilldown(undefined);},[code,bindingsSignature,editing,publishedVersion]);
  useEffect(()=>{setFilters({});},[active?.sourceFormId]);
  useEffect(() => {
    const seconds = active?.style?.refreshInterval || 0;
    if (editing || seconds <= 0) return;
    const timer = window.setInterval(()=>{if(document.visibilityState==='visible')refresh();},seconds*1000);
    return ()=>window.clearInterval(timer);
  },[editing,active?.style?.refreshInterval,refresh]);
  useEffect(() => {
    if (!code || !active || (!publishedVersion && !editing && !draftPreview)) return;
    let current = true;
    const token = ++request.current;
    setLoadingData(true); setDataError(''); setData(undefined);
    api.post(`/pages/${code}/${editing||draftPreview?'preview':'data'}`, editing||draftPreview?{definition:active,filters,filter_queries:widgetFilters,chart_values:chartFilters}:{filters,filter_queries:widgetFilters,chart_values:chartFilters}).then(response => {
      if (!current || token !== request.current) return;
      if (!editing && !draftPreview && response.data.publishedVersion !== publishedVersion) {
        setDataError('页面已发布新版本，请重新加载页面'); return;
      }
      setData(response.data.analyticsData || undefined);
    }).catch(failure => { if (current) setDataError(errorText(failure)); })
      .finally(() => { if (current) setLoadingData(false); });
    return () => { current = false; };
  }, [code, filterSignature, dataSignature, publishedVersion, refreshKey, editing, draftPreview]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty,saving]);
  const reportBlocked = useCallback((value:RouteExit)=>{routeExit.current=value;setExitPrompt(true);},[]);
  const changeDraft = (next:PageDefinition) => {
    if (!draft || saving || JSON.stringify(next)===JSON.stringify(draft)) return;
    setPast(history=>[...history.slice(-79),draft]);setFuture([]);setDraft(next);setPublishCheck(undefined);
  };
  const undo = () => {
    if (!draft || !past.length || saving) return;
    setFuture(history=>[draft,...history]);setDraft(past[past.length-1]);setPast(history=>history.slice(0,-1));setPublishCheck(undefined);
  };
  const redo = () => {
    if (!draft || !future.length || saving) return;
    setPast(history=>[...history,draft]);setDraft(future[0]);setFuture(history=>history.slice(1));setPublishCheck(undefined);
  };

  const externalFilters = useMemo(() => listFilters(filters), [filters]);
  const chooseFilter = (field: string, value?: string) => setFilters(previous => {
    const next = {...previous};
    if (value === undefined || value === '') delete next[field]; else next[field] = value;
    return next;
  });
  const save = async (publish: boolean) => {
    if (!draft || !state || saving) return false;
    setSaving(true);
    try {
      const response = await api.request<PageState>({url: `/pages/${code}/${publish ? 'publish' : 'draft'}`, method: publish ? 'POST' : 'PUT', data: {definition: draft, expectedRevision: state.revision}});
      setState(response.data); setDraft(response.data.definition);
      if (publish) { setEditing(false); setSelected(undefined);setPast([]);setFuture([]);setPublishCheck(undefined);setFilters({}); refresh(); }
      message.success(publish ? '页面已发布' : '草稿已保存');
      return true;
    } catch (failure) { setError(errorText(failure));return false; }
    finally { setSaving(false); }
  };
  const configureListFilter = () => {
    if(!draft || !selected || saving || sourceActive)return;
    const next=ensureListFilter(draft,selected,`filter-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    if(!next){message.info('请先绑定业务来源，页面最多支持 30 个组件');return;}
    if(next.created)changeDraft(next.definition);
    setSelected(next.filterId);setPanel('widget');setWidgetTab('data');
  };
  const openBusiness = (tab:BusinessTab) => {
    if(saving)return;
    if(!sourceActive)sourceInitialTab.current=tab;
    setWidgetTab(tab);setSourceEditor(tab);
  };
  const changeWidgetTab = (tab:WidgetTab) => {
    if(tab==='form'||tab==='flow'){openBusiness(tab);return;}
    if(sourceActive){
      pendingWidgetTab.current=tab;
      if(sourceExitRequest.current)sourceExitRequest.current();
      else {setSourceEditor(undefined);sourceInitialTab.current=undefined;setWidgetTab(tab);}
      return;
    }
    setWidgetTab(tab);
  };
  useLayoutEffect(()=>{
    if(!editing || !pageElement.current)return;
    const element=pageElement.current;
    const resize=()=>{
      const rect=element.getBoundingClientRect();
      const scale=element.offsetWidth ? rect.width/element.offsetWidth : 1;
      const top=element.querySelector('.analytics-workspace-body')?.getBoundingClientRect().top??rect.top;
      element.style.setProperty('--component-editor-height',`${Math.max(260,(window.innerHeight-top-16)/(scale||1))}px`);
    };
    resize();
    const observer=new ResizeObserver(resize);observer.observe(element);
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    return ()=>{observer.disconnect();window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};
  },[editing,sourceActive]);
  const add = (type: WidgetType) => {
    if (!draft) return;
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    changeDraft({...draft, widgets: [...draft.widgets, {id, type, title: names[type], width: type === 'metric' ? 6 : 24, aggregate: 'count', showFilters: false, targetWidgetIds: type === 'record-filter' ? draft.widgets.filter(widget => widget.type === 'record-list' && widgetSourceId(draft,widget) === draft.sourceFormId).map(widget => widget.id) : undefined, dimension: type === 'chart' ? draft.filterFields[0] || fields[0]?.field_name : undefined}]});
    setSelected(id);setPanel('widget');setWidgetTab('data');
  };
  const move = (id: string, offset: number) => {
    if (!draft) return;
    const index = draft.widgets.findIndex(item => item.id === id);
    const target = draft.widgets[index + offset];
    if (target) changeDraft(moveWidget(draft, id, target.id));
  };
  const dropComponent = (event: React.DragEvent, target?: string) => {
    if (!editing || !draft) return;
    event.preventDefault(); event.stopPropagation();
    const type = event.dataTransfer.getData('component/type') as WidgetType;
    if (Object.prototype.hasOwnProperty.call(names, type)) add(type);
    else if (target) changeDraft(moveWidget(draft, event.dataTransfer.getData('component/id'), target));
  };
  const leaveEditor = () => {
    setSourceEditor(undefined);sourceInitialTab.current=undefined;pendingWidgetTab.current=undefined;
    setExitPrompt(false);setEditing(false);setDraft(state?.definition);setSelected(undefined);setFilters({});setError('');
    if(routeExit.current){const exit=routeExit.current;routeExit.current=undefined;exit.proceed();}
  };
  const requestExit = () => {if(!saving){if(dirty)setExitPrompt(true);else leaveEditor();}};
  useEffect(() => {
    if (!editing) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.repeat || event.defaultPrevented || saving || exitPrompt) return;
      // Observe overlays before their own handlers close them, so one Esc only closes one layer.
      const overlayOpen = Array.from(document.querySelectorAll<HTMLElement>(
        '.ant-modal-wrap, .ant-drawer-open .ant-drawer-content-wrapper, .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-dropdown:not(.ant-dropdown-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden), .ant-popover:not(.ant-popover-hidden)',
      )).some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      if (overlayOpen) return;
      event.preventDefault();
      if (sourceActive) sourceExitRequest.current?.();
      else requestExit();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [editing, saving, exitPrompt, sourceActive, dirty, state]);
  const cancelExit = () => {setExitPrompt(false);routeExit.current?.reset();routeExit.current=undefined;};
  const beginEditing = async (next:Panel, id?:string, tab:WidgetTab='basic') => {
    if(saving||sourceActive)return;
    if(sourceEditor){setSourceEditor(undefined);sourceInitialTab.current=undefined;}
    if (!editing) {
      setSaving(true);setError('');
      try {
        const response=await api.get<PageState>('/pages/'+code+'/editor');
        setState(response.data);setDraft(response.data.definition);setPast([]);setFuture([]);
        setFilters({});setDataError('');setEditing(true);
      } catch(failure){setError(errorText(failure));return;} finally{setSaving(false);}
    }
    setPanel(next);setSelected(id||selected||draft?.widgets[0]?.id);setWidgetTab(tab);
  };
  const contextWidget = active?.widgets.find(item => item.id === contextWidgetId);
  const sourceIsBusiness = source && !['analysis', 'analytics', 'dashboard', 'report'].includes(String(source.config?.assemblyKind));
  const openContextAction = async (key: string) => {
    setContextOpen(false);
    if (key.startsWith('source:')) {await beginEditing(contextWidget ? 'widget' : 'data',contextWidget?.id);setSelected(contextWidget?.id);openBusiness(key.slice(7) as BusinessTab);return;}
    if(key==='edit'||key.startsWith('widget-'))await beginEditing(contextWidget?'widget':'style',contextWidget?.id,'basic');
    else await beginEditing(key as Panel);
  };
  const checkPublish = async () => {
    if(!draft||saving)return;setSaving(true);setError('');
    try{const response=await api.post('/pages/'+code+'/preview',{definition:draft,filters:{}});setPublishCheck({errors:response.data.analyticsData?.errors||[]});}
    catch(failure){setPublishCheck({errors:[errorText(failure)]});}finally{setSaving(false);}
  };
  const renderWidget = (item: PageWidget) => {
    const boundId = widgetSourceId(active,item);
    const source = boundId ? sources[boundId] : undefined;
    const labels = Object.fromEntries((source?.fields || []).filter(field=>!field.archived).map(field=>[field.field_name,field.label]));
    const componentGlobalFilters = boundId === active?.sourceFormId ? externalFilters : [];
    if (boundId&&sourceErrors[boundId]) return <Alert type="warning" showIcon message="此组件的数据来源暂不可用" description={sourceErrors[boundId]} />;
    if (boundId&&!source) return <div className="component-widget-preview"><Spin /></div>;
    if (!boundId) return <Alert type="info" showIcon message="请为此组件选择业务数据来源" description="右键打开组件属性，在数据中选择业务来源。" />;
    if (item.type === 'record-filter') return source?.status === 'published' ? <FilterWidget key={`${source.id}:${item.id}`} widget={item} sourceId={source.id} onChange={value=>setWidgetFilters(previous=>({...previous,[item.id]:value}))}/> : <Alert type="info" message="请先发布来源业务表单" />;
    const query = componentQuery(active!, widgetFilters, chartFilters, item.id);
    if(!query.ready)return <Alert type="info" showIcon message="请先填写必填筛选条件并查询" description="关联的筛选组件校验通过后，将显示列表数据。" />;
    if (item.type === 'record-list') return source?.status==='published' ? <DynamicPage key={`${item.id}:${source.id}`} formSlug={String(source.id)} embedded toolbarTargetId={`component-toolbar-${item.id}`} listSettings={item.listSettings} display={item.showFilters === false ? 'list' : 'all'} readOnly={editing} disableRowAction={editing} externalSearch={query.search} tableDensity={active?.style?.tableDensity} externalFilters={[...componentGlobalFilters, ...query.filters]} refreshKey={refreshKey} onMutated={refresh} /> : <Alert type="info" showIcon message="业务列表等待数据配置" description="通过右键菜单配置并发布来源表单的字段与列表，即可预览真实数据。" />;
    if (loadingData) return <div className="component-widget-preview"><Spin /></div>;
    const widgetErrors = data?.widgetErrors?.[item.id] ?? data?.errors;
    if (dataError || widgetErrors?.length) return <Alert type="warning" showIcon message="统计暂不可用" description={dataError || widgetErrors?.join('；')} />;
    const result = data?.widgets?.[item.id];
    if (!result) return <Alert type="info" message="暂无统计结果" />;
    return <StatisticalWidget widget={item} result={result} style={active?.style} labels={labels} onInteract={value=>{
      if(editing){setSelected(item.id);setPanel('widget');return;}
      if(!item.dimension||item.interaction==='none')return;
      if(item.interaction==='navigate'){if(source?.code)navigate('/dynamic/'+source.id+'?view=records');return;}
      if(item.interaction==='drilldown'){setDrilldown({formId:boundId,field:item.dimension,value,title:item.title+' · '+value,search:query.search,filters:[...componentGlobalFilters,...query.filters,{field:item.dimension,op:'equals',value}]});return;}
      if(item.targetWidgetIds?.length){setChartFilters(previous=>{const next={...previous};if(next[item.id]===value)delete next[item.id];else next[item.id]=value;return next;});}
      else if(boundId===active?.sourceFormId&&active?.filterFields.includes(item.dimension))chooseFilter(item.dimension,value);
    }} />;
  };

  if (loading) return <div className="component-page-loading"><Spin size="large" /></div>;
  const publishable = Boolean(draft && (!state?.publishedVersion || JSON.stringify(draft)!==JSON.stringify(state.publishedDefinition)));
  const hasUnpublishedDraft = state && JSON.stringify(state.definition)!==JSON.stringify(state.publishedDefinition);
  const selectWidget = (id:string) => {if(!saving&&!sourceActive){setSelected(id);setPanel('widget');}};
  const errorNotice = error && <Alert type="error" showIcon message={error} />;
  const canvas = <main className={'analytics-workspace-canvas component-page-canvas component-filter-layout-'+(active?.style?.filterTheme??'toolbar')} aria-label="业务页面画布" tabIndex={admin?0:undefined}
    onContextMenuCapture={admin?event=>{
      const target=event.target instanceof Element?event.target:null;
      if(target?.closest('input,textarea,[contenteditable="true"],[role="combobox"]')){event.stopPropagation();setContextOpen(false);return;}
      const id = target?.closest<HTMLElement>('[data-component-widget-id]')?.dataset.componentWidgetId;
      // rc-trigger opens immediately; resolve the target before it captures its menu.
      flushSync(()=>setContextWidgetId(id));
    }:undefined}>
    {!editing&&errorNotice}
    {active&&<>
      {(active.filterFields.length>0||Object.keys(chartFilters).length>0)&&<div className="runtime-analytics-filters component-page-filters">
        <div className="analytics-filter-heading"><span><FilterOutlined /> {active.filterFields.length?'全局筛选':'业务数据'}{editing?' · 草稿预览':''}</span><Button type="text" size="small" aria-label="刷新页面数据" onClick={refresh} loading={loadingData}>刷新</Button></div>
        {(!!active.filterFields.length||Object.keys(chartFilters).length>0)&&<Space wrap>{active.filterFields.map(field=><Select key={field} aria-label={globalLabels[field]||field} placeholder={globalLabels[field]||field} allowClear showSearch disabled={!data||Boolean(data.errors?.length)} value={filters[field]} options={(data?.filterOptions?.[field]||[]).map(value=>({label:value,value}))} onChange={value=>chooseFilter(field,value)} />)}<Button onClick={()=>{setFilters({});setChartFilters({});}}>清除全局与图表条件</Button></Space>}
      </div>}
      {!active.widgets.length&&<div className="component-page-empty"><Typography.Title level={4}>空白页面</Typography.Title><Typography.Paragraph>{admin?'右键添加组件，开始搭建业务页面。':'此页面暂未添加组件。'}</Typography.Paragraph></div>}
      <div className="component-page-grid" onDragOver={event=>{if(editing)event.preventDefault();}} onDrop={event=>dropComponent(event)}>
        <Row gutter={[active.style?.componentGap??12,active.style?.componentGap??12]}>{active.widgets.map(item=>{
          const appearance = item.appearance;
          const titleAlign = appearance?.titleAlign ?? 'left';
          const titleStyle: React.CSSProperties = {
            textAlign: titleAlign,
            fontSize: appearance?.titleFontSize,
            fontFamily: appearance?.titleFontFamily,
            fontWeight: appearance?.titleWeight,
            fontStyle: appearance?.titleItalic ? 'italic' : undefined,
            color: appearance?.titleColor,
            marginBottom: appearance?.showTitle === false ? undefined : appearance?.titleGap,
            lineHeight: appearance?.titleFontSize ? Math.max(20, Math.ceil(appearance.titleFontSize * 1.25)) + 'px' : undefined,
          };
          return <Col key={item.id} xs={24} lg={item.width} style={item.customWidth?{flex:`0 0 ${item.customWidth}px`,maxWidth:'100%'}:undefined}>
          <Card data-component-widget-id={item.id} style={{height:item.customHeight??undefined,borderRadius:item.appearance?.radius??active.style?.cardRadius??12, '--analytics-card-opacity':item.appearance?.cardOpacity??active.style?.cardOpacity??dashboardStyleDefaults.cardOpacity, '--analytics-card-blur':`${item.appearance?.cardBlur??active.style?.cardBlur??dashboardStyleDefaults.cardBlur}px`} as React.CSSProperties}
            onDragOver={event=>{if(editing)event.preventDefault();}} onDrop={event=>dropComponent(event,item.id)}
            className={'component-page-widget component-page-widget-'+item.type+(editing?' analytics-editable-widget':'')+(editing&&panel==='widget'&&selected===item.id?' analytics-selected-widget':'')}
            onClick={event=>{if(editing&&!(event.target instanceof Element&&event.target.closest('input,textarea,button,a,[role="combobox"]')))selectWidget(item.id);}}
            styles={{title:titleStyle}}
            title={appearance?.showTitle===false?undefined:editing?<button className="analytics-widget-select"
              style={{justifyContent:titleAlign==='center'?'center':titleAlign==='right'?'flex-end':'flex-start',textAlign:'inherit'}} type="button" draggable disabled={saving||sourceActive} aria-label={'配置'+item.title}
              onClick={()=>selectWidget(item.id)}
              onKeyDown={event=>{if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();move(item.id,event.key==='ArrowUp'?-1:1);}}}
              onDragStart={event=>{selectWidget(item.id);event.dataTransfer.setData('component/id',item.id);event.dataTransfer.effectAllowed='move';}}
              onDragOver={event=>event.preventDefault()} onDrop={event=>dropComponent(event,item.id)}><HolderOutlined />{item.title}</button>:item.title} extra={<Space size={6}>{(item.type==='record-list'||item.type==='record-filter')&&<span className="component-list-header-actions" id={`component-toolbar-${item.id}`} />}{chartFilters[item.id]!==undefined&&<Button type="text" size="small" onClick={()=>setChartFilters(previous=>{const next={...previous};delete next[item.id];return next;})}>清除联动</Button>}</Space>}>
            {appearance?.showSubtitle!==false&&appearance?.subtitle?.trim()&&
              <p className="component-widget-subtitle" style={{fontSize:appearance.subtitleFontSize,color:appearance.subtitleColor,textAlign:appearance.subtitleAlign}}>
                {appearance.subtitle}
              </p>}
            {renderWidget(item)}
            {editing&&!saving&&!sourceActive&&<ResizeHandle title={item.title} onCommit={size=>{if(draft)changeDraft({...draft,widgets:draft.widgets.map(widget=>widget.id===item.id?{...widget,...size}:widget)});}}/>}
          </Card>
        </Col>;})}</Row>
      </div>
    </>}
  </main>;
  const openPageHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await api.get(`/pages/${code}/versions`);
      setPageHistory(response.data.items);
    } catch(failure){message.error(errorText(failure));}
    finally{setHistoryLoading(false);}
  };
  const openSectionHistory = async () => {
    if(!selected || (widgetTab!=='basic' && widgetTab!=='data'))return;
    setHistoryLoading(true);
    try {
      const response = await api.get(`/pages/${code}/widgets/${selected}/${widgetTab}/versions`);
      setSectionHistory({widgetId:selected,tab:widgetTab,items:response.data.items});
    } catch(failure){message.error(errorText(failure));}
    finally{setHistoryLoading(false);}
  };
  const publishSection = async () => {
    if(!sectionHistory||!draft||!state)return;
    setSaving(true);
    try {
      const response = await api.post<PageState>(`/pages/${code}/widgets/${sectionHistory.widgetId}/${sectionHistory.tab}/publish`,{definition:draft,expectedRevision:state.revision});
      setState(response.data);setDraft(response.data.definition);setSectionHistory(undefined);refresh();message.success('当前组件页签已独立发布');
    }catch(failure){message.error(errorText(failure));}finally{setSaving(false);}
  };
  const saveStatus = dirty?'未保存修改':hasUnpublishedDraft?'草稿待发布':'与线上版本一致';
  const headerStatus = <Tooltip title={saveStatus}><span className={'analytics-save-indicator'+(dirty?' is-dirty':hasUnpublishedDraft?' is-pending':'')} role="status" aria-label={saveStatus} tabIndex={0} /></Tooltip>;
  const headerActions = <div className="analytics-settings-history analytics-settings-history-inline"><Space size={0}>
    <Tooltip title="撤销"><Button type="text" aria-label="撤销" icon={<UndoOutlined />} disabled={!past.length||saving||sourceActive} onClick={undo} /></Tooltip>
    <Tooltip title="重做"><Button type="text" aria-label="重做" icon={<RedoOutlined />} disabled={!future.length||saving||sourceActive} onClick={redo} /></Tooltip>
    <Tooltip title={panel==='widget'?'组件版本管理':'页面版本管理'}><Button type="text" aria-label={panel==='widget'?'组件版本管理':'页面版本管理'} icon={<HistoryOutlined />} loading={historyLoading} disabled={saving||historyLoading||sourceActive||(panel==='widget'&&(!selected||(widgetTab!=='basic'&&widgetTab!=='data')))} onClick={()=>void (panel==='widget'?openSectionHistory():openPageHistory())} /></Tooltip>
    <Tooltip title="保存草稿"><Button type="text" aria-label="保存草稿" icon={<SaveOutlined />} loading={saving} disabled={!dirty||saving||sourceActive} onClick={()=>void save(false)} /></Tooltip>
  </Space></div>;
  const footer = <>
    <div className="analytics-settings-actions"><div>
      <Button type="primary" disabled={!publishable||saving||sourceActive} onClick={()=>void checkPublish()}>{state?.publishedVersion?'发布新版本':'创建首个版本'}</Button>
    </div></div>
  </>;
  return <div ref={pageElement} style={{'--analytics-paper':active?.style?.background||dashboardStyleDefaults.background, '--analytics-grid-size':`${active?.style?.gridSize??dashboardStyleDefaults.gridSize}px`, '--analytics-card-opacity':active?.style?.cardOpacity??dashboardStyleDefaults.cardOpacity, '--analytics-card-blur':`${active?.style?.cardBlur??dashboardStyleDefaults.cardBlur}px`} as React.CSSProperties} data-card-border={active?.style?.cardBorder??'light'} className={'component-page analytics-workspace'+(editing?' analytics-workspace-configuring':'')+(sourceActive?' component-page-source-open':'')}>
    {!sourceActive&&<NavigationGuard enabled={dirty||saving} onBlocked={reportBlocked} />}
    <div className="analytics-workspace-body">
      <div className="component-page-preview">
        <div hidden={sourceActive}>{admin?<Dropdown trigger={['contextMenu']} disabled={saving||sourceActive} open={contextOpen} onOpenChange={setContextOpen} overlayClassName="analytics-context-menu" menu={{
          'aria-label':contextWidget?contextWidget.title+'配置菜单':'表单页面配置菜单',
          items:[
            ...buildAnalyticsContextMenu({widgetTitle:contextWidget?.title,pageLabel:'页面',sections}),
            {key:'business',popupClassName:'analytics-context-submenu',icon:<DatabaseOutlined />,label:'业务配置',disabled:!(contextWidget ? sources[widgetSourceId(active,contextWidget)||0] : globalSource),children:[
              {key:'source:form',label:'字段与录入'},{key:'source:flow',label:'流程与审批'},
            ]},
          ],onClick:({key})=>void openContextAction(key),
        }}>{canvas}</Dropdown>:canvas}</div>
        {sourceActive&&sourceId&&<div className="component-page-source-editor"><Suspense fallback={<Spin />}><FormSettings formId={String(sourceId)} embedded requestExitRef={sourceExitRequest} workspaceTargets={{properties:sourcePropertiesTarget,actions:sourceActionsTarget,footer:sourceFooterTarget,status:sourceStatusTarget}} initialTab={sourceInitialTab.current} requestedTab={sourceEditor} onTabChange={openBusiness} onExit={()=>{setSourceEditor(undefined);setWidgetTab(pendingWidgetTab.current??'basic');pendingWidgetTab.current=undefined;sourceInitialTab.current=undefined;refresh();}} onPublished={refresh} /></Suspense></div>}
      </div>
      {editing&&draft&&<div className="analytics-settings-page">
        <Inspector panel={panel} tab={widgetTab} definition={draft} selected={selected} fields={fields} forms={forms} roles={roles}
          sourceSlots={{properties:setSourcePropertiesTarget,actions:setSourceActionsTarget,footer:setSourceFooterTarget,status:setSourceStatusTarget}} disabled={saving} sourceOpen={sourceActive} businessTab={sourceEditor} onListFilter={configureListFilter} sourceIsBusiness={Boolean(sourceIsBusiness)}
          onPanel={setPanel} onTab={changeWidgetTab} onChange={changeDraft} onAdd={add} onSelect={selectWidget}
          onBusiness={openBusiness} onClose={requestExit} headerStatus={headerStatus} headerActions={headerActions} status={errorNotice&&<div className="analytics-settings-status">{errorNotice}</div>} footer={footer} />
      </div>}
    </div>
    <Modal title="页面版本管理" open={Boolean(pageHistory)} onCancel={()=>setPageHistory(undefined)} footer={<Button onClick={()=>setPageHistory(undefined)}>关闭</Button>} width={640}>
      <Typography.Paragraph type="secondary">{draft?.title} · 当前线上版本 {state?.publishedVersion ? `v${state.publishedVersion}` : '尚未发布'}</Typography.Paragraph>
      <Alert type="info" showIcon message="管理整个页面的发布快照" description="包含页面主题、布局、全部组件、数据源绑定、筛选联动及页面权限。恢复只替换页面配置草稿，业务记录和共享数据源的字段、录入、审批流程配置保持原状；发布后才影响线上页面。" />
      {!pageHistory?.length&&<Typography.Paragraph>暂无已发布的页面版本</Typography.Paragraph>}
      {pageHistory?.map(item=><div key={item.version} className="component-page-version-row"><div><strong>页面 v{item.version}{item.version===state?.publishedVersion?' · 线上版本':''}</strong><div>{item.definition.title} · {item.definition.widgets.length} 个组件</div><time>{new Date(item.publishedAt).toLocaleString()}</time></div><Button disabled={saving} onClick={()=>Modal.confirm({title:`恢复页面 v${item.version} 到草稿？`,content:'将替换当前整页配置，包括尚未保存的修改。线上页面和业务数据保持原状；可以撤销此操作，或检查草稿后再发布。',okText:'恢复到草稿',cancelText:'取消',onOk:()=>{changeDraft(structuredClone(item.definition));setSelected(undefined);setPanel('style');setPageHistory(undefined);message.success('整页配置已恢复到草稿，尚未发布');}})}>恢复到草稿</Button></div>)}
    </Modal>
      <Modal title={`${sectionHistory?.tab==='data'?'数据':'基本'} · 组件版本`} open={Boolean(sectionHistory)} onCancel={()=>{if(!saving)setSectionHistory(undefined);}} footer={<Button type="primary" loading={saving} onClick={()=>void publishSection()}>独立发布当前页签</Button>}>
        <Typography.Paragraph type="secondary">仅管理当前组件的当前页签。恢复后进入草稿，发布时不改变其他组件与页签。录入和流程版本由业务来源共享。</Typography.Paragraph>
        {!sectionHistory?.items.length&&<Typography.Paragraph>暂无已发布版本</Typography.Paragraph>}
        {sectionHistory?.items.map(item=><div key={item.pageVersion} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--mf-border)'}}><span>版本 {item.version}</span><Button size="small" disabled={saving} onClick={()=>{if(!draft)return;changeDraft({...draft,widgets:draft.widgets.map(w=>w.id===sectionHistory.widgetId?{...w,...item.snapshot,filterSettings:{...w.filterSettings,...item.snapshot.filterSettings},listSettings:{...w.listSettings,...item.snapshot.listSettings}}:w)});setSectionHistory(undefined);message.success('已恢复当前页签到草稿');}}>恢复到草稿</Button></div>)}
      </Modal>
    <Drawer title={drilldown?.title} open={Boolean(drilldown)} width={960} onClose={()=>setDrilldown(undefined)}>
      {drilldown&&<><Alert type="info" showIcon message={`${sources[drilldown.formId]?.fields?.find(field=>field.field_name===drilldown.field)?.label||drilldown.field}：${drilldown.value}`} style={{marginBottom:16}} /><DynamicPage formSlug={String(drilldown.formId)} embedded readOnly display="list" tableDensity={active?.style?.tableDensity} externalSearch={drilldown.search} externalFilters={drilldown.filters} /></>}
    </Drawer>
    <Modal title={routeExit.current?'离开当前页面':'关闭页面配置'} open={exitPrompt} closable={!saving} maskClosable={false} onCancel={cancelExit}
      footer={<Space><Button disabled={saving} onClick={cancelExit}>继续配置</Button><Button danger disabled={saving} onClick={leaveEditor}>放弃未保存修改</Button><Button type="primary" loading={saving} onClick={async()=>{if(await save(false))leaveEditor();}}>保存并关闭</Button></Space>}>
      <Typography.Paragraph>当前修改尚未保存。保存草稿后可继续配置，查看者仍看到已发布版本。</Typography.Paragraph>
    </Modal>
    <Modal title={'发布页面'+(state?.publishedVersion?' · v'+(state.publishedVersion+1):'')} open={Boolean(publishCheck)} onCancel={()=>setPublishCheck(undefined)} maskClosable={false} closable={!saving}
      okText="确认发布" cancelText="继续配置" confirmLoading={saving} okButtonProps={{disabled:saving||Boolean(publishCheck?.errors.length)}} cancelButtonProps={{disabled:saving}} onOk={()=>void save(true)}>
      {publishCheck?.errors.length?<Alert type="error" showIcon message="发布检查未通过" description={<ul>{publishCheck.errors.map((item,index)=><li key={index}>{item}</li>)}</ul>} />:<Alert type="success" showIcon message="数据源、统计口径和组件检查通过" />}
      <Typography.Paragraph className="analytics-publish-summary">将发布 {draft?.widgets.length||0} 个组件。记录与统计沿用来源业务表单权限，每个组件独立校验业务来源，字段和流程草稿保持独立。</Typography.Paragraph>
    </Modal>
  </div>;
}
