import type {FilterSettings, ListSettings} from './businessComponents';
import type {AnalyticsWidgetAppearance} from '../AppPrograms/analyticsWidgetAppearance';
export type WidgetType = 'record-list' | 'record-filter' | 'metric' | 'chart';
export interface PageWidget {
  id: string;
  type: WidgetType;
  title: string;
  width: 6 | 12 | 18 | 24;
  dimension?: string | null;
  aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max';
  measure?: string | null;
  height?: number;
  showFilters?: boolean;
  filterSettings?: FilterSettings;
  listSettings?: ListSettings;
  filterFields?: string[] | null;
  targetWidgetIds?: string[];
  interaction?: 'filter' | 'none' | 'drilldown' | 'navigate';
  chartType?: 'bar' | 'line' | 'pie' | 'rank-table';
  format?: 'number' | 'percent' | 'currency' | 'duration';
  unit?: string;
  threshold?: string;
  appearance?: AnalyticsWidgetAppearance;
}
export interface PageDefinition {
  title: string;
  sourceFormId: number;
  filterFields: string[];
  roleIds: number[];
  widgets: PageWidget[];
  style?: {componentGap?: number; cardRadius?: number; preset?: 'clean' | 'factory' | 'executive'; background?: string | null;
    cardBorder?: 'none' | 'light' | 'strong'; chartPalette?: 'manufacturing' | 'business' | 'warning' | 'mono';
    tableDensity?: 'compact' | 'standard' | 'comfortable' | null; filterTheme?: 'toolbar' | 'inline' | 'panel'; refreshInterval?: number};
}
export interface PageState {
  code: string;
  revision: number;
  publishedVersion: number;
  definition: PageDefinition;
  publishedDefinition?: PageDefinition | null;
  hostForm?: {id: number; code: string; name: string; kind: string; status: string} | null;
}
export function moveWidget(definition: PageDefinition, source: string, target: string): PageDefinition {
  const from = definition.widgets.findIndex(widget => widget.id === source);
  const to = definition.widgets.findIndex(widget => widget.id === target);
  if (from < 0 || to < 0 || from === to) return definition;
  const widgets = [...definition.widgets];
  const [widget] = widgets.splice(from, 1);
  widgets.splice(to, 0, widget);
  return {...definition, widgets};
}
export function listFilters(filters: Record<string, string>) {
  return Object.entries(filters).filter(([, value]) => value !== '').map(([field, value]) => ({field, op: 'equals', value}));
}
export function retainFilters(filters: Record<string, string>, fields: string[]) {
  return Object.fromEntries(Object.entries(filters).filter(([field]) => fields.includes(field)));
}
/** Presentation edits keep current results; source, formula or filter changes reload them. */
export function pageDataSignature(definition?: PageDefinition | null) {
  return JSON.stringify(definition && {sourceFormId: definition.sourceFormId, filterFields: definition.filterFields,
    widgets: definition.widgets.map(({id, type, dimension, aggregate, measure, format}) => ({id, type, dimension, aggregate, measure, format}))});
}

export interface FilterContribution {ready?: boolean; search: string; filters: Array<{field: string; op: string; value: unknown}>}
/** Only explicitly linked lists receive a filter component's conditions. */
export function linkedListQuery(widgets: PageWidget[], values: Record<string, FilterContribution>, target: string) {
  const linked = widgets.filter(widget => widget.type === 'record-filter' && widget.targetWidgetIds?.includes(target));
  const contributions = linked.map(widget => values[widget.id]).filter(Boolean);
  return {ready: !linked.some(widget=>values[widget.id]?.ready===false||(!values[widget.id]&&Boolean(widget.filterSettings?.requiredFields?.length))), search: contributions.map(value => value.search).filter(Boolean).join(' '), filters: contributions.flatMap(value => value.filters)};
}
