import {widgetInfoText} from './analyticsWidgetDescription';
import OptionPicker from '@/components/OptionPicker';
import {PropertyInspectorHeader, PropertyGroup, PropertyRow, PropertyAdvanced} from '@/components/PropertyInspector';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, ConfigProvider, Empty, Input, InputNumber, Modal, Select, Space, Spin, Switch, Tabs, Tag, Typography } from 'antd';
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
  headerStatus?: React.ReactNode;
  headerActions?: React.ReactNode;
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

const parameterHints: Record<string,string> = {
  '组件标题':'显示在组件顶部的名称，同时用于组件选择和联动目标识别。',
  '图表类型':'切换当前组件的展示方式，保留已绑定的数据和指标。',
  '组件配色':'选择图表系列或指标数值的配色；跟随主题时使用页面配色。',
  '跟随页面材质':'开启时使用页面设置的透明度和模糊强度；单独修改数值后改为组件独立设置。',
  '玻璃模糊':'背景模糊强度，单位 px；0 表示不模糊，数值越大磨砂感越强。',
  '显示组件标题':'控制画布顶部标题是否显示；开启后可编辑标题文字和字号。',
  '标题文字':'与基本信息中的组件标题同步，修改后立即显示在画布中。',
  '标题字号':'标题文字大小，单位 px，可设置为 10–24。',
  '说明文字':'说明图标中展示的业务说明；已带入组件用途、数据来源和指标口径，可自行修改。',
  '显示图例':'显示各数据系列的名称与颜色；开启后可调整位置、排列、字号和交互。',
  '图例位置':'图例在图表中的位置，画布会为对应方向预留空间。',
  '排列方向':'自动时根据图例位置排列，也可固定为横向或纵向。',
  '图例字号':'图例名称的文字大小，单位 px，可设置为 10–20。',
  '图例间距':'相邻图例项的间隔，单位 px，可设置为 4–32。',
  '点击切换':'允许点击图例来隐藏或显示对应系列，不会修改数据。',
  '数值标签':'在图形上显示对应数值，沿用指标的格式和单位；开启后可设置字号和位置。',
  '标签字号':'图形上数值标签的文字大小，单位 px，可设置为 10–20。',
  '标签位置':'数值标签相对于图形的位置；环形图可选择内侧或外侧。',
  '网格辅助线':'显示数值轴的参考线，方便比较数值；开启后可设置线条样式。',
  '线条样式':'选择网格参考线的样式：实线、虚线或点线。',
  '坐标轴标签':'显示分组名称和数值刻度；开启后可设置文字大小和旋转角度。',
  '坐标字号':'坐标轴刻度文字大小，单位 px，可设置为 10–20。',
  '文字旋转':'分组刻度文字的旋转角度，范围 0–90°；用于减少长文字重叠。',
  '平滑曲线':'用平滑曲线连接数据点，仅改变线条形状，不改变原始数值。',
  '线条宽度':'折线的粗细，单位 px，可设置为 1–8。',
  '数据点大小':'折线上数据点的尺寸，单位 px；0 表示隐藏数据点。',
  '柱条方向':'纵向比较各分组，横向更适合较长的分组名称。',
  '最大柱宽':'柱条的最大厚度，单位 px；数据较多时会自动缩小。',
  '外圈半径':'饼图或环形图外圈大小，相对于图表可用区域，可设置为 40–90%。',
  '显示表头':'控制表格列名称是否显示，关闭后只展示数据行。',
  '斑马纹':'交替显示浅色行背景，方便横向阅读。',
  '单元格边框':'显示单元格之间的边界线。',
  '行间密度':'调整表格数据行的上下留白：紧凑、标准或宽松。',
  '单元格对齐':'统一设置表格内文字和数值的水平对齐方向。',
  '每页行数':'每页展示的数据行数，范围 5–100；超过后显示分页。',
  '显示指标名称':'显示指标卡内的指标名称，不影响数值和口径说明入口。',
  '数值字号':'指标卡数值的文字大小，单位 px，可设置为 16–64。',
  '内容对齐':'指标卡内容的水平对齐方式。',
  '内容内边距':'指标卡内容与卡片边缘的距离，单位 px，范围 0–40。',
  '每行指标数':'每行排列的指标数量，范围 1–6；清空时自动适应可用宽度。',
  '主题样式':'批量应用页面底色、卡片边框和图表配色。',
  '方格尺寸':'方格纸每个网格的边长，默认 44px。',
  '卡片不透明度':'白色卡片底色的浓度，100% 为不透明。',
  '画布背景':'方格纸的基础底色，使用六位十六进制颜色值。',
  '组件间距':'画布上相邻组件之间的距离，单位 px。',
  '卡片边框':'控制卡片边框的显示和强调程度。',
  '图表配色':'页面默认配色，未单独设置配色的组件会继承此值。',
  '表格密度':'页面默认表格行密度，组件独立设置优先。',
  '筛选器布局':'选择筛选条件在顶部、画布内或侧边面板中显示。',
  '全局筛选字段':'选择作用于当前看板的筛选维度，顺序与选择顺序一致。',
  '指标名称':'用于图例、指标卡和指标选择中的业务名称。',
  '计算公式':'基于数据集声明的字段计算指标，例如 count(*) 或 sum(actual)。',
  '显示格式':'控制数值的展示格式，百分比会将计算比例乘以 100。',
  '显示单位':'为数值追加业务单位，例如件、台；百分比、金额和时长使用各自格式。',
  '业务口径说明':'描述指标的统计范围、计算方式和排除条件。',
  '阈值颜色':'按指标数值设置颜色，例如红色 > 100；优先于组件配色。',
  '联动动作':'选择点击此组件数据后要对目标组件执行的操作。',
  '目标组件':'接收联动的组件；筛选和明细要求目标数据集具有相同维度。',
};

function Field({label, hint, children}: {label:string;hint?:React.ReactNode;children:React.ReactElement}) {
  return <PropertyRow label={label} hint={hint ?? parameterHints[label]} className={children.type === Switch ? 'analytics-switch-heading' : ''}>{children}</PropertyRow>;
}

function DependentOptions({title,children,defaultOpen=true}:{title:string;children:React.ReactNode;defaultOpen?:boolean}) {
  const [expanded,setExpanded]=useState(defaultOpen);
  return <details className="analytics-dependent-options" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary aria-label={title}>{title}<span>{expanded?'收起':'展开'}</span></summary>{children}
  </details>;
}

export default function AnalyticsEditorPanel({ panel, design, selectedWidgetId, onChange, onSelectWidget, onClose, disabled = false, programId, embedded = false, navigation, actions, status, headerStatus, headerActions, content, widgetTab, onWidgetTabChange, onOpenMetricLibrary }: AnalyticsEditorPanelProps) {
  const [localWidgetTab,setLocalWidgetTab]=useState<AnalyticsWidgetTabName>('basic');
  const activeWidgetTab=widgetTab || localWidgetTab;
  const panelBodyRef=useRef<HTMLDivElement>(null);
  const changeWidgetTab=(tab:string)=>{const next=tab as AnalyticsWidgetTabName;setLocalWidgetTab(next);onWidgetTabChange?.(next);};
  useEffect(()=>{panelBodyRef.current?.scrollTo({top:0});},[activeWidgetTab,selectedWidgetId,panel]);
  const [forms, setForms] = useState<PlatformForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(true);
  const [formsError, setFormsError] = useState('');
  const [sourceFields, setSourceFields] = useState<Record<string, PlatformFormField[]>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [datasetDialog, setDatasetDialog] = useState<{dataset?:RuntimeAnalyticsDataset} | null>(null);
  const [notice, setNotice] = useState('');
  const [metricDraft, setMetricDraft] = useState<RuntimeAnalyticsMetric | null>(null);
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
    const fontOptions = [{value:'inherit',label:'跟随主题'},{value:'sans-serif',label:'无衬线字体'},{value:'serif',label:'衬线字体'},{value:'monospace',label:'等宽字体'},{value:'PingFang SC, Microsoft YaHei, sans-serif',label:'苹方 / 微软雅黑'}];
    const colorControl = (key: 'titleColor' | 'chartTextColor' | 'tableHeaderColor' | 'metricValueColor') => <Space size={6}><input type="color" aria-label={{titleColor:'标题颜色',chartTextColor:'文字颜色',tableHeaderColor:'表头背景',metricValueColor:'数值颜色'}[key]} value={appearance[key] || '#536775'} onChange={event=>patchAppearance({[key]:event.target.value})} /><Button size="small" type="text" onClick={()=>patchAppearance({[key]:undefined})}>重置</Button></Space>;
    const tableColumnOptions = selected.type==='rank-table'
      ? [{value:'name',label:'分组名称'},...(selected.metricIds || []).map(id=>({value:id,label:metrics.find(metric=>metric.id===id)?.name || id}))]
      : [...new Set([...(selectedDataset?.dimensions || []),...(selectedDataset?.measures || [])])].map(value=>({value,label:fieldsFor(selectedDataset).find(field=>field.field_name===value)?.label || value}));
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
    return <div className="analytics-widget-properties" key={`${selected.id}-${activeWidgetTab}`} data-widget-tab={activeWidgetTab}>
      <PropertyGroup title="基本信息" section="basic">
        <Field label="组件标题"><Input value={selected.title} maxLength={80} placeholder="输入组件标题" onChange={event => updateWidget({title:event.target.value})} /></Field>
        <Field label="图表类型"><OptionPicker value={selected.type} options={widgetTypes.map(type=>({value:type.value,label:<span className="analytics-inspector-option">{type.icon}<span>{type.label}</span></span>}))} onChange={type=>updateWidget({type})} /></Field>
        <Field label="补充说明" hint="显示在标题下方，用于说明单位、范围或来源。"><Input.TextArea value={appearance.subtitle} maxLength={160} autoSize={{minRows:2,maxRows:3}} placeholder="选填" onChange={event => patchAppearance({subtitle:event.target.value})} /></Field>
      </PropertyGroup>
      <PropertyGroup title="画布布局" section="basic" defaultOpen={activeWidgetTab==='basic'}>
        <Field label="布局占比" hint="宽度相对于看板画布，空间不足时自动换行。"><OptionPicker numericValues={Array.from({length:10},(_,i)=>Math.round((i+3)/12*100))} value={String(appearance.widthColumns)} options={Array.from({length:10},(_,i)=>({value:String(i+3),label:i===9?'整行':`${Math.round((i+3)/12*100)}%`,showMark:[0,3,6,9].includes(i)}))} onChange={value=>{const columns=Number(value);updateWidget({width:columns<=3?'quarter':columns<=6?'half':columns<=9?'wide':'full',appearance:{...selected.appearance,widthColumns:columns}});}} /></Field>
          <Field label="卡片高度" hint="组件整体高度，也可拖拽底边调整；清空后按内容自适应。"><InputNumber min={chart?280:160} max={960} suffix="px" placeholder="自适应" value={appearance.cardHeight} onChange={value=>patchAppearance({cardHeight:value ?? undefined,...(chart && value ? {height:Math.min(640,Math.max(200,value-78))}: {})})} /></Field>
          {chart && <Field label="图表高度" hint="单位：px，范围 200–640。"><InputNumber min={200} max={640} step={20} value={appearance.height} onChange={value => patchAppearance({height:value ?? 280})} /></Field>}

      </PropertyGroup>
          <PropertyGroup title="卡片材质" section="basic" className="analytics-appearance-group" defaultOpen={false}>
        {(chart || selected.type==='metric-card') && <Field label="组件配色" hint="未单独指定时，跟随看板主题配色。"><OptionPicker value={selected.appearance?.palette || 'inherit'} options={[{value:'inherit',label:'跟随看板主题'},...Object.entries(widgetPalettes).map(([value,colors])=>({value,label:<span className="analytics-inspector-option"><span className="analytics-inspector-palette">{colors.map(color=><i key={color} style={{background:color}} />)}</span><span>{{manufacturing:'制造蓝绿',business:'经营彩色',warning:'风险预警',mono:'单色专业'}[value]}</span></span>}))]} onChange={palette=>patchAppearance({palette:palette==='inherit'?undefined:palette as AnalyticsWidgetAppearance['palette']})} /></Field>}
          {selected.type==='metric-card' && <Field label="指标组底板" hint="关闭时指标组容器透明，仅内部各指标卡保留玻璃材质。"><Switch size="small" checked={appearance.groupBackground} onChange={groupBackground=>patchAppearance({groupBackground})} /></Field>}
          <Field label="跟随页面材质"><Switch size="small" checked={selected.appearance?.cardOpacity == null && selected.appearance?.cardBlur == null} onChange={follow=>patchAppearance(follow ? {cardOpacity:undefined,cardBlur:undefined} : {cardOpacity:appearance.cardOpacity,cardBlur:appearance.cardBlur})} /></Field>
          <Field label="不透明度" hint="组件卡片的白底浓度，100% 为不透明。"><InputNumber min={30} max={100} suffix="%" value={Math.round(appearance.cardOpacity*100)} onChange={value=>patchAppearance({cardOpacity:(value ?? 78)/100})} /></Field>
          <Field label="玻璃模糊"><InputNumber min={0} max={24} suffix="px" value={appearance.cardBlur} onChange={value=>patchAppearance({cardBlur:value ?? 12})} /></Field>
          <Field label="卡片圆角" hint="单位：px；清空后跟随主题。"><InputNumber min={0} max={24} placeholder="跟随主题" value={selected.appearance?.radius} onChange={value => patchAppearance({radius:value ?? undefined})} /></Field>
          </PropertyGroup>
          <PropertyGroup title="标题与说明" section="basic" className="analytics-appearance-group" defaultOpen={false}>
            <Field label="显示组件标题"><Switch size="small" checked={appearance.showTitle} onChange={showTitle=>patchAppearance({showTitle})} /></Field>
            {appearance.showTitle && <DependentOptions title="标题设置"><Field label="标题文字"><Input value={selected.title} maxLength={80} onChange={event=>updateWidget({title:event.target.value})} /></Field><Field label="标题字号"><InputNumber min={10} max={24} suffix="px" value={appearance.titleFontSize} onChange={value=>patchAppearance({titleFontSize:value ?? 12})} /></Field><Field label="标题位置"><OptionPicker value={appearance.titleAlign} options={[{value:'left',label:'左侧'},{value:'center',label:'居中'},{value:'right',label:'右侧'}]} onChange={titleAlign=>patchAppearance({titleAlign:titleAlign as NonNullable<AnalyticsWidgetAppearance['titleAlign']>})} /></Field>
            <Field label="标题字体"><OptionPicker value={appearance.titleFontFamily} options={fontOptions} onChange={titleFontFamily=>patchAppearance({titleFontFamily})} /></Field>
            <Field label="标题颜色">{colorControl('titleColor')}</Field>
            <Field label="标题字重"><OptionPicker value={appearance.titleWeight} options={[{value:'normal',label:'常规'},{value:'bold',label:'加粗'}]} onChange={titleWeight=>patchAppearance({titleWeight:titleWeight as NonNullable<AnalyticsWidgetAppearance['titleWeight']>})} /></Field>
            <Field label="标题斜体"><Switch size="small" checked={appearance.titleItalic} onChange={titleItalic=>patchAppearance({titleItalic})} /></Field>
            <Field label="标题下间距"><InputNumber min={0} max={40} suffix="px" value={appearance.titleGap} onChange={value=>patchAppearance({titleGap:value ?? 0})} /></Field></DependentOptions>}
            <Field label="口径入口" hint="可填写组件说明；下方仍会展示已绑定指标的实时口径。"><Switch size="small" checked={appearance.showMetricInfo} onChange={showMetricInfo=>patchAppearance({showMetricInfo})} /></Field>
            {appearance.showMetricInfo && <DependentOptions title="说明设置"><Field label="说明文字"><Input.TextArea value={widgetInfoText(selected,design)} maxLength={500} autoSize={{minRows:2,maxRows:5}} placeholder="填写用途、统计范围或阅读说明" onChange={event=>patchAppearance({infoText:event.target.value,infoTextMode:'custom'})} /></Field><p className="analytics-property-note">说明图标展示这里的文字及绑定指标口径。</p></DependentOptions>}
          </PropertyGroup>
          {chart && <>
            <PropertyGroup key="图表形态" title="图表形态" section="style" className="analytics-appearance-group" defaultOpen={true}>
            {selected.type!=='pie' && <>
              <Field label="系列模式" hint="单系列仅展示数据绑定中的第一个指标；多系列展示全部已选指标。"><OptionPicker value={appearance.seriesMode} options={[{value:'single',label:selected.type==='line'?'单折线':'单系列柱状'},{value:'multiple',label:selected.type==='line'?'多折线':'多系列柱状'}]} onChange={seriesMode=>patchAppearance({seriesMode:seriesMode as NonNullable<AnalyticsWidgetAppearance['seriesMode']>})} /></Field>
              {appearance.seriesMode==='multiple' && <><p className="analytics-property-note">多系列需在「数据」中选择多个展示指标。</p><Field label="系列堆叠"><Switch size="small" checked={appearance.stacked} onChange={stacked=>patchAppearance({stacked})} /></Field></>}
            </>}
            {selected.type==='line' && <><Field label="阶梯折线"><Switch size="small" checked={appearance.stepLine} onChange={stepLine=>patchAppearance({stepLine})} /></Field><Field label="连接空值" hint="开启后跨过空数据点连接折线。"><Switch size="small" checked={appearance.connectNulls} onChange={connectNulls=>patchAppearance({connectNulls})} /></Field><Field label="面积填充"><Switch size="small" checked={appearance.areaFill} onChange={areaFill=>patchAppearance({areaFill})} /></Field><Field label="线条样式"><OptionPicker value={appearance.lineType} options={[{value:'solid',label:'实线'},{value:'dashed',label:'虚线'},{value:'dotted',label:'点线'}]} onChange={lineType=>patchAppearance({lineType:lineType as NonNullable<AnalyticsWidgetAppearance['lineType']>})} /></Field><Field label="平滑曲线"><Switch size="small" checked={appearance.smooth} onChange={smooth=>patchAppearance({smooth})} /></Field><Field label="线条宽度"><InputNumber min={1} max={8} step={.5} value={appearance.lineWidth} suffix="px" onChange={value=>patchAppearance({lineWidth:value ?? 2.5})} /></Field><Field label="显示数据点"><Switch size="small" checked={appearance.showSymbol} onChange={showSymbol=>patchAppearance({showSymbol})} /></Field>{appearance.showSymbol && <><Field label="数据点形状"><OptionPicker value={appearance.symbolShape} options={[{value:'circle',label:'圆形'},{value:'rect',label:'方形'},{value:'diamond',label:'菱形'},{value:'triangle',label:'三角形'}]} onChange={symbolShape=>patchAppearance({symbolShape:symbolShape as AnalyticsWidgetAppearance['symbolShape']})} /></Field><Field label="数据点大小"><InputNumber min={0} max={16} value={appearance.symbolSize} suffix="px" onChange={value=>patchAppearance({symbolSize:value ?? 6})} /></Field></>}</>}
            {selected.type==='bar' && <><Field label="柱条方向"><OptionPicker value={appearance.horizontal?'horizontal':'vertical'} options={[{value:'vertical',label:'纵向柱状'},{value:'horizontal',label:'横向条形'}]} onChange={value=>patchAppearance({horizontal:value==='horizontal'})} /></Field><Field label="柱间距"><InputNumber min={0} max={100} suffix="%" value={appearance.barGap} onChange={value=>patchAppearance({barGap:value ?? 30})} /></Field><Field label="最大柱宽"><InputNumber min={8} max={80} value={appearance.barWidth} suffix="px" onChange={value=>patchAppearance({barWidth:value ?? 42})} /></Field></>}
            {selected.type==='pie' && <><Field label="玫瑰图"><Switch size="small" checked={appearance.pieRose} onChange={pieRose=>patchAppearance({pieRose})} /></Field><Field label="水平中心"><InputNumber min={10} max={90} suffix="%" value={appearance.pieCenterX} onChange={value=>patchAppearance({pieCenterX:value ?? 50})} /></Field><Field label="垂直中心"><InputNumber min={10} max={90} suffix="%" value={appearance.pieCenterY} onChange={value=>patchAppearance({pieCenterY:value ?? 55})} /></Field><Field label="起始角度"><InputNumber min={0} max={360} suffix="°" value={appearance.pieStartAngle} onChange={value=>patchAppearance({pieStartAngle:value ?? 90})} /></Field><Field label="内圈半径" hint="0% 显示为饼图，内圈始终小于外圈。"><InputNumber min={0} max={appearance.pieOuterRadius-10} value={appearance.pieInnerRadius} suffix="%" onChange={value=>patchAppearance({pieInnerRadius:value ?? 48})} /></Field><Field label="外圈半径"><InputNumber min={40} max={90} value={appearance.pieOuterRadius} suffix="%" onChange={value=>patchAppearance({pieOuterRadius:value ?? 70})} /></Field></>}
            </PropertyGroup>
            <PropertyGroup key="图例" title="图例" section="style" className="analytics-appearance-group" defaultOpen={false}>
              <Field label="显示图例"><Switch size="small" checked={appearance.showLegend} onChange={showLegend=>patchAppearance({showLegend})} /></Field>{appearance.showLegend && <>            <Field label="图例位置"><OptionPicker value={appearance.legendPosition} options={['top','bottom','left','right'].map((value,index)=>({value,label:['顶部','底部','左侧','右侧'][index]}))} onChange={legendPosition=>patchAppearance({legendPosition:legendPosition as NonNullable<AnalyticsWidgetAppearance['legendPosition']>})} /></Field>
              <Field label="排列方向"><OptionPicker value={appearance.legendOrient} defaultValue="auto" options={[{value:'auto',label:'自动'},{value:'horizontal',label:'横向'},{value:'vertical',label:'纵向'}]} onChange={legendOrient=>patchAppearance({legendOrient:legendOrient as NonNullable<AnalyticsWidgetAppearance['legendOrient']>})} /></Field>
              <Field label="图例字号"><InputNumber min={10} max={20} suffix="px" value={appearance.legendFontSize} onChange={value=>patchAppearance({legendFontSize:value ?? 11})} /></Field>
              <Field label="图例间距"><InputNumber min={4} max={32} suffix="px" value={appearance.legendItemGap} onChange={value=>patchAppearance({legendItemGap:value ?? 10})} /></Field>
              <Field label="点击切换"><Switch size="small" checked={appearance.legendSelectable} onChange={legendSelectable=>patchAppearance({legendSelectable})} /></Field>
            </>}
            </PropertyGroup>
            <PropertyGroup key="数值标签" title="数值标签" section="style" className="analytics-appearance-group" defaultOpen={false}>
              <Field label="数值标签"><Switch size="small" checked={appearance.showLabels} onChange={showLabels=>patchAppearance({showLabels})} /></Field>{appearance.showLabels && <>{selected.type==='pie' && <Field label="标签内容" hint="占比为扇区在当前图表总值中的比例。"><OptionPicker value={appearance.pieLabelContent} options={[{value:'value',label:'名称与数值'},{value:'percent',label:'名称与占比'},{value:'both',label:'名称、数值与占比'}]} onChange={pieLabelContent=>patchAppearance({pieLabelContent:pieLabelContent as AnalyticsWidgetAppearance['pieLabelContent']})} /></Field>}<Field label="标签字号"><InputNumber min={10} max={20} suffix="px" value={appearance.labelFontSize} onChange={value=>patchAppearance({labelFontSize:value ?? 11})} /></Field><Field label="标签位置"><OptionPicker value={appearance.labelPosition} options={selected.type==='pie'?[{value:'outside',label:'外侧'},{value:'inside',label:'内侧'}]:[{value:'top',label:'上方'},{value:'inside',label:'内部'},{value:'bottom',label:'下方'},...(selected.type==='bar'?[{value:'right',label:'右侧'}]:[])]} onChange={labelPosition=>patchAppearance({labelPosition:labelPosition as NonNullable<AnalyticsWidgetAppearance['labelPosition']>})} /></Field></>}
            </PropertyGroup>
            {selected.type!=='pie' && <>
            <PropertyGroup key="坐标与网格" title="坐标与网格" section="style" className="analytics-appearance-group" defaultOpen={false}>
              {selected.type!=='pie' && <><Field label="网格辅助线"><Switch size="small" checked={appearance.showGrid} onChange={showGrid=>patchAppearance({showGrid})} /></Field>{appearance.showGrid && <DependentOptions title="网格线设置" defaultOpen={false}><Field label="线条样式"><OptionPicker value={appearance.gridLineType} defaultValue="dashed" options={[{value:'solid',label:'实线'},{value:'dashed',label:'虚线'},{value:'dotted',label:'点线'}]} onChange={gridLineType=>patchAppearance({gridLineType:gridLineType as NonNullable<AnalyticsWidgetAppearance['gridLineType']>})} /></Field></DependentOptions>}<Field label="坐标轴标签"><Switch size="small" checked={appearance.showAxisLabels} onChange={showAxisLabels=>patchAppearance({showAxisLabels})} /></Field>{appearance.showAxisLabels && <DependentOptions title="坐标文字设置" defaultOpen={false}><Field label="坐标字号"><InputNumber min={10} max={20} suffix="px" value={appearance.axisLabelFontSize} onChange={value=>patchAppearance({axisLabelFontSize:value ?? 11})} /></Field><Field label="文字旋转"><InputNumber min={0} max={90} suffix="°" value={appearance.axisLabelRotate} onChange={value=>patchAppearance({axisLabelRotate:value ?? 0})} /></Field></DependentOptions>}</>}
            </PropertyGroup>
            </>}
            <PropertyGroup key="提示与动画" title="提示与动画" section="style" defaultOpen={false}>
              <Field label="悬停提示"><Switch size="small" checked={appearance.showTooltip} onChange={showTooltip=>patchAppearance({showTooltip})} /></Field>
              <Field label="图表动画"><Switch size="small" checked={appearance.animate} onChange={animate=>patchAppearance({animate})} /></Field>
              {selected.type!=='pie' && <Field label="滚轮缩放" hint="在图表内滚轮缩放维度范围，拖动平移；不改变数据筛选条件。"><Switch size="small" checked={appearance.enableZoom} onChange={enableZoom=>patchAppearance({enableZoom})} /></Field>}
            </PropertyGroup>
            <PropertyGroup key="文字样式" title="文字样式" section="style" className="analytics-appearance-group" defaultOpen={false}>
            <Field label="图表字体"><OptionPicker value={appearance.chartFontFamily} options={fontOptions.filter(option=>option.value!=='inherit')} onChange={chartFontFamily=>patchAppearance({chartFontFamily})} /></Field>
            <Field label="文字颜色">{colorControl('chartTextColor')}</Field>
            </PropertyGroup>
            {selected.type!=='pie' && <>
            <PropertyGroup key="绘图区边距" title="绘图区边距" section="style" className="analytics-appearance-group" defaultOpen={false}>
            {(['Top','Bottom','Left','Right'] as const).map((side,index)=><Field key={side} label={['顶部边距','底部边距','左侧边距','右侧边距'][index]}><InputNumber min={0} max={160} suffix="px" placeholder="自动" value={appearance[`grid${side}`]} onChange={value=>patchAppearance({[`grid${side}`]:value ?? undefined})} /></Field>)}
            </PropertyGroup>
            </>}
          </>}
          {['detail-table','rank-table'].includes(selected.type) && <>
            <PropertyGroup title="表格布局" section="style">
            <div className="analytics-appearance-switches"><Field label="显示表头"><Switch size="small" checked={appearance.showTableHeader} onChange={showTableHeader=>patchAppearance({showTableHeader})} /></Field><Field label="斑马纹"><Switch size="small" checked={appearance.tableStriped} onChange={tableStriped=>patchAppearance({tableStriped})} /></Field><Field label="单元格边框"><Switch size="small" checked={appearance.tableBordered} onChange={tableBordered=>patchAppearance({tableBordered})} /></Field></div>
            <Field label="行间密度"><OptionPicker defaultValue="standard" value={appearance.tableDensity as NonNullable<AnalyticsWidgetAppearance["tableDensity"]>} options={[{value:'compact',label:'紧凑'},{value:'standard',label:'标准'},{value:'comfortable',label:'宽松'}]} onChange={tableDensity=>patchAppearance({tableDensity})} /></Field>
            <Field label="单元格对齐"><OptionPicker value={appearance.tableAlign} options={[{value:'left',label:'左对齐'},{value:'center',label:'居中'},{value:'right',label:'右对齐'}]} onChange={tableAlign=>patchAppearance({tableAlign})} /></Field>
            <Field label="分页显示"><Switch size="small" checked={appearance.tablePagination} onChange={tablePagination=>patchAppearance({tablePagination})} /></Field>{appearance.tablePagination && <Field label="每页行数"><InputNumber min={5} max={100} value={appearance.tablePageSize} onChange={value=>patchAppearance({tablePageSize:value ?? 10})} /></Field>}
            <Field label="显示序号"><Switch size="small" checked={appearance.tableRowNumbers} onChange={tableRowNumbers=>patchAppearance({tableRowNumbers})} /></Field>
            <Field label="表头对齐"><Select allowClear placeholder="跟随单元格" value={appearance.tableHeaderAlign} options={[{value:'left',label:'左对齐'},{value:'center',label:'居中'},{value:'right',label:'右对齐'}]} onChange={tableHeaderAlign=>patchAppearance({tableHeaderAlign:tableHeaderAlign as AnalyticsWidgetAppearance['tableHeaderAlign']})} /></Field>
            <Field label="滚动区高度" hint="留空按内容展开；设置后固定表头并在表体内滚动。"><InputNumber min={120} max={800} suffix="px" placeholder="自动" value={appearance.tableScrollHeight} onChange={value=>patchAppearance({tableScrollHeight:value ?? undefined})} /></Field>
            <Field label="文字换行"><Switch size="small" checked={appearance.tableWrap} onChange={tableWrap=>patchAppearance({tableWrap})} /></Field>
            </PropertyGroup>
            <PropertyGroup title="列与字段" section="style" defaultOpen={false}>
              <Field label="展示字段" hint="留空展示全部字段；按选择顺序排列。"><Select mode="multiple" allowClear value={appearance.tableColumns} placeholder="全部字段" options={tableColumnOptions} onChange={tableColumns=>patchAppearance({tableColumns:tableColumns.length?tableColumns:undefined})} /></Field>
              <Field label="统一列宽" hint="留空自适应；字段较多时可横向滚动。"><InputNumber min={60} max={600} suffix="px" placeholder="自动" value={appearance.tableColumnWidth} onChange={value=>patchAppearance({tableColumnWidth:value ?? undefined})} /></Field>
            </PropertyGroup>
            {selected.type==='rank-table' && <PropertyGroup title="排行规则" section="style" defaultOpen={false}>
              <p className="analytics-property-note">按第一个绑定指标排序，在当前返回的数据范围内取前几名。</p>
              <Field label="升序排列"><Switch size="small" checked={appearance.rankAscending} onChange={rankAscending=>patchAppearance({rankAscending})} /></Field>
              <Field label="展示前几名"><InputNumber min={1} max={500} placeholder="全部" value={appearance.rankLimit} onChange={value=>patchAppearance({rankLimit:value ?? undefined})} /></Field>
            </PropertyGroup>}
            <PropertyGroup title="文字与表头" section="style" defaultOpen={false}>
              <Field label="文字字号"><InputNumber min={10} max={24} suffix="px" value={appearance.tableFontSize} onChange={value=>patchAppearance({tableFontSize:value ?? 12})} /></Field>
              <Field label="文字字体"><OptionPicker value={appearance.chartFontFamily} options={fontOptions.filter(option=>option.value!=='inherit')} onChange={chartFontFamily=>patchAppearance({chartFontFamily})} /></Field>
              <Field label="文字颜色">{colorControl('chartTextColor')}</Field>
              {appearance.showTableHeader && <Field label="表头背景">{colorControl('tableHeaderColor')}</Field>}
            </PropertyGroup>
          </>}
          {selected.type==='metric-card' && <>
            <PropertyGroup title="指标内容" section="style" className="analytics-appearance-group" defaultOpen={false}>
            <Field label="显示指标名称"><Switch size="small" checked={appearance.showMetricLabel} onChange={showMetricLabel=>patchAppearance({showMetricLabel})} /></Field>
            <Field label="名称字号"><InputNumber min={10} max={24} suffix="px" value={appearance.metricLabelSize} onChange={value=>patchAppearance({metricLabelSize:value ?? 12})} /></Field>
            <Field label="数值颜色">{colorControl('metricValueColor')}</Field>
            <Field label="内容字体"><OptionPicker value={appearance.chartFontFamily} options={fontOptions.filter(option=>option.value!=='inherit')} onChange={chartFontFamily=>patchAppearance({chartFontFamily})} /></Field>
            <Field label="数值字号"><InputNumber min={16} max={64} suffix="px" value={appearance.valueFontSize} onChange={value=>patchAppearance({valueFontSize:value ?? 30})} /></Field>
            <Field label="内容对齐"><OptionPicker value={appearance.contentAlign} options={[{value:'left',label:'左对齐'},{value:'center',label:'居中'},{value:'right',label:'右对齐'}]} onChange={contentAlign=>patchAppearance({contentAlign})} /></Field>
            <Field label="内容内边距"><InputNumber min={0} max={40} suffix="px" value={appearance.contentPadding} onChange={value=>patchAppearance({contentPadding:value ?? 18})} /></Field>
            <Field label="指标卡间距"><InputNumber min={0} max={48} suffix="px" value={appearance.metricGap} onChange={value=>patchAppearance({metricGap:value ?? 16})} /></Field>
            <Field label="名称数值间距"><InputNumber min={0} max={32} suffix="px" value={appearance.metricLabelGap} onChange={value=>patchAppearance({metricLabelGap:value ?? 0})} /></Field>
            <Field label="每行指标数"><InputNumber min={1} max={6} placeholder="自适应" value={appearance.metricColumns} onChange={value=>patchAppearance({metricColumns:value ?? undefined})} /></Field>
          </PropertyGroup></>}
          {selected.type==='metric-card' && <p className="analytics-property-note">指标阈值颜色优先于组件配色。</p>}

      <PropertyGroup title="数据绑定" section="data" defaultOpen={activeWidgetTab==='data'}>
        <Field label="数据集" hint="切换后会清空指标，并清理不兼容的筛选与联动。"><Select value={selected.datasetId} placeholder="请选择数据集" options={datasetOptions} onChange={datasetId => updateWidget({datasetId,metricIds:[],dimension:datasets.find(dataset=>dataset.id===datasetId)?.dimensions?.[0]})} /></Field>
        <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => setDatasetDialog({dataset:selectedDataset})}>{selectedDataset ? '配置数据集' : '新增数据集'}</Button>
        {!datasets.length && <Alert type="info" message="先在「数据与指标」新增数据集。" />}
        <Field label="展示指标" hint={selected.type==='pie'?'环形图使用第一个指标。':selected.type==='rank-table'?'排行按第一个指标降序。':'仅可选择当前数据集的指标。'}><Select mode="multiple" value={selected.metricIds || []} placeholder="选择指标" options={metrics.filter(metric=>metric.datasetId===selected.datasetId).map(metric=>({value:metric.id,label:metric.name}))} onChange={metricIds=>updateWidget({metricIds})} /></Field>
        <Field label={selected.type==='metric-card'?'可选维度':selected.type==='detail-table'?'点击字段':'分组维度'} hint={selected.type==='metric-card'?'指标卡展示汇总值，不按维度分组。':'用于分组和点击时的筛选条件。'}><Select allowClear value={selected.dimension} placeholder="选择维度" options={dimensionOptions(selectedDataset)} onChange={dimension=>updateWidget({dimension})} /></Field>
        {!selectedDataset?.dimensions?.length && selectedDataset && <Alert type="info" message="尚未声明维度，可在「数据与指标」中添加。" />}
      </PropertyGroup>
        {!!selected.metricIds?.length && <PropertyGroup title="指标口径与引用" section="data" defaultOpen={false}>
          <div className="analytics-property-metric-rows">{metrics.filter(metric=>selected.metricIds?.includes(metric.id)).map(metric=><button type="button" className="analytics-property-metric-row" key={metric.id} disabled={disabled} title={`${metric.name} · ${metric.expression || '尚未定义公式'} · ${metric.sharedMetricId?'共享指标':'本地指标'}；双击编辑，或按 Enter`} aria-label={`编辑指标 ${metric.name}`} onDoubleClick={()=>setMetricDraft({...metric})} onKeyDown={event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();setMetricDraft({...metric});}}}><strong>{metric.name}</strong><code>{metric.expression || '尚未定义公式'}</code><small>{metric.sharedMetricId?'共享':'本地'} · {metric.format==='percent'?'百分比':metric.unit || '数值'}</small></button>)}</div>
          <p className="analytics-property-note">双击指标行编辑口径，修改会应用到本看板中引用它的组件。</p>
        </PropertyGroup>}
      <PropertyGroup title="交互行为" section="interaction" defaultOpen={activeWidgetTab==='interaction'}>
          <Field label="点击动作" hint="未配置下方联动时，动作作用于当前组件。"><OptionPicker value={selected.interaction || 'none'} disabled={disabled || selected.type === 'metric-card' || !selected.dimension} options={[{ value: 'none', label: '无动作' }, ...actionOptions]} onChange={interaction => updateWidget({ interaction })} /></Field>
          {(selected.type === 'metric-card' || !selected.dimension) && <Alert type="info" message={selected.type === 'metric-card' ? '指标卡用于展示汇总。点击联动适用于图表和表格。' : '先选择维度，才能按点击内容筛选或打开明细。'} />}
      </PropertyGroup>
      <PropertyGroup title="目标联动" section="interaction">
          <div className="analytics-editor-section-title"><strong>联动规则</strong><Button size="small" icon={<PlusOutlined />} disabled={disabled || !selected.dimension || !newTarget || selected.type === 'metric-card'} onClick={() => {
            if (newTarget) apply({ ...design, interactions: [...(design.interactions || []), { sourceWidgetId: selected.id, targetWidgetId: newTarget.value, action: filterTarget ? 'filter' : 'navigate' }] });
          }}>新增</Button></div>
          <p className="analytics-editor-help">有目标联动时优先执行这些规则。筛选、明细联动要求目标数据集具有相同维度。</p>
          {!links.length && <div className="analytics-editor-inline-empty">尚未配置目标联动</div>}
          {links.map(link => <div className="analytics-editor-link" key={link.index}>
            <Field label="联动动作"><OptionPicker value={link.action} options={actionOptions} onChange={action => {
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
          <Field label="显示格式"><OptionPicker value={metric.format || 'number'} options={[{ value: 'number', label: '数值' }, { value: 'percent', label: '百分比' }, { value: 'currency', label: '金额（¥）' }, { value: 'duration', label: '时长（秒）' }]} onChange={format => updateMetric(metric.id, { format })} /></Field>
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
      <PropertyGroup title="筛选设置" section="filters">
      <Field label="全局筛选字段"><Select mode="multiple" value={design.globalFilters || []} placeholder="选择筛选字段" options={[...dimensions.map(value => ({ value, label: labelFor(value) })), ...(dimensions.includes('date') ? [{ value: 'dateRange', label: '日期范围（date）' }] : [])]} onChange={globalFilters => apply({ ...design, globalFilters })} /></Field>
      {!dimensions.length && <Alert showIcon type="info" message="还没有可筛选的维度" description="在「数据与指标」中，选择来源表单并声明维度字段。" />}
      <Field label="筛选器布局"><OptionPicker value={String(style.filterTheme || 'toolbar')} options={[{ value: 'toolbar', label: '顶部工具栏' }, { value: 'inline', label: '嵌入画布' }, { value: 'panel', label: '侧边筛选面板' }]} onChange={filterTheme => updateStyle({ filterTheme })} /></Field>
      </PropertyGroup>
      <Alert type="info" message={embedded ? '配置字段后，直接使用左侧看板中的筛选器检验结果。' : '配置字段后，切换到「预览」即可检验筛选结果。'} />
    </>;
  };
  const renderStylePanel = () => <>
    <div className="analytics-editor-section-title"><strong>主题</strong><Typography.Text type="secondary">应用到整张看板</Typography.Text></div>
    <Field label="主题样式"><OptionPicker value={String(style.preset || 'clean')} defaultValue="clean" options={[{value:'clean',label:'简洁'},{value:'factory',label:'制造'},{value:'executive',label:'经营'},{value:'dark',label:'深色'}]} onChange={preset=>updateStyle({preset,background:({clean:'#f6f8fa',factory:'#edf4f5',executive:'#f1f3f8',dark:'#101c26'} as Record<string,string>)[preset],cardBorder:preset==='executive'?'strong':'light',chartPalette:preset==='executive'?'business':'manufacturing'})} /></Field>
    <div className="analytics-editor-section-title"><strong>方格纸 · 玻璃卡</strong><Typography.Text type="secondary">默认样式</Typography.Text></div>
    <Field label="方格尺寸"><InputNumber min={16} max={88} value={Number(style.gridSize ?? 44)} addonAfter="px" onChange={value => updateStyle({gridSize: value ?? 44})} /></Field>
    <Field label="卡片不透明度"><InputNumber min={30} max={100} value={Math.round(Number(style.cardOpacity ?? 0.78) * 100)} addonAfter="%" onChange={value => updateStyle({cardOpacity: (value ?? 78) / 100})} /></Field>
    <Field label="玻璃模糊"><InputNumber min={0} max={24} value={Number(style.cardBlur ?? 12)} addonAfter="px" onChange={value => updateStyle({cardBlur: value ?? 12})} /></Field>
    <Field label="画布背景"><Input value={String(style.background || '#f6f8fa')} placeholder="#f6f8fa" maxLength={50} onChange={event => updateStyle({ background: event.target.value })} /></Field>
    <div className="analytics-editor-two-fields"><Field label="组件间距"><InputNumber min={0} max={32} value={Number(style.componentGap ?? 16)} addonAfter="px" onChange={value => updateStyle({ componentGap: value ?? 0 })} /></Field><Field label="卡片圆角"><InputNumber min={0} max={20} value={Number(style.cardRadius ?? 12)} addonAfter="px" onChange={value => updateStyle({ cardRadius: value ?? 0 })} /></Field></div>
    <Field label="卡片边框"><OptionPicker defaultValue="light" value={String(style.cardBorder || 'light')} options={[{ value: 'none', label: '无边框' }, { value: 'light', label: '轻边框' }, { value: 'strong', label: '强调边框' }]} onChange={cardBorder => updateStyle({ cardBorder })} /></Field>
    <Field label="图表配色"><OptionPicker value={String(style.chartPalette || 'manufacturing')} options={[{ value: 'manufacturing', label: '制造蓝绿' }, { value: 'business', label: '经营彩色' }, { value: 'warning', label: '风险预警' }, { value: 'mono', label: '单色专业' }]} onChange={chartPalette => updateStyle({ chartPalette })} /></Field>
    <Field label="表格密度"><OptionPicker defaultValue="standard" value={String(style.tableDensity || 'standard')} options={[{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'comfortable', label: '宽松' }]} onChange={tableDensity => updateStyle({ tableDensity })} /></Field>
    <Field label="筛选器布局"><OptionPicker value={String(style.filterTheme || 'toolbar')} options={[{ value: 'toolbar', label: '顶部工具栏' }, { value: 'inline', label: '嵌入画布' }, { value: 'panel', label: '侧边筛选面板' }]} onChange={filterTheme => updateStyle({ filterTheme })} /></Field>
  </>;

  const Container = embedded ? 'section' : 'aside';
  const closeLabel = embedded ? '关闭看板配置' : '关闭配置侧栏';
  return <Container className={`property-inspector analytics-editor-panel${panel!=='library' ? ' analytics-editor-form-inspector' : ''}${embedded ? ' analytics-editor-panel-embedded' : ''}`} aria-label={embedded ? '看板配置' : panelTitles[panel]}>
    <div className="analytics-editor-heading">
    <PropertyInspectorHeader title={panel==='widget'?'组件属性':panelTitles[panel]} titleAccessory={headerStatus} actions={<>{panel==='widget' && selected && <><Button type="text" size="small" aria-label="复制组件" title="复制组件" disabled={disabled} icon={<CopyOutlined />} onClick={copyWidget} /><Button type="text" size="small" danger aria-label="删除组件" title="删除组件" disabled={disabled} icon={<DeleteOutlined />} onClick={removeWidget} /></>}{headerActions}{panel==='widget' && !embedded && navigation}{!embedded && <Button type="text" aria-label={closeLabel} title={closeLabel} icon={<CloseOutlined />} disabled={disabled} onClick={onClose} />}</>} />
    {status && <div className="analytics-editor-heading-status">{status}</div>}
    </div>
    {panel==='widget' && selected && <Tabs className="analytics-widget-tabs" size="small" activeKey={activeWidgetTab} onChange={changeWidgetTab} items={[{key:'basic',label:'基础'},{key:'style',label:'图表布局'},{key:'data',label:'数据'},{key:'interaction',label:'交互'}]} />}
    {panel!=='widget' && navigation && <nav className="analytics-editor-panel-navigation" aria-label="看板配置分类">{navigation}</nav>}
    <ConfigProvider componentDisabled={disabled}>
      <div className="analytics-editor-panel-body" ref={panelBodyRef}>
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
    {metricDraft && <Modal open title={metricDraft.sharedMetricId?'共享指标口径':'编辑指标口径'} okText="应用到看板" cancelText="取消" onCancel={()=>setMetricDraft(null)} okButtonProps={{disabled:disabled || !!metricDraft.sharedMetricId || !metricDraft.name.trim() || !metricDraft.expression?.trim()}} onOk={()=>{updateMetric(metricDraft.id,{name:metricDraft.name,expression:metricDraft.expression,format:metricDraft.format,unit:metricDraft.unit,description:metricDraft.description,threshold:metricDraft.threshold});setMetricDraft(null);}}>
      {metricDraft.sharedMetricId && <Alert type="info" message="共享指标沿用统一口径，请进入共享指标库修改。" action={onOpenMetricLibrary && <Button onClick={()=>{onOpenMetricLibrary(metricDraft.sharedMetricId);setMetricDraft(null);}}>管理共享口径</Button>} />}
      <ConfigProvider componentDisabled={disabled || !!metricDraft.sharedMetricId}>
        <Field label="指标名称"><Input value={metricDraft.name} maxLength={80} onChange={event=>setMetricDraft({...metricDraft,name:event.target.value})} /></Field>
        <Field label="计算公式"><Input.TextArea value={metricDraft.expression} maxLength={512} autoSize={{minRows:2,maxRows:6}} onChange={event=>setMetricDraft({...metricDraft,expression:event.target.value})} /></Field>
        <Field label="显示格式"><OptionPicker value={metricDraft.format || 'number'} options={[{value:'number',label:'数值'},{value:'percent',label:'百分比'},{value:'currency',label:'金额（¥）'},{value:'duration',label:'时长（秒）'}]} onChange={format=>setMetricDraft({...metricDraft,format})} /></Field>
        <Field label="显示单位"><Input value={metricDraft.unit} maxLength={20} onChange={event=>setMetricDraft({...metricDraft,unit:event.target.value})} /></Field>
        <Field label="业务口径说明"><Input.TextArea value={metricDraft.description} maxLength={500} onChange={event=>setMetricDraft({...metricDraft,description:event.target.value})} /></Field>
        <Field label="阈值颜色"><Input value={metricDraft.threshold} placeholder="红色 > 100" onChange={event=>setMetricDraft({...metricDraft,threshold:event.target.value})} /></Field>
      </ConfigProvider>
      <p className="analytics-editor-help">应用后进入当前看板草稿，保存并发布后生效。</p>
    </Modal>}
    {datasetDialog && <AnalyticsDatasetDialog programId={programId} dataset={datasetDialog.dataset} design={design} forms={forms} formsLoading={formsLoading} disabled={disabled} loadFields={loadFields} onApply={applyDataset} onClose={() => setDatasetDialog(null)} />}
    <footer className="analytics-editor-panel-footer">{actions ?? '更改暂存于当前编辑会话 · 保存草稿后保留'}</footer>
  </Container>;
}
