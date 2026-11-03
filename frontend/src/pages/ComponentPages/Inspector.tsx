import ToolbarGroups from './ToolbarGroups';
import OptionPicker from '@/components/OptionPicker';
import BusinessProperties from './BusinessProperties';
import type {ViewConfig} from '@/utils/viewConfig';
import React from 'react';
import {Alert, Button, ConfigProvider, Empty, Input, InputNumber, Popconfirm, Select, Switch, ColorPicker, Tabs} from 'antd';
import {BarChartOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, FilterOutlined, NumberOutlined, PlusOutlined, SafetyCertificateOutlined, SkinOutlined, TableOutlined} from '@ant-design/icons';
import {PropertyInspectorHeader, PropertyHelp, PropertyGroup, PropertyRow, PropertyAdvanced} from '@/components/PropertyInspector';
import type {PlatformForm, PlatformFormField} from '@/services/api';
import {bindWidgetSource, widgetSourceId, type PageDefinition, type PageWidget, type WidgetType} from './model';
import {widgetPalettes} from '../AppPrograms/analyticsWidgetAppearance';
import '../AppPrograms/analytics-editor-panel.css';

export type Panel = 'widget' | 'style' | 'data' | 'filters' | 'add' | 'permissions';
export type WidgetTab = 'basic' | 'data' | 'form' | 'flow';
export type BusinessTab = 'form' | 'flow';
export const sections: Array<{key: Panel; label: string; icon: React.ReactNode}> = [
  {key:'style',label:'页面与布局',icon:<SkinOutlined />},
  {key:'filters',label:'全局筛选',icon:<FilterOutlined />},
  {key:'add',label:'添加组件',icon:<PlusOutlined />},
  {key:'data',label:'数据与指标',icon:<DatabaseOutlined />},
  {key:'permissions',label:'权限设置',icon:<SafetyCertificateOutlined />},
];
export const componentTypes = [
  {type:'record-filter' as WidgetType,label:'业务筛选',description:'独立布局，联动同来源列表、指标和图表',icon:<FilterOutlined />},
  {type:'record-list' as WidgetType,label:'业务列表',description:'分页、录入、详情和审批',icon:<TableOutlined />},
  {type:'metric' as WidgetType,label:'指标卡',description:'展示记录数或数值汇总',icon:<NumberOutlined />},
  {type:'chart' as WidgetType,label:'分组图表',description:'柱状、折线、环形图和排行',icon:<BarChartOutlined />},
];

interface Props {
  panel: Panel;
  tab: WidgetTab;
  definition: PageDefinition;
  selected?: string;
  fields: PlatformFormField[];
  forms: PlatformForm[];
  roles: Array<{id:number;name:string;label?:string}>;
  disabled: boolean;
  sourceOpen: boolean;
  sourceSlots?:Record<'properties'|'actions'|'footer'|'status',React.RefCallback<HTMLDivElement>>;
  businessTab?: BusinessTab;
  onListFilter: () => void;
  sourceIsBusiness: boolean;
  onPanel: (panel: Panel) => void;
  onTab: (tab: WidgetTab) => void;
  onSelect: (id: string) => void;
  onChange: (definition: PageDefinition) => void;
  onAdd: (type: WidgetType) => void;
  onBusiness: (tab: BusinessTab) => void;
  onClose: () => void;
  headerStatus?: React.ReactNode;
  headerActions?: React.ReactNode;
  status?: React.ReactNode;
  footer: React.ReactNode;
}

export default function Inspector(props: Props) {
  const {panel,tab:requestedTab,definition,fields,forms,roles,disabled,sourceOpen,onPanel,onTab,onChange,onAdd,onSelect} = props;
  const widget = definition.widgets.find(item => item.id === props.selected);
  const tab = requestedTab;
  const options = fields.map(field => ({label:field.label,value:field.field_name}));
  const sourceView = forms.find(form => form.id === (panel === 'widget' ? widgetSourceId(definition, widget) : definition.sourceFormId))?.config?.viewConfig as ViewConfig | undefined;
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
  if (panel === 'widget') content = widget ? <>

    {tab === 'basic' && <>
      <PropertyGroup title="基本信息"><PropertyRow label="组件名称"><Input maxLength={100} value={widget.title} onChange={event=>update({title:event.target.value})} /></PropertyRow><PropertyRow label="组件类型"><OptionPicker value={widget.type} disabled options={componentTypes.map(item=>({value:item.type,label:item.label}))} onChange={()=>{}} /></PropertyRow></PropertyGroup>
      <PropertyGroup key="widget-layout" title="布局与外观" defaultOpen={false} hint={<>拖动组件标题或按 Alt + 方向键调整顺序。配色、圆角可独立设置或跟随页面。</>}>
        <PropertyRow label="位置"><InputNumber min={1} max={definition.widgets.length} value={definition.widgets.findIndex(item=>item.id===widget.id)+1} onChange={value=>{if(!value)return;const widgets=definition.widgets.filter(item=>item.id!==widget.id);widgets.splice(value-1,0,widget);onChange({...definition,widgets});}} /></PropertyRow>
        <PropertyRow label="自定义宽度" hint="单位 px；清空后使用布局占比。"><InputNumber min={160} max={3840} suffix="px" placeholder="自动" value={widget.customWidth} onChange={customWidth=>update({customWidth})}/></PropertyRow>
        <PropertyRow label="自定义高度" hint="单位 px；清空后随内容自适应。"><InputNumber min={120} max={3000} suffix="px" placeholder="自动" value={widget.customHeight} onChange={customHeight=>update({customHeight})}/></PropertyRow>
        <PropertyRow label="布局占比"><OptionPicker numericValues={[25,50,75,100]} value={String(widget.width)} options={[{value:'6',label:'25%'},{value:'12',label:'50%'},{value:'18',label:'75%'},{value:'24',label:'整行'}]} onChange={value=>update({width:Number(value) as PageWidget['width']})} /></PropertyRow>
        {statistical&&<PropertyRow label="组件配色"><OptionPicker value={appearance.palette||'inherit'} options={[{value:'inherit',label:'跟随页面主题'},...Object.keys(widgetPalettes).map(value=>({value,label:paletteNames[value as keyof typeof paletteNames]}))]} onChange={value=>patchAppearance({palette:value==='inherit'?undefined:value as keyof typeof paletteNames})} /></PropertyRow>}
        <PropertyAdvanced title="外观及高级设置">
          <PropertyRow label="跟随页面材质"><Switch size="small" checked={appearance.cardOpacity==null&&appearance.cardBlur==null} onChange={follow=>patchAppearance(follow?{cardOpacity:undefined,cardBlur:undefined}:{cardOpacity:definition.style?.cardOpacity??.78,cardBlur:definition.style?.cardBlur??12})} /></PropertyRow>
          <PropertyRow label="不透明度"><InputNumber min={30} max={100} suffix="%" value={Math.round((appearance.cardOpacity??definition.style?.cardOpacity??.78)*100)} onChange={value=>patchAppearance({cardOpacity:(value??78)/100})} /></PropertyRow>
          <PropertyRow label="玻璃模糊"><InputNumber min={0} max={24} suffix="px" value={appearance.cardBlur??definition.style?.cardBlur??12} onChange={value=>patchAppearance({cardBlur:value??12})} /></PropertyRow>
        </PropertyAdvanced>
        <PropertyRow label="卡片圆角" hint="清空后跟随页面设置。"><InputNumber min={0} max={24} placeholder="跟随页面" value={appearance.radius} onChange={radius=>patchAppearance({radius:radius??undefined})} /></PropertyRow>
        {widget.type==='chart'&&<>
          <PropertyRow label="图表高度"><InputNumber min={160} max={600} step={20} addonAfter="px" value={widget.height??280} onChange={height=>update({height:height??280})} /></PropertyRow>
          {widget.chartType!=='rank-table'&&<><PropertyRow label="显示图例"><Switch size="small" checked={appearance.showLegend!==false} onChange={showLegend=>patchAppearance({showLegend})} /></PropertyRow><PropertyRow label="数值标签"><Switch size="small" checked={appearance.showLabels===true} onChange={showLabels=>patchAppearance({showLabels})} /></PropertyRow></>}
          {widget.chartType==='line'&&<PropertyRow label="平滑曲线"><Switch size="small" checked={appearance.smooth===true} onChange={smooth=>patchAppearance({smooth})} /></PropertyRow>}
        </>}

      </PropertyGroup>
      <PropertyGroup key="widget-heading" title={widget.type==='record-list'||widget.type==='record-filter'?'标题、说明与按钮':'标题与说明'} defaultOpen={widget.type==='record-list'||widget.type==='record-filter'}>
        <PropertyRow label="显示标题" hint="控制画布卡片标题；标题栏中已配置的操作按钮仍保留。"><Switch size="small" checked={appearance.showTitle!==false} onChange={showTitle=>patchAppearance({showTitle})}/></PropertyRow>
        {appearance.showTitle!==false&&<PropertyRow label="标题字号"><InputNumber min={10} max={24} suffix="px" value={appearance.titleFontSize??12} onChange={value=>patchAppearance({titleFontSize:value??12})}/></PropertyRow>}
        <PropertyRow label="组件说明" hint="向页面使用者说明组件用途或数据范围。"><Input.TextArea value={appearance.subtitle} maxLength={160} autoSize={{minRows:2,maxRows:4}} onChange={event=>patchAppearance({subtitle:event.target.value})}/></PropertyRow>
        {(widget.type==='record-list'||widget.type==='record-filter')&&<BusinessProperties roles={roles} widget={widget} tab="toolbar" fields={fields} view={sourceView} onChange={update} disabled={disabled||sourceOpen} />}
      </PropertyGroup>
      {statistical&&<PropertyGroup title="显示格式">
        {widget.type==='chart'&&<PropertyRow label="图表类型"><Select value={widget.chartType??'bar'} options={[{label:'对比柱状图',value:'bar'},{label:'趋势折线图',value:'line'},{label:'占比环形图',value:'pie'},{label:'排行表',value:'rank-table'}]} onChange={chartType=>update({chartType})} /></PropertyRow>}
        <PropertyRow label="显示格式"><Select value={widget.format??'number'} options={[{label:'数值',value:'number'},{label:'百分比',value:'percent'},{label:'金额（¥）',value:'currency'},{label:'时长（秒）',value:'duration'}]} onChange={format=>update({format})} /></PropertyRow>
        <PropertyRow label="显示单位"><Input value={widget.unit} maxLength={30} placeholder="如：件、万元" onChange={event=>update({unit:event.target.value})} /></PropertyRow>
        {widget.type==='metric'&&<PropertyRow label="阈值颜色" hint="例如：红色 > 100；支持红色、绿色、黄色、橙色。"><Input value={widget.threshold} maxLength={100} placeholder="红色 > 100" onChange={event=>update({threshold:event.target.value})} /></PropertyRow>}
      </PropertyGroup>}
{widget.type==='record-list'&&<BusinessProperties roles={roles} widget={widget} tab="interaction" fields={fields} view={sourceView} onChange={update} disabled={disabled||sourceOpen} />}{widget.type!=='record-list'&&<PropertyGroup title="交互行为" hint={<>查询与重置作用于所选的同来源列表、指标和图表。多个筛选与图表条件同时生效，各自重置仅移除自己的条件。</>}>{widget.type==='record-filter'?<><PropertyRow label="联动组件"><Select mode="multiple" value={widget.targetWidgetIds||[]} options={definition.widgets.filter(item=>item.type!=='record-filter'&&widgetSourceId(definition,item)===widgetSourceId(definition,widget)).map(item=>({label:item.title,value:item.id}))} onChange={targetWidgetIds=>update({targetWidgetIds})} /></PropertyRow></>:widget.type==='chart'?<><PropertyRow label="点击图表"><Select value={widget.interaction??'filter'} options={[{label:'筛选数据',value:'filter'},{label:'打开业务明细',value:'drilldown'},{label:'进入来源表单',value:'navigate'},{label:'不触发联动',value:'none'}]} onChange={interaction=>update({interaction})} /></PropertyRow>{(!widget.interaction||widget.interaction==='filter')&&<PropertyRow label="目标组件" hint="留空时筛选整个页面；也可指定列表、图表或指标。"><Select mode="multiple" value={widget.targetWidgetIds||[]} options={definition.widgets.filter(item=>item.id!==widget.id&&item.type!=='record-filter'&&widgetSourceId(definition,item)===widgetSourceId(definition,widget)).map(item=>({label:item.title,value:item.id}))} onChange={targetWidgetIds=>update({targetWidgetIds})} /></PropertyRow>}{!widget.targetWidgetIds?.length&&!definition.filterFields.includes(widget.dimension||'')&&(!widget.interaction||widget.interaction==='filter')&&<Alert type="info" showIcon message="请将分组字段加入全局筛选" action={<Button size="small" onClick={()=>onPanel('filters')}>配置</Button>} />}</>:<PropertyHelp>指标随全局筛选与业务数据更新。</PropertyHelp>}</PropertyGroup>}
      <PropertyGroup title="组件访问" defaultOpen={false} hint={<>匹配任一权限组即可访问组件。未配置适用对象时继承页面访问范围；删除全部权限组后仅管理员可见。服务端不返回无权访问的组件配置与统计数据。</>}>
        <ToolbarGroups scope="access" groups={widget.accessGroups??[{id:'default-access',name:'默认权限组',roleIds:widget.roleIds||[],actions:[]}]} roles={roles} disabled={disabled||sourceOpen} onChange={accessGroups=>update({accessGroups})} renderGroup={()=>null}/>

      </PropertyGroup>

    </>}
    {tab === 'data' && <>
      <PropertyGroup title="数据来源"><PropertyRow label="业务来源"><Select disabled={widget.type==='record-filter'&&Boolean(widget.targetWidgetIds?.length)} aria-label="组件业务来源" showSearch optionFilterProp="label" placeholder="选择业务数据来源" value={widgetSourceId(definition, widget)} options={forms.map(form=>({label:form.name,value:form.id}))} onChange={formId=>onChange(bindWidgetSource(definition, widget.id, formId))} /></PropertyRow></PropertyGroup>
      {widget.type === 'record-filter' ? <BusinessProperties roles={roles} widget={widget} tab="data" fields={fields} view={sourceView} onChange={update} disabled={disabled||sourceOpen} /> : widget.type !== 'record-list' ? <PropertyGroup title="统计口径"><PropertyRow label="统计方式"><Select value={widget.aggregate} options={[{label:'记录数',value:'count'},{label:'数值求和',value:'sum'},{label:'平均值',value:'avg'},{label:'最小值',value:'min'},{label:'最大值',value:'max'}]} onChange={aggregate=>update({aggregate})} /></PropertyRow>{widget.aggregate!=='count'&&<PropertyRow label="数值字段"><Select value={widget.measure} options={numeric} onChange={measure=>update({measure})} /></PropertyRow>}{widget.type==='chart'&&<PropertyRow label="分组字段"><Select value={widget.dimension} options={options} onChange={dimension=>update({dimension})} /></PropertyRow>}</PropertyGroup> : <><BusinessProperties roles={roles} widget={widget} tab="data" fields={fields} view={sourceView} onChange={update} disabled={disabled||sourceOpen} /><PropertyGroup title="关联筛选" hint={<>独立筛选组件放在列表上方，只查询关联的列表，可分别配置字段与查询方式。</>}><Button size="small" disabled={disabled||sourceOpen||!widgetSourceId(definition,widget)} onClick={props.onListFilter}>{definition.widgets.some(item=>item.type==='record-filter'&&item.targetWidgetIds?.includes(widget.id)&&widgetSourceId(definition,item)===widgetSourceId(definition,widget))?'配置关联筛选':'添加关联筛选'}</Button></PropertyGroup></>}
    </>}
    {(tab === 'form'||tab === 'flow') && <div className="component-source-properties form-designer-embedded" ref={props.sourceSlots?.properties}/>}
  </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧组件配置属性" />;
  else if (panel==='style') content=<>
    <PropertyGroup title="页面主题">
      <div className="analytics-editor-presets">{([{value:'clean',label:'简洁',background:'#f6f8fa',palette:'manufacturing'},{value:'factory',label:'制造',background:'#edf4f5',palette:'manufacturing'},{value:'executive',label:'经营',background:'#f1f3f8',palette:'business'}] as const).map(preset=><button key={preset.value} type="button" disabled={disabled||sourceOpen} className="analytics-editor-preset" aria-pressed={(definition.style?.preset??'clean')===preset.value} onClick={()=>updateStyle({preset:preset.value,background:preset.background,chartPalette:preset.palette,cardBorder:preset.value==='executive'?'strong':'light'})}><span className="analytics-editor-preset-sample" style={{background:preset.background}}>{widgetPalettes[preset.palette].map(color=><i key={color} style={{background:color}} />)}</span><span>{preset.label}</span></button>)}</div>
      <PropertyRow label="方格尺寸"><InputNumber min={16} max={88} suffix="px" value={definition.style?.gridSize??44} onChange={value=>updateStyle({gridSize:value??44})} /></PropertyRow>
      <PropertyRow label="卡片不透明度"><InputNumber min={30} max={100} suffix="%" value={Math.round((definition.style?.cardOpacity??.78)*100)} onChange={value=>updateStyle({cardOpacity:(value??78)/100})} /></PropertyRow>
      <PropertyRow label="玻璃模糊"><InputNumber min={0} max={24} suffix="px" value={definition.style?.cardBlur??12} onChange={value=>updateStyle({cardBlur:value??12})} /></PropertyRow>
      <PropertyRow label="画布背景"><ColorPicker value={definition.style?.background||'#f6f8fa'} disabledAlpha showText onChange={color=>updateStyle({background:color.toHexString()})} /></PropertyRow>
      <PropertyRow label="图表配色"><Select value={definition.style?.chartPalette??'manufacturing'} options={Object.entries(paletteNames).map(([value,label])=>({value,label}))} onChange={chartPalette=>updateStyle({chartPalette})} /></PropertyRow>
      <PropertyRow label="卡片边框"><Select value={definition.style?.cardBorder??'light'} options={[{label:'无边框',value:'none'},{label:'轻边框',value:'light'},{label:'强调边框',value:'strong'}]} onChange={cardBorder=>updateStyle({cardBorder})} /></PropertyRow>
    </PropertyGroup>
    <PropertyGroup title="页面布局" hint={<>仅在浏览页面且页面可见时自动刷新，编辑时暂停。</>}>
      <PropertyRow label="页面名称"><Input value={definition.title} maxLength={100} onChange={event=>onChange({...definition,title:event.target.value})} /></PropertyRow>
      <PropertyRow label="组件间距"><InputNumber min={0} max={32} addonAfter="px" value={definition.style?.componentGap??12} onChange={componentGap=>updateStyle({componentGap:componentGap??12})} /></PropertyRow>
      <PropertyRow label="卡片圆角"><InputNumber min={0} max={20} addonAfter="px" value={definition.style?.cardRadius??8} onChange={cardRadius=>updateStyle({cardRadius:cardRadius??8})} /></PropertyRow>
      <PropertyRow label="表格密度"><Select allowClear placeholder="沿用业务表单" value={definition.style?.tableDensity??undefined} options={[{label:'紧凑',value:'compact'},{label:'标准',value:'standard'},{label:'宽松',value:'comfortable'}]} onChange={tableDensity=>updateStyle({tableDensity})} /></PropertyRow>
      <PropertyRow label="筛选器布局"><Select value={definition.style?.filterTheme??'toolbar'} options={[{label:'顶部工具栏',value:'toolbar'},{label:'嵌入画布',value:'inline'},{label:'侧边筛选面板',value:'panel'}]} onChange={filterTheme=>updateStyle({filterTheme})} /></PropertyRow>
      <PropertyAdvanced title="刷新设置"><PropertyRow label="自动刷新"><Select value={definition.style?.refreshInterval??0} options={[{label:'关闭',value:0},{label:'每 30 秒',value:30},{label:'每 1 分钟',value:60},{label:'每 5 分钟',value:300}]} onChange={refreshInterval=>updateStyle({refreshInterval})} /></PropertyRow></PropertyAdvanced>
    </PropertyGroup>
  </>;
  else if(panel==='filters') content=<PropertyGroup title="全局筛选" hint={<>直接使用左侧画布中的筛选器检验结果，独立筛选组件仅影响其关联的业务列表。</>}><PropertyRow label="筛选字段" hint="同时作用于列表、指标和图表。"><Select mode="multiple" maxCount={12} value={definition.filterFields} options={options} onChange={filterFields=>onChange({...definition,filterFields})} /></PropertyRow></PropertyGroup>;
  else if(panel==='data') content=<><PropertyGroup title="数据来源" hint={<>默认来源供旧页面、全局筛选及未单独绑定的组件使用。组件可以在自身属性中选择不同来源；更换默认来源仅重置继承它的组件字段设置。</>}><PropertyRow label="默认业务来源"><Select allowClear placeholder="可不设置" showSearch optionFilterProp="label" value={definition.sourceFormId} options={forms.map(form=>({label:form.name,value:form.id}))} onChange={sourceFormId=>{let next:PageDefinition={...definition,sourceFormId,filterFields:[]};for(const item of definition.widgets.filter(item=>!item.dataBinding))next=bindWidgetSource(next,item.id);onChange(next);}} /></PropertyRow></PropertyGroup></>;
  else if(panel==='permissions') content=<><PropertyGroup title="页面访问" hint={<>留空允许当前租户的登录用户进入；组件允许角色与页面权限取交集，来源数据权限另行校验；旧表单入口继续校验原入口权限。</>}><PropertyRow label="允许访问的角色"><Select mode="multiple" value={definition.roleIds} options={roles.map(role=>({label:role.label||role.name,value:role.id}))} onChange={roleIds=>onChange({...definition,roleIds})} /></PropertyRow><PropertyHelp>页面控制能否进入；组件权限控制可见范围；数据源控制记录、字段、统计与审批授权。</PropertyHelp></PropertyGroup></>;
  else content=<><div className="analytics-editor-section-title"><strong>组件类型</strong><span>已有 {definition.widgets.length} 个组件</span></div><PropertyHelp>添加后在左侧画布中选中组件，配置数据、样式与交互。</PropertyHelp><div className="analytics-editor-library">{componentTypes.map(item=><button key={item.type} aria-label={`添加${item.label}`} disabled={disabled||definition.widgets.length>=30} onClick={()=>onAdd(item.type)}><span className="analytics-editor-library-icon">{item.icon}</span><strong>{item.label}</strong><small>{item.description}</small><PlusOutlined className="analytics-editor-library-plus" /></button>)}</div></>;
  return <section className="property-inspector analytics-editor-panel analytics-editor-form-inspector analytics-editor-panel-embedded" aria-label="页面配置">
    <div className="analytics-editor-heading">
    <PropertyInspectorHeader title={panel==='widget'?'组件属性':panel==='add'?'添加组件':'页面与布局'} titleAccessory={sourceOpen?<div ref={props.sourceSlots?.status}/>:props.headerStatus} actions={<>
      {panel==='widget'&&widget&&<><Button type="text" aria-label="复制组件" title="复制组件" size="small" icon={<CopyOutlined />} disabled={disabled||sourceOpen||definition.widgets.length>=30} onClick={copyWidget} /><Popconfirm title="移除此组件？" onConfirm={()=>onChange({...definition,widgets:definition.widgets.filter(item=>item.id!==widget.id).map(item=>({...item,targetWidgetIds:item.targetWidgetIds?.filter(id=>id!==widget.id)}))})}><Button type="text" danger size="small" aria-label="删除组件" title="删除组件" disabled={disabled||sourceOpen} icon={<DeleteOutlined />} /></Popconfirm></>}
      {sourceOpen?<div className="component-source-actions" ref={props.sourceSlots?.actions}/>:props.headerActions}
    </>} />
    {props.status&&<div className="analytics-editor-heading-status">{props.status}</div>}
    </div>
    {panel==='widget'&&widget&&<Tabs className="analytics-widget-tabs" size="small" activeKey={tab} onChange={value=>onTab(value as WidgetTab)} items={[{key:'basic',label:'基本',disabled:disabled},{key:'data',label:'数据',disabled:disabled},{key:'form',label:'录入',disabled:disabled||!props.sourceIsBusiness},{key:'flow',label:'流程',disabled:disabled||!props.sourceIsBusiness}]} />}
    {panel!=='widget'&&panel!=='add'&&<Tabs className="analytics-widget-tabs" aria-label="页面设置分类" size="small" activeKey={panel} onChange={value=>onPanel(value as Panel)} items={[
      {key:'style',label:'布局'},
      {key:'data',label:'数据'},
      {key:'filters',label:'筛选'},
      {key:'permissions',label:'权限'},
    ].map(item=>({...item,disabled:disabled||sourceOpen}))} />}
    <ConfigProvider componentDisabled={disabled||sourceOpen}><div className="analytics-editor-panel-body" key={panel==='widget'?`${widget?.id}:${tab}`:panel}><div className="analytics-widget-properties">{content}</div></div></ConfigProvider>
    <footer className="analytics-editor-panel-footer">{sourceOpen?<div ref={props.sourceSlots?.footer}/>:props.footer}</footer>
  </section>;
}
