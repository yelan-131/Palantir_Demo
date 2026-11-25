import React, {useRef} from 'react';
import type {PageWidget} from './model';

type ResizePatch = Partial<Pick<PageWidget, 'customWidth' | 'customHeight'>>;

export default function ResizeHandle({title,onCommit}:{title:string;onCommit:(size:ResizePatch)=>void}) {
  const drag=useRef<{x:number;y:number;width:number;height:number;scale:number;card:HTMLElement;column:HTMLElement;style:string;cardStyle:string;size?:ResizePatch}>();
  const finish=(event:React.PointerEvent<HTMLButtonElement>,cancel=false)=>{
    const state=drag.current;if(!state)return;
    drag.current=undefined;
    state.column.style.cssText=state.style;state.card.style.cssText=state.cardStyle;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(!cancel&&state.size)onCommit(state.size);
  };
  return <button type="button" className="component-resize-handle" aria-label={`调整${title}大小`} title="拖拽调整宽度和高度" onClick={event=>event.stopPropagation()}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const card=event.currentTarget.closest<HTMLElement>('[data-component-widget-id]');const column=card?.parentElement;if(!card||!column)return;const rect=card.getBoundingClientRect();drag.current={x:event.clientX,y:event.clientY,width:column.offsetWidth,height:card.offsetHeight,scale:rect.width/card.offsetWidth||1,card,column,style:column.style.cssText,cardStyle:card.style.cssText};event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{
      const state=drag.current;if(!state)return;
      const available=state.column.parentElement?.clientWidth??3840;
      const dx=Math.round((event.clientX-state.x)/state.scale);
      const dy=Math.round((event.clientY-state.y)/state.scale);
      const width=Math.min(3840,available,Math.max(160,state.width+dx));
      const height=Math.min(3000,Math.max(120,state.height+dy));
      const size:ResizePatch={};
      if(dx&&width>=160&&width!==state.width){
        size.customWidth=width;
        state.column.style.flex=`0 0 ${width}px`;
        state.column.style.maxWidth='100%';
      }else if(state.size?.customWidth!=null){
        state.column.style.cssText=state.style;
      }
      if(dy&&height!==state.height){
        size.customHeight=height;
        state.card.style.height=`${height}px`;
      }else if(state.size?.customHeight!=null){
        state.card.style.cssText=state.cardStyle;
      }
      state.size=Object.keys(size).length?size:undefined;
    }}
    onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onLostPointerCapture={event=>finish(event,true)}
    onKeyDown={event=>{if(event.key==='Escape'&&drag.current){const state=drag.current;drag.current=undefined;state.column.style.cssText=state.style;state.card.style.cssText=state.cardStyle;}}} />;
}
