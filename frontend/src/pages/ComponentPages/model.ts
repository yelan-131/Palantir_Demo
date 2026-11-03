import type {FilterSettings, ListSettings, ToolbarGroup} from './businessComponents';
import type {AnalyticsWidgetAppearance} from '../AppPrograms/analyticsWidgetAppearance';
export type WidgetType = 'record-list' | 'record-filter' | 'metric' | 'chart';
export interface PageWidget {
  id: string;
  type: WidgetType;
  title: string;
  width: 6 | 12 | 18 | 24;
  roleIds?: number[];
  accessGroups?: ToolbarGroup[] | null;
  dataBinding?: {formId: number} | null;
  dimension?: string | null;
  aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max';
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
}
export interface PageDefinition {
  title: string;
  schemaVersion?: 1 | 2;
  sourceFormId?: number | null;
  filterFields: string[];
  roleIds: number[];
  widgets: PageWidget[];
  style?: {gridSize?: number; cardOpacity?: number; cardBlur?: number; componentGap?: number; cardRadius?: number; preset?: 'clean' | 'factory' | 'executive'; background?: string | null;
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
    widgets: definition.widgets.map(({id, type, dataBinding, dimension, aggregate, measure, format, roleIds, accessGroups, targetWidgetIds, filterFields, filterSettings}) => ({id, type, dataBinding, dimension, aggregate, measure, format, roleIds, accessGroups, targetWidgetIds, filterFields, filterSettings}))});
}

export interface FilterContribution {schemeId?: string;ready?: boolean; search: string; filters: Array<{field: string; op: string; value: unknown}>}
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

/** Only clear field references for components affected by a source change. */
export function bindWidgetSource(definition: PageDefinition, id: string, formId?: number): PageDefinition {
  const selected = definition.widgets.find(w=>w.id===id);
  const linked = selected?.type==='record-list' ? definition.widgets.filter(w=>w.type==='record-filter'&&w.targetWidgetIds?.includes(id)).map(w=>w.id) : [];
  const next = {...definition, schemaVersion: 2 as const, widgets: definition.widgets.map(item => item.id !== id && !linked.includes(item.id) ? item : {
    ...item, dataBinding: formId ? {formId} : null, dimension: undefined, measure: undefined,
    filterFields: null, filterSettings: {...item.filterSettings, requiredFields: [], schemes:null},
    listSettings: {...item.listSettings, columns: null, displayGroups:null, defaultSort: null}, aggregate: 'count' as const,
    targetWidgetIds: linked.includes(item.id) ? item.targetWidgetIds?.filter(target=>target===id) : [],
  })};
  return {...next, widgets: next.widgets.map(item => ({...item, targetWidgetIds: item.targetWidgetIds?.filter(targetId => {
    const target = next.widgets.find(candidate => candidate.id === targetId);
    return target && widgetSourceId(next, item) === widgetSourceId(next, target);
  })}))};
}

/** Reuse an existing same-source filter, or insert one immediately before its list. */
export function ensureListFilter(definition: PageDefinition, listId: string, newId: string) {
  const list = definition.widgets.find(widget=>widget.id===listId&&widget.type==='record-list');
  const formId = list && widgetSourceId(definition,list);
  if(!list || !formId)return undefined;
  const existing = definition.widgets.find(widget=>widget.type==='record-filter'&&widget.targetWidgetIds?.includes(listId));
  if(existing){
    if(widgetSourceId(definition,existing)===formId)return {definition,filterId:existing.id,created:false};
    const repaired=bindWidgetSource(definition,existing.id,formId);
    return {definition:{...repaired,widgets:repaired.widgets.map(w=>w.id===existing.id?{...w,targetWidgetIds:[listId]}:w)},filterId:existing.id,created:false};
  }
  if(definition.widgets.length>=30||definition.widgets.some(widget=>widget.id===newId))return undefined;
  const filter:PageWidget={id:newId,type:'record-filter',title:list.title+'筛选',width:24,aggregate:'count',dataBinding:{formId},targetWidgetIds:[listId],filterFields:null,filterSettings:{queryMode:'submit',resetMode:'defaults',requiredFields:[]}};
  return {definition:{...definition,widgets:definition.widgets.flatMap(widget=>widget.id===listId?[filter,{...widget,showFilters:false}]:[widget])},filterId:newId,created:true};
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
