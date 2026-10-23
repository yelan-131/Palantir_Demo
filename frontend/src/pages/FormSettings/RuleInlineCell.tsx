import { useState, type ReactNode } from 'react';
import { Input, InputNumber, Select, type InputProps, type InputNumberProps, type SelectProps } from 'antd';

/** Display and editor occupy the same property cell. */
function Cell({ label, display, children }: { label: string; display: ReactNode; children: (close: () => void) => ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <div className="rule-inline-cell">{editing ? children(() => setEditing(false)) : <button type="button" className="encoding-cell-display" aria-label={`编辑${label}`} title="双击编辑" onDoubleClick={() => setEditing(true)} onClick={event => { if (event.detail === 0) setEditing(true); }}>{display}</button>}</div>;
}
export function RuleInlineSelect<T extends string | number = string>(props: SelectProps<T>) {
  const label = String(props['aria-label'] || '选项');
  const selected = props.options?.find(option => option.value === props.value);
  return <Cell label={label} display={selected?.label ?? <span className="rule-inline-placeholder">{props.placeholder || '未设置'}</span>}>{close => <Select<T> {...props} autoFocus defaultOpen onChange={(value, option) => { props.onChange?.(value, option); close(); }} onBlur={event => { props.onBlur?.(event); close(); }} onInputKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }} />}</Cell>;
}
export function RuleInlineInput(props: InputProps) {
  const label = String(props['aria-label'] || '内容');
  return <Cell label={label} display={props.value === '' || props.value == null ? <span className="rule-inline-placeholder">{props.placeholder || '未填写'}</span> : String(props.value)}>{close => <Input {...props} autoFocus onFocus={event => event.target.select()} onBlur={event => { props.onBlur?.(event); close(); }} onPressEnter={close} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }} />}</Cell>;
}
export function RuleInlineNumber(props: InputNumberProps) {
  const label = String(props['aria-label'] || '数值');
  return <Cell label={label} display={props.value == null ? <span className="rule-inline-placeholder">{props.placeholder || '未填写'}</span> : String(props.value)}>{close => <InputNumber {...props} autoFocus onFocus={event => event.target.select()} onBlur={event => { props.onBlur?.(event); close(); }} onPressEnter={close} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }} />}</Cell>;
}
