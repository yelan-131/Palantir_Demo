import {flushSync} from 'react-dom';
import React, {lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useBlocker, useNavigate, useParams, useSearchParams} from 'react-router-dom';
import {Alert, Button, Card, Col, Dropdown, Drawer, Modal, Popconfirm, Row, Select, Space, Spin, Tooltip, Typography, message} from 'antd';
import {CheckCircleOutlined, DatabaseOutlined, FilterOutlined, HolderOutlined, HistoryOutlined, PlusOutlined, RedoOutlined, SaveOutlined, SkinOutlined, UndoOutlined} from '@/components/Icon/ant';
import StatisticalWidget from './StatisticalWidget';
import FilterWidget from './FilterWidget';
import {ListConfigurationPreviewProvider} from './ListConfigurationPreview';
import RecordListWidget from './RecordListWidget';
import ResizeHandle from './ResizeHandle';
import {dashboardStyleDefaults} from '../AppPrograms/analyticsWidgetAppearance';
import api, {getPlatformForm, listPlatformForms, type PlatformForm} from '@/services/api';
import {diagnosticReference} from '@/services/errorDiagnostics';
import {useAuthStore} from '@/stores/authStore';
import {useShellPageTitle} from '@/components/ShellPageTitle';
import {useAiWorkbench} from '@/components/AiChatWidget/context';
import {applyComponentOperations, componentNames, newComponent, type AddableWidgetType} from './componentOperations';
import DynamicPage from '../DynamicPage';
import type {RuntimeAnalyticsData} from '../AppPrograms/analyticsTypes';
import {
  businessDataComponent, canvasDataDefinition, componentQuery, contextSourceId, listFilters, mergeListFilters, moveWidget,
  pageDataSignature, pagePresentation, pendingDataCard, pendingSharedFilter, retainFilters, retainWidgetFilterQueries, widgetFilterSignature, widgetFrameHeight, widgetSourceId,
  type FilterContribution, type PageDefinition, type PageState, type PageWidget, type SubmittedFilter,
} from './model';
import Inspector, {pageSections, type BusinessTab, type Panel, type WidgetTab} from './Inspector';
import {buildAnalyticsContextMenu} from '../AppPrograms/AnalyticsContextMenu';
import '../AppPrograms/analytics-workspace.css';
import './style.css';
import '../AppPrograms/analytics-paper.css';
import './surfaces.css';
import WidgetFrame from './WidgetFrame';
import {resolvePresentation} from './presentation';
import {normalizePublishCheck, type PublishCheck} from './publishCheck';

const FormSettings = lazy(() => import('../FormSettings'));
const errorText = (error: unknown) => {
  const response = (error as {response?: {data?: {detail?: unknown}; headers?: Record<string, unknown>}})?.response;
  const detail = response?.data?.detail;
  let text = '操作失败，请重试';
  if (typeof detail === 'string') text = detail;
  else if(Array.isArray(detail))text = detail.map(item=>`${(item.loc||[]).filter((part:unknown)=>part!=='body').join(' / ')}：${item.msg||'配置无效'}`).join('；');
  else if (detail && typeof detail === 'object' && 'errors' in detail && Array.isArray(detail.errors)) text = detail.errors.join('；');
  const diagnostic = diagnosticReference(response?.headers);
  return diagnostic ? `${text}（${diagnostic}）` : text;
};
const unwrap = <T,>(response: {data: unknown}): T => {
  const value = response.data as {data?: T};
  return (value?.data ?? value) as T;
};
const isRevisionConflict = (failure: unknown) =>
  (failure as {response?: {status?: number}})?.response?.status === 409;
type RouteExit = {proceed: () => void; reset: () => void};
function NavigationGuard({enabled,reopensSource,onBlocked}: {enabled: boolean;reopensSource: boolean;onBlocked:(value: RouteExit)=>void}) {
  const blocker = useBlocker(({currentLocation,nextLocation})=>{
    if (!enabled) return false;
    const current = new URLSearchParams(currentLocation.search);
    const next = new URLSearchParams(nextLocation.search);
    return currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.state?.aiDesignPreviewId !== nextLocation.state?.aiDesignPreviewId ||
      ['edit', 'tab'].some(key => current.get(key) !== next.get(key)) ||
      (reopensSource && currentLocation.key !== nextLocation.key && next.has('tab'));
  });
  useEffect(()=>{if(blocker.state==='blocked')onBlocked({proceed:blocker.proceed,reset:blocker.reset});},[blocker,onBlocked]);
  return null;
}

export default function ComponentPages({pageCode, openEditor = false, recordFormId, businessDataFormId, designTab, designNavigationKey, workspace = false, renderWorkspaceWidget}: {pageCode?: string; openEditor?: boolean; recordFormId?: number; businessDataFormId?: number; designTab?: BusinessTab|'data'|'style'; designNavigationKey?: string; workspace?: boolean; renderWorkspaceWidget?: (widget: PageWidget) => React.ReactNode} = {}) {
  const navigate = useNavigate();
  const {code: routeCode} = useParams<{code: string}>();
  const code = pageCode || routeCode;
  const admin = Boolean(useAuthStore(state => state.user?.is_admin));
  const {registerComponentPageController, setComponentPageContext} = useAiWorkbench();
  const [searchParams, setSearchParams] = useSearchParams();
  const recordId = Number(searchParams.get('recordId'));
  const linkedRecordId = recordFormId && Number.isSafeInteger(recordId) && recordId > 0 ? recordId : undefined;
  const startWithRecord = linkedRecordId !== undefined;
  const startInEditor = admin && (openEditor || (!pageCode && searchParams.get('edit') === '1'));
  const accountKey = useAuthStore(state=>state.user?`${state.user.tenant_id}:${state.user.id}:${state.user.is_admin}`:'anonymous');
  const [forms, setForms] = useState<PlatformForm[]>([]);
  const [roles, setRoles] = useState<Array<{id: number; name: string; label?: string}>>([]);
  const [state, setState] = useState<PageState>();
  const [sectionHistory, setSectionHistory] = useState<{widgetId:string; tab:'basic'|'data'; items:Array<{version:number;pageVersion:number;snapshot:Partial<PageWidget>}>}>();
  const [historyLoading,setHistoryLoading] = useState(false);
  const [pageHistory,setPageHistory] = useState<Array<{version:number;publishedAt:string;title:string;widgetCount:number}>>();
  const [draft, setDraft] = useState<PageDefinition>();
  const [sources, setSources] = useState<Record<number, PlatformForm>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<number,string>>({});
  const [publishedSourceState, setPublishedSourceState] = useState<{key:string; form?:PlatformForm; error?:string}>();
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [panel,setPanel] = useState<Panel>('widget');
  const [widgetTab,setWidgetTab] = useState<WidgetTab>('basic');
  const [propertyTarget, setPropertyTarget] = useState<{section:'appearance'|'interaction'}>();
  const [past,setPast] = useState<PageDefinition[]>([]);
  const [future,setFuture] = useState<PageDefinition[]>([]);
  const [exitPrompt,setExitPrompt] = useState(false);
  const [leaving,setLeaving] = useState(false);
  const [exitError,setExitError] = useState('');
  const [publishCheck,setPublishCheck] = useState<PublishCheck>();
  const [publishError,setPublishError] = useState('');
  const [sectionError,setSectionError] = useState('');
  const [versionConflict,setVersionConflict] = useState(false);
  const [reloadPrompt,setReloadPrompt] = useState(false);
  const [reloadError,setReloadError] = useState('');
  const routeExit = useRef<RouteExit>();
  const [contextOpen, setContextOpen] = useState(false);
  const [contextWidgetId, setContextWidgetId] = useState<string>();
  const [sourcePropertiesTarget,setSourcePropertiesTarget] = useState<HTMLDivElement|null>(null);
  const [sourceActionsTarget,setSourceActionsTarget] = useState<HTMLDivElement|null>(null);
  const [sourceStatusTarget,setSourceStatusTarget] = useState<HTMLDivElement|null>(null);
  const [sourceEditor, setSourceEditor] = useState<{tab:BusinessTab;formId:number}>();
  const sourceInitialTab = useRef<BusinessTab>();
  const sourceReturn = useRef<{panel:Panel;tab:'basic'|'data'}>({panel:'widget',tab:'basic'});
  const sourceExitRequest = useRef<(()=>void)|null>(null);
  const sourceSaveDraft = useRef<(() => Promise<boolean>)|null>(null);
  const [sourceDraftStatus, setSourceDraftStatus] = useState({dirty:false,saving:false});
  const embeddedDraftGuard = useMemo(() => ({onStatusChange:setSourceDraftStatus,saveRef:sourceSaveDraft}), []);
  const pendingWidgetTab = useRef<WidgetTab>();
  const pageElement = useRef<HTMLDivElement>(null);
  const [chartFilters, setChartFilters] = useState<Record<string,string>>({});
  const [drilldown, setDrilldown] = useState<{formId:number;field?:string;value?:string;title:string;search:string;filters:FilterContribution['filters']}>();
  const [submittedFilters, setSubmittedFilters] = useState<Record<string, SubmittedFilter>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<RuntimeAnalyticsData & {
    widgetErrors?: Record<string, string[]>;
    diagnostic?: string;
  }>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dataError, setDataError] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const request = useRef(0);
  const resolvedIdentity = useRef<string>();
  const openedDesignLink = useRef<string>();
  const dirty = Boolean(draft && state && JSON.stringify(draft) !== JSON.stringify(state.definition));
  const {draftPreview, definition:active} = useMemo(() => pagePresentation(state,admin,editing,draft), [state,admin,editing,draft]);
  const canvasUsesDraft = editing || draftPreview;
  const dataDefinition = useMemo(
    ()=>active && (canvasUsesDraft ? canvasDataDefinition(active) : active),
    [active,canvasUsesDraft],
  );
  const widgetFilters = Object.fromEntries(
    Object.entries(retainWidgetFilterQueries(dataDefinition,submittedFilters)).map(([id,{query}])=>[id,query]),
  );
  const visibleChartFilters = canvasUsesDraft ? Object.fromEntries(
    Object.entries(chartFilters).filter(([id])=>dataDefinition?.widgets.some(item=>
      item.type==='chart'&&item.id===id&&item.dimension&&(item.interaction??'filter')==='filter')),
  ) : chartFilters;
  const editingCanvas = editing && !previewing;
  const previewCanvas = previewing || draftPreview;
  const pageNoun = workspace ? '工作台' : ['analysis', 'analytics', 'dashboard', 'report'].includes(state?.hostForm?.kind ?? '') ? '看板' : '页面';
  const selectedWidget = active?.widgets.find(item=>item.id===selected);
  const sourceId = sourceEditor?.formId ?? (panel === 'widget' ? widgetSourceId(active, selectedWidget) : active?.sourceFormId);
  const sourceActive = Boolean(editing && draft && sourceEditor && sourceId);
  const sourceDirty = sourceActive && sourceDraftStatus.dirty;
  const exitBusy = leaving || saving || (sourceActive && sourceDraftStatus.saving);
  const exitDirty = dirty || sourceDirty;
  const source = sourceId ? sources[sourceId] : undefined;
  const needsPublishedSource = selectedWidget?.type==='record-list' && (widgetTab==='basic'||widgetTab==='data')
    || selectedWidget?.type==='record-filter' && widgetTab==='data' && Boolean(selectedWidget.targetWidgetIds?.length);
  const publishedSourceId = admin && editing && panel==='widget' && !sourceActive && needsPublishedSource ? sourceId : undefined;
  const publishedSourceKey = publishedSourceId ? JSON.stringify([accountKey, publishedSourceId, refreshKey]) : undefined;
  const publishedSource = publishedSourceKey && publishedSourceState?.key === publishedSourceKey ? publishedSourceState : undefined;
  const globalSource = active?.sourceFormId ? sources[active.sourceFormId] : undefined;
  const globalFields = globalSource?.fields?.filter(field=>!field.archived) || [];
  const globalLabels = Object.fromEntries(globalFields.map(field=>[field.field_name,field.label]));
  const fields = source?.fields?.filter(field => !field.archived) || [];
  const businessDataTrail = useMemo(() => businessDataFormId === undefined ? undefined : [
    {label: '设置中心', to: '/account-center'},
    {label: '应用配置', to: '/studio'},
    {label: '业务数据', to: `/studio/business-data?form=${businessDataFormId}`},
  ], [businessDataFormId]);
  useShellPageTitle(active?.title || '页面与组件', true, businessDataTrail);

  useEffect(() => {
    const identity = JSON.stringify([code,accountKey,startInEditor,businessDataFormId]);
    // Fast Refresh reruns effects: keep a loaded session for the same page/user kind.
    // Mark only completed loads, so StrictMode's cancelled first request still retries.
    if(resolvedIdentity.current===identity)return;
    resolvedIdentity.current=undefined;
    let current = true;
    setSourceEditor(undefined);sourceInitialTab.current=undefined;pendingWidgetTab.current=undefined;setWidgetTab('basic');setPropertyTarget(undefined);
    setVersionConflict(false);setReloadPrompt(false);
    setLoading(true); setError(''); setState(undefined); setDraft(undefined); setData(undefined); setFilters({}); setEditing(false); setPreviewing(false); setSources({}); setSelected(undefined); setPanel('widget');setPast([]);setFuture([]);
    (async () => {
      try {
        if (!code) return;
        if (admin) {
          const response = await api.get<PageState>(`/pages/${code}/editor`);
          if (current) {
            const openEditor = startInEditor || (!startWithRecord && pagePresentation(response.data, admin, false).startEditing);
            const definition = response.data.definition;
            const isDashboard = ['analysis', 'analytics', 'dashboard', 'report'].includes(response.data.hostForm?.kind ?? '');
            const initialWidget = businessDataFormId === undefined ? definition.widgets.find(widget=>widget.type!=='record-filter') ?? definition.widgets[0]
              : businessDataComponent(definition, businessDataFormId, isDashboard);
            resolvedIdentity.current = identity;
            setState(response.data);
            setDraft(definition);
            setEditing(openEditor);
            setPanel(initialWidget ? 'widget' : startInEditor ? 'add' : 'style');
            if (startInEditor) setSelected(initialWidget?.id);
          }
        } else {
          const response = await api.get(`/pages/${code}`);
          if (current) {resolvedIdentity.current=identity;setState({...response.data, revision: 0, publishedDefinition: response.data.definition});}
        }
      } catch (failure) { if (current) setError(errorText(failure)); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [code, admin, accountKey, startInEditor, businessDataFormId]);

  useEffect(() => {
    if (!designNavigationKey || !designTab || !editing || !state || !draft || !businessDataFormId || openedDesignLink.current === designNavigationKey) return;
    openedDesignLink.current = designNavigationKey;
    setPreviewing(false);
    setPropertyTarget(undefined);
    if (designTab === 'style' || designTab === 'data') {
      setSourceEditor(undefined);
      sourceInitialTab.current = undefined;
    }
    if (designTab === 'style') { setPanel('style'); return; }
    const isDashboard = ['analysis', 'analytics', 'dashboard', 'report'].includes(state.hostForm?.kind ?? '');
    const component = businessDataComponent(draft, businessDataFormId, isDashboard && designTab === 'data');
    const dataPanel = component ? 'widget' : draft.sourceFormId != null ? 'compatibility' : 'add';
    if (designTab === 'data') {
      setSelected(component?.id);
      setPanel(dataPanel);
      setWidgetTab('data');
      return;
    }
    if (isDashboard) return;
    setSelected(component?.id);
    setPanel('widget');
    if (!sourceEditor) {
      sourceInitialTab.current = designTab;
      sourceReturn.current = {panel:dataPanel,tab:'data'};
    }
    setWidgetTab(designTab);
    setSourceEditor({tab:designTab,formId:businessDataFormId});
  }, [designNavigationKey, designTab, editing, state, draft, businessDataFormId, sourceEditor]);

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
        const response = await getPlatformForm(id, editingCanvas && admin ? {schema:'draft', scope:'designer'} : {schema:'published',scope:'list'});
        if(current)setSources(previous=>({...previous,[id]:unwrap<PlatformForm>(response)}));
      } catch(failure) { if(current)setSourceErrors(previous=>({...previous,[id]:errorText(failure)})); }
    }));
    return ()=>{current=false;};
  }, [sourceIdsKey, refreshKey, editingCanvas, admin]);

  useEffect(() => {
    if (!publishedSourceId || !publishedSourceKey) return;
    let current = true;
    getPlatformForm(publishedSourceId, {schema:'published',scope:'designer'}).then(response=>{
      if (current) setPublishedSourceState({key:publishedSourceKey, form:unwrap<PlatformForm>(response)});
    }).catch(failure=>{
      if (current) setPublishedSourceState({key:publishedSourceKey, error:errorText(failure)});
    });
    return ()=>{current=false;};
  }, [publishedSourceId, publishedSourceKey]);

  const filterFieldsKey = JSON.stringify(active?.filterFields || []);
  useEffect(() => { setFilters(previous => retainFilters(previous, JSON.parse(filterFieldsKey))); }, [filterFieldsKey]);
  const publishedVersion = state?.publishedVersion;
  const dataSignature = pageDataSignature(dataDefinition);
  const filterSignature = JSON.stringify([filters,visibleChartFilters,widgetFilters]);
  useLayoutEffect(() => {
    if (!editingCanvas || !draft || saving || sourceActive) return;
    const {definition, merged} = mergeListFilters(draft);
    if (!merged.size) return;
    setDraft(definition);
    setPublishCheck(undefined);
    const migratedSelection = selected && merged.get(selected);
    if (migratedSelection) {
      setSelected(migratedSelection);
      setWidgetTab('data');
    }
  }, [draft, editingCanvas, saving, selected, sourceActive]);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  useEffect(() => {
    if (editing || !publishedVersion) return;
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [editing, publishedVersion, refresh]);
  const chartBindingsSignature = JSON.stringify(dataDefinition?.widgets.filter(item=>item.type==='chart')
    .map(item=>[item.id,widgetSourceId(dataDefinition,item),item.targetWidgetIds,item.dimension,item.interaction]));
  useEffect(() => {setChartFilters({});setDrilldown(undefined);},[code,chartBindingsSignature,editing,publishedVersion]);
  useEffect(()=>{setSubmittedFilters({});},[code,editing,publishedVersion]);
  useEffect(()=>{setSubmittedFilters(current=>retainWidgetFilterQueries(active,current));},[active]);
  useEffect(()=>{setFilters({});},[active?.sourceFormId]);
  useEffect(() => {
    const seconds = active?.style?.refreshInterval || 0;
    if (editing || seconds <= 0) return;
    const timer = window.setInterval(()=>{if(document.visibilityState==='visible')refresh();},seconds*1000);
    return ()=>window.clearInterval(timer);
  },[editing,active?.style?.refreshInterval,refresh]);
  useEffect(() => {
    if (!code || !dataDefinition || (!publishedVersion && !canvasUsesDraft)) return;
    let current = true;
    const token = ++request.current;
    setLoadingData(true); setDataError(''); setData(undefined);
    const query = {filters,filter_queries:widgetFilters,chart_values:visibleChartFilters};
    api.post(`/pages/${code}/${canvasUsesDraft?'preview':'data'}`, canvasUsesDraft?{definition:dataDefinition,...query}:query).then(response => {
      if (!current || token !== request.current) return;
      if (!canvasUsesDraft && response.data.publishedVersion !== publishedVersion) {
        setDataError('页面已发布新版本，请重新加载页面'); return;
      }
      const analytics = response.data.analyticsData;
      setData(analytics ? {...analytics, diagnostic: diagnosticReference(response.headers)} : undefined);
    }).catch(failure => { if (current) setDataError(errorText(failure)); })
      .finally(() => { if (current) setLoadingData(false); });
    return () => { current = false; };
  }, [code, filterSignature, dataSignature, publishedVersion, refreshKey, canvasUsesDraft]);

  useEffect(() => {
    if (!exitDirty && !exitBusy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [exitDirty,exitBusy]);
  const reportBlocked = useCallback((value:RouteExit)=>{routeExit.current=value;setExitError('');setExitPrompt(true);},[]);
  const changeDraft = (next:PageDefinition) => {
    if (!draft || saving || JSON.stringify(next)===JSON.stringify(draft)) return;
    setPast(history=>[...history.slice(-79),draft]);setFuture([]);setDraft(next);setPublishCheck(undefined);
  };
  const componentPageTitle = active?.title || draft?.title;
  useEffect(() => {
    if (!code || !admin || !componentPageTitle) return;
    setComponentPageContext({code, title: componentPageTitle});
    return () => setComponentPageContext(undefined);
  }, [code, admin, componentPageTitle, setComponentPageContext]);
  useLayoutEffect(() => {
    if (!code || !admin || !draft || state?.code !== code) return;
    return registerComponentPageController(code, async action => {
      if (saving || loading || sourceActive || previewing || exitPrompt || publishCheck || sectionHistory) {
        throw new Error('请先完成当前编辑器操作，再让 AI 修改组件');
      }
      const fieldsFor = (id: number) => (sources[id]?.fields ?? forms.find(form => form.id === id)?.fields)
        ?.filter(field => !field.archived).map(field => field.field_name);
      let next = draft;
      let selectedWidgetId = selected;
      if (action.action === 'apply') {
        next = applyComponentOperations(draft, action.operations, fieldsFor);
        const last = action.operations[action.operations.length - 1];
        selectedWidgetId = last.widget_id;
        flushSync(() => {
          changeDraft(next);
          setEditing(true);
          setSourceEditor(undefined);
          setSelected(last.widget_id);
          setPanel('widget');
          setPropertyTarget(undefined);
          setWidgetTab(last.action === 'edit' && (last.properties?.dataBinding !== undefined || last.properties?.filterFields !== undefined) ? 'data' : 'basic');
        });
      }
      const sourceIds = new Set([next.sourceFormId, ...next.widgets.map(widget => widgetSourceId(next, widget))]);
      const requestedWidget = action.action === 'inspect' && action.widget_id
        ? next.widgets.find(widget => widget.id === action.widget_id) : undefined;
      if (action.action === 'inspect' && action.widget_id && !requestedWidget) throw new Error('找不到指定组件');
      return {
        page_code: code, title: next.title, source_form_id: next.sourceFormId,
        selected_widget_id: selectedWidgetId,
        ...(action.action === 'apply' ? {saved: false} : {}),
        widget: requestedWidget,
        widgets: next.widgets.map(({id, type, title, dataBinding, chartType, dimension, measure, aggregate, interaction, targetWidgetIds, filterFields, width, customWidth, customHeight, heightPercent}) =>
          ({id, type, title, dataBinding, chartType, dimension, measure, aggregate, interaction, targetWidgetIds, filterFields, width, customWidth, customHeight, heightPercent,
          })),
        sources: [...sourceIds].flatMap(id => id ? [{form_id: id, fields: fieldsFor(id) ?? []}] : []),
      };
    });
  });
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
    if (!draft || !state || saving || versionConflict) return false;
    setSaving(true);setError('');setPublishError('');
    try {
      const response = await api.request<PageState>({url: `/pages/${code}/${publish ? 'publish' : 'draft'}`, method: publish ? 'POST' : 'PUT', data: {definition: draft, expectedRevision: state.revision}});
      setState(response.data); setDraft(response.data.definition);
      if (publish) { setEditing(false);setPreviewing(false);setSelected(undefined);setPast([]);setFuture([]);setPublishCheck(undefined);setFilters({}); refresh(); window.dispatchEvent(new Event('applications-changed')); }
      message.success(publish ? '页面已发布' : '草稿已保存');
      return true;
    } catch (failure) {
      setVersionConflict(isRevisionConflict(failure));
      if (publish) setPublishError(errorText(failure));
      else setError(errorText(failure));
      return false;
    }
    finally { setSaving(false); }
  };
  const closeSourceEditor = () => {
    setSourceEditor(undefined);
    setPanel(sourceReturn.current.panel);
    setWidgetTab(pendingWidgetTab.current??sourceReturn.current.tab);
    pendingWidgetTab.current=undefined;
    sourceInitialTab.current=undefined;
    refresh();
  };
  const requestSourceExit = (tab?:WidgetTab) => {
    pendingWidgetTab.current=tab;
    if (sourceExitRequest.current) sourceExitRequest.current();
    else closeSourceEditor();
  };
  const openBusiness = (tab:BusinessTab, formId=sourceId, fromPage=false) => {
    if(saving||!formId)return;
    if(!sourceActive) {
      sourceInitialTab.current=tab;
      sourceReturn.current={panel:fromPage?'compatibility':'widget',tab:widgetTab==='data'?'data':'basic'};
    }
    if (fromPage) setSelected(undefined);
    setPanel('widget');
    setWidgetTab(tab);setSourceEditor({tab,formId});
  };
  const changeWidgetTab = (tab:WidgetTab) => {
    setPropertyTarget(undefined);
    if(tab==='form'||tab==='flow'){openBusiness(tab);return;}
    if(sourceActive){
      requestSourceExit(tab);
      return;
    }
    setWidgetTab(tab);
  };
  const hasProportionalWidgets = Boolean(active?.widgets.some(widget=>widget.heightPercent!=null && widget.customHeight==null));
  useLayoutEffect(()=>{
    if((!editingCanvas&&!hasProportionalWidgets) || !pageElement.current)return;
    const element=pageElement.current;
    const surface=element.closest('.content-surface');
    const resize=()=>{
      const rect=element.getBoundingClientRect();
      const scale=(element.offsetWidth && rect.width/element.offsetWidth)||1;
      const top=element.querySelector('.analytics-workspace-body')?.getBoundingClientRect().top??rect.top;
      if(editingCanvas)element.style.setProperty('--component-editor-height',`${Math.max(260,(window.innerHeight-top-16)/scale)}px`);
      if(hasProportionalWidgets){
        const bottom=Math.min(window.innerHeight,surface?.getBoundingClientRect().bottom??window.innerHeight);
        const paddingBottom=parseFloat(getComputedStyle(element).paddingBottom);
        const available=(bottom-top)/scale+(surface?.scrollTop??0)-paddingBottom;
        element.style.setProperty('--component-available-height',`${Math.max(120,Math.round(available))}px`);
      }
    };
    resize();
    const observer=new ResizeObserver(resize);observer.observe(element);
    if(surface&&hasProportionalWidgets)observer.observe(surface);
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    return ()=>{observer.disconnect();window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};
  },[editingCanvas,sourceActive,hasProportionalWidgets,loading]);
  const add = (type: AddableWidgetType) => {
    if (!draft) return;
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const widget = newComponent(draft, id, type, fields[0]?.field_name);
    changeDraft({...draft, widgets:type==='record-filter'?[widget,...draft.widgets]:[...draft.widgets,widget]});
    setSelected(id);setPanel('widget');setWidgetTab('data');setPropertyTarget(undefined);
  };
  const move = (id: string, offset: number) => {
    if (!draft) return;
    const index = draft.widgets.findIndex(item => item.id === id);
    const target = draft.widgets[index + offset];
    if (target) changeDraft(moveWidget(draft, id, target.id));
  };
  const dropComponent = (event: React.DragEvent, target?: string) => {
    if (!editingCanvas || !draft) return;
    event.preventDefault(); event.stopPropagation();
    const type = event.dataTransfer.getData('component/type') as AddableWidgetType;
    if (Object.prototype.hasOwnProperty.call(componentNames, type)) add(type);
    else if (target) changeDraft(moveWidget(draft, event.dataTransfer.getData('component/id'), target));
  };
  const leaveEditor = (discard = true) => {
    const blockedRoute = routeExit.current;
    routeExit.current=undefined;
    setSourceEditor(undefined);sourceInitialTab.current=undefined;pendingWidgetTab.current=undefined;
    setExitPrompt(false);setExitError('');setPreviewing(false);setFilters({});setError('');
    if (discard) setDraft(state?.definition);
    if (blockedRoute) {
      blockedRoute.proceed();
      return;
    }
    setEditing(false);setSelected(undefined);
  };
  const requestExit = () => {if(!exitBusy){if(exitDirty){setExitError('');setExitPrompt(true);}else leaveEditor();}};
  const saveAndLeave = async () => {
    if (exitBusy || (dirty && versionConflict)) return;
    setLeaving(true);setExitError('');
    try {
      if (sourceDirty && !await sourceSaveDraft.current?.()) {
        setExitError('业务来源草稿未能保存。请返回编辑查看错误后重试。');
        return;
      }
      if (dirty && !await save(false)) {
        setExitError('看板草稿未能保存。请继续编辑并检查保存错误。');
        return;
      }
      leaveEditor(false);
    } catch (failure) {
      setExitError(errorText(failure));
    } finally {
      setLeaving(false);
    }
  };
  useEffect(() => {
    if (!editing) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.repeat || event.defaultPrevented || exitBusy || exitPrompt) return;
      if (event.target instanceof HTMLElement && event.target.hasAttribute('data-editor-escape-handled')) return;
      // Observe overlays before their own handlers close them, so one Esc only closes one layer.
      const overlayOpen = Array.from(document.querySelectorAll<HTMLElement>(
        '.ant-modal-wrap, .ant-drawer-open .ant-drawer-content-wrapper, .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-dropdown:not(.ant-dropdown-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden), .ant-popover:not(.ant-popover-hidden)',
      )).some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      if (overlayOpen) return;
      event.preventDefault();
      if (previewing) setPreviewing(false);
      else if (sourceActive) requestSourceExit();
      else requestExit();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [editing, exitBusy, exitPrompt, sourceActive, previewing, exitDirty, state]);
  const cancelExit = () => {setExitPrompt(false);setExitError('');routeExit.current?.reset();routeExit.current=undefined;};
  const beginEditing = async (next:Panel, id?:string, tab:WidgetTab='basic', section?:'appearance'|'interaction') => {
    if(saving||sourceActive)return;
    if(sourceEditor){setSourceEditor(undefined);sourceInitialTab.current=undefined;}
    let definition = draft;
    if (!editing) {
      setSaving(true);setError('');
      try {
        const response=await api.get<PageState>('/pages/'+code+'/editor');
        definition = response.data.definition;
        setVersionConflict(false);
        setState(response.data);setDraft(definition);setPast([]);setFuture([]);
        setFilters({});setSubmittedFilters({});setDataError('');setEditing(true);
      } catch(failure){setError(errorText(failure));return;} finally{setSaving(false);}
    }
    const widgets = definition?.widgets;
    const requested = widgets?.find(widget=>widget.id===(id||selected));
    if (id && !requested) message.info('此组件不在当前草稿中。');
    const selection = requested ?? widgets?.find(widget=>widget.type!=='record-filter') ?? widgets?.[0];
    setPanel(next);setSelected(selection?.id);setWidgetTab(tab);
    setPropertyTarget(section && requested ? {section} : undefined);
    return !id || requested ? definition : undefined;
  };
  const requestReload = () => {
    if (saving || sourceActive) return;
    setPublishCheck(undefined);setSectionHistory(undefined);setReloadError('');setReloadPrompt(true);
  };
  const reloadServerDraft = async () => {
    if (saving || sourceActive) return;
    setSaving(true);setReloadError('');
    try {
      const {data: latest} = await api.get<PageState>(`/pages/${code}/editor`);
      const selection = latest.definition.widgets.find(widget=>widget.id===selected) ?? latest.definition.widgets.find(widget=>widget.type!=='record-filter') ?? latest.definition.widgets[0];
      setState(latest);setDraft(latest.definition);setSelected(selection?.id);setPropertyTarget(undefined);
      setError('');setPublishError('');setSectionError('');setVersionConflict(false);setReloadPrompt(false);
      setPast([]);setFuture([]);setFilters({});setChartFilters({});setSubmittedFilters({});refresh();
      message.success('已加载最新草稿');
    } catch (failure) {
      setReloadError(errorText(failure));
    } finally {
      setSaving(false);
    }
  };
  const contextWidget = active?.widgets.find(item => item.id === contextWidgetId);
  const sourceIsBusiness = source && !['analysis', 'analytics', 'dashboard', 'report'].includes(String(source.config?.assemblyKind));
  const openContextAction = async (key: string) => {
    setContextOpen(false);
    if (key.startsWith('source:')) {
      const definition = await beginEditing(contextWidget ? 'widget' : 'compatibility',contextWidget?.id);
      const formId = contextSourceId(definition, contextWidget?.id);
      if (formId) openBusiness(key.slice(7) as BusinessTab, formId, !contextWidget);
      return;
    }
    if(key==='edit'||key.startsWith('widget-')){
      const filterLink = key==='widget-interaction'&&contextWidget?.type==='record-filter';
      await beginEditing(contextWidget?'widget':'style',contextWidget?.id,filterLink?'data':'basic',
        key==='widget-style'?'appearance':key==='widget-interaction'&&!filterLink?'interaction':undefined);
    }
    else await beginEditing(key as Panel);
  };
  const checkPublish = async () => {
    if(!draft||saving)return;
    setSaving(true);setError('');setPublishError('');
    try {
      const {data: response} = await api.post<{analyticsData?: RuntimeAnalyticsData}>('/pages/'+code+'/preview',{definition:draft,filters:{}});
      setPublishCheck(normalizePublishCheck(draft, response.analyticsData));
    } catch(failure) {
      const detail = (failure as {response?: {data?: {detail?: unknown}}})?.response?.data?.detail;
      setPublishCheck(normalizePublishCheck(draft, detail, errorText(failure)));
    } finally {
      setSaving(false);
    }
  };
  const closeRecordLink = () => setSearchParams(current=>{
    const next = new URLSearchParams(current);
    next.delete('recordId');
    return next;
  }, {replace:true});
  const renderWidget = (item: PageWidget, fitTableHeight: boolean) => {
    if (item.type === 'workspace') return renderWorkspaceWidget ? renderWorkspaceWidget(item) : <Alert type="info" message="此组件用于我的工作台" />;
    const pendingFilter = canvasUsesDraft && active ? pendingSharedFilter(active,item) : undefined;
    if (pendingFilter) return <Alert type="info" showIcon message={{
      source:'请选择联动组件',
      fields:'请选择筛选字段',
      targets:'请选择联动组件',
    }[pendingFilter]} description="在组件属性的「数据」页签完成配置后，筛选会在画布上生效。" />;
    if (canvasUsesDraft && item.type==='record-filter' && !dataDefinition?.widgets.some(widget=>widget.id===item.id)) {
      return <Alert type="info" showIcon message="等待联动组件完成配置" description="联动组件配齐来源和字段后，筛选会在画布上生效。" />;
    }
    const boundId = widgetSourceId(active,item);
    const source = boundId ? sources[boundId] : undefined;
    const labels = Object.fromEntries((source?.fields || []).filter(field=>!field.archived).map(field=>[field.field_name,field.label]));
    const componentGlobalFilters = boundId === active?.sourceFormId ? externalFilters : [];
    if (boundId&&sourceErrors[boundId]) return <Alert type="warning" showIcon message="此组件的数据来源暂不可用" description={sourceErrors[boundId]} />;
    if (boundId&&!source) return <div className="component-widget-preview"><Spin /></div>;
    if (!boundId) return <Alert type="info" showIcon message="请为此组件选择业务数据来源" description="右键打开组件属性，在数据中选择业务来源。" />;
    if (canvasUsesDraft && active && pendingDataCard(active,item)==='dimension') {
      return <Alert type="info" showIcon message="请选择分组字段" description="在组件属性的「数据」页签选择新来源的分组字段。" />;
    }
    if (item.type === 'record-filter') {
      if (source?.status !== 'published') return <Alert type="info" showIcon message="请先发布来源业务表单" />;
      return <FilterWidget key={`${source.id}:${item.id}`} widget={item} sourceId={source.id}
        onChange={query=>setSubmittedFilters(previous=>({...previous,[item.id]:{signature:widgetFilterSignature(active!,item),query}}))} />;
    }
    const query = componentQuery(dataDefinition!, widgetFilters, visibleChartFilters, item.id);
    if(!query.ready)return <Alert type="info" showIcon message="请先填写必填筛选条件并查询" description="关联的筛选组件校验通过后，将显示列表数据。" />;
    if (item.type === 'record-list') return source?.status==='published' ? <RecordListWidget key={`${item.id}:${source.id}:${item.showFilters !== false}`} widget={item} sourceId={source.id} embedded fitTableHeight={fitTableHeight} toolbarTargetId={`component-toolbar-${item.id}`} listSettings={item.listSettings} readOnly={editingCanvas||previewCanvas} disableRowAction={editingCanvas} externalSearch={query.search} tableDensity={resolvePresentation(active || {}, item).content.density} externalFilters={[...componentGlobalFilters, ...query.filters]} refreshKey={refreshKey} onMutated={refresh} /> : <Alert type="info" showIcon message="业务列表等待数据配置" description="通过右键菜单配置并发布来源表单的字段与列表，即可预览真实数据。" />;
    if (loadingData) return <div className="component-widget-preview"><Spin /></div>;
    const widgetErrors = data?.widgetErrors?.[item.id] ?? data?.errors;
    if (dataError || widgetErrors?.length) return <Alert type="warning" showIcon message="统计暂不可用"
      description={dataError || <>{widgetErrors?.join('；')}{data?.diagnostic && <div>{data.diagnostic}</div>}</>} />;
    const result = data?.widgets?.[item.id];
    if (!result) return <Alert type="info" message="暂无统计结果" />;
    return <StatisticalWidget widget={item} result={result} style={{...active?.style,tableDensity:resolvePresentation(active || {}, item).content.density}} labels={labels} onInteract={value=>{
      if(editingCanvas){selectWidget(item.id);return;}
      if(!item.dimension||item.interaction==='none')return;
      if(item.interaction==='navigate'){
        if(source?.code) {
          if (previewCanvas) setDrilldown({formId:source.id,title:source.name,search:'',filters:[]});
          else navigate('/dynamic/'+source.id);
        }
        return;
      }
      if(item.interaction==='drilldown'){setDrilldown({formId:boundId,field:item.dimension,value,title:item.title+' · '+value,search:query.search,filters:[...componentGlobalFilters,...query.filters,{field:item.dimension,op:'equals',value}]});return;}
      if(item.targetWidgetIds?.length){setChartFilters(previous=>{const next={...previous};if(next[item.id]===value)delete next[item.id];else next[item.id]=value;return next;});}
      else if(boundId===active?.sourceFormId&&active?.filterFields.includes(item.dimension))chooseFilter(item.dimension,value);
    }} />;
  };

  if (loading) return <div className="component-page-loading"><Spin size="large" /></div>;
  const publishable = Boolean(draft && (!state?.publishedVersion || JSON.stringify(draft)!==JSON.stringify(state.publishedDefinition)));
  const hasUnpublishedDraft = state && JSON.stringify(state.definition)!==JSON.stringify(state.publishedDefinition);
  const selectWidget = (id:string) => {
    if(saving||sourceActive) return;
    if (id !== selected || panel !== 'widget') setPropertyTarget(undefined);
    setSelected(id);setPanel('widget');
  };
  const widgetFrame = (id: string) => pageElement.current?.querySelector<HTMLElement>(`[data-component-widget-id="${CSS.escape(id)}"]`);
  const readWidgetSize = (id: string, axis: 'width' | 'height') => {
    const frame = widgetFrame(id);
    return axis === 'width' ? frame?.parentElement?.offsetWidth : frame?.offsetHeight;
  };
  const reloadAction = <Button size="small" disabled={saving||sourceActive} onClick={requestReload}>加载最新草稿</Button>;
  const errorNotice = versionConflict
    ? <Alert type="warning" showIcon message="看板版本已更新" description="本地修改仍保留。可先核对改动，再加载最新草稿继续配置。" action={reloadAction} />
    : error && <Alert type="error" showIcon message={error} />;
  const onlyWidget = active?.widgets.length === 1 ? active.widgets[0] : undefined;
  const singleRecordList = !sourceActive && !workspace && onlyWidget?.type === 'record-list';
  const showPageFilters = Boolean(active?.filterFields.length || Object.keys(chartFilters).length);
  const filterLayout = active?.filterFields.length ? active.style?.filterTheme ?? 'toolbar' : 'toolbar';
  const canvas = <main className={'analytics-workspace-canvas component-page-canvas component-filter-layout-'+filterLayout} aria-label="业务页面画布" tabIndex={admin?0:undefined}>
    {!editingCanvas&&errorNotice}
    {active&&<>
      {showPageFilters&&<div className="runtime-analytics-filters component-page-filters">
        <div className="analytics-filter-heading"><span><FilterOutlined /> {active.filterFields.length?'全局筛选':'业务数据'}</span><Button type="text" size="small" aria-label="刷新页面数据" onClick={refresh} loading={loadingData}>刷新</Button></div>
        {(!!active.filterFields.length||Object.keys(chartFilters).length>0)&&<Space wrap>{active.filterFields.map(field=><Select key={field} aria-label={globalLabels[field]||field} placeholder={globalLabels[field]||field} allowClear showSearch disabled={!data||Boolean(data.errors?.length)} value={filters[field]} options={(data?.filterOptions?.[field]||[]).map(value=>({label:value,value}))} onChange={value=>chooseFilter(field,value)} />)}<Button onClick={()=>{setFilters({});setChartFilters({});}}>清除全局与图表条件</Button></Space>}
      </div>}
      {!active.widgets.length&&<div className="component-page-empty"><Typography.Title level={4}>空白页面</Typography.Title><Typography.Paragraph>{admin&&!previewCanvas?'右键添加组件，开始搭建业务页面。':'此页面暂未添加组件。'}</Typography.Paragraph></div>}
      <div className="component-page-grid" onDragOver={event=>{if(editingCanvas)event.preventDefault();}} onDrop={event=>dropComponent(event)}>
        <Row gutter={[singleRecordList ? 0 : active.style?.componentGap??12,active.style?.componentGap??12]}>{active.widgets.map(item=>{
          const appearance = item.appearance;
          const presentation = resolvePresentation(active, item);
          const titleAlign = appearance?.titleAlign ?? 'left';
          const canonFrame = item.type==='record-list'||item.type==='record-filter';
          const titleStyle: React.CSSProperties = {
            textAlign: titleAlign,
            fontSize: appearance?.titleFontSize,
            fontFamily: appearance?.titleFontFamily,
            fontWeight: appearance?.titleWeight,
            fontStyle: appearance?.titleItalic ? 'italic' : undefined,
            color: appearance?.titleColor,
            marginBottom: appearance?.titleGap,
            lineHeight: appearance?.titleFontSize ? Math.max(canonFrame ? 24 : 20, Math.ceil(appearance.titleFontSize * 1.25)) + 'px' : undefined,
          };
          const frameHeight = widgetFrameHeight(item);
          const fitTableHeight = item.type === 'record-list' && frameHeight != null;
          const columnStyle = {
            '--component-column-width': `${item.width / 24 * 100}%`,
            ...(item.customWidth ? {flex:`0 0 ${item.customWidth}px`,maxWidth:'100%'} : {}),
          } as React.CSSProperties;
          return <Col key={item.id} span={24} style={columnStyle}>
          <WidgetFrame data-component-widget-id={item.id} data-fit-list-height={fitTableHeight || undefined} presentation={presentation} canon={canonFrame}
            style={{height:frameHeight}}
            className={'component-page-widget component-page-widget-'+item.type+(editingCanvas?' analytics-editable-widget':'')+(editingCanvas&&panel==='widget'&&selected===item.id?' analytics-selected-widget':'')}
            onDragOver={event=>{if(editingCanvas)event.preventDefault();}} onDrop={event=>dropComponent(event,item.id)}
            onClick={event=>{if(editingCanvas&&!(event.target instanceof Element&&event.target.closest('input,textarea,button,a,[role="combobox"]')))selectWidget(item.id);}}
            heading={<div style={titleStyle}>{editingCanvas?<button className="analytics-widget-select"
              style={{justifyContent:titleAlign==='center'?'center':titleAlign==='right'?'flex-end':'flex-start',textAlign:'inherit'}} type="button" draggable disabled={saving||sourceActive} aria-label={'配置'+item.title}
              onClick={()=>selectWidget(item.id)}
              onKeyDown={event=>{if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();move(item.id,event.key==='ArrowUp'?-1:1);}}}
              onDragStart={event=>{selectWidget(item.id);event.dataTransfer.setData('component/id',item.id);event.dataTransfer.effectAllowed='move';}}
              onDragOver={event=>event.preventDefault()} onDrop={event=>dropComponent(event,item.id)}><HolderOutlined />{item.title}</button>:item.title}</div>}
            description={appearance?.subtitle?.trim()?<div style={{fontSize:appearance.subtitleFontSize,color:appearance.subtitleColor,textAlign:appearance.subtitleAlign,lineHeight:appearance.subtitleFontSize?1.5:undefined}}>{appearance.subtitle}</div>:undefined}
            actions={(item.type==='record-list'||item.type==='record-filter'||chartFilters[item.id]!==undefined)?<Space size={6}>{(item.type==='record-list'||item.type==='record-filter')&&<span className="component-list-header-actions" id={`component-toolbar-${item.id}`} />}{chartFilters[item.id]!==undefined&&<Button type="text" size="small" onClick={()=>setChartFilters(previous=>{const next={...previous};delete next[item.id];return next;})}>清除联动</Button>}</Space>:undefined}
            editorHandle={editingCanvas&&(!presentation.header.visible||!presentation.header.titleVisible)?<button className="analytics-widget-select"
              style={{justifyContent:titleAlign==='center'?'center':titleAlign==='right'?'flex-end':'flex-start',textAlign:'inherit'}} type="button" draggable disabled={saving||sourceActive} aria-label={'配置'+item.title}
              onClick={()=>selectWidget(item.id)}
              onKeyDown={event=>{if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();move(item.id,event.key==='ArrowUp'?-1:1);}}}
              onDragStart={event=>{selectWidget(item.id);event.dataTransfer.setData('component/id',item.id);event.dataTransfer.effectAllowed='move';}}
              onDragOver={event=>event.preventDefault()} onDrop={event=>dropComponent(event,item.id)}><HolderOutlined />{item.title}</button>:undefined}>
            {renderWidget(item, fitTableHeight)}
            {editingCanvas&&!saving&&!sourceActive&&<ResizeHandle title={item.title} onCommit={size=>{if(draft)changeDraft({...draft,widgets:draft.widgets.map(widget=>widget.id===item.id?{...widget,...size,...(size.customHeight!=null?{heightPercent:null}:{})}:widget)});}}/>}
          </WidgetFrame>
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
    setHistoryLoading(true);setSectionError('');
    try {
      const response = await api.get(`/pages/${code}/widgets/${selected}/${widgetTab}/versions`);
      setSectionHistory({widgetId:selected,tab:widgetTab,items:response.data.items});
    } catch(failure){message.error(errorText(failure));}
    finally{setHistoryLoading(false);}
  };
  const sectionWidget = draft?.widgets.find(widget=>widget.id===sectionHistory?.widgetId);
  const businessMenuSource = contextSourceId(active, contextWidget?.id);
  const sectionBlockedReason = !state?.publishedVersion ? '请先发布页面首个版本。'
    : !state.publishedDefinition?.widgets.some(widget=>widget.id===sectionHistory?.widgetId) ? '此组件尚未上线，请先发布整个页面。'
    : sectionHistory?.tab==='data' && sectionWidget?.type==='record-list' && state.publishedDefinition.widgets.some(widget=>
      widget.type==='record-filter' && widget.targetWidgetIds?.length===1 && widget.targetWidgetIds[0]===sectionWidget.id && !draft?.widgets.some(item=>item.id===widget.id))
      ? '请发布整个页面，以同步移除已合并的筛选组件。' : undefined;
  const publishSection = async () => {
    if(!sectionHistory||!draft||!state||saving||versionConflict||sectionBlockedReason)return;
    setSaving(true);setSectionError('');
    try {
      const response = await api.post<PageState>(`/pages/${code}/widgets/${sectionHistory.widgetId}/${sectionHistory.tab}/publish`,{definition:draft,expectedRevision:state.revision});
      setState(response.data);setDraft(response.data.definition);setSectionHistory(undefined);refresh();message.success('当前组件页签已独立发布');
    }catch(failure){setVersionConflict(isRevisionConflict(failure));setSectionError(errorText(failure));}finally{setSaving(false);}
  };
  const publishLabel = state?.publishedVersion ? '发布新版本' : '创建首个版本';
  const publishBlocked = Boolean(publishCheck?.errors.length || publishCheck?.widgets.length);
  const headerActions = <div className="analytics-settings-history analytics-settings-history-inline"><Space size={0}>
    <Tooltip title="撤销"><Button type="text" aria-label="撤销" icon={<UndoOutlined />} disabled={!past.length||saving||sourceActive} onClick={undo} /></Tooltip>
    <Tooltip title="重做"><Button type="text" aria-label="重做" icon={<RedoOutlined />} disabled={!future.length||saving||sourceActive} onClick={redo} /></Tooltip>
    {panel==='widget'&&selectedWidget&&<Tooltip title="组件版本管理"><Button type="text" aria-label="组件版本管理" icon={<HistoryOutlined />} loading={historyLoading} disabled={saving||historyLoading||sourceActive||(widgetTab!=='basic'&&widgetTab!=='data')} onClick={()=>void openSectionHistory()} /></Tooltip>}
  </Space></div>;
  const page = <div ref={pageElement} style={{'--analytics-paper':active?.style?.background||dashboardStyleDefaults.background, '--analytics-grid-size':`${active?.style?.gridSize??dashboardStyleDefaults.gridSize}px`, '--analytics-card-opacity':active?.style?.cardOpacity??dashboardStyleDefaults.cardOpacity, '--analytics-card-blur':`${active?.style?.cardBlur??dashboardStyleDefaults.cardBlur}px`} as React.CSSProperties} data-card-border={active?.style?.cardBorder??'light'} className={'component-page analytics-workspace'+(workspace?' component-workbench':'')+(editingCanvas?' analytics-workspace-configuring':'')+(sourceActive?' component-page-source-open':'')}
    onContextMenuCapture={admin ? event=>{
      const target = event.target;
      if (!(target instanceof Element) || !event.currentTarget.contains(target) ||
        target.closest('.analytics-settings-page,.component-page-source-editor,input,textarea,[contenteditable="true"],[role="combobox"]')) {
        event.stopPropagation();
        setContextOpen(false);
        return;
      }
      const id = target.closest<HTMLElement>('[data-component-widget-id]')?.dataset.componentWidgetId;
      // Resolve the workspace or widget target before the dropdown opens.
      flushSync(()=>setContextWidgetId(id));
    } : undefined}>
    <NavigationGuard enabled={exitDirty||exitBusy} reopensSource={sourceActive&&businessDataFormId!==undefined} onBlocked={reportBlocked} />
    {admin && state && <div className="component-page-editor-toolbar" role="group" aria-label={pageNoun+'编辑操作'}>
      <Typography.Text type="secondary" role="status">
        {sourceActive ? '正在编辑业务来源' : previewCanvas ? '草稿预览' : editing ? '编辑草稿' : '已发布版本'}
        {!sourceActive && (dirty ? ' · 未保存修改' : (editing || previewCanvas) && hasUnpublishedDraft ? ' · 草稿待发布' : state.publishedVersion ? ' · v'+state.publishedVersion : '')}
      </Typography.Text>
      <Space size={8} wrap>
        {sourceActive ? <Button size="small" disabled={exitBusy} onClick={()=>requestSourceExit()}>返回{pageNoun}编辑</Button>
          : previewing ? <Button size="small" onClick={()=>setPreviewing(false)}>返回编辑</Button>
          : editing ? <>
            <Button size="small" disabled={saving} onClick={()=>{setPropertyTarget(undefined);setPanel('style');}}>页面设置</Button>
            <Button size="small" disabled={saving||historyLoading} onClick={()=>void openPageHistory()}>页面版本</Button>
            <Button size="small" disabled={saving} onClick={()=>{setContextOpen(false);setPreviewing(true);}}>预览草稿</Button>
            <Button size="small" icon={<SaveOutlined />} disabled={!dirty||saving||versionConflict} onClick={()=>void save(false)}>保存草稿</Button>
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} disabled={!publishable||saving||versionConflict} onClick={()=>void checkPublish()}>发布页面</Button>
            <Button size="small" disabled={saving} onClick={requestExit}>退出编辑</Button>
          </> : <Button size="small" disabled={saving} onClick={()=>void beginEditing(draft?.widgets.length?'widget':'add')}>编辑{pageNoun}</Button>}
      </Space>
    </div>}
    <div className="analytics-workspace-body">
      <div className="component-page-preview">
        <div className="component-page-canvas-host" hidden={sourceActive}>{canvas}</div>
        {sourceActive&&sourceId&&<div className="component-page-source-editor"><Suspense fallback={<Spin />}><FormSettings key={sourceId} formId={String(sourceId)} requestExitRef={sourceExitRequest} embeddedDraftGuard={embeddedDraftGuard} workspaceTargets={{properties:sourcePropertiesTarget,actions:sourceActionsTarget,status:sourceStatusTarget}} initialTab={sourceInitialTab.current} requestedTab={sourceEditor?.tab} onTabChange={openBusiness} onExit={closeSourceEditor} onPublished={refresh} /></Suspense></div>}
      </div>
      {editingCanvas&&draft&&<div className="analytics-settings-page">
        <Inspector workspace={workspace} panel={panel} tab={widgetTab} definition={draft} selected={selected} fields={fields} forms={forms} roles={roles} publishedSource={publishedSource}
          savedPageSource={state?.definition.sourceFormId != null || state?.publishedDefinition?.sourceFormId != null}
          savedPageAccess={Boolean(state?.definition.roleIds?.length || state?.publishedDefinition?.roleIds?.length)}
          approvalStatusAvailable={Boolean(source?.runtime_approval_available ?? source?.runtime_submission_available)}
          approvalStatusDefaultVisible={Boolean(source?.runtime_submission_available)}
          sourceSlots={{properties:setSourcePropertiesTarget,actions:setSourceActionsTarget,status:setSourceStatusTarget}} disabled={saving} sourceOpen={sourceActive} sourceIsBusiness={Boolean(sourceIsBusiness)}
          onPanel={next=>{setPropertyTarget(undefined);setPanel(next);}} onTab={changeWidgetTab} onChange={changeDraft} onAdd={add} onSelect={selectWidget} readWidgetSize={readWidgetSize} propertyTarget={propertyTarget}
          onBusiness={openBusiness} onClose={requestExit} headerActions={headerActions} status={errorNotice&&<div className="analytics-settings-status">{errorNotice}</div>} />
      </div>}
    </div>
    <Modal title="页面版本管理" open={Boolean(pageHistory)} onCancel={()=>setPageHistory(undefined)} footer={<Button onClick={()=>setPageHistory(undefined)}>关闭</Button>} width={640}>
      <Typography.Paragraph type="secondary">{draft?.title} · 当前线上版本 {state?.publishedVersion ? `v${state.publishedVersion}` : '尚未发布'}</Typography.Paragraph>
      <Alert type="info" showIcon message="管理整个页面的发布快照" description="包含页面主题、布局、全部组件、数据源绑定、筛选联动及页面权限。恢复只替换页面配置草稿，业务记录和共享数据源的字段、录入、审批流程配置保持原状；发布后才影响线上页面。" />
      {!pageHistory?.length&&<Typography.Paragraph>暂无已发布的页面版本</Typography.Paragraph>}
      {pageHistory?.map(item=><div key={item.version} className="component-page-version-row"><div><strong>页面 v{item.version}{item.version===state?.publishedVersion?' · 线上版本':''}</strong><div>{item.title} · {item.widgetCount} 个组件</div><time>{new Date(item.publishedAt).toLocaleString()}</time></div><Button disabled={saving} onClick={()=>Modal.confirm({title:`恢复页面 v${item.version} 到草稿？`,content:'将替换当前整页配置，包括尚未保存的修改。线上页面和业务数据保持原状；可以撤销此操作，或检查草稿后再发布。',okText:'恢复到草稿',cancelText:'取消',onOk:async()=>{const detail=await api.get(`/pages/${code}/versions/${item.version}`);changeDraft(structuredClone(detail.data.definition));setSelected(undefined);setPanel('style');setPageHistory(undefined);message.success('整页配置已恢复到草稿，尚未发布');}})}>恢复到草稿</Button></div>)}
    </Modal>
      <Modal title={`${sectionWidget?.title ?? '组件'} · ${sectionHistory?.tab==='data'?'数据':'基本'}版本`} open={Boolean(sectionHistory)} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={()=>{if(!saving)setSectionHistory(undefined);}}
        footer={<Space><Button disabled={saving} onClick={()=>setSectionHistory(undefined)}>关闭</Button><Popconfirm title="发布当前组件页签？" description="会保存整页草稿，线上版本仅更新此组件的当前页签。" okText="确认发布" cancelText="取消" disabled={Boolean(sectionBlockedReason)||saving||versionConflict} onConfirm={publishSection}><Button type="primary" loading={saving} disabled={Boolean(sectionBlockedReason)||saving||versionConflict}>独立发布当前页签</Button></Popconfirm></Space>}>
        <Typography.Paragraph type="secondary">版本恢复应用于当前页签的草稿。独立发布会保存整页草稿，线上只更新此组件的当前页签。</Typography.Paragraph>
        {sectionBlockedReason && <Alert type="info" showIcon message={sectionBlockedReason} />}
        {(sectionError||versionConflict) && <Alert type="error" showIcon message={sectionError||'看板版本已更新'} description="本地草稿仍保留，可以关闭弹窗继续编辑。" action={versionConflict?reloadAction:undefined} />}
        {!sectionHistory?.items.length&&<Typography.Paragraph>暂无已发布版本</Typography.Paragraph>}
        {sectionHistory?.items.map(item=><div key={item.pageVersion} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--mf-border)'}}><span>版本 {item.version}</span><Button size="small" disabled={saving} onClick={()=>{if(!draft)return;changeDraft({...draft,widgets:draft.widgets.map(w=>w.id===sectionHistory.widgetId?{...w,...item.snapshot,filterSettings:{...w.filterSettings,...item.snapshot.filterSettings},listSettings:{...w.listSettings,...item.snapshot.listSettings}}:w)});setSectionHistory(undefined);message.success('已恢复当前页签到草稿');}}>恢复到草稿</Button></div>)}
      </Modal>
    <Drawer title={drilldown?.title} open={Boolean(drilldown)} width="min(960px, 100vw)" onClose={()=>setDrilldown(undefined)}>
      {drilldown&&<>{drilldown.field && <Alert type="info" showIcon message={`${sources[drilldown.formId]?.fields?.find(field=>field.field_name===drilldown.field)?.label||drilldown.field}：${drilldown.value}`} style={{marginBottom:16}} />}<DynamicPage formSlug={String(drilldown.formId)} embedded readOnly display="list" tableDensity={active?.style?.tableDensity} externalSearch={drilldown.search} externalFilters={drilldown.filters} /></>}
    </Drawer>
    {!editing && recordFormId && linkedRecordId && <DynamicPage key={`${recordFormId}:${linkedRecordId}`} formSlug={String(recordFormId)}
      embedded display="record" recordLinkId={linkedRecordId} onCloseRecordLink={closeRecordLink} onMutated={refresh} />}
    <Modal title={routeExit.current?'离开当前页面':'关闭页面配置'} open={exitPrompt} closable={!exitBusy} keyboard={!exitBusy} maskClosable={false} onCancel={cancelExit}
      footer={<Space wrap><Button disabled={exitBusy} onClick={cancelExit}>继续配置</Button>{exitDirty
        ? <><Button danger disabled={exitBusy} onClick={()=>leaveEditor()}>放弃未保存修改</Button><Button type="primary" loading={leaving} disabled={exitBusy||(dirty&&versionConflict)} onClick={()=>void saveAndLeave()}>{routeExit.current?'保存并离开':'保存并关闭'}</Button></>
        : <Button type="primary" disabled={exitBusy} onClick={()=>leaveEditor()}>离开页面</Button>}</Space>}>
      <Typography.Paragraph>{exitDirty ? `${[dirty && '看板', sourceDirty && '业务来源'].filter(Boolean).join('和')}有未保存的修改。` : exitBusy ? '请等待当前保存操作完成。' : '当前修改已保存，可以离开页面。'}</Typography.Paragraph>
      {exitError && <Alert type="error" showIcon message={exitError} />}
      {dirty&&versionConflict&&<Alert type="warning" showIcon message="看板版本已更新。请返回配置处理冲突。" />}
    </Modal>
    <Modal title={'发布页面'+(state?.publishedVersion?' · v'+(state.publishedVersion+1):' · '+publishLabel)} open={Boolean(publishCheck)} onCancel={()=>setPublishCheck(undefined)} maskClosable={false} closable={!saving} keyboard={!saving}
      okText="确认发布" cancelText="继续配置" confirmLoading={saving} okButtonProps={{disabled:saving||publishBlocked||versionConflict}} cancelButtonProps={{disabled:saving}} onOk={()=>void save(true)}>
      {publishError ? <Alert type="error" showIcon message={publishError} description="本地草稿仍保留，可以关闭弹窗继续编辑。" action={versionConflict?reloadAction:undefined} />
        : publishBlocked ? <Alert type="error" showIcon message="发布检查未通过" description={<ul>
          {publishCheck?.errors.map((item,index)=><li key={index}>{item}</li>)}
          {publishCheck?.widgets.map(({id,errors,target})=><li key={id}>
            <Button size="small" type="link" onClick={()=>{
              selectWidget(id);setWidgetTab(target==='data'?'data':'basic');
              setPropertyTarget(target==='interaction'||target==='appearance'?{section:target}:undefined);
              setPublishCheck(undefined);
              requestAnimationFrame(()=>widgetFrame(id)?.scrollIntoView({block:'nearest',inline:'nearest'}));
            }}>{draft?.widgets.find(widget=>widget.id===id)?.title || '未命名组件'}</Button>
            {errors.join('；')}
          </li>)}
        </ul>} /> : <Alert type="success" showIcon message="页面和组件检查通过" />}
      <Typography.Paragraph className="analytics-publish-summary">将发布 {draft?.widgets.length||0} 个组件。记录与统计沿用来源业务表单权限，每个组件独立校验业务来源，字段和流程草稿保持独立。</Typography.Paragraph>
    </Modal>
    <Modal title="加载最新看板草稿" open={reloadPrompt} confirmLoading={saving} closable={!saving} keyboard={!saving} maskClosable={false}
      okText="加载最新草稿" cancelText="保留本地修改" cancelButtonProps={{disabled:saving}} onCancel={()=>setReloadPrompt(false)} onOk={()=>void reloadServerDraft()}>
      <Typography.Paragraph>加载后，当前尚未保存的看板修改会被服务器草稿替换。</Typography.Paragraph>
      {reloadError&&<Alert type="error" showIcon message={reloadError} />}
    </Modal>
  </div>;
  return <ListConfigurationPreviewProvider key={JSON.stringify([code, accountKey])} editing={editingCanvas}>
    {admin ? <Dropdown trigger={['contextMenu']} disabled={saving||sourceActive||previewing} open={contextOpen} onOpenChange={setContextOpen} overlayClassName="analytics-context-menu" menu={{
      'aria-label':(contextWidget?.title ?? pageNoun)+'配置菜单',
      items:[
        ...buildAnalyticsContextMenu({widgetTitle:contextWidget?.title,pageLabel:pageNoun,sections:pageSections(active?.sourceFormId != null),
          widgetInteraction:contextWidget?.type==='chart'||contextWidget?.type==='record-list'||contextWidget?.type==='record-filter'}),
        {key:'business',popupClassName:'analytics-context-submenu',icon:<DatabaseOutlined />,label:'业务配置',disabled:!businessMenuSource||!sources[businessMenuSource],children:[
          {key:'source:form',label:'字段与录入'},{key:'source:flow',label:'流程与审批'},
        ]},
      ],onClick:({key})=>void openContextAction(key),
    }}>{page}</Dropdown> : page}
  </ListConfigurationPreviewProvider>;
}
