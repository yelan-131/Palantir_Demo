import React from 'react';
import {Alert, Button, Input, InputNumber, Select, Space, Switch} from 'antd';
import {ArrowUpOutlined, ArrowDownOutlined} from '@ant-design/icons';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import type {PlatformFormField} from '@/services/api';
import type {ViewConfig} from '@/utils/viewConfig';
import type {PageWidget} from './model';

export default function BusinessProperties({widget,tab,fields,view,onChange,disabled}: {
  widget:PageWidget; tab:'data'|'interaction'; fields:PlatformFormField[]; view?:ViewConfig;
  onChange:(value:Partial<PageWidget>)=>void; disabled:boolean;
}) {
  const options = fields.map(field=>({label:field.label,value:field.field_name}));
  const sourceFilters = view?.filters?.filter(filter=>filter.enabled!==false).map(filter=>filter.fieldName);
  const filterOptions = options.filter(option=>!sourceFilters||sourceFilters.includes(option.value));
  const sourceColumns = view?.table?.columns?.filter(column=>column.enabled!==false).map(column=>column.fieldName);
  const columnOptions = options.filter(option=>!sourceColumns||sourceColumns.includes(option.value));
  const filter = widget.filterSettings || {};
  const list = widget.listSettings || {};
  const patchFilter = (value:Partial<NonNullable<PageWidget['filterSettings']>>) => onChange({filterSettings:{...filter,...value}});
  const patchList = (value:Partial<NonNullable<PageWidget['listSettings']>>) => onChange({listSettings:{...list,...value}});
  const names = widget.filterFields ?? filterOptions.map(option=>option.value);
  const columns = list.columns ?? sourceColumns ?? columnOptions.map(option=>option.value);
  const actionNames:Record<string,string> = {create:'新增 / 填写申请',refresh:'刷新',import:'批量导入',export:'导出',detail:'详情',edit:'编辑',delete:'删除'};
  const move = (index:number,offset:number) => {
    const next=[...columns];[next[index],next[index+offset]]=[next[index+offset],next[index]];patchList({columns:next});
  };
  if(widget.type==='record-filter')return tab==='data'?<PropertyGroup title="筛选字段">
    <PropertyRow label="筛选字段" hint="沿用业务表单的控件、操作符和默认值。"><Select mode="multiple" value={names} options={filterOptions} onChange={filterFields=>onChange({filterFields,filterSettings:{...filter,requiredFields:filter.requiredFields?.filter(name=>filterFields.includes(name))}})} /></PropertyRow>
    <PropertyRow label="显示关键词"><Switch size="small" checked={filter.showKeyword!==false} onChange={showKeyword=>patchFilter({showKeyword})} /></PropertyRow>
    <PropertyRow label="必填条件"><Select mode="multiple" value={filter.requiredFields||[]} options={filterOptions.filter(option=>names.includes(option.value))} onChange={requiredFields=>patchFilter({requiredFields})} /></PropertyRow>
    <PropertyRow label="高级筛选"><Select value={filter.expandAdvanced?'expanded':'collapsed'} options={[{label:'默认收起',value:'collapsed'},{label:'默认展开',value:'expanded'}]} onChange={value=>patchFilter({expandAdvanced:value==='expanded'})} /></PropertyRow>
    {names.some(name=>!filterOptions.some(option=>option.value===name))&&<Alert type="warning" showIcon message="部分筛选字段已失效，请恢复来源字段或重新选择。" />}
    <Button size="small" onClick={()=>onChange({filterFields:null,filterSettings:{...filter,requiredFields:[]}})}>恢复来源筛选字段</Button>
    <p className="analytics-editor-help">必填条件始终显示。必填条件未满足时，关联列表等待查询。</p>
  </PropertyGroup>:<>
    <PropertyGroup title="查询与重置">
      <PropertyRow label="查询方式"><Select value={filter.queryMode??'submit'} options={[{label:'点击查询',value:'submit'},{label:'条件变化自动查询',value:'change'}]} onChange={queryMode=>patchFilter({queryMode})} /></PropertyRow>
      <PropertyRow label="重置行为"><Select value={filter.resetMode??'defaults'} options={[{label:'恢复来源默认值',value:'defaults'},{label:'清空所有条件',value:'clear'}]} onChange={resetMode=>patchFilter({resetMode})} /></PropertyRow>
      {filter.queryMode!=='change'&&<PropertyRow label="查询文字"><Input maxLength={20} value={filter.queryLabel??'查询'} onChange={event=>patchFilter({queryLabel:event.target.value})} /></PropertyRow>}
      <PropertyRow label="重置文字"><Input maxLength={20} value={filter.resetLabel??'重置'} onChange={event=>patchFilter({resetLabel:event.target.value})} /></PropertyRow>
    </PropertyGroup>
  </>;
  if(widget.type!=='record-list')return null;
  if(tab==='data')return <>
    <PropertyGroup title="列表显示">
      <PropertyRow label="显示列" hint="按选择顺序显示，只能使用来源发布视图中的列。"><Select mode="multiple" value={columns} options={columnOptions} onChange={columns=>patchList({columns:columns.length?columns:null,defaultSort:list.defaultSort&&columns.includes(list.defaultSort.field)?list.defaultSort:null})} /></PropertyRow>
      {columns.some(name=>!columnOptions.some(option=>option.value===name))&&<Alert type="warning" showIcon message="部分显示列已失效，请恢复来源列或重新选择。" />}
      <div className="component-column-order">{columns.map((name,index)=><div key={name}><span>{options.find(option=>option.value===name)?.label||name}</span><Space size={0}><Button type="text" size="small" aria-label={'上移列 '+name} disabled={disabled||index===0} icon={<ArrowUpOutlined />} onClick={()=>move(index,-1)} /><Button type="text" size="small" aria-label={'下移列 '+name} disabled={disabled||index===columns.length-1} icon={<ArrowDownOutlined />} onClick={()=>move(index,1)} /></Space></div>)}</div>
      <PropertyRow label="每页条数"><InputNumber min={1} max={200} value={list.pageSize} placeholder="沿用来源" onChange={pageSize=>patchList({pageSize})} /></PropertyRow>
      <PropertyRow label="默认排序"><Select allowClear value={list.defaultSort?.field} placeholder="沿用来源" options={columnOptions.filter(option=>columns.includes(option.value)&&(!view?.table?.columns||view.table.columns.some(column=>column.fieldName===option.value&&column.sortable)))} onChange={field=>patchList({defaultSort:field?{field,order:list.defaultSort?.order??'asc'}:null})} /></PropertyRow>
      {list.defaultSort&&<PropertyRow label="排序方向"><Select value={list.defaultSort.order} options={[{label:'升序',value:'asc'},{label:'降序',value:'desc'}]} onChange={order=>patchList({defaultSort:{...list.defaultSort!,order}})} /></PropertyRow>}
      <PropertyRow label="空数据提示"><Input value={list.emptyText??'暂无符合条件的数据'} maxLength={100} onChange={event=>patchList({emptyText:event.target.value})} /></PropertyRow>
      <Button size="small" onClick={()=>patchList({columns:null,pageSize:null,defaultSort:null})}>恢复来源列与分页</Button>
    </PropertyGroup>
  </>;
  return <PropertyGroup title="列表交互">
    <PropertyRow label="行点击"><Select allowClear value={list.rowClick??undefined} placeholder="沿用来源" options={[{label:'无动作',value:'none'},{label:'打开详情',value:'detail',disabled:!!view?.table?.rowActions&&!view.table.rowActions.includes('detail')&&view.table.rowClickAction!=='detail'},{label:'编辑记录',value:'edit',disabled:!!view?.table?.rowActions&&!view.table.rowActions.includes('edit')&&view.table.rowClickAction!=='edit'}]} onChange={rowClick=>patchList({rowClick})} /></PropertyRow>
    <PropertyRow label="记录选择"><Select value={list.selection??'none'} options={[{label:'不启用',value:'none'},{label:'单选',value:'single'},{label:'多选',value:'multiple'}]} onChange={selection=>patchList({selection})} /></PropertyRow>
    <PropertyRow label="工具栏按钮"><Select mode="multiple" value={list.toolbarActions??view?.table?.toolbarActions?.filter(action=>['create','refresh','import','export'].includes(action))??[]} options={['create','refresh','import','export'].map(value=>({value,label:actionNames[value],disabled:!!view?.table?.toolbarActions&&!view.table.toolbarActions.includes(value)}))} onChange={toolbarActions=>patchList({toolbarActions})} /></PropertyRow>
    <PropertyRow label="行内按钮"><Select mode="multiple" value={list.rowActions??view?.table?.rowActions??[]} options={['detail','edit','delete'].map(value=>({value,label:actionNames[value],disabled:!!view?.table?.rowActions&&!view.table.rowActions.includes(value)}))} onChange={rowActions=>patchList({rowActions})} /></PropertyRow>
    <Button size="small" onClick={()=>patchList({rowClick:null,toolbarActions:null,rowActions:null})}>恢复来源操作配置</Button>
    <Alert type="info" showIcon message="按钮显示仍受业务权限、记录状态与审批规则约束。记录选择仅作用于当前页。" />
  </PropertyGroup>;
}
