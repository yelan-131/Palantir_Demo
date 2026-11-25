import type {ComponentPresentation} from './presentation';
import type {FilterSettings, ListSettings, ToolbarGroup} from './businessComponents';
import type {StructuredFilter} from './filterControls';
import type {AnalyticsWidgetAppearance} from '../AppPrograms/analyticsWidgetAppearance';
export type WidgetType = 'record-list' | 'record-filter' | 'metric' | 'chart' | 'workspace';
export const heightPercentStops = [25, 33, 50, 75, 100] as const;
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
  heightPercent?: typeof heightPercentStops[number] | null;
  showFilters?: boolean;
  filterSettings?: FilterSettings;
  listSettings?: ListSettings;
  filterFields?: string[] | null;
  targetWidgetIds?: string[];
  standaloneFilter?: boolean;
  interaction?: 'filter' | 'none' | 'drilldown' | 'navigate';
  chartType?: 'bar' | 'line' | 'pie' | 'rank-table';
  format?: 'number' | 'percent' | 'currency' | 'duration';
  unit?: string;
  threshold?: string;
  appearance?: AnalyticsWidgetAppearance;
  presentation?: ComponentPresentation;
}
export function widgetFrameHeight(widget: Pick<PageWidget, 'customHeight' | 'heightPercent'>) {
  if (widget.customHeight != null) return widget.customHeight;
  if (widget.heightPercent != null) return `calc(var(--component-available-height, 70dvh) * ${widget.heightPercent / 100})`;
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
export interface SubmittedFilter {signature:string;query:FilterContribution}
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

function canReceiveSharedFilter(widget:PageWidget) {
  return widget.type==='record-list'||widget.type==='metric'||widget.type==='chart';
}

export function sharedFilterTargetOptions(definition:PageDefinition, filter:PageWidget):PageWidget[] {
  const candidates = definition.widgets.filter(widget=>canReceiveSharedFilter(widget) && widgetSourceId(definition,widget)!=null);
  const sourceId = widgetSourceId(definition,filter);
  const sameSource = candidates.filter(widget=>widgetSourceId(definition,widget)===sourceId);
  return sameSource.some(widget=>filter.targetWidgetIds?.includes(widget.id)) ? sameSource : candidates;
}

export function setSharedFilterTargets(definition:PageDefinition, filterId:string, targetIds:readonly string[]):PageDefinition {
  const filter = definition.widgets.find(widget=>widget.id===filterId && widget.type==='record-filter');
  if (!filter) return definition;
  const candidates = new Map(sharedFilterTargetOptions(definition,filter).map(widget=>[widget.id,widget] as const));
  const selected = [...new Set(targetIds)].map(id=>candidates.get(id)).filter((widget):widget is PageWidget=>Boolean(widget));
  const firstTarget = selected[0];
  if (targetIds.length && !firstTarget) return definition;
  const sourceId = firstTarget ? widgetSourceId(definition,firstTarget) : undefined;
  const next = sourceId!=null && sourceId!==widgetSourceId(definition,filter)
    ? bindWidgetSource(definition,filterId,sourceId)
    : definition;
  const targetWidgetIds = selected.filter(widget=>widgetSourceId(definition,widget)===sourceId).map(widget=>widget.id);
  return {
    ...next,
    ...(sourceId!=null ? {schemaVersion:2 as const} : {}),
    widgets:next.widgets.map(widget=>widget.id===filterId ? {
      ...widget,
      ...(sourceId!=null ? {dataBinding:{formId:sourceId}} : {}),
      standaloneFilter:true,
      targetWidgetIds,
    } : widget),
  };
}

export function pendingSharedFilter(definition: PageDefinition, widget: PageWidget): 'source' | 'fields' | 'targets' | undefined {
  if (widget.type!=='record-filter' || !widget.standaloneFilter) return;
  const sourceId = widgetSourceId(definition,widget);
  if (sourceId==null) return 'source';
  if (widget.filterFields?.length===0 && widget.filterSettings?.schemes==null && widget.filterSettings?.showKeyword===false) return 'fields';
  const targetIds = widget.targetWidgetIds;
  if (!targetIds?.length || !targetIds.every(id=>definition.widgets.some(target=>target.id===id
    && canReceiveSharedFilter(target)
    && widgetSourceId(definition,target)===sourceId))) return 'targets';
}

export function pendingDataCard(definition:PageDefinition, widget:PageWidget): 'source' | 'dimension' | undefined {
  if (!canReceiveSharedFilter(widget)) return;
  if (widgetSourceId(definition,widget)==null) return 'source';
  if (widget.type==='chart' && !widget.dimension) return 'dimension';
}

/** Components still being configured stay in the draft and out of the canvas query. */
export function canvasDataDefinition(definition: PageDefinition): PageDefinition {
  const pendingCards = new Set(definition.widgets.filter(widget=>pendingDataCard(definition,widget)).map(widget=>widget.id));
  const omitted = new Set(pendingCards);
  for (const widget of definition.widgets) {
    if (widget.type!=='record-filter') continue;
    const targets = widget.targetWidgetIds;
    if (pendingSharedFilter(definition,widget) || (targets?.length && targets.every(id=>pendingCards.has(id)))) {
      omitted.add(widget.id);
    }
  }
  if (!omitted.size) return definition;

  const widgets = definition.widgets.filter(widget=>!omitted.has(widget.id)).map(widget=>{
    const targetWidgetIds = widget.targetWidgetIds?.filter(id=>!omitted.has(id));
    return targetWidgetIds?.length===widget.targetWidgetIds?.length ? widget : {...widget,targetWidgetIds};
  });
  return {...definition,widgets};
}

export function widgetFilterSignature(definition:PageDefinition, widget:PageWidget):string {
  return JSON.stringify([widgetSourceId(definition,widget),widget.filterFields,widget.filterSettings]);
}

export function retainWidgetFilterQueries(definition:PageDefinition|undefined, entries:Record<string,SubmittedFilter>):Record<string,SubmittedFilter> {
  const submitted = Object.entries(entries);
  const retained = submitted.filter(([id,entry])=>{
    const widget = definition?.widgets.find(item=>item.id===id && item.type==='record-filter');
    return definition && widget && widgetFilterSignature(definition,widget)===entry.signature;
  });
  return retained.length===submitted.length ? entries : Object.fromEntries(retained);
}

export function contextSourceId(definition: PageDefinition | undefined | null, widgetId?: string) {
  if (!widgetId) return definition?.sourceFormId ?? undefined;
  const widget = definition?.widgets.find(item=>item.id===widgetId);
  return widget ? widgetSourceId(definition, widget) : undefined;
}

export function businessDataComponent(definition: PageDefinition, formId: number, isDashboard = false) {
  const components = definition.widgets.filter(widget => widget.type !== 'workspace' && widget.type !== 'record-filter');
  const matching = components.filter(widget => widgetSourceId(definition, widget) === formId);
  return matching.find(widget => widget.type === 'record-list') ?? matching[0] ?? (isDashboard ? components[0] : undefined);
}

/** Only clear field references for components affected by a source change. */
export function bindWidgetSource(definition: PageDefinition, id: string, formId?: number): PageDefinition {
  const selected = definition.widgets.find(w=>w.id===id);
  if (selected?.type==='record-filter' && formId!=null && widgetSourceId(definition,selected)===formId) {
    return {...definition, schemaVersion:2, widgets:definition.widgets.map(widget=>widget===selected
      ? {...widget,dataBinding:{formId},standaloneFilter:true}
      : widget)};
  }
  const legacyListFilters = selected?.type==='record-list' ? definition.widgets.filter(widget=>
    widget.type==='record-filter' && !widget.standaloneFilter && !widget.roleIds?.length && widget.accessGroups==null
    && widget.targetWidgetIds?.length===1 && widget.targetWidgetIds[0]===id
  ).map(widget=>widget.id) : [];
  const next = {...definition, schemaVersion: 2 as const, widgets: definition.widgets.map(item => item.id !== id && !legacyListFilters.includes(item.id) ? item : {
    ...item, dataBinding: formId ? {formId} : null, dimension: undefined, measure: undefined,
    filterFields: item.id===id && item.type==='record-filter' ? [] : null,
    filterSettings: {...item.filterSettings, requiredFields: [], schemes:null},
    listSettings: {...item.listSettings, columns: null, displayGroups:null, sortableColumns:null, defaultSort: null}, aggregate: 'count' as const, expression: null, sharedMetricId:null, sharedMetricVersion:null, sharedFields:[],
    targetWidgetIds: item.type==='record-filter' ? item.targetWidgetIds : [],
    ...(item.id===id && item.type==='record-filter' ? {standaloneFilter:true} : {}),
  })};
  return {...next, widgets: next.widgets.map(item => {
    const sourceId = widgetSourceId(next, item);
    const targetWidgetIds = item.targetWidgetIds?.filter(targetId => {
      const target = next.widgets.find(candidate => candidate.id === targetId);
      return target && sourceId != null && sourceId === widgetSourceId(next, target);
    });
    return targetWidgetIds?.length === item.targetWidgetIds?.length ? item : {
      ...item, targetWidgetIds,
      ...(item.type==='record-filter' && (item.targetWidgetIds?.length??0)>1 ? {standaloneFilter:true} : {}),
    };
  })};
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
    if (filter.standaloneFilter || !sourceId || widgetSourceId(definition, filter) !== sourceId || filter.targetWidgetIds?.length !== 1 ||
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
