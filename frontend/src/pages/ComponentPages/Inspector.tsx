import PresentationSettings from './PresentationSettings';
import {inspectorTabs} from './inspectorCapabilities';
import {resolvePresentation} from './presentation';
import InspectorTabs from '@/components/PropertyInspector/InspectorTabs';
import ToolbarGroups from './ToolbarGroups';
import OptionPicker from '@/components/OptionPicker';
import type {AddableWidgetType} from './componentOperations';
import BusinessProperties from './BusinessProperties';
import {useListConfigurationPreview} from './ListConfigurationPreview';
import type {ViewConfig} from '@/utils/viewConfig';
import React, {useLayoutEffect, useRef} from 'react';
import {Alert, Button, ConfigProvider, Empty, Input, InputNumber, Popconfirm, Select, Switch, ColorPicker} from 'antd';
import {BarChartOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, FilterOutlined, NumberOutlined, PlusOutlined, SafetyCertificateOutlined, SkinOutlined, TableOutlined} from '@/components/Icon/ant';
import {PropertyInspectorHeader, PropertyHelp, PropertyGroup, PropertyRow, PropertyAdvanced} from '@/components/PropertyInspector';
import type {PlatformForm, PlatformFormField} from '@/services/api';
import {bindWidgetSource, widgetSourceId, type PageDefinition, type PageWidget} from './model';
import {widgetFontOptions, widgetPalettes} from '../AppPrograms/analyticsWidgetAppearance';
import '../AppPrograms/analytics-editor-panel.css';

export type Panel = 'widget' | 'style' | 'data' | 'filters' | 'add' | 'permissions';
export type BusinessTab = 'form' | 'flow';
export type WidgetTab = 'basic' | 'data' | BusinessTab;
const textAlignmentOptions = [
  {value:'left',label:'左对齐'},
  {value:'center',label:'居中'},
  {value:'right',label:'右对齐'},
] as const;
export const sections: Array<{key: Panel; label: string; icon: React.ReactNode}> = [
  {key:'style',label:'页面与布局',icon:<SkinOutlined />},
  {key:'filters',label:'全局筛选',icon:<FilterOutlined />},
  {key:'add',label:'添加组件',icon:<PlusOutlined />},
  {key:'data',label:'数据与指标',icon:<DatabaseOutlined />},
  {key:'permissions',label:'权限设置',icon:<SafetyCertificateOutlined />},
];
export const componentTypes = [
  {type:'record-list' as AddableWidgetType,label:'业务列表',description:'分页、录入、详情和审批',icon:<TableOutlined />},
  {type:'metric' as AddableWidgetType,label:'指标卡',description:'展示记录数或数值汇总',icon:<NumberOutlined />},
  {type:'chart' as AddableWidgetType,label:'分组图表',description:'柱状、折线、环形图和排行',icon:<BarChartOutlined />},
];

interface Props {
  workspace?: boolean;
  panel: Panel;
  tab: WidgetTab;
  definition: PageDefinition;
  selected?: string;
  fields: PlatformFormField[];
  forms: PlatformForm[];
  listSource?: {form?:PlatformForm; error?:string};
  roles: Array<{id:number;name:string;label?:string}>;
  disabled: boolean;
  sourceOpen: boolean;
  sourceSlots?:Record<'properties'|'actions'|'status',React.RefCallback<HTMLDivElement>>;
  sourceIsBusiness: boolean;
  approvalStatusAvailable?: boolean;
  approvalStatusDefaultVisible?: boolean;
  onPanel: (panel: Panel) => void;
  onTab: (tab: WidgetTab) => void;
  onSelect: (id: string) => void;
  onChange: (definition: PageDefinition) => void;
  onAdd: (type: AddableWidgetType) => void;
  onBusiness: (tab: BusinessTab) => void;
  onClose: () => void;
  headerStatus?: React.ReactNode;
  headerActions?: React.ReactNode;
  status?: React.ReactNode;
}

export default function Inspector(props: Props) {
  const {panel,tab:requestedTab,definition,fields,forms,roles,disabled,sourceOpen,onPanel,onTab,onChange,onAdd,onSelect} = props;
  const widget = definition.widgets.find(item => item.id === props.selected);
  const tabs = inspectorTabs(widget?.type, props.sourceIsBusiness, sourceOpen);
  const tab = tabs.some(item=>item.key===requestedTab) ? requestedTab : 'basic';
  const panelKey = panel==='widget' ? `${widget?.id}:${tab}` : panel;
  const panelBody = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const preview = useListConfigurationPreview(widget?.id);
  useLayoutEffect(()=>{
    if(panelBody.current)panelBody.current.scrollTop=scrollPositions.current.get(panelKey)??0;
  },[panelKey]);
  const options = fields.map(field => ({label:field.label,value:field.field_name}));
  const sourceView = forms.find(form => form.id === (panel === 'widget' ? widgetSourceId(definition, widget) : definition.sourceFormId))?.config?.viewConfig as ViewConfig | undefined;
  const publishedListView = props.listSource?.form?.config?.viewConfig as ViewConfig | undefined;
  const listActionsView = props.listSource?.form ? publishedListView?.tabs?.[0] ?? publishedListView : sourceView;
  const configuredFilterNames = sourceView?.filters?.filter(filter => filter.enabled).map(filter => filter.fieldName);
  const filterOptions = options.filter(option => !configuredFilterNames || configuredFilterNames.includes(option.value));
  const numeric = fields.filter(field => /^(int|integer|float|decimal|number)$/.test(field.field_type)).map(field => ({label:field.label,value:field.field_name}));
  const update = (value: Partial<PageWidget>) => widget && onChange({...definition,widgets:definition.widgets.map(item=>item.id===widget.id?{...item,...value}:item)});
  const appearance = widget?.appearance || {};
  const patchAppearance = (value: Partial<NonNullable<PageWidget['appearance']>>) => update({appearance:{...appearance,...value}});
  const updateStyle = (value: Partial<NonNullable<PageDefinition['style']>>) => onChange({...definition,style:{...definition.style,...value}});
  const statistical = widget?.type === 'chart' || widget?.type === 'metric';
  const copyWidget = () => {
    if (!widget) return;
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    onChange({...definition,widgets:definition.widgets.flatMap(item=>item.id===widget.id?[item,{...structuredClone(item),id,title:item.title+' 副本'}]:[item])});
    onSelect(id);
  };
  const paletteNames = {manufacturing:'制造蓝绿', business:'经营彩色', warning:'风险预警', mono:'单色专业'};
  let content: React.ReactNode;
  if (panel === 'widget' && (tab === 'form' || tab === 'flow')) content = <div className="component-source-properties form-designer-embedded" ref={props.sourceSlots?.properties}/>;
  else if (panel === 'widget') content = widget?.type === 'record-filter'
    ? <Alert type="info" message="旧版独立筛选" description="需要移除此组件时，请先在业务列表的「数据 → 列表筛选」配置所需条件。" />
    : widget ? <>

    {tab === 'basic' && <>
      <PropertyGroup title="基本信息"><PropertyRow label="组件名称" hint="同时用作画布标题；在标题与操作区设置是否显示及文字样式。"><Input maxLength={100} value={widget.title} onChange={event=>update({title:event.target.value})} /></PropertyRow><PropertyRow label="组件类型"><OptionPicker value={widget.type} disabled options={[...componentTypes, ...(props.workspace ? [{type:'workspace' as AddableWidgetType,label:'工作台模块',description:'待办、未完成工作、业务表单与最近工作',icon:<DatabaseOutlined />}]:[])].map(item=>({value:item.type,label:item.label}))} onChange={()=>{}} /></PropertyRow></PropertyGroup>
      <PresentationSettings value={widget.presentation} resolved={resolvePresentation(definition,widget)} onChange={presentation=>update({presentation})} recordList={widget.type==='record-list'} layout={<>
        <PropertyRow label="自定义宽度" hint="按像素设置宽度，最大为画布可用宽度。清空后按布局占比显示。"><InputNumber min={160} max={3840} precision={0} suffix="px" placeholder="自动" value={widget.customWidth} onChange={customWidth=>update({customWidth})}/></PropertyRow>
        <PropertyRow label="自定义高度" hint={widget.type==='record-list'&&!props.workspace&&definition.widgets.length===1 ? '按像素设置高度。清空后，列表自动填满画布可用高度。' : '按像素设置高度。清空后，组件高度随内容自适应。'}><InputNumber min={120} max={3000} precision={0} suffix="px" placeholder="自动" value={widget.customHeight} onChange={customHeight=>update({customHeight})}/></PropertyRow>
        <PropertyRow label="布局占比" hint="使用自动宽度时，按画布宽度计算占比。屏幕或画布较窄时，组件自动整行显示。"><OptionPicker numericValues={[25,33.33,50,75,100]} value={String(widget.width)} options={[{value:'6',label:'25%'},{value:'8',label:'33%'},{value:'12',label:'50%'},{value:'18',label:'75%'},{value:'24',label:'整行'}]} onChange={value=>update({width:Number(value) as PageWidget['width']})} /></PropertyRow>
        {statistical&&<PropertyRow label="组件配色"><OptionPicker value={appearance.palette||'inherit'} options={[{value:'inherit',label:'跟随页面主题'},...Object.keys(widgetPalettes).map(value=>({value,label:paletteNames[value as keyof typeof paletteNames]}))]} onChange={value=>patchAppearance({palette:value==='inherit'?undefined:value as keyof typeof paletteNames})} /></PropertyRow>}
      </>} titleSettings={<>
          <PropertyAdvanced title="标题高级选项">
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
          </PropertyAdvanced>
      </>} descriptionSettings={<>
          <PropertyRow label="组件说明">
            <Input.TextArea value={appearance.subtitle} maxLength={160} placeholder="填写组件用途或数据范围" autoSize={{minRows:2,maxRows:4}}
              onChange={event=>patchAppearance({subtitle:event.target.value})} />
          </PropertyRow>
          <PropertyAdvanced title="说明高级选项">
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
          </PropertyAdvanced>
      </>} actionSettings={<>
        {widget.type==='record-list'&&<BusinessProperties roles={roles} widget={widget} tab="toolbar" fields={fields} view={listActionsView} onChange={update} disabled={disabled||sourceOpen} />}
      </>}/>
        {widget.type==='chart'&&<PropertyGroup title="图表展示" defaultOpen={false}>
          <PropertyRow label="图表高度"><InputNumber min={160} max={600} step={20} addonAfter="px" value={widget.height??280} onChange={height=>update({height:height??280})} /></PropertyRow>
          {widget.chartType!=='rank-table'&&<><PropertyRow label="显示图例"><Switch size="small" checked={appearance.showLegend!==false} onChange={showLegend=>patchAppearance({showLegend})} /></PropertyRow><PropertyRow label="数值标签"><Switch size="small" checked={appearance.showLabels===true} onChange={showLabels=>patchAppearance({showLabels})} /></PropertyRow></>}
          {widget.chartType==='line'&&<PropertyRow label="平滑曲线"><Switch size="small" checked={appearance.smooth===true} onChange={smooth=>patchAppearance({smooth})} /></PropertyRow>}
        </PropertyGroup>}
      {statistical&&<PropertyGroup title="显示格式">
        {widget.type==='chart'&&<PropertyRow label="图表类型"><Select value={widget.chartType??'bar'} options={[{label:'对比柱状图',value:'bar'},{label:'趋势折线图',value:'line'},{label:'占比环形图',value:'pie'},{label:'排行表',value:'rank-table'}]} onChange={chartType=>update({chartType})} /></PropertyRow>}
        <PropertyRow label="显示格式"><Select value={widget.format??'number'} options={[{label:'数值',value:'number'},{label:'百分比',value:'percent'},{label:'金额（¥）',value:'currency'},{label:'时长（秒）',value:'duration'}]} onChange={format=>update({format})} /></PropertyRow>
        <PropertyRow label="显示单位"><Input value={widget.unit} maxLength={30} placeholder="如：件、万元" onChange={event=>update({unit:event.target.value})} /></PropertyRow>
        {widget.type==='metric'&&<PropertyRow label="阈值颜色" hint="例如：红色 > 100；支持红色、绿色、黄色、橙色。"><Input value={widget.threshold} maxLength={100} placeholder="红色 > 100" onChange={event=>update({threshold:event.target.value})} /></PropertyRow>}
      </PropertyGroup>}
      {widget.type==='record-list'&&<BusinessProperties roles={roles} widget={widget} tab="interaction" fields={fields} view={listActionsView} onChange={update} disabled={disabled||sourceOpen} />}
      {widget.type==='chart'&&<PropertyGroup title="交互行为" hint="图表可联动使用同一业务来源的列表、指标和其他图表。">
        <PropertyRow label="点击图表">
          <Select value={widget.interaction??'filter'} options={[{label:'筛选数据',value:'filter'},{label:'打开业务明细',value:'drilldown'},{label:'进入来源表单',value:'navigate'},{label:'不触发联动',value:'none'}]} onChange={interaction=>update({interaction})} />
        </PropertyRow>
        {(!widget.interaction||widget.interaction==='filter')&&<>
          <PropertyRow label="目标组件" hint="留空时筛选整个页面；也可指定列表、图表或指标。">
            <Select mode="multiple" value={widget.targetWidgetIds||[]} options={definition.widgets
              .filter(item=>item.id!==widget.id&&item.type!=='record-filter'&&widgetSourceId(definition,item)===widgetSourceId(definition,widget))
              .map(item=>({label:item.title,value:item.id}))} onChange={targetWidgetIds=>update({targetWidgetIds})} />
          </PropertyRow>
          {!widget.targetWidgetIds?.length&&!definition.filterFields.includes(widget.dimension||'')&&
            <Alert type="info" showIcon message="请将分组字段加入全局筛选" action={<Button size="small" onClick={()=>onPanel('filters')}>配置</Button>} />}
        </>}
      </PropertyGroup>}
      <PropertyGroup title="组件访问" defaultOpen={false} hint={<>匹配任一权限组即可访问组件。未配置适用对象时继承页面访问范围；删除全部权限组后仅管理员可见。服务端不返回无权访问的组件配置与统计数据。</>}>
        <ToolbarGroups scope="access" groups={widget.accessGroups??[{id:'default-access',name:'默认权限组',roleIds:widget.roleIds||[],actions:[]}]} roles={roles} disabled={disabled||sourceOpen} onChange={accessGroups=>update({accessGroups})} renderGroup={()=>null}/>

      </PropertyGroup>

    </>}
    {tab==='basic' && widget.type === 'workspace' && <PropertyGroup title="工作台内容"><PropertyRow label="展示模块"><Select aria-label="工作台展示模块" value={widget.workspaceModule || 'overview'} options={[{value:'overview',label:'工作概览'},{value:'continuation',label:'未完成工作'},{value:'recent',label:'最近工作'},{value:'support',label:'待办与申请'},{value:'forms',label:'业务表单'}]} onChange={workspaceModule=>update({workspaceModule})} /></PropertyRow><PropertyHelp>数据按当前登录账号的业务权限加载，布局发布不会扩大记录与审批权限。</PropertyHelp></PropertyGroup>}
    {tab === 'data' && widget.type !== 'workspace' && <>
      <PropertyGroup title="数据来源"><PropertyRow label="业务来源" hint="来源统一在「应用配置 → 业务数据」中管理。也可右键组件，选择「业务配置 → 字段与录入」打开当前来源。"><Select aria-label="组件业务来源" showSearch optionFilterProp="label" placeholder="选择业务数据来源" value={widgetSourceId(definition, widget)} options={forms.map(form=>({label:form.name,value:form.id}))} onChange={formId=>onChange(bindWidgetSource(definition, widget.id, formId))} /></PropertyRow></PropertyGroup>
      {statistical&&<PropertyGroup title="自定义指标" defaultOpen={Boolean(widget.expression)} hint={<>支持 count()、sum、avg、min、max、count_distinct、count_if 及四则运算；字段使用业务编码。百分比公式返回比例，例如 sum(actual) / sum(target)。清空后沿用下方统计方式。</>}>{widget.sharedMetricId&&<Alert type="info" message={`共享指标 · v${widget.sharedMetricVersion}`} description="公式由指标库管理，发布新口径时同步更新引用。" action={<Button size="small" onClick={()=>update({sharedMetricId:null,sharedMetricVersion:null,sharedFields:[]})}>转为独立指标</Button>}/>}<PropertyRow label="指标公式"><Input.TextArea disabled={Boolean(widget.sharedMetricId)} value={widget.expression||''} maxLength={512} autoSize={{minRows:2,maxRows:5}} placeholder="例如 sum(actual) / sum(target)" onChange={event=>update({expression:event.target.value||null})}/></PropertyRow></PropertyGroup>}

      {widget.type !== 'record-list' ? <PropertyGroup title="统计口径"><PropertyRow label="统计方式"><Select value={widget.aggregate} options={[{label:'记录数',value:'count'},{label:'数值求和',value:'sum'},{label:'平均值',value:'avg'},{label:'最小值',value:'min'},{label:'最大值',value:'max'}]} onChange={aggregate=>update({aggregate})} /></PropertyRow>{widget.aggregate!=='count'&&<PropertyRow label="数值字段"><Select value={widget.measure} options={numeric} onChange={measure=>update({measure})} /></PropertyRow>}{widget.type==='chart'&&<PropertyRow label="分组字段"><Select value={widget.dimension} options={options} onChange={dimension=>update({dimension})} /></PropertyRow>}</PropertyGroup> : props.listSource?.form ? <BusinessProperties roles={roles} widget={widget} tab="data" fields={(props.listSource.form.fields??[]).filter(field=>!field.archived)} view={publishedListView} onChange={update} disabled={disabled||sourceOpen}
        approvalStatusAvailable={props.listSource.form.runtime_approval_available ?? props.approvalStatusAvailable}
        approvalStatusDefaultVisible={props.listSource.form.runtime_submission_available ?? props.approvalStatusDefaultVisible}
        selectedDisplayGroup={preview?.displayGroup.id}
        onSelectDisplayGroup={preview?.displayGroup.onSelect}
        selectedFilterScheme={preview?.filterScheme.id}
        onSelectFilterScheme={preview?.filterScheme.onSelect} /> : widgetSourceId(definition, widget) ? <Alert type={props.listSource?.error ? 'warning' : 'info'} showIcon message={props.listSource?.error ? '加载来源表单失败' : '正在读取来源表单'} description={props.listSource?.error} /> : null}
    </>}
  </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧组件配置属性" />;
  else if (panel==='style') content=<>
    <PropertyGroup title="组件默认外观" hint="组件未独立设置的分区跟随这里；已独立设置的分区保留自己的外观。">
      <PresentationSettings page value={definition.style?.componentDefaults} resolved={resolvePresentation(definition,{type:props.workspace?'workspace':undefined})} onChange={componentDefaults=>updateStyle({componentDefaults})}/>
    </PropertyGroup>
    <PropertyGroup title="页面主题">
      <div className="analytics-editor-presets">{([{value:'clean',label:'简洁',background:'#f6f8fa',palette:'manufacturing'},{value:'factory',label:'制造',background:'#edf4f5',palette:'manufacturing'},{value:'executive',label:'经营',background:'#f1f3f8',palette:'business'}] as const).map(preset=><button key={preset.value} type="button" disabled={disabled||sourceOpen} className="analytics-editor-preset" aria-pressed={(definition.style?.preset??'clean')===preset.value} onClick={()=>updateStyle({preset:preset.value,background:preset.background,chartPalette:preset.palette,cardBorder:preset.value==='executive'?'strong':'light'})}><span className="analytics-editor-preset-sample" style={{background:preset.background}}>{widgetPalettes[preset.palette].map(color=><i key={color} style={{background:color}} />)}</span><span>{preset.label}</span></button>)}</div>
      <PropertyRow label="方格尺寸"><InputNumber min={16} max={88} suffix="px" value={definition.style?.gridSize??44} onChange={value=>updateStyle({gridSize:value??44})} /></PropertyRow>
      <PropertyRow label="卡片不透明度"><InputNumber min={30} max={100} suffix="%" value={Math.round((definition.style?.cardOpacity??.78)*100)} onChange={value=>updateStyle({cardOpacity:(value??78)/100})} /></PropertyRow>
      <PropertyRow label="玻璃模糊"><InputNumber min={0} max={24} suffix="px" value={definition.style?.cardBlur??12} onChange={value=>updateStyle({cardBlur:value??12})} /></PropertyRow>
      <PropertyRow label="画布背景"><ColorPicker value={definition.style?.background||'#f6f8fa'} disabledAlpha showText onChange={color=>updateStyle({background:color.toHexString()})} /></PropertyRow>
      <PropertyRow label="图表配色"><Select value={definition.style?.chartPalette??'manufacturing'} options={Object.entries(paletteNames).map(([value,label])=>({value,label}))} onChange={chartPalette=>updateStyle({chartPalette})} /></PropertyRow>
    </PropertyGroup>
    <PropertyGroup title="页面布局" hint={<>仅在浏览页面且页面可见时自动刷新，编辑时暂停。</>}>
      <PropertyRow label="页面名称"><Input value={definition.title} maxLength={100} onChange={event=>onChange({...definition,title:event.target.value})} /></PropertyRow>
      <PropertyRow label="组件间距"><InputNumber min={0} max={32} addonAfter="px" value={definition.style?.componentGap??12} onChange={componentGap=>updateStyle({componentGap:componentGap??12})} /></PropertyRow>
      <PropertyRow label="表格密度"><Select allowClear placeholder="沿用业务表单" value={definition.style?.tableDensity??undefined} options={[{label:'紧凑',value:'compact'},{label:'标准',value:'standard'},{label:'宽松',value:'comfortable'}]} onChange={tableDensity=>updateStyle({tableDensity})} /></PropertyRow>
      <PropertyRow label="筛选器布局"><Select value={definition.style?.filterTheme??'toolbar'} options={[{label:'顶部工具栏',value:'toolbar'},{label:'嵌入画布',value:'inline'},{label:'侧边筛选面板',value:'panel'}]} onChange={filterTheme=>updateStyle({filterTheme})} /></PropertyRow>
      <PropertyAdvanced title="刷新设置"><PropertyRow label="刷新间隔" hint="0 表示关闭；单位为秒。编辑页面时暂停刷新，同页多个来源采用最短间隔。"><InputNumber min={0} max={86400} step={10} value={definition.style?.refreshInterval??0} addonAfter="秒" onChange={value=>updateStyle({refreshInterval:value??0})} /></PropertyRow></PropertyAdvanced>
    </PropertyGroup>
  </>;
  else if(panel==='filters') content=<PropertyGroup title="全局筛选" hint={<>直接使用左侧画布中的筛选器检验结果。</>}><PropertyRow label="筛选字段" hint="同时作用于列表、指标和图表。"><Select mode="multiple" maxCount={12} value={definition.filterFields} options={options} onChange={filterFields=>onChange({...definition,filterFields})} /></PropertyRow></PropertyGroup>;
  else if(panel==='data') content=<><PropertyGroup title="数据来源" hint={<>默认来源供旧页面、全局筛选及未单独绑定的组件使用。组件可以在自身属性中选择不同来源；更换默认来源仅重置继承它的组件字段设置。</>}><PropertyRow label="默认业务来源"><Select allowClear placeholder="可不设置" showSearch optionFilterProp="label" value={definition.sourceFormId} options={forms.map(form=>({label:form.name,value:form.id}))} onChange={sourceFormId=>{let next:PageDefinition={...definition,sourceFormId,filterFields:[]};for(const item of definition.widgets.filter(item=>!item.dataBinding))next=bindWidgetSource(next,item.id);onChange(next);}} /></PropertyRow></PropertyGroup></>;
  else if(panel==='permissions') content=<><PropertyGroup title="页面访问" hint={<>留空允许当前租户的登录用户进入；组件允许角色与页面权限取交集，来源数据权限另行校验；旧表单入口继续校验原入口权限。</>}><PropertyRow label="允许访问的角色"><Select mode="multiple" value={definition.roleIds} options={roles.map(role=>({label:role.label||role.name,value:role.id}))} onChange={roleIds=>onChange({...definition,roleIds})} /></PropertyRow><PropertyHelp>页面控制能否进入；组件权限控制可见范围；数据源控制记录、字段、统计与审批授权。</PropertyHelp></PropertyGroup></>;
  else content=<><div className="analytics-editor-section-title"><strong>组件类型</strong><span>已有 {definition.widgets.length} 个组件</span></div><PropertyHelp>添加后在左侧画布中选中组件，配置数据、样式与交互。</PropertyHelp><div className="analytics-editor-library">{[...componentTypes, ...(props.workspace ? [{type:'workspace' as AddableWidgetType,label:'工作台模块',description:'概览、未完成工作、待办、最近工作和业务入口',icon:<DatabaseOutlined />}]:[])].map(item=><button key={item.type} aria-label={`添加${item.label}`} disabled={disabled||definition.widgets.length>=30} onClick={()=>onAdd(item.type)}><span className="analytics-editor-library-icon">{item.icon}</span><strong>{item.label}</strong><small>{item.description}</small><PlusOutlined className="analytics-editor-library-plus" /></button>)}</div></>;
  return <section className="property-inspector analytics-editor-panel analytics-editor-form-inspector analytics-editor-panel-embedded" aria-label="页面配置">
    <div className="analytics-editor-heading">
    <PropertyInspectorHeader className="property-inspector-header-compact" title={panel==='widget'?'组件属性':panel==='add'?'添加组件':'页面与布局'} titleAccessory={sourceOpen?<div ref={props.sourceSlots?.status}/>:props.headerStatus} actions={<>
      {panel==='widget'&&widget&&<>{widget.type!=='record-filter'&&<Button type="text" aria-label="复制组件" title="复制组件" size="small" icon={<CopyOutlined />} disabled={disabled||sourceOpen||definition.widgets.length>=30} onClick={copyWidget} />}<Popconfirm title="移除此组件？" onConfirm={()=>onChange({...definition,widgets:definition.widgets.filter(item=>item.id!==widget.id).map(item=>({...item,targetWidgetIds:item.targetWidgetIds?.filter(id=>id!==widget.id)}))})}><Button type="text" danger size="small" aria-label="删除组件" title="删除组件" disabled={disabled||sourceOpen} icon={<DeleteOutlined />} /></Popconfirm></>}
      {sourceOpen?<div className="component-source-actions" ref={props.sourceSlots?.actions}/>:props.headerActions}
    </>} />
    {props.status&&<div className="analytics-editor-heading-status">{props.status}</div>}
    </div>
    {panel==='widget'&&(sourceOpen||(widget&&widget.type!=='record-filter'))&&<InspectorTabs activeKey={tab} onChange={value=>onTab(value as WidgetTab)} items={tabs.map(item=>({...item,disabled}))} />}
    {panel!=='widget'&&panel!=='add'&&<InspectorTabs aria-label="页面设置分类" activeKey={panel} onChange={value=>onPanel(value as Panel)} items={[
      {key:'style',label:'布局'},
      {key:'data',label:'数据'},
      {key:'filters',label:'筛选'},
      {key:'permissions',label:'权限'},
    ].map(item=>({...item,disabled:disabled||sourceOpen}))} />}
    <ConfigProvider componentDisabled={disabled||sourceOpen}><div className="analytics-editor-panel-body property-inspector-compact-body" key={panelKey}
      ref={panelBody} role="region" aria-label="属性内容" tabIndex={0}
      onScroll={event=>scrollPositions.current.set(panelKey,event.currentTarget.scrollTop)}>
      <div className="analytics-widget-properties">{content}</div>
    </div></ConfigProvider>
  </section>;
}
