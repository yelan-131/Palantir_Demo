import { useRef, useState, type ComponentRef } from 'react';
import { Button, Input, Select, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { buildFormula, readFormulaBuilder, type FormulaBuilder, type FormulaOperand } from '@/utils/formCalculations';

import { RuleInlineSelect, RuleInlineInput, RuleInlineNumber } from './RuleInlineCell';

type Field = { key: string; name: string; storageType?: string };
const numericTypes = ['int','integer','number','decimal','float'];
const fieldOperand = (): FormulaOperand => ({kind:'field',value:''});

export default function CalculationExpressionEditor({ expression, onChange, fields, numericResult, targetName }: {
  expression: string; onChange: (expression: string) => void; fields: Field[]; numericResult: boolean; targetName: string;
}) {
  const numericFields = fields.filter(field => numericTypes.includes(field.storageType || ''));
  const numericKeys = numericFields.map(field => field.key);
  const initial = readFormulaBuilder(expression, numericResult, numericKeys);
  const fresh = (mode: FormulaBuilder['mode']): FormulaBuilder => mode === 'number'
    ? {mode,items:[fieldOperand(),fieldOperand()],operators:['*']}
    : mode === 'text' ? {mode,items:[fieldOperand()]}
    : {mode,source:'',operator:'==',expected:'',yes:fieldOperand(),no:{kind:'value',value:numericResult?'0':''}};
  const [mode, setMode] = useState<FormulaBuilder['mode'] | 'advanced'>(initial?.mode || (expression ? 'advanced' : numericResult ? 'number' : 'text'));
  const [builder, setBuilder] = useState<FormulaBuilder>(initial || fresh(numericResult ? 'number' : 'text'));
  const textarea = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const selection = useRef<[number, number]>([expression.length, expression.length]);
  const update = (next: FormulaBuilder) => { setBuilder(next); onChange(buildFormula(next, numericResult, numericKeys)); };
  const switchMode = (next: typeof mode) => {
    setMode(next);
    if (next !== 'advanced') {
      const recovered = readFormulaBuilder(expression, numericResult, numericKeys);
      if (recovered?.mode === next) setBuilder(recovered);
      else update(fresh(next));
    }
  };
  const choices = (number: boolean) => (number ? numericFields : fields).map(field => ({value:field.key,label:field.name}));
  const operand = (item: FormulaOperand, change: (next: FormulaOperand) => void, label: string, number = numericResult) => <div className="formula-operand">
    <RuleInlineSelect aria-label={`${label}来源`} value={item.kind} options={[{value:'field',label:'字段'},{value:'value',label:number?'数值':'文字'}]} onChange={kind => change({kind,value:''})} />
    {item.kind === 'field' ? <RuleInlineSelect showSearch optionFilterProp="label" aria-label={`${label}字段`} placeholder={number?'选择数值字段':'选择字段'} value={item.value || undefined} options={choices(number)} onChange={value => change({...item,value})} />
      : number ? <RuleInlineNumber aria-label={`${label}固定值`} placeholder="填写数值" value={item.value === '' ? null : Number(item.value)} onChange={value => change({...item,value:value == null?'':String(value)})} />
      : <RuleInlineInput aria-label={`${label}固定值`} placeholder="填写文字或分隔符" value={item.value} maxLength={1000} onChange={event => change({...item,value:event.target.value})} />}
  </div>;
  const insert = (text: string, offset = text.length) => {
    const [start,end] = selection.current;
    onChange(expression.slice(0,start)+text+expression.slice(end));
    selection.current=[start+offset,start+offset];
    requestAnimationFrame(() => { const input=textarea.current?.resizableTextArea?.textArea; input?.focus(); input?.setSelectionRange(start+offset,start+offset); });
  };
  const readable = (mode === 'text' ? expression.replace(/^""\s*\+\s*/, '') : expression).replace(/"(?:\\.|[^"\\])*"|\b[A-Za-z_][A-Za-z0-9_]*\b|\*/g, token => token.startsWith('"') ? token : token==='*'?'×':fields.find(field => field.key===token)?.name || token);

  return <div className="formula-builder">
    <div className="formula-mode-row"><span>配置方式</span><RuleInlineSelect aria-label="公式配置方式" value={mode} onChange={value => switchMode(value as typeof mode)} options={[
      {value:'number',label:'数值运算'}, {value:'text',label:'文本拼接',disabled:numericResult}, {value:'condition',label:'条件判断'}, {value:'advanced',label:'高级公式'},
    ]} /></div>
    {mode !== 'advanced' && builder.mode === mode && <>
      {builder.mode === 'number' && <>
        {builder.items.map((item,index) => <div className="formula-term" key={index}>
          {index ? <RuleInlineSelect aria-label={`第${index+1}项运算符`} value={builder.operators[index-1]} options={[{value:'+',label:'＋ 加'},{value:'-',label:'− 减'},{value:'*',label:'× 乘'},{value:'/',label:'÷ 除'},{value:'%',label:'% 取余'}]} onChange={value => update({...builder,operators:builder.operators.map((op,i)=>i===index-1?value:op)})} /> : <span className="formula-start-label">计算</span>}
          {operand(item,next => update({...builder,items:builder.items.map((value,i)=>i===index?next:value)}),`第${index+1}项`,true)}
          <Button type="text" icon={<DeleteOutlined />} aria-label={`删除第${index+1}项`} disabled={builder.items.length<=1} onClick={() => update({...builder,items:builder.items.filter((_,i)=>i!==index),operators:builder.operators.filter((_,i)=>i!==(index?index-1:0))})} />
        </div>)}
        <Button size="small" type="text" icon={<PlusOutlined />} disabled={builder.items.length>=12} onClick={()=>update({...builder,items:[...builder.items,fieldOperand()],operators:[...builder.operators,'+']})}>添加运算项</Button>
        <span className="formula-help">先乘除，后加减；括号或多层函数可在高级公式中编辑。</span>
      </>}
      {builder.mode === 'text' && <>
        {builder.items.map((item,index)=><div className="formula-term" key={index}><span className="formula-start-label">第 {index+1} 段</span>{operand(item,next=>update({...builder,items:builder.items.map((value,i)=>i===index?next:value)}),`第${index+1}段`,false)}<Button type="text" icon={<DeleteOutlined />} aria-label={`删除第${index+1}段`} disabled={builder.items.length<=1} onClick={()=>update({...builder,items:builder.items.filter((_,i)=>i!==index)})} /></div>)}
        <Button size="small" type="text" icon={<PlusOutlined />} disabled={builder.items.length>=12} onClick={()=>update({...builder,items:[...builder.items,{kind:'value',value:''}]})}>添加拼接片段</Button>
        <span className="formula-help">按顺序拼接字段、固定文字和分隔符，数值字段也可以拼接。</span>
      </>}
      {builder.mode === 'condition' && <div className="formula-condition">
        <div className="formula-condition-row"><span>当</span><RuleInlineSelect showSearch optionFilterProp="label" aria-label="判断字段" placeholder="选择判断字段" value={builder.source||undefined} options={fields.filter(field=>field.storageType!=='boolean').map(field=>({value:field.key,label:field.name}))} onChange={source=>update({...builder,source,expected:'',operator:'=='})} /><RuleInlineSelect aria-label="判断运算符" value={builder.operator} options={[{value:'==',label:'等于'},{value:'!=',label:'不等于'},...(numericKeys.includes(builder.source)?[{value:'>',label:'大于'},{value:'>=',label:'大于等于'},{value:'<',label:'小于'},{value:'<=',label:'小于等于'}]:[])]} onChange={operator=>update({...builder,operator})} />{numericKeys.includes(builder.source)?<RuleInlineNumber aria-label="判断比较值" placeholder="比较数值" value={builder.expected===''?null:Number(builder.expected)} onChange={value=>update({...builder,expected:value==null?'':String(value)})} />:<RuleInlineInput aria-label="判断比较值" placeholder="比较文字" value={builder.expected} onChange={event=>update({...builder,expected:event.target.value})} />}</div>
        <div className="formula-branch"><span>满足时</span>{operand(builder.yes,yes=>update({...builder,yes}),'满足时结果')}</div>
        <div className="formula-branch"><span>否则</span>{operand(builder.no,no=>update({...builder,no}),'否则结果')}</div>
      </div>}
      <div className="formula-readable" aria-label="公式说明"><span>{targetName} =</span><strong>{readable || '选择上方字段和值来组成公式'}</strong></div>
    </>}
    {mode === 'advanced' && <>
      <Input.TextArea ref={textarea} aria-label="计算公式" autoSize={{minRows:3,maxRows:7}} maxLength={4096} value={expression} placeholder="可插入字段和函数，也可直接编辑公式" onChange={event=>onChange(event.target.value)} onSelect={event=>{selection.current=[event.currentTarget.selectionStart,event.currentTarget.selectionEnd];}} onBlur={event=>{selection.current=[event.target.selectionStart,event.target.selectionEnd];}} />
      <div className="formula-insert-tools"><Select<string> showSearch optionFilterProp="label" aria-label="插入公式字段" placeholder="搜索并插入字段" value={undefined} options={choices(false)} onChange={value=>insert(value)} /><Select<string> aria-label="插入公式函数" placeholder="插入函数" value={undefined} options={[{value:'ROUND(, 2)',label:'四舍五入 ROUND'},{value:'IF(, , )',label:'条件判断 IF'},{value:'MIN(, )',label:'最小值 MIN'},{value:'MAX(, )',label:'最大值 MAX'},{value:'ABS()',label:'绝对值 ABS'},{value:'COALESCE(, )',label:'空值备用 COALESCE'}]} onChange={value=>insert(value,value.indexOf('(')+1)} />{['+','-','*','/','(',')'].map(value=><Tooltip key={value} title={`插入 ${value}`}><Button size="small" type="text" onClick={()=>insert(value)}>{value==='*'?'×':value==='/'?'÷':value}</Button></Tooltip>)}</div>
      <span className="formula-help">字段和函数插入到光标处；支持加减乘除、括号、IF、ROUND、MIN/MAX、ABS 和 COALESCE。</span>
    </>}
  </div>;
}
