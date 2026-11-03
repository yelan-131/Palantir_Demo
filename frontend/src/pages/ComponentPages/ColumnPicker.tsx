import React, {useId, useState} from 'react';
import {Button, Checkbox, Dropdown, Empty, Input, Pagination} from 'antd';
import {FilterOutlined, HolderOutlined, MoreOutlined} from '@ant-design/icons';
import {PropertyHelp} from '@/components/PropertyInspector';
import './column-picker.css';

type Option = {value:string;label:string;sortable?:boolean};
const pageSize=10;
export default function ColumnPicker({value,options,disabled,onChange,sortableColumns,onSortingChange,mode='columns'}: {mode?:'columns'|'filters';value:string[];options:Option[];disabled:boolean;onChange:(columns:string[])=>void;sortableColumns:string[];onSortingChange:(columns:string[])=>void}) {
  const controlId=useId();
  const isFilter=mode==='filters',limit=isFilter?30:100;
  const heading=isFilter?'筛选字段':'显示列';
  const [query,setQuery]=useState(''),[scope,setScope]=useState('all'),[page,setPage]=useState(1),[dragged,setDragged]=useState<string>();
  const names=new Map(options.map(option=>[option.value,option.label]));
  const all=[...value.map(name=>({value:name,label:names.get(name)||name,sortable:options.find(option=>option.value===name)?.sortable})),...options.filter(option=>!value.includes(option.value))];
  const filtered=all.filter(option=>(scope==='all'||value.includes(option.value)===(scope==='selected'))&&[option.label,option.value].some(text=>text.toLowerCase().includes(query.trim().toLowerCase())));
  const currentPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)));
  const remaining=filtered.filter(option=>!value.includes(option.value)&&names.has(option.value));
  const move=(name:string,target:number)=>{
    const next=[...value],index=next.indexOf(name);
    if(index<0||target<0||target>=next.length||index===target)return;
    next.splice(index,1);next.splice(target,0,name);onChange(next);
  };
  return <details className={"component-toolbar-buttons"+(isFilter?" component-filter-field-picker":"")} open>
    <summary className="component-inline-columns-heading"><span>{heading}</span><PropertyHelp label={heading+"帮助"}>{isFilter?'勾选需要使用的筛选字段；拖动字段或点击序号调整排列顺序，画布按此顺序每行显示四项。多个匹配组按组顺序合并去重。':'勾选“可看”后才可设置“排序”；取消可看会同时取消排序。排序仍受来源字段索引约束。多组匹配时合并可见列与排序配置。'}</PropertyHelp><span className="component-inline-columns-tools" onClick={event=>{event.preventDefault();event.stopPropagation();}} onKeyDown={event=>event.stopPropagation()}>
      <Input size="small" aria-label={"搜索"+heading} allowClear placeholder="搜索字段" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/>
      <Dropdown trigger={['click']} menu={{selectable:true,selectedKeys:[scope],items:[{key:'all',label:`全部字段（${all.length}）`},{key:'selected',label:`已选字段（${value.length}）`},{key:'unselected',label:`未选字段（${options.filter(option=>!value.includes(option.value)).length}）`}],onClick:({key})=>{setScope(key);setPage(1);}}}><Button type={scope==='all'?'text':'primary'} size="small" title="筛选字段范围" aria-label="筛选字段范围" icon={<FilterOutlined/>}/></Dropdown>
      <Dropdown trigger={['click']} menu={{items:[{key:'add',label:'勾选当前筛选结果',disabled:disabled||!remaining.length||value.length+remaining.length>limit},{key:'remove',label:'取消勾选当前筛选结果',disabled:disabled||!filtered.some(option=>value.includes(option.value))}],onClick:({key})=>onChange(key==='add'?[...value,...remaining.map(option=>option.value)]:value.filter(name=>!filtered.some(option=>option.value===name)))}}><Button type="text" size="small" title="批量选择" aria-label={"批量选择"+heading} icon={<MoreOutlined/>}/></Dropdown>
    </span></summary>
    <div className="component-inline-columns">
    <div className="component-inline-columns-table-heading"><span title={'已选 '+value.length+' / '+limit}>字段 · {filtered.length}</span><span>{isFilter?'使用':'可看'}</span>{!isFilter&&<span>排序</span>}</div>
    <div className="component-inline-columns-list">
      {filtered.slice((currentPage-1)*pageSize,currentPage*pageSize).map(option=>{
        const index=value.indexOf(option.value),selected=index>=0,valid=names.has(option.value);
        return <div key={option.value} className={'component-inline-column'+(selected?' is-selected':'')} draggable={selected&&!disabled} onDragStart={event=>{setDragged(option.value);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',option.value);}} onDragEnd={()=>setDragged(undefined)} onDragOver={event=>{if(dragged&&selected&&!disabled)event.preventDefault();}} onDrop={event=>{event.preventDefault();if(dragged&&selected&&!disabled)move(dragged,index);setDragged(undefined);}}>
          <span className={'component-inline-column-handle'+(selected?'':' is-hidden')} title="拖动调整显示顺序"><HolderOutlined/></span>
          {selected?<Dropdown trigger={['click']} menu={{items:[{key:'top',label:'移到最前',disabled:disabled||index===0},{key:'up',label:'上移一位',disabled:disabled||index===0},{key:'down',label:'下移一位',disabled:disabled||index===value.length-1},{key:'bottom',label:'移到最后',disabled:disabled||index===value.length-1}],onClick:({key})=>move(option.value,key==='top'?0:key==='bottom'?value.length-1:index+(key==='up'?-1:1))}}><button className="component-inline-column-rank" type="button" aria-label={'调整顺序 '+option.label} title="点击调整顺序" disabled={disabled}>{index+1}</button></Dropdown>:<span className="component-inline-column-rank is-empty">—</span>}
          <label className="component-inline-column-label" htmlFor={controlId+'-'+option.value} title={option.label+' · '+option.value}>{option.label}{!valid&&'（已失效）'}</label>
          <Checkbox className="component-inline-column-check" id={controlId+'-'+option.value} aria-label={(isFilter?'筛选字段 ':'显示字段 ')+option.label} checked={selected} disabled={disabled||!selected&&(!valid||value.length>=limit)} onChange={event=>onChange(event.target.checked?[...value,option.value]:value.filter(name=>name!==option.value))}/>
          {!isFilter&&<Checkbox className="component-inline-column-check" aria-label={'允许排序 '+option.label} title={!selected?'先勾选可看':option.sortable===false?'来源字段未启用排序索引':'允许按此字段排序'} checked={selected&&sortableColumns.includes(option.value)} disabled={disabled||!selected||!valid||option.sortable===false} onChange={event=>onSortingChange(event.target.checked?[...sortableColumns,option.value]:sortableColumns.filter(name=>name!==option.value))}/>}
        </div>;
      })}
      {!filtered.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配字段"/>}
    </div>
    {filtered.length>pageSize&&<div className="component-inline-columns-pagination"><Pagination simple size="small" current={currentPage} pageSize={pageSize} total={filtered.length} showSizeChanger={false} onChange={setPage}/></div>}
    </div>
  </details>;
}
