import React, {useRef} from 'react';

export interface AnalyticsResizePatch {widthColumns?:number;cardHeight?:number;height?:number}
type Axis = 'width' | 'height' | 'both';
interface DragSize {columns:number;chartHeight:number;pointerId:number;x:number;y:number;width:number;height:number;scale:number;pitch:number;gap:number;axis:Axis;patch?:AnalyticsResizePatch}
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));

/** Preview while dragging, commit exactly once so one resize is one undo step. */
export default function AnalyticsResizeHandles({title,columns,height,chartHeight,isChart,onPreview,onCommit}:{title:string;columns:number;height?:number;chartHeight:number;isChart:boolean;onPreview:(patch?:AnalyticsResizePatch)=>void;onCommit:(patch:AnalyticsResizePatch)=>void}) {
  const drag=useRef<DragSize>();
  const start=(event:React.PointerEvent<HTMLButtonElement>,axis:Axis)=>{
    if(event.button!==0)return;
    const card=event.currentTarget.closest<HTMLElement>('[data-analytics-widget-id]');
    const canvas=card?.closest<HTMLElement>('.runtime-analytics-canvas');
    if(!card || !canvas)return;
    event.preventDefault();event.stopPropagation();
    const rect=card.getBoundingClientRect();
    const scale=rect.width/card.offsetWidth || 1;
    const gap=(Number.parseFloat(getComputedStyle(canvas).columnGap) || 0)*scale;
    drag.current={columns,chartHeight,pointerId:event.pointerId,x:event.clientX,y:event.clientY,width:rect.width,height:card.offsetHeight,scale,pitch:(canvas.getBoundingClientRect().width+gap)/12,gap,axis};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move=(event:React.PointerEvent<HTMLButtonElement>)=>{
    const current=drag.current;
    if(!current || current.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();
    const patch:AnalyticsResizePatch={};
    if(current.axis!=='height')patch.widthColumns=clamp(Math.round((current.width+event.clientX-current.x+current.gap)/current.pitch),3,12);
    if(current.axis!=='width') {
      const dy=(event.clientY-current.y)/current.scale;
      patch.cardHeight=Math.round(clamp(current.height+dy,isChart?280:160,960));
      if(isChart)patch.height=Math.round(clamp(current.chartHeight+patch.cardHeight-current.height,200,640));
    }
    current.patch=patch;onPreview(patch);
  };
  const finish=(event:React.PointerEvent<HTMLButtonElement>,cancel=false)=>{
    const current=drag.current;
    if(!current || current.pointerId!==event.pointerId)return;
    event.stopPropagation();drag.current=undefined;onPreview();
    if(!cancel && current.patch && (current.patch.widthColumns!==undefined && current.patch.widthColumns!==current.columns || current.patch.cardHeight!==undefined && current.patch.cardHeight!==current.height))onCommit(current.patch);
  };
  const keyboard=(event:React.KeyboardEvent<HTMLButtonElement>,axis:Axis)=>{
    if(event.key==='Escape') {drag.current=undefined;onPreview();event.stopPropagation();return;}
    const patch:AnalyticsResizePatch={};
    if(axis!=='height' && ['ArrowLeft','ArrowRight'].includes(event.key))patch.widthColumns=clamp(columns+(event.key==='ArrowRight'?1:-1),3,12);
    if(axis!=='width' && ['ArrowUp','ArrowDown'].includes(event.key)) {
      const dy=event.key==='ArrowDown'?20:-20;
      const currentHeight=event.currentTarget.closest<HTMLElement>('[data-analytics-widget-id]')?.offsetHeight || height || (isChart?chartHeight+78:210);
      const nextHeight=clamp(currentHeight+dy,isChart?280:160,960);
      if(nextHeight!==currentHeight) {
        patch.cardHeight=nextHeight;
        if(isChart)patch.height=clamp(chartHeight+nextHeight-currentHeight,200,640);
      }
    }
    if(patch.widthColumns===columns)delete patch.widthColumns;
    if(Object.keys(patch).length){event.preventDefault();event.stopPropagation();onCommit(patch);}
  };
  return <div className="analytics-resize-handles">{(['width','height','both'] as const).map(axis=><button key={axis} type="button" className={`analytics-resize-handle analytics-resize-${axis}`} aria-label={`调整${title}${axis==='width'?'宽度':axis==='height'?'高度':'大小'}`} title="拖拽调整大小；方向键微调，Esc 取消" onPointerDown={event=>start(event,axis)} onPointerMove={move} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onKeyDown={event=>keyboard(event,axis)} onClick={event=>event.stopPropagation()} />)}</div>;
}
