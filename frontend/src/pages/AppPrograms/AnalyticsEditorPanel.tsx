import {PropertyInspectorHeader, PropertyGroup, PropertyRow, PropertyAdvanced} from '@/components/PropertyInspector';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, ConfigProvider, Empty, Input, InputNumber, Select, Space, Spin, Switch, Tabs, Tag, Typography } from 'antd';
import { SettingOutlined, BarChartOutlined, CloseOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, LineChartOutlined, NumberOutlined, PieChartOutlined, PlusOutlined, SafetyCertificateOutlined, TableOutlined, TrophyOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getPlatformFormByCode, listPlatformForms, type PlatformForm, type PlatformFormField } from '@/services/api';
import type { AnalyticsEditorPanelName, AnalyticsWidgetTabName, RuntimeAnalyticsDataset, RuntimeAnalyticsDesign, RuntimeAnalyticsMetric, RuntimeAnalyticsWidget } from './analyticsTypes';
import './analytics-editor-panel.css';
import AnalyticsDatasetDialog from './AnalyticsDatasetDialog';
import {applyAnalyticsDataset, reconcileAnalyticsBindings} from './analyticsEditorState';
import {widgetAppearance, widgetPalettes, type AnalyticsWidgetAppearance} from './analyticsWidgetAppearance';
import {detachSharedMetric} from './analyticsMetricLibraryState';

export interface AnalyticsEditorPanelProps {
  panel: AnalyticsEditorPanelName;
  onOpenMetricLibrary?: (id?: string) => void;
  design: RuntimeAnalyticsDesign;
  selectedWidgetId?: string;
  onChange: (design: RuntimeAnalyticsDesign) => void;
  onSelectWidget: (id: string) => void;
  onClose: () => void;
  disabled?: boolean;
  programId: string;
  embedded?: boolean;
  navigation?: React.ReactNode;
  actions?: React.ReactNode;
  status?: React.ReactNode;
  content?: React.ReactNode;
  widgetTab?: AnalyticsWidgetTabName;
  onWidgetTabChange?: (tab: AnalyticsWidgetTabName) => void;
}

const widgetTypes = [
  { value: 'metric-card', label: '指标卡', description: '展示关键指标与阈值', icon: <NumberOutlined /> },
  { value: 'line', label: '趋势折线图', description: '观察指标随维度的变化', icon: <LineChartOutlined /> },
  { value: 'bar', label: '对比柱状图', description: '比较不同对象的指标', icon: <BarChartOutlined /> },
  { value: 'pie', label: '占比环形图', description: '展示首个指标的构成', icon: <PieChartOutlined /> },
  { value: 'rank-table', label: '排行表', description: '按首个指标降序排列', icon: <TrophyOutlined /> },
  { value: 'detail-table', label: '明细表', description: '查看已声明字段的记录', icon: <TableOutlined /> },
];
const actionOptions = [
  { value: 'filter', label: '筛选数据' },
  { value: 'drilldown', label: '打开明细' },
  { value: 'navigate', label: '进入来源表单' },
];
const panelTitles: Record<AnalyticsEditorPanelName | 'versions', string> = {
  widget: '组件配置', data: '数据与指标', filters: '全局筛选', style: '看板样式', add: '添加组件', permissions: '权限说明', versions: '版本历史', library: '共享指标库',
};
const newId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
const numericField = (field: PlatformFormField) => /number|int|float|decimal|numeric|double|currency/.test(field.field_type);
const fieldOptions = (fields: PlatformFormField[]) => fields.map(field => ({ value: field.field_name, label: `${field.label || field.field_name} (${field.field_name})` }));

function Field({label, hint, children}: {label:string;hint?:React.ReactNode;children:React.ReactElement}) {
  return <PropertyRow label={label} hint={hint}>{children}</PropertyRow>;
}

export default function AnalyticsEditorPanel({ panel, design, selectedWidgetId, onChange, onSelectWidget, onClose, disabled = false, programId, embedded = false, navigation, actions, status, content, widgetTab, onOpenMetricLibrary }: AnalyticsEditorPanelProps) {
  const [forms, setForms] = useState<PlatformForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(true);
  const [formsError, setFormsError] = useState('');
  const [sourceFields, setSourceFields] = useState<Record<string, PlatformFormField[]>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [datasetDialog, setDatasetDialog] = useState<{dataset?:RuntimeAnalyticsDataset} | null>(null);
  const [notice, setNotice] = useState('');
  const [dataTab, setDataTab] = useState('datasets');
  const [activeDatasetId, setActiveDatasetId] = useState<string | undefined>(design.datasets?.[0]?.id);
  const [activeMetricId, setActiveMetricId] = useState<string | undefined>(design.metrics?.[0]?.id);
  const currentDesign = useRef(design);
  const fieldRequests = useRef(new Map<string, Promise<PlatformFormField[]>>());
  currentDesign.current = design;

  useEffect(() => {
    let cancelled = false;
    setFormsLoading(true);
    listPlatformForms().then(response => {
      if (!cancelled) { setForms(response.data?.data || []); setFormsError(''); }
    }).catch(() => {
      if (!cancelled) setFormsError('来源表单列表读取失败，请关闭配置后重试。');
    }).finally(() => { if (!cancelled) setFormsLoading(false); });
    return () => { cancelled = true; };
  }, [programId]);

  const sourceCode = useCallback((source: string) => forms.find(form => form.code === source || String(form.id) === String(source))?.code || source, [forms]);
  const loadFields = useCallback((source: string) => {
    const code = sourceCode(source);
    let request = fieldRequests.current.get(code);
    if (!request) {
      request = getPlatformFormByCode(code, { schema: 'published', scope: 'designer' }).then(response => {
        const fields: PlatformFormField[] = (response.data?.data?.fields || []).filter((field: PlatformFormField) => !field.archived);
        setSourceFields(current => ({ ...current, [code]: fields }));
        setSourceErrors(current => ({ ...current, [code]: '' }));
        return fields;
      }).catch(error => {
        fieldRequests.current.delete(code);
        setSourceErrors(current => ({ ...current, [code]: '已发布字段读取失败，请检查来源是否已发布及访问权限。' }));
        throw error;
      });
      fieldRequests.current.set(code, request);
    }
    return request;
  }, [sourceCode]);

  const sourcesKey = JSON.stringify((design.datasets || []).map(dataset => dataset.source).filter(Boolean));
  useEffect(() => {
    if (formsLoading) return;
    const sources: string[] = JSON.parse(sourcesKey);
    void Promise.allSettled([...new Set(sources)].map(source => loadFields(source)));
  }, [sourcesKey, formsLoading, loadFields]);

  const datasets = design.datasets || [];
  const metrics = design.metrics || [];
  const widgets = design.widgets || [];
  const selected = widgets.find(widget => widget.id === selectedWidgetId);
  const selectedDataset = datasets.find(dataset => dataset.id === selected?.datasetId);
  const style = design.style || {};
  const datasetOptions = datasets.map(dataset => ({ value: dataset.id, label: dataset.name || dataset.id }));
  const fieldsFor = (dataset?: RuntimeAnalyticsDataset) => dataset ? sourceFields[sourceCode(dataset.source)] || [] : [];
  const dimensionOptions = (dataset?: RuntimeAnalyticsDataset) => (dataset?.dimensions || []).map(value => ({
    value, label: fieldsFor(dataset).find(field => field.field_name === value)?.label || value,
  }));
  const apply = (next: RuntimeAnalyticsDesign) => { if (!disabled) onChange(next); };
  const updateMetric = (id: string, patch: Partial<RuntimeAnalyticsMetric>) => {
    const next = { ...design, metrics: metrics.map(metric => metric.id === id ? { ...metric, ...patch } : metric) };
    if (patch.datasetId) {
      next.widgets = widgets.map(widget => ({ ...widget, metricIds: (widget.metricIds || []).filter(metricId => metricId !== id || widget.datasetId === patch.datasetId) }));
      setNotice('已切换指标数据集，并移除其他数据集组件对该指标的引用。请检查公式字段。');
    }
    apply(next);
  };
  const updateWidget = (patch: Partial<RuntimeAnalyticsWidget>) => {
    if (!selected) return;
    const next = { ...design, widgets: widgets.map(widget => widget.id === selected.id ? { ...widget, ...patch } : widget) };
    apply('datasetId' in patch || 'dimension' in patch ? reconcileAnalyticsBindings(next) : next);
  };
  const updateStyle = (patch: Record<string, unknown>) => apply({ ...design, style: { ...style, ...patch } });

  const addDataset = () => setDatasetDialog({});
  const applyDataset = (dataset: RuntimeAnalyticsDataset, nextMetrics: RuntimeAnalyticsMetric[]) => {
    apply(applyAnalyticsDataset(currentDesign.current, dataset, nextMetrics));
    setActiveDatasetId(dataset.id); setDatasetDialog(null);
    setNotice('数据集已应用到看板草稿，失效的字段、指标与联动引用已清理。保存并发布看板后生效。');
  };
  const addMetric = () => {
    const id = newId('metric');
    apply({ ...design, metrics: [...metrics, { id, name: '记录数', expression: 'count(*)', datasetId: datasets.find(dataset => dataset.id === activeDatasetId)?.id || datasets[0]?.id, format: 'number', threshold: '' }] });
    setDataTab('metrics');
    setActiveMetricId(id);
  };
  const addWidget = (type: string) => {
    const dataset = datasets.find(item => metrics.some(metric => metric.datasetId === item.id)) || datasets[0];
    const id = newId('widget');
    apply({ ...design, widgets: [...widgets, {
      id, title: widgetTypes.find(item => item.value === type)?.label || '新组件', type,
      datasetId: dataset?.id,
      metricIds: metrics.filter(metric => metric.datasetId === dataset?.id).slice(0, 1).map(metric => metric.id),
      dimension: dataset?.dimensions?.[0], width: type === 'detail-table' ? 'full' : type === 'metric-card' ? 'quarter' : 'half', interaction: 'none',
    }] });
    onSelectWidget(id);
  };
  const copyWidget = () => {
    if (!selected) return;
    const id = newId('widget');
    const next = [...widgets];
    next.splice(widgets.findIndex(widget => widget.id === selected.id) + 1, 0, { ...selected, id, title: `${selected.title} 副本`, metricIds: [...(selected.metricIds || [])] });
    apply({ ...design, widgets: next, interactions: [...(design.interactions || []), ...(design.interactions || []).filter(link => link.sourceWidgetId === selected.id).map(link => ({ ...link, sourceWidgetId: id }))] });
    onSelectWidget(id);
    setNotice('已复制组件和它发出的联动；其他组件仍指向原组件。');
  };
  const removeWidget = () => {
    if (!selected) return;
    const index = widgets.findIndex(widget => widget.id === selected.id);
    const next = widgets.filter(widget => widget.id !== selected.id);
    apply({ ...design, widgets: next, interactions: (design.interactions || []).filter(link => link.sourceWidgetId !== selected.id && link.targetWidgetId !== selected.id) });
    onSelectWidget(next[Math.min(index, next.length - 1)]?.id || '');
  };

  const renderWidgetPanel = () => {
    if (!selected) return <div className="analytics-editor-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择要配置的组件" />
      <p>{embedded ? '点击看板组件配置属性，拖拽组件标题调整顺序。' : '点击组件即可修改数据、布局与交互。也可以从「组件」开始。'}</p>
      {!!widgets.length && <Select aria-label="选择要配置的组件" placeholder="选择组件" options={widgets.map(widget => ({ value: widget.id, label: widget.title }))} onChange={onSelectWidget} />}
    </div>;
    const appearance = widgetAppearance(selected, style);
    const chart = ['line','bar','pie'].includes(selected.type);
    const patchAppearance = (patch: Partial<AnalyticsWidgetAppearance>) => updateWidget({appearance:{...selected.appearance,...patch}});
    const currentType = widgetTypes.find(type => type.value === selected.type);
    const links = (design.interactions || []).map((link, index) => ({ ...link, index })).filter(link => link.sourceWidgetId === selected.id);
    const targetOptions = (action: string) => widgets.filter(widget => widget.id !== selected.id).map(widget => ({
      value: widget.id, label: widget.title,
      disabled: action !== 'navigate' && !datasets.find(dataset => dataset.id === widget.datasetId)?.dimensions?.includes(selected.dimension || ''),
    }));
    const filterTarget = targetOptions('filter').find(option => !option.disabled);
    const newTarget = filterTarget || targetOptions('navigate')[0];
    const patchLink = (index: number, patch: Partial<NonNullable<RuntimeAnalyticsDesign['interactions']>[number]>) => {
      apply({ ...design, interactions: (design.interactions || []).map((link, itemIndex) => itemIndex === index ? { ...link, ...patch } : link) });
    };
    return <div className="analytics-widget-properties" key={`${selected.id}-${widgetTab}`}>
      <PropertyGroup title="基本信息" section="basic">
        <Field label="组件标题"><Input value={selected.title} maxLength={80} placeholder="输入组件标题" onChange={event => updateWidget({title:event.target.value})} /></Field>
        <PropertyAdvanced title={`图表类型 · ${currentType?.label || selected.type}`}>
          <div className="analytics-widget-type-grid">{widgetTypes.map(type => <button type="button" key={type.value} disabled={disabled} aria-pressed={selected.type===type.value} aria-label={`切换为${type.label}`} onClick={() => updateWidget({type:type.value})}>{type.icon}<span>{type.label}</span></button>)}</div>
        </PropertyAdvanced>
        <Field label="补充说明" hint="显示在标题下方，用于说明单位、范围或来源。"><Input.TextArea value={appearance.subtitle} maxLength={160} autoSize={{minRows:2,maxRows:3}} placeholder="选填" onChange={event => patchAppearance({subtitle:event.target.value})} /></Field>
      </PropertyGroup>
      <PropertyGroup title="布局与外观" section="style" defaultOpen={widgetTab==='style'}>
        <PropertyRow label="布局占比" hint="相对于所在画布，空间不足时自动换行。"><div className="analytics-widget-width-grid">{[{value:'quarter',label:'1/4',size:1},{value:'half',label:'1/2',size:2},{value:'wide',label:'3/4',size:3},{value:'full',label:'整行',size:4}].map(option => <button key={option.value} type="button" disabled={disabled} aria-label={`组件宽度 ${option.label}`} aria-pressed={(selected.width || 'half')===option.value} onClick={() => updateWidget({width:option.value})}><span className="analytics-widget-width-preview">{[0,1,2,3].map(index => <i key={index} className={index<option.size?'is-filled':''} />)}</span>{option.label}</button>)}</div></PropertyRow>
        {(chart || selected.type==='metric-card') && <>
          <PropertyRow label="组件配色" hint={selected.appearance?.palette?'当前为独立配色；点击跟随主题可恢复继承。':'当前跟随看板主题。'}><div className="analytics-widget-palette-grid">{Object.entries(widgetPalettes).map(([key,colors]) => <button type="button" key={key} aria-label={`组件配色 ${{manufacturing:'制造蓝绿',business:'经营',warning:'预警',mono:'单色'}[key]}`} aria-pressed={appearance.palette===key} disabled={disabled} onClick={() => patchAppearance({palette:key as AnalyticsWidgetAppearance['palette']})}><span>{colors.map(color => <i key={color} style={{background:color}} />)}</span><small>{{manufacturing:'制造蓝绿',business:'经营',warning:'预警',mono:'单色'}[key]}</small></button>)}</div></PropertyRow>
          <div className="analytics-property-inheritance"><span>{selected.appearance?.palette?'独立配色':'跟随看板主题'}</span><Button type="link" size="small" disabled={disabled || !selected.appearance?.palette} onClick={() => patchAppearance({palette:undefined})}>跟随主题</Button></div>
        </>}
        <PropertyAdvanced>
          {chart && <Field label="图表高度" hint="单位：px，范围 200–640。"><InputNumber min={200} max={640} step={20} value={appearance.height} onChange={value => patchAppearance({height:value ?? 280})} /></Field>}
          <Field label="卡片圆角" hint="单位：px；清空后跟随主题。"><InputNumber min={0} max={24} placeholder="跟随主题" value={selected.appearance?.radius} onChange={value => patchAppearance({radius:value ?? undefined})} /></Field>
          {chart && <>
            <Field label="显示图例"><Switch size="small" checked={appearance.showLegend} onChange={showLegend => patchAppearance({showLegend})} /></Field>
            <Field label="数值标签" hint="沿用指标格式与单位，最多展示两位小数。"><Switch size="small" checked={appearance.showLabels} onChange={showLabels => patchAppearance({showLabels})} /></Field>
            {selected.type==='line' && <Field label="平滑曲线"><Switch size="small" checked={appearance.smooth} onChange={smooth => patchAppearance({smooth})} /></Field>}
          </>}
          {selected.type==='metric-card' && <p className="analytics-property-note">指标阈值颜色优先于组件配色。</p>}
        </PropertyAdvanced>
      </PropertyGroup>
      <PropertyGroup title="数据绑定" section="data" defaultOpen={widgetTab==='data'}>
        <Field label="数据集" hint="切换后会清空指标，并清理不兼容的筛选与联动。"><Select value={selected.datasetId} placeholder="请选择数据集" options={datasetOptions} onChange={datasetId => updateWidget({datasetId,metricIds:[],dimension:datasets.find(dataset=>dataset.id===datasetId)?.dimensions?.[0]})} /></Field>
        <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => setDatasetDialog({dataset:selectedDataset})}>{selectedDataset ? '配置数据集' : '新增数据集'}</Button>
        {!datasets.length && <Alert type="info" message="先在「数据与指标」新增数据集。" />}
        <Field label="展示指标" hint={selected.type==='pie'?'环形图使用第一个指标。':selected.type==='rank-table'?'排行按第一个指标降序。':'仅可选择当前数据集的指标。'}><Select mode="multiple" value={selected.metricIds || []} placeholder="选择指标" options={metrics.filter(metric=>metric.datasetId===selected.datasetId).map(metric=>({value:metric.id,label:metric.name}))} onChange={metricIds=>updateWidget({metricIds})} /></Field>
        <Field label={selected.type==='metric-card'?'可选维度':selected.type==='detail-table'?'点击字段':'分组维度'} hint={selected.type==='metric-card'?'指标卡展示汇总值，不按维度分组。':'用于分组和点击时的筛选条件。'}><Select allowClear value={selected.dimension} placeholder="选择维度" options={dimensionOptions(selectedDataset)} onChange={dimension=>updateWidget({dimension})} /></Field>
        {!selectedDataset?.dimensions?.length && selectedDataset && <Alert type="info" message="尚未声明维度，可在「数据与指标」中添加。" />}
        {!!selected.metricIds?.length && <PropertyAdvanced title="指标口径与引用">
          <div className="analytics-property-metric-definitions">{metrics.filter(metric=>selected.metricIds?.includes(metric.id)).map(metric=><div key={metric.id}><strong>{metric.name}</strong><code>{metric.expression || '尚未定义公式'}</code>{metric.description && <p>{metric.description}</p>}<small>{metric.sharedMetricId?`共享 v${metric.sharedMetricVersion}`:'本地指标'} · {metric.format==='percent'?'百分比':metric.unit || '数值'}</small>{metric.sharedMetricId && onOpenMetricLibrary && <Button type="link" size="small" onClick={()=>onOpenMetricLibrary(metric.sharedMetricId)}>查看共享口径与影响</Button>}</div>)}</div>
        </PropertyAdvanced>}
      </PropertyGroup>
      <PropertyGroup title="交互行为" section="interaction" defaultOpen={widgetTab==='interaction'}>
          <Field label="点击动作" hint="未配置下方联动时，动作作用于当前组件。"><Select value={selected.interaction || 'none'} disabled={disabled || selected.type === 'metric-card' || !selected.dimension} options={[{ value: 'none', label: '无动作' }, ...actionOptions]} onChange={interaction => updateWidget({ interaction })} /></Field>
          {(selected.type === 'metric-card' || !selected.dimension) && <Alert type="info" message={selected.type === 'metric-card' ? '指标卡用于展示汇总。点击联动适用于图表和表格。' : '先选择维度，才能按点击内容筛选或打开明细。'} />}
          <div className="analytics-editor-section-title"><strong>指定目标联动</strong><Button size="small" icon={<PlusOutlined />} disabled={disabled || !selected.dimension || !newTarget || selected.type === 'metric-card'} onClick={() => {
            if (newTarget) apply({ ...design, interactions: [...(design.interactions || []), { sourceWidgetId: selected.id, targetWidgetId: newTarget.value, action: filterTarget ? 'filter' : 'navigate' }] });
          }}>新增</Button></div>
          <p className="analytics-editor-help">有目标联动时优先执行这些规则。筛选、明细联动要求目标数据集具有相同维度。</p>
          {!links.length && <div className="analytics-editor-inline-empty">尚未配置目标联动</div>}
          {links.map(link => <div className="analytics-editor-link" key={link.index}>
            <Field label="联动动作"><Select value={link.action} options={actionOptions} onChange={action => {
              const targets = targetOptions(action);
              const target = targets.find(option => option.value === link.targetWidgetId && !option.disabled) || targets.find(option => !option.disabled);
              if (!target) { setNotice('没有具备相同维度的目标组件，请先配置目标数据集的维度。'); return; }
              patchLink(link.index, { action, targetWidgetId: target.value });
            }} /></Field>
            <Field label="目标组件"><Select value={link.targetWidgetId} options={targetOptions(link.action)} onChange={targetWidgetId => patchLink(link.index, { targetWidgetId })} /></Field>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => apply({ ...design, interactions: (design.interactions || []).filter((_, index) => index !== link.index) })}>删除此联动</Button>
          </div>)}
          {!filterTarget && widgets.length > 1 && selected.dimension && <p className="analytics-editor-help">其他组件的数据集尚未声明「{selected.dimension}」维度，目前可配置进入来源表单。</p>}
          <p className="analytics-editor-help">{embedded ? '直接点击左侧看板中的图表或表格，即可验证筛选和明细联动。' : '编辑时点击用于选中组件；切换到「预览」后可验证实际效果。'}</p>
      </PropertyGroup>
      <div className="analytics-editor-widget-actions"><Button type="text" icon={<CopyOutlined />} onClick={copyWidget}>复制组件</Button><Button type="text" danger icon={<DeleteOutlined />} onClick={removeWidget}>删除组件</Button></div>
    </div>;
  };

  const renderDataPanel = () => <>
    {formsError && <Alert type="warning" message={formsError} />}
    <Tabs activeKey={dataTab} size="small" onChange={setDataTab} items={[
      { key: 'datasets', label: `数据集 ${datasets.length}`, children: <>
        <p className="analytics-editor-help">每个组件可绑定不同的数据集。自定义数据集可独立命名、选择来源表单、维度、数值字段和刷新方式。</p>
        <Button block icon={<PlusOutlined />} onClick={addDataset}>新增数据集</Button>
        {!datasets.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="新增数据集后，在独立窗口中配置来源、字段、范围和指标" />}
        <div className="analytics-dataset-cards">{datasets.map(dataset => {
          const referenced = widgets.some(widget => widget.datasetId === dataset.id) || metrics.some(metric => metric.datasetId === dataset.id);
          return <article key={dataset.id}><div><strong><DatabaseOutlined /> {dataset.name || '未命名数据集'}</strong><small>{forms.find(form => form.code === sourceCode(dataset.source))?.name || dataset.source || '尚未选择来源'}</small></div><p>{(dataset.dimensions || []).length} 个维度 · {(dataset.measures || []).length} 个数值 · {(dataset.rangeFilters || []).length} 个范围条件 · {metrics.filter(metric => metric.datasetId === dataset.id).length} 个指标</p><Space><Button size="small" icon={<SettingOutlined />} onClick={() => setDatasetDialog({dataset})}>配置数据集</Button><Button type="text" danger size="small" icon={<DeleteOutlined />} disabled={disabled || referenced} title={referenced ? '仍被指标或组件引用，解除引用后可删除' : undefined} onClick={() => apply(reconcileAnalyticsBindings({...design,datasets:datasets.filter(item => item.id !== dataset.id)}))}>删除</Button></Space></article>;
        })}</div>
      </> },
      { key: 'metrics', label: `指标 ${metrics.length}`, children: <>
        {onOpenMetricLibrary && <Button block icon={<DatabaseOutlined />} style={{marginBottom:8}} onClick={() => onOpenMetricLibrary()}>从共享指标库引用</Button>}
        <Button block icon={<PlusOutlined />} disabled={disabled || !datasets.length} onClick={addMetric}>新增指标</Button>
        {!datasets.length && <p className="analytics-editor-help">先在「数据集」中添加来源，再定义指标。</p>}
        {!metrics.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有指标，可从记录数开始" />}
        <Collapse accordion className="analytics-editor-collapse" activeKey={activeMetricId} onChange={keys => setActiveMetricId((Array.isArray(keys) ? keys : [keys])[0])} items={metrics.map(metric => ({ key: metric.id, label: <span className="analytics-editor-collapse-title"><NumberOutlined />{metric.name || '未命名指标'}</span>, children: <>
          {metric.sharedMetricId && <Alert type="info" showIcon message={`共享指标 v${metric.sharedMetricVersion}`} description="引用统一口径。修改共享口径前，可查看受影响的图表和看板。" action={onOpenMetricLibrary && <Button size="small" onClick={() => onOpenMetricLibrary(metric.sharedMetricId)}>管理口径</Button>} />}
          <ConfigProvider componentDisabled={disabled || !!metric.sharedMetricId}>
          <Field label="指标名称"><Input value={metric.name} maxLength={80} onChange={event => updateMetric(metric.id, { name: event.target.value })} /></Field>
          <Field label="业务口径说明" hint="说明统计范围、排除条件与使用场景，引用此指标的组件共同使用。"><Input.TextArea value={metric.description} maxLength={500} autoSize={{minRows: 2, maxRows: 4}} placeholder="例如：当前筛选范围内，实际产量之和 ÷ 计划产量之和" onChange={event => updateMetric(metric.id, {description: event.target.value})} /></Field>
          <Field label="指标数据集"><Select value={metric.datasetId} options={datasetOptions} onChange={datasetId => updateMetric(metric.id, { datasetId })} /></Field>
          <Field label="计算公式"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={metric.expression} maxLength={512} placeholder="例如 count(*)" onChange={event => updateMetric(metric.id, { expression: event.target.value })} /></Field>
          <div className="analytics-editor-formula-fields"><span>可用字段</span>{[...new Set([...(datasets.find(dataset => dataset.id === metric.datasetId)?.dimensions || []), ...(datasets.find(dataset => dataset.id === metric.datasetId)?.measures || [])])].map(field => <Tag key={field}>{field}</Tag>)}</div>
          <Field label="显示格式"><Select value={metric.format || 'number'} options={[{ value: 'number', label: '数值' }, { value: 'percent', label: '百分比' }, { value: 'currency', label: '金额（¥）' }, { value: 'duration', label: '时长（秒）' }]} onChange={format => updateMetric(metric.id, { format })} /></Field>
          <Field label="显示单位（可选）" hint="仅数值格式追加此单位；百分比、金额和时长沿用对应格式。"><Input value={metric.unit} maxLength={20} placeholder="例如：件、条、台" onChange={event => updateMetric(metric.id, {unit: event.target.value})} /></Field>
          <Field label="阈值颜色（可选）" hint="例如：红色 > 100；支持红色、绿色、黄色、橙色。百分比阈值按展示值填写。"><Input value={metric.threshold} placeholder="红色 > 100" onChange={event => updateMetric(metric.id, { threshold: event.target.value })} /></Field>
          </ConfigProvider>
          {metric.sharedMetricId && <Button size="small" onClick={() => {apply({...design, metrics:metrics.map(item => item.id === metric.id ? detachSharedMetric(item) : item)}); setNotice('已转为本地指标，发布当前看板后将独立维护口径。');}}>转为本地指标</Button>}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => {
            apply({ ...design, metrics: metrics.filter(item => item.id !== metric.id), widgets: widgets.map(widget => ({ ...widget, metricIds: (widget.metricIds || []).filter(id => id !== metric.id) })) });
            setNotice('指标已删除，组件中的引用已清理。缺少指标的组件需要重新选择指标。');
          }}>{metric.sharedMetricId ? '移除本看板引用' : '删除指标'}</Button>
        </> }))} />
        <div className="analytics-editor-formula-help"><strong>公式写法</strong><code>count(*)</code><code>sum(actual)</code><code>avg(actual)</code><code>count_distinct(subject)</code><code>count_if(status == "已关闭")</code><p>字段名需替换为数据集已声明的字段。支持 sum、avg、min、max 和四则运算。</p><p>百分比返回比例，如 sum(actual) / sum(target)，展示时乘以 100。分母为零显示 —。</p></div>
      </> },
    ]} />
  </>;

  const renderFiltersPanel = () => {
    const dimensions = [...new Set(datasets.flatMap(dataset => dataset.dimensions || []))];
    const labelFor = (name: string) => datasets.flatMap(dataset => fieldsFor(dataset)).find(field => field.field_name === name)?.label || name;
    return <>
      <p className="analytics-editor-help">筛选作用于具有同名字段的数据集，字段来自已声明的维度。</p>
      <Field label="全局筛选字段"><Select mode="multiple" value={design.globalFilters || []} placeholder="选择筛选字段" options={[...dimensions.map(value => ({ value, label: labelFor(value) })), ...(dimensions.includes('date') ? [{ value: 'dateRange', label: '日期范围（date）' }] : [])]} onChange={globalFilters => apply({ ...design, globalFilters })} /></Field>
      {!dimensions.length && <Alert showIcon type="info" message="还没有可筛选的维度" description="在「数据与指标」中，选择来源表单并声明维度字段。" />}
      <Field label="筛选器布局"><Select value={String(style.filterTheme || 'toolbar')} options={[{ value: 'toolbar', label: '顶部工具栏' }, { value: 'inline', label: '嵌入画布' }, { value: 'panel', label: '侧边筛选面板' }]} onChange={filterTheme => updateStyle({ filterTheme })} /></Field>
      <Alert type="info" message={embedded ? '配置字段后，直接使用左侧看板中的筛选器检验结果。' : '配置字段后，切换到「预览」即可检验筛选结果。'} />
    </>;
  };
  const renderStylePanel = () => <>
    <div className="analytics-editor-section-title"><strong>主题</strong><Typography.Text type="secondary">应用到整张看板</Typography.Text></div>
    <div className="analytics-editor-presets">{[
      { value: 'clean', label: '简洁', background: '#f6f8fa', colors: ['#2c6e84', '#24986b'] },
      { value: 'factory', label: '制造', background: '#edf4f5', colors: ['#2c6e84', '#718d38'] },
      { value: 'executive', label: '经营', background: '#f1f3f8', colors: ['#3867b0', '#b27d32'] },
      { value: 'dark', label: '深色', background: '#101c26', colors: ['#2c6e84', '#24986b'] },
    ].map(preset => <button key={preset.value} type="button" aria-pressed={(style.preset || 'clean') === preset.value} disabled={disabled} className="analytics-editor-preset" onClick={() => updateStyle({ preset: preset.value, background: preset.background, cardBorder: preset.value === 'executive' ? 'strong' : 'light', chartPalette: preset.value === 'executive' ? 'business' : 'manufacturing' })}>
      <span className="analytics-editor-preset-sample" style={{ background: preset.background }}>{preset.colors.map(color => <i key={color} style={{ background: color }} />)}</span><span>{preset.label}</span>
    </button>)}</div>
    <Field label="画布背景"><Input value={String(style.background || '#f6f8fa')} placeholder="#f6f8fa" maxLength={50} onChange={event => updateStyle({ background: event.target.value })} /></Field>
    <div className="analytics-editor-two-fields"><Field label="组件间距"><InputNumber min={0} max={32} value={Number(style.componentGap ?? 12)} addonAfter="px" onChange={value => updateStyle({ componentGap: value ?? 0 })} /></Field><Field label="卡片圆角"><InputNumber min={0} max={20} value={Number(style.cardRadius ?? 8)} addonAfter="px" onChange={value => updateStyle({ cardRadius: value ?? 0 })} /></Field></div>
    <Field label="卡片边框"><Select value={String(style.cardBorder || 'light')} options={[{ value: 'none', label: '无边框' }, { value: 'light', label: '轻边框' }, { value: 'strong', label: '强调边框' }]} onChange={cardBorder => updateStyle({ cardBorder })} /></Field>
    <Field label="图表配色"><Select value={String(style.chartPalette || 'manufacturing')} options={[{ value: 'manufacturing', label: '制造蓝绿' }, { value: 'business', label: '经营彩色' }, { value: 'warning', label: '风险预警' }, { value: 'mono', label: '单色专业' }]} onChange={chartPalette => updateStyle({ chartPalette })} /></Field>
    <Field label="表格密度"><Select value={String(style.tableDensity || 'standard')} options={[{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'comfortable', label: '宽松' }]} onChange={tableDensity => updateStyle({ tableDensity })} /></Field>
    <Field label="筛选器布局"><Select value={String(style.filterTheme || 'toolbar')} options={[{ value: 'toolbar', label: '顶部工具栏' }, { value: 'inline', label: '嵌入画布' }, { value: 'panel', label: '侧边筛选面板' }]} onChange={filterTheme => updateStyle({ filterTheme })} /></Field>
  </>;

  const Container = embedded ? 'section' : 'aside';
  const closeLabel = embedded ? '关闭看板配置' : '关闭配置侧栏';
  return <Container className={`property-inspector analytics-editor-panel${embedded ? ' analytics-editor-panel-embedded' : ''}`} aria-label={embedded ? '看板配置' : panelTitles[panel]}>
    <PropertyInspectorHeader title={panel==='widget'?'组件属性':panelTitles[panel]} context={panel==='widget'?selected?.title:undefined} actions={<>{panel==='widget' && navigation}<Button type="text" aria-label={closeLabel} title={closeLabel} icon={<CloseOutlined />} disabled={disabled} onClick={onClose} /></>} />
    {panel!=='widget' && navigation && <nav className="analytics-editor-panel-navigation" aria-label="看板配置分类">{navigation}</nav>}
    <ConfigProvider componentDisabled={disabled}>
      <div className="analytics-editor-panel-body">
        {content !== undefined ? content : <>
        {notice && <Alert className="analytics-editor-notice" type="info" showIcon closable message={notice} onClose={() => setNotice('')} />}
        {panel === 'widget' && renderWidgetPanel()}
        {panel === 'data' && renderDataPanel()}
        {panel === 'filters' && renderFiltersPanel()}
        {panel === 'style' && renderStylePanel()}
        {panel === 'add' && <><div className="analytics-editor-section-title"><strong>组件类型</strong><span>看板已有 {widgets.length} 个组件</span></div><p className="analytics-editor-help">添加后即可配置数据、布局与交互。</p><div className="analytics-editor-library">{widgetTypes.map(type => <button key={type.value} type="button" aria-label={`添加${type.label}`} disabled={disabled} onClick={() => addWidget(type.value)}><span className="analytics-editor-library-icon">{type.icon}</span><strong>{type.label}</strong><small>{type.description}</small><PlusOutlined className="analytics-editor-library-plus" /></button>)}</div>{(!datasets.length || !metrics.length) && <Alert type="info" message="可以先添加组件，再在「数据与指标」中配置来源和指标。" />}</>}
        {panel === 'permissions' && <div className="analytics-editor-permissions"><SafetyCertificateOutlined /><h3>沿用表单权限</h3><p>当前由管理员编辑和发布看板。普通用户查看已发布版本。</p><p>每个数据集继承来源表单的数据与字段权限，图表汇总和明细都只读取当前用户有权访问的数据。</p><p>修改布局、公式或筛选条件，不会扩大访问权限。</p><Alert type="info" message="保存草稿只更新配置草稿；发布成功后，查看模式才会使用新版本。" /><p className="analytics-editor-permission-link"><Link to={`/form-settings/${encodeURIComponent(programId)}?tab=permission&legacy=1`}>查看详细权限设置</Link></p></div>}
        </>}
      </div>
    </ConfigProvider>
    {datasetDialog && <AnalyticsDatasetDialog programId={programId} dataset={datasetDialog.dataset} design={design} forms={forms} formsLoading={formsLoading} disabled={disabled} loadFields={loadFields} onApply={applyDataset} onClose={() => setDatasetDialog(null)} />}
    <footer className="analytics-editor-panel-footer">{status}{actions ?? '更改暂存于当前编辑会话 · 保存草稿后保留'}</footer>
  </Container>;
}
