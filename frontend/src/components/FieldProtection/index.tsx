import React from 'react';
export type FieldPolicy = {masked?:boolean;copyMode?:'normal'|'maskedCopy'|'disabled';copyText?:string};
/** Block mixed selections too: a copy event can originate outside a protected cell. */
export function protectCopy(event:React.ClipboardEvent<HTMLElement>){
  const selection=window.getSelection();const target=event.target as HTMLElement;
  const selected=[...event.currentTarget.querySelectorAll<HTMLElement>('[data-copy-mode]')].filter(node=>node.contains(target)||(selection?.rangeCount&&selection.containsNode(node,true)));
  if(event.currentTarget.dataset.copyMode)selected.push(event.currentTarget);
  if(selected.some(node=>node.dataset.copyMode==='disabled')){event.preventDefault();event.clipboardData.setData('text/plain','');return;}
  const masked=selected.filter(node=>node.dataset.copyMode==='maskedCopy');
  if(masked.length){event.preventDefault();event.clipboardData.setData('text/plain',masked.map(node=>node.dataset.copyText||'****').join('\n'));}
}
export default function FieldProtection({copyMode='normal',copyText,children}:FieldPolicy&{children:React.ReactNode}){
  return <div data-copy-mode={copyMode} data-copy-text={copyText} onCopyCapture={protectCopy} onCutCapture={protectCopy} onDragStart={event=>{if(copyMode!=='normal')event.preventDefault();}} style={copyMode==='disabled'?{userSelect:'none',WebkitUserSelect:'none'}:undefined}>{children}</div>;
}
