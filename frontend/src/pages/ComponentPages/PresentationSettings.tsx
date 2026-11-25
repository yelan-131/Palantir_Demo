import {cloneElement, useId, useState, type ReactElement, type ReactNode} from 'react';
import {Button, ColorPicker, InputNumber, Select, Space, Switch} from 'antd';
import {RightOutlined} from '@/components/Icon/ant';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import type {ComponentPresentation, ResolvedPresentation} from './presentation';
import {presentationDefaults} from './presentation';
interface Props {
  value?:ComponentPresentation|null;
  resolved:ResolvedPresentation;
  onChange:(value:ComponentPresentation)=>void;
  page?:boolean;
  recordList?:boolean;
  layout?:ReactNode;
  titleSettings?:ReactNode;
  descriptionSettings?:ReactNode;
  actionSettings?:ReactNode;
  contentSettings?:ReactNode;
}
function hasOverride(key: string, value: unknown) {
  return value !== undefined && (value !== null || key === 'background');
}

function ResettableControl({id, 'aria-label': label, control, onReset}: {
  id?: string;
  'aria-label'?: string;
  control: ReactElement;
  onReset?: () => void;
}) {
  return <div className="property-inspector-resettable">
    {onReset&&<Button size="small" type="link" aria-label={`恢复${label}跟随页面`} onClick={onReset}>恢复继承</Button>}
    {cloneElement(control,{id,'aria-label':label})}
  </div>;
}

function HeaderTextSettings({title, visible, control, children}: {
  title: string;
  visible: boolean;
  control: ReactElement;
  children: ReactNode;
}) {
  const id = useId();
  const [expanded,setExpanded] = useState(false);
  const open = visible && expanded;
  return <div className="component-toolbar-group component-text-settings">
    <div className="component-text-settings-heading">
      <button className="component-text-settings-toggle" type="button" aria-expanded={open} aria-controls={id}
        disabled={!visible} onClick={()=>setExpanded(!expanded)}>
        <RightOutlined aria-hidden="true" />
        {title}
      </button>
      {control}
    </div>
    <div id={id} className="component-text-settings-fields" hidden={!open}>{visible&&children}</div>
  </div>;
}

export default function PresentationSettings({value,resolved,onChange,page=false,recordList=false,layout,titleSettings,descriptionSettings,actionSettings,contentSettings}:Props) {
  const patch=<K extends keyof ComponentPresentation>(key:K, part:Partial<ResolvedPresentation[K]>)=>onChange({...value,[key]:{...value?.[key],...part}});
  const fieldControl = <K extends keyof ResolvedPresentation,>(
    section: K, key: keyof ResolvedPresentation[K] & string, control: ReactElement,
  ) => {
    if (page) return control;
    const overrides = value?.[section] as Partial<ResolvedPresentation[K]> | null | undefined;
    const reset = () => {
      const next: Partial<ResolvedPresentation[K]> = {...overrides};
      delete next[key];
      const stillCustomized = Object.entries(next).some(([name, setting]) => hasOverride(name, setting));
      onChange({...value,[section]:stillCustomized ? next : null});
    };
    return <ResettableControl control={control} onReset={hasOverride(key,overrides?.[key]) ? reset : undefined} />;
  };
  const field = <K extends keyof ResolvedPresentation,>(
    section: K, key: keyof ResolvedPresentation[K] & string, label: string, control: ReactElement, hint?: string,
  ) => <PropertyRow label={label} hint={hint}>{fieldControl(section,key,control)}</PropertyRow>;
  const textSettings = (title: string, key: 'titleVisible' | 'descriptionVisible', settings: ReactNode) => {
    const label = `显示${title}`;
    const visible = resolved.header[key];
    const control = <Switch size="small" checked={visible} onChange={checked=>patch('header',{[key]:checked})} />;
    return settings
      ? <HeaderTextSettings title={title} visible={visible}
          control={cloneElement(fieldControl('header',key,control),{'aria-label':label})}>{settings}</HeaderTextSettings>
      : field('header',key,label,control);
  };
  const followPage = (key: keyof ComponentPresentation, label = '跟随页面') => !page && (
    <PropertyRow label={label} hint={key==='container'
      ? '继承「页面设置 → 基本 → 组件默认容器」的展示方式、背景、边框、阴影、圆角和内边距。直接改一项时，仅该项使用组件自己的值。打开开关会恢复整组继承。'
      : '打开时恢复整组继承。关闭时把整组设为独立值。直接修改某项时，仅该项停止继承，可单独恢复。'}>
      <Switch size={key==='container'?'default':'small'} checkedChildren={key==='container'?'继承':undefined} unCheckedChildren={key==='container'?'自定义':undefined}
        checked={!Object.entries(value?.[key] ?? {}).some(([name, setting]) => hasOverride(name, setting))}
        onChange={checked=>onChange({...value,[key]:checked ? null : {...resolved[key]}})} />
    </PropertyRow>
  );
  return <>
    <PropertyGroup title={page?'组件默认容器':layout?'布局与容器':'容器'} section={layout?'appearance':undefined} defaultOpen={false}
      hint={page?'组件未单独设置容器时使用这里的外观。无容器时隐藏背景、边框和阴影，组件宽高及内容内边距仍有效。':'拖动组件标题或按 Alt + 方向键调整顺序。无容器时隐藏背景、边框和阴影，尺寸及内边距仍有效。'}>
      {layout}
      {followPage('container', layout ? '容器跟随页面' : undefined)}
      {field('container','surface','展示方式',<Select value={resolved.container.surface} options={[{value:'plain',label:'无容器'},{value:'soft',label:'浅底分区'},{value:'card',label:'独立卡片'}]} onChange={surface=>patch('container',{surface})}/>)}
      {resolved.container.surface!=='plain'&&<>
        {field('container','background','背景颜色',<Space size={4}><ColorPicker aria-label="背景颜色" value={resolved.container.background||'#ffffff'} disabledAlpha onChange={color=>patch('container',{background:color.toHexString()})}/><Button size="small" type="text" onClick={()=>patch('container',{background:null})}>自动</Button></Space>, '自动使用主题颜色。恢复继承后使用页面默认背景。')}
        {field('container','border','边框',<Select value={resolved.container.border} options={[{value:'none',label:'无边框'},{value:'light',label:'轻边框'},{value:'strong',label:'强调边框'}]} onChange={border=>patch('container',{border})}/>)}
        {field('container','shadow','阴影',<Switch size="small" checked={resolved.container.shadow==='soft'} onChange={checked=>patch('container',{shadow:checked?'soft':'none'})}/>)}
        {field('container','radius','圆角',<InputNumber min={0} max={24} precision={0} value={resolved.container.radius} suffix="px" onChange={radius=>patch('container',{radius:radius??0})}/>)}
      </>}
      {field('container','padding','内边距',<InputNumber min={0} max={48} precision={0} value={resolved.container.padding} suffix="px" onChange={padding=>patch('container',{padding:padding??0})}/>)}
    </PropertyGroup>
    <PropertyGroup title={page?'组件默认标题与操作区':'标题与操作区'} defaultOpen={false} hint="关闭整个区域会隐藏其中的标题、说明和按钮；只隐藏标题文字，可以保留操作按钮。">
      {followPage('header')}
      {field('header','visible','显示整个区域',<Switch size="small" checked={resolved.header.visible} onChange={visible=>patch('header',{visible})}/>)}
      {resolved.header.visible&&<>
        {textSettings('标题','titleVisible',titleSettings)}
        {textSettings('说明','descriptionVisible',descriptionSettings)}
        {field('header','actionsVisible','显示按钮',<Switch size="small" checked={resolved.header.actionsVisible} onChange={actionsVisible=>patch('header',{actionsVisible})}/>)}
        {resolved.header.actionsVisible&&actionSettings}
        {field('header','layout','排列方式',<Select value={resolved.header.layout} options={[{value:'inline',label:'标题与按钮同行'},{value:'stack',label:'标题与按钮分行'}]} onChange={layout=>patch('header',{layout})}/>)}
        {field('header','divider','底部分隔线',<Switch size="small" checked={resolved.header.divider} onChange={divider=>patch('header',{divider})}/>)}
        {field('header','padding','区域边距',<InputNumber min={0} max={48} precision={0} value={resolved.header.padding} suffix="px" onChange={padding=>patch('header',{padding:padding??0})}/>)}
      </>}
    </PropertyGroup>
    <PropertyGroup title={page?'组件默认内容':'内容'} defaultOpen={false}>
      {followPage('content')}
      {field('content','density','内容密度',<Select value={resolved.content.density} options={[{value:'compact',label:'紧凑'},{value:'standard',label:'标准'},{value:'comfortable',label:'宽松'}]} onChange={density=>patch('content',{density})}/>)}
      {field('content','gap','内容间距',<InputNumber min={0} max={48} precision={0} value={resolved.content.gap} suffix="px" onChange={gap=>patch('content',{gap:gap??0})}/>,recordList?'设置筛选区与记录区之间的间距。':undefined)}
      {field('content','innerSurface','内部展示',<Select value={resolved.content.innerSurface} options={[{value:'plain',label:'无内部容器'},{value:'soft',label:'浅底内容'},{value:'card',label:'保留内部卡片'}]} onChange={innerSurface=>patch('content',{innerSurface})}/>,recordList?'设置记录区是否保留分隔边界或显示浅色背景。':undefined)}
      {!recordList&&field('content','innerTitles','内容内标题',<Switch size="small" checked={resolved.content.innerTitles} onChange={innerTitles=>patch('content',{innerTitles})}/>)}
      {field('content','separators','内容分隔线',<Switch size="small" checked={resolved.content.separators} onChange={separators=>patch('content',{separators})}/>)}
      {field('content','overflow','内容溢出',<Select value={resolved.content.overflow} options={[{value:'auto',label:'自动滚动'},{value:'hidden',label:'隐藏溢出'}]} onChange={overflow=>patch('content',{overflow})}/>,recordList?'控制组件内容区域超出可用高度时的处理方式。表格记录可在表体内滚动。':undefined)}
      {contentSettings}
    </PropertyGroup>
    {page&&<Button size="small" onClick={()=>onChange(structuredClone(presentationDefaults))}>恢复系统默认外观</Button>}
  </>;
}
