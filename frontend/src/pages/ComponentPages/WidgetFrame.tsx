import React, {useLayoutEffect, useRef, useState} from 'react';
import type {ResolvedPresentation} from './presentation';
interface Props extends React.HTMLAttributes<HTMLElement> {
  presentation: ResolvedPresentation;
  heading: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  editorHandle?: React.ReactNode;
  children: React.ReactNode;
}
/** Shared chrome: operation portals stay mounted even when their header is hidden. */
export default function WidgetFrame({presentation:p,heading,description,actions,editorHandle,children,style,...props}:Props) {
  const actionsRef=useRef<HTMLDivElement>(null);
  const [hasActions,setHasActions]=useState(false);
  useLayoutEffect(()=>{
    const target=actionsRef.current;if(!target)return;
    const update=()=>setHasActions(Boolean(target.querySelector('button,a,input,select,[role="tab"],[role="combobox"]')));
    update();const observer=new MutationObserver(update);observer.observe(target,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[actions]);
  const hasHeading=p.header.titleVisible&&Boolean(heading);
  const hasDescription=p.header.descriptionVisible&&Boolean(description);
  const showHeader=p.header.visible&&(hasHeading||hasDescription||p.header.actionsVisible&&hasActions);
  const surface=p.container.surface;
  const background=surface==='plain'?'transparent':p.container.background || (surface==='soft'?'var(--mf-panel-soft,#f4f6f8)':'var(--mf-surface,#fff)');
  const border=surface==='plain'?'none':p.container.border;
  return <section {...props} data-presentation="configured" data-surface={surface} data-inner-surface={p.content.innerSurface} data-density={p.content.density} data-inner-titles={p.content.innerTitles} data-separators={p.content.separators} style={{...style,
    '--widget-background':background,'--widget-border':border==='none'?'transparent':border==='strong'?'var(--mf-border-strong,#a4b4c6)':'var(--mf-border,#e2e7ec)',
    '--widget-shadow':surface==='plain'||p.container.shadow==='none'?'none':'0 4px 18px #253e500d',
    '--widget-radius':`${p.container.radius}px`,'--widget-padding':`${p.container.padding}px`,'--widget-header-padding':`${p.header.padding}px`,'--widget-gap':`${p.content.gap}px`,
  } as React.CSSProperties}>
    <div className={`component-frame-header frame-header-${p.header.layout}`} hidden={!showHeader} data-divider={p.header.divider}>
      <div className="component-frame-heading" hidden={!hasHeading&&!hasDescription}>
        {hasHeading&&<div className="component-frame-title">{heading}</div>}
        {hasDescription&&<div className="component-frame-description">{description}</div>}
      </div>
      <div className="component-frame-actions" hidden={!p.header.actionsVisible} ref={actionsRef}>{actions}</div>
    </div>
    {editorHandle&&<div className="component-floating-handle">{editorHandle}</div>}
    <div className="component-frame-content ant-card-body" style={{overflow:p.content.overflow}}>{children}</div>
  </section>;
}
