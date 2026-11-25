import React from 'react';
import FilterSchemes from './FilterSchemes';
import ColumnPicker from './ColumnPicker';
import ToolbarGroups, {PropertySubgroup} from './ToolbarGroups';
import {Alert, Button, Input, InputNumber, Select, Switch} from 'antd';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import type {PlatformFormField} from '@/services/api';
import type {ViewConfig} from '@/utils/viewConfig';
import {APPROVAL_STATUS_FIELD, APPROVAL_STATUS_LABEL, RECORD_METADATA_FIELDS, filterButtonActions, withDefaultRecordMetadata} from './businessComponents';
import {sourceFilterConfig, sourceFilterControlLabel, type FilterField} from './filterControls';
import type {PageWidget} from './model';

export default function BusinessProperties({widget,tab,fields,view,onChange,disabled,roles,selectedFilterScheme,onSelectFilterScheme,selectedDisplayGroup,onSelectDisplayGroup,approvalStatusAvailable=false,approvalStatusDefaultVisible=false}: {
  roles:Array<{id:number;name:string;label?:string}>; widget:PageWidget; tab:'data'|'interaction'|'toolbar'; fields:PlatformFormField[]; view?:ViewConfig;
  onChange:(value:Partial<PageWidget>)=>void; disabled:boolean;
  selectedFilterScheme?:string; onSelectFilterScheme?:(id:string)=>void;
  selectedDisplayGroup?:string; onSelectDisplayGroup?:(id:string)=>void;
  approvalStatusAvailable?: boolean; approvalStatusDefaultVisible?: boolean;
}) {
  const sourceFilters = (view?.tabs?.[0]?.filters ?? view?.filters)?.filter(filter=>filter.enabled!==false).map(filter=>filter.fieldName);
  const approvalOption = {label:APPROVAL_STATUS_LABEL, value:APPROVAL_STATUS_FIELD, system:true};
  const businessFilterOptions = fields.map(field=>{
    const ui=field.ui_config as Pick<FilterField,'controlType'|'typeSettings'|'relation_config'> | undefined;
    const config=sourceFilterConfig({
      ...field, controlType:ui?.controlType, typeSettings:ui?.typeSettings, relation_config:ui?.relation_config,
    }, 0);
    return {
      label:field.label, value:field.field_name,
      available:Boolean(field.searchable||field.sortable),
      choice:!ui?.relation_config&&ui?.controlType!=='relation'&&(ui?.controlType==='select'||field.field_type==='enum'),
      controlLabel:sourceFilterControlLabel(config),
    };
  });
  const filterOptions = [
    ...(approvalStatusAvailable ? [{...approvalOption,choice:false,controlLabel:'下拉单选'}] : []),
    ...businessFilterOptions,
    ...RECORD_METADATA_FIELDS.map(field=>({
      label:field.label, value:field.fieldName, system:true, choice:false, controlLabel:field.controlLabel,
    })),
  ];
  const sourceViews = view?.tabs?.length ? view.tabs : view ? [view] : [];
  const firstSourceTable = sourceViews[0]?.table;
  const enabledSourceColumns = sourceViews.flatMap(source=>[...(source.table?.columns??[])]
    .sort((left,right)=>(left.sortOrder??0)-(right.sortOrder??0)).filter(column=>column.enabled!==false));
  const sourceColumns = view
    ? [...new Set(enabledSourceColumns.map(column=>column.fieldName))]
    : fields.filter(field=>field.visible_in_list!==false).map(field=>field.field_name);
  const sourceSortable = view
    ? [...new Set(enabledSourceColumns.filter(column=>column.sortable).map(column=>column.fieldName))]
    : fields.filter(field=>field.visible_in_list!==false&&field.sortable).map(field=>field.field_name);
  const sourceColumnNames = new Set(sourceColumns);
  const businessColumnOptions = fields.map(field=>({
    label:field.label, value:field.field_name, sortable:Boolean(field.sortable),
    available:sourceColumnNames.has(field.field_name),
  }));
  const columnOptions = [
    ...businessColumnOptions,
    ...RECORD_METADATA_FIELDS.map(field=>({label:field.label,value:field.fieldName,system:true,sortable:false,available:true})),
    ...(approvalStatusAvailable ? [{...approvalOption,sortable:false,available:true}] : []),
  ];
  const filter = widget.filterSettings || {};
  const list = widget.listSettings || {};
  const patchFilter = (value:Partial<NonNullable<PageWidget['filterSettings']>>) => onChange({filterSettings:{...filter,...value}});
  const patchList = (value:Partial<NonNullable<PageWidget['listSettings']>>) => onChange({listSettings:{...list,...value}});
  const names = widget.filterFields ?? sourceFilters ?? businessFilterOptions.filter(option=>option.available).map(option=>option.value);
  const columns = list.displayGroups == null ? list.columns ?? sourceColumns : [...new Set(list.displayGroups.flatMap(group=>group.columns||[]))];
  const buttonActions = filterButtonActions(filter);
  const setButtonEnabled = (action:'query'|'reset', enabled:boolean) => {
    const actions = enabled ? [...buttonActions,action] : buttonActions.filter(item=>item!==action);
    patchFilter({toolbarGroups:[{id:'default-filter-buttons',name:'查询与重置按钮',roleIds:[],actions}]});
  };
  const filterButtons = <PropertySubgroup title="查询与重置按钮" hint="按钮随当前筛选方案的适用对象显示。">
    <PropertyRow label="查询按钮"><Switch size="small" disabled={disabled} checked={buttonActions.includes('query')} onChange={enabled=>setButtonEnabled('query',enabled)}/></PropertyRow>
    {buttonActions.includes('query')&&<>
      <PropertyRow label="查询方式"><Select value={filter.queryMode??'submit'} options={[{label:'点击查询',value:'submit'},{label:'条件变化自动查询',value:'change'}]} onChange={queryMode=>patchFilter({queryMode})}/></PropertyRow>
      {filter.queryMode!=='change'&&<PropertyRow label="查询文字"><Input maxLength={20} placeholder="查询" value={filter.queryLabel??''} onChange={event=>patchFilter({queryLabel:event.target.value.trim()?event.target.value:undefined})}/></PropertyRow>}
    </>}
    <PropertyRow label="重置按钮"><Switch size="small" disabled={disabled} checked={buttonActions.includes('reset')} onChange={enabled=>setButtonEnabled('reset',enabled)}/></PropertyRow>
    {buttonActions.includes('reset')&&<>
      <PropertyRow label="重置行为"><Select value={filter.resetMode??'defaults'} options={[{label:'恢复来源默认值',value:'defaults'},{label:'清空所有条件',value:'clear'}]} onChange={resetMode=>patchFilter({resetMode})}/></PropertyRow>
      <PropertyRow label="重置文字"><Input maxLength={20} placeholder="重置" value={filter.resetLabel??''} onChange={event=>patchFilter({resetLabel:event.target.value.trim()?event.target.value:undefined})}/></PropertyRow>
    </>}
  </PropertySubgroup>;
  if(widget.type!=='record-list')return null;
  const sourceActions = list.toolbarActions ?? view?.table?.toolbarActions ?? [];
  const allowsDelete = (list.rowActions ?? view?.table?.rowActions)?.includes('delete');
  const enabledActions = allowsDelete ? [...new Set([...sourceActions, 'delete'])] : sourceActions;
  if(tab==='toolbar') return <ToolbarGroups groups={list.toolbarGroups ?? [{id:'default-toolbar',name:'默认权限组',roleIds:[],actions:enabledActions}]} roles={roles} disabled={disabled} onChange={toolbarGroups=>patchList({toolbarGroups})}/>;
  if(tab==='data')return <>
    <PropertyGroup title="列表筛选">
      <PropertyRow label="启用列表筛选" hint="在表格上方显示查询条件，使用当前列表的业务来源。">
        <Switch aria-label="启用列表筛选" size="small" disabled={disabled} checked={widget.showFilters!==false}
          onChange={showFilters=>onChange({showFilters})}/>
      </PropertyRow>
      {widget.showFilters!==false&&<FilterSchemes key={widget.id} settings={filter} names={names} options={filterOptions}
    roles={roles} disabled={disabled} onChange={patchFilter} selected={selectedFilterScheme} onSelect={onSelectFilterScheme}>
        {filterButtons}
      </FilterSchemes>}
    </PropertyGroup>
    <PropertyGroup title="列表显示">
      <ToolbarGroups scope="display" selectedGroup={selectedDisplayGroup} onSelectGroup={onSelectDisplayGroup}
        groups={list.displayGroups??[{id:'default-display',name:'默认权限组',roleIds:[],actions:[],columns}]} roles={roles} disabled={disabled} initialValues={{columns:[...columns],defaultSort:null,inheritDefaultSort:false,pageSize:firstSourceTable?.pageSize??20,emptyText:'暂无符合条件的数据'}} onChange={displayGroups=>patchList({displayGroups})} renderGroup={(group,patch)=>{
        const configuredColumns=withDefaultRecordMetadata(group.columns??columns, group.recordMetadataConfigured);
        const implicitApproval=approvalStatusAvailable && approvalStatusDefaultVisible && !group.approvalStatusConfigured;
        const selected=implicitApproval && !configuredColumns.includes(APPROVAL_STATUS_FIELD)
          ? [...configuredColumns, APPROVAL_STATUS_FIELD] : configuredColumns;
        const sortable=group.sortableColumns??list.sortableColumns??sourceSortable;
        const sourceDefaultSort=firstSourceTable?.defaultSort;
        const inheritedSort=list.defaultSort??(sourceDefaultSort?{field:sourceDefaultSort.fieldName,order:sourceDefaultSort.order==='ascend'?'asc' as const:'desc' as const}:null);
        const candidate=group.defaultSort??(group.inheritDefaultSort!==false?inheritedSort:null);
        const sortOptions=columnOptions.filter(option=>option.available&&option.sortable&&selected.includes(option.value)&&sortable.includes(option.value));
        const defaultSort=candidate&&sortOptions.some(option=>option.value===candidate.field)?candidate:null;
        const reconcile=(visible:string[],sortFields:string[])=>defaultSort&&(!visible.includes(defaultSort.field)||!sortFields.includes(defaultSort.field))?{defaultSort:null,inheritDefaultSort:false}:{};
        return <>
          <PropertySubgroup title="显示区域">
            <ColumnPicker value={selected}
              options={columnOptions}
              disabled={disabled} sortableColumns={sortable.filter(name=>selected.includes(name))}
              onSortingChange={sortableColumns=>patch({sortableColumns,...reconcile(selected,sortableColumns)})}
              onChange={columns=>patch({columns,recordMetadataConfigured:true,sortableColumns:sortable.filter(name=>columns.includes(name)),
                ...(approvalStatusAvailable ? {approvalStatusConfigured:true} : {}),...reconcile(columns,sortable)})}/>
          </PropertySubgroup>
          <PropertySubgroup title="排序、分页与空提示">
            <PropertyRow label="默认排序" hint="仅可选择本组已勾选可看和排序的字段。多个组匹配时，按权限组顺序采用第一个有效的默认排序；留空不提供默认排序。"><Select disabled={disabled} allowClear value={defaultSort?.field} placeholder="不设置" options={sortOptions} onChange={field=>patch({defaultSort:field?{field,order:defaultSort?.order??'asc'}:null,inheritDefaultSort:false})}/></PropertyRow>
            {defaultSort&&<PropertyRow label="排序方向"><Select disabled={disabled} value={defaultSort.order} options={[{label:'升序',value:'asc'},{label:'降序',value:'desc'}]} onChange={order=>patch({defaultSort:{...defaultSort,order},inheritDefaultSort:false})}/></PropertyRow>}
            <PropertyRow label="每页条数" hint="多个权限组匹配时，按组顺序采用第一个已配置的条数；留空沿用原列表或来源配置。"><InputNumber disabled={disabled} min={1} max={200} precision={0} value={group.pageSize??undefined} placeholder={String(list.pageSize??firstSourceTable?.pageSize??20)} onChange={pageSize=>patch({pageSize})}/></PropertyRow>
            <PropertyRow label="空数据提示" hint="多个权限组匹配时，按组顺序采用第一个非空提示；留空沿用原列表提示。"><Input disabled={disabled} value={group.emptyText??undefined} placeholder={list.emptyText||'暂无符合条件的数据'} maxLength={100} onChange={event=>patch({emptyText:event.target.value})}/></PropertyRow>
          </PropertySubgroup>
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
