import React from 'react';
import FilterSchemes from './FilterSchemes';
import ColumnPicker from './ColumnPicker';
import ToolbarGroups from './ToolbarGroups';
import {Alert, Button, Input, InputNumber, Select, Switch} from 'antd';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import type {PlatformFormField} from '@/services/api';
import type {ViewConfig} from '@/utils/viewConfig';
import type {PageWidget} from './model';

export default function BusinessProperties({widget,tab,fields,view,onChange,disabled,roles}: {
  roles:Array<{id:number;name:string;label?:string}>; widget:PageWidget; tab:'data'|'interaction'|'toolbar'; fields:PlatformFormField[]; view?:ViewConfig;
  onChange:(value:Partial<PageWidget>)=>void; disabled:boolean;
}) {
  const options = fields.map(field=>({label:field.label,value:field.field_name}));
  const sourceFilters = view?.filters?.filter(filter=>filter.enabled!==false).map(filter=>filter.fieldName);
  const filterOptions = options;
  const sourceColumns = view?.table?.columns?.filter(column=>column.enabled!==false).map(column=>column.fieldName);
  const columnOptions = options.filter(option=>!sourceColumns||sourceColumns.includes(option.value));
  const filter = widget.filterSettings || {};
  const list = widget.listSettings || {};
  const patchFilter = (value:Partial<NonNullable<PageWidget['filterSettings']>>) => onChange({filterSettings:{...filter,...value}});
  const patchList = (value:Partial<NonNullable<PageWidget['listSettings']>>) => onChange({listSettings:{...list,...value}});
  const names = widget.filterFields ?? sourceFilters ?? filterOptions.map(option=>option.value);
  const columns = list.displayGroups == null ? list.columns ?? sourceColumns ?? columnOptions.map(option=>option.value) : [...new Set(list.displayGroups.flatMap(group=>group.columns||[]))];
  if(widget.type==='record-filter')return tab==='data'?<FilterSchemes key={widget.id} settings={filter} names={names} options={filterOptions} roles={roles} disabled={disabled} onChange={patchFilter}/>:tab==='toolbar'?<ToolbarGroups scope="filter" groups={filter.toolbarGroups??[{id:'default-filter-buttons',name:'默认权限组',roleIds:[],actions:['query','reset']}]} roles={roles} disabled={disabled} onChange={toolbarGroups=>patchFilter({toolbarGroups})} renderGroup={(group,patch)=><details className="component-toolbar-buttons" open><summary>按钮组</summary>
    <PropertyRow label="查询按钮"><Switch size="small" disabled={disabled} checked={group.actions.includes('query')} onChange={checked=>patch({actions:checked?[...group.actions,'query']:group.actions.filter(action=>action!=='query')})}/></PropertyRow>
    {group.actions.includes('query')&&<>
      <PropertyRow label="查询方式"><Select value={filter.queryMode??'submit'} options={[{label:'点击查询',value:'submit'},{label:'条件变化自动查询',value:'change'}]} onChange={queryMode=>patchFilter({queryMode})}/></PropertyRow>
      {filter.queryMode!=='change'&&<PropertyRow label="查询文字" hint="同一筛选组件的按钮文字与行为由全部权限组共用。"><Input maxLength={20} value={filter.queryLabel??'查询'} onChange={event=>patchFilter({queryLabel:event.target.value})}/></PropertyRow>}
    </>}
    <PropertyRow label="重置按钮"><Switch size="small" disabled={disabled} checked={group.actions.includes('reset')} onChange={checked=>patch({actions:checked?[...group.actions,'reset']:group.actions.filter(action=>action!=='reset')})}/></PropertyRow>
    {group.actions.includes('reset')&&<>
      <PropertyRow label="重置行为"><Select value={filter.resetMode??'defaults'} options={[{label:'恢复来源默认值',value:'defaults'},{label:'清空所有条件',value:'clear'}]} onChange={resetMode=>patchFilter({resetMode})}/></PropertyRow>
      <PropertyRow label="重置文字" hint="同一筛选组件的按钮文字与行为由全部权限组共用。"><Input maxLength={20} value={filter.resetLabel??'重置'} onChange={event=>patchFilter({resetLabel:event.target.value})}/></PropertyRow>
    </>}
  </details>}/>:null;
  if(widget.type!=='record-list')return null;
  const enabledActions = list.toolbarActions ?? view?.table?.toolbarActions ?? [];
  if(tab==='toolbar') return <ToolbarGroups groups={list.toolbarGroups ?? [{id:'default-toolbar',name:'默认权限组',roleIds:[],actions:enabledActions}]} roles={roles} disabled={disabled} onChange={toolbarGroups=>patchList({toolbarGroups})}/>;
  if(tab==='data')return <>
    <PropertyGroup title="列表显示">
      <ToolbarGroups scope="display" groups={list.displayGroups??[{id:'default-display',name:'默认权限组',roleIds:[],actions:[],columns}]} roles={roles} disabled={disabled} initialValues={{columns:[...columns],defaultSort:null,inheritDefaultSort:false,pageSize:view?.table?.pageSize??20,emptyText:'暂无符合条件的数据'}} onChange={displayGroups=>patchList({displayGroups})} renderGroup={(group,patch)=>{
        const selected=group.columns??columns;
        const sortable=group.sortableColumns??view?.table?.columns.filter(column=>column.sortable).map(column=>column.fieldName)??[];
        const inheritedSort=list.defaultSort??(view?.table?.defaultSort?{field:view.table.defaultSort.fieldName,order:view.table.defaultSort.order==='ascend'?'asc' as const:'desc' as const}:null);
        const candidate=group.defaultSort??(group.inheritDefaultSort!==false?inheritedSort:null);
        const defaultSort=candidate&&selected.includes(candidate.field)&&sortable.includes(candidate.field)?candidate:null;
        const reconcile=(visible:string[],sortFields:string[])=>defaultSort&&(!visible.includes(defaultSort.field)||!sortFields.includes(defaultSort.field))?{defaultSort:null,inheritDefaultSort:false}:{};
        return <>
          <ColumnPicker value={selected} options={columnOptions.map(option=>({...option,sortable:!!fields.find(field=>field.field_name===option.value)?.sortable}))} disabled={disabled} sortableColumns={sortable.filter(name=>selected.includes(name))} onSortingChange={sortableColumns=>patch({sortableColumns,...reconcile(selected,sortableColumns)})} onChange={columns=>patch({columns,sortableColumns:sortable.filter(name=>columns.includes(name)),...reconcile(columns,sortable)})}/>
          <PropertyRow label="默认排序" hint="仅可选择本组已勾选可看和排序的字段。多个组匹配时，按权限组顺序采用第一个有效的默认排序；留空不提供默认排序。"><Select disabled={disabled} allowClear value={defaultSort?.field} placeholder="不设置" options={columnOptions.filter(option=>selected.includes(option.value)&&sortable.includes(option.value)&&fields.find(field=>field.field_name===option.value)?.sortable)} onChange={field=>patch({defaultSort:field?{field,order:defaultSort?.order??'asc'}:null,inheritDefaultSort:false})}/></PropertyRow>
          {defaultSort&&<PropertyRow label="排序方向"><Select disabled={disabled} value={defaultSort.order} options={[{label:'升序',value:'asc'},{label:'降序',value:'desc'}]} onChange={order=>patch({defaultSort:{...defaultSort,order},inheritDefaultSort:false})}/></PropertyRow>}
          <PropertyRow label="每页条数" hint="多个权限组匹配时，按组顺序采用第一个已配置的条数；留空沿用原列表或来源配置。"><InputNumber disabled={disabled} min={1} max={200} precision={0} value={group.pageSize??undefined} placeholder={String(list.pageSize??view?.table?.pageSize??20)} onChange={pageSize=>patch({pageSize})}/></PropertyRow>
          <PropertyRow label="空数据提示" hint="多个权限组匹配时，按组顺序采用第一个非空提示；留空沿用原列表提示。"><Input disabled={disabled} value={group.emptyText??undefined} placeholder={list.emptyText||'暂无符合条件的数据'} maxLength={100} onChange={event=>patch({emptyText:event.target.value})}/></PropertyRow>
        </>;
      }}/>
    </PropertyGroup>
  </>;
  return <><PropertyGroup title="列表交互" hint={<>按钮受业务权限、记录状态与审批规则约束；记录选择仅作用于当前页。</>}>
    <PropertyRow label="行点击"><Select allowClear value={list.rowClick??undefined} placeholder="沿用来源" options={[{label:'无动作',value:'none'},{label:'打开详情',value:'detail',disabled:!!view?.table?.rowActions&&!view.table.rowActions.includes('detail')&&view.table.rowClickAction!=='detail'},{label:'编辑记录',value:'edit',disabled:!!view?.table?.rowActions&&!view.table.rowActions.includes('edit')&&view.table.rowClickAction!=='edit'}]} onChange={rowClick=>patchList({rowClick})} /></PropertyRow>
    <PropertyRow label="记录选择"><Select value={list.selection??'none'} options={[{label:'不启用',value:'none'},{label:'单选',value:'single'},{label:'多选',value:'multiple'}]} onChange={selection=>patchList({selection})} /></PropertyRow>
    <Button size="small" onClick={()=>patchList({rowClick:null,toolbarActions:null,toolbarGroups:null,rowActions:null})}>恢复来源操作配置</Button>

  </PropertyGroup></>;
}
