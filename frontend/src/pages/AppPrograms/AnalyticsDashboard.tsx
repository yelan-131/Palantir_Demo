import React from 'react';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import { Alert, Button, Card, DatePicker, Drawer, Empty, Popover, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { FilterOutlined, HolderOutlined, InfoCircleOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getAppProgramData } from '@/services/api';
import {widgetAppearance} from './analyticsWidgetAppearance';
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

export default function AnalyticsDashboard({ program, payload, onSettings, loading, requestData, editing = false, hideHeader = false, selectedWidgetId, onSelectWidget, onReorder, refreshKey = 0 }: {
  program: { id: string; subtitle: string };
  payload: { analyticsDesign: RuntimeAnalyticsDesign; analyticsData?: RuntimeAnalyticsData };
  onSettings?: () => void; onReload?: () => void; loading?: boolean;
  requestData?: (query: AnalyticsDataQuery) => Promise<RuntimeAnalyticsData>;
  editing?: boolean;
  hideHeader?: boolean;
  selectedWidgetId?: string;
  onSelectWidget?: (id: string) => void;
  onReorder?: (source: string, target: string) => void;
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
  const style = design.style || {};
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
    const keys = fields?.length ? fields : Array.from(new Set(rows.flatMap(row => Object.keys(row)))).filter(key => !key.startsWith('_'));
    return <Table<Row> onRow={row => ({onClick: () => { if (widget) interact(widget, String((widget.type === 'rank-table' ? row.name : row[widget.dimension || '']) ?? '未填写')); }})} size={style.tableDensity === 'comfortable' ? 'large' : style.tableDensity === 'standard' ? 'middle' : 'small'} columns={keys.map(key => ({ title: key === 'name' && widget?.dimension ? labelFor(widget.dimension, datasetId) : metrics.find(metric => metric.id === key)?.name || labelFor(key, datasetId), dataIndex: key, key, render: value => display(value, metrics.find(metric => metric.id === key)) }))} dataSource={rows.map((row, index) => ({ ...row, key: index }))} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: true }} />;
  };
  const filterControls = <Space wrap>{(design.globalFilters || []).map(key => key === 'dateRange' ? <DatePicker.RangePicker key={key} value={Array.isArray(filters[key]) ? [dayjs(filters[key][0]), dayjs(filters[key][1])] : null} onChange={(_, dates) => setFilters(current => { const next = {...current}; if (dates[0] && dates[1]) next[key] = dates as [string,string]; else delete next[key]; return next; })} /> : <Select key={key} allowClear showSearch placeholder={labelFor(key)} aria-label={labelFor(key)} style={{minWidth: 150}} value={typeof filters[key] === 'string' ? filters[key] : undefined} options={(data?.filterOptions?.[key] || []).map(value => ({value, label: value}))} onChange={value => setFilters(current => { const next = {...current}; if (value != null) next[key] = value; else delete next[key]; return next; })} />)}<Button onClick={() => { setFilters({}); setWidgetFilters({}); }}>清除筛选与联动</Button></Space>;
  return <div className={`app-program-page runtime-analytics-page ${dark ? 'runtime-analytics-dark' : ''}`}>
    {!hideHeader && <div className="app-program-header"><Typography.Text type="secondary">{program.subtitle}</Typography.Text><Space><Button title="刷新看板" aria-label="刷新看板" icon={<ReloadOutlined />} loading={busy || loading} onClick={() => { void reload(); }}>刷新</Button>{onSettings && <Button title="看板配置" aria-label="看板配置" icon={<SettingOutlined />} onClick={onSettings}>看板配置</Button>}</Space></div>}
    {error && <Alert type="error" message={error} showIcon />}
    {!!data?.errors?.length && <Alert type="warning" message="部分配置不可用" description={data.errors.join('；')} showIcon />}
    <div className={`runtime-analytics-layout runtime-filter-${design.globalFilters?.length ? String(style.filterTheme || 'toolbar') : 'toolbar'}`}>
      {!!design.globalFilters?.length && <div className="runtime-analytics-filters"><div className="analytics-filter-heading"><span><FilterOutlined /> 全局筛选</span>{updatedAt && <small>数据更新于 {updatedAt.toLocaleTimeString('zh-CN', {hour12: false})}</small>}</div>{filterControls}</div>}
      <div className="analytics-analysis-results">
      {hasFilters && <div className="analytics-active-filters" aria-label="当前分析条件"><span>当前分析条件</span><div>{Object.entries(filters).map(([field,value]) => <Tag key={field} closable onClose={() => setFilters(current => {const next={...current};delete next[field];return next;})}>全局 · {labelFor(field)}：{filterValue(value)}</Tag>)}{Object.entries(widgetFilters).flatMap(([id,conditions]) => Object.entries(conditions).map(([field,value]) => <Tag key={id+'-'+field} closable onClose={() => setWidgetFilters(current => removeAnalyticsWidgetFilter(current,id,field))}>{widgets.find(widget => widget.id === id)?.title || id} · {labelFor(field,widgets.find(widget => widget.id === id)?.datasetId)}：{filterValue(value)}</Tag>))}</div></div>}
      <Spin spinning={busy}><div className="runtime-analytics-canvas" style={{background: String(style.background || '#f6f8fa'), gap: Number(style.componentGap ?? 12), padding: 12}}>
        {widgets.map(widget => {
          const appearance = widgetAppearance(widget,style);
          const palette = appearance.colors;
          const result = data?.widgets?.[widget.id];
          const ids = widget.metricIds || [];
          const widgetMetrics = metrics.filter(metric => ids.includes(metric.id));
          const series = result?.series || [];
          return <Card key={widget.id} data-analytics-widget-id={widget.id} className={`runtime-analytics-widget runtime-analytics-widget-${widget.width || 'half'} ${widget.type === 'metric-card' ? 'analytics-metric-group' : ''} ${editing ? 'analytics-editable-widget' : ''} ${dropTarget === widget.id ? 'analytics-widget-drop-target' : ''} ${selectedWidgetId === widget.id ? 'analytics-selected-widget' : ''}`}
            onClickCapture={editing ? () => { onSelectWidget?.(widget.id); } : undefined}
            onDragOver={editing ? event => { if (!draggedWidget || draggedWidget === widget.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(widget.id); } : undefined}
            onDrop={editing ? event => { event.preventDefault(); const source = event.dataTransfer.getData('application/x-analytics-widget'); if (source) onReorder?.(source, widget.id); setDraggedWidget(undefined); setDropTarget(undefined); } : undefined}
            title={<div className="analytics-widget-heading">{editing ? <button type="button" className="analytics-widget-select" draggable title="拖拽调整组件顺序；也可按 Alt + 方向键调整" onDragEnd={() => { setDraggedWidget(undefined); setDropTarget(undefined); }} onKeyDown={event => { if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const index = widgets.findIndex(item => item.id === widget.id); const target = widgets[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) onReorder?.(widget.id, target.id); }} aria-label={`配置${widget.title}`} onClick={() => onSelectWidget?.(widget.id)} onDragStart={event => { setDraggedWidget(widget.id); onSelectWidget?.(widget.id); event.dataTransfer.setData('application/x-analytics-widget', widget.id); event.dataTransfer.effectAllowed = 'move'; }}><HolderOutlined />{widget.title}</button> : widget.title}{appearance.subtitle && <small>{appearance.subtitle}</small>}</div>}
            style={{borderRadius: appearance.radius, borderColor: editing && selectedWidgetId === widget.id ? undefined : style.cardBorder === 'none' ? 'transparent' : style.cardBorder === 'strong' ? '#2c6e84' : undefined, background: dark ? '#162632' : undefined, color: dark ? '#e4edf3' : undefined}} extra={<Space size={4}>{widget.type !== 'metric-card' && !!widgetMetrics.length && <Popover trigger="click" placement="bottomRight" title="指标说明" content={<div className="analytics-metric-popover">{widgetMetrics.map(metric => metricDefinition(metric,widget.id))}</div>}><Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label={'查看'+widget.title+'指标说明'} /></Popover>}{widgetFilters[widget.id] && <Button size="small" onClick={() => setWidgetFilters(current => removeAnalyticsWidgetFilter(current,widget.id))}>清除联动</Button>}</Space>}>
            {widget.type === 'metric-card' ? <div className="runtime-analytics-metrics">{widgetMetrics.map(metric => <div key={metric.id} style={{borderRadius:appearance.radius}}><div className="analytics-kpi-label"><span>{metric.name}</span><Popover trigger="click" placement="bottomLeft" content={metricDefinition(metric,widget.id)}><Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label={'查看'+metric.name+'口径'} /></Popover></div><strong title={metric.threshold} style={{color: thresholdColor(result?.metricValues[metric.id], metric.threshold) || (widget.appearance?.palette ? palette[0] : undefined)}}>{display(result?.metricValues[metric.id], metric)}</strong></div>)}</div> : widget.type === 'detail-table' ? table(result?.rows || [], undefined, widget) : widget.type === 'rank-table' ? table(series.map(point => ({...point})), ['name', ...ids], widget) : !series.length ? <Empty description="当前筛选下没有数据" /> : <ReactECharts style={{height: appearance.height}} option={{ backgroundColor: 'transparent', textStyle: {color: dark ? '#e4edf3' : '#536775'}, color: palette, tooltip: {trigger: widget.type === 'pie' ? 'item' : 'axis', confine: true, backgroundColor: dark ? '#203642' : '#fff', borderColor: dark ? '#34505e' : '#e1e9ee', textStyle: {color: dark ? '#e4edf3' : '#3f5663', fontSize: 12}, extraCssText: 'box-shadow:0 4px 18px rgba(25,50,65,.08);border-radius:8px;'}, legend: {show:appearance.showLegend, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: {fontSize: 11, color: dark ? '#e4edf3' : '#718592'}}, grid: {left: 55, right: 25, bottom: 55, top: 40, containLabel: true}, ...(widget.type === 'pie' ? {} : {xAxis: {type: 'category', nameLocation: 'middle', nameGap: 30, name: labelFor(widget.dimension || '', widget.datasetId), axisLine: {lineStyle: {color: dark ? '#34505e' : '#dde6eb'}}, axisTick: {show: false}, axisLabel: {color: dark ? '#b6c9d4' : '#7b8d99', fontSize: 11, hideOverlap: true}, data: series.map(point => point.name)}, yAxis: {type: 'value', splitLine: {lineStyle: {color: dark ? '#29404e' : '#edf1f4', type: 'dashed'}}, axisLabel: {fontSize: 11}, nameTextStyle: {fontSize: 11, color: dark ? '#b6c9d4' : '#7b8d99'}, name: widgetMetrics.map(metric => metric.name + (metric.format === 'percent' ? '(%)' : '')).join(' / ')}}), series: widget.type === 'pie' ? [{type: 'pie', radius: ['48%', '70%'], center: ['50%', '55%'], avoidLabelOverlap: true, itemStyle: {borderRadius: 3, borderColor: dark ? '#162632' : '#fff', borderWidth: 2}, label: {show:appearance.showLabels,fontSize: 11,formatter:(point:{name:string;value:unknown}) => `${point.name}\n${display(point.value,widgetMetrics[0])}`}, data: series.map(point => ({name: point.name, value: point[ids[0]]}))}] : widgetMetrics.map(metric => ({name: metric.name, type: widget.type === 'line' ? 'line' : 'bar', smooth: widget.type === 'line' && appearance.smooth, label:{show:appearance.showLabels,position:'top',fontSize:11,formatter:(point:{value:unknown}) => display(point.value,metric)}, connectNulls: false, barMaxWidth: 42, itemStyle: {borderRadius: widget.type === 'line' ? 0 : [3, 3, 0, 0]}, symbolSize: 6, lineStyle: {width: 2.5}, data: series.map(point => point[metric.id])})) }} onEvents={{ click: (event: {name: string}) => interact(widget, event.name) }} />}
            {result?.truncated && <Typography.Text type="secondary">显示前 500 项，共 {result.total} 条记录；汇总按完整授权数据计算。</Typography.Text>}
          </Card>;
        })}
      </div></Spin>
      </div>
    </div>
    <Drawer title={detail?.title} open={!!detail} width={900} onClose={() => { detailRequestId.current++; setDetail(undefined); }}>{detail && <><div className="analytics-drilldown-context"><strong>本次明细条件</strong><p>{[...Object.entries(detail.query.filters),...Object.entries(detail.query.widget_filters[detail.widgetId] || {})].map(([field,value]) => labelFor(field,detail.datasetId)+'：'+filterValue(value)).join('；') || '全部授权数据'}</p><small>沿用打开明细时的全局筛选和目标组件联动条件。</small></div>{detail.truncated && <Alert type="info" message="明细受 500 条展示上限限制" />}<Spin spinning={!!detail.loading}>{table(detail.rows,undefined,undefined,detail.datasetId)}</Spin></>}</Drawer>
  </div>;
}
