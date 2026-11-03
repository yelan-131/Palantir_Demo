import React, {useEffect, useRef, useState} from 'react';
import {ConfigProvider, Select} from 'antd';
import './style.css';

type Choice<T extends string> = {value:T;label:React.ReactNode;description?:string;showMark?:boolean};
type Props<T extends string> = {value:T;options:Choice<T>[];onChange:(value:T)=>void;defaultValue?:T;disabled?:boolean;id?:string;'aria-label'?:string;numericValues?:number[];unit?:string};

function useDampedPosition(target:number) {
  const [position,setPosition]=useState(target);
  const motion=useRef({position:target,velocity:0});
  useEffect(()=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion.current={position:target,velocity:0};setPosition(target);return;
    }
    let frame=0, previous=performance.now();
    const tick=(now:number)=>{
      const dt=Math.min((now-previous)/1000,.032);previous=now;
      const state=motion.current;
      state.velocity+=(200*(target-state.position)-27*state.velocity)*dt;
      state.position+=state.velocity*dt;
      if(Math.abs(target-state.position)<.001 && Math.abs(state.velocity)<.005) {
        state.position=target;state.velocity=0;setPosition(target);return;
      }
      setPosition(state.position);frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[target]);
  return position;
}

function NumericPicker<T extends string>({value,options,onChange,disabled,id,'aria-label':label='选择数值',numericValues=[],unit='%'}:Props<T>) {
  const index=Math.max(0,options.findIndex(option=>option.value===value));
  const position=useDampedPosition(index);
  const bounded=Math.max(0,Math.min(options.length-1,position));
  const progress=options.length>1?bounded/(options.length-1)*100:0;
  const choose=(next:number)=>{const option=options[next];if(option && !disabled && option.value!==value)onChange(option.value);};
  return <div className="option-picker-inline" aria-disabled={disabled}>
    <div className="option-picker-inline-rail">
      <div className="option-picker-track"><span style={{width:`${progress}%`}} /><i style={{left:`${progress}%`}} /></div>
      <input id={id} type="range" aria-label={label} aria-valuetext={`${numericValues[index]}${unit}`} min={0} max={Math.max(0,options.length-1)} step={1} value={index} disabled={disabled} onChange={event=>choose(Number(event.target.value))} />
      <div className="option-picker-inline-stops">{options.map((option,i)=>option.showMark===false?null:<button type="button" key={option.value} className={index===i?'is-selected':''} disabled={disabled} aria-pressed={index===i} onClick={()=>choose(i)}>{option.label}</button>)}</div>
    </div>
  </div>;
}

export default function OptionPicker<T extends string>(props:Props<T>) {
  const {componentDisabled}=ConfigProvider.useConfig();
  const disabled=props.disabled || componentDisabled;
  if(props.numericValues) return <NumericPicker {...props} disabled={disabled} />;
  return <Select id={props.id} aria-label={props['aria-label']} value={props.value} options={props.options} onChange={props.onChange} disabled={disabled} />;
}
