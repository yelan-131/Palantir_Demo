import React, {useState} from 'react';
import {Input, Select, Switch, Tabs} from 'antd';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import ToolbarGroups from './ToolbarGroups';
import ColumnPicker from './ColumnPicker';
import type {FilterControlMode, FilterScheme, FilterSettings} from './businessComponents';

const controlOptions = [
  {label:'沿用来源',value:'inherit'}, {label:'下拉单选',value:'dropdown'},
  {label:'单选按钮',value:'radio'}, {label:'下拉多选',value:'multi-dropdown'}, {label:'多选框',value:'checkbox'},
];

export default function FilterSchemes({settings,names,options,roles,disabled,onChange}: {
  settings:FilterSettings;names:string[];options:Array<{label:string;value:string;choice:boolean}>;
  roles:Array<{id:number;name:string;label?:string}>;disabled:boolean;onChange:(settings:Partial<FilterSettings>)=>void;
}) {
  const legacy:FilterScheme={id:'default-filter-scheme',name:'默认方案',showKeyword:settings.showKeyword!==false,
    groups:[{id:'default-filter-fields',name:'默认权限组',roleIds:[],actions:[],columns:names}]};
  const schemes=settings.schemes??[legacy];
  const [selected,setSelected]=useState(schemes[0]?.id);
  const active=schemes.find(item=>item.id===selected)||schemes[0];
  const commit=(next:FilterScheme[])=>onChange({schemes:next.map(scheme=>{
    const selected=new Set(scheme.groups.flatMap(group=>group.columns??[]));
    return {...scheme,fieldControls:Object.fromEntries(Object.entries(scheme.fieldControls??{}).filter(([name])=>selected.has(name)))};
  }),requiredFields:[],expandAdvanced:false});
  const patch=(value:Partial<FilterScheme>)=>commit(schemes.map(item=>item.id===active?.id?{...item,...value}:item));
  return <PropertyGroup title="筛选方案" hint="每个方案使用独立页签。用户只看到适用于自己的方案，匹配多个方案时可切换；同一方案的多个匹配权限组合并筛选字段。" className="component-filter-scheme-group" heading={
    <div className="component-filter-scheme-heading" onClick={event=>{event.preventDefault();event.stopPropagation();}} onKeyDown={event=>event.stopPropagation()}>
    <Tabs className="component-filter-scheme-tabs" type="editable-card" size="small" activeKey={active?.id} onChange={setSelected} onEdit={(key,action)=>{
      if(disabled)return;
      if(action==='add'){
        if(schemes.length>=12)return;
        const id=crypto.randomUUID();commit([...schemes,{id,name:`方案 ${schemes.length+1}`,showKeyword:false,groups:[{id:crypto.randomUUID(),name:'默认权限组',roleIds:[],actions:[],columns:[]}]}]);setSelected(id);
      }else{const next=schemes.filter(item=>item.id!==key);commit(next);setSelected(next[0]?.id);}
    }} hideAdd={disabled||schemes.length>=12} items={schemes.map(item=>({key:item.id,label:item.name,closable:!disabled&&schemes.length>1,disabled}))}/>
    </div>}>
    {active&&<>
      <PropertyRow label="方案名称"><Input aria-label="筛选方案名称" maxLength={50} value={active.name} disabled={disabled} onChange={event=>patch({name:event.target.value})}/></PropertyRow>
      <PropertyRow label="标题栏搜索" hint="开启后，关键词搜索显示在筛选组件标题栏，按来源表单设置的可搜索字段查找记录。"><Switch size="small" checked={active.showKeyword!==false} disabled={disabled} onChange={showKeyword=>patch({showKeyword})}/></PropertyRow>
      <ToolbarGroups key={active.id} scope="filter-fields" groups={active.groups} roles={roles} disabled={disabled} initialValues={{columns:[]}} onChange={groups=>patch({groups})} renderGroup={(group,update)=><ColumnPicker mode="filters" value={group.columns??[]} options={options} disabled={disabled} onChange={columns=>update({columns})} renderFieldSettings={name=>{
        const field=options.find(item=>item.value===name);
        if(!field?.choice)return null;
        return <Select size="small" className="component-filter-control-mode" aria-label={field.label+'的筛选控件'}
          disabled={disabled} value={active.fieldControls?.[name]??'inherit'} options={controlOptions}
          onChange={(mode:FilterControlMode|'inherit')=>{
            const fieldControls={...active.fieldControls};
            if(mode==='inherit')delete fieldControls[name];else fieldControls[name]=mode;
            patch({fieldControls});
          }}/>;
      }} sortableColumns={[]} onSortingChange={()=>{}}/>}/>

    </>}
  </PropertyGroup>;
}
