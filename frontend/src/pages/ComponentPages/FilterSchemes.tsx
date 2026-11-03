import React, {useState} from 'react';
import {Input, Switch, Tabs} from 'antd';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import ToolbarGroups from './ToolbarGroups';
import ColumnPicker from './ColumnPicker';
import type {FilterScheme, FilterSettings} from './businessComponents';

export default function FilterSchemes({settings,names,options,roles,disabled,onChange}: {
  settings:FilterSettings;names:string[];options:Array<{label:string;value:string}>;
  roles:Array<{id:number;name:string;label?:string}>;disabled:boolean;onChange:(settings:Partial<FilterSettings>)=>void;
}) {
  const legacy:FilterScheme={id:'default-filter-scheme',name:'默认方案',showKeyword:settings.showKeyword!==false,
    groups:[{id:'default-filter-fields',name:'默认权限组',roleIds:[],actions:[],columns:names}]};
  const schemes=settings.schemes??[legacy];
  const [selected,setSelected]=useState(schemes[0]?.id);
  const active=schemes.find(item=>item.id===selected)||schemes[0];
  const commit=(next:FilterScheme[])=>onChange({schemes:next,requiredFields:[],expandAdvanced:false});
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
      <PropertyRow label="通用搜索" hint="额外的关键词搜索框，不是业务字段。开启后使用数据源的通用文本搜索；新方案默认关闭。"><Switch size="small" checked={active.showKeyword!==false} disabled={disabled} onChange={showKeyword=>patch({showKeyword})}/></PropertyRow>
      <ToolbarGroups key={active.id} scope="filter-fields" groups={active.groups} roles={roles} disabled={disabled} initialValues={{columns:[]}} onChange={groups=>patch({groups})} renderGroup={(group,update)=><ColumnPicker mode="filters" value={group.columns??[]} options={options} disabled={disabled} onChange={columns=>update({columns})} sortableColumns={[]} onSortingChange={()=>{}}/>}/>

    </>}
  </PropertyGroup>;
}
