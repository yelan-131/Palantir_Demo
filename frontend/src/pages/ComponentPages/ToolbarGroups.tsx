import PermissionTemplates from './PermissionTemplates';
import React, {useEffect, useRef, useState} from 'react';
import {Button, Input, Select, Switch} from 'antd';
import {CopyOutlined, DeleteOutlined, PlusOutlined} from '@ant-design/icons';
import {PropertyHelp, PropertyRow} from '@/components/PropertyInspector';
import api from '@/services/api';
import {mergePermissionAudience, type ToolbarGroup} from './businessComponents';
import './toolbar-groups.css';

const actions = [{value:'create',label:'新增 / 填写申请'},{value:'refresh',label:'刷新'},{value:'import',label:'批量导入'},{value:'export',label:'导出'},{value:'disable',label:'禁用'},{value:'delete',label:'删除'}];
export default function ToolbarGroups({groups,roles,disabled,onChange,renderGroup,initialValues,scope='toolbar'}: {
  scope?:'toolbar'|'access'|'display'|'filter'|'filter-fields'; initialValues?:Partial<ToolbarGroup>; renderGroup?:(group:ToolbarGroup,patch:(value:Partial<ToolbarGroup>)=>void)=>React.ReactNode;
  groups:ToolbarGroup[]; roles:Array<{id:number;name:string;label?:string}>; disabled:boolean; onChange:(groups:ToolbarGroup[])=>void;
}) {
  const [renaming,setRenaming] = useState<string>();
  const [name,setName] = useState('');
  const patch = (id:string,update:Partial<ToolbarGroup>)=>onChange(groups.map(group=>group.id===id?{...group,...update}:group));
  const saveName = (group:ToolbarGroup)=>{if(name.trim())patch(group.id,{name:name.trim()});setRenaming(undefined);};
  return <div className="component-toolbar-groups">
    <div className="component-toolbar-groups-heading"><span>权限设置</span><div className="component-toolbar-heading-actions"><Button type="text" size="small" aria-label="新增权限组" disabled={disabled || groups.length>=20} icon={<PlusOutlined />} onClick={()=>onChange([...groups,{id:crypto.randomUUID(),name:`权限组 ${groups.length+1}`,roleIds:[],actions:[],...initialValues}])}/></div></div>
    {groups.map(group=><details className="component-toolbar-group" key={group.id} open>
      <summary><span className="component-toolbar-group-name" title="双击更改名称" onClick={event=>event.preventDefault()} onDoubleClick={event=>{event.preventDefault();if(!disabled){setName(group.name);setRenaming(group.id);}}}>
        {renaming===group.id?<Input autoFocus aria-label="权限组名称" value={name} maxLength={50} onClick={event=>event.stopPropagation()} onChange={event=>setName(event.target.value)} onBlur={()=>saveName(group)} onKeyDown={event=>{event.stopPropagation();if(event.key==='Enter')saveName(group);if(event.key==='Escape')setRenaming(undefined);}}/>:group.name}
      </span><Button type="text" size="small" title="复制权限组" aria-label={`复制权限组 ${group.name}`} disabled={disabled||groups.length>=20} icon={<CopyOutlined/>} onClick={event=>{event.preventDefault();const index=groups.findIndex(item=>item.id===group.id);const copy={...structuredClone(group),id:crypto.randomUUID(),name:(group.name+' 副本').slice(0,50)};onChange([...groups.slice(0,index+1),copy,...groups.slice(index+1)]);}}/><Button type="text" size="small" aria-label={`删除权限组 ${group.name}`} disabled={disabled} icon={<DeleteOutlined/>} onClick={event=>{event.preventDefault();onChange(groups.filter(item=>item.id!==group.id));}}/></summary>
      <GroupAudience group={group} roles={roles} disabled={disabled} onChange={update=>patch(group.id,update)}/>
      {renderGroup?renderGroup(group,value=>patch(group.id,value)):<details className="component-toolbar-buttons" open><summary>按钮组</summary>
      {actions.map(action=><PropertyRow key={action.value} label={action.label}><Switch size="small" checked={group.actions.includes(action.value)} disabled={disabled} onChange={checked=>patch(group.id,{actions:checked?[...group.actions,action.value]:group.actions.filter(value=>value!==action.value)})}/></PropertyRow>)}
      </details>}
    </details>)}
  </div>;
}

function GroupAudience({group,roles,disabled,onChange}: {group:ToolbarGroup;roles:Array<{id:number;name:string;label?:string}>;disabled:boolean;onChange:(update:Partial<ToolbarGroup>)=>void}) {
  const [audiences,setAudiences]=useState<{users:Array<{id:number;label:string}>;orgUnits:Array<{id:number;label:string;type:string}>}>({users:[],orgUnits:[]});
  const [loading,setLoading]=useState(true),[error,setError]=useState(false);
  const load=()=>{setLoading(true);setError(false);api.get('/pages/permission-audiences').then(response=>setAudiences(response.data)).catch(()=>setError(true)).finally(()=>setLoading(false));};
  useEffect(load,[]);
  type Kind = 'roleIds'|'userIds'|'orgUnitIds';
  type Row = {id:string;kind:Kind;values:number[]};
  const signature=JSON.stringify([group.roleIds,group.userIds||[],group.orgUnitIds||[]]);
  const makeRows=():Row[] => (['roleIds','userIds','orgUnitIds'] as Kind[]).filter(kind=>group[kind]?.length).map(kind=>({id:crypto.randomUUID(),kind,values:[...(group[kind]||[])]}));
  const [rows,setRows]=useState<Row[]>(makeRows);
  const lastSignature=useRef(signature);
  useEffect(()=>{if(signature!==lastSignature.current){setRows(makeRows());lastSignature.current=signature;}},[signature]);
  const commit=(next:Row[])=>{
    setRows(next);
    const collect=(kind:Kind)=>[...new Set(next.filter(row=>row.kind===kind).flatMap(row=>row.values))];
    const update={roleIds:collect('roleIds'),userIds:collect('userIds'),orgUnitIds:collect('orgUnitIds')};
    lastSignature.current=JSON.stringify([update.roleIds,update.userIds,update.orgUnitIds]);
    onChange(update);
  };
  const choices:Record<Kind,Array<{value:number;label:string}>>={roleIds:roles.map(role=>({value:role.id,label:role.label||role.name})),userIds:audiences.users.map(user=>({value:user.id,label:user.label})),orgUnitIds:audiences.orgUnits.map(unit=>({value:unit.id,label:unit.label}))};
  return <details className="component-toolbar-audience component-toolbar-buttons" open>
    <summary className="component-toolbar-audience-summary"><span>适用对象</span><PropertyHelp label="适用对象帮助">留空表示全部用户可查看，仍受页面与组件访问权限限制。点击加号添加角色、用户或用户组/组织，可同时配置多种类型，匹配任意一项即可。组织仅匹配直接成员。</PropertyHelp><span className="component-toolbar-audience-template" onClick={event=>event.stopPropagation()}><PermissionTemplates scope="audience" groups={[{id:group.id,name:group.name,roleIds:group.roleIds,userIds:group.userIds,orgUnitIds:group.orgUnitIds,actions:[]}]} disabled={disabled} onImport={imported=>onChange(mergePermissionAudience(group,imported))}/></span><Button type="text" size="small" aria-label="新增适用对象" icon={<PlusOutlined/>} disabled={disabled||rows.length>=20} onClick={event=>{event.preventDefault();event.stopPropagation();setRows([...rows,{id:crypto.randomUUID(),kind:'roleIds',values:[]}]);}}/></summary>
    {rows.map((row,index)=><div className="component-toolbar-audience-row" key={row.id}>
      <Select size="small" aria-label={'对象类型 '+(index+1)} disabled={disabled} value={row.kind} options={[{value:'roleIds',label:'角色'},{value:'userIds',label:'用户'},{value:'orgUnitIds',label:'用户组/组织'}]} onChange={kind=>commit(rows.map(item=>item.id===row.id?{...item,kind,values:[]}:item))}/>
      <Select size="small" aria-label={'具体对象 '+(index+1)} mode="multiple" showSearch allowClear maxCount={100} disabled={disabled} loading={row.kind!=='roleIds'&&loading} placeholder="请选择" value={row.values} options={choices[row.kind]} optionFilterProp="label" notFoundContent={row.kind!=='roleIds'&&loading?'加载中…':error&&row.kind!=='roleIds'?'读取失败，请重试':'暂无匹配对象'} onChange={values=>commit(rows.map(item=>item.id===row.id?{...item,values}:item))}/>
      <Button type="text" size="small" aria-label={'删除适用对象 '+(index+1)} icon={<DeleteOutlined/>} disabled={disabled} onClick={()=>commit(rows.filter(item=>item.id!==row.id))}/>
    </div>)}
    {error&&<Button type="link" size="small" onClick={load}>用户及组织读取失败，点击重试</Button>}
  </details>;
}
