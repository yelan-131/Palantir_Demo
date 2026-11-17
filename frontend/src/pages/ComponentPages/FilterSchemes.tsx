import React from 'react';
import {Button, Input, Select, Switch, Tooltip} from 'antd';
import {DeleteOutlined, PlusOutlined} from '@ant-design/icons';
import ConfigurationTabs from './ConfigurationTabs';
import {PropertyRow} from '@/components/PropertyInspector';
import ToolbarGroups, {GroupAudience, PropertySubgroup} from './ToolbarGroups';
import ColumnPicker from './ColumnPicker';
import {DEFAULT_FILTER_LAYOUT, type FilterControlMode, type FilterScheme, type FilterSettings} from './businessComponents';

const controlOptions = [
  {label:'沿用来源',value:'inherit'}, {label:'下拉单选',value:'dropdown'},
  {label:'单选按钮',value:'radio'}, {label:'下拉多选',value:'multi-dropdown'}, {label:'多选框',value:'checkbox'},
];
const rowOptions = [
  {label:'自动', value:0},
  ...Array.from({length:12}, (_, index)=>({label:`${index + 1} 行`, value:index + 1})),
];
const columnOptions = Array.from({length:6}, (_, index)=>({label:`${index + 1} 个`, value:index + 1}));

export default function FilterSchemes({settings,names,options,roles,disabled,onChange,selected,onSelect,children}: {
  children:React.ReactNode; selected?:string; onSelect?:(id:string)=>void;
  settings:FilterSettings;names:string[];options:Array<{label:string;value:string;choice:boolean}>;
  roles:Array<{id:number;name:string;label?:string}>;disabled:boolean;onChange:(settings:Partial<FilterSettings>)=>void;
}) {
  const legacy:FilterScheme={id:'default-filter-scheme',name:'默认方案',showKeyword:settings.showKeyword!==false,
    groups:[{id:'default-filter-fields',name:'默认权限组',roleIds:[],actions:[],columns:names}]};
  const schemes=settings.schemes??[legacy];
  const active=schemes.find(item=>item.id===selected)||schemes[0];
  const groups:FilterScheme['groups'] = active?.groups.length ? active.groups :
    [{id:'default-filter-fields',name:'默认权限组',roleIds:[],actions:[],columns:[]}];
  const commit=(next:FilterScheme[])=>onChange(settings.schemes==null
    ? {schemes:next,requiredFields:[],expandAdvanced:false}
    : {schemes:next});
  const patch=(value:Partial<FilterScheme>)=>commit(schemes.map(item=>item.id===active?.id?{...item,...value}:item));
  const addScheme = () => {
    const copy = structuredClone(active ?? legacy);
    commit([...schemes, {
      ...copy,
      id: crypto.randomUUID(),
      name: `方案 ${schemes.length + 1}`,
      groups: copy.groups.map(group=>({...group,id:crypto.randomUUID()})),
    }]);
  };
  const deleteActiveScheme = () => {
    const remaining = schemes.filter(item=>item.id !== active?.id);
    commit(remaining);
    onSelect?.(remaining[0].id);
  };
  const audienceEditors=groups.map(group=><GroupAudience key={`${active?.id}:${group.id}`} group={group} roles={roles}
    title={groups.length===1?'适用对象':group.name} subgroup={groups.length===1} disabled={disabled}
    onChange={values=>patch({groups:groups.map(item=>item.id===group.id?{...item,...values}:item)})}/>);
  return <div className="component-config-tab-group">
      <ConfigurationTabs items={schemes} selected={active?.id} onSelect={onSelect} disabled={disabled} actions={<>
          <Tooltip title="新增筛选方案">
            <Button type="text" size="small" aria-label="新增筛选方案" icon={<PlusOutlined />}
              disabled={disabled || schemes.length >= 12} onClick={addScheme}/>
          </Tooltip>
          <Tooltip title={schemes.length > 1 ? `删除当前方案：${active?.name}` : '至少保留一个筛选方案'}>
            <Button type="text" size="small" danger aria-label="删除当前筛选方案" icon={<DeleteOutlined />}
              disabled={disabled || schemes.length <= 1} onClick={deleteActiveScheme}/>
          </Tooltip>
      </>}/>
      {active&&<PropertyRow label="方案名称"><Input aria-label="筛选方案名称" maxLength={50} value={active.name} disabled={disabled} onChange={event=>patch({name:event.target.value})}/></PropertyRow>}
    {active&&<>
      {groups.length===1?audienceEditors:<PropertySubgroup title="适用对象">{audienceEditors}</PropertySubgroup>}
      <PropertySubgroup title="筛选区域">
        <PropertyRow label="默认行数" hint="字段不足时预留行高。字段超过设定行数时继续换行，查询和重置按钮放在最后一行字段下方。">
          <Select aria-label="默认行数" value={active.defaultRows??DEFAULT_FILTER_LAYOUT.rows} disabled={disabled} options={rowOptions}
            onChange={defaultRows=>patch({defaultRows})}/>
        </PropertyRow>
        <PropertyRow label="每行筛选项" hint="关键词占一个位置。窄屏每行最多显示两个筛选项。">
          <Select aria-label="每行筛选项" value={active.fieldsPerRow??DEFAULT_FILTER_LAYOUT.columns} disabled={disabled}
            options={columnOptions} onChange={fieldsPerRow=>patch({fieldsPerRow})}/>
        </PropertyRow>
        <PropertyRow label="关键词搜索" hint="按来源表单设置的可搜索字段查找记录。"><Switch size="small" checked={active.showKeyword!==false} disabled={disabled} onChange={showKeyword=>patch({showKeyword})}/></PropertyRow>
        <ToolbarGroups key={active.id} scope="filter-fields" groups={groups}
          roles={roles} disabled={disabled} onChange={groups=>{
          const fields=new Set(groups.flatMap(group=>group.columns??[]));
          const fieldControls=Object.fromEntries(Object.entries(active.fieldControls??{}).filter(([name])=>fields.has(name)));
          patch({groups,fieldControls});
        }} renderGroup={(group,update)=><ColumnPicker mode="filters" value={group.columns??[]} options={options} disabled={disabled} onChange={columns=>update({columns})} renderFieldSettings={(name,selected)=>{
          const field=options.find(item=>item.value===name);
          if(!field?.choice)return null;
          return <Select size="small" className="component-filter-control-mode" aria-label={field.label+'的选择方式'}
            disabled={disabled||!selected} value={active.fieldControls?.[name]??'inherit'} options={controlOptions}
            onChange={(mode:FilterControlMode|'inherit')=>{
              const fieldControls={...active.fieldControls};
              if(mode==='inherit')delete fieldControls[name];else fieldControls[name]=mode;
              patch({fieldControls});
            }}/>;
        }} sortableColumns={[]} onSortingChange={()=>{}}/>}/>

      </PropertySubgroup>
    </>}
    {children}
  </div>;
}
