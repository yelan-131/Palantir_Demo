import AnalyticsResizeHandles, {type AnalyticsResizePatch} from './AnalyticsResizeHandles';
import {widgetInfoText} from './analyticsWidgetDescription';
import React from 'react';
import './analytics-paper.css';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import { Alert, Button, Card, DatePicker, Drawer, Empty, Popover, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { FilterOutlined, HolderOutlined, InfoCircleOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getAppProgramData } from '@/services/api';
import {dashboardStyleDefaults, widgetAppearance} from './analyticsWidgetAppearance';
import { analyticsDataSignature, analyticsDrilldownQuery, analyticsFieldLabel, formatAnalyticsValue as display, removeAnalyticsWidgetFilter } from './analyticsExploration';

import type { AnalyticsRow as Row, AnalyticsFilters as Filters, AnalyticsWidgetData as WidgetData, RuntimeAnalyticsMetric, RuntimeAnalyticsWidget, RuntimeAnalyticsDesign, RuntimeAnalyticsData } from './analyticsTypes';
export type { RuntimeAnalyticsDesign, RuntimeAnalyticsData } from './analyticsTypes';
export interface AnalyticsDataQuery { filters: Filters; widget_filters: Record<string, Filters> }

function thresholdColor(value: number | null | undefined, threshold?: string) {
  if (value == null || !threshold) return undefined;
  const match = threshold.match(/(红色|绿色|黄色|橙色|正常)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)%?/);
  if (!match) return undefined;
  const target = Number(match[3]);
  const pass = match[2] === '>=' ? value >= target : match[2] === '<=' ? value <= target : match[2] === '>' ? value > target : match[2] === '<' ? value < target : value === target;
  return pass ? ({ 红色: '#dc4446', 绿色: '#24986b', 黄色: '#ad8700', 橙色: '#c26b18', 正常: undefined })[match[1]] : undefined;
}

export default function AnalyticsDashboard({ program, payload, onSettings, loading, requestData, editing = false, hideHeader = false, selectedWidgetId, onSelectWidget, onReorder, onResize, refreshKey = 0 }: {
  program: { id: string; subtitle: string };
  payload: { analyticsDesign: RuntimeAnalyticsDesign; analyticsData?: RuntimeAnalyticsData };
  onSettings?: () => void; onReload?: () => void; loading?: boolean;
  requestData?: (query: AnalyticsDataQuery) => Promise<RuntimeAnalyticsData>;
  editing?: boolean;
  hideHeader?: boolean;
  selectedWidgetId?: string;
  onSelectWidget?: (id: string) => void;
  onReorder?: (source: string, target: string) => void;
  onResize?: (id:string,patch:AnalyticsResizePatch)=>void;
  refreshKey?: number;
}) {
  const navigate = useNavigate();
  const design = payload.analyticsDesign;
  const metrics = design.metrics || [];
  const widgets = design.widgets || [];
  const [data, setData] = React.useState(payload.analyticsData);
  const [filters, setFilters] = React.useState<Filters>({});
  const [widgetFilters, setWidgetFilters] = React.useState<Record<string, Filters>>({});
  const [draggedWidget, setDraggedWidget] = React.useState<string>();
  const [resizePreview,setResizePreview]=React.useState<{id:string;patch:AnalyticsResizePatch}>();
  const [dropTarget, setDropTarget] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [detail, setDetail] = React.useState<{ title: string; rows: Row[]; truncated?: boolean; loading?: boolean; query: AnalyticsDataQuery; datasetId?: string; widgetId: string }>();
  const [updatedAt, setUpdatedAt] = React.useState<Date>();
  const detailRequestId = React.useRef(0);
  const requestId = React.useRef(0);
  const lastRefresh = React.useRef<Record<string, number>>({});
  const filterKey = JSON.stringify({ filters, widgetFilters });
  const dataSignature = analyticsDataSignature(design);
  const previousPayload = React.useRef({programId: program.id, signature: dataSignature, data: payload.analyticsData});
  React.useEffect(() => {
    const previous = previousPayload.current;
    const schemaChanged = previous.programId !== program.id || previous.signature !== dataSignature;
    const filtered = Object.keys(filters).length || Object.keys(widgetFilters).length;
    // Keep the last matching result during presentation changes. Never inject
    // an unfiltered initial payload into an active analysis context.
    if (schemaChanged) { setData(filtered ? undefined : payload.analyticsData); setUpdatedAt(undefined); }
    else if (payload.analyticsData !== previous.data && payload.analyticsData && !filtered) setData(payload.analyticsData);
    previousPayload.current = {programId: program.id, signature: dataSignature, data: payload.analyticsData};
  }, [payload.analyticsData, dataSignature, program.id]);
  React.useEffect(() => { setFilters({}); setWidgetFilters({}); setDetail(undefined); detailRequestId.current++; return () => { detailRequestId.current++; }; }, [program.id]);
  React.useEffect(() => {
    setFilters(current => Object.fromEntries(Object.entries(current).filter(([key]) => design.globalFilters?.includes(key))));
    setWidgetFilters(current => Object.fromEntries(Object.entries(current).flatMap(([id, values]) => {
      const widget = widgets.find(item => item.id === id);
      const dataset = design.datasets?.find(item => item.id === widget?.datasetId);
      if (!dataset) return [];
      const allowed = [...(dataset.dimensions || []), ...(dataset.measures || [])];
      const conditions = Object.fromEntries(Object.entries(values).filter(([key]) => allowed.includes(key)));
      return Object.keys(conditions).length ? [[id, conditions]] : [];
    })));
  }, [design]);
  const fetchData = React.useCallback(async (query: AnalyticsDataQuery) => {
    if (requestData) return requestData(query);
    const result = await getAppProgramData(program.id, 500, { filters: JSON.stringify(query.filters), widget_filters: JSON.stringify(query.widget_filters) });
    return (result.data.analyticsData || {}) as RuntimeAnalyticsData;
  }, [program.id, requestData]);

  const reload = React.useCallback(async (onlyDatasets?: Set<string>) => {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const next = await fetchData({filters, widget_filters: widgetFilters});
      if (id !== requestId.current) return;
      setData(previous => {
        if (!onlyDatasets || !previous || !next) return next;
        const nextWidgets = { ...previous.widgets };
        const nextMetrics = { ...previous.metricValues };
        for (const widget of widgets) if (onlyDatasets.has(widget.datasetId || '') && next.widgets?.[widget.id]) nextWidgets[widget.id] = next.widgets[widget.id];
        for (const metric of metrics) if (onlyDatasets.has(metric.datasetId || '')) nextMetrics[metric.id] = next.metricValues?.[metric.id] ?? null;
        return { ...next, widgets: nextWidgets, metricValues: nextMetrics };
      });
      setError('');
      setUpdatedAt(new Date());
    } catch { if (id === requestId.current) { setData(undefined); setError('看板读取失败，请检查数据源、权限或网络后重试。'); } }
    finally { if (id === requestId.current) setBusy(false); }
  }, [fetchData, filterKey, design, refreshKey]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 150);
    return () => { window.clearTimeout(timer); requestId.current++; };
  }, [reload]);
  React.useEffect(() => {
    lastRefresh.current = {};
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const due = new Set<string>();
      const now = Date.now();
      for (const dataset of design.datasets || []) {
        if (dataset.refreshMode === 'manual') continue;
        const interval = dataset.refreshMode === 'scheduled' ? Math.max(10, dataset.refreshInterval || 60) : 30;
        if (now - (lastRefresh.current[dataset.id] || now) >= interval * 1000) { due.add(dataset.id); lastRefresh.current[dataset.id] = now; }
        else if (!lastRefresh.current[dataset.id]) lastRefresh.current[dataset.id] = now;
      }
      if (due.size) void reload(due);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const interact = (widget: RuntimeAnalyticsWidget, name: string) => {
    if (editing) { onSelectWidget?.(widget.id); return; }
    if (!widget.dimension) return;
    const links = (design.interactions || []).filter(link => link.sourceWidgetId === widget.id);
    if (!links.length && widget.interaction === 'none') return;
    const actions = links.length ? links : [{ sourceWidgetId: widget.id, targetWidgetId: widget.id, action: widget.interaction || 'none' }];
    for (const link of actions) {
      const target = widgets.find(item => item.id === link.targetWidgetId);
      if (!target) continue;
      const conditions = { [widget.dimension]: name };
      if (link.action === 'filter') setWidgetFilters(current => ({ ...current, [target.id]: { ...current[target.id], ...conditions } }));
      if (link.action === 'drilldown') {
        const id = ++detailRequestId.current;
        const query = analyticsDrilldownQuery({filters, widget_filters: widgetFilters}, target.id, widget.dimension, name);
        const context = {title: `${target.title} · ${name}`, query, datasetId: target.datasetId, widgetId: target.id};
        setDetail({...context, rows: [], loading: true});
        void fetchData(query).then(response => {
          if (id !== detailRequestId.current) return;
          const result = response.widgets?.[target.id] as WidgetData | undefined;
          setDetail({...context, rows: result?.rows || [], truncated: result?.truncated});
        }).catch(() => { if(id === detailRequestId.current) {setDetail(undefined); setError('明细读取失败，请重试。');} });
      }
      if (link.action === 'navigate') {
        const code = data?.datasetSources?.[target.datasetId || ''];
        if (code) {
          const matchingRows = (data?.widgets?.[target.id]?.rows || []).filter(row => String(row[widget.dimension!] ?? '未填写') === name);
          const recordId = matchingRows.length === 1 ? matchingRows[0]._recordId : undefined;
          navigate(`/dynamic/${encodeURIComponent(code)}${recordId ? `?recordId=${encodeURIComponent(String(recordId))}` : ''}`);
        }
      }
    }
  };
  const style: Record<string, unknown> = {...dashboardStyleDefaults, ...design.style};
  const boundedStyle = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const paperStyle = {
    '--analytics-paper': style.background || dashboardStyleDefaults.background,
    '--analytics-grid-size': `${boundedStyle(style.gridSize, 44, 16, 88)}px`,
    '--analytics-card-opacity': boundedStyle(style.cardOpacity, 0.78, 0.3, 1),
    '--analytics-card-blur': `${boundedStyle(style.cardBlur, 12, 0, 24)}px`,
  } as React.CSSProperties;
  const dark = style.preset === 'dark';

  const labelFor = (field: string, datasetId?: string) => analyticsFieldLabel(data, field, datasetId);
  const metricDefinition = (metric: RuntimeAnalyticsMetric, widgetId: string) => <div className="analytics-metric-definition" key={metric.id}>
    <strong>{metric.name}</strong>{metric.description && <p>{metric.description}</p>}<dl>
      <dt>计算口径</dt><dd><code>{metric.expression || '未配置'}</code></dd>
      <dt>数据来源</dt><dd>{design.datasets?.find(dataset => dataset.id === metric.datasetId)?.name || '未配置'}</dd>
      <dt>统计范围</dt><dd>{[...Object.entries(filters), ...Object.entries(widgetFilters[widgetId] || {})].map(([key,value]) => `${labelFor(key, metric.datasetId)}：${Array.isArray(value) ? value.join(' 至 ') : value}`).join('；') || '全部授权数据'}</dd>
      {metric.threshold && <><dt>阈值规则</dt><dd>{metric.threshold}</dd></>}
      <dt>口径复用</dt><dd>{metric.sharedMetricId && <>共享指标 v{metric.sharedMetricVersion} · </>}本看板 {widgets.filter(widget => widget.metricIds?.includes(metric.id)).length} 个组件引用</dd>
    </dl>
  </div>;
  const filterValue = (value: Filters[string]) => Array.isArray(value) ? value.join(' 至 ') : value;
  const hasFilters = Object.keys(filters).length > 0 || Object.values(widgetFilters).some(values => Object.keys(values).length > 0);
  const table = (rows: Row[], fields?: string[], widget?: RuntimeAnalyticsWidget, datasetId = widget?.datasetId) => {
    const appearance = widget ? widgetAppearance(widget,style) : undefined;
    const available = fields?.length ? fields : Array.from(new Set(rows.flatMap(row => Object.keys(row)))).filter(key => !key.startsWith('_'));
    const keys = appearance?.tableColumns?.length ? appearance.tableColumns.filter(key=>available.includes(key)) : available;
    const density = appearance?.tableDensity || style.tableDensity;
    const rankMetric = widget?.metricIds?.[0];
    const ranked = widget?.type==='rank-table' && rankMetric ? [...rows].sort((a,b)=>{
      const av=a[rankMetric],bv=b[rankMetric];
      if(av==null)return bv==null?0:1;if(bv==null)return -1;
      return (Number(av)-Number(bv))*(appearance?.rankAscending?1:-1);
    }) : rows;
    const visibleRows = widget?.type==='rank-table' && appearance?.rankLimit ? ranked.slice(0,appearance.rankLimit) : ranked;
    const columns = keys.map(key => ({ title: key === 'name' && widget?.dimension ? labelFor(widget.dimension, datasetId) : metrics.find(metric => metric.id === key)?.name || labelFor(key, datasetId), dataIndex: key, key, align: appearance?.tableAlign, width:appearance?.tableColumnWidth,onHeaderCell:()=>({style:{textAlign:(appearance?.tableHeaderAlign || appearance?.tableAlign) as React.CSSProperties['textAlign']}}), ellipsis:!appearance?.tableWrap, render: (value:unknown) => display(value, metrics.find(metric => metric.id === key)) }));
    return <div className="analytics-table-style" style={{'--analytics-table-font-size':`${appearance?.tableFontSize || 12}px`,'--analytics-table-text-color':appearance?.chartTextColor,'--analytics-table-header-color':appearance?.tableHeaderColor,fontFamily:appearance?.chartFontFamily} as React.CSSProperties}><Table<Row> showHeader={appearance?.showTableHeader} bordered={appearance?.tableBordered} rowClassName={(_,index)=>appearance?.tableStriped && index%2 ? 'analytics-table-striped-row' : ''} onRow={row => ({onClick: () => { if (widget) interact(widget, String((widget.type === 'rank-table' ? row.name : row[widget.dimension || '']) ?? '未填写')); }})} size={density === 'comfortable' ? 'large' : density === 'compact' ? 'small' : 'middle'} columns={appearance?.tableRowNumbers ? [{title:'序号',key:'_rowNumber',width:60,render:(_,row)=>Number(row._rowNumber)},...columns] : columns} dataSource={visibleRows.map((row, index) => ({ ...row, key: index,_rowNumber:index+1 }))} pagination={appearance?.tablePagination===false ? false : { pageSize: appearance?.tablePageSize || 10, hideOnSinglePage: true, showSizeChanger: false }} scroll={{ x: appearance?.tableColumnWidth ? keys.length*appearance.tableColumnWidth+(appearance.tableRowNumbers?60:0) : true,y:appearance?.tableScrollHeight }} /></div>;
  };
  const filterControls = <Space wrap>{(design.globalFilters || []).map(key => key === 'dateRange' ? <DatePicker.RangePicker key={key} value={Array.isArray(filters[key]) ? [dayjs(filters[key][0]), dayjs(filters[key][1])] : null} onChange={(_, dates) => setFilters(current => { const next = {...current}; if (dates[0] && dates[1]) next[key] = dates as [string,string]; else delete next[key]; return next; })} /> : <Select key={key} allowClear showSearch placeholder={labelFor(key)} aria-label={labelFor(key)} style={{minWidth: 150}} value={typeof filters[key] === 'string' ? filters[key] : undefined} options={(data?.filterOptions?.[key] || []).map(value => ({value, label: value}))} onChange={value => setFilters(current => { const next = {...current}; if (value != null) next[key] = value; else delete next[key]; return next; })} />)}</Space>;
  return <div className={`app-program-page runtime-analytics-page ${dark ? 'runtime-analytics-dark' : ''}`} style={paperStyle}>
    {!hideHeader && <div className="app-program-header"><Typography.Text type="secondary">{program.subtitle}</Typography.Text><Space><Button title="刷新看板" aria-label="刷新看板" icon={<ReloadOutlined />} loading={busy || loading} onClick={() => { void reload(); }}>刷新</Button>{onSettings && <Button title="看板配置" aria-label="看板配置" icon={<SettingOutlined />} onClick={onSettings}>看板配置</Button>}</Space></div>}
    {error && <Alert type="error" message={error} showIcon />}
    {!!data?.errors?.length && <Alert type="warning" message="部分配置不可用" description={data.errors.join('；')} showIcon />}
    <div className={`runtime-analytics-layout runtime-filter-${design.globalFilters?.length ? String(style.filterTheme || 'toolbar') : 'toolbar'}`}>
      {!!design.globalFilters?.length && <div className="runtime-analytics-filters"><div className="analytics-filter-heading"><span><FilterOutlined /> 全局筛选</span>{updatedAt && <small>数据更新于 {updatedAt.toLocaleTimeString('zh-CN', {hour12: false})}</small>}<Button size="small" type="text" onClick={() => { setFilters({}); setWidgetFilters({}); }}>清除筛选与联动</Button></div>{filterControls}</div>}
      <div className="analytics-analysis-results">
      {hasFilters && <div className="analytics-active-filters" aria-label="当前分析条件"><span>当前分析条件</span><div>{Object.entries(filters).map(([field,value]) => <Tag key={field} closable onClose={() => setFilters(current => {const next={...current};delete next[field];return next;})}>全局 · {labelFor(field)}：{filterValue(value)}</Tag>)}{Object.entries(widgetFilters).flatMap(([id,conditions]) => Object.entries(conditions).map(([field,value]) => <Tag key={id+'-'+field} closable onClose={() => setWidgetFilters(current => removeAnalyticsWidgetFilter(current,id,field))}>{widgets.find(widget => widget.id === id)?.title || id} · {labelFor(field,widgets.find(widget => widget.id === id)?.datasetId)}：{filterValue(value)}</Tag>))}</div></div>}
      <Spin spinning={busy}><div className="runtime-analytics-canvas" style={{gap: Number(style.componentGap ?? 16)}}>
        {widgets.map(widget => {
          const appearance = {...widgetAppearance(widget,style),...(resizePreview?.id===widget.id?resizePreview.patch:{}),infoText:widgetInfoText(widget,design)};
          const palette = appearance.colors;
          const result = data?.widgets?.[widget.id];
          const ids = widget.metricIds || [];
          const boundMetrics = ids.map(id=>metrics.find(metric=>metric.id===id)).filter((metric): metric is RuntimeAnalyticsMetric => !!metric);
          const widgetMetrics = ['line','bar'].includes(widget.type) && appearance.seriesMode==='single' ? boundMetrics.slice(0,1) : boundMetrics;
          const series = result?.series || [];
          const horizontal = widget.type === 'bar' && appearance.horizontal;
          const categoryAxis = {type: 'category', nameLocation: 'middle', nameGap: 30, name: labelFor(widget.dimension || '', widget.datasetId), axisLine: {lineStyle: {color: dark ? '#34505e' : '#dde6eb'}}, axisTick: {show: false}, axisLabel: {show: appearance.showAxisLabels, color: appearance.chartTextColor || (dark ? '#b6c9d4' : '#7b8d99'), fontSize: appearance.axisLabelFontSize, rotate: appearance.axisLabelRotate, hideOverlap: true}, data: series.map(point => point.name)};
          const valueAxis = {type: 'value', splitLine: {show: appearance.showGrid, lineStyle: {color: dark ? '#29404e' : '#edf1f4', type: appearance.gridLineType}}, axisLabel: {show: appearance.showAxisLabels, fontSize: appearance.axisLabelFontSize,color:appearance.chartTextColor}, nameTextStyle: {fontSize: 11, color: appearance.chartTextColor || (dark ? '#b6c9d4' : '#7b8d99')}, name: widgetMetrics.map(metric => metric.name + (metric.format === 'percent' ? '(%)' : '')).join(' / ')};
          return <Card key={widget.id} data-analytics-widget-id={widget.id} className={`runtime-analytics-widget runtime-analytics-widget-${widget.width || 'half'} ${widget.type === 'metric-card' ? `analytics-metric-group ${appearance.groupBackground ? 'analytics-metric-group-filled' : ''}` : ''} ${editing ? 'analytics-editable-widget' : ''} ${appearance.cardHeight ? 'analytics-widget-sized' : ''} ${dropTarget === widget.id ? 'analytics-widget-drop-target' : ''} ${selectedWidgetId === widget.id ? 'analytics-selected-widget' : ''}`}
            onClickCapture={editing ? () => { onSelectWidget?.(widget.id); } : undefined}
            onDragOver={editing ? event => { if (!draggedWidget || draggedWidget === widget.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(widget.id); } : undefined}
            onDrop={editing ? event => { event.preventDefault(); const source = event.dataTransfer.getData('application/x-analytics-widget'); if (source) onReorder?.(source, widget.id); setDraggedWidget(undefined); setDropTarget(undefined); } : undefined}
            title={!appearance.showTitle ? undefined : <div className="analytics-widget-heading" style={{textAlign:appearance.titleAlign as React.CSSProperties['textAlign'],fontSize:appearance.titleFontSize,fontFamily:appearance.titleFontFamily,color:appearance.titleColor,fontWeight:appearance.titleWeight,fontStyle:appearance.titleItalic?'italic':'normal',paddingBottom:appearance.titleGap}} >{editing ? <button type="button" className="analytics-widget-select" style={{textAlign:'inherit',justifyContent:appearance.titleAlign==='center'?'center':appearance.titleAlign==='right'?'flex-end':'flex-start'}} draggable title="拖拽调整组件顺序；也可按 Alt + 方向键调整" onDragEnd={() => { setDraggedWidget(undefined); setDropTarget(undefined); }} onKeyDown={event => { if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const index = widgets.findIndex(item => item.id === widget.id); const target = widgets[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) onReorder?.(widget.id, target.id); }} aria-label={`配置${widget.title}`} onClick={() => onSelectWidget?.(widget.id)} onDragStart={event => { setDraggedWidget(widget.id); onSelectWidget?.(widget.id); event.dataTransfer.setData('application/x-analytics-widget', widget.id); event.dataTransfer.effectAllowed = 'move'; }}><HolderOutlined />{widget.title}</button> : widget.title}{appearance.subtitle && <small>{appearance.subtitle}</small>}</div>}
            style={{height:appearance.cardHeight, '--analytics-widget-columns':appearance.widthColumns, '--analytics-card-radius': `${appearance.radius}px`, '--analytics-card-opacity': appearance.cardOpacity, '--analytics-card-blur': `${appearance.cardBlur}px`, '--analytics-metric-title-size': `${appearance.titleFontSize}px`, '--analytics-metric-value-size': `${appearance.valueFontSize}px`, '--analytics-metric-padding': `${appearance.contentPadding}px`, '--analytics-metric-align': appearance.contentAlign, '--analytics-metric-columns': appearance.metricColumns ? `repeat(${appearance.metricColumns}, minmax(0, 1fr))` : undefined, borderRadius: appearance.radius, borderColor: editing && selectedWidgetId === widget.id ? undefined : style.cardBorder === 'none' ? 'transparent' : style.cardBorder === 'strong' ? '#2c6e84' : undefined, background: dark ? '#162632' : undefined, color: dark ? '#e4edf3' : undefined} as React.CSSProperties} extra={<Space size={4}>{widget.type !== 'metric-card' && appearance.showMetricInfo && (!!widgetMetrics.length || !!appearance.infoText) && <Popover trigger="click" placement="bottomRight" title="指标说明" content={<div className="analytics-metric-popover">{appearance.infoText && <p className="analytics-widget-info-text">{appearance.infoText}</p>}{widgetMetrics.map(metric => metricDefinition(metric,widget.id))}</div>}><Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label={'查看'+widget.title+'指标说明'} /></Popover>}{widgetFilters[widget.id] && <Button size="small" onClick={() => setWidgetFilters(current => removeAnalyticsWidgetFilter(current,widget.id))}>清除联动</Button>}</Space>}>
            {widget.type === 'metric-card' ? <div className="runtime-analytics-metrics" style={{fontFamily:appearance.chartFontFamily,gap:appearance.metricGap}}>{widgetMetrics.map(metric => <div key={metric.id} style={{borderRadius:appearance.radius}}><div className="analytics-kpi-label" style={{fontSize:appearance.metricLabelSize,marginBottom:appearance.metricLabelGap}}>{appearance.showMetricLabel && <span style={{fontSize:appearance.metricLabelSize}}>{metric.name}</span>}{appearance.showMetricInfo && <Popover trigger="click" placement="bottomLeft" content={<>{appearance.infoText && <p className="analytics-widget-info-text">{appearance.infoText}</p>}{metricDefinition(metric,widget.id)}</>}><Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label={'查看'+metric.name+'口径'} /></Popover>}</div><strong title={metric.threshold} style={{color: thresholdColor(result?.metricValues[metric.id], metric.threshold) || appearance.metricValueColor || (widget.appearance?.palette ? palette[0] : undefined)}}>{display(result?.metricValues[metric.id], metric)}</strong></div>)}</div> : widget.type === 'detail-table' ? table(result?.rows || [], undefined, widget) : widget.type === 'rank-table' ? table(series.map(point => ({...point})), ['name', ...ids], widget) : !series.length ? <Empty description="当前筛选下没有数据" /> : <ReactECharts notMerge style={{height: appearance.height}} option={{ animation:appearance.animate,dataZoom:widget.type!=='pie' && appearance.enableZoom?[{type:'inside',filterMode:'none',...(horizontal?{yAxisIndex:0}:{xAxisIndex:0})}]:[], backgroundColor: 'transparent', textStyle: {fontFamily:appearance.chartFontFamily,color:appearance.chartTextColor || (dark ? '#e4edf3' : '#536775')}, color: palette, tooltip: {show:appearance.showTooltip,trigger: widget.type === 'pie' ? 'item' : 'axis', confine: true, backgroundColor: dark ? '#203642' : '#fff', borderColor: dark ? '#34505e' : '#e1e9ee', textStyle: {color: dark ? '#e4edf3' : '#3f5663', fontSize: 12}, extraCssText: 'box-shadow:0 4px 18px rgba(25,50,65,.08);border-radius:8px;'}, legend: {show:appearance.showLegend, orient: appearance.legendOrient === 'auto' ? (['left','right'].includes(appearance.legendPosition) ? 'vertical' : 'horizontal') : appearance.legendOrient, itemGap: appearance.legendItemGap, selectedMode: appearance.legendSelectable, ...(appearance.legendPosition === 'bottom' ? {bottom:0,left:'center'} : appearance.legendPosition === 'left' ? {left:0,top:'middle'} : appearance.legendPosition === 'right' ? {right:0,top:'middle'} : {top:0,left:'center'}), icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: {fontSize: appearance.legendFontSize, color: appearance.chartTextColor || (dark ? '#e4edf3' : '#718592')}}, grid: {left: appearance.gridLeft ?? (appearance.showLegend && appearance.legendPosition === 'left' ? 125 : 55), right: appearance.gridRight ?? (appearance.showLegend && appearance.legendPosition === 'right' ? 125 : 25), bottom: appearance.gridBottom ?? (appearance.showLegend && appearance.legendPosition === 'bottom' ? 75 : 55), top: appearance.gridTop ?? 40, containLabel: true}, ...(widget.type === 'pie' ? {} : {xAxis: horizontal ? valueAxis : categoryAxis, yAxis: horizontal ? categoryAxis : valueAxis}), series: widget.type === 'pie' ? [{type: 'pie', roseType:appearance.pieRose?'radius':false,startAngle:appearance.pieStartAngle, radius: [`${appearance.pieInnerRadius}%`, `${appearance.pieOuterRadius}%`], center: [`${appearance.pieCenterX}%`, `${appearance.pieCenterY}%`], avoidLabelOverlap: true, itemStyle: {borderRadius: 3, borderColor: dark ? '#162632' : '#fff', borderWidth: 2}, label: {show:appearance.showLabels,position:appearance.labelPosition === 'inside' ? 'inside' : 'outside',fontSize: appearance.labelFontSize,formatter:(point:{name:string;value:unknown;percent:number}) => `${point.name}\n${appearance.pieLabelContent==='percent'?`${point.percent}%`:appearance.pieLabelContent==='both'?`${display(point.value,widgetMetrics[0])} (${point.percent}%)`:display(point.value,widgetMetrics[0])}`}, data: series.map(point => ({name: point.name, value: point[ids[0]]}))}] : widgetMetrics.map(metric => ({name: metric.name, type: widget.type === 'line' ? 'line' : 'bar', smooth: widget.type === 'line' && appearance.smooth, label:{show:appearance.showLabels,position:appearance.labelPosition === 'outside' ? (horizontal?'right':'top') : appearance.labelPosition,fontSize:appearance.labelFontSize,formatter:(point:{value:unknown}) => display(point.value,metric)}, connectNulls: appearance.connectNulls, step:widget.type==='line' && appearance.stepLine ? 'middle' : false, barGap:`${appearance.barGap}%`,barMaxWidth: appearance.barWidth, itemStyle: {borderRadius: widget.type === 'line' ? 0 : horizontal ? [0,3,3,0] : [3,3,0,0]}, showSymbol:appearance.showSymbol,symbol:appearance.symbolShape,symbolSize: appearance.symbolSize, stack:appearance.stacked ? 'total' : undefined, areaStyle:widget.type==='line' && appearance.areaFill ? {opacity:.18} : undefined, lineStyle: {width: appearance.lineWidth,type:appearance.lineType}, data: series.map(point => point[metric.id])})) }} onEvents={{ click: (event: {name: string}) => interact(widget, event.name) }} />}
            {editing && onResize && <AnalyticsResizeHandles title={widget.title} columns={appearance.widthColumns} height={appearance.cardHeight} chartHeight={appearance.height} isChart={['bar','line','pie'].includes(widget.type)} onPreview={patch=>setResizePreview(patch?{id:widget.id,patch}:undefined)} onCommit={patch=>onResize(widget.id,patch)} />}
            {result?.truncated && <Typography.Text type="secondary">显示前 500 项，共 {result.total} 条记录；汇总按完整授权数据计算。</Typography.Text>}
          </Card>;
        })}
      </div></Spin>
      </div>
    </div>
    <Drawer title={detail?.title} open={!!detail} width={900} onClose={() => { detailRequestId.current++; setDetail(undefined); }}>{detail && <><div className="analytics-drilldown-context"><strong>本次明细条件</strong><p>{[...Object.entries(detail.query.filters),...Object.entries(detail.query.widget_filters[detail.widgetId] || {})].map(([field,value]) => labelFor(field,detail.datasetId)+'：'+filterValue(value)).join('；') || '全部授权数据'}</p><small>沿用打开明细时的全局筛选和目标组件联动条件。</small></div>{detail.truncated && <Alert type="info" message="明细受 500 条展示上限限制" />}<Spin spinning={!!detail.loading}>{table(detail.rows,undefined,undefined,detail.datasetId)}</Spin></>}</Drawer>
  </div>;
}
