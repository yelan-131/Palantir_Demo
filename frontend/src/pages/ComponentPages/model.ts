import type {ComponentPresentation} from './presentation';
import type {FilterSettings, ListSettings, ToolbarGroup} from './businessComponents';
import type {StructuredFilter} from './filterControls';
import type {AnalyticsWidgetAppearance} from '../AppPrograms/analyticsWidgetAppearance';
export type WidgetType = 'record-list' | 'record-filter' | 'metric' | 'chart' | 'workspace';
export interface PageWidget {
  id: string;
  type: WidgetType;
  workspaceModule?: 'overview' | 'continuation' | 'recent' | 'support' | 'forms';
  title: string;
  width: 6 | 8 | 12 | 18 | 24;
  roleIds?: number[];
  accessGroups?: ToolbarGroup[] | null;
  dataBinding?: {formId: number} | null;
  dimension?: string | null;
  aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max';
  expression?: string | null;
  sharedMetricId?: string | null;
  sharedMetricVersion?: number | null;
  sharedFields?: string[];
  measure?: string | null;
  height?: number;
  customWidth?: number | null;
  customHeight?: number | null;
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
  presentation?: ComponentPresentation;
}
export interface PageDefinition {
  title: string;
  schemaVersion?: 1 | 2;
  sourceFormId?: number | null;
  filterFields: string[];
  roleIds: number[];
  widgets: PageWidget[];
  style?: {componentDefaults?: ComponentPresentation; componentSurface?: 'plain' | 'soft' | 'card'; gridSize?: number; cardOpacity?: number; cardBlur?: number; componentGap?: number; cardRadius?: number; preset?: 'clean' | 'factory' | 'executive'; background?: string | null;
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
/** An unpublished page remains usable as an admin preview after leaving its editor. */
export function pagePresentation(state: PageState | undefined, admin: boolean, editing: boolean, draft?: PageDefinition) {
  const draftPreview = Boolean(admin && state && !state.publishedVersion && !editing);
  const storedDefinition = state?.publishedDefinition ?? (draftPreview ? state?.definition : undefined);
  return {
    draftPreview,
    definition: editing ? draft : storedDefinition && mergeListFilters(storedDefinition).definition,
    startEditing: Boolean(admin && state && !state.publishedVersion && !state.definition.widgets.length),
  };
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
    sharedBindings:definition.widgets.map(({id,sharedMetricId,sharedMetricVersion,sharedFields})=>({id,sharedMetricId,sharedMetricVersion,sharedFields})),
    widgets: definition.widgets.map(({id, type, dataBinding, dimension, aggregate, expression, measure, format, roleIds, accessGroups, targetWidgetIds, filterFields, filterSettings}) => ({id, type, dataBinding, dimension, aggregate, expression, measure, format, roleIds, accessGroups, targetWidgetIds, filterFields, filterSettings}))});
}

export interface FilterContribution {schemeId?: string;ready?: boolean; search: string; filters: StructuredFilter[]}
/** Only explicitly linked lists receive a filter component's conditions. */
export function linkedListQuery(widgets: PageWidget[], values: Record<string, FilterContribution>, target: string) {
  const linked = widgets.filter(widget => widget.type === 'record-filter' && widget.targetWidgetIds?.includes(target));
  const contributions = linked.map(widget => values[widget.id]).filter(Boolean);
  return {ready: !linked.some(widget=>values[widget.id]?.ready===false||(!values[widget.id]&&Boolean(widget.filterSettings?.requiredFields?.length))), search: contributions.map(value => value.search).filter(Boolean).join(' '), filters: contributions.flatMap(value => value.filters)};
}

/** Old definitions inherit the page source; explicit bindings always win. */
export function widgetSourceId(definition: PageDefinition | undefined | null, widget?: PageWidget) {
  return widget?.dataBinding?.formId ?? definition?.sourceFormId ?? undefined;
}

export function businessDataComponent(definition: PageDefinition, formId: number, isDashboard = false) {
  const components = definition.widgets.filter(widget => widget.type !== 'workspace' && widget.type !== 'record-filter');
  const matching = components.filter(widget => widgetSourceId(definition, widget) === formId);
  return matching.find(widget => widget.type === 'record-list') ?? matching[0] ?? (isDashboard ? components[0] : undefined);
}

/** Only clear field references for components affected by a source change. */
export function bindWidgetSource(definition: PageDefinition, id: string, formId?: number): PageDefinition {
  const selected = definition.widgets.find(w=>w.id===id);
  const linked = selected?.type==='record-list' ? definition.widgets.filter(w=>w.type==='record-filter'&&w.targetWidgetIds?.includes(id)).map(w=>w.id) : [];
  const next = {...definition, schemaVersion: 2 as const, widgets: definition.widgets.map(item => item.id !== id && !linked.includes(item.id) ? item : {
    ...item, dataBinding: formId ? {formId} : null, dimension: undefined, measure: undefined,
    filterFields: null, filterSettings: {...item.filterSettings, requiredFields: [], schemes:null},
    listSettings: {...item.listSettings, columns: null, displayGroups:null, sortableColumns:null, defaultSort: null}, aggregate: 'count' as const, expression: null, sharedMetricId:null, sharedMetricVersion:null, sharedFields:[],
    targetWidgetIds: linked.includes(item.id) ? item.targetWidgetIds?.filter(target=>target===id) : [],
  })};
  return {...next, widgets: next.widgets.map(item => ({...item, targetWidgetIds: item.targetWidgetIds?.filter(targetId => {
    const target = next.widgets.find(candidate => candidate.id === targetId);
    return target && widgetSourceId(next, item) === widgetSourceId(next, target);
  })}))};
}

/** Move a filter into its sole list when doing so preserves its source and audience. */
export function mergeListFilters(definition: PageDefinition) {
  const merged = new Map<string, string>();
  const widgets = definition.widgets.map(list => {
    if (list.type !== 'record-list') return list;
    const linked = definition.widgets.filter(widget => widget.type === 'record-filter' && widget.targetWidgetIds?.includes(list.id));
    if (linked.length !== 1) return list;
    const [filter] = linked;
    const sourceId = widgetSourceId(definition, list);
    if (!sourceId || widgetSourceId(definition, filter) !== sourceId || filter.targetWidgetIds?.length !== 1 ||
        filter.roleIds?.length || filter.accessGroups != null) return list;
    merged.set(filter.id, list.id);
    const hasListConfiguration = list.showFilters === true &&
      (list.filterFields != null || list.filterSettings?.schemes != null || list.filterSettings?.toolbarGroups != null);
    return hasListConfiguration ? list :
      {...list, showFilters:true, filterFields:filter.filterFields, filterSettings:filter.filterSettings};
  });
  return {
    definition: merged.size ? {...definition, widgets:widgets.filter(widget => !merged.has(widget.id))} : definition,
    merged,
  };
}

/** Keep source contributions independent so clearing one interaction preserves others. */
export function componentQuery(definition: PageDefinition, values: Record<string, FilterContribution>, charts: Record<string,string>, targetId: string) {
  const target = definition.widgets.find(widget=>widget.id===targetId);
  const linked = definition.widgets.filter(widget=>widget.targetWidgetIds?.includes(targetId)&&widgetSourceId(definition,widget)===widgetSourceId(definition,target));
  const filters = linked.filter(widget=>widget.type==='record-filter');
  const contributions = filters.map(widget=>values[widget.id]).filter(Boolean);
  return {
    ready: !filters.some(widget=>values[widget.id]?.ready===false||(!values[widget.id]&&Boolean(widget.filterSettings?.requiredFields?.length))),
    search: contributions.map(value=>value.search).filter(Boolean).join(' '),
    filters: [...contributions.flatMap(value=>value.filters),...linked.flatMap(widget=>widget.type==='chart'&&(!widget.interaction||widget.interaction==='filter')&&widget.dimension&&charts[widget.id]!==undefined?[{field:widget.dimension,op:'equals',value:charts[widget.id]}]:[])],
  };
}
