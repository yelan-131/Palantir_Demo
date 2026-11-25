import React, {createContext, useContext, useState} from 'react';

export interface PreviewSelection {
  id?: string;
  onSelect: (id: string) => void;
}

type Setting = 'filterScheme' | 'displayGroup';
type Selections = Record<string, Partial<Record<Setting, string>>>;

const PreviewContext = createContext<{
  selected: Selections;
  select: (widgetId: string, setting: Setting, id: string) => void;
} | undefined>(undefined);

export function ListConfigurationPreviewProvider({editing,children}: {editing: boolean; children: React.ReactNode}) {
  const [selected, setSelected] = useState<Selections>({});
  const select = (widgetId: string, setting: Setting, id: string) => {
    setSelected(current => {
      const widget = current[widgetId];
      return widget?.[setting] === id ? current : {...current, [widgetId]:{...widget, [setting]:id}};
    });
  };
  return <PreviewContext.Provider value={editing ? {selected, select} : undefined}>
    {children}
  </PreviewContext.Provider>;
}

export function useListConfigurationPreview(widgetId?: string) {
  const preview = useContext(PreviewContext);
  if (!preview || !widgetId) return;
  const selection = (setting: Setting): PreviewSelection => ({
    id:preview.selected[widgetId]?.[setting],
    onSelect:id => preview.select(widgetId, setting, id),
  });
  return {filterScheme:selection('filterScheme'), displayGroup:selection('displayGroup')};
}
