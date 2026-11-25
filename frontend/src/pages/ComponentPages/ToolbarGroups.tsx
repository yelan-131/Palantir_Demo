import PermissionTemplates from './PermissionTemplates';
import React, {useEffect, useRef, useState} from 'react';
import {Button, Input, Select, Switch, Tooltip, type InputRef} from 'antd';
import {CopyOutlined, DeleteOutlined, PlusOutlined} from '@/components/Icon/ant';
import {PropertyHelp, PropertyRow} from '@/components/PropertyInspector';
import ConfigurationTabs, {ConfigurationName} from './ConfigurationTabs';
import api from '@/services/api';
import {createUuid} from '@/utils/uuid';
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

function PermissionGroupsHeading({actions, hint}: {actions?: React.ReactNode; hint?: string}) {
  return <div className="component-toolbar-groups-heading">
    <span className="component-toolbar-groups-label">
      权限设置
      {hint && <PropertyHelp label="权限设置帮助">{hint}</PropertyHelp>}
    </span>
    {actions && <div className="component-toolbar-heading-actions">{actions}</div>}
  </div>;
}

export function PermissionGroupName({name, onChange, onRequestEdit, requestEdit = false, onEditStarted}: {
  name: string;
  onChange?: (name: string) => void;
  onRequestEdit?: () => void;
  requestEdit?: boolean;
  onEditStarted?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (requestEdit && onChange) {
      setEditing(true);
      onEditStarted?.();
    }
  }, [requestEdit, onChange, onEditStarted]);
  const canEdit = Boolean(onChange || onRequestEdit);
  const startEdit = () => {
    if (onChange) setEditing(true);
    else onRequestEdit?.();
  };

  if (editing && onChange) {
    return <span className="component-toolbar-group-name">
      <Input autoFocus size="small" aria-label="权限组名称" defaultValue={name} maxLength={50}
        onFocus={event => event.currentTarget.select()}
        onClick={event => { event.stopPropagation(); }}
        onBlur={event => {
          const nextName = event.currentTarget.value.trim();
          if (nextName && nextName !== name) onChange(nextName);
          setEditing(false);
        }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.value = name;
            event.currentTarget.blur();
          }
        }} />
    </span>;
  }

  return <span className="component-toolbar-group-name" title={canEdit ? '双击更改名称' : name}
    tabIndex={canEdit ? 0 : undefined}
    onClick={canEdit ? event => event.preventDefault() : undefined}
    onDoubleClick={canEdit ? event => { event.preventDefault(); startEdit(); } : undefined}
    onKeyDown={canEdit ? event => {
      if (event.key !== 'Enter' && event.key !== 'F2') return;
      event.preventDefault();
      event.stopPropagation();
      startEdit();
    } : undefined}>{name}</span>;
}

const actions = [
  {value:'create',label:'新增 / 填写申请'},
  {value:'refresh',label:'刷新'},
  {value:'import',label:'批量导入'},
  {value:'export',label:'导出'},
  {value:'delete',label:'删除所选',hint:'启用记录选择后，选中可删除的记录时显示。删除仍受来源权限和记录状态约束。'},
];
export default function ToolbarGroups({groups,roles,disabled,onChange,renderGroup,initialValues,selectedGroup,onSelectGroup,scope='toolbar',accessTarget='应用',headingHint,renameGroupId,onRenameRequest,onRenameStarted}: {
  scope?:'toolbar'|'access'|'roles'|'display'|'filter-fields'; initialValues?:Partial<ToolbarGroup>; renderGroup?:(group:ToolbarGroup,patch:(value:Partial<ToolbarGroup>)=>void)=>React.ReactNode;
  accessTarget?: '应用' | '菜单';
  headingHint?: string;
  renameGroupId?: string;
  onRenameRequest?: (id: string) => void;
  onRenameStarted?: () => void;
  selectedGroup?:string; onSelectGroup?:(id:string)=>void;
  groups:ToolbarGroup[]; roles:Array<{id:number;name:string;label?:string}>; disabled:boolean; onChange:(groups:ToolbarGroup[])=>void;
}) {
  const isFilterArea = scope==='filter-fields';
  const canManageGroups = !isFilterArea;
  const [displayRenameId, setDisplayRenameId] = useState<string>();
  const displayNameInput = useRef<InputRef>(null);
  const activeDisplayGroup = scope==='display' ? groups.find(group=>group.id===selectedGroup) ?? groups[0] : undefined;
  useEffect(() => {
    if (displayRenameId && displayRenameId === activeDisplayGroup?.id) {
      displayNameInput.current?.focus({cursor:'all'});
      setDisplayRenameId(undefined);
    }
  }, [activeDisplayGroup?.id, displayRenameId]);
  const patch = (id:string,update:Partial<ToolbarGroup>)=>onChange(groups.map(group=>group.id===id?{...group,...update}:group));
  const addGroup = () => {
    const group = {id:createUuid(),name:`权限组 ${groups.length+1}`,roleIds:[],actions:[],...initialValues};
    onChange([...groups,group]);
    return group.id;
  };
  const copyGroup = (group:ToolbarGroup) => {
    const index = groups.indexOf(group);
    const copy = {...structuredClone(group),id:createUuid(),name:(group.name+' 副本').slice(0,50)};
    onChange([...groups.slice(0,index+1),copy,...groups.slice(index+1)]);
    return copy.id;
  };
  if(scope==='display'){
    const active = activeDisplayGroup;
    return <ConfigurationTabs items={groups} selected={active?.id} onSelect={onSelectGroup} disabled={disabled}
        onRename={id => { onSelectGroup?.(id); setDisplayRenameId(id); }} actions={<>
        <Tooltip title="新增权限组"><Button type="text" size="small" aria-label="新增权限组" icon={<PlusOutlined/>}
          disabled={disabled||groups.length>=20} onClick={()=>{const id=addGroup();onSelectGroup?.(id);}}/></Tooltip>
        <Tooltip title="复制当前权限组"><Button type="text" size="small" aria-label="复制当前权限组" icon={<CopyOutlined/>}
          disabled={disabled||!active||groups.length>=20} onClick={()=>{if(active){const id=copyGroup(active);onSelectGroup?.(id);}}}/></Tooltip>
        <Tooltip title="删除当前权限组"><Button type="text" size="small" danger aria-label="删除当前权限组" icon={<DeleteOutlined/>}
          disabled={disabled||!active} onClick={()=>active&&onChange(groups.filter(group=>group.id!==active.id))}/></Tooltip>
      </>}>
      {active&&<React.Fragment key={active.id}>
        <ConfigurationName label="权限组名称" inputRef={displayNameInput}
          value={active.name} disabled={disabled} commitOnBlur onChange={name=>patch(active.id,{name})}/>
        <GroupAudience group={active} roles={roles} disabled={disabled} subgroup onChange={update=>patch(active.id,update)}/>
        {renderGroup?.(active,value=>patch(active.id,value))}
      </React.Fragment>}
    </ConfigurationTabs>;
  }
  return <div className="component-toolbar-groups">
    {canManageGroups&&<PermissionGroupsHeading hint={headingHint} actions={<Button type="text" size="small" aria-label="新增权限组" disabled={disabled || groups.length>=20} icon={<PlusOutlined />} onClick={addGroup}/>}/>}
    {groups.map(group=>{
      const controls = <>
      {scope==='roles'
        ? <RoleAudience target={accessTarget} group={group} roles={roles} disabled={disabled} onChange={roleIds=>patch(group.id,{roleIds})}/>
        : !isFilterArea && <GroupAudience group={group} roles={roles} disabled={disabled} onChange={update=>patch(group.id,update)}/>}
      {renderGroup?renderGroup(group,value=>patch(group.id,value)):<details className="component-toolbar-buttons" open><summary>按钮组</summary>
      {actions.map(action=><PropertyRow key={action.value} label={action.label} hint={action.hint}><Switch size="small" checked={group.actions.includes(action.value)} disabled={disabled} onChange={checked=>patch(group.id,{actions:checked?[...group.actions,action.value]:group.actions.filter(value=>value!==action.value)})}/></PropertyRow>)}
      </details>}
      </>;
      return <details className="component-toolbar-group" key={group.id} open>
      <summary>
        <PermissionGroupName name={group.name} onChange={disabled ? undefined : name => patch(group.id, {name})}
          onRequestEdit={onRenameRequest && (() => onRenameRequest(group.id))}
          requestEdit={renameGroupId === group.id} onEditStarted={onRenameStarted} />
        {canManageGroups&&<Button type="text" size="small" title="复制权限组" aria-label={`复制权限组 ${group.name}`} disabled={disabled||groups.length>=20} icon={<CopyOutlined/>} onClick={event=>{event.preventDefault();copyGroup(group);}}/>}
        {(canManageGroups||isFilterArea&&groups.length>1)&&<Button type="text" size="small" aria-label={`删除权限组 ${group.name}`} disabled={disabled} icon={<DeleteOutlined/>} onClick={event=>{event.preventDefault();onChange(groups.filter(item=>item.id!==group.id));}}/>}
      </summary>
      {controls}
      </details>;
    })}
  </div>;
}

function AudienceSection({title = '适用对象', hint, actions, children, subgroup = false}: {
  title?: React.ReactNode;
  hint: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  subgroup?: boolean;
}) {
  return <details className={'component-toolbar-audience '+(subgroup?'component-toolbar-group':'component-toolbar-buttons')} open>
    <summary className="component-toolbar-audience-summary">
      <span>{title}</span>
      <PropertyHelp label="适用对象帮助">{hint}</PropertyHelp>
      {actions}
    </summary>
    {children}
  </details>;
}

function RemoveAudienceButton({index, disabled, onClick}: {
  index: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return <Button type="text" size="small" title="删除适用对象" aria-label={`删除适用对象 ${index + 1}`}
    icon={<DeleteOutlined/>} disabled={disabled} onClick={onClick} />;
}

export type RoleAccessGroup = Pick<ToolbarGroup, 'id' | 'name' | 'roleIds'>;

export function defaultRoleAccessGroups(roleIds: number[] = []): RoleAccessGroup[] {
  return [{id: 'default-access', name: '默认权限组', roleIds}];
}

export function RoleAccessSettings({roles, disabled, value = [], onChange, target = '应用', renameGroupId, onRenameRequest, onRenameStarted}: {
  roles: Array<{id: number; name: string; label?: string}>;
  disabled: boolean;
  value?: RoleAccessGroup[];
  onChange?: (groups: RoleAccessGroup[]) => void;
  target?: '应用' | '菜单';
  renameGroupId?: string;
  onRenameRequest?: (id: string) => void;
  onRenameStarted?: () => void;
}) {
  return <>
    <ToolbarGroups scope="roles" accessTarget={target} roles={roles} disabled={disabled} renderGroup={() => null}
      renameGroupId={renameGroupId} onRenameRequest={onRenameRequest} onRenameStarted={onRenameStarted}
      headingHint={target === '菜单' ? '控制此菜单的可见与进入权限。记录和字段权限由表单设计管理。' : undefined}
      groups={value.map(group => ({...group, actions: []}))}
      onChange={groups => onChange?.(groups.map(({id, name, roleIds}) => ({id, name, roleIds})))} />
    {target === '应用' && value.every(group => group.roleIds.length === 0) &&
      <div className="component-toolbar-audience-note">仅管理员可访问</div>}
  </>;
}

function RoleAudience({target, group, roles, disabled, onChange}: {
  target: '应用' | '菜单';
  group: ToolbarGroup;
  roles: Array<{id: number; name: string; label?: string}>;
  disabled: boolean;
  onChange: (roleIds: number[]) => void;
}) {
  const [selectOpen, setSelectOpen] = useState(false);
  const selectRef = useRef<React.ElementRef<typeof Select>>(null);
  const hint = target === '应用' ? '拥有任一权限组所选角色的用户可访问应用。全部权限组留空时，仅管理员可访问。'
    : '匹配任一权限组的角色可获得菜单访问权限，仍需具备应用和目标页面或表单的访问权限。';
  return <AudienceSection hint={hint}
    actions={<>
      <span className="component-toolbar-audience-template" onClick={event => event.stopPropagation()}>
        <PermissionTemplates scope="audience" groups={[group]} disabled={disabled} allowedRoleIds={roles.map(role => role.id)} accessTarget={target}
          onImport={groups => onChange(mergePermissionAudience(group, groups).roleIds)} />
      </span>
      <Button type="text" size="small" title="新增适用对象" aria-label="新增适用对象" icon={<PlusOutlined/>}
        disabled={disabled} onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          selectRef.current?.focus();
          setSelectOpen(true);
        }} />
    </>}>
    <div className="component-toolbar-audience-row">
      <Select size="small" aria-label="对象类型" value="role" options={[{value: 'role', label: '角色'}]} disabled />
      <Select ref={selectRef} size="small" aria-label={`可访问${target}的角色`} mode="multiple" showSearch allowClear
        disabled={disabled} placeholder="请选择角色" value={group.roleIds} open={!disabled && selectOpen}
        onDropdownVisibleChange={setSelectOpen} options={roles.map(role => ({value: role.id, label: role.label || role.name}))}
        optionFilterProp="label" notFoundContent="暂无匹配角色" onChange={onChange} />
      <RemoveAudienceButton index={0} disabled={disabled || group.roleIds.length === 0} onClick={() => {
        setSelectOpen(false);
        onChange([]);
      }} />
    </div>
  </AudienceSection>;
}

export function GroupAudience({group,roles,disabled,onChange,title='适用对象',subgroup=false}: {title?:React.ReactNode;subgroup?:boolean;group:ToolbarGroup;roles:Array<{id:number;name:string;label?:string}>;disabled:boolean;onChange:(update:Partial<ToolbarGroup>)=>void}) {
  const [audiences,setAudiences]=useState<{users:Array<{id:number;label:string}>;orgUnits:Array<{id:number;label:string;type:string}>}>({users:[],orgUnits:[]});
  const [loading,setLoading]=useState(true),[error,setError]=useState(false);
  const load=()=>{setLoading(true);setError(false);api.get('/pages/permission-audiences').then(response=>setAudiences(response.data)).catch(()=>setError(true)).finally(()=>setLoading(false));};
  useEffect(load,[]);
  type Kind = 'roleIds'|'userIds'|'orgUnitIds';
  type Row = {id:string;kind?:Kind;values:number[]};
  const blankRow=():Row=>({id:createUuid(),values:[]});
  const signature=JSON.stringify([group.roleIds,group.userIds||[],group.orgUnitIds||[]]);
  const makeRows=():Row[] => {
    const configured=(['roleIds','userIds','orgUnitIds'] as Kind[]).filter(kind=>group[kind]?.length)
      .map(kind=>({id:createUuid(),kind,values:[...(group[kind]||[])]}));
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
  return <AudienceSection title={title} subgroup={subgroup}
    hint="留空表示全部用户可查看，仍受页面与组件访问权限限制。点击加号添加角色、用户或用户组/组织，可同时配置多种类型，匹配任意一项即可。组织仅匹配直接成员。"
    actions={<>
      <span className="component-toolbar-audience-template" onClick={event=>event.stopPropagation()}><PermissionTemplates scope="audience" groups={[{id:group.id,name:group.name,roleIds:group.roleIds,userIds:group.userIds,orgUnitIds:group.orgUnitIds,actions:[]}]} disabled={disabled} onImport={imported=>onChange(mergePermissionAudience(group,imported))}/></span>
      <Button type="text" size="small" title="新增适用对象" aria-label="新增适用对象" icon={<PlusOutlined/>} disabled={disabled||rows.length>=20} onClick={event=>{event.preventDefault();event.stopPropagation();setRows([...rows,blankRow()]);}}/>
    </>}>
    {rows.map((row,index)=><div className="component-toolbar-audience-row" key={row.id}>
      <Select size="small" aria-label={'对象类型 '+(index+1)} disabled={disabled} placeholder="请选择类型" value={row.kind} options={[{value:'roleIds',label:'角色'},{value:'userIds',label:'用户'},{value:'orgUnitIds',label:'用户组/组织'}]} onChange={kind=>commit(rows.map(item=>item.id===row.id?{...item,kind,values:[]}:item))}/>
      <Select size="small" aria-label={'具体对象 '+(index+1)} mode="multiple" showSearch allowClear maxCount={100} disabled={disabled||!row.kind} loading={!!row.kind&&row.kind!=='roleIds'&&loading} placeholder="请选择" value={row.values} options={row.kind?choices[row.kind]:[]} optionFilterProp="label" notFoundContent={row.kind!=='roleIds'&&loading?'加载中…':error&&row.kind!=='roleIds'?'读取失败，请重试':'暂无匹配对象'} onChange={values=>commit(rows.map(item=>item.id===row.id?{...item,values}:item))}/>
      <RemoveAudienceButton index={index} disabled={disabled||rows.length===1&&!row.kind} onClick={()=>commit(rows.filter(item=>item.id!==row.id))} />
    </div>)}
    {error&&<Button type="link" size="small" onClick={load}>用户及组织读取失败，点击重试</Button>}
  </AudienceSection>;
}
