import BusinessProperties from './BusinessProperties';
import type {ViewConfig} from '@/utils/viewConfig';
import React from 'react';
import {Alert, Button, ConfigProvider, Dropdown, Empty, Input, InputNumber, Popconfirm, Select, Switch, ColorPicker, Tabs} from 'antd';
import {BarChartOutlined, CloseOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, FilterOutlined, MoreOutlined, NumberOutlined, PlusOutlined, SafetyCertificateOutlined, SkinOutlined, TableOutlined} from '@ant-design/icons';
import {PropertyInspectorHeader, PropertyGroup, PropertyRow, PropertyAdvanced} from '@/components/PropertyInspector';
import type {PlatformForm, PlatformFormField} from '@/services/api';
import type {PageDefinition, PageWidget, WidgetType} from './model';
import {widgetPalettes} from '../AppPrograms/analyticsWidgetAppearance';
import '../AppPrograms/analytics-editor-panel.css';

export type Panel = 'widget' | 'style' | 'data' | 'filters' | 'add' | 'permissions';
export type WidgetTab = 'data' | 'style' | 'interaction';
export type BusinessTab = 'form' | 'filter' | 'flow' | 'permission';
export const sections: Array<{key: Panel; label: string; icon: React.ReactNode}> = [
  {key:'style',label:'页面与布局',icon:<SkinOutlined />},
  {key:'filters',label:'全局筛选',icon:<FilterOutlined />},
  {key:'add',label:'添加组件',icon:<PlusOutlined />},
  {key:'data',label:'数据与指标',icon:<DatabaseOutlined />},
  {key:'permissions',label:'权限设置',icon:<SafetyCertificateOutlined />},
];
export const componentTypes = [
  {type:'record-filter' as WidgetType,label:'业务筛选',description:'独立布局，联动指定业务列表',icon:<FilterOutlined />},
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
  sourceIsBusiness: boolean;
  onPanel: (panel: Panel) => void;
  onTab: (tab: WidgetTab) => void;
  onSelect: (id: string) => void;
  onChange: (definition: PageDefinition) => void;
  onAdd: (type: WidgetType) => void;
  onBusiness: (tab: BusinessTab) => void;
  onClose: () => void;
  footer: React.ReactNode;
}

export default function Inspector(props: Props) {
  const {panel,tab,definition,fields,forms,roles,disabled,sourceOpen,onPanel,onTab,onChange,onAdd,onSelect,onClose} = props;
  const widget = definition.widgets.find(item => item.id === props.selected);
  const options = fields.map(field => ({label:field.label,value:field.field_name}));
  const sourceView = forms.find(form => form.id === definition.sourceFormId)?.config?.viewConfig as ViewConfig | undefined;
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
    onChange({...definition,widgets:definition.widgets.flatMap(item=>item.id===widget.id?[item,{...item,id,title:item.title+' 副本'}]:[item])});
    onSelect(id);
  };
  const paletteNames = {manufacturing:'制造蓝绿', business:'经营彩色', warning:'风险预警', mono:'单色专业'};
  const business = <PropertyGroup title="业务配置">
    <p className="analytics-editor-help">字段、录入和流程继续使用来源业务表单的已发布规则。</p>
    <div className="component-business-links">{([
      ['form','字段与录入'],['filter','列表与筛选'],['flow','流程与审批'],['permission','数据权限'],
    ] as Array<[BusinessTab,string]>).map(([key,label])=><Button key={key} size="small" disabled={!props.sourceIsBusiness} onClick={()=>props.onBusiness(key)}>{label}</Button>)}</div>
  </PropertyGroup>;
  let content: React.ReactNode;
  if (panel === 'widget') content = widget ? <>
    <Tabs activeKey={tab} onChange={value=>onTab(value as WidgetTab)} items={[{key:'data',label:'数据'},{key:'style',label:'样式'},{key:'interaction',label:'交互'}]} />
    {tab === 'data' && <>
      <PropertyGroup title="基本信息"><PropertyRow label="组件名称"><Input maxLength={100} value={widget.title} onChange={event=>update({title:event.target.value})} /></PropertyRow><PropertyRow label="组件类型"><Input readOnly value={componentTypes.find(item=>item.type===widget.type)?.label} /></PropertyRow><PropertyRow label="业务来源"><Input readOnly value={forms.find(form=>form.id===definition.sourceFormId)?.name || String(definition.sourceFormId)} /></PropertyRow></PropertyGroup>
      {widget.type === 'record-filter' ? <BusinessProperties widget={widget} tab="data" fields={fields} view={sourceView} onChange={update} disabled={disabled||sourceOpen} /> : widget.type !== 'record-list' ? <PropertyGroup title="统计口径"><PropertyRow label="统计方式"><Select value={widget.aggregate} options={[{label:'记录数',value:'count'},{label:'数值求和',value:'sum'},{label:'平均值',value:'avg'},{label:'最小值',value:'min'},{label:'最大值',value:'max'}]} onChange={aggregate=>update({aggregate})} /></PropertyRow>{widget.aggregate!=='count'&&<PropertyRow label="数值字段"><Select value={widget.measure} options={numeric} onChange={measure=>update({measure})} /></PropertyRow>}{widget.type==='chart'&&<PropertyRow label="分组字段"><Select value={widget.dimension} options={options} onChange={dimension=>update({dimension})} /></PropertyRow>}</PropertyGroup> : <><BusinessProperties widget={widget} tab="data" fields={fields} view={sourceView} onChange={update} disabled={disabled||sourceOpen} />{business}</>}
      {statistical&&<PropertyGroup title="展示与口径">
        {widget.type==='chart'&&<PropertyRow label="图表类型"><Select value={widget.chartType??'bar'} options={[{label:'对比柱状图',value:'bar'},{label:'趋势折线图',value:'line'},{label:'占比环形图',value:'pie'},{label:'排行表',value:'rank-table'}]} onChange={chartType=>update({chartType})} /></PropertyRow>}
        <PropertyRow label="显示格式"><Select value={widget.format??'number'} options={[{label:'数值',value:'number'},{label:'百分比',value:'percent'},{label:'金额（¥）',value:'currency'},{label:'时长（秒）',value:'duration'}]} onChange={format=>update({format})} /></PropertyRow>
        <PropertyRow label="显示单位"><Input value={widget.unit} maxLength={30} placeholder="如：件、万元" onChange={event=>update({unit:event.target.value})} /></PropertyRow>
        {widget.type==='metric'&&<PropertyRow label="阈值颜色" hint="例如：红色 > 100；支持红色、绿色、黄色、橙色。"><Input value={widget.threshold} maxLength={100} placeholder="红色 > 100" onChange={event=>update({threshold:event.target.value})} /></PropertyRow>}
        <PropertyRow label="补充说明"><Input.TextArea value={appearance.subtitle} maxLength={160} autoSize={{minRows:2,maxRows:3}} placeholder="说明统计范围、单位或来源" onChange={event=>patchAppearance({subtitle:event.target.value})} /></PropertyRow>
      </PropertyGroup>}
      <Button type="text" size="small" icon={<CopyOutlined />} disabled={definition.widgets.length>=30} onClick={copyWidget}>复制组件</Button>
      <Popconfirm title="移除此组件？" onConfirm={()=>onChange({...definition,widgets:definition.widgets.filter(item=>item.id!==widget.id).map(item=>({...item,targetWidgetIds:item.targetWidgetIds?.filter(id=>id!==widget.id)}))})}><Button danger size="small" icon={<DeleteOutlined />} disabled={definition.widgets.length<=1}>移除组件</Button></Popconfirm>
    </>}
    {tab === 'style' && <>
      <PropertyGroup title="布局与外观">
        <PropertyRow label="布局占比"><div className="analytics-widget-width-grid">{([{value:6,label:'1/4',size:1},{value:12,label:'1/2',size:2},{value:18,label:'3/4',size:3},{value:24,label:'整行',size:4}] as const).map(option=><button key={option.value} type="button" disabled={disabled||sourceOpen} aria-label={'组件宽度 '+option.label} aria-pressed={widget.width===option.value} onClick={()=>update({width:option.value})}><span className="analytics-widget-width-preview">{[0,1,2,3].map(index=><i key={index} className={index<option.size?'is-filled':''} />)}</span>{option.label}</button>)}</div></PropertyRow>
        {statistical&&<><PropertyRow label="组件配色"><div className="analytics-widget-palette-grid">{Object.entries(widgetPalettes).map(([key,colors])=><button type="button" key={key} disabled={disabled||sourceOpen} aria-label={'组件配色 '+paletteNames[key as keyof typeof paletteNames]} aria-pressed={appearance.palette===key} onClick={()=>patchAppearance({palette:key as keyof typeof paletteNames})}><span>{colors.map(color=><i key={color} style={{background:color}} />)}</span><small>{paletteNames[key as keyof typeof paletteNames]}</small></button>)}</div></PropertyRow><div className="analytics-property-inheritance"><span>{appearance.palette?'独立配色':'跟随页面配色'}</span><Button type="link" size="small" disabled={!appearance.palette} onClick={()=>patchAppearance({palette:undefined})}>跟随主题</Button></div></>}
        <PropertyRow label="卡片圆角" hint="清空后跟随页面设置。"><InputNumber min={0} max={24} placeholder="跟随页面" value={appearance.radius} onChange={radius=>patchAppearance({radius:radius??undefined})} /></PropertyRow>
        {widget.type==='chart'&&<>
          <PropertyRow label="图表高度"><InputNumber min={160} max={600} step={20} addonAfter="px" value={widget.height??280} onChange={height=>update({height:height??280})} /></PropertyRow>
          {widget.chartType!=='rank-table'&&<><PropertyRow label="显示图例"><Switch size="small" checked={appearance.showLegend!==false} onChange={showLegend=>patchAppearance({showLegend})} /></PropertyRow><PropertyRow label="数值标签"><Switch size="small" checked={appearance.showLabels===true} onChange={showLabels=>patchAppearance({showLabels})} /></PropertyRow></>}
          {widget.chartType==='line'&&<PropertyRow label="平滑曲线"><Switch size="small" checked={appearance.smooth===true} onChange={smooth=>patchAppearance({smooth})} /></PropertyRow>}
        </>}
        <p className="analytics-editor-help">拖动组件标题或按 Alt + 方向键调整顺序。配色、圆角可独立设置或跟随页面。</p>
      </PropertyGroup>
    </>}
    {tab === 'interaction' && <>{(widget.type==='record-list'||widget.type==='record-filter')&&<BusinessProperties widget={widget} tab="interaction" fields={fields} view={sourceView} onChange={update} disabled={disabled||sourceOpen} />}{widget.type!=='record-list'&&<PropertyGroup title="交互行为">{widget.type==='record-filter'?<><PropertyRow label="关联业务列表"><Select mode="multiple" value={widget.targetWidgetIds||[]} options={definition.widgets.filter(item=>item.type==='record-list').map(item=>({label:item.title,value:item.id}))} onChange={targetWidgetIds=>update({targetWidgetIds})} /></PropertyRow><p className="analytics-editor-help">查询与重置只影响关联的列表。全局筛选继续同时作用于列表、指标和图表。</p></>:widget.type==='chart'?<><PropertyRow label="点击图表"><Select value={widget.interaction??'filter'} options={[{label:'筛选数据',value:'filter'},{label:'打开业务明细',value:'drilldown'},{label:'进入来源表单',value:'navigate'},{label:'不触发联动',value:'none'}]} onChange={interaction=>update({interaction})} /></PropertyRow>{(!widget.interaction||widget.interaction==='filter')&&<PropertyRow label="目标组件" hint="留空时筛选整个页面；也可指定列表、图表或指标。"><Select mode="multiple" value={widget.targetWidgetIds||[]} options={definition.widgets.filter(item=>item.id!==widget.id&&item.type!=='record-filter').map(item=>({label:item.title,value:item.id}))} onChange={targetWidgetIds=>update({targetWidgetIds})} /></PropertyRow>}{!widget.targetWidgetIds?.length&&!definition.filterFields.includes(widget.dimension||'')&&(!widget.interaction||widget.interaction==='filter')&&<Alert type="info" showIcon message="请将分组字段加入全局筛选" action={<Button size="small" onClick={()=>onPanel('filters')}>配置</Button>} />}</>:<Alert type="info" showIcon message={'指标随全局筛选与业务数据更新。'} />}</PropertyGroup>}</>}
  </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧组件配置属性" />;
  else if (panel==='style') content=<>
    <PropertyGroup title="页面主题">
      <div className="analytics-editor-presets">{([{value:'clean',label:'简洁',background:'#f6f8fa',palette:'manufacturing'},{value:'factory',label:'制造',background:'#edf4f5',palette:'manufacturing'},{value:'executive',label:'经营',background:'#f1f3f8',palette:'business'}] as const).map(preset=><button key={preset.value} type="button" disabled={disabled||sourceOpen} className="analytics-editor-preset" aria-pressed={(definition.style?.preset??'clean')===preset.value} onClick={()=>updateStyle({preset:preset.value,background:preset.background,chartPalette:preset.palette,cardBorder:preset.value==='executive'?'strong':'light'})}><span className="analytics-editor-preset-sample" style={{background:preset.background}}>{widgetPalettes[preset.palette].map(color=><i key={color} style={{background:color}} />)}</span><span>{preset.label}</span></button>)}</div>
      <PropertyRow label="画布背景"><ColorPicker value={definition.style?.background||'#f6f8fa'} disabledAlpha showText onChange={color=>updateStyle({background:color.toHexString()})} /></PropertyRow>
      <PropertyRow label="图表配色"><Select value={definition.style?.chartPalette??'manufacturing'} options={Object.entries(paletteNames).map(([value,label])=>({value,label}))} onChange={chartPalette=>updateStyle({chartPalette})} /></PropertyRow>
      <PropertyRow label="卡片边框"><Select value={definition.style?.cardBorder??'light'} options={[{label:'无边框',value:'none'},{label:'轻边框',value:'light'},{label:'强调边框',value:'strong'}]} onChange={cardBorder=>updateStyle({cardBorder})} /></PropertyRow>
    </PropertyGroup>
    <PropertyGroup title="页面布局">
      <PropertyRow label="页面名称"><Input value={definition.title} maxLength={100} onChange={event=>onChange({...definition,title:event.target.value})} /></PropertyRow>
      <PropertyRow label="组件间距"><InputNumber min={0} max={32} addonAfter="px" value={definition.style?.componentGap??12} onChange={componentGap=>updateStyle({componentGap:componentGap??12})} /></PropertyRow>
      <PropertyRow label="卡片圆角"><InputNumber min={0} max={20} addonAfter="px" value={definition.style?.cardRadius??8} onChange={cardRadius=>updateStyle({cardRadius:cardRadius??8})} /></PropertyRow>
      <PropertyRow label="表格密度"><Select allowClear placeholder="沿用业务表单" value={definition.style?.tableDensity??undefined} options={[{label:'紧凑',value:'compact'},{label:'标准',value:'standard'},{label:'宽松',value:'comfortable'}]} onChange={tableDensity=>updateStyle({tableDensity})} /></PropertyRow>
      <PropertyRow label="筛选器布局"><Select value={definition.style?.filterTheme??'toolbar'} options={[{label:'顶部工具栏',value:'toolbar'},{label:'嵌入画布',value:'inline'},{label:'侧边筛选面板',value:'panel'}]} onChange={filterTheme=>updateStyle({filterTheme})} /></PropertyRow>
      <PropertyAdvanced title="刷新设置"><PropertyRow label="自动刷新"><Select value={definition.style?.refreshInterval??0} options={[{label:'关闭',value:0},{label:'每 30 秒',value:30},{label:'每 1 分钟',value:60},{label:'每 5 分钟',value:300}]} onChange={refreshInterval=>updateStyle({refreshInterval})} /></PropertyRow><p className="analytics-editor-help">仅在浏览页面且页面可见时自动刷新，编辑时暂停。</p></PropertyAdvanced>
    </PropertyGroup>
  </>;
  else if(panel==='filters') content=<PropertyGroup title="全局筛选"><PropertyRow label="筛选字段" hint="同时作用于列表、指标和图表。"><Select mode="multiple" maxCount={12} value={definition.filterFields} options={options} onChange={filterFields=>onChange({...definition,filterFields})} /></PropertyRow><p className="analytics-editor-help">直接使用左侧画布中的筛选器检验结果，独立筛选组件仅影响其关联的业务列表。</p></PropertyGroup>;
  else if(panel==='data') content=<><PropertyGroup title="数据来源"><PropertyRow label="业务表单"><Select showSearch optionFilterProp="label" value={definition.sourceFormId} options={forms.map(form=>({label:form.name,value:form.id}))} onChange={sourceFormId=>onChange({...definition,sourceFormId,filterFields:[],widgets:definition.widgets.map(item=>({...item,dimension:undefined,measure:undefined,filterFields:null,filterSettings:{...item.filterSettings,requiredFields:[]},listSettings:{...item.listSettings,columns:null,defaultSort:null},aggregate:'count'}))})} /></PropertyRow><p className="analytics-editor-help">当前页面共用业务数据源。更换来源会清空筛选字段、显示列与排序绑定，保留其余行为设置。</p></PropertyGroup>{business}</>;
  else if(panel==='permissions') content=<><PropertyGroup title="页面访问"><PropertyRow label="允许访问的角色"><Select mode="multiple" value={definition.roleIds} options={roles.map(role=>({label:role.label||role.name,value:role.id}))} onChange={roleIds=>onChange({...definition,roleIds})} /></PropertyRow><p className="analytics-editor-help">留空允许当前租户的登录用户进入，仍需通过表单入口及来源数据权限校验。</p><Alert type="info" showIcon message="记录、字段、统计和审批权限沿用业务表单。" /></PropertyGroup>{business}</>;
  else content=<><div className="analytics-editor-section-title"><strong>组件类型</strong><span>已有 {definition.widgets.length} 个组件</span></div><p className="analytics-editor-help">添加后在左侧画布中选中组件，配置数据、样式与交互。</p><div className="analytics-editor-library">{componentTypes.map(item=><button key={item.type} aria-label={`添加${item.label}`} disabled={disabled||definition.widgets.length>=30} onClick={()=>onAdd(item.type)}><span className="analytics-editor-library-icon">{item.icon}</span><strong>{item.label}</strong><small>{item.description}</small><PlusOutlined className="analytics-editor-library-plus" /></button>)}</div></>;
  return <section className="property-inspector analytics-editor-panel analytics-editor-panel-embedded" aria-label="页面配置">
    <PropertyInspectorHeader title={panel==='widget'?'组件属性':sections.find(item=>item.key===panel)?.label||'页面配置'} context={panel==='widget'?widget?.title:undefined} actions={<>
      {panel==='widget'&&<Dropdown disabled={disabled||sourceOpen} menu={{items:[{key:'widgets',label:'切换组件',children:definition.widgets.map(item=>({key:`widget:${item.id}`,label:item.title}))},{key:'settings',label:'页面设置',children:sections}],onClick:({key})=>key.startsWith('widget:')?onSelect(key.slice(7)):onPanel(key as Panel)}}><Button type="text" size="small" aria-label="组件配置操作" icon={<MoreOutlined />} /></Dropdown>}
      <Button type="text" aria-label="关闭页面配置" title={sourceOpen?'请先从左侧返回页面':'关闭页面配置'} icon={<CloseOutlined />} disabled={disabled||sourceOpen} onClick={onClose} />
    </>} />
    {panel!=='widget'&&<nav className="analytics-object-navigation"><Select aria-label="页面设置分类" size="small" value={panel} options={sections.map(item=>({value:item.key,label:item.label}))} disabled={disabled||sourceOpen} onChange={onPanel} /><Button type="text" size="small" disabled={disabled||sourceOpen} onClick={()=>onPanel('widget')}>组件属性</Button></nav>}
    <ConfigProvider componentDisabled={disabled||sourceOpen}><div className="analytics-editor-panel-body">{content}</div></ConfigProvider>
    <footer className="analytics-editor-panel-footer">{props.footer}</footer>
  </section>;
}
