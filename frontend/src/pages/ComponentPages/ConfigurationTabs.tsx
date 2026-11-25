import {useState, type ReactNode, type Ref} from 'react';
import {Input, type InputRef} from 'antd';
import {PropertyRow} from '@/components/PropertyInspector';
import InspectorTabs from '@/components/PropertyInspector/InspectorTabs';

export default function ConfigurationTabs({items, selected, onSelect, onRename, actions, disabled, children}: {
  items: Array<{id: string; name: string}>;
  selected?: string;
  onSelect?: (id: string) => void;
  onRename?: (id: string) => void;
  actions: ReactNode;
  disabled: boolean;
  children: ReactNode;
}) {
  return <div className="component-config-tab-group">
    <div className="component-config-tab-bar">
      <InspectorTabs className="component-config-tabs" activeKey={selected} onChange={onSelect}
        items={items.map(item=>({
          key:item.id,
          label:<span className="component-config-tab-label" title={onRename && !disabled ? '双击更改名称' : item.name}
            onDoubleClick={onRename && !disabled ? () => onRename(item.id) : undefined}>{item.name}</span>,
          disabled,
        }))}/>
      <div className="component-config-tab-actions">{actions}</div>
    </div>
    {children}
  </div>;
}

export function ConfigurationName({label, inputRef, value, disabled, onChange, commitOnBlur = false}: {
  label: string;
  inputRef?: Ref<InputRef>;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  commitOnBlur?: boolean;
}) {
  const [draftName, setDraftName] = useState<string>();
  const commit = () => {
    const name = draftName?.trim();
    if (name && name !== value) onChange(name);
    setDraftName(undefined);
  };
  return <PropertyRow label={label}>
    <Input ref={inputRef} value={draftName ?? value} disabled={disabled} maxLength={50}
      data-editor-escape-handled={commitOnBlur || undefined}
      onChange={event=>(commitOnBlur ? setDraftName : onChange)(event.currentTarget.value)}
      onBlur={commitOnBlur ? commit : undefined}
      onPressEnter={commitOnBlur ? event=>event.currentTarget.blur() : undefined}
      onKeyDown={commitOnBlur ? event=>{
        if (event.key === 'Escape') {
          event.preventDefault();
          setDraftName(undefined);
        }
      } : undefined}/>
  </PropertyRow>;
}
