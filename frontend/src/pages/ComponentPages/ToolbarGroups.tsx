import PermissionTemplates from './PermissionTemplates';
import React, {useEffect, useRef, useState} from 'react';
import {Button, Input, Select, Switch, Tooltip} from 'antd';
import {CopyOutlined, DeleteOutlined, PlusOutlined} from '@ant-design/icons';
import {PropertyHelp, PropertyRow} from '@/components/PropertyInspector';
import ConfigurationTabs from './ConfigurationTabs';
import api from '@/services/api';
import {mergePermissionAudience, type ToolbarGroup} from './businessComponents';
import './toolbar-groups.css';

export function PropertySubgroup({title,hint,children}: {
  title:string; hint?:React.ReactNode; children:React.ReactNode;
}) {
  return <details className="component-toolbar-group" open>
    <summary>
      <span className="component-toolbar-group-name">{title}</span>
      {hint&&<PropertyHelp label={title+'帮助'}>{hint}</PropertyHelp>}
    </summary>
    {children}
  </details>;
}

const actions = [{value:'create',label:'新增 / 填写申请'},{value:'refresh',label:'刷新'},{value:'import',label:'批量导入'},{value:'export',label:'导出'},{value:'disable',label:'禁用'},{value:'delete',label:'删除'}];
export default function ToolbarGroups({groups,roles,disabled,onChange,renderGroup,initialValues,selectedGroup,onSelectGroup,scope='toolbar'}: {
  scope?:'toolbar'|'access'|'display'|'filter-fields'; initialValues?:Partial<ToolbarGroup>; renderGroup?:(group:ToolbarGroup,patch:(value:Partial<ToolbarGroup>)=>void)=>React.ReactNode;
  selectedGroup?:string; onSelectGroup?:(id:string)=>void;
  groups:ToolbarGroup[]; roles:Array<{id:number;name:string;label?:string}>; disabled:boolean; onChange:(groups:ToolbarGroup[])=>void;
}) {
  const isFilterArea = scope==='filter-fields';
  const canManageGroups = !isFilterArea;
  const showGroupHeading = !isFilterArea || groups.length>1;
  const [renaming,setRenaming] = useState<string>();
  const [name,setName] = useState('');
  const patch = (id:string,update:Partial<ToolbarGroup>)=>onChange(groups.map(group=>group.id===id?{...group,...update}:group));
  const saveName = (group:ToolbarGroup)=>{if(name.trim())patch(group.id,{name:name.trim()});setRenaming(undefined);};
  const addGroup = () => {
    const group = {id:crypto.randomUUID(),name:`权限组 ${groups.length+1}`,roleIds:[],actions:[],...initialValues};
    onChange([...groups,group]);
    return group.id;
  };
  const copyGroup = (group:ToolbarGroup) => {
    const index = groups.indexOf(group);
    const copy = {...structuredClone(group),id:crypto.randomUUID(),name:(group.name+' 副本').slice(0,50)};
    onChange([...groups.slice(0,index+1),copy,...groups.slice(index+1)]);
    return copy.id;
  };
  if(scope==='display'){
    const active = groups.find(group=>group.id===selectedGroup) ?? groups[0];
    return <div className="component-config-tab-group">
      <ConfigurationTabs items={groups} selected={active?.id} onSelect={onSelectGroup} disabled={disabled} actions={<>
        <Tooltip title="新增权限组"><Button type="text" size="small" aria-label="新增权限组" icon={<PlusOutlined/>}
          disabled={disabled||groups.length>=20} onClick={()=>{const id=addGroup();onSelectGroup?.(id);}}/></Tooltip>
        <Tooltip title="复制当前权限组"><Button type="text" size="small" aria-label="复制当前权限组" icon={<CopyOutlined/>}
          disabled={disabled||!active||groups.length>=20} onClick={()=>{if(active){const id=copyGroup(active);onSelectGroup?.(id);}}}/></Tooltip>
        <Tooltip title="删除当前权限组"><Button type="text" size="small" danger aria-label="删除当前权限组" icon={<DeleteOutlined/>}
          disabled={disabled||!active} onClick={()=>active&&onChange(groups.filter(group=>group.id!==active.id))}/></Tooltip>
      </>}/>
      {active&&<React.Fragment key={active.id}>
        <PropertyRow label="权限组名称">
          <Input key={active.name} defaultValue={active.name} disabled={disabled} maxLength={50}
            onBlur={event=>{
              const name = event.currentTarget.value.trim();
              if(name && name!==active.name)patch(active.id,{name});
              else event.currentTarget.value = active.name;
            }}
            onPressEnter={event=>event.currentTarget.blur()}/>
        </PropertyRow>
        <GroupAudience group={active} roles={roles} disabled={disabled} subgroup onChange={update=>patch(active.id,update)}/>
        {renderGroup?.(active,value=>patch(active.id,value))}
      </React.Fragment>}
    </div>;
  }
  return <div className="component-toolbar-groups">
    {canManageGroups&&<div className="component-toolbar-groups-heading"><span>权限设置</span><div className="component-toolbar-heading-actions"><Button type="text" size="small" aria-label="新增权限组" disabled={disabled || groups.length>=20} icon={<PlusOutlined />} onClick={addGroup}/></div></div>}
    {groups.map(group=>{
      const controls = <>
      {!isFilterArea&&<GroupAudience group={group} roles={roles} disabled={disabled} onChange={update=>patch(group.id,update)}/>}
      {renderGroup?renderGroup(group,value=>patch(group.id,value)):<details className="component-toolbar-buttons" open><summary>按钮组</summary>
      {actions.map(action=><PropertyRow key={action.value} label={action.label}><Switch size="small" checked={group.actions.includes(action.value)} disabled={disabled} onChange={checked=>patch(group.id,{actions:checked?[...group.actions,action.value]:group.actions.filter(value=>value!==action.value)})}/></PropertyRow>)}
      </details>}
      </>;
      if(!showGroupHeading)return <React.Fragment key={group.id}>{controls}</React.Fragment>;
      return <details className="component-toolbar-group" key={group.id} open>
      <summary><span className="component-toolbar-group-name" title="双击更改名称" onClick={event=>event.preventDefault()} onDoubleClick={event=>{event.preventDefault();if(!disabled){setName(group.name);setRenaming(group.id);}}}>
        {renaming===group.id?<Input autoFocus aria-label="权限组名称" value={name} maxLength={50} onClick={event=>event.stopPropagation()} onChange={event=>setName(event.target.value)} onBlur={()=>saveName(group)} onKeyDown={event=>{event.stopPropagation();if(event.key==='Enter')saveName(group);if(event.key==='Escape')setRenaming(undefined);}}/>:group.name}
      </span>{canManageGroups&&<Button type="text" size="small" title="复制权限组" aria-label={`复制权限组 ${group.name}`} disabled={disabled||groups.length>=20} icon={<CopyOutlined/>} onClick={event=>{event.preventDefault();const index=groups.findIndex(item=>item.id===group.id);const copy={...structuredClone(group),id:crypto.randomUUID(),name:(group.name+' 副本').slice(0,50)};onChange([...groups.slice(0,index+1),copy,...groups.slice(index+1)]);}}/>}{(canManageGroups||isFilterArea&&groups.length>1)&&<Button type="text" size="small" aria-label={`删除权限组 ${group.name}`} disabled={disabled} icon={<DeleteOutlined/>} onClick={event=>{event.preventDefault();onChange(groups.filter(item=>item.id!==group.id));}}/>}</summary>
      {controls}
      </details>;
    })}
  </div>;
}

export function GroupAudience({group,roles,disabled,onChange,title='适用对象',subgroup=false}: {title?:string;subgroup?:boolean;group:ToolbarGroup;roles:Array<{id:number;name:string;label?:string}>;disabled:boolean;onChange:(update:Partial<ToolbarGroup>)=>void}) {
  const [audiences,setAudiences]=useState<{users:Array<{id:number;label:string}>;orgUnits:Array<{id:number;label:string;type:string}>}>({users:[],orgUnits:[]});
  const [loading,setLoading]=useState(true),[error,setError]=useState(false);
  const load=()=>{setLoading(true);setError(false);api.get('/pages/permission-audiences').then(response=>setAudiences(response.data)).catch(()=>setError(true)).finally(()=>setLoading(false));};
  useEffect(load,[]);
  type Kind = 'roleIds'|'userIds'|'orgUnitIds';
  type Row = {id:string;kind?:Kind;values:number[]};
  const blankRow=():Row=>({id:crypto.randomUUID(),values:[]});
  const signature=JSON.stringify([group.roleIds,group.userIds||[],group.orgUnitIds||[]]);
  const makeRows=():Row[] => {
    const configured=(['roleIds','userIds','orgUnitIds'] as Kind[]).filter(kind=>group[kind]?.length)
      .map(kind=>({id:crypto.randomUUID(),kind,values:[...(group[kind]||[])]}));
    return configured.length ? configured : [blankRow()];
  };
  const [rows,setRows]=useState<Row[]>(makeRows);
  const lastSignature=useRef(signature);
  useEffect(()=>{if(signature!==lastSignature.current){setRows(makeRows());lastSignature.current=signature;}},[signature]);
  const commit=(next:Row[])=>{
    setRows(next.length ? next : [blankRow()]);
    const collect=(kind:Kind)=>[...new Set(next.filter(row=>row.kind===kind).flatMap(row=>row.values))];
    const update={roleIds:collect('roleIds'),userIds:collect('userIds'),orgUnitIds:collect('orgUnitIds')};
    lastSignature.current=JSON.stringify([update.roleIds,update.userIds,update.orgUnitIds]);
    onChange(update);
  };
  const choices:Record<Kind,Array<{value:number;label:string}>>={roleIds:roles.map(role=>({value:role.id,label:role.label||role.name})),userIds:audiences.users.map(user=>({value:user.id,label:user.label})),orgUnitIds:audiences.orgUnits.map(unit=>({value:unit.id,label:unit.label}))};
  return <details className={'component-toolbar-audience '+(subgroup?'component-toolbar-group':'component-toolbar-buttons')} open>
    <summary className="component-toolbar-audience-summary"><span>{title}</span><PropertyHelp label="适用对象帮助">留空表示全部用户可查看，仍受页面与组件访问权限限制。点击加号添加角色、用户或用户组/组织，可同时配置多种类型，匹配任意一项即可。组织仅匹配直接成员。</PropertyHelp><span className="component-toolbar-audience-template" onClick={event=>event.stopPropagation()}><PermissionTemplates scope="audience" groups={[{id:group.id,name:group.name,roleIds:group.roleIds,userIds:group.userIds,orgUnitIds:group.orgUnitIds,actions:[]}]} disabled={disabled} onImport={imported=>onChange(mergePermissionAudience(group,imported))}/></span><Button type="text" size="small" aria-label="新增适用对象" icon={<PlusOutlined/>} disabled={disabled||rows.length>=20} onClick={event=>{event.preventDefault();event.stopPropagation();setRows([...rows,blankRow()]);}}/></summary>
    {rows.map((row,index)=><div className="component-toolbar-audience-row" key={row.id}>
      <Select size="small" aria-label={'对象类型 '+(index+1)} disabled={disabled} placeholder="请选择类型" value={row.kind} options={[{value:'roleIds',label:'角色'},{value:'userIds',label:'用户'},{value:'orgUnitIds',label:'用户组/组织'}]} onChange={kind=>commit(rows.map(item=>item.id===row.id?{...item,kind,values:[]}:item))}/>
      <Select size="small" aria-label={'具体对象 '+(index+1)} mode="multiple" showSearch allowClear maxCount={100} disabled={disabled||!row.kind} loading={!!row.kind&&row.kind!=='roleIds'&&loading} placeholder="请选择" value={row.values} options={row.kind?choices[row.kind]:[]} optionFilterProp="label" notFoundContent={row.kind!=='roleIds'&&loading?'加载中…':error&&row.kind!=='roleIds'?'读取失败，请重试':'暂无匹配对象'} onChange={values=>commit(rows.map(item=>item.id===row.id?{...item,values}:item))}/>
      <Button type="text" size="small" aria-label={'删除适用对象 '+(index+1)} icon={<DeleteOutlined/>} disabled={disabled||rows.length===1&&!row.kind} onClick={()=>commit(rows.filter(item=>item.id!==row.id))}/>
    </div>)}
    {error&&<Button type="link" size="small" onClick={load}>用户及组织读取失败，点击重试</Button>}
  </details>;
}
