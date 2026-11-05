import React, {useMemo, useState} from 'react';
import {Empty, Tabs} from 'antd';
import DynamicPage from '../DynamicPage';
import type {PageWidget, FilterContribution} from './model';

export default function FilterWidget({widget,sourceId,onChange}: {widget:PageWidget;sourceId:number;onChange:(value:FilterContribution)=>void}) {
  const schemes=widget.filterSettings?.schemes;
  const [selected,setSelected]=useState(schemes?.[0]?.id);
  const scheme=schemes?.find(item=>item.id===selected)||schemes?.[0];
  const fields=useMemo(()=>scheme?[...new Set(scheme.groups.flatMap(group=>group.columns||[]))]:widget.filterFields,[scheme,widget.filterFields]);
  const settings=useMemo(()=>scheme?{...widget.filterSettings,showKeyword:scheme.showKeyword,requiredFields:[],expandAdvanced:false}:widget.filterSettings,[scheme,widget.filterSettings]);
  if(schemes&&!scheme)return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用筛选方案"/>;
  return <div className="component-filter-schemes-runtime">
    {<Tabs size="small" activeKey={scheme?.id||'legacy'} items={schemes?.map(item=>({key:item.id,label:item.name}))??[{key:'legacy',label:'默认方案'}]} onChange={id=>{
      // Discard the previous scheme's conditions before mounting the next form.
      if(schemes){onChange({schemeId:id,search:'',filters:[],ready:true});setSelected(id);}
    }}/>}
    <DynamicPage key={JSON.stringify([scheme?.id,scheme?.fieldControls??{}])} formSlug={String(sourceId)} embedded toolbarTargetId={`component-toolbar-${widget.id}`} readOnly display="filters"
      filterSettings={settings} fieldControls={scheme?.fieldControls}
      filterFields={fields} onFilterChange={value=>onChange({...value,...(scheme?{schemeId:scheme.id}:{})})}/>
  </div>;
}
