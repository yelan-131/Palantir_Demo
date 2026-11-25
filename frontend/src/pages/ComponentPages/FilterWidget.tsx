import React, {useMemo, useState} from 'react';
import {Empty, Tabs} from 'antd';
import DynamicPage from '../DynamicPage';
import {DEFAULT_FILTER_LAYOUT} from './businessComponents';
import type {PageWidget, FilterContribution} from './model';
import {useListConfigurationPreview, type PreviewSelection} from './ListConfigurationPreview';

export default function FilterWidget({widget,sourceId,onChange,inline=false,schemeSelection}: {
  widget:PageWidget;sourceId:number;onChange:(value:FilterContribution)=>void;inline?:boolean;
  schemeSelection?:PreviewSelection;
}) {
  const schemes=widget.filterSettings?.schemes;
  const [selected,setSelected]=useState(schemes?.[0]?.id);
  const preview = useListConfigurationPreview(widget.id);
  const selection = schemeSelection ?? preview?.filterScheme;
  const selectedId = selection ? selection.id : selected;
  const scheme=schemes?.find(item=>item.id===selectedId)||schemes?.[0];
  const fields=useMemo(()=>scheme?[...new Set(scheme.groups.flatMap(group=>group.columns||[]))]:widget.filterFields,[scheme,widget.filterFields]);
  const settings=useMemo(()=>scheme?{...widget.filterSettings,showKeyword:scheme.showKeyword,requiredFields:[],expandAdvanced:false}:widget.filterSettings,[scheme,widget.filterSettings]);
  if(schemes&&!scheme)return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用筛选方案"/>;
  return <div className="component-filter-schemes-runtime">
    <Tabs size="small" activeKey={scheme?.id||'legacy'} items={schemes?.map(item=>({key:item.id,label:item.name}))??[{key:'legacy',label:'默认方案'}]} onChange={id=>{
      // Discard the previous scheme's conditions before mounting the next form.
      if(schemes){
         onChange({schemeId:id,search:'',filters:[],ready:true});
         (selection?.onSelect ?? setSelected)(id);
       }
    }}/>
    <DynamicPage key={JSON.stringify([scheme?.id,scheme?.fieldControls??{}])} formSlug={String(sourceId)} embedded toolbarTargetId={inline?undefined:`component-toolbar-${widget.id}`} readOnly display="filters"
      filterSettings={settings} fieldControls={scheme?.fieldControls}
      filterLayout={inline || scheme?.defaultRows != null || scheme?.fieldsPerRow != null ? {
        rows:scheme?.defaultRows??DEFAULT_FILTER_LAYOUT.rows,
        columns:scheme?.fieldsPerRow??DEFAULT_FILTER_LAYOUT.columns,
      } : undefined}
      filterFields={fields} onFilterChange={value=>onChange({...value,...(scheme?{schemeId:scheme.id}:{})})}/>
  </div>;
}
