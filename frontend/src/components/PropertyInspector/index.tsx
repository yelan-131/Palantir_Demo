import React, {useId, useState} from 'react';
import {Tooltip} from 'antd';
import {QuestionCircleOutlined} from '@ant-design/icons';
import './style.css';

export function PropertyInspectorHeader({title, context, titleAccessory, actions, className = ''}: {title:string;context?:string;titleAccessory?:React.ReactNode;actions?:React.ReactNode;className?:string}) {
  return <header className={`property-inspector-header ${className}`}><div><strong>{title}</strong>{context && <span title={context}>{context}</span>}{titleAccessory}</div>{actions && <div className="property-inspector-header-actions">{actions}</div>}</header>;
}

export function PropertyHelp({children,label='配置说明'}:{children:React.ReactNode;label?:string}) {
  return <Tooltip title={children} trigger={['hover','focus']}><button className="property-inspector-help" type="button" aria-label={label} onClick={event=>{event.preventDefault();event.stopPropagation();}}><QuestionCircleOutlined/></button></Tooltip>;
}

export function PropertyGroup({title, heading, hint, actions, children, defaultOpen = true, className = '', titleClassName = '', section}: {title:string;heading?:React.ReactNode;hint?:React.ReactNode;actions?:React.ReactNode;children:React.ReactNode;defaultOpen?:boolean;className?:string;titleClassName?:string;section?:string}) {
  const [expanded,setExpanded] = useState(defaultOpen);
  return <details className={`property-inspector-group ${className}`} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} data-property-section={section} aria-label={heading?title:undefined}>
    <summary className={`property-inspector-group-title ${titleClassName}`}>{heading??title}{hint&&<PropertyHelp label={`${title}帮助`}>{hint}</PropertyHelp>}{actions&&<span className="property-inspector-group-actions" onClick={event=>{event.preventDefault();event.stopPropagation();}}>{actions}</span>}</summary>{children}
  </details>;
}

export function PropertyRow({label, hint, children, className = '', stacked = false}: {label:string;hint?:React.ReactNode;children:React.ReactElement;className?:string;stacked?:boolean}) {
  const id = useId();
  return <div className={`property-inspector-row${stacked ? ' is-stacked' : ''} ${className}`}>
    <div className="property-inspector-label"><label htmlFor={id}>{label}</label>{hint && <Tooltip title={hint} trigger={['hover','focus']}><button type="button" aria-label={`${label}帮助`}><QuestionCircleOutlined /></button></Tooltip>}</div>
    {React.cloneElement(children,{id,'aria-label':label})}
  </div>;
}

export function PropertyAdvanced({children,className = '',title = '高级选项'}: {children:React.ReactNode;className?:string;title?:string}) {
  return <details className={`property-inspector-advanced ${className}`}><summary>{title}</summary>{children}</details>;
}
