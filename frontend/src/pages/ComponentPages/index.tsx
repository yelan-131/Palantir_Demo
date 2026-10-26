import React, {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useBlocker, useNavigate, useParams} from 'react-router-dom';
import {Alert, Button, Card, Col, Dropdown, Drawer, Modal, Row, Select, Space, Spin, Typography, message} from 'antd';
import {CheckCircleOutlined, ClockCircleOutlined, DatabaseOutlined, EditOutlined, FilterOutlined, HolderOutlined, PlusOutlined, RedoOutlined, SaveOutlined, SkinOutlined, UndoOutlined} from '@ant-design/icons';
import StatisticalWidget from './StatisticalWidget';
import api, {getPlatformForm, listPlatformForms, type PlatformForm} from '@/services/api';
import {useAuthStore} from '@/stores/authStore';
import {useShellPageTitle} from '@/components/ShellPageTitle';
import DynamicPage from '../DynamicPage';
import type {RuntimeAnalyticsData} from '../AppPrograms/analyticsTypes';
import {linkedListQuery, type FilterContribution, listFilters, moveWidget, pageDataSignature, retainFilters, type PageDefinition, type PageState, type PageWidget, type WidgetType} from './model';
import Inspector, {sections, type BusinessTab, type Panel, type WidgetTab} from './Inspector';
import {buildAnalyticsContextMenu} from '../AppPrograms/AnalyticsContextMenu';
import '../AppPrograms/analytics-workspace.css';
import './style.css';

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
  const blocker = useBlocker(({currentLocation,nextLocation})=>enabled&&currentLocation.pathname!==nextLocation.pathname);
  useEffect(()=>{if(blocker.state==='blocked')onBlocked({proceed:blocker.proceed,reset:blocker.reset});},[blocker.state,onBlocked]);
  return null;
}

export default function ComponentPages({pageCode}: {pageCode?: string} = {}) {
  const navigate = useNavigate();
  const {code: routeCode} = useParams<{code: string}>();
  const code = pageCode || routeCode;
  const admin = Boolean(useAuthStore(state => state.user?.is_admin));
  const [forms, setForms] = useState<PlatformForm[]>([]);
  const [roles, setRoles] = useState<Array<{id: number; name: string; label?: string}>>([]);
  const [state, setState] = useState<PageState>();
  const [draft, setDraft] = useState<PageDefinition>();
  const [source, setSource] = useState<PlatformForm>();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [panel,setPanel] = useState<Panel>('widget');
  const [widgetTab,setWidgetTab] = useState<WidgetTab>('data');
  const [past,setPast] = useState<PageDefinition[]>([]);
  const [future,setFuture] = useState<PageDefinition[]>([]);
  const [exitPrompt,setExitPrompt] = useState(false);
  const [publishCheck,setPublishCheck] = useState<{errors:string[]}>();
  const routeExit = useRef<RouteExit>();
  const [contextOpen, setContextOpen] = useState(false);
  const [contextWidgetId, setContextWidgetId] = useState<string>();
  const [sourceEditor, setSourceEditor] = useState<BusinessTab>();
  const [chartFilters, setChartFilters] = useState<Record<string, Record<string,string>>>({});
  const [drilldown, setDrilldown] = useState<{field:string;value:string;title:string;filters:FilterContribution['filters']}>();
  const [widgetFilters, setWidgetFilters] = useState<Record<string, FilterContribution>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<RuntimeAnalyticsData>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dataError, setDataError] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const request = useRef(0);
  const dirty = Boolean(draft && state && JSON.stringify(draft) !== JSON.stringify(state.definition));
  const active = editing ? draft : state?.publishedDefinition;
  const fields = source?.fields?.filter(field => !field.archived) || [];
  const labels = Object.fromEntries(fields.map(field => [field.field_name, field.label]));
  useShellPageTitle(active?.title || '页面与组件');

  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setState(undefined); setDraft(undefined); setData(undefined); setFilters({}); setEditing(false); setSource(undefined); setSelected(undefined); setPanel('widget');setPast([]);setFuture([]);
    (async () => {
      try {
        if (!code) return;
        if (admin) {
          const response = await api.get<PageState>(`/pages/${code}/editor`);
          if (current) { setState(response.data); setDraft(response.data.definition); setEditing(!response.data.publishedVersion);setPanel(response.data.publishedVersion?'widget':'data'); }
        } else {
          const response = await api.get(`/pages/${code}`);
          if (current) setState({...response.data, revision: 0, publishedDefinition: response.data.definition});
        }
      } catch (failure) { if (current) setError(errorText(failure)); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [code, admin]);

  useEffect(() => {
    if (!admin) return;
    let current = true;
    Promise.allSettled([listPlatformForms(), api.get('/admin/roles')]).then(results => {
      if (!current) return;
      if (results[0].status === 'fulfilled') {
        const items = unwrap<PlatformForm[]>(results[0].value).filter(form => !['analysis', 'analytics', 'dashboard', 'report'].includes(String(form.config?.assemblyKind)));
        setForms(items);
      } else setError(errorText(results[0].reason));
      if (results[1].status === 'fulfilled') setRoles(unwrap(results[1].value));
    });
    return () => { current = false; };
  }, [admin, refreshKey]);

  const sourceId = active?.sourceFormId;
  useEffect(() => {
    if (!sourceId) return;
    let current = true;
    getPlatformForm(sourceId, editing && admin ? {schema: 'draft', scope: 'designer'} : {schema: 'published', scope: 'list'}).then(response => {
      if (current) setSource(unwrap<PlatformForm>(response));
    }).catch(failure => { if (current) { setSource(undefined); setDataError(errorText(failure)); } });
    return () => { current = false; };
  }, [sourceId, refreshKey, editing, admin]);

  const filterFieldsKey = JSON.stringify(active?.filterFields || []);
  useEffect(() => { setFilters(previous => retainFilters(previous, JSON.parse(filterFieldsKey))); }, [filterFieldsKey]);
  const publishedVersion = state?.publishedVersion;
  const dataSignature = pageDataSignature(active);
  const statisticalFilters = Object.fromEntries(Object.entries(chartFilters).filter(([id])=>active?.widgets.some(widget=>widget.id===id&&(widget.type==='metric'||widget.type==='chart'))));
  const filterSignature = JSON.stringify([filters,statisticalFilters]);
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  useEffect(() => {
    if (editing || !publishedVersion) return;
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [editing, publishedVersion, refresh]);
  useEffect(() => {setChartFilters({});setDrilldown(undefined);},[code,sourceId,editing,publishedVersion]);
  useEffect(() => {
    const seconds = active?.style?.refreshInterval || 0;
    if (editing || seconds <= 0) return;
    const timer = window.setInterval(()=>{if(document.visibilityState==='visible')refresh();},seconds*1000);
    return ()=>window.clearInterval(timer);
  },[editing,active?.style?.refreshInterval,refresh]);
  useEffect(() => {
    if (!code || !active || (!publishedVersion && !editing)) return;
    let current = true;
    const token = ++request.current;
    setLoadingData(true); setDataError(''); setData(undefined);
    api.post(`/pages/${code}/${editing?'preview':'data'}`, editing?{definition:active,filters,widget_filters:statisticalFilters}:{filters,widget_filters:statisticalFilters}).then(response => {
      if (!current || token !== request.current) return;
      if (!editing && response.data.publishedVersion !== publishedVersion) {
        setDataError('页面已发布新版本，请重新加载页面'); return;
      }
      setData(response.data.analyticsData || undefined);
    }).catch(failure => { if (current) setDataError(errorText(failure)); })
      .finally(() => { if (current) setLoadingData(false); });
    return () => { current = false; };
  }, [code, filterSignature, dataSignature, publishedVersion, refreshKey, editing]);

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
  const add = (type: WidgetType) => {
    if (!draft) return;
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    changeDraft({...draft, widgets: [...draft.widgets, {id, type, title: names[type], width: type === 'metric' ? 6 : 24, aggregate: 'count', showFilters: false, targetWidgetIds: type === 'record-filter' ? draft.widgets.filter(widget => widget.type === 'record-list').map(widget => widget.id) : undefined, dimension: type === 'chart' ? draft.filterFields[0] || fields[0]?.field_name : undefined}]});
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
    setExitPrompt(false);setEditing(false);setDraft(state?.definition);setSelected(undefined);setFilters({});setError('');
    if(routeExit.current){const exit=routeExit.current;routeExit.current=undefined;exit.proceed();}
  };
  const requestExit = () => {if(!saving){if(dirty)setExitPrompt(true);else leaveEditor();}};
  const cancelExit = () => {setExitPrompt(false);routeExit.current?.reset();routeExit.current=undefined;};
  const beginEditing = async (next:Panel, id?:string, tab:WidgetTab='data') => {
    if(saving||sourceEditor)return;
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
    if (key.startsWith('source:')) {await beginEditing('data');setSourceEditor(key.slice(7) as BusinessTab);return;}
    if(key==='edit'||key.startsWith('widget-'))await beginEditing(contextWidget?'widget':'style',contextWidget?.id,key==='widget-style'?'style':key==='widget-interaction'?'interaction':'data');
    else await beginEditing(key as Panel);
  };
  const checkPublish = async () => {
    if(!draft||saving)return;setSaving(true);setError('');
    try{const response=await api.post('/pages/'+code+'/preview',{definition:draft,filters:{}});setPublishCheck({errors:response.data.analyticsData?.errors||[]});}
    catch(failure){setPublishCheck({errors:[errorText(failure)]});}finally{setSaving(false);}
  };
  const renderWidget = (item: PageWidget) => {
    if (item.type === 'record-filter') return source?.status === 'published' ? <DynamicPage key={JSON.stringify([source.id,item.id,item.filterFields,item.targetWidgetIds])} formSlug={String(source.id)} embedded readOnly display="filters" filterSettings={item.filterSettings} filterFields={item.filterFields} onFilterChange={value => setWidgetFilters(previous => ({...previous, [item.id]: value}))} /> : <Alert type="info" message="请先发布来源业务表单" />;
    const query = linkedListQuery(active?.widgets || [], widgetFilters, item.id);
    if(item.type==='record-list'&&!query.ready)return <Alert type="info" showIcon message="请先填写必填筛选条件并查询" description="关联的筛选组件校验通过后，将显示列表数据。" />;
    if (item.type === 'record-list') return source?.status==='published' ? <DynamicPage formSlug={String(source.id)} embedded listSettings={item.listSettings} display={item.showFilters === false ? 'list' : 'all'} readOnly={editing} externalSearch={query.search} tableDensity={active?.style?.tableDensity} externalFilters={[...externalFilters, ...query.filters, ...listFilters(chartFilters[item.id]||{})]} refreshKey={refreshKey} onMutated={refresh} /> : <Alert type="info" showIcon message="业务列表等待数据配置" description="通过右键菜单配置并发布来源表单的字段与列表，即可预览真实数据。" />;
    if (loadingData) return <div className="component-widget-preview"><Spin /></div>;
    if (dataError || data?.errors?.length) return <Alert type="warning" showIcon message="统计暂不可用" description={dataError || data?.errors?.join('；')} />;
    const result = data?.widgets?.[item.id];
    if (!result) return <Alert type="info" message="暂无统计结果" />;
    return <StatisticalWidget widget={item} result={result} style={active?.style} labels={labels} onInteract={value=>{
      if(editing){setSelected(item.id);setPanel('widget');return;}
      if(!item.dimension||item.interaction==='none')return;
      if(item.interaction==='navigate'){if(source?.code)navigate('/dynamic/'+source.id+'?view=records');return;}
      if(item.interaction==='drilldown'){setDrilldown({field:item.dimension,value,title:item.title+' · '+value,filters:[...externalFilters,...listFilters(chartFilters[item.id]||{}),{field:item.dimension,op:'equals',value}]});return;}
      if(item.targetWidgetIds?.length){setChartFilters(previous=>{const next={...previous};for(const id of item.targetWidgetIds||[])next[id]={...next[id],[item.dimension!]:value};return next;});}
      else if(active?.filterFields.includes(item.dimension))chooseFilter(item.dimension,value);
    }} />;
  };

  if (loading) return <div className="component-page-loading"><Spin size="large" /></div>;
  const publishable = Boolean(draft && (!state?.publishedVersion || JSON.stringify(draft)!==JSON.stringify(state.publishedDefinition)));
  const hasUnpublishedDraft = state && JSON.stringify(state.definition)!==JSON.stringify(state.publishedDefinition);
  const selectWidget = (id:string) => {if(!saving&&!sourceEditor){setSelected(id);setPanel('widget');}};
  const errorNotice = error && <Alert type="error" showIcon message={error} />;
  const canvas = <main className={'analytics-workspace-canvas component-page-canvas component-filter-layout-'+(active?.style?.filterTheme??'toolbar')} aria-label="表单组件画布" tabIndex={admin?0:undefined}
    onContextMenuCapture={admin?event=>{
      const target=event.target instanceof Element?event.target:null;
      if(target?.closest('input,textarea,[contenteditable="true"],[role="combobox"]')){event.stopPropagation();setContextOpen(false);return;}
      setContextWidgetId(target?.closest<HTMLElement>('[data-component-widget-id]')?.dataset.componentWidgetId);
    }:undefined}>
    {!editing&&errorNotice}
    {active&&<>
      <div className="runtime-analytics-filters component-page-filters">
        <div className="analytics-filter-heading"><span><FilterOutlined /> {active.filterFields.length?'全局筛选':'业务数据'}{editing?' · 草稿预览':''}</span><Button type="text" size="small" aria-label="刷新页面数据" onClick={refresh} loading={loadingData}>刷新</Button></div>
        {(!!active.filterFields.length||Object.keys(chartFilters).length>0)&&<Space wrap>{active.filterFields.map(field=><Select key={field} aria-label={labels[field]||field} placeholder={labels[field]||field} allowClear showSearch disabled={!data||Boolean(data.errors?.length)} value={filters[field]} options={(data?.filterOptions?.[field]||[]).map(value=>({label:value,value}))} onChange={value=>chooseFilter(field,value)} />)}<Button onClick={()=>{setFilters({});setChartFilters({});}}>清除筛选与联动</Button></Space>}
      </div>
      <div className="component-page-grid" onDragOver={event=>{if(editing)event.preventDefault();}} onDrop={event=>dropComponent(event)}>
        <Row gutter={[active.style?.componentGap??12,active.style?.componentGap??12]}>{active.widgets.map(item=><Col key={item.id} xs={24} lg={item.width}>
          <Card data-component-widget-id={item.id} style={{borderRadius:item.appearance?.radius??active.style?.cardRadius??8}}
            className={'component-page-widget component-page-widget-'+item.type+(editing?' analytics-editable-widget':'')+(editing&&panel==='widget'&&selected===item.id?' analytics-selected-widget':'')}
            onClick={event=>{if(editing&&!(event.target instanceof Element&&event.target.closest('input,textarea,button,a,[role="combobox"]')))selectWidget(item.id);}}
            title={editing?<button className="analytics-widget-select" type="button" draggable disabled={saving||Boolean(sourceEditor)} aria-label={'配置'+item.title}
              onClick={()=>selectWidget(item.id)}
              onKeyDown={event=>{if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();move(item.id,event.key==='ArrowUp'?-1:1);}}}
              onDragStart={event=>{selectWidget(item.id);event.dataTransfer.setData('component/id',item.id);event.dataTransfer.effectAllowed='move';}}
              onDragOver={event=>event.preventDefault()} onDrop={event=>dropComponent(event,item.id)}><HolderOutlined />{item.title}</button>:item.title} extra={chartFilters[item.id]&&<Button type="text" size="small" onClick={()=>setChartFilters(previous=>{const next={...previous};delete next[item.id];return next;})}>清除联动</Button>}>
            {item.appearance?.subtitle&&<p className="component-widget-subtitle">{item.appearance.subtitle}</p>}
            {renderWidget(item)}
          </Card>
        </Col>)}</Row>
      </div>
    </>}
  </main>;
  const footer = <>
    <div className="analytics-settings-status"><div className="analytics-settings-history">
      <span className={'analytics-save-status'+(dirty?' analytics-save-dirty':hasUnpublishedDraft?' analytics-save-pending':'')} role="status">
        {dirty?<><EditOutlined /> 未保存修改</>:hasUnpublishedDraft?<><ClockCircleOutlined /> 草稿待发布</>:<><CheckCircleOutlined /> 与线上版本一致</>}
      </span>
      <Space size={0}><Button type="text" size="small" aria-label="撤销" title="撤销" icon={<UndoOutlined />} disabled={!past.length||saving||Boolean(sourceEditor)} onClick={undo} /><Button type="text" size="small" aria-label="重做" title="重做" icon={<RedoOutlined />} disabled={!future.length||saving||Boolean(sourceEditor)} onClick={redo} /></Space>
    </div>{errorNotice}</div>
    <div className="analytics-settings-actions"><div>
      <Button icon={<SaveOutlined />} loading={saving} disabled={!dirty||saving||Boolean(sourceEditor)} onClick={()=>void save(false)}>保存草稿</Button>
      <Button type="primary" disabled={!publishable||saving||Boolean(sourceEditor)} onClick={()=>void checkPublish()}>{state?.publishedVersion?'发布新版本':'创建首个版本'}</Button>
    </div></div>
  </>;
  return <div style={{background:active?.style?.background||undefined}} data-card-border={active?.style?.cardBorder??'light'} className={'component-page analytics-workspace'+(editing?' analytics-workspace-configuring':'')}>
    {!sourceEditor&&<NavigationGuard enabled={dirty||saving} onBlocked={reportBlocked} />}
    <div className="analytics-workspace-body">
      <div className="component-page-preview">
        <div hidden={Boolean(sourceEditor)}>{admin?<Dropdown trigger={['contextMenu']} disabled={saving||Boolean(sourceEditor)} open={contextOpen} onOpenChange={setContextOpen} overlayClassName="analytics-context-menu" menu={{
          'aria-label':contextWidget?contextWidget.title+'配置菜单':'表单页面配置菜单',
          items:[
            ...buildAnalyticsContextMenu({widgetTitle:contextWidget?.title,pageLabel:'页面',sections}),
            {key:'business',popupClassName:'analytics-context-submenu',icon:<DatabaseOutlined />,label:'业务配置',disabled:!sourceIsBusiness,children:[
              {key:'source:form',label:'字段与录入'},{key:'source:filter',label:'列表与筛选'},{key:'source:flow',label:'流程与审批'},{key:'source:permission',label:'数据权限'},
            ]},
          ],onClick:({key})=>void openContextAction(key),
        }}>{canvas}</Dropdown>:canvas}</div>
        {sourceEditor&&sourceId&&<div className="component-page-source-editor"><Suspense fallback={<Spin />}><FormSettings formId={String(sourceId)} embedded initialTab={sourceEditor} onExit={()=>{setSourceEditor(undefined);refresh();}} onPublished={refresh} /></Suspense></div>}
      </div>
      {editing&&draft&&<div className="analytics-settings-page">
        <Inspector panel={panel} tab={widgetTab} definition={draft} selected={selected} fields={fields} forms={forms} roles={roles}
          disabled={saving} sourceOpen={Boolean(sourceEditor)} sourceIsBusiness={Boolean(sourceIsBusiness)}
          onPanel={setPanel} onTab={setWidgetTab} onChange={changeDraft} onAdd={add} onSelect={selectWidget}
          onBusiness={setSourceEditor} onClose={requestExit} footer={footer} />
      </div>}
    </div>
    <Drawer title={drilldown?.title} open={Boolean(drilldown)} width={960} onClose={()=>setDrilldown(undefined)}>
      {drilldown&&source&&<><Alert type="info" showIcon message={`${labels[drilldown.field]||drilldown.field}：${drilldown.value}`} style={{marginBottom:16}} /><DynamicPage formSlug={String(source.id)} embedded readOnly display="list" tableDensity={active?.style?.tableDensity} externalFilters={drilldown.filters} /></>}
    </Drawer>
    <Modal title={routeExit.current?'离开当前页面':'关闭页面配置'} open={exitPrompt} closable={!saving} maskClosable={false} onCancel={cancelExit}
      footer={<Space><Button disabled={saving} onClick={cancelExit}>继续配置</Button><Button danger disabled={saving} onClick={leaveEditor}>放弃未保存修改</Button><Button type="primary" loading={saving} onClick={async()=>{if(await save(false))leaveEditor();}}>保存并关闭</Button></Space>}>
      <Typography.Paragraph>当前修改尚未保存。保存草稿后可继续配置，查看者仍看到已发布版本。</Typography.Paragraph>
    </Modal>
    <Modal title={'发布页面'+(state?.publishedVersion?' · v'+(state.publishedVersion+1):'')} open={Boolean(publishCheck)} onCancel={()=>setPublishCheck(undefined)} maskClosable={false} closable={!saving}
      okText="确认发布" cancelText="继续配置" confirmLoading={saving} okButtonProps={{disabled:saving||Boolean(publishCheck?.errors.length)}} cancelButtonProps={{disabled:saving}} onOk={()=>void save(true)}>
      {publishCheck?.errors.length?<Alert type="error" showIcon message="发布检查未通过" description={<ul>{publishCheck.errors.map((item,index)=><li key={index}>{item}</li>)}</ul>} />:<Alert type="success" showIcon message="数据源、统计口径和组件检查通过" />}
      <Typography.Paragraph className="analytics-publish-summary">将发布 {draft?.widgets.length||0} 个组件。记录与统计沿用来源业务表单权限，字段和流程草稿保持独立。</Typography.Paragraph>
    </Modal>
  </div>;
}
