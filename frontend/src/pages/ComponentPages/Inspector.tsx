import PresentationSettings from './PresentationSettings';
import {inspectorTabs} from './inspectorCapabilities';
import {resolvePresentation} from './presentation';
import InspectorTabs from '@/components/PropertyInspector/InspectorTabs';
import ToolbarGroups, {PropertySubgroup} from './ToolbarGroups';
import OptionPicker from '@/components/OptionPicker';
import type {AddableWidgetType} from './componentOperations';
import BusinessProperties from './BusinessProperties';
import FilterSchemes from './FilterSchemes';
import {useListConfigurationPreview} from './ListConfigurationPreview';
import type {ViewConfig} from '@/utils/viewConfig';
import React, {useLayoutEffect, useRef, useState} from 'react';
import {Alert, Button, ConfigProvider, Empty, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Switch, ColorPicker, Typography} from 'antd';
import {BarChartOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, FilterOutlined, NumberOutlined, PlusOutlined, SkinOutlined, TableOutlined} from '@/components/Icon/ant';
import {PropertyInspectorHeader, PropertyHelp, PropertyGroup, PropertyRow, PropertyAdvanced} from '@/components/PropertyInspector';
import type {PlatformForm, PlatformFormField} from '@/services/api';
import {APPROVAL_STATUS_FIELD, APPROVAL_STATUS_LABEL, isRecordMetadataField, RECORD_METADATA_FIELDS} from './businessComponents';
import {bindWidgetSource, heightPercentStops, setSharedFilterTargets, sharedFilterTargetOptions, widgetSourceId, type PageDefinition, type PageWidget} from './model';
import {planWidgetSourceChange, widgetSourceChangeImpact} from './widgetSourceImpact';
import {widgetFontOptions, widgetPalettes} from '../AppPrograms/analyticsWidgetAppearance';
import '../AppPrograms/analytics-editor-panel.css';

export type Panel = 'widget' | 'style' | 'filters' | 'add' | 'compatibility';
export type BusinessTab = 'form' | 'flow';
export type WidgetTab = 'basic' | 'data' | BusinessTab;
type SourceChangeRequest = {widgetId:string;formId:number;filterTargets?:string[]};
const textAlignmentOptions = [
  {value:'left',label:'左对齐'},
  {value:'center',label:'居中'},
  {value:'right',label:'右对齐'},
] as const;

function usesListOnlyFilterFields(widget: PageWidget) {
  const settings = widget.filterSettings;
  const selectedFields = settings?.schemes == null
    ? [...(widget.filterFields??[]),...(settings?.requiredFields??[])]
    : settings.schemes.flatMap(scheme=>scheme.groups.flatMap(group=>group.columns??[]));
  return selectedFields.some(field=>field===APPROVAL_STATUS_FIELD||isRecordMetadataField(field));
}
export function pageSections(hasDefaultSource:boolean): Array<{key: Panel; label: string; icon: React.ReactNode}> {
  const items: Array<{key: Panel; label: string; icon: React.ReactNode}> = [{key:'style',label:'页面与布局',icon:<SkinOutlined />}];
  if (hasDefaultSource) items.push({key:'filters',label:'全局筛选',icon:<FilterOutlined />});
  items.push({key:'add',label:'添加组件',icon:<PlusOutlined />});
  return items;
}
export const componentTypes = [
  {type:'record-list' as AddableWidgetType,label:'业务列表',description:'分页、录入、详情和审批',icon:<TableOutlined />},
  {type:'metric' as AddableWidgetType,label:'指标卡',description:'展示记录数或数值汇总',icon:<NumberOutlined />},
  {type:'chart' as AddableWidgetType,label:'分组图表',description:'柱状、折线、环形图和排行',icon:<BarChartOutlined />},
  {type:'record-filter' as AddableWidgetType,label:'联动筛选',description:'一组查询条件控制多个同源组件',icon:<FilterOutlined />},
];

interface Props {
  workspace?: boolean;
  panel: Panel;
  tab: WidgetTab;
  definition: PageDefinition;
  selected?: string;
  propertyTarget?: {section:'appearance'|'interaction'};
  fields: PlatformFormField[];
  forms: PlatformForm[];
  publishedSource?: {form?:PlatformForm; error?:string};
  roles: Array<{id:number;name:string;label?:string}>;
  disabled: boolean;
  sourceOpen: boolean;
  sourceSlots?:Record<'properties'|'actions'|'status',React.RefCallback<HTMLDivElement>>;
  sourceIsBusiness: boolean;
  savedPageSource?: boolean;
  savedPageAccess?: boolean;
  approvalStatusAvailable?: boolean;
  approvalStatusDefaultVisible?: boolean;
  onPanel: (panel: Panel) => void;
  onTab: (tab: WidgetTab) => void;
  onSelect: (id: string) => void;
  readWidgetSize: (id: string, axis: 'width' | 'height') => number | undefined;
  onChange: (definition: PageDefinition) => void;
  onAdd: (type: AddableWidgetType) => void;
  onBusiness: (tab: BusinessTab) => void;
  onClose: () => void;
  headerStatus?: React.ReactNode;
  headerActions?: React.ReactNode;
  status?: React.ReactNode;
}

export default function Inspector(props: Props) {
  const {panel:requestedPanel,tab:requestedTab,definition,fields,forms,roles,disabled,sourceOpen,onPanel,onTab,onChange,onAdd,onSelect,propertyTarget} = props;
  const hasPageSource = definition.sourceFormId != null;
  const hasLegacySource = hasPageSource || props.savedPageSource;
  const hasLegacyAccess = Boolean(definition.roleIds?.length) || props.savedPageAccess;
  const panel = requestedPanel==='filters' && !hasPageSource ? 'style' : requestedPanel;
  const widget = definition.widgets.find(item => item.id === props.selected);
  const usesPageFilters = hasPageSource && widgetSourceId(definition, widget) === definition.sourceFormId;
  const tabs = inspectorTabs(widget?.type, props.sourceIsBusiness, sourceOpen);
  const tab = tabs.some(item=>item.key===requestedTab) ? requestedTab : 'basic';
  const panelKey = panel==='widget' ? `${widget?.id}:${tab}` : panel;
  const [sourceChangeRequest,setSourceChangeRequest] = useState<SourceChangeRequest>();
  const panelBody = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const visitedTarget = useRef<Props['propertyTarget']>();
  const preview = useListConfigurationPreview(widget?.id);
  useLayoutEffect(()=>{
    if(panelBody.current)panelBody.current.scrollTop=scrollPositions.current.get(panelKey)??0;
    setSourceChangeRequest(undefined);
  },[panelKey]);
  useLayoutEffect(()=>{
    const body = panelBody.current;
    if (!body || panel !== 'widget' || tab !== 'basic' || !propertyTarget || visitedTarget.current === propertyTarget) return;
    const match = body.querySelector<HTMLElement>(`[data-property-section="${propertyTarget.section}"]`);
    const group = match instanceof HTMLDetailsElement ? match : match?.querySelector('details');
    if (!group) return;
    visitedTarget.current = propertyTarget;
    group.open = true;
    body.scrollTop += group.getBoundingClientRect().top - body.getBoundingClientRect().top;
    group.querySelector('summary')?.focus({preventScroll:true});
  },[panelKey,panel,tab,propertyTarget]);
  const options = fields.map(field => ({label:field.label,value:field.field_name}));
  const sourceView = forms.find(form => form.id === (panel === 'widget' ? widgetSourceId(definition, widget) : definition.sourceFormId))?.config?.viewConfig as ViewConfig | undefined;
  const publishedForm = props.publishedSource?.form;
  const publishedView = publishedForm?.config?.viewConfig as ViewConfig | undefined;
  const listActionsView = publishedForm ? publishedView?.tabs?.[0] ?? publishedView : sourceView;
  const publishedFields = publishedForm?.fields?.filter(field=>!field.archived) ?? [];
  const numeric = fields.filter(field => /^(int|integer|float|decimal|number)$/.test(field.field_type)).map(field => ({label:field.label,value:field.field_name}));
  const update = (value: Partial<PageWidget>) => widget && onChange({...definition,widgets:definition.widgets.map(item=>item.id===widget.id?{...item,...value}:item)});
  const fixedWidth = widget?.customWidth != null;
  const fixedHeight = widget?.customHeight != null;
  const proportionalHeight = !fixedHeight && widget?.heightPercent != null;
  const setSizeMode = (axis: 'width' | 'height', mode: 'auto' | 'fixed') => {
    if (!widget) return;
    const [field, min, max, fallback] = axis === 'width'
      ? ['customWidth', 160, 3840, 640] as const
      : ['customHeight', 120, 3000, 360] as const;
    const size = props.readWidgetSize(widget.id, axis) || fallback;
    update({[field]: mode === 'fixed' ? Math.max(min, Math.min(max, size)) : null,
      ...(axis === 'height' ? {heightPercent:null} : {})});
  };
  const appearance = widget?.appearance || {};
  const patchAppearance = (value: Partial<NonNullable<PageWidget['appearance']>>) => update({appearance:{...appearance,...value}});
  const updateStyle = (value: Partial<NonNullable<PageDefinition['style']>>) => onChange({...definition,style:{...definition.style,...value}});
  const statistical = widget?.type === 'chart' || widget?.type === 'metric';
  const seriesChart = widget?.type === 'chart' && widget.chartType !== 'rank-table';
  const formulaActive = Boolean(widget?.expression || widget?.sharedMetricId);
  const filterSourceId = widget?.type==='record-filter' ? widgetSourceId(definition, widget) : undefined;
  const filterTargets = widget?.type==='record-filter' ? sharedFilterTargetOptions(definition,widget) : [];
  const linkedFilterTargets = filterTargets.filter(item=>widget?.targetWidgetIds?.includes(item.id)&&widgetSourceId(definition,item)===filterSourceId);
  const listOnlyFields = widget?.type==='record-filter' && usesListOnlyFilterFields(widget);
  const filterTargetSources = new Set(filterTargets.map(item=>widgetSourceId(definition,item)));
  const formName = (formId:number|undefined) => forms.find(form=>form.id===formId)?.name ?? (formId==null?'待选择目标':`来源 ${formId}`);
  const filterTargetOptions = filterTargets.map(item=>{
    const formId = widgetSourceId(definition,item);
    return {
      value:item.id,
      label:filterTargetSources.size>1 ? item.title+' · '+formName(formId) : item.title,
      disabled:listOnlyFields&&item.type!=='record-list'&&formId===filterSourceId&&!widget?.targetWidgetIds?.includes(item.id),
    };
  });
  const canChooseAllTargets = filterTargetSources.size===1 && filterTargetOptions.some(option=>!option.disabled);
  const hasBlockedFilterTargets = filterTargetOptions.some(option=>option.disabled);
  const onlyListTargets = linkedFilterTargets.length>0 && linkedFilterTargets.every(target=>target.type==='record-list');
  const approvalFilter = publishedForm && (publishedForm.runtime_approval_available ?? publishedForm.runtime_submission_available)
    ? [{value:APPROVAL_STATUS_FIELD,label:APPROVAL_STATUS_LABEL,system:true,choice:false}] : [];
  const filterRemovalWarning = linkedFilterTargets.length > 0
    ? `发布页面后，${linkedFilterTargets.length} 个联动组件将不再接收此筛选条件。`
    : undefined;
  const updateFilter = (value: Partial<PageWidget>) => update({...value,standaloneFilter:true});
  const sourceChange = sourceChangeRequest && (() => {
    const {widgetId,formId,filterTargets} = sourceChangeRequest;
    if (!filterTargets) return planWidgetSourceChange(definition,widgetId,formId);
    const next = setSharedFilterTargets(definition,widgetId,filterTargets);
    return {definition:next,impacts:widgetSourceChangeImpact(definition,next,widgetId)};
  })();
  const changeWidgetSource = (formId:number) => {
    if (!widget) return;
    const plan = planWidgetSourceChange(definition,widget.id,formId);
    if (plan.impacts.length) setSourceChangeRequest({widgetId:widget.id,formId});
    else onChange(plan.definition);
  };
  const changeFilterTargets = (targetIds:string[]) => {
    if (!widget) return;
    const next = setSharedFilterTargets(definition,widget.id,targetIds);
    const nextSource = widgetSourceId(next,next.widgets.find(item=>item.id===widget.id));
    if (nextSource!=null && nextSource!==filterSourceId && widgetSourceChangeImpact(definition,next,widget.id).length) {
      setSourceChangeRequest({widgetId:widget.id,formId:nextSource,filterTargets:targetIds});
    } else onChange(next);
  };
  const copyWidget = () => {
    if (!widget) return;
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const copy = {...structuredClone(widget),id,title:widget.title+' 副本',...(widget.type==='record-filter'?{standaloneFilter:true}:{})};
    onChange({...definition,widgets:definition.widgets.flatMap(item=>item.id===widget.id?[item,copy]:[item])});
    onSelect(id);
  };
  const removeWidget = (id:string) => {
    const widgets = definition.widgets.filter(item=>item.id!==id).map(item=>{
      if (!item.targetWidgetIds?.includes(id)) return item;
      const targetWidgetIds = item.targetWidgetIds.filter(target=>target!==id);
      return {...item,targetWidgetIds,...(item.type==='record-filter'&&item.targetWidgetIds.length>1?{standaloneFilter:true}:{})};
    });
    onChange({...definition,widgets});
  };
  const paletteNames = {manufacturing:'制造蓝绿', business:'经营彩色', warning:'风险预警', mono:'单色专业'};
  const paletteSetting = <PropertyRow label="组件配色">
    <OptionPicker value={appearance.palette||'inherit'}
      options={[{value:'inherit',label:'跟随页面主题'},...Object.keys(widgetPalettes).map(value=>({value,label:paletteNames[value as keyof typeof paletteNames]}))]}
      onChange={value=>patchAppearance({palette:value==='inherit'?undefined:value as keyof typeof paletteNames})} />
  </PropertyRow>;
  let content: React.ReactNode;
  if (panel === 'widget' && (tab === 'form' || tab === 'flow')) content = <div className="component-source-properties form-designer-embedded" ref={props.sourceSlots?.properties}/>;
  else if (panel === 'widget') content = widget ? <>

    {tab === 'basic' && <>
      <PropertyGroup title="基本信息"><PropertyRow label="组件名称" hint="同时用作画布标题；在标题与操作区设置是否显示及文字样式。"><Input maxLength={100} value={widget.title} onChange={event=>update({title:event.target.value})} /></PropertyRow><PropertyRow label="组件类型"><OptionPicker value={widget.type} disabled options={[...componentTypes, ...(props.workspace ? [{type:'workspace' as AddableWidgetType,label:'工作台模块',description:'待办、未完成工作、业务表单与最近工作',icon:<DatabaseOutlined />}]:[])].map(item=>({value:item.type,label:item.label}))} onChange={()=>{}} /></PropertyRow></PropertyGroup>
      <PresentationSettings value={widget.presentation} resolved={resolvePresentation(definition,widget)} onChange={presentation=>update({presentation})} recordList={widget.type==='record-list'} layout={<>
        <PropertyRow label="宽度模式">
          <Segmented<'auto' | 'fixed'> block size="small" disabled={disabled||sourceOpen} value={fixedWidth?'fixed':'auto'}
            options={[{value:'auto',label:'按占比'},{value:'fixed',label:'固定'}]} onChange={mode=>setSizeMode('width',mode)} />
        </PropertyRow>
        <PropertyRow label="固定宽度" hint="在固定模式下按像素设置，最大为画布可用宽度。">
          <InputNumber min={160} max={3840} precision={0} suffix="px" placeholder="按占比" disabled={!fixedWidth}
            value={widget.customWidth??null} onChange={customWidth=>{if(customWidth!==null)update({customWidth});}} />
        </PropertyRow>
        <PropertyRow label="布局占比" hint="选择「按占比」后可调整。画布较窄时，按占比布局自动切为整行。">
          <OptionPicker numericValues={[25,33.33,50,75,100]} value={String(widget.width)} disabled={fixedWidth}
            options={[{value:'6',label:'25%'},{value:'8',label:'33%'},{value:'12',label:'50%'},{value:'18',label:'75%'},{value:'24',label:'整行'}]}
            onChange={value=>update({width:Number(value) as PageWidget['width']})} />
        </PropertyRow>
        <PropertyRow label="高度模式">
          <Segmented<'auto' | 'percent' | 'fixed'> className="component-height-mode" block size="small" disabled={disabled||sourceOpen} value={fixedHeight?'fixed':proportionalHeight?'percent':'auto'}
            options={[{value:'auto',label:'随内容'},{value:'percent',label:'按占比'},{value:'fixed',label:'固定'}]}
            onChange={mode=>mode==='percent' ? update({customHeight:null,heightPercent:100}) : setSizeMode('height',mode)} />
        </PropertyRow>
        <PropertyRow label="固定高度" hint="选择「固定」后可按像素设置组件高度。">
          <InputNumber min={120} max={3000} precision={0} suffix="px" placeholder={proportionalHeight?'按占比':'随内容'} disabled={!fixedHeight}
            value={widget.customHeight??null} onChange={customHeight=>{if(customHeight!==null)update({customHeight});}} />
        </PropertyRow>
        {proportionalHeight&&<PropertyRow label="高度占比" hint="以当前画布的可用高度为基准。窗口变化时，高度随之调整。">
          <OptionPicker numericValues={[...heightPercentStops]} value={String(widget.heightPercent)}
            options={heightPercentStops.map(value=>({value:String(value),label:`${value}%`}))}
            onChange={value=>update({heightPercent:Number(value) as NonNullable<PageWidget['heightPercent']>})} />
        </PropertyRow>}
      </>} titleSettings={<>
            <PropertyRow label="标题字号">
              <InputNumber min={10} max={24} precision={0} suffix="px" value={appearance.titleFontSize??12} onChange={value=>patchAppearance({titleFontSize:value??12})} />
            </PropertyRow>
            <PropertyRow label="标题字体">
              <Select value={appearance.titleFontFamily??'inherit'} options={widgetFontOptions} onChange={titleFontFamily=>patchAppearance({titleFontFamily})} />
            </PropertyRow>
            <PropertyRow label="标题颜色">
              <ColorPicker value={appearance.titleColor??''} disabledAlpha allowClear showText onClear={()=>patchAppearance({titleColor:undefined})}
                onChange={color=>patchAppearance({titleColor:color.toHexString()})} />
            </PropertyRow>
            <PropertyRow label="标题字重">
              <Select<'inherit' | 'normal' | 'bold'> value={appearance.titleWeight??'inherit'} options={[{value:'inherit',label:'跟随主题'},{value:'normal',label:'常规'},{value:'bold',label:'加粗'}]}
                onChange={value=>patchAppearance({titleWeight:value==='normal'||value==='bold'?value:undefined})} />
            </PropertyRow>
            <PropertyRow label="标题斜体">
              <Switch size="small" checked={appearance.titleItalic===true} onChange={titleItalic=>patchAppearance({titleItalic})} />
            </PropertyRow>
            <PropertyRow label="标题对齐">
              <Select value={appearance.titleAlign??'left'} options={[...textAlignmentOptions]} onChange={titleAlign=>patchAppearance({titleAlign})} />
            </PropertyRow>
            <PropertyRow label="标题下间距">
              <InputNumber min={0} max={40} precision={0} suffix="px" value={appearance.titleGap??0} onChange={value=>patchAppearance({titleGap:value??0})} />
            </PropertyRow>
      </>} descriptionSettings={<>
          <PropertyRow label="组件说明">
            <Input.TextArea value={appearance.subtitle} maxLength={160} placeholder="填写组件用途或数据范围" autoSize={{minRows:2,maxRows:4}}
              onChange={event=>patchAppearance({subtitle:event.target.value})} />
          </PropertyRow>
            <PropertyRow label="说明字号">
              <InputNumber min={10} max={24} precision={0} suffix="px" value={appearance.subtitleFontSize??12} onChange={value=>patchAppearance({subtitleFontSize:value??12})} />
            </PropertyRow>
            <PropertyRow label="说明颜色">
              <ColorPicker value={appearance.subtitleColor??''} disabledAlpha allowClear showText onClear={()=>patchAppearance({subtitleColor:undefined})}
                onChange={color=>patchAppearance({subtitleColor:color.toHexString()})} />
            </PropertyRow>
            <PropertyRow label="说明对齐">
              <Select value={appearance.subtitleAlign??'left'} options={[...textAlignmentOptions]} onChange={subtitleAlign=>patchAppearance({subtitleAlign})} />
            </PropertyRow>
      </>} actionSettings={widget.type==='record-list'&&<BusinessProperties roles={roles} widget={widget} tab="toolbar" fields={fields} view={listActionsView} onChange={update} disabled={disabled||sourceOpen} />} contentSettings={<>
        {widget.type==='chart'&&<PropertySubgroup title="图表展示">
          <PropertyRow label="图表类型"><Select value={widget.chartType??'bar'} options={[{label:'对比柱状图',value:'bar'},{label:'趋势折线图',value:'line'},{label:'占比环形图',value:'pie'},{label:'排行表',value:'rank-table'}]} onChange={chartType=>update({chartType})} /></PropertyRow>
          {seriesChart&&<>
            <PropertyRow label="图表高度" hint="设置图表内容的高度。组件整体尺寸在「布局与容器」中设置。">
              <InputNumber min={160} max={600} step={20} suffix="px" value={widget.height??280} onChange={height=>update({height:height??280})} />
            </PropertyRow>
            {paletteSetting}
            <PropertyRow label="显示图例"><Switch size="small" checked={appearance.showLegend!==false} onChange={showLegend=>patchAppearance({showLegend})} /></PropertyRow>
            <PropertyRow label="数值标签"><Switch size="small" checked={appearance.showLabels===true} onChange={showLabels=>patchAppearance({showLabels})} /></PropertyRow>
            {widget.chartType==='line'&&<PropertyRow label="平滑曲线"><Switch size="small" checked={appearance.smooth===true} onChange={smooth=>patchAppearance({smooth})} /></PropertyRow>}
          </>}
        </PropertySubgroup>}
        {statistical&&<PropertySubgroup title="数值展示">
          <PropertyRow label="显示格式"><Select value={widget.format??'number'} options={[{label:'数值',value:'number'},{label:'百分比',value:'percent'},{label:'金额（¥）',value:'currency'},{label:'时长（秒）',value:'duration'}]} onChange={format=>update({format})} /></PropertyRow>
          <PropertyRow label="显示单位"><Input value={widget.unit} maxLength={30} placeholder="如：件、万元" onChange={event=>update({unit:event.target.value})} /></PropertyRow>
          {widget.type==='metric'&&<>
            {paletteSetting}
            <PropertyRow label="阈值颜色" hint="例如：红色 > 100；支持红色、绿色、黄色、橙色。"><Input value={widget.threshold} maxLength={100} placeholder="红色 > 100" onChange={event=>update({threshold:event.target.value})} /></PropertyRow>
          </>}
        </PropertySubgroup>}
        {widget.type==='workspace'&&<PropertySubgroup title="工作台模块" hint="按当前登录账号的业务权限加载内容。">
          <PropertyRow label="展示模块">
            <Select value={widget.workspaceModule||'overview'} options={[{value:'overview',label:'工作概览'},{value:'continuation',label:'未完成工作'},{value:'recent',label:'最近工作'},{value:'support',label:'待办与申请'},{value:'forms',label:'业务表单'}]} onChange={workspaceModule=>update({workspaceModule})} />
          </PropertyRow>
        </PropertySubgroup>}
      </>}/>
      {widget.type==='record-list'&&<div data-property-section="interaction"><BusinessProperties roles={roles} widget={widget} tab="interaction" fields={fields} view={listActionsView} onChange={update} disabled={disabled||sourceOpen} /></div>}
      {widget.type==='chart'&&<PropertyGroup title="图表交互" section="interaction" hint="图表可联动使用同一业务来源的列表、指标和其他图表。">
        <PropertyRow label="点击图表">
          <Select value={widget.interaction??'filter'} options={[{label:'筛选数据',value:'filter'},{label:'打开业务明细',value:'drilldown'},{label:'进入来源表单',value:'navigate'},{label:'不触发联动',value:'none'}]} onChange={interaction=>update({interaction})} />
        </PropertyRow>
        {(!widget.interaction||widget.interaction==='filter')&&<>
          <PropertyRow label="目标组件" hint={usesPageFilters?'可以指定同源组件。留空时使用本页的全局筛选。':'选择使用同一业务来源的列表、图表或指标。'}>
            <Select mode="multiple" value={widget.targetWidgetIds||[]} options={definition.widgets
              .filter(item=>item.id!==widget.id&&item.type!=='record-filter'&&widgetSourceId(definition,item)===widgetSourceId(definition,widget))
              .map(item=>({label:item.title,value:item.id}))} onChange={targetWidgetIds=>update({targetWidgetIds})} />
          </PropertyRow>
          {usesPageFilters&&widget.dimension&&!widget.targetWidgetIds?.length&&!definition.filterFields.includes(widget.dimension)&&
            <Alert type="info" showIcon message="请将分组字段加入全局筛选" action={<Button size="small" onClick={()=>onPanel('filters')}>配置</Button>} />}
        </>}
      </PropertyGroup>}
      <PropertyGroup title="组件访问" defaultOpen={false} hint={<>匹配任一权限组即可访问组件。未配置适用对象时继承页面访问范围；删除全部权限组后仅管理员可见。服务端不返回无权访问的组件配置与统计数据。</>}>
        <ToolbarGroups scope="access" groups={widget.accessGroups??[{id:'default-access',name:'默认权限组',roleIds:widget.roleIds||[],actions:[]}]} roles={roles} disabled={disabled||sourceOpen} onChange={accessGroups=>update({accessGroups})} renderGroup={()=>null}/>

      </PropertyGroup>

    </>}
    {tab === 'data' && widget.type !== 'workspace' && <>
      {widget.type!=='record-filter'&&<PropertyGroup title="数据来源"><PropertyRow label="业务来源" hint="来源统一在「应用配置 → 业务数据」中管理。也可右键组件，选择「业务配置 → 字段与录入」打开当前来源。"><Select aria-label="组件业务来源" showSearch optionFilterProp="label" placeholder="选择业务数据来源" value={widgetSourceId(definition, widget)} options={forms.map(form=>({label:form.name,value:form.id}))} onChange={changeWidgetSource} /></PropertyRow></PropertyGroup>}
      {statistical&&<PropertyGroup title="自定义指标" defaultOpen={Boolean(widget.expression)} hint={<>支持 count()、sum、avg、min、max、count_distinct、count_if 及四则运算；字段使用业务编码。百分比公式返回比例，例如 sum(actual) / sum(target)。清空后沿用下方统计方式。</>}>{widget.sharedMetricId&&<Alert type="info" message={`共享指标 · v${widget.sharedMetricVersion}`} description="公式由指标库管理，发布新口径时同步更新引用。" action={<Button size="small" onClick={()=>update({sharedMetricId:null,sharedMetricVersion:null,sharedFields:[]})}>转为独立指标</Button>}/>}<PropertyRow label="指标公式"><Input.TextArea disabled={Boolean(widget.sharedMetricId)} value={widget.expression||''} maxLength={512} autoSize={{minRows:2,maxRows:5}} placeholder="例如 sum(actual) / sum(target)" onChange={event=>update({expression:event.target.value||null})}/></PropertyRow></PropertyGroup>}

      {widget.type==='record-filter' ? <>
        <PropertyGroup title={linkedFilterTargets.length?`联动组件（${linkedFilterTargets.length}）`:'联动组件'}
          hint="首个目标决定业务来源。清空目标后可以选择其他来源。">
          <PropertyRow label="目标组件" stacked hint={hasBlockedFilterTargets?'当前筛选含审批状态或记录系统字段。移除这些字段后可联动指标卡和图表。':undefined}>
            <Select mode="multiple" showSearch optionFilterProp="label" value={widget.targetWidgetIds??[]}
              disabled={disabled||sourceOpen}
              notFoundContent="请先在画布上为列表、指标卡或图表配置业务来源"
              placeholder="选择画布上的组件" options={filterTargetOptions} onChange={changeFilterTargets} />
          </PropertyRow>
          {canChooseAllTargets&&<PropertyRow label="批量选择">
            <Button size="small" disabled={disabled||sourceOpen||filterTargetOptions.every(option=>option.disabled||widget.targetWidgetIds?.includes(option.value))}
              onClick={()=>changeFilterTargets(filterTargetOptions.filter(option=>!option.disabled).map(option=>option.value))}>
              全选同源组件
            </Button>
          </PropertyRow>}
          {linkedFilterTargets.length>0&&<PropertyRow label="业务来源" hint="由选中的联动组件自动确定。">
            <Typography.Text ellipsis={{tooltip:formName(filterSourceId)}}>{formName(filterSourceId)}</Typography.Text>
          </PropertyRow>}
        </PropertyGroup>
        {linkedFilterTargets.length>0&&<PropertyGroup title="筛选条件">
          {publishedForm ? widget.filterSettings?.schemes != null ?
            <FilterSchemes settings={widget.filterSettings} names={widget.filterFields??[]}
              options={[
                ...publishedFields.map(field=>({value:field.field_name,label:field.label,available:Boolean(field.searchable||field.sortable),choice:false})),
                ...(onlyListTargets ? [
                  ...RECORD_METADATA_FIELDS.map(field=>({value:field.fieldName,label:field.label,system:true,choice:false,controlLabel:field.controlLabel})),
                  ...approvalFilter,
                ] : []),
              ]}
              roles={roles} disabled={disabled||sourceOpen} selected={preview?.filterScheme.id} onSelect={preview?.filterScheme.onSelect}
              onChange={settings=>updateFilter({filterSettings:{...widget.filterSettings,...settings}})}>{null}</FilterSchemes> :
            <PropertyRow label="筛选字段" hint="选择的字段会显示在画布上。业务字段需在来源中启用搜索或排序。">
              <Select mode="multiple" maxCount={30} showSearch optionFilterProp="label" placeholder="选择筛选字段"
                value={widget.filterFields ?? (listActionsView?.filters?.filter(field=>field.enabled!==false).map(field=>field.fieldName)
                  ?? publishedFields.filter(field=>field.searchable).map(field=>field.field_name))}
                options={[
                  ...publishedFields.filter(field=>field.searchable||field.sortable||widget.filterFields?.includes(field.field_name))
                    .map(field=>({value:field.field_name,label:field.label})),
                  ...(onlyListTargets?approvalFilter:[]),
                ]}
                onChange={filterFields=>updateFilter({filterFields,filterSettings:{...widget.filterSettings,
                  requiredFields:widget.filterSettings?.requiredFields?.filter(field=>filterFields.includes(field))}})} />
            </PropertyRow> : <Alert type={props.publishedSource?.error?'warning':'info'} showIcon
              message={props.publishedSource?.error?'读取已发布的业务来源失败':'正在读取已发布的业务来源'} description={props.publishedSource?.error} />}
        </PropertyGroup>}
      </> : widget.type !== 'record-list' ? <PropertyGroup title="统计口径">
        {formulaActive && <p className="analytics-editor-help">{widget.sharedMetricId ? '当前使用共享指标公式。转为独立指标并清空公式后，备用统计方式生效。' : '当前使用自定义公式。清空公式后，备用统计方式生效。'}</p>}
        <PropertyRow label={formulaActive?'备用统计方式':'统计方式'}><Select value={widget.aggregate} disabled={formulaActive||disabled||sourceOpen} options={[{label:'记录数',value:'count'},{label:'数值求和',value:'sum'},{label:'平均值',value:'avg'},{label:'最小值',value:'min'},{label:'最大值',value:'max'}]} onChange={aggregate=>update({aggregate})} /></PropertyRow>
        {widget.aggregate!=='count'&&<PropertyRow label="数值字段"><Select value={widget.measure} disabled={formulaActive||disabled||sourceOpen} options={numeric} onChange={measure=>update({measure})} /></PropertyRow>}
        {widget.type==='chart'&&<PropertyRow label="分组字段"><Select value={widget.dimension} options={options} onChange={dimension=>update({dimension})} /></PropertyRow>}
      </PropertyGroup> : publishedForm ? <BusinessProperties roles={roles} widget={widget} tab="data" fields={publishedFields} view={publishedView} onChange={update} disabled={disabled||sourceOpen}
        approvalStatusAvailable={publishedForm.runtime_approval_available ?? props.approvalStatusAvailable}
        approvalStatusDefaultVisible={publishedForm.runtime_submission_available ?? props.approvalStatusDefaultVisible}
        selectedDisplayGroup={preview?.displayGroup.id}
        onSelectDisplayGroup={preview?.displayGroup.onSelect}
        selectedFilterScheme={preview?.filterScheme.id}
        onSelectFilterScheme={preview?.filterScheme.onSelect} /> : widgetSourceId(definition, widget) ? <Alert type={props.publishedSource?.error ? 'warning' : 'info'} showIcon message={props.publishedSource?.error ? '加载来源表单失败' : '正在读取来源表单'} description={props.publishedSource?.error} /> : null}
    </>}
  </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧组件配置属性" />;
  else if (panel==='style'||panel==='compatibility') content=<>
    <PropertyGroup title="基本信息">
      <PropertyRow label="页面名称">
        <Input value={definition.title} maxLength={100} onChange={event=>onChange({...definition,title:event.target.value})} />
      </PropertyRow>
    </PropertyGroup>
    <PropertyGroup title="页面布局" defaultOpen={false}>
      <PropertyRow label="组件间距">
        <InputNumber min={0} max={32} suffix="px" value={definition.style?.componentGap??12} onChange={componentGap=>updateStyle({componentGap:componentGap??12})} />
      </PropertyRow>
      <PropertyRow label="方格尺寸">
        <InputNumber min={16} max={88} suffix="px" value={definition.style?.gridSize??44} onChange={value=>updateStyle({gridSize:value??44})} />
      </PropertyRow>
      {definition.filterFields.length>0&&<PropertyRow label="筛选器布局" hint="用于页面级全局筛选。独立筛选组件随画布布局。"><Select value={definition.style?.filterTheme??'toolbar'} options={[{label:'顶部工具栏',value:'toolbar'},{label:'嵌入画布',value:'inline'},{label:'侧边筛选面板',value:'panel'}]} onChange={filterTheme=>updateStyle({filterTheme})} /></PropertyRow>}
      <PropertyAdvanced title="刷新设置">
        <PropertyRow label="刷新间隔" hint="0 表示关闭。仅在浏览页面且页面可见时刷新，同页多个来源采用最短间隔。">
          <InputNumber min={0} max={86400} step={10} value={definition.style?.refreshInterval??0} suffix="秒" onChange={value=>updateStyle({refreshInterval:value??0})} />
        </PropertyRow>
      </PropertyAdvanced>
    </PropertyGroup>
    <PropertyGroup title="页面主题" defaultOpen={false}>
      <PropertyRow label="主题预设" stacked>
        <div role="group" className="analytics-editor-presets">
          {([
            {value:'clean',label:'简洁',background:'#f6f8fa',palette:'manufacturing'},
            {value:'factory',label:'制造',background:'#edf4f5',palette:'manufacturing'},
            {value:'executive',label:'经营',background:'#f1f3f8',palette:'business'},
          ] as const).map(preset=><button key={preset.value} type="button" disabled={disabled||sourceOpen}
            className="analytics-editor-preset" aria-pressed={(definition.style?.preset??'clean')===preset.value}
            onClick={()=>updateStyle({preset:preset.value,background:preset.background,chartPalette:preset.palette,cardBorder:preset.value==='executive'?'strong':'light'})}>
            <span className="analytics-editor-preset-sample" style={{background:preset.background}}>{widgetPalettes[preset.palette].map(color=><i key={color} style={{background:color}} />)}</span>
            <span>{preset.label}</span>
          </button>)}
        </div>
      </PropertyRow>
      <PropertyRow label="画布背景"><ColorPicker value={definition.style?.background||'#f6f8fa'} disabledAlpha showText onChange={color=>updateStyle({background:color.toHexString()})} /></PropertyRow>
      <PropertyRow label="图表配色"><Select value={definition.style?.chartPalette??'manufacturing'} options={Object.entries(paletteNames).map(([value,label])=>({value,label}))} onChange={chartPalette=>updateStyle({chartPalette})} /></PropertyRow>
    </PropertyGroup>
    <PresentationSettings page value={definition.style?.componentDefaults} resolved={resolvePresentation(definition,{type:props.workspace?'workspace':undefined})}
      onChange={componentDefaults=>updateStyle({componentDefaults})} />
    {(hasLegacySource||hasLegacyAccess)&&<PropertyGroup title="兼容设置" defaultOpen={panel==='compatibility'} hint="维护当前页面已有的来源与访问规则。">
      {hasLegacySource&&<PropertyRow label="默认业务来源" hint="供继承页面来源的组件和全局筛选使用。更换时会重置这些组件的字段设置。">
        <Select allowClear placeholder="选择业务来源" showSearch optionFilterProp="label" value={definition.sourceFormId}
          options={forms.map(form=>({label:form.name,value:form.id}))} onChange={sourceFormId=>{
            let next:PageDefinition={...definition,sourceFormId,filterFields:[]};
            for (const item of definition.widgets.filter(item=>!item.dataBinding)) next=bindWidgetSource(next,item.id);
            onChange(next);
          }} />
      </PropertyRow>}
      {hasPageSource&&<PropertyRow label="全局筛选">
        <Button size="small" onClick={()=>onPanel('filters')}>配置全局筛选</Button>
      </PropertyRow>}
      {hasLegacyAccess&&<PropertyRow label="页面访问角色" hint="此规则同时检查页面链接访问。留空时允许当前租户的登录用户进入，宿主表单和业务数据权限另行校验。">
        <Select mode="multiple" value={definition.roleIds} options={roles.map(role=>({label:role.label||role.name,value:role.id}))}
          onChange={roleIds=>onChange({...definition,roleIds})} />
      </PropertyRow>}
    </PropertyGroup>}
  </>;
  else if(panel==='filters') content=<PropertyGroup title="全局筛选" hint="在画布上可以验证筛选结果。">
    <PropertyRow label="筛选字段" hint="作用于使用页面默认业务来源的组件。">
      <Select mode="multiple" maxCount={12} value={definition.filterFields} options={options} onChange={filterFields=>onChange({...definition,filterFields})} />
    </PropertyRow>
  </PropertyGroup>;
  else content=<><div className="analytics-editor-section-title"><strong>组件类型</strong><span>已有 {definition.widgets.length} 个组件</span></div><PropertyHelp>添加后在左侧画布中选中组件，配置数据、样式与交互。</PropertyHelp><div className="analytics-editor-library">{[...componentTypes, ...(props.workspace ? [{type:'workspace' as AddableWidgetType,label:'工作台模块',description:'概览、未完成工作、待办、最近工作和业务入口',icon:<DatabaseOutlined />}]:[])].map(item=><button key={item.type} aria-label={`添加${item.label}`} disabled={disabled||definition.widgets.length>=30} onClick={()=>onAdd(item.type)}><span className="analytics-editor-library-icon">{item.icon}</span><strong>{item.label}</strong><small>{item.description}</small><PlusOutlined className="analytics-editor-library-plus" /></button>)}</div></>;
  return <section className="property-inspector analytics-editor-panel analytics-editor-form-inspector analytics-editor-panel-embedded" aria-label="页面配置">
    <div className="analytics-editor-heading">
    <PropertyInspectorHeader className="property-inspector-header-compact" title={panel==='widget'?'组件属性':panel==='add'?'添加组件':'页面与布局'} context={panel==='widget'?widget?.title:undefined} titleAccessory={sourceOpen?<div ref={props.sourceSlots?.status}/>:props.headerStatus} actions={<>
      {panel==='widget'&&widget&&<><Button type="text" aria-label="复制组件" title="复制组件" size="small" icon={<CopyOutlined />} disabled={disabled||sourceOpen||definition.widgets.length>=30} onClick={copyWidget} />
        <Popconfirm title="移除此组件？" description={filterRemovalWarning} onConfirm={()=>removeWidget(widget.id)}>
          <Button type="text" danger size="small" aria-label="删除组件" title="删除组件" disabled={disabled||sourceOpen} icon={<DeleteOutlined />} />
        </Popconfirm>
      </>}
      {sourceOpen?<div className="component-source-actions" ref={props.sourceSlots?.actions}/>:props.headerActions}
    </>} />
    {props.status&&<div className="analytics-editor-heading-status">{props.status}</div>}
    </div>
    {panel==='widget'&&(sourceOpen||widget)&&<InspectorTabs activeKey={tab} onChange={value=>onTab(value as WidgetTab)} items={tabs.map(item=>({...item,disabled}))} />}
    {panel!=='widget'&&panel!=='add'&&<InspectorTabs aria-label="页面设置分类" activeKey={panel==='filters'?'filters':'style'} onChange={value=>onPanel(value as Panel)} items={[
      {key:'style',label:'基本'},
      ...(hasPageSource&&(definition.filterFields.length>0||panel==='filters')?[{key:'filters',label:'筛选'}]:[]),
    ].map(item=>({...item,disabled:disabled||sourceOpen}))} />}
    <ConfigProvider componentDisabled={disabled||sourceOpen}><div className="analytics-editor-panel-body property-inspector-compact-body" key={panelKey}
      ref={panelBody} role="region" aria-label="属性内容" tabIndex={0}
      onScroll={event=>scrollPositions.current.set(panelKey,event.currentTarget.scrollTop)}>
      <div className="analytics-widget-properties">{content}</div>
    </div></ConfigProvider>
    <Modal title="更换业务来源" open={Boolean(sourceChangeRequest&&sourceChange)} okText="确认更换" cancelText="取消"
      okButtonProps={{disabled:disabled||sourceOpen}}
      onCancel={()=>setSourceChangeRequest(undefined)} onOk={()=>{
        if (!sourceChange || disabled || sourceOpen) return;
        onChange(sourceChange.definition);
        setSourceChangeRequest(undefined);
      }}>
      {sourceChangeRequest&&sourceChange&&<>
        <Typography.Paragraph>「{widget?.title}」将使用「{formName(sourceChangeRequest.formId)}」，并更新以下配置。</Typography.Paragraph>
        <ul>{sourceChange.impacts.map(impact=><li key={impact}>{impact}</li>)}</ul>
      </>}
    </Modal>
  </section>;
}
