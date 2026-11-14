import type {ReactNode} from 'react';
import {Button, ColorPicker, InputNumber, Select, Space, Switch, Tag} from 'antd';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import type {ComponentPresentation, ResolvedPresentation} from './presentation';
import {presentationDefaults} from './presentation';
interface Props {value?:ComponentPresentation|null; resolved:ResolvedPresentation; onChange:(value:ComponentPresentation)=>void; page?:boolean;layout?:ReactNode;titleSettings?:ReactNode;descriptionSettings?:ReactNode;actionSettings?:ReactNode}
export default function PresentationSettings({value,resolved,onChange,page=false,layout,titleSettings,descriptionSettings,actionSettings}:Props) {
  const patch=<K extends keyof ComponentPresentation>(key:K, part:Partial<ResolvedPresentation[K]>)=>onChange({...value,[key]:{...resolved[key],...part}});
  const mode=(key:keyof ComponentPresentation)=><Space size={4}><Tag>{value?.[key]?'独立设置':'跟随页面'}</Tag><Button type="link" size="small" disabled={!value?.[key]} onClick={()=>onChange({...value,[key]:null})}>恢复跟随</Button></Space>;
  return <>
    <PropertyGroup title={layout?'布局与容器':'容器'} defaultOpen={false} hint={layout?'拖动组件标题或按 Alt + 方向键调整顺序。自定义宽度优先于布局占比；无容器时隐藏背景、边框和阴影，尺寸及内边距仍有效。':'无容器时隐藏背景、边框和阴影；组件宽高及内容内边距仍然有效。'}>
      {layout}
      {!page&&<PropertyRow label={layout?"容器继承":"继承"}>{mode('container')}</PropertyRow>}
      <PropertyRow label="展示方式"><Select aria-label="容器展示方式" value={resolved.container.surface} options={[{value:'plain',label:'无容器'},{value:'soft',label:'浅底分区'},{value:'card',label:'独立卡片'}]} onChange={surface=>patch('container',{surface})}/></PropertyRow>
      {resolved.container.surface!=='plain'&&<>
        <PropertyRow label="背景颜色"><Space><ColorPicker value={resolved.container.background||'#ffffff'} disabledAlpha onChange={color=>patch('container',{background:color.toHexString()})}/><Button size="small" type="text" onClick={()=>patch('container',{background:null})}>自动</Button></Space></PropertyRow>
        <PropertyRow label="边框"><Select value={resolved.container.border} options={[{value:'none',label:'无边框'},{value:'light',label:'轻边框'},{value:'strong',label:'强调边框'}]} onChange={border=>patch('container',{border})}/></PropertyRow>
        <PropertyRow label="阴影"><Switch size="small" checked={resolved.container.shadow==='soft'} onChange={checked=>patch('container',{shadow:checked?'soft':'none'})}/></PropertyRow>
        <PropertyRow label="圆角"><InputNumber min={0} max={24} value={resolved.container.radius} suffix="px" onChange={radius=>patch('container',{radius:radius??0})}/></PropertyRow>
      </>}
      <PropertyRow label="内边距"><InputNumber min={0} max={48} value={resolved.container.padding} suffix="px" onChange={padding=>patch('container',{padding:padding??0})}/></PropertyRow>
    </PropertyGroup>
    <PropertyGroup title="标题与操作区" defaultOpen={false} hint="关闭整个区域会隐藏其中的标题、说明和按钮；只隐藏标题文字，可以保留操作按钮。">
      {!page&&<PropertyRow label="继承">{mode('header')}</PropertyRow>}
      <PropertyRow label="显示整个区域"><Switch size="small" checked={resolved.header.visible} onChange={visible=>patch('header',{visible})}/></PropertyRow>
      {resolved.header.visible&&<>
        <PropertyRow label="显示标题"><Switch size="small" checked={resolved.header.titleVisible} onChange={titleVisible=>patch('header',{titleVisible})}/></PropertyRow>
        {resolved.header.titleVisible&&titleSettings}
        <PropertyRow label="显示说明"><Switch size="small" checked={resolved.header.descriptionVisible} onChange={descriptionVisible=>patch('header',{descriptionVisible})}/></PropertyRow>
        {resolved.header.descriptionVisible&&descriptionSettings}
        <PropertyRow label="显示按钮"><Switch size="small" checked={resolved.header.actionsVisible} onChange={actionsVisible=>patch('header',{actionsVisible})}/></PropertyRow>
        {resolved.header.actionsVisible&&actionSettings}
        <PropertyRow label="排列方式"><Select value={resolved.header.layout} options={[{value:'inline',label:'标题与按钮同行'},{value:'stack',label:'标题与按钮分行'}]} onChange={layout=>patch('header',{layout})}/></PropertyRow>
        <PropertyRow label="底部分隔线"><Switch size="small" checked={resolved.header.divider} onChange={divider=>patch('header',{divider})}/></PropertyRow>
        <PropertyRow label="区域边距"><InputNumber min={0} max={48} value={resolved.header.padding} suffix="px" onChange={padding=>patch('header',{padding:padding??0})}/></PropertyRow>
      </>}
    </PropertyGroup>
    <PropertyGroup title="内容" defaultOpen={false}>
      {!page&&<PropertyRow label="继承">{mode('content')}</PropertyRow>}
      <PropertyRow label="内容密度"><Select value={resolved.content.density} options={[{value:'compact',label:'紧凑'},{value:'standard',label:'标准'},{value:'comfortable',label:'宽松'}]} onChange={density=>patch('content',{density})}/></PropertyRow>
      <PropertyRow label="内容间距"><InputNumber min={0} max={48} value={resolved.content.gap} suffix="px" onChange={gap=>patch('content',{gap:gap??0})}/></PropertyRow>
      <PropertyRow label="内部展示"><Select value={resolved.content.innerSurface} options={[{value:'plain',label:'无内部容器'},{value:'soft',label:'浅底内容'},{value:'card',label:'保留内部卡片'}]} onChange={innerSurface=>patch('content',{innerSurface})}/></PropertyRow>
      <PropertyRow label="内容内标题"><Switch size="small" checked={resolved.content.innerTitles} onChange={innerTitles=>patch('content',{innerTitles})}/></PropertyRow>
      <PropertyRow label="内容分隔线"><Switch size="small" checked={resolved.content.separators} onChange={separators=>patch('content',{separators})}/></PropertyRow>
      <PropertyRow label="内容溢出"><Select value={resolved.content.overflow} options={[{value:'auto',label:'自动滚动'},{value:'hidden',label:'隐藏溢出'}]} onChange={overflow=>patch('content',{overflow})}/></PropertyRow>
    </PropertyGroup>
    {page&&<Button size="small" onClick={()=>onChange(structuredClone(presentationDefaults))}>恢复系统默认外观</Button>}
  </>;
}
