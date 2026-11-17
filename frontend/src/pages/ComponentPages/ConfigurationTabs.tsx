import type {ReactNode} from 'react';
import InspectorTabs from '@/components/PropertyInspector/InspectorTabs';

export default function ConfigurationTabs({items, selected, onSelect, actions, disabled}: {
  items: Array<{id: string; name: string}>;
  selected?: string;
  onSelect?: (id: string) => void;
  actions: ReactNode;
  disabled: boolean;
}) {
  return <div className="component-config-tab-bar">
    <InspectorTabs className="component-config-tabs" activeKey={selected} onChange={onSelect}
      items={items.map(item=>({
        key:item.id,
        label:<span className="component-config-tab-label" title={item.name}>{item.name}</span>,
        disabled,
      }))}/>
    <div className="component-config-tab-actions">{actions}</div>
  </div>;
}
