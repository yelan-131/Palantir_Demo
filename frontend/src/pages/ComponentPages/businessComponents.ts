import type {ViewConfig} from '@/utils/viewConfig';

export interface FilterScheme {id:string;name:string;showKeyword:boolean;groups:ToolbarGroup[];}
export interface FilterSettings {
  schemes?: FilterScheme[] | null;
  toolbarGroups?: ToolbarGroup[] | null;
  queryMode?: 'submit' | 'change';
  resetMode?: 'defaults' | 'clear';
  showKeyword?: boolean;
  expandAdvanced?: boolean;
  requiredFields?: string[];
  queryLabel?: string;
  resetLabel?: string;
}
export interface ToolbarGroup {
  pageSize?:number|null; emptyText?:string|null;
  defaultSort?: {field:string;order:'asc'|'desc'} | null; inheritDefaultSort?: boolean;
  sortableColumns?:string[]|null; columns?:string[]|null; id:string; name:string; userIds?:number[]; orgUnitIds?:number[]; roleIds:number[]; actions:string[];
}
export interface ListSettings {
  sortableColumns?:string[]|null;
  displayGroups?: ToolbarGroup[] | null;
  toolbarGroups?: ToolbarGroup[] | null;
  columns?: string[] | null;
  pageSize?: number | null;
  defaultSort?: {field: string; order: 'asc' | 'desc'} | null;
  rowClick?: 'none' | 'detail' | 'edit' | null;
  toolbarActions?: string[] | null;
  rowActions?: string[] | null;
  selection?: 'none' | 'single' | 'multiple';
  emptyText?: string;
}
/** Display groups are projected to the current audience by the page API. */
export function resolveListPresentation(settings?: ListSettings | null) {
  return {
    pageSize: settings?.displayGroups?.find(group=>group.pageSize!=null)?.pageSize ?? settings?.pageSize,
    emptyText: settings?.displayGroups?.find(group=>!!group.emptyText?.trim())?.emptyText ?? settings?.emptyText,
  };
}
/** Component toolbar configuration is independent; runtime authorization still applies. */
export function resolveListView(view: ViewConfig | null, settings?: ListSettings): ViewConfig | null {
  if (!view || !settings) return view;
  const allowed = view.table.columns.filter(column=>column.enabled);
  const selectedColumns = settings.displayGroups == null ? settings.columns : [...new Set(settings.displayGroups.flatMap(group=>group.columns||[]))];
  const sortableColumns = settings.displayGroups == null ? settings.sortableColumns : [...new Set(settings.displayGroups.flatMap(group=>(group.sortableColumns??view.table.columns.filter(column=>column.sortable).map(column=>column.fieldName)).filter(name=>group.columns?.includes(name))))];
  const columns = selectedColumns == null ? view.table.columns : selectedColumns.flatMap(name=>allowed.filter(column=>column.fieldName===name)).map((column,index)=>({...column,sortOrder:index}));
  const resolvedColumns = columns.map(column=>({...column,sortable:sortableColumns==null?column.sortable:sortableColumns.includes(column.fieldName)}));
  const sourceDefault = view.table.defaultSort ? {field:view.table.defaultSort.fieldName,order:view.table.defaultSort.order==='ascend'?'asc' as const:'desc' as const} : null;
  const groupDefault = settings.displayGroups?.map(group=>{
    const candidate=group.defaultSort??(group.inheritDefaultSort!==false?(settings.defaultSort??sourceDefault):null);
    const sortable=group.sortableColumns??view.table.columns.filter(column=>column.sortable).map(column=>column.fieldName);
    return candidate&&group.columns?.includes(candidate.field)&&sortable.includes(candidate.field)&&resolvedColumns.some(column=>column.fieldName===candidate.field&&column.sortable)?candidate:null;
  }).find(Boolean);
  const requestedSort = settings.displayGroups == null ? settings.defaultSort??sourceDefault : groupDefault;
  const sort = requestedSort && resolvedColumns.find(column=>column.fieldName===requestedSort.field&&column.sortable);
  const toolbarActions = settings.toolbarGroups == null ? settings.toolbarActions : [...new Set(settings.toolbarGroups.flatMap(group=>group.actions))];
  return {...view, table:{...view.table, columns:resolvedColumns,
    pageSize: resolveListPresentation(settings).pageSize ?? view.table.pageSize,
    defaultSort: sort && requestedSort ? {fieldName:sort.fieldName,order:requestedSort.order==='asc'?'ascend':'descend'} : undefined,
    rowClickAction: settings.rowClick == null ? view.table.rowClickAction : settings.rowClick === 'none' || view.table.rowActions.includes(settings.rowClick) || view.table.rowClickAction === settings.rowClick ? settings.rowClick : 'none',
    toolbarActions: toolbarActions == null ? view.table.toolbarActions : toolbarActions.filter(action=>['create','refresh','import','export'].includes(action)),
    rowActions: settings.rowActions == null ? view.table.rowActions : view.table.rowActions.filter(action=>settings.rowActions!.includes(action)),
  }};
}
export function emptyFilterValue(value: unknown): boolean {
  return value == null || typeof value === 'string' && value.trim() === '' || Array.isArray(value) && (value.length === 0 || value.some(emptyFilterValue));
}

/** Explicit empties prevent published defaults being silently applied again after clear. */
export function clearedFilterValues(filters: Array<{id:string; controlType:string}>) {
  return Object.fromEntries(filters.map(filter=>[filter.id,['text','keyword'].includes(filter.controlType)?'':null]));
}

/** The server has already removed groups that do not match the viewer. */
export function filterButtonActions(settings?: FilterSettings): string[] {
  return settings?.toolbarGroups == null ? ['query','reset'] : [...new Set(settings.toolbarGroups.flatMap(group=>group.actions).filter(action=>action==='query'||action==='reset'))];
}

/** Import subjects into the current group without changing fields or button actions. */
export function mergePermissionAudience(current:ToolbarGroup, imported:ToolbarGroup[]) {
  const groups=[current,...imported];
  return {
    roleIds:[...new Set(groups.flatMap(group=>group.roleIds||[]))],
    userIds:[...new Set(groups.flatMap(group=>group.userIds||[]))],
    orgUnitIds:[...new Set(groups.flatMap(group=>group.orgUnitIds||[]))],
  };
}
